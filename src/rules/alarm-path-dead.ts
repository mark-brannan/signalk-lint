/**
 * Rule: plugin/alarm-path-dead
 *
 * An alerting path that is switched on but has nowhere to deliver is worse
 * than no alerting at all: it reports itself as configured, so every check
 * that asks "will I be told when this breaks?" answers yes, and nothing ever
 * arrives to contradict it.
 *
 * signalk-healthcheck (plugin id "signalk-healthcheck") sends its alerts over
 * SMTP. Verified against the plugin's own index.js:
 *
 *   nodemailer.createTransport({ host: hcOptions.mail.host, port: ..., ... })
 *   sendEmail(hcOptions.host.toEmail, subject, text)
 *
 * Neither call is guarded. With `mail.host` unset, nodemailer falls back to
 * localhost -- so the plugin connects to 127.0.0.1:587, finds nothing
 * listening, logs the failure through `app.error` and carries on. On the boat
 * this rule comes from, the entire mail block was `{ "secure": false }`:
 * every alarm it ever raised went to a port with no server behind it, for as
 * long as the plugin had been installed.
 *
 * The plugin has two independent alerting paths, gated the same way in
 * `plugin.start`: host checks (`host.enabled` && `host.sendEmail`) and one
 * per configured provider (`providers[id].enabled` && `providers[id]
 * .sendEmail`). Both funnel into the same transport, and both take their
 * recipient from their own `toEmail`. This rule checks both, which is as far
 * as the generalisation goes -- "an enabled alerting path with no
 * destination" is the shape, but claiming it for plugins whose config has not
 * been read would be inventing behaviour.
 *
 * Deliberately NOT flagged: missing username/password. Plenty of boats relay
 * through an unauthenticated local MTA, so absent credentials are a normal
 * configuration. A missing host is not -- there is no server to talk to.
 *
 * Provenance: convention. Specific, verified knowledge of one plugin's
 * delivery path.
 */
import { Evidence, Rule, RuleFinding, Snapshot } from '../types.js'

const PLUGIN_ID = 'signalk-healthcheck'
const CONFIG_FILE = `plugin-config-data/${PLUGIN_ID}.json`

interface AlertingPathConfig {
  enabled?: unknown
  sendEmail?: unknown
  toEmail?: unknown
}

interface HealthcheckPluginConfig {
  enabled?: boolean
  configuration?: {
    host?: AlertingPathConfig
    providers?: Record<string, AlertingPathConfig>
    mail?: { host?: unknown }
  }
}

/** An alerting path that is switched on and set to send email. */
interface LivePath {
  /** Human-readable, for the finding text. */
  label: string
  /** Dotted path to this path's config, under the plugin's `configuration`. */
  configPath: string
  toEmail: unknown
}

function isOn(value: unknown): boolean {
  return value === true
}

