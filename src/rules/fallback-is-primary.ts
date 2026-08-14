/**
 * Rule: plugin/fallback-is-primary
 *
 * signalk-fixed-position (plugin id "signalk-fixed-position", shown as "Fixed
 * Position") remembers the last position it saw and re-emits it on a timer
 * when the real fix stops arriving. Verified against the plugin's own
 * index.js: it subscribes to `navigation.position`, saves each value into
 * `options.position`, and every `interval` seconds re-emits the saved
 * coordinate under `navigation.position` if nothing fresher has arrived.
 *
 * That is correct behaviour and people run it on purpose — a plotter or a
 * logger that drops out when GPS blinks is worse than one that holds the last
 * known fix for a few seconds.
 *
 * The failure is the conjunction, not the plugin. With a real NMEA input
 * feeding position, this is a fallback: it fills gaps and gets corrected the
 * moment the fix returns. With no NMEA input configured at all, nothing ever
 * corrects it, and the fallback quietly becomes the only source of position
 * on the boat. Signal K then has a position — continuously, confidently, at a
 * steady update rate — and it is a stored constant. Every check that asks "is
 * there a position?" answers yes. On the boat this rule comes from, that was
 * a dock coordinate roughly two metres off the true berth, served for months.
 * Two metres is the part that makes it dangerous: an obviously wrong position
 * gets noticed, a plausible one does not.
 *
 * "Real input" here means an enabled NMEA 0183 or NMEA 2000 connection. A
 * connection that exists but is switched off feeds nothing, so it does not
 * count — but the finding says which connections it saw and what state they
 * were in, so the reader can tell those two cases apart.
 *
 * Known limit, stated rather than papered over: an upstream Signal K server
 * (`options.type: "SignalK"`) can also carry a real position, and this rule
 * does not count it as an input. On an install fed that way the finding is a
 * false positive; its evidence lists the connections it saw, which is what
 * makes that visible instead of merely wrong.
 *
 * Provenance: opinion. The mechanism is verified fact; the judgement that
 * this conjunction is a problem is ours, and there is a real configuration it
 * gets wrong — a permanently moored vessel or a shore station deliberately
 * publishing a fixed coordinate with no instruments attached. Those installs
 * should turn this rule off.
 */
import { Evidence, Rule, RuleFinding, Snapshot } from '../types.js'
import {
  describeProvider,
  isNmeaInput,
  nmeaProtocolsOf,
  pipedProvidersOf
} from './piped-providers.js'

const PLUGIN_ID = 'signalk-fixed-position'
const CONFIG_FILE = `plugin-config-data/${PLUGIN_ID}.json`

interface FixedPositionPluginConfig {
  enabled?: boolean
  configuration?: {
    interval?: unknown
    position?: { latitude?: unknown; longitude?: unknown }
  }
}

export const fallbackIsPrimary: Rule = {
  id: 'plugin/fallback-is-primary',
  description:
    'signalk-fixed-position is enabled with no NMEA input configured, so a stored position is the only position',
  defaultSeverity: 'error',
  provenance: 'opinion',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const plugins = snapshot.server.pluginConfig
    if (plugins === null) return []

    const plugin = plugins[PLUGIN_ID] as FixedPositionPluginConfig | undefined
    if (plugin === undefined || plugin.enabled !== true) return []

    const providers = pipedProvidersOf(snapshot)
    // settings.json missing, or pipedProviders malformed. Half the
    // conjunction is unknown, so there is no conjunction to report.
    if (providers === null) return []

    // The other half: a real input exists, which is the configuration this
    // plugin is designed for. Not a finding.
    if (providers.some(isNmeaInput)) return []

    const described = providers.map(describeProvider)
    // Distinguish "no NMEA connection exists" from "one exists, switched off".
    const disabledNmea = providers.filter(
      (provider) =>
        provider.enabled === false && nmeaProtocolsOf(provider).length > 0
    )

    const disabledNote =
      disabledNmea.length > 0
        ? ' There is an NMEA connection saved — ' +
          disabledNmea
            .map((provider) => `"${provider.id ?? '(unnamed connection)'}"`)
            .join(', ') +
          ' — but it is switched off, so it feeds nothing and does not ' +
          'change this.'
        : ''

    const position = plugin.configuration?.position
    const evidence: Evidence[] = [
      {
        path: `server.pluginConfig.${PLUGIN_ID}.enabled`,
        value: true,
        file: CONFIG_FILE
      },
      {
        path: `server.pluginConfig.${PLUGIN_ID}.configuration.position`,
        value: position ?? null,
        file: CONFIG_FILE
      },
      {
        path: 'server.settings.pipedProviders',
        value: described,
        file: 'settings.json'
      }
    ]

    const storedPosition =
      typeof position?.latitude === 'number' &&
      typeof position?.longitude === 'number'
        ? `${position.latitude}, ${position.longitude}`
        : null

    return [
      {
        title:
          'A stored position is the only source of position on this vessel',
        detail:
          'signalk-fixed-position is enabled, and there is no enabled NMEA ' +
          '0183 or NMEA 2000 connection for a real fix to arrive on.' +
          disabledNote +
          ' The plugin re-emits the last position it saw whenever a fresh ' +
          'one has not arrived, which is what it is for — but with no real ' +
          'source, nothing ever arrives, so it re-emits the same stored ' +
          'coordinate forever' +
          (storedPosition === null ? '' : `, currently ${storedPosition}`) +
          '. Signal K therefore reports a position continuously and at a ' +
          'steady update rate, and it is a constant. Anything that asks ' +
          'whether there is a position — an anchor alarm, a logbook, a ' +
          'chartplotter, AIS, a shore dashboard — gets yes, and gets a ' +
          'number that looks entirely reasonable. This is not the plugin ' +
          'misbehaving; it is a fallback with nothing to fall back from.',
        evidence,
        remediation: {
          kind: 'manual',
          description:
            'Add the real position source under Server → Data Connections ' +
            '(an NMEA 2000 connection for a CAN bus, or NMEA 0183 for a ' +
            'serial GPS) and confirm navigation.position updates in Server → ' +
            'Data Browser with a source that is not signalk-fixed-position. ' +
            'If this install genuinely has no instruments — a permanently ' +
            'moored vessel or a shore station publishing a fixed coordinate ' +
            'on purpose — then this is your intended setup, and the rule ' +
            'should be turned off rather than worked around: set ' +
            '"plugin/fallback-is-primary": "off" in the lint config.'
        }
      }
    ]
  }
}
