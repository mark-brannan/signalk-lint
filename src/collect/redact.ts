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
 * Redact a `KEY=VALUE`-shaped assignment in a raw text line: cron environment
 * lines, systemd `Environment=` directives, shell exports in autostart files.
 *
 * The same limit as the JSON denylist, stated rather than papered over: a
 * credential inline in a command (`curl -u user:pass`) has no key to match
 * and gets through. The key is kept, the value replaced, for the same reason
 * redactSecrets keeps keys -- "a password is set here" is a fact a rule may
 * need.
 *
 * systemd's `Environment=NAME=value` nests one assignment in another, so the
 * name checked is the innermost one.
 */
export function redactAssignmentLine(line: string): string {
  const match = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
  if (!match) return line
  const [, prefix, key, rest] = match
  const inner = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(rest)
  if (inner && namesCredential(inner[1])) {
    return `${prefix}${key}=${inner[1]}=${REDACTED}`
  }
  if (namesCredential(key)) return `${prefix}${key}=${REDACTED}`
  return line
}
