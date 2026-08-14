/**
 * Loading a snapshot captured somewhere else.
 *
 * `--snapshot` is the mode the whole architecture exists for: someone sends you
 * a capture from a boat you have never seen. That also makes it the one place
 * where the shape on disk is not under our control. It may predate a field the
 * current rule set reads, or come from a newer release than the one reading it.
 *
 * Rules are written against `Snapshot`, not against "whatever JSON turned up",
 * so the reconciling happens here -- at the boundary, the same way
 * `assertConfigDir` validates a config directory before any collector reads it.
 * A rule that has to defend itself against a malformed snapshot is a rule
 * carrying the loader's job.
 */
import { SNAPSHOT_SCHEMA_VERSION, Snapshot } from './types.js'

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Fill in fields added since a snapshot was captured.
 *
 * Every field added to `ServerFacts` after v1 is nullable, and `null` already
 * means "could not determine" everywhere in this codebase -- so an older
 * capture is exactly a capture that could not determine them. Absent and
 * `null` therefore have to arrive at rules as the same thing; when they do
 * not, a rule that correctly handles `null` still crashes on `undefined`,
 * which is what happened to `plugin/venus-raw-device-instance`.
 */
function normalize(raw: Record<string, unknown>): Snapshot {
  const server = isObject(raw.server) ? { ...raw.server } : {}
  const system = isObject(server.system) ? { ...server.system } : {}

  return {
    ...raw,
    server: {
      ...server,
      pluginConfig: server.pluginConfig ?? null,
      system: { ...system, hasRTC: system.hasRTC ?? null }
    }
  } as unknown as Snapshot
}

/**
 * Parse and normalize a snapshot file's contents.
 *
 * A snapshot from a *newer* schema is refused rather than normalized: the
 * fields it carries are unknown here, so any verdict would be reached without
 * seeing everything the capture recorded. That is the same judgement the rest
 * of the tool makes about a check it cannot run -- say so, exit 2, rather than
 * report a clean bill from a partial reading.
 */
export function parseSnapshot(contents: string): Snapshot {
  let raw: unknown
  try {
    raw = JSON.parse(contents)
  } catch (error) {
    throw new SnapshotError(
      `Snapshot is not valid JSON: ${(error as Error).message}`
    )
  }

  if (!isObject(raw)) {
    throw new SnapshotError('Snapshot is not a JSON object')
  }

  const version = raw.schemaVersion
  if (typeof version !== 'number') {
    throw new SnapshotError(
      'Snapshot has no schemaVersion, so it cannot be read as a snapshot.'
    )
  }
  if (version > SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotError(
      `Snapshot schema version ${version} is newer than this build understands ` +
        `(${SNAPSHOT_SCHEMA_VERSION}). Upgrade signalk-lint rather than linting ` +
        'it with an older rule set.'
    )
  }

  if (!isObject(raw.server)) {
    throw new SnapshotError('Snapshot has no server facts to evaluate.')
  }

  return normalize(raw)
}
