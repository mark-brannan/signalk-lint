/**
 * Credential redaction, shared by every collector that captures third-party
 * content: plugin config JSON and raw host file lines both end up in a
 * snapshot, and a snapshot must stay safe to paste into a bug report.
 *
 * A denylist, because plugin configs and host files are shapes nobody here
 * controls -- there is no allowlist that could be held complete. So this
 * reduces the blast radius rather than eliminating it, and the docs say that
 * plainly instead of implying a guarantee.
 *
 * Wide within a word, strict about word boundaries. Under-redacting puts a live
 * credential in a file someone pastes into a bug report, so `key` matches as a
 * whole word anywhere in a name -- `sharedKey`, `accessKey`, `accessKeyId` --
 * and `hash` and `salt` are here because a stored hash is credential-equivalent,
 * `cert`/`pem` because the private half routinely lands in the same field as
 * the public one.
 */
const SECRET_WORDS = new Set([
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'credential',
  'credentials',
  'auth',
  'authorization',
  'bearer',
  'jwt',
  'apikey',
  'key',
  'keys',
  'cookie',
  'signature',
  'signing',
  'salt',
  'hash',
  'cert',
  'certificate',
  'pem',
  'psk'
])

/**
 * Words that name a credential only in company.
 *
 * `session` alone is usually `sessionTimeout` -- a number, and useful in a bug
 * report. `sessionId` and `sessionToken` are the credential.
 */
const QUALIFIED_WORDS = new Set(['session'])
const QUALIFIERS = new Set(['id', 'key', 'token', 'secret'])

/**
 * Split a config key into its words: camelCase, snake_case and kebab-case all
 * arrive here, and only whole words are compared.
 *
 * Substring matching is what makes a denylist destructive on a boat.
 * `pass` inside `compass`, and `pin` inside `pinMode` or `gpioPin`, are the
 * two that would bite hardest here -- a heading calibration block and a GPIO
 * assignment, both replaced by a string, in the one artifact whose purpose is
 * letting somebody else debug the boat. `pin` is absent from the lists above
 * for that reason: on a Signal K install it names a GPIO far more often than a
 * passcode.
 */
function wordsIn(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

export function namesCredential(key: string): boolean {
  const words = wordsIn(key)
  if (words.some((word) => SECRET_WORDS.has(word))) return true
  return (
    words.some((word) => QUALIFIED_WORDS.has(word)) &&
    words.some((word) => QUALIFIERS.has(word))
  )
}

export const REDACTED = '[redacted]'

/**
 * Shape is kept because a rule may legitimately need to know that a password
 * is *set* without knowing what it is -- "MQTT configured with no TLS" is a
 * finding someone will want, and it must not require the secret to reason.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = namesCredential(key) ? REDACTED : redactSecrets(inner)
  }
  return out
}

/**
 * Split systemd's `Environment=`-style assignment list into tokens, one
 * whitespace-delimited item at a time (systemd.exec(5), systemd.syntax(7)):
 * an item may be wrapped in one layer of matching `"..."` or `'...'` quotes,
 * and a backslash escapes the character after it, inside or outside quotes.
 *
 * This does not interpret those escapes -- it never turns `\s` into a space
 * or strips a quote's own backslash -- it only has to not end a token early
 * on a character that was escaped. Getting that wrong is exactly how the
 * previous version of this function leaked a credential: an escaped space or
 * an escaped quote inside a value looked like the token's real boundary, so
 * everything after it was scanned as a separate, unredacted token.
 */
function tokenizeAssignments(text: string): string[] {
  const tokens: string[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    while (i < n && /\s/.test(text[i]!)) i++
    if (i >= n) break
    let token = ''
    while (i < n && !/\s/.test(text[i]!)) {
      const ch = text[i]!
      if (ch === '\\' && i + 1 < n) {
        token += text.slice(i, i + 2)
        i += 2
      } else if (ch === '"' || ch === "'") {
        let j = i + 1
        while (j < n && text[j] !== ch) {
          j += text[j] === '\\' && j + 1 < n ? 2 : 1
        }
        j = Math.min(j + 1, n) // include the closing quote, if one was found
        token += text.slice(i, j)
        i = j
      } else {
        token += ch
        i++
      }
    }
    tokens.push(token)
  }
  return tokens
}

/** One layer of matching quotes around `token`, or '' if it isn't quoted. */
function quoteOf(token: string): '"' | "'" | '' {
  const first = token[0]
  return (first === '"' || first === "'") &&
    token.length >= 2 &&
    token.endsWith(first)
    ? first
    : ''
}

function redactToken(token: string): string {
  const quote = quoteOf(token)
  const body = quote ? token.slice(1, -1) : token

  // Whole-assignment quoting ("NAME=value") and value-only quoting
  // (NAME="value") both end up here as NAME=<rest>; [\s\S] rather than `.`
  // because a value can itself contain the systemd-escaped newlines this
  // parser is not trying to interpret.
  const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(body)
  if (!assignment) return token
  const [, name, value] = assignment
  if (!namesCredential(name)) return token

  const valueQuote = quoteOf(value)
  return `${quote}${name}=${valueQuote}${REDACTED}${valueQuote}${quote}`
}

/**
 * Redacts every credential-named assignment in a systemd `Environment=`-style
 * list, preserving everything else -- spacing, other assignments -- as-is.
 * Returns `text` unchanged (same reference) when nothing needed redacting,
 * so a caller can tell "nothing matched" from "this token happened to
 * already read the same" without re-scanning.
 */
function redactNestedAssignments(text: string): string {
  let changed = false
  const tokens = tokenizeAssignments(text).map((token) => {
    const redacted = redactToken(token)
    if (redacted !== token) changed = true
    return redacted
  })
  return changed ? tokens.join(' ') : text
}

/**
 * Redact a `KEY=VALUE`-shaped assignment in a raw text line: cron environment
 * lines, systemd `Environment=` directives, shell exports in autostart files.
 *
 * The same limit as the JSON denylist, stated rather than papered over: a
 * credential inline in a command (`curl -u user:pass`) has no key to match
 * and gets through. The key is kept, the value replaced, for the same reason
 * redactSecrets keeps keys -- "a password is set here" is a fact a rule may
 * need.
 *
 * `Environment=NAME=value` nests one or more further assignments inside the
 * outer one, so once the outer key itself clears (it is never a credential
 * name in practice -- `Environment`, `export`, etc.), the value is rescanned
 * for nested `NAME=value` entries and each credential-named one is redacted
 * independently.
 */
export function redactAssignmentLine(line: string): string {
  const match = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
  if (!match) return line
  const [, prefix, key, rest] = match
  if (namesCredential(key)) return `${prefix}${key}=${REDACTED}`

  const redactedRest = redactNestedAssignments(rest)
  return redactedRest === rest ? line : `${prefix}${key}=${redactedRest}`
}
