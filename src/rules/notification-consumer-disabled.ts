/**
 * Rule: plugin/notification-consumer-disabled
 *
 * A plugin is raising Signal K notifications, and a plugin installed to act on
 * them has been switched off with nothing else enabled in its place. The alarms
 * still get written to the data model; the thing that was supposed to make a
 * noise about them no longer runs. Nothing reports this, because from the
 * producer's side everything worked -- the notification was published exactly
 * as configured.
 *
 * This rule does NOT claim that nobody is watching. It cannot: notifications
 * are consumed over the websocket by clients a config snapshot has no way to
 * see. Freeboard-SK ships with signalk-server as an optional dependency and
 * subscribes to `notifications.*` from the browser, and WilhelmSK and KIP do
 * the same from a tablet -- none of which leaves a trace in
 * plugin-config-data/. So the claim here is only the one the snapshot can
 * actually support: a consumer that this boat chose to install is now off.
 * That is a state someone changed, not an absence we inferred.
 *
 * The conjunction is what keeps it quiet. All three must hold:
 *
 *   1. a verified producer is enabled with notifications switched on
 *   2. a verified consumer is present in plugin-config-data but `enabled: false`
 *   3. no verified consumer is enabled
 *
 * Condition 3 is the one that matters. A boat running the notification player
 * alongside a disabled GPIO beeper is a boat that is covered and has simply
 * stopped using the beeper -- firing there would be exactly the false "nobody
 * is listening" this rule exists to avoid.
 *
 * The two tables below are allowlists of plugins whose source has been read.
 * Neither is complete and neither can be: any plugin may call
 * `app.subscriptionmanager.subscribe({ path: 'notifications.*' })` in its
 * `start()`, and nothing in a plugin's manifest declares that it does. An
 * unlisted consumer therefore reads as absent, which is why condition 3 alone
 * can never be the trigger. Adding an entry means reading that plugin's source
 * and citing it here, the same bar `plugin/venus-raw-device-instance` sets.
 *
 * Provenance: convention. Verified knowledge of four specific plugins.
 */
import { Evidence, Rule, RuleFinding, Snapshot } from '../types.js'

interface PluginEntry {
  enabled?: unknown
  configuration?: Record<string, unknown>
}

/** A plugin that writes to `notifications.*`, and the config field that gates it. */
interface Producer {
  id: string
  /** Human-readable, for the finding text. */
  label: string
  /**
   * Every switched-on notification path in this plugin's config, as dotted
   * paths under `configuration`. Empty when nothing is raising notifications.
   */
  livePaths(configuration: Record<string, unknown>): string[]
}

