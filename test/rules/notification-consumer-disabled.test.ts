import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { notificationConsumerDisabled } from '../../src/rules/notification-consumer-disabled.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

type PluginEntry = {
  enabled?: unknown
  configuration?: Record<string, unknown>
}

function pluginsOf(snapshot: Snapshot): Record<string, PluginEntry> {
  return snapshot.server.pluginConfig as Record<string, PluginEntry>
}

const rule = notificationConsumerDisabled

describe('plugin/notification-consumer-disabled', () => {
  it('fires when every installed consumer is switched off', () => {
    const findings = rule.evaluate(fixture('notification-consumers-disabled'))
    expect(findings).toHaveLength(1)
  })

  it('cites the disabled consumers and the producer still raising alarms', () => {
    const findings = rule.evaluate(fixture('notification-consumers-disabled'))
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'server.pluginConfig.signalk-notification-player.enabled',
        value: false,
        file: 'plugin-config-data/signalk-notification-player.json'
      },
      {
        path: 'server.pluginConfig.signalk-gpio-beeper-plugin.enabled',
        value: false,
        file: 'plugin-config-data/signalk-gpio-beeper-plugin.json'
      },
      {
        path: 'server.pluginConfig.signalk-doctor.configuration.publishNotifications',
        value: true,
        file: 'plugin-config-data/signalk-doctor.json'
      }
    ])
  })

  it('points remediation at a consumer, not at the producer', () => {
    const findings = rule.evaluate(fixture('notification-consumers-disabled'))
    expect(findings[0]?.remediation?.target).toBe(
      'pluginConfig.signalk-notification-player.enabled'
    )
    expect(findings[0]?.remediation?.proposedValue).toBe(true)
  })

  // The configuration that must not fire: this is the real boat this rule was
  // written against. A producer is raising notifications and one consumer is
  // switched off -- but another consumer is enabled, so the boat is covered
  // and the disabled one is simply no longer in use.
  it('does not fire when another consumer is still enabled', () => {
    expect(rule.evaluate(fixture('notification-player-enabled'))).toEqual([])
  })

  it('does not fire when no consumer was ever installed', () => {
    // Absence is not evidence: notifications are consumed over the websocket
    // by clients no snapshot can see. Only an installed-then-disabled consumer
    // is a state someone changed.
    const snapshot = fixture('notification-consumers-disabled')
    const plugins = pluginsOf(snapshot)
    delete plugins['signalk-notification-player']
    delete plugins['signalk-gpio-beeper-plugin']
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when nothing is raising notifications', () => {
    const snapshot = fixture('notification-consumers-disabled')
    pluginsOf(snapshot)['signalk-doctor'].configuration!.publishNotifications =
      false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when the producing plugin itself is disabled', () => {
    const snapshot = fixture('notification-consumers-disabled')
    pluginsOf(snapshot)['signalk-doctor'].enabled = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('recognises signalk-healthcheck host notifications as a producer', () => {
    const snapshot = fixture('notification-consumers-disabled')
    const plugins = pluginsOf(snapshot)
    plugins['signalk-doctor'].enabled = false
    plugins['signalk-healthcheck'] = {
      enabled: true,
      configuration: { host: { enabled: true, sendNotification: true } }
    }

    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toContainEqual({
      path: 'server.pluginConfig.signalk-healthcheck.configuration.host.sendNotification',
      value: true,
      file: 'plugin-config-data/signalk-healthcheck.json'
    })
  })

  it('recognises signalk-healthcheck provider notifications as a producer', () => {
    const snapshot = fixture('notification-consumers-disabled')
    const plugins = pluginsOf(snapshot)
    plugins['signalk-doctor'].enabled = false
    plugins['signalk-healthcheck'] = {
      enabled: true,
      configuration: {
        host: { enabled: true, sendNotification: false },
        providers: {
          'OpenPlotter GPSD': { enabled: true, sendNotification: true }
        }
      }
    }

    const findings = rule.evaluate(snapshot)
    expect(findings[0]?.evidence).toContainEqual({
      path: 'server.pluginConfig.signalk-healthcheck.configuration.providers.OpenPlotter GPSD.sendNotification',
      value: true,
      file: 'plugin-config-data/signalk-healthcheck.json'
    })
  })

  it('does not fire on a healthcheck path whose own check is switched off', () => {
    const snapshot = fixture('notification-consumers-disabled')
    const plugins = pluginsOf(snapshot)
    plugins['signalk-doctor'].enabled = false
    plugins['signalk-healthcheck'] = {
      enabled: true,
      configuration: { host: { enabled: false, sendNotification: true } }
    }
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when pluginConfig is absent entirely', () => {
    // An older capture, or a config directory with no plugin-config-data/.
    // Nothing is known about producers or consumers, so there is no claim to
    // make -- and this rule's claim is about a state someone changed, which an
    // absent directory is not evidence of either way.
    const snapshot = fixture('notification-consumers-disabled')
    snapshot.server.pluginConfig = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('ignores a malformed plugin entry rather than throwing', () => {
    const snapshot = fixture('notification-consumers-disabled')
    const plugins = snapshot.server.pluginConfig as Record<string, unknown>
    plugins['signalk-notification-player'] = 'not an object'
    plugins['signalk-gpio-beeper-plugin'] = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('notification-consumers-disabled')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
