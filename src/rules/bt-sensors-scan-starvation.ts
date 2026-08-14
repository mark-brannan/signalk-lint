/**
 * Rule: plugin/bt-sensors-scan-starvation
 *
 * bt-sensors-plugin-sk (plugin id "bt-sensors-plugin-sk") rescans for new
 * Bluetooth devices on a timer. Verified against the plugin's own index.js:
 *
 *   findDeviceLoop(discoveryTimeout, discoveryInterval) {
 *     setInterval(findDevices, discoveryInterval * 1000, discoveryTimeout)
 *   }
 *
 * `discoveryTimeout` is how long one scan runs; `discoveryInterval` is how
 * often a scan is started. Nothing checks that one scan finished before the
 * next begins. Set the interval shorter than the timeout and a new scan is
 * kicked off on top of one already running, so the adapter never leaves
 * discovery -- and an adapter stuck in discovery drops connection attempts to
 * already-known peripherals, which surfaces as `le-connection-abort-by-local`
 * in the logs rather than as anything naming discovery. On the boat this rule
 * comes from, interval 10 against timeout 30 left both house battery BMSes
 * unreachable for weeks while the plugin reported itself as started.
 *
 * `discoveryInterval: 0` disables new-device scanning entirely -- the plugin
 * gates the loop on `if (options.discoveryInterval && !discoveryIntervalID)`,
 * so 0 never starts it. That is the correct configuration once every
 * peripheral is pinned by MAC address, and this rule must not fire on it.
 *
 * Note that the same guard is a truthiness check, not a positivity check, so
 * a negative interval starts the loop and setInterval clamps the delay to
 * 1ms. Only 0 is off; negatives are the worst case, not a quieter one.
 *
 * Note the plugin's schema defaults: discoveryInterval 10, discoveryTimeout
 * 30. Those defaults are themselves the starving combination, and the plugin
 * fills them in when the keys are absent, so this fires on a stock install.
 * That is deliberate -- as with plugin/venus-raw-device-instance, the finding
 * is about the shipped default, not about something the owner got wrong.
 *
 * Provenance: convention. Not in the Signal K spec -- specific, verified
 * knowledge of one plugin's scan loop.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'

const PLUGIN_ID = 'bt-sensors-plugin-sk'
const CONFIG_FILE = `plugin-config-data/${PLUGIN_ID}.json`

/** From the plugin's own schema. Applied when a key is absent, as it is. */
const DEFAULT_DISCOVERY_INTERVAL = 10
const DEFAULT_DISCOVERY_TIMEOUT = 30

interface BtSensorsPluginConfig {
  enabled?: boolean
  configuration?: {
    discoveryInterval?: unknown
    discoveryTimeout?: unknown
  }
}

/** The value the plugin will actually run with, and whether it was written. */
function effective(
  observed: unknown,
  fallback: number
): { value: number; explicit: boolean } {
  return typeof observed === 'number' && Number.isFinite(observed)
    ? { value: observed, explicit: true }
    : { value: fallback, explicit: false }
}