function isOn(value: unknown): boolean {
  return value === true
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/**
 * signalk-healthcheck (id "signalk-healthcheck"), verified against index.js
 * 1.1.1: `hostCheck` publishes `notifications.host.<check>.<field>` under
 * `if (hcOptions.host.sendNotification)` (:564, paths built at :497), and
 * `providerCheck` publishes `notifications.provider.<id>.deltaRate` under
 * `if (provider.sendNotification)` (:602, path at :531). The host check itself
 * only runs when `host.enabled` (:213), so both halves are required.
 */
const healthcheck: Producer = {
  id: 'signalk-healthcheck',
  label: 'signalk-healthcheck',
  livePaths(configuration) {
    const paths: string[] = []

    const host = asRecord(configuration.host)
    if (host !== null && isOn(host.enabled) && isOn(host.sendNotification)) {
      paths.push('host.sendNotification')
    }

    const providers = asRecord(configuration.providers)
    for (const [id, provider] of Object.entries(providers ?? {})) {
      const config = asRecord(provider)
      if (config === null) continue
      if (!isOn(config.enabled) || !isOn(config.sendNotification)) continue
      paths.push(`providers.${id}.sendNotification`)
    }

    return paths
  }
}

/**
 * signalk-doctor (id "signalk-doctor", PLUGIN_ID at plugin/index.js:6),
 * verified against 0.4.0: `startNotificationPolling` returns immediately
 * unless `config.publishNotifications` (:175), and otherwise publishes under
 * the `notifications.doctor.` prefix (plugin/probes-notify.js:11).
 */
const doctor: Producer = {
  id: 'signalk-doctor',
  label: 'signalk-doctor',
  livePaths(configuration) {
    return isOn(configuration.publishNotifications)
      ? ['publishNotifications']
      : []
  }
}

const PRODUCERS: readonly Producer[] = [healthcheck, doctor]

/**
 * Plugins verified to subscribe to `notifications.*` unconditionally in
 * `start()`, so being enabled is the whole question for them:
 *
 * - signalk-notification-player (id at index.js:25, verified against 2.7.0):
 *   `subscribeToNotifications` subscribes to `notifications.*` with policy
 *   `instant` (:862-872), called from `start` (:82). Audio and text-to-speech.
 * - signalk-gpio-beeper-plugin (id is the package name, plugin/index.js:34,
 *   verified against 1.2.2): subscribes to `notifications.*` inside `start`
 *   (:61-71) and drives a GPIO buzzer from the notification state.
 */
interface Consumer {
  id: string
  /** Human-readable, for the finding text. */
  label: string
}

const CONSUMERS: readonly Consumer[] = [
  { id: 'signalk-notification-player', label: 'audible alarm playback' },
  { id: 'signalk-gpio-beeper-plugin', label: 'GPIO buzzer' }
]

function configFile(id: string): string {
  return `plugin-config-data/${id}.json`
}

/** A producer with at least one notification path switched on. */
interface LiveProducer {
  producer: Producer
  paths: string[]
}

function liveProducers(plugins: Record<string, unknown>): LiveProducer[] {
  const live: LiveProducer[] = []

  for (const producer of PRODUCERS) {
    const entry = asRecord(plugins[producer.id]) as PluginEntry | null
    if (entry === null || !isOn(entry.enabled)) continue

    const paths = producer.livePaths(asRecord(entry.configuration) ?? {})
    if (paths.length > 0) live.push({ producer, paths })
  }

  return live
}

export const notificationConsumerDisabled: Rule = {
  id: 'plugin/notification-consumer-disabled',
  description:
    'A plugin is raising Signal K notifications while the only notification-handling plugin installed is switched off',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const plugins = snapshot.server.pluginConfig
    if (plugins === null) return []

    const live = liveProducers(plugins)
    if (live.length === 0) return []

    const disabled: Consumer[] = []
    for (const consumer of CONSUMERS) {
      const entry = asRecord(plugins[consumer.id]) as PluginEntry | null
      // Absent means never installed, which is not a state anyone changed and
      // says nothing about coverage -- the boat may be watched entirely from a
      // tablet. Only an installed-then-switched-off consumer is evidence.
      if (entry === null) continue
      if (isOn(entry.enabled)) return []
      disabled.push(consumer)
    }

    if (disabled.length === 0) return []

    const evidence: Evidence[] = [
      ...disabled.map((consumer) => ({
        path: `server.pluginConfig.${consumer.id}.enabled`,
        value: false,
        file: configFile(consumer.id)
      })),
      ...live.flatMap(({ producer, paths }) =>
        paths.map((path) => ({
          path: `server.pluginConfig.${producer.id}.configuration.${path}`,
          value: true,
          file: configFile(producer.id)
        }))
      )
    ]

    const consumerNames = disabled.map((c) => `${c.id} (${c.label})`).join(', ')
    const producerNames = live.map(({ producer }) => producer.label).join(', ')

    return [
      {
        title: 'Notification handling on this boat is switched off',
        detail:
          `${producerNames} is raising Signal K notifications, and every ` +
          `notification-handling plugin installed here (${consumerNames}) ` +
          'is disabled, with no other one enabled. The alarms are still ' +
          'being written to the data model, so anything watching over the ' +
          'network still sees them: a chart plotter app, Freeboard-SK in a ' +
          'browser, or a phone on the boat wifi. What has stopped is the ' +
          'part that acts on them here, on the boat, without someone ' +
          'already looking at a screen. If that plugin was turned off on ' +
          'purpose, this is nothing; if it was turned off to stop a nuisance ' +
          'alarm at two in the morning and never turned back on, every ' +
          'alarm since has been silent.',
        evidence,
        remediation: {
          kind: 'manual',
          description:
            `In Server → Plugin Config, re-enable ${consumerNames} if you ` +
            'still want alarms handled on board — or, if it was switched off ' +
            'deliberately, turn off the notifications you are no longer ' +
            `acting on in ${producerNames} so the data model stops ` +
            'collecting alarms nothing here responds to.',
          target: `pluginConfig.${disabled[0]?.id}.enabled`,
          currentValue: false,
          proposedValue: true
        }
      }
    ]
  }
}
