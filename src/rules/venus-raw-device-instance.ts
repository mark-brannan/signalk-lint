/**
 * Rule: plugin/venus-raw-device-instance
 *
 * signalk-venus-plugin (plugin id "venus") reads Victron's Cerbo/Venus OS
 * device list over D-Bus or MQTT. Verified directly against the plugin's
 * source (dbus-listener.js): unless `useDeviceNames` is on, or an explicit
 * `instanceMappings` entry exists for a specific device, the path segment is
 * Victron's own internal DeviceInstance number -- assigned by Venus OS's
 * device registry, not by Signal K, and not a small sequential index. A
 * fresh install can end up with paths like electrical.batteries.279.
 *
 * The plugin's own schema defaults useDeviceNames to false, so this is the
 * factory behaviour, not a misconfiguration -- most installs hit it unless
 * someone finds the toggle.
 *
 * This is the first rule conditional on a specific third-party plugin's
 * config, not on signalk-server itself. Same read-only, config-file-only
 * architecture as every other rule; the difference is the maintenance
 * surface -- this breaks if the venus plugin changes its config shape in a
 * future release, which we don't control the way we control our own reading
 * of settings.json.
 *
 * Provenance: convention. Not in the Signal K spec -- specific, verified
 * knowledge of one plugin's default behaviour.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'

interface VenusPluginConfig {
  enabled?: boolean
  configuration?: {
    useDeviceNames?: boolean
    instanceMappings?: unknown[]
  }
}

export const venusRawDeviceInstance: Rule = {
  id: 'plugin/venus-raw-device-instance',
  description:
    'signalk-venus-plugin is enabled with no way to avoid raw Victron device-instance numbers in paths',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const plugins = snapshot.server.pluginConfig
    if (plugins === null) return []

    const venus = plugins.venus as VenusPluginConfig | undefined
    if (venus === undefined || venus.enabled !== true) return []

    const config = venus.configuration ?? {}
    if (config.useDeviceNames === true) return []

    const mappings = config.instanceMappings
    if (Array.isArray(mappings) && mappings.length > 0) {
      // Some mitigation exists. We can't tell from config alone whether it
      // covers every device without the live data model, so we don't claim
      // it's incomplete -- only flag the case with no mitigation at all.
      return []
    }

    return [
      {
        title: 'Victron device paths may show raw instance numbers',
        detail:
          'signalk-venus-plugin is enabled with useDeviceNames off and no ' +
          'instanceMappings configured. Every Victron device will get a path ' +
          "like electrical.batteries.279 -- Venus OS's own internal device " +
          'number, not a friendly name -- because nothing tells the plugin ' +
          "to use anything else. This is the plugin's default behaviour, " +
          'not something you did wrong.',
        evidence: [
          {
            path: 'server.pluginConfig.venus.configuration.useDeviceNames',
            value: config.useDeviceNames ?? null,
            file: 'plugin-config-data/venus.json'
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'In the Venus plugin config (Server → Plugin Config → Venus), ' +
            'either enable "Use the device names for paths", or add an ' +
            'instanceMappings entry for each device to give it a chosen ' +
            'path instead of the raw number.'
        }
      }
    ]
  }
}
