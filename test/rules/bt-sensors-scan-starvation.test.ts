import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { btSensorsScanStarvation } from '../../src/rules/bt-sensors-scan-starvation.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

type BtConfig = {
  enabled: boolean
  configuration: { discoveryInterval?: unknown; discoveryTimeout?: unknown }
}

function btConfigOf(snapshot: Snapshot): BtConfig {
  const plugins = snapshot.server.pluginConfig as Record<string, BtConfig>
  return plugins['bt-sensors-plugin-sk']
}

const rule = btSensorsScanStarvation

describe('plugin/bt-sensors-scan-starvation', () => {
  it('flags an interval shorter than the discovery timeout', () => {
    const findings = rule.evaluate(fixture('bt-sensors-scan-starvation'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.remediation?.currentValue).toBe(10)
    expect(findings[0]?.remediation?.proposedValue).toBe(0)
  })

  it('cites the real interval and timeout it fired on', () => {
    const findings = rule.evaluate(fixture('bt-sensors-scan-starvation'))
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'server.pluginConfig.bt-sensors-plugin-sk.configuration.discoveryInterval',
        value: 10,
        file: 'plugin-config-data/bt-sensors-plugin-sk.json'
      },
      {
        path: 'server.pluginConfig.bt-sensors-plugin-sk.configuration.discoveryTimeout',
        value: 30,
        file: 'plugin-config-data/bt-sensors-plugin-sk.json'
      }
    ])
  })

  it('does not fire on interval 0, which turns rescanning off', () => {
    // The healthy configuration on a boat whose peripherals are all pinned by
    // MAC address. The plugin gates its loop on a truthy interval, so 0 never
    // starts one -- firing here would flag the fix as the bug.
    expect(rule.evaluate(fixture('bt-sensors-discovery-off'))).toEqual([])
  })

  // Both ends of the range collapse to the same runtime behaviour: the loop
  // starts, and setInterval replaces an out-of-range delay with 1ms. Measured:
  // setInterval(fn, -5000) fires ~45 times in 50ms, and a delay above
  // 2147483647ms reports _idleTimeout 1. Neither is caught by comparing the
  // interval against the timeout, so both have to be decided before that.
  it.each([
    ['negative', -1],
    ['negative and larger in magnitude than the timeout', -60],
    ['above what a 32-bit timer delay can hold', 2_147_484],
    ['far above it, as when someone means "never rescan"', 99_999_999],
    ['a sub-millisecond fraction', 0.0005]
  ])('fires on an interval that is %s', (_label, discoveryInterval) => {
    const snapshot = fixture('bt-sensors-scan-starvation')
    btConfigOf(snapshot).configuration.discoveryInterval = discoveryInterval

    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence[0]).toEqual({
      path: 'server.pluginConfig.bt-sensors-plugin-sk.configuration.discoveryInterval',
      value: discoveryInterval,
      file: 'plugin-config-data/bt-sensors-plugin-sk.json'
    })
    expect(findings[0]?.remediation?.currentValue).toBe(discoveryInterval)
    expect(findings[0]?.remediation?.proposedValue).toBe(0)
  })

  it('does not fire at the largest interval a timer can actually hold', () => {
    // 2147483s * 1000 is exactly representable, so the timer honours it and
    // the plugin really does scan once every ~24.8 days. Pointless, but not
    // this rule's failure -- the boundary has to sit where the clamp does.
    const snapshot = fixture('bt-sensors-scan-starvation')
    btConfigOf(snapshot).configuration.discoveryInterval = 2_147_483
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when the interval is longer than the timeout', () => {
    const snapshot = fixture('bt-sensors-scan-starvation')
    btConfigOf(snapshot).configuration.discoveryInterval = 60
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when interval and timeout are equal', () => {
    const snapshot = fixture('bt-sensors-scan-starvation')
    btConfigOf(snapshot).configuration.discoveryInterval = 30
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it("fires on the plugin's own defaults when neither key is set", () => {
    // discoveryInterval 10 / discoveryTimeout 30 are the plugin's schema
    // defaults, and it fills them in when the keys are absent -- so a stock
    // install is already in this state.
    const snapshot = fixture('bt-sensors-scan-starvation')
    const config = btConfigOf(snapshot).configuration
    delete config.discoveryInterval
    delete config.discoveryTimeout

    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    // Evidence reports what was actually in the file, not the effective value.
    expect(findings[0]?.evidence[0]?.value).toBeNull()
    expect(findings[0]?.evidence[1]?.value).toBeNull()
    // The remediation still carries the effective interval, so the finding is
    // actionable even though nothing was written to point at.
    expect(findings[0]?.remediation?.currentValue).toBeNull()
  })

  it('does not fire when the plugin is disabled', () => {
    const snapshot = fixture('bt-sensors-scan-starvation')
    btConfigOf(snapshot).enabled = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when the plugin is not installed', () => {
    const snapshot = fixture('bt-sensors-scan-starvation')
    snapshot.server.pluginConfig = {}
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when pluginConfig is absent entirely', () => {
    const snapshot = fixture('bt-sensors-scan-starvation')
    snapshot.server.pluginConfig = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('bt-sensors-scan-starvation')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
