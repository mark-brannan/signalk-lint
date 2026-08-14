import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { noDataConnections } from '../../src/rules/no-data-connections.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

function settingsOf(snapshot: Snapshot): Record<string, unknown> {
  return snapshot.server.settings as Record<string, unknown>
}

const rule = noDataConnections

describe('config/no-data-connections', () => {
  it('flags an empty pipedProviders list', () => {
    const findings = rule.evaluate(fixture('no-data-connections'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toBe('No data connections are configured')
  })

  it('cites the empty list it fired on', () => {
    const findings = rule.evaluate(fixture('no-data-connections'))
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'server.settings.pipedProviders',
        value: [],
        file: 'settings.json'
      }
    ])
  })

  it('is a warning, not an error -- a fresh install legitimately has none', () => {
    expect(rule.defaultSeverity).toBe('warn')
    const findings = rule.evaluate(fixture('no-data-connections'))
    expect(findings[0]?.detail).toMatch(/still setting up, that is expected/)
  })

  it('does not fire when a connection is configured', () => {
    expect(rule.evaluate(fixture('n2k-input-configured'))).toEqual([])
  })

  it('fires when pipedProviders is absent, which means the same thing', () => {
    const snapshot = fixture('n2k-input-configured')
    delete settingsOf(snapshot).pipedProviders
    expect(rule.evaluate(snapshot)).toHaveLength(1)
  })

  it('does not fire when settings.json is missing', () => {
    // Nothing can be said about connections that are not readable, and a
    // finding the reader cannot check against anything is worse than silence.
    const snapshot = fixture('no-data-connections')
    snapshot.server.settings = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when pipedProviders is not a list', () => {
    const snapshot = fixture('no-data-connections')
    settingsOf(snapshot).pipedProviders = { 'n2k-can0': {} }
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire on an explicit null, which is a broken settings.json', () => {
    // signalk-server only substitutes an empty array for `undefined`, so an
    // explicit null survives to its own .forEach and breaks the server.
    // "No connections are configured" is the wrong thing to tell someone
    // whose config file is malformed.
    const snapshot = fixture('no-data-connections')
    settingsOf(snapshot).pipedProviders = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when an entry is unreadable', () => {
    const snapshot = fixture('no-data-connections')
    settingsOf(snapshot).pipedProviders = [null]
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not claim to be the only way data reaches the model', () => {
    // Plugins inject deltas without appearing in pipedProviders, so a
    // plugin-only install can be working exactly as intended and still show
    // this finding. The text has to say so rather than assert an empty model.
    const findings = rule.evaluate(fixture('no-data-connections'))
    expect(findings[0]?.detail).toMatch(/plugins feed the data model directly/)
    expect(findings[0]?.detail).not.toMatch(/nothing is feeding/)
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('no-data-connections')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
