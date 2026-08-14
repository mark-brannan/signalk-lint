/**
 * Rule: config/no-data-connections
 *
 * `pipedProviders` in settings.json is the list of data connections — the
 * NMEA 2000 bus, the NMEA 0183 serial instrument, the upstream Signal K
 * server. With an empty list, nothing feeds the server. It starts cleanly,
 * serves its admin UI, runs its plugins and reports itself as healthy; the
 * data model simply stays empty, because nothing is wired to fill it.
 *
 * That failure is quiet in a specific way: the hardware can be fine. On the
 * boat this rule comes from, the NMEA 2000 bus was live and carrying GNSS the
 * whole time. Nothing was wrong at the wire. The connection that should have
 * read it had been removed from settings.json, so none of it reached Signal
 * K, and every symptom pointed at the instruments.
 *
 * An empty list is legitimate on a fresh install — you have not set up a
 * connection yet, which is exactly where everyone starts. So this is `warn`,
 * and the wording is careful not to tell a new user something is broken when
 * they simply have not got there yet.
 *
 * Not covered here: a list whose entries all have `enabled: false`. That has
 * the same effect and is worth its own rule; it is a different observation
 * (connections exist and were switched off) with different remediation, and
 * inventing it inside this one would make the finding lie about what it saw.
 *
 * Provenance: opinion. Nothing in the Signal K spec requires a data
 * connection, and there are real installs that legitimately have none — a
 * server used purely to aggregate from plugins, or one still being set up.
 * The judgement that an empty list is usually a mistake is ours.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { pipedProvidersOf } from './piped-providers.js'

export const noDataConnections: Rule = {
  id: 'config/no-data-connections',
  description:
    'No data connections are configured, so nothing feeds the data model',
  defaultSeverity: 'warn',
  provenance: 'opinion',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const providers = pipedProvidersOf(snapshot)

    // null means settings.json is missing or `pipedProviders` is not a list.
    // Either way this rule cannot say what is configured, and guessing would
    // put a finding in front of someone with no way to check it.
    if (providers === null) return []

    if (providers.length > 0) return []

    return [
      {
        title: 'No data connections are configured',
        detail:
          'This server has no data connections, so nothing is feeding it — ' +
          'no NMEA 2000 bus, no NMEA 0183 instrument, no upstream Signal K ' +
          'server. If you are still setting up, that is expected and this is ' +
          'simply the next step. If you thought you already had instruments ' +
          'connected, this is why no data is arriving: it is a gap in the ' +
          'configuration rather than a fault in the wiring. A live bus with ' +
          'no connection reading it looks exactly like dead instruments from ' +
          'inside Signal K, which is what makes this one worth ruling out ' +
          'before you go looking at the hardware.',
        evidence: [
          {
            path: 'server.settings.pipedProviders',
            value: [],
            file: 'settings.json'
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'Add a connection under Server → Data Connections. For a CAN bus ' +
            'this is an NMEA 2000 connection over canbus-canboatjs pointed at ' +
            'your interface (commonly can0); for a USB or serial instrument ' +
            'it is an NMEA 0183 connection pointed at the device path. Once ' +
            'it is saved and enabled, Server → Data Browser should start ' +
            'showing values.'
        }
      }
    ]
  }
}