/** A string with something in it. Blank strings are as dead as absent ones. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function livePathsOf(config: HealthcheckPluginConfig): LivePath[] {
  const configuration = config.configuration ?? {}
  const paths: LivePath[] = []

  const host = configuration.host
  if (host !== undefined && isOn(host.enabled) && isOn(host.sendEmail)) {
    paths.push({
      label: 'host checks (CPU, memory, disk)',
      configPath: 'host',
      toEmail: host.toEmail
    })
  }

  const providers = configuration.providers
  if (providers !== null && typeof providers === 'object') {
    for (const [id, provider] of Object.entries(providers ?? {})) {
      if (provider === null || typeof provider !== 'object') continue
      if (!isOn(provider.enabled) || !isOn(provider.sendEmail)) continue
      paths.push({
        label: `data connection check "${id}"`,
        configPath: `providers.${id}`,
        toEmail: provider.toEmail
      })
    }
  }

  return paths
}

export const alarmPathDead: Rule = {
  id: 'plugin/alarm-path-dead',
  description:
    'signalk-healthcheck is set to email alerts but has no SMTP server or no recipient, so alerts go nowhere',
  defaultSeverity: 'error',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const plugins = snapshot.server.pluginConfig
    if (plugins === null) return []

    const plugin = plugins[PLUGIN_ID] as HealthcheckPluginConfig | undefined
    if (plugin === undefined || plugin.enabled !== true) return []

    const live = livePathsOf(plugin)
    // Nothing is set to send email, so there is no delivery path to be broken.
    if (live.length === 0) return []

    const findings: RuleFinding[] = []
    const mailHost = plugin.configuration?.mail?.host

    // One finding for the transport: it is shared by every alerting path, so
    // emitting it per-path would be the same defect reported N times.
    if (!isNonEmptyString(mailHost)) {
      const evidence: Evidence[] = [
        {
          path: `server.pluginConfig.${PLUGIN_ID}.configuration.mail.host`,
          value: mailHost ?? null,
          file: CONFIG_FILE
        },
        ...live.map((path) => ({
          path: `server.pluginConfig.${PLUGIN_ID}.configuration.${path.configPath}.sendEmail`,
          value: true,
          file: CONFIG_FILE
        }))
      ]

      findings.push({
        title: 'Email alerts are switched on with no mail server configured',
        detail:
          'signalk-healthcheck is set to email you when something goes ' +
          `wrong (${live.map((p) => p.label).join(', ')}), but no mail ` +
          'server host is configured. The plugin hands that empty setting ' +
          'straight to its mail library, which falls back to the local ' +
          'machine — so it tries to deliver to 127.0.0.1, where nothing is ' +
          'listening, and the alert is lost. The plugin does not report this ' +
          'as a configuration problem: it keeps running, keeps checking, and ' +
          'keeps reporting itself as healthy. Every alarm it raises is ' +
          'silently discarded, which means an alerting setup that looks ' +
          'configured has never once reached you.',
        evidence,
        remediation: {
          kind: 'manual',
          description:
            'In Server → Plugin Config → SignalK Healthcheck, fill in the ' +
            'eMail Config section: Host (your SMTP server), Port, and From ' +
            'Address, plus Username and Password if your server needs them. ' +
            'Then force a failure — or drop the CPU/disk thresholds ' +
            'briefly — and confirm the message actually arrives, because ' +
            'nothing else in this path will tell you if it does not.',
          target: `pluginConfig.${PLUGIN_ID}.configuration.mail.host`,
          currentValue: mailHost ?? null
        }
      })
    }

    // A recipient is per-path, so this one genuinely is one finding each.
    for (const path of live) {
      if (isNonEmptyString(path.toEmail)) continue
      findings.push({
        title: `Email alerts for ${path.label} have no recipient address`,
        detail:
          `The ${path.label} alerting path is enabled and set to send ` +
          'email, but its recipient address is empty. The plugin passes that ' +
          'empty address to its mail library, so the alert is addressed to ' +
          'nobody and never arrives. As with a missing mail server, nothing ' +
          'surfaces this: the check keeps running and the path keeps ' +
          'reporting itself as configured.',
        evidence: [
          {
            path: `server.pluginConfig.${PLUGIN_ID}.configuration.${path.configPath}.toEmail`,
            value: path.toEmail ?? null,
            file: CONFIG_FILE
          },
          {
            path: `server.pluginConfig.${PLUGIN_ID}.configuration.${path.configPath}.sendEmail`,
            value: true,
            file: CONFIG_FILE
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'In Server → Plugin Config → SignalK Healthcheck, set "Send ' +
            `Email To Address(es)" for ${path.label} — or turn "Send Email" ` +
            'off for it if you only want the Signal K notification.',
          target: `pluginConfig.${PLUGIN_ID}.configuration.${path.configPath}.toEmail`,
          currentValue: path.toEmail ?? null
        }
      })
    }

    return findings
  }
}
