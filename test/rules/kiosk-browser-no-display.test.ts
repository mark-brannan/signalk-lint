import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { kioskBrowserNoDisplay } from '../../src/rules/kiosk-browser-no-display.js'
import { lint } from '../../src/lint.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = kioskBrowserNoDisplay

describe('host/kiosk-browser-no-display', () => {
  it('fires when a browser autostarts and every connector is disconnected', () => {
    const findings = rule.evaluate(fixture('host-faulty'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence[0]?.value).toEqual({
      file: '/etc/xdg/lxsession/LXDE-pi/autostart',
      line: 2,
      text: '@chromium-browser --kiosk http://localhost:3000/@signalk/instrumentpanel/'
    })
  })

  it('does not fire while any connector is connected', () => {
    expect(rule.evaluate(fixture('host-healthy'))).toEqual([])
  })

  it('does not fire with no browser in autostart', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.autostart = [
      {
        file: '/etc/xdg/lxsession/LXDE-pi/autostart',
        lines: ['@lxpanel --profile LXDE-pi']
      }
    ]
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('stays silent when the machine exposes no DRM connectors at all', () => {
    // [] is "no display hardware", not "a display went missing".
    const snapshot = fixture('host-faulty')
    snapshot.host!.drm = []
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('finds a browser in a .desktop Exec line too', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.autostart = [
      {
        file: '/home/pi/.config/autostart/kiosk.desktop',
        lines: ['[Desktop Entry]', 'Exec=chromium-browser --kiosk']
      }
    ]
    expect(rule.evaluate(snapshot)).toHaveLength(1)
  })

  it('does not match a browser name inside a longer word or URL host', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.autostart = [
      {
        file: '/etc/xdg/lxsession/LXDE-pi/autostart',
        lines: ['@surfacetool --daemon', '# firefox is not started here']
      }
    ]
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('declares both fact groups, and either being absent skips it', () => {
    expect(rule.hostFacts).toEqual(['autostart', 'drm'])
    const snapshot = fixture('host-faulty')
    snapshot.host!.drm = null
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([
      { ruleId: rule.id, missing: ['host.drm'] }
    ])
  })

  it('survives a garbage snapshot without throwing', () => {
    const garbage = fixture('host-garbage')
    expect(() => rule.evaluate(garbage)).not.toThrow()
    expect(rule.evaluate(garbage)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('host-faulty')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
