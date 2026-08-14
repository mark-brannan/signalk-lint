import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unstableSerialDevicePath } from '../../src/rules/unstable-serial-device-path.js'
import { lint } from '../../src/lint.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = unstableSerialDevicePath

describe('hardware/unstable-serial-device-path', () => {
  it('flags a /dev/ttyUSB* connection', () => {
    const findings = rule.evaluate(fixture('unstable-serial-path'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toContain('/dev/ttyUSB0')
    expect(findings[0]?.evidence[0]?.value).toBe('/dev/ttyUSB0')
  })

  it('does not flag a /dev/serial/by-id/* connection', () => {
    const findings = rule.evaluate(fixture('unstable-serial-path'))
    const flaggedDevices = findings.map((f) => f.evidence[0]?.value)
    expect(flaggedDevices).not.toContain(
      '/dev/serial/by-id/usb-Actisense_NGT-1-if00'
    )
  })

  it('does not flag a clean install with no pipedProviders', () => {
    const findings = rule.evaluate(fixture('current-server'))
    expect(findings).toEqual([])
  })

  it('does not fire when settings.json is absent', () => {
    const snapshot = fixture('unstable-serial-path')
    snapshot.server.settings = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('flags a /dev/ttyACM* connection too', () => {
    const snapshot = fixture('unstable-serial-path')
    const settings = snapshot.server.settings as Record<string, unknown>
    const providers = settings.pipedProviders as Array<{
      pipeElements: Array<{ options?: { device?: string } }>
    }>
    providers[0]!.pipeElements[0]!.options!.device = '/dev/ttyACM0'
    const findings = rule.evaluate(snapshot)
    expect(findings.some((f) => f.title.includes('/dev/ttyACM0'))).toBe(true)
  })

  it('survives malformed pipedProviders', () => {
    const snapshot = fixture('unstable-serial-path')
    const settings = snapshot.server.settings as Record<string, unknown>
    settings.pipedProviders = [null, 'x', { id: 'y', pipeElements: [null] }]
    expect(() => rule.evaluate(snapshot)).not.toThrow()
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('unstable-serial-path')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})

describe('lint() survives a malformed pipedProviders entry', () => {
  // The property that actually matters, and the one a per-rule test cannot
  // pin: lint() evaluates every rule in one pass, so a single rule throwing
  // on a bad entry loses every other rule's findings too. This asserts it at
  // the level the plugin and CLI actually call.
  it('still reports findings from the rules that can be evaluated', () => {
    // vulnerable-server has a genuine advisory finding, which gives this
    // something positive to assert: the advisory rule does not read
    // pipedProviders, so its finding must survive a malformed connection
    // list untouched rather than being lost with the run.
    const snapshot = fixture('vulnerable-server')
    const settings = snapshot.server.settings as Record<string, unknown>
    settings.pipedProviders = [null, 'x', { id: 'y', pipeElements: [null] }]

    expect(() => lint(snapshot)).not.toThrow()
    const { findings } = lint(snapshot)
    expect(
      findings.some((f) => f.ruleId === 'server/known-vulnerability')
    ).toBe(true)
  })
})
