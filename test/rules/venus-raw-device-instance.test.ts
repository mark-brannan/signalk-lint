import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { venusRawDeviceInstance } from '../../src/rules/venus-raw-device-instance.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = venusRawDeviceInstance

describe('plugin/venus-raw-device-instance', () => {
  it('flags useDeviceNames false with no instanceMappings', () => {
    const findings = rule.evaluate(fixture('venus-raw-instance'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toMatch(/raw instance numbers/)
  })

  it('does not flag when useDeviceNames is true', () => {
    const findings = rule.evaluate(fixture('datetime-nonstandard-path'))
    expect(findings).toEqual([])
  })

  it('does not flag when instanceMappings has entries', () => {
    const snapshot = fixture('venus-raw-instance')
    const plugins = snapshot.server.pluginConfig as Record<
      string,
      { configuration: { instanceMappings: unknown[] } }
    >
    plugins.venus.configuration.instanceMappings = [
      { venusId: 279, signalkId: 'house' }
    ]
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not flag when the venus plugin is not installed', () => {
    const snapshot = fixture('venus-raw-instance')
    snapshot.server.pluginConfig = { 'signalk-datetime': { enabled: true } }
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not flag when the venus plugin is disabled', () => {
    const snapshot = fixture('venus-raw-instance')
    const plugins = snapshot.server.pluginConfig as Record<
      string,
      { enabled: boolean }
    >
    plugins.venus.enabled = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when pluginConfig is absent entirely', () => {
    const snapshot = fixture('venus-raw-instance')
    snapshot.server.pluginConfig = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('venus-raw-instance')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
