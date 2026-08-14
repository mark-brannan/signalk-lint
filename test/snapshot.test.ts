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
    // Resaving must not claim a version whose shape it no longer has.
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
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
  })

  it('refuses a schemaVersion that no capture could have written', () => {
    // 0 and 1.5 previously slipped through a bare typeof check, taking a
    // shapeless object with them.
    for (const version of [0, -1, 1.5, '1', null]) {
      const raw = JSON.stringify({ schemaVersion: version, server: {} })
      expect(() => parseSnapshot(raw)).toThrow(/schemaVersion/)
    }
  })

  it('refuses a snapshot missing fields no capture has been without', () => {
    // The distinction that matters: absent capturedAt means "not a snapshot",
    // while absent pluginConfig means "an older snapshot" and is normalized.
    const base = JSON.parse(fixtureText('current-server')) as Record<
      string,
      unknown
    >
    const without = (path: string): string => {
      const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>
      const parts = path.split('.')
      let node = copy as Record<string, unknown>
      for (const part of parts.slice(0, -1)) {
        node = node[part] as Record<string, unknown>
      }
      delete node[parts[parts.length - 1]!]
      return JSON.stringify(copy)
    }

    expect(() => parseSnapshot(without('capturedAt'))).toThrow(/capturedAt/)
    expect(() => parseSnapshot(without('source'))).toThrow(/source/)
    expect(() => parseSnapshot(without('source.kind'))).toThrow(/source.kind/)
    expect(() => parseSnapshot(without('server'))).toThrow(/server facts/)
    expect(() => parseSnapshot(without('server.system'))).toThrow(
      /server.system/
    )
    expect(() => parseSnapshot(without('server.system.nodeVersion'))).toThrow(
      /nodeVersion/
    )
  })
})
