import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allowReadonlyNonLoopback } from '../../src/rules/allow-readonly-non-loopback.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = allowReadonlyNonLoopback

describe('config/allow-readonly-non-loopback', () => {
  it('flags readonly access on a non-loopback interface', () => {
    const findings = rule.evaluate(fixture('readonly-open-network'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.evidence).toContainEqual({
      path: 'server.security.allowReadonly',
      value: true
    })
  })

  it('does not flag readonly access bound to loopback only', () => {
    const findings = rule.evaluate(fixture('readonly-loopback-only'))
    expect(findings).toEqual([])
  })

  it('does not flag a non-loopback binding when readonly is disabled', () => {
    const findings = rule.evaluate(fixture('readonly-disabled-open-network'))
    expect(findings).toEqual([])
  })

  it('does not fire when security.json is absent', () => {
    const snapshot = fixture('readonly-open-network')
    snapshot.server.security = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('reports rather than silently passes when settings.json is missing', () => {
    // A live install: readonly is on, settings.json doesn't exist (Signal K
    // logs "Settings file does not exist, using empty settings" and runs on
    // its 0.0.0.0 default). Silently passing here would hide a likely-open
    // server -- caught against a real signalk-server instance, not a fixture.
    const snapshot = fixture('readonly-open-network')
    snapshot.server.settings = null
    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.title).toMatch(/binding unknown/)
  })

  it('treats a missing listen address as open (0.0.0.0 default) and flags it', () => {
    const snapshot = fixture('readonly-open-network')
    delete (snapshot.server.settings as Record<string, unknown>).server
    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('readonly-open-network')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