export const btSensorsScanStarvation: Rule = {
  id: 'plugin/bt-sensors-scan-starvation',
  description:
    'bt-sensors-plugin-sk restarts its Bluetooth scan before the previous one finishes, so peripherals never connect',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const plugins = snapshot.server.pluginConfig
    if (plugins === null) return []

    const plugin = plugins[PLUGIN_ID] as BtSensorsPluginConfig | undefined
    if (plugin === undefined || plugin.enabled !== true) return []

    const config = plugin.configuration ?? {}
    const interval = effective(
      config.discoveryInterval,
      DEFAULT_DISCOVERY_INTERVAL
    )
    const timeout = effective(
      config.discoveryTimeout,
      DEFAULT_DISCOVERY_TIMEOUT
    )

    // Exactly 0 means the rescan loop never starts -- the plugin's guard is
    // `if (options.discoveryInterval && !discoveryIntervalID)`. This is the
    // healthy configuration for an install whose peripherals are all pinned
    // by MAC address, and it is the whole reason this rule checks the value
    // rather than just comparing the two numbers.
    if (interval.value === 0) return []

    // A negative interval is the pathological case, and it is NOT caught by
    // comparing the two numbers -- it has to be handled before that. The
    // plugin's guard is a truthiness check, and -1 is truthy, so the loop
    // starts; setInterval then clamps any delay below 1 to 1ms. The result is
    // a rescan roughly every millisecond, which is far worse than the case
    // this rule was written for. Treating "not positive" as "off" would have
    // silently passed the single worst configuration the plugin can hold.
    if (interval.value < 0) {
      return [
        {
          title: `Bluetooth scan interval is negative (${interval.value}), so scanning never stops`,
          detail:
            `bt-sensors-plugin-sk has a discovery interval of ` +
            `${interval.value}. The plugin decides whether to start its ` +
            'rescan loop with a truthiness check, and a negative number is ' +
            'truthy, so the loop starts. It then hands that value to ' +
            'setInterval, which clamps any delay below 1 to one millisecond. ' +
            'The adapter is therefore told to begin a new ' +
            `${timeout.value}-second scan roughly a thousand times a second. ` +
            'It never leaves discovery, connections to known peripherals are ' +
            'aborted, and the plugin still reports itself as started. This ' +
            'is the same failure as a too-short interval, at its extreme.',
          evidence: [
            {
              path: `server.pluginConfig.${PLUGIN_ID}.configuration.discoveryInterval`,
              value: interval.value,
              file: CONFIG_FILE
            },
            {
              path: `server.pluginConfig.${PLUGIN_ID}.configuration.discoveryTimeout`,
              value: timeout.explicit ? timeout.value : null,
              file: CONFIG_FILE
            }
          ],
          remediation: {
            kind: 'manual',
            description:
              'Set "Scan for new devices interval" to 0 in Server → Plugin ' +
              'Config → BT Sensors if your peripherals are already ' +
              'configured by MAC address, or to a value longer than the ' +
              `discovery timeout (${timeout.value}s) if you want the plugin ` +
              "to keep finding new devices. The plugin's own config screen " +
              'will not produce a negative value, so this one was almost ' +
              'certainly hand-edited or restored from a bad backup.',
            target: `pluginConfig.${PLUGIN_ID}.configuration.discoveryInterval`,
            currentValue: interval.value,
            proposedValue: 0
          }
        }
      ]
    }

    // Interval >= timeout means each scan completes before the next begins.
    if (interval.value >= timeout.value) return []

    const defaulted = !interval.explicit || !timeout.explicit
    const defaultNote = defaulted
      ? ' Neither value has to be set for this to happen: the plugin fills in ' +
        `its own defaults (interval ${DEFAULT_DISCOVERY_INTERVAL}, timeout ` +
        `${DEFAULT_DISCOVERY_TIMEOUT}) when the keys are absent, and those ` +
        'defaults are themselves this combination.'
      : ''

    return [
      {
        title: `Bluetooth scan restarts every ${interval.value}s but takes ${timeout.value}s to finish`,
        detail:
          `bt-sensors-plugin-sk starts a new device scan every ` +
          `${interval.value} seconds, while each scan runs for ` +
          `${timeout.value} seconds. Because a new scan begins before the ` +
          'previous one ends, the Bluetooth adapter never leaves discovery ' +
          'mode. An adapter stuck in discovery aborts connection attempts to ' +
          'peripherals it already knows about, so sensors stop reporting ' +
          'even though the plugin shows as started and the devices are ' +
          'listed in its config. The give-away in the logs is ' +
          '`le-connection-abort-by-local`, which does not mention discovery ' +
          'at all.' +
          defaultNote,
        evidence: [
          {
            path: `server.pluginConfig.${PLUGIN_ID}.configuration.discoveryInterval`,
            value: interval.explicit ? interval.value : null,
            file: CONFIG_FILE
          },
          {
            path: `server.pluginConfig.${PLUGIN_ID}.configuration.discoveryTimeout`,
            value: timeout.explicit ? timeout.value : null,
            file: CONFIG_FILE
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'In Server → Plugin Config → BT Sensors, set "Scan for new ' +
            'devices interval" to 0 if every peripheral you want is already ' +
            'configured by MAC address -- that turns rescanning off and is ' +
            'the usual answer on a boat with a fixed set of sensors. If you ' +
            'do want the plugin to keep finding new devices, set the ' +
            'interval longer than the discovery timeout ' +
            `(${timeout.value}s) instead.`,
          target: `pluginConfig.${PLUGIN_ID}.configuration.discoveryInterval`,
          currentValue: interval.explicit ? interval.value : null,
          proposedValue: 0
        }
      }
    ]
  }
}
