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
    expect(findings[0]?.title).toMatch(/every 10s but takes 30s/)
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
    expect(findings[0]?.title).toMatch(/every 10s but takes 30s/)
    // Evidence reports what was actually in the file, not the effective value.
    expect(findings[0]?.evidence[0]?.value).toBeNull()
    expect(findings[0]?.evidence[1]?.value).toBeNull()
    expect(findings[0]?.detail).toMatch(/fills in\s+its own defaults/)
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
