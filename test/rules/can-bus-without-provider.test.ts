import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canBusWithoutProvider } from '../../src/rules/can-bus-without-provider.js'
import { lint } from '../../src/lint.js'
import { rules } from '../../src/rules/index.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = canBusWithoutProvider

describe('host/can-bus-without-provider', () => {
  it('fires when can0 is up and no connection reads it', () => {
    const findings = rule.evaluate(fixture('host-can0-no-provider'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence[0]?.path).toBe('host.network')
    expect(findings[0]?.evidence[0]?.value).toEqual({
      name: 'can0',
      up: true,
      operstate: 'unknown'
    })
  })

  it('does not fire when an enabled connection reads the interface', () => {
    expect(rule.evaluate(fixture('host-healthy'))).toEqual([])
  })

  it('does not fire when the CAN interface is down', () => {
    const snapshot = fixture('host-can0-no-provider')
    snapshot.host!.network![0]!.up = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire on a non-CAN interface with no provider', () => {
    const snapshot = fixture('host-can0-no-provider')
    snapshot.host!.network = [
      { name: 'eth0', type: 1, up: true, operstate: 'up' }
    ]
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('fires when the only matching provider is disabled', () => {
    const snapshot = fixture('host-healthy')
    const providers = (snapshot.server.settings as Record<string, unknown>)
      .pipedProviders as { enabled: boolean }[]
    providers[0]!.enabled = false
    expect(rule.evaluate(snapshot)).toHaveLength(1)
  })

  it('does not fire when the provider names no interface', () => {
    // Configs written by other hands omit the field; refusing to count the
    // provider would put a false finding on a working boat.
    const snapshot = fixture('host-healthy')
    const providers = (snapshot.server.settings as Record<string, unknown>)
      .pipedProviders as {
      pipeElements: { options: { subOptions: Record<string, unknown> } }[]
    }[]
    delete providers[0]!.pipeElements[0]!.options.subOptions.interface
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('fires when the provider reads a different interface', () => {
    const snapshot = fixture('host-healthy')
    const providers = (snapshot.server.settings as Record<string, unknown>)
      .pipedProviders as {
      pipeElements: { options: { subOptions: Record<string, unknown> } }[]
    }[]
    providers[0]!.pipeElements[0]!.options.subOptions.interface = 'can1'
    expect(rule.evaluate(snapshot)).toHaveLength(1)
  })

  it('does not fire when settings.json is unreadable', () => {
    // The bus being up is real, but "nothing reads it" cannot be asserted
    // about a config the rule could not read.
    const snapshot = fixture('host-can0-no-provider')
    snapshot.server.settings = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('declares the host facts it needs, so absence skips it visibly', () => {
    expect(rule.hostFacts).toEqual(['network'])
    const snapshot = fixture('host-can0-no-provider')
    snapshot.host = null
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([
      { ruleId: rule.id, missing: ['host.network'] }
    ])
  })

  it('survives a garbage snapshot without throwing, as must the whole run', () => {
    const garbage = fixture('host-garbage')
    expect(() => rule.evaluate(garbage)).not.toThrow()
    expect(rule.evaluate(garbage)).toEqual([])
    // The 2026-08-14 failure mode: one malformed entry taking down the whole
    // lint run. The full rule set has to survive this fixture, not just ours.
    expect(() => lint(garbage, {}, rules)).not.toThrow()
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('host-can0-no-provider')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
