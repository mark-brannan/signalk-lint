import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { alarmPathDead } from '../../src/rules/alarm-path-dead.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

type AlertPath = { enabled?: unknown; sendEmail?: unknown; toEmail?: unknown }
type HealthcheckConfig = {
  enabled: boolean
  configuration: {
    host: AlertPath
    providers: Record<string, AlertPath>
    mail: Record<string, unknown>
  }
}

function healthcheckOf(snapshot: Snapshot): HealthcheckConfig {
  const plugins = snapshot.server.pluginConfig as Record<
    string,
    HealthcheckConfig
  >
  return plugins['signalk-healthcheck']
}

const rule = alarmPathDead

describe('plugin/alarm-path-dead', () => {
  it('flags email alerts enabled with no SMTP host', () => {
    const findings = rule.evaluate(fixture('healthcheck-mail-no-host'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toMatch(/no mail server configured/)
  })

  it('cites the missing host and the alerting path that depends on it', () => {
    const findings = rule.evaluate(fixture('healthcheck-mail-no-host'))
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'server.pluginConfig.signalk-healthcheck.configuration.mail.host',
        value: null,
        file: 'plugin-config-data/signalk-healthcheck.json'
      },
      {
        path: 'server.pluginConfig.signalk-healthcheck.configuration.host.sendEmail',
        value: true,
        file: 'plugin-config-data/signalk-healthcheck.json'
      }
    ])
  })

  it('does not fire once a mail host is configured', () => {
    expect(rule.evaluate(fixture('healthcheck-mail-configured'))).toEqual([])
  })

  it('does not fire when nothing is set to send email', () => {
    // The plugin is enabled and checking, but only raising Signal K
    // notifications. There is no delivery path, so there is none to be broken.
    const snapshot = fixture('healthcheck-mail-no-host')
    healthcheckOf(snapshot).configuration.host.sendEmail = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when the alerting path is switched off', () => {
    const snapshot = fixture('healthcheck-mail-no-host')
    healthcheckOf(snapshot).configuration.host.enabled = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('treats a blank host as no host', () => {
    const snapshot = fixture('healthcheck-mail-configured')
    healthcheckOf(snapshot).configuration.mail.host = '   '
    expect(rule.evaluate(snapshot)).toHaveLength(1)
  })

  it('flags a live path with no recipient address', () => {
    const snapshot = fixture('healthcheck-mail-configured')
    delete healthcheckOf(snapshot).configuration.host.toEmail

    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toMatch(/no recipient address/)
    expect(findings[0]?.evidence[0]).toEqual({
      path: 'server.pluginConfig.signalk-healthcheck.configuration.host.toEmail',
      value: null,
      file: 'plugin-config-data/signalk-healthcheck.json'
    })
  })

  it('covers provider alerting paths, not just host checks', () => {
    const snapshot = fixture('healthcheck-mail-configured')
    const providers = healthcheckOf(snapshot).configuration.providers
    providers['OpenPlotter GPSD'].sendEmail = true

    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toMatch(/OpenPlotter GPSD/)
    expect(findings[0]?.evidence[0]?.path).toBe(
      'server.pluginConfig.signalk-healthcheck.configuration.providers.OpenPlotter GPSD.toEmail'
    )
  })

  it('reports the shared transport once, not once per alerting path', () => {
    // Both paths break for the same reason. Emitting two findings would be
    // the same defect counted twice.
    const snapshot = fixture('healthcheck-mail-no-host')
    const providers = healthcheckOf(snapshot).configuration.providers
    providers['OpenPlotter GPSD'].sendEmail = true
    providers['OpenPlotter GPSD'].toEmail = 'skipper@example.com'

    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.detail).toMatch(/OpenPlotter GPSD/)
  })

  it('does not fire when the plugin is disabled', () => {
    const snapshot = fixture('healthcheck-mail-no-host')
    healthcheckOf(snapshot).enabled = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when the plugin is not installed', () => {
    const snapshot = fixture('healthcheck-mail-no-host')
    snapshot.server.pluginConfig = {}
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when pluginConfig is absent entirely', () => {
    const snapshot = fixture('healthcheck-mail-no-host')
    snapshot.server.pluginConfig = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('healthcheck-mail-no-host')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
