import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fallbackIsPrimary } from '../../src/rules/fallback-is-primary.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

type FixedPositionConfig = {
  enabled: boolean
  configuration: { position?: unknown }
}

function fixedPositionOf(snapshot: Snapshot): FixedPositionConfig {
  const plugins = snapshot.server.pluginConfig as Record<
    string,
    FixedPositionConfig
  >
  return plugins['signalk-fixed-position']
}

function settingsOf(snapshot: Snapshot): Record<string, unknown> {
  return snapshot.server.settings as Record<string, unknown>
}

const rule = fallbackIsPrimary

describe('plugin/fallback-is-primary', () => {
  it('flags the conjunction: plugin enabled and no NMEA input', () => {
    const findings = rule.evaluate(fixture('fallback-is-primary'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toMatch(/only source of position/)
  })

  it('does NOT fire when a real NMEA input is configured', () => {
    // The whole point of the rule. With a live NMEA 2000 bus the plugin is
    // doing its intended job -- holding the last fix across a GPS dropout --
    // and firing here would flag the correct configuration.
    expect(rule.evaluate(fixture('n2k-input-configured'))).toEqual([])
  })

  it('does not fire on an NMEA 0183 input either', () => {
    const snapshot = fixture('fallback-is-primary')
    settingsOf(snapshot).pipedProviders = [
      {
        id: 'gps-serial',
        enabled: true,
        pipeElements: [
          {
            type: 'providers/simple',
            options: {
              type: 'NMEA0183',
              subOptions: {
                type: 'serial',
                device: '/dev/serial/by-id/usb-gps',
                baudrate: 4800
              }
            }
          }
        ]
      }
    ]
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('cites the plugin, the stored coordinate, and what connections exist', () => {
    const findings = rule.evaluate(fixture('fallback-is-primary'))
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'server.pluginConfig.signalk-fixed-position.enabled',
        value: true,
        file: 'plugin-config-data/signalk-fixed-position.json'
      },
      {
        path: 'server.pluginConfig.signalk-fixed-position.configuration.position',
        value: { latitude: 47.6, longitude: -122.4 },
        file: 'plugin-config-data/signalk-fixed-position.json'
      },
      {
        path: 'server.settings.pipedProviders',
        value: [],
        file: 'settings.json'
      }
    ])
    expect(findings[0]?.detail).toMatch(/currently 47\.6, -122\.4/)
  })

  it('fires when the only NMEA connection is switched off, and says so', () => {
    // A saved-but-disabled connection feeds nothing, so the fallback is still
    // the only source -- but the reader needs to see that the connection
    // exists, or the finding reads as though none was ever configured.
    const snapshot = fixture('n2k-input-configured')
    const providers = settingsOf(snapshot).pipedProviders as {
      enabled: boolean
    }[]
    providers[0].enabled = false

    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.detail).toMatch(/"n2k-can0".*switched off/s)
    expect(findings[0]?.evidence[2]?.value).toEqual([
      { id: 'n2k-can0', enabled: false, protocols: ['NMEA2000'] }
    ])
  })

  it('fires when the only connection is a non-NMEA one', () => {
    const snapshot = fixture('fallback-is-primary')
    settingsOf(snapshot).pipedProviders = [
      {
        id: 'playback',
        enabled: true,
        pipeElements: [
          { type: 'providers/simple', options: { type: 'FileStream' } }
        ]
      }
    ]
    expect(rule.evaluate(snapshot)).toHaveLength(1)
  })

  it('does not fire when the plugin is disabled', () => {
    const snapshot = fixture('fallback-is-primary')
    fixedPositionOf(snapshot).enabled = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when the plugin is not installed', () => {
    const snapshot = fixture('fallback-is-primary')
    snapshot.server.pluginConfig = {}
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when pluginConfig is absent entirely', () => {
    const snapshot = fixture('fallback-is-primary')
    snapshot.server.pluginConfig = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when settings.json is missing', () => {
    // Half the conjunction is unknown, so there is no conjunction to report.
    const snapshot = fixture('fallback-is-primary')
    snapshot.server.settings = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('handles a missing stored position without inventing one', () => {
    const snapshot = fixture('fallback-is-primary')
    delete fixedPositionOf(snapshot).configuration.position

    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence[1]?.value).toBeNull()
    expect(findings[0]?.detail).not.toMatch(/currently/)
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('fallback-is-primary')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
