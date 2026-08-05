/**
 * Rule: plugin/datetime-nonstandard-path
 *
 * signalk-datetime (plugin id "signalk-datetime") publishes the current time
 * to a configurable path. Verified directly against the plugin's source: its
 * own schema default is `environment.time`, which is not a documented Signal
 * K path -- the spec's path for date/time is `navigation.datetime`. Anything
 * that reads the standard path (other plugins, dashboards, loggers) gets
 * nothing from a fresh install, silently.
 *
 * Provenance: convention (specifically: the spec documents navigation.datetime;
 * this plugin's default doesn't match it).
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'

const SPEC_PATH = 'navigation.datetime'
const PLUGIN_DEFAULT = 'environment.time'

interface DatetimePluginConfig {
  enabled?: boolean
  configuration?: {
    path?: string
  }
}

export const datetimeNonstandardPath: Rule = {
  id: 'plugin/datetime-nonstandard-path',
  description:
    'signalk-datetime is publishing time to a path other than navigation.datetime',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const plugins = snapshot.server.pluginConfig
    if (plugins === null) return []

    const datetime = plugins['signalk-datetime'] as
      DatetimePluginConfig | undefined
    if (datetime === undefined || datetime.enabled !== true) return []

    // Unset means the plugin's own default applies, which is itself the
    // non-standard path -- so absence is flagged the same as an explicit
    // environment.time.
    const configuredPath = datetime.configuration?.path ?? PLUGIN_DEFAULT
    if (configuredPath === SPEC_PATH) return []

    return [
      {
        title: `Time is published to "${configuredPath}", not the spec path`,
        detail:
          `signalk-datetime is publishing to ${configuredPath}. The Signal K ` +
          `spec's path for date and time is ${SPEC_PATH} -- anything reading ` +
          'the standard path (other plugins, dashboards, loggers) will see ' +
          "nothing, with no error to explain why. This is the plugin's own " +
          'default, not something you changed.',
        evidence: [
          {
            path: 'server.pluginConfig.signalk-datetime.configuration.path',
            value: configuredPath,
            file: 'plugin-config-data/signalk-datetime.json'
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'In the signalk-datetime plugin config (Server → Plugin Config), ' +
            `change Path to ${SPEC_PATH}.`,
          target: 'plugin-config-data/signalk-datetime.json:configuration.path',
          currentValue: configuredPath,
          proposedValue: SPEC_PATH
        }
      }
    ]
  }
}
