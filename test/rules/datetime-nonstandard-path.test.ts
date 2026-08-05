import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { datetimeNonstandardPath } from '../../src/rules/datetime-nonstandard-path.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = datetimeNonstandardPath

describe('plugin/datetime-nonstandard-path', () => {
  it('flags an explicit environment.time path', () => {
    const findings = rule.evaluate(fixture('datetime-nonstandard-path'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence[0]?.value).toBe('environment.time')
  })

  it('flags a missing path option the same as the plugin default', () => {
    const snapshot = fixture('datetime-nonstandard-path')
    const plugins = snapshot.server.pluginConfig as Record<
      string,
      { configuration: Record<string, unknown> }
    >
    delete plugins['signalk-datetime']!.configuration.path
    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence[0]?.value).toBe('environment.time')
  })

  it('does not flag navigation.datetime', () => {
    const findings = rule.evaluate(fixture('venus-raw-instance'))
    expect(findings).toEqual([])
  })

  it('does not flag when signalk-datetime is not installed', () => {
    const snapshot = fixture('datetime-nonstandard-path')
    snapshot.server.pluginConfig = { venus: { enabled: true } }
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not flag when signalk-datetime is disabled', () => {
    const snapshot = fixture('datetime-nonstandard-path')
    const plugins = snapshot.server.pluginConfig as Record<
      string,
      { enabled: boolean }
    >
    plugins['signalk-datetime']!.enabled = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when pluginConfig is absent entirely', () => {
    const snapshot = fixture('datetime-nonstandard-path')
    snapshot.server.pluginConfig = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('datetime-nonstandard-path')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
