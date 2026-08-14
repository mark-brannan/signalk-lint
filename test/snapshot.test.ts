import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SnapshotError, parseSnapshot } from '../src/snapshot.js'
import { SNAPSHOT_SCHEMA_VERSION } from '../src/types.js'
import { rules } from '../src/rules/index.js'
import { lint } from '../src/lint.js'

function fixtureText(name: string): string {
  return readFileSync(
    join(import.meta.dirname, 'fixtures', `${name}.json`),
    'utf8'
  )
}

/** A capture from before pluginConfig and hasRTC existed. */
function legacyText(): string {
  const raw = JSON.parse(fixtureText('current-server')) as {
    server: { pluginConfig?: unknown; system: { hasRTC?: unknown } }
  }
  delete raw.server.pluginConfig
  delete raw.server.system.hasRTC
  return JSON.stringify(raw)
}

describe('parseSnapshot()', () => {
  it('lints a capture that predates the fields the rule set reads', () => {
    // The regression this exists for: an older capture reached the rules with
    // pluginConfig undefined, and venus-raw-device-instance -- which correctly
    // guards against null -- threw on it. Absent has to arrive as null.
    const snapshot = parseSnapshot(legacyText())

    expect(snapshot.server.pluginConfig).toBeNull()
    expect(snapshot.server.system.hasRTC).toBeNull()
    expect(() => lint(snapshot, {}, rules)).not.toThrow()
  })

  it('leaves a current capture untouched', () => {
    const snapshot = parseSnapshot(fixtureText('vulnerable-server'))
    expect(snapshot.server.version).toBe('2.18.0')
    expect(lint(snapshot).findings.length).toBeGreaterThan(0)
  })

  it('refuses a schema newer than this build understands', () => {
    // Reporting a clean bill from a partial reading is the failure mode this
    // whole tool is built to avoid, so an unreadable capture is not evaluated.
    const raw = JSON.parse(fixtureText('current-server')) as {
      schemaVersion: number
    }
    raw.schemaVersion = SNAPSHOT_SCHEMA_VERSION + 1
    expect(() => parseSnapshot(JSON.stringify(raw))).toThrow(SnapshotError)
  })

  it('refuses something that is not a snapshot', () => {
    expect(() => parseSnapshot('not json at all')).toThrow(/not valid JSON/)
    expect(() => parseSnapshot('[]')).toThrow(/not a JSON object/)
    expect(() => parseSnapshot('{}')).toThrow(/schemaVersion/)
    expect(() => parseSnapshot('{"schemaVersion":1}')).toThrow(/server facts/)
  })
})
