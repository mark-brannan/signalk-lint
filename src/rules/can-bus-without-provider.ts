/**
 * Rule: host/can-bus-without-provider
 *
 * A CAN interface that is administratively up proves an NMEA 2000 bus is
 * wired into this machine -- someone configured the interface, the kernel
 * brought it up. If no enabled NMEA 2000 connection reads it, everything on
 * that bus is invisible to Signal K, and from inside Signal K it looks
 * exactly like dead instruments.
 *
 * This is the stronger sibling of config/no-data-connections, and the
 * difference is the evidence: that rule can only say "nothing is configured,
 * which might be a fresh install"; this one can say "the bus exists and
 * nothing reads it". On the boat this rule comes from, can0 was up and
 * carrying GNSS the whole time -- the connection had been removed from
 * settings.json, and every symptom pointed at the instruments.
 *
 * What legitimately looks like this and must not fire: a machine where
 * another application owns the bus -- Venus OS services reading CAN and
 * feeding Signal K over D-Bus is a real and correct installation. The rule
 * cannot see other consumers, so the finding says so plainly rather than
 * asserting the bus is unread. That is also why this is `opinion` and `warn`.
 *
 * A provider whose canbus subOptions name no interface is treated as
 * covering every CAN interface: refusing to count it would false-positive on
 * configs written by hands and tools that omit the field, and the failure
 * direction here must be silence.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { networkInterfacesOf } from './host-facts.js'
import {
  PipedProvider,
  isEnabled,
  nmeaProtocolsOf,
  pipedProvidersOf
} from './piped-providers.js'

const ARPHRD_CAN = 280

function readsInterface(provider: PipedProvider, name: string): boolean {
  if (!isEnabled(provider)) return false
  if (!nmeaProtocolsOf(provider).includes('NMEA2000')) return false
  const elements = provider.pipeElements ?? []
  return elements.some((element) => {
    // nmeaProtocolsOf checked the provider as a whole, which only proves one
    // element somewhere is NMEA 2000 -- a different, non-NMEA-2000 element
    // with no subOptions must not count as covering this interface.
    if (element.options?.type !== 'NMEA2000') return false
    const sub = element.options?.subOptions
    if (sub === undefined || typeof sub !== 'object' || sub === null) {
      // An NMEA 2000 element with no subOptions at all still names no
      // interface, so it may cover this one.
      return true
    }
    return sub.interface === undefined || sub.interface === name
  })
}

export const canBusWithoutProvider: Rule = {
  id: 'host/can-bus-without-provider',
  description:
    'A CAN interface is up, but no enabled NMEA 2000 connection reads it',
  defaultSeverity: 'warn',
  provenance: 'opinion',
  hostFacts: ['network'],

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const interfaces = networkInterfacesOf(snapshot)
    if (interfaces === null) return []

    const providers = pipedProvidersOf(snapshot)
    // null means settings.json is missing or unreadable. The bus being up is
    // real, but "nothing reads it" cannot be asserted about a config this
    // rule could not read -- same judgement as config/no-data-connections.
    if (providers === null) return []

    const findings: RuleFinding[] = []
    for (const iface of interfaces) {
      if (iface.type !== ARPHRD_CAN || iface.up !== true) continue
      if (providers.some((provider) => readsInterface(provider, iface.name))) {
        continue
      }
      findings.push({
        title: `CAN interface ${iface.name} is up, but nothing in Signal K reads it`,
        detail:
          `The CAN interface ${iface.name} exists and is up, which proves an ` +
          'NMEA 2000 bus is wired into this machine -- but no enabled NMEA ' +
          '2000 connection in settings.json reads it. Everything on that bus ' +
          'is invisible to Signal K, and from inside Signal K a live bus ' +
          'with no connection looks exactly like dead instruments: the ' +
          'wiring and the devices can be fine while none of their data ' +
          'arrives. If another application on this machine owns the bus ' +
          '(Venus OS services feeding Signal K over D-Bus, for example), ' +
          'this is expected and can be ignored.',
        evidence: [
          {
            path: 'host.network',
            value: {
              name: iface.name,
              up: iface.up,
              operstate: iface.operstate
            }
          },
          {
            path: 'server.settings.pipedProviders',
            value: providers.length,
            file: 'settings.json'
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'Add an NMEA 2000 connection under Server → Data Connections, ' +
            `type canbus-canboatjs, pointed at ${iface.name}. Once saved and ` +
            'enabled, Server → Data Browser should start showing the ' +
            "bus's devices."
        }
      })
    }
    return findings
  }
}
