/**
 * Collectors: the only code in this package that performs I/O.
 *
 * A collector's whole job is to turn a live, messy, partially-readable Signal K
 * installation into one serializable Snapshot. Everything downstream is pure.
 *
 * Collectors are deliberately forgiving: a missing or unreadable file yields
 * `null`, not an exception. Half a snapshot is useful; a crash is not. Rules
 * are responsible for saying "I could not evaluate this" when they see a null.
 */
import { access, readdir, readFile, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { arch, platform, totalmem } from 'node:os'
import {
  SNAPSHOT_SCHEMA_VERSION,
  DiskInfo,
  SecurityFacts,
  ServerFacts,
  SystemInfo,
  Snapshot
} from '../types.js'

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Key names whose values are treated as credentials.
 *
 * A denylist, because plugin configs are third-party schemas nobody here
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
 *
 * The alternative -- keeping only keys some rule names -- was rejected: it
 * would make the collector carry plugin-specific knowledge that deliberately
 * lives in rules, and every new rule would need a collector change.
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

function namesCredential(key: string): boolean {
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
function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = namesCredential(key) ? REDACTED : redactSecrets(inner)
  }
  return out
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function countOf(v: unknown): number | null {
  return Array.isArray(v) ? v.length : null
}

/**
 * Reduce security.json to facts.
 *
 * Note what is *not* carried across: secretKey, user password hashes, device
 * tokens. Snapshots get pasted into bug reports and shared with people helping
 * you debug -- so a snapshot must never be a credential disclosure. Rules do
 * not need the secrets to reason about posture.
 */
function securityFactsFrom(raw: Record<string, unknown> | null): SecurityFacts {
  if (raw === null) {
    return {
      configured: false,
      allowReadonly: null,
      userCount: null,
      deviceCount: null,
      allowNewUserRegistration: null,
      allowDeviceAccessRequests: null
    }
  }
  return {
    configured: true,
    allowReadonly: asBool(raw.allow_readonly),
    userCount: countOf(raw.users),
    deviceCount: countOf(raw.devices),
    allowNewUserRegistration: asBool(raw.allowNewUserRegistration),
    allowDeviceAccessRequests: asBool(raw.allowDeviceAccessRequests)
  }
}

export interface CollectOptions {
  /** Path to the Signal K config directory (the one holding settings.json). */
  configDir: string
  /**
   * Installed signalk-server version. Supplied by the caller because the
   * config directory does not contain it: at runtime a plugin reads
   * `app.config.version`, and the CLI takes a flag or probes the install.
   */
  serverVersion?: string | null
  /** Overrides the capture timestamp. Tests pass a fixed value. */
  now?: Date
}

/**
 * Disk usage of the filesystem holding `configDir`, not the root filesystem.
 * `statfs` reports blocks in units of `bsize`, which varies by filesystem --
 * everything below is normalized to MB before it leaves this function.
 */
async function diskInfo(configDir: string): Promise<DiskInfo | null> {
  try {
    const stats = await statfs(configDir)
    const blockToMB = stats.bsize / (1024 * 1024)
    const totalMB = Math.round(stats.blocks * blockToMB)
    const freeMB = Math.round(stats.bfree * blockToMB)
    const usedMB = totalMB - freeMB
    const usedPercent =
      totalMB > 0 ? Math.round((usedMB / totalMB) * 1000) / 10 : 0
    return { totalMB, usedMB, usedPercent }
  } catch {
    // Not every platform/filesystem supports statfs. Absence is a fact, not
    // a failure -- same convention as every other collector in this file.
    return null
  }
}

/**
 * Whether /dev/rtc0 exists. Only meaningful on Linux -- there's no equivalent
 * convention on macOS/Windows, and checking there would misreport "no RTC" on
 * a dev machine that was never a candidate for one.
 */
async function hasRTC(platformName: string): Promise<boolean | null> {
  if (platformName !== 'linux') return null
  try {
    await access('/dev/rtc0')
    return true
  } catch {
    return false
  }
}

/**
 * Reads every plugin-config-data/*.json file into a map keyed by plugin id
 * (the filename, minus extension). Directory name verified against
 * signalk-server's own plugin-paths.js (PLUGIN_CONFIG_DATA_DIR), not
 * guessed -- but it's still an internal convention, not a documented public
 * API, so absence is treated the same as every other optional fact here:
 * null, not a thrown error.
 */
async function pluginConfig(
  configDir: string
): Promise<Record<string, unknown> | null> {
  const dir = join(configDir, 'plugin-config-data')
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }

  const result: Record<string, unknown> = {}
  await Promise.all(
    entries
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const id = name.slice(0, -'.json'.length)
        const parsed = await readJson(join(dir, name))
        // Redact on the way in, so nothing downstream -- the /snapshot route,
        // --save-snapshot, a rule -- ever holds the cleartext.
        if (parsed !== null) result[id] = redactSecrets(parsed)
      })
  )
  return result
}

async function systemInfo(configDir: string): Promise<SystemInfo> {
  const totalBytes = totalmem()
  const platformName = platform()
  return {
    nodeVersion: process.version,
    platform: platformName,
    arch: arch(),
    totalMemMB: totalBytes ? Math.round(totalBytes / (1024 * 1024)) : null,
    disk: await diskInfo(configDir),
    hasRTC: await hasRTC(platformName)
  }
}

export async function collect(options: CollectOptions): Promise<Snapshot> {
  const { configDir, serverVersion = null, now = new Date() } = options

  const [settings, security, sourcePriorities, system, plugins] =
    await Promise.all([
      readJson(join(configDir, 'settings.json')),
      readJson(join(configDir, 'security.json')),
      readJson(join(configDir, 'priorities.json')),
      systemInfo(configDir),
      pluginConfig(configDir)
    ])

  const server: ServerFacts = {
    version: serverVersion,
    settings,
    security: securityFactsFrom(security),
    sourcePriorities,
    system,
    pluginConfig: plugins
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: now.toISOString(),
    source: { kind: 'config-dir', configDir },
    server
  }
}
