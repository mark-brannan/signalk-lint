/**
 * Rule: host/kiosk-browser-no-display
 *
 * A boat Pi commonly autostarts a browser in kiosk mode to drive an
 * instrument display. When every DRM connector reads "disconnected", that
 * browser is rendering charts nobody can see -- and on the boat this rule
 * comes from, quietly costing a measurable share of CPU and RAM on a
 * machine that also parses the NMEA bus. The display had been rewired away
 * months earlier; the browser never got the memo.
 *
 * Both halves are required, which is what keeps it honest: a kiosk browser
 * with a connected display is the intended setup, and disconnected
 * connectors with no browser are a headless server, both fine.
 *
 * What legitimately looks like this and must not fire outright cannot
 * always be told apart from here, so it is `warn` and named in the finding:
 * a display that is switched off or temporarily unplugged at capture time,
 * and a VNC-only setup where the browser is viewed remotely with nothing on
 * HDMI. When there are no DRM connectors at all ([]), the rule stays
 * silent -- that is a machine with no display hardware exposed, not
 * evidence anyone forgot one.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { autostartOf, drmOf } from './host-facts.js'

/** Browsers seen driving boat kiosks. A wrapper script hides the browser
 * from this list and fails toward silence, like every list in this batch. */
const BROWSER =
  /(?:^|[\s@=/"'])(chromium-browser|chromium|firefox-esr|firefox|epiphany|midori|falkon|surf|luakit)(?=$|[\s"'])/

export const kioskBrowserNoDisplay: Rule = {
  id: 'host/kiosk-browser-no-display',
  description:
    'A browser autostarts for a kiosk display, but every display connector is disconnected',
  defaultSeverity: 'warn',
  provenance: 'opinion',
  hostFacts: ['autostart', 'drm'],

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const autostart = autostartOf(snapshot)
    const drm = drmOf(snapshot)
    if (autostart === null || drm === null) return []

    // No connectors is not the same fact as all-disconnected: nothing here
    // says a display was ever meant to exist.
    if (drm.length === 0) return []
    if (!drm.every((connector) => connector.status === 'disconnected')) {
      return []
    }

    const findings: RuleFinding[] = []
    for (const file of autostart) {
      for (const [index, raw] of file.lines.entries()) {
        const line = raw.trim()
        if (line === '' || line.startsWith('#')) continue
        const match = BROWSER.exec(line)
        if (match === null) continue

        findings.push({
          title: `${match[1]} autostarts, but no display is connected`,
          detail:
            `${file.file} starts ${match[1]} at login, but every display ` +
            'connector on this machine read "disconnected" at capture time. ' +
            'The browser is rendering to a display nobody can see, and on a ' +
            'small boat computer that is real CPU and memory taken from the ' +
            'server actually doing the work. If the display is simply ' +
            'switched off, temporarily unplugged, or you view this browser ' +
            'over VNC, this is expected -- otherwise the kiosk has outlived ' +
            'its screen and can be removed from autostart.',
          evidence: [
            {
              path: 'host.autostart',
              value: { file: file.file, line: index + 1, text: line }
            },
            {
              path: 'host.drm',
              value: drm
            }
          ],
          remediation: {
            kind: 'manual',
            description:
              `Remove or comment the ${match[1]} line in ${file.file} if the ` +
              'kiosk display is gone for good, or reconnect the display if ' +
              'it is not.'
          }
        })
      }
    }
    return findings
  }
}
