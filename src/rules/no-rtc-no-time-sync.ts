/**
 * Rule: host/no-rtc-no-time-sync
 *
 * hardware/no-realtime-clock catches the clock that is *already* wrong. This
 * catches the one that is wrong-in-waiting: no RTC device, and the kernel
 * reports the clock unsynchronized -- so nothing will put it right after the
 * next power cycle, and boats power-cycle constantly. The failure shows up
 * later, as 1970 timestamps in the log of the passage where something else
 * went wrong.
 *
 * Both conditions are required, and each alone is fine, which is what keeps
 * this honest: an RTC with no NTP holds time across power loss; NTP sync
 * with no RTC recovers it at boot when a network is there. The check is
 * outcome-shaped where it can be -- NTPSynchronized is the kernel's own
 * "something is disciplining this clock" flag, which chrony, timesyncd and
 * ntpd all set -- so a boat syncing time from GPS via chrony passes without
 * this rule knowing chrony exists.
 *
 * What legitimately looks like this and must not fire cleanly divides by
 * mechanism, and one case is genuinely uncatchable: a GPS-time plugin that
 * sets the clock without marking it synchronized. That is why this is `warn`
 * and `opinion`, and why the finding names that case instead of pretending
 * the observation is stronger than it is.
 *
 * hasRTC null (not Linux, or unknown) stays silent, matching
 * hardware/no-realtime-clock: null is "could not confirm absent", and a
 * finding built on it would accuse hardware nobody has seen.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { timeOf } from './host-facts.js'

export const noRtcNoTimeSync: Rule = {
  id: 'host/no-rtc-no-time-sync',
  description:
    'No real-time clock and no synchronized time source -- the clock will be wrong after the next power cycle',
  defaultSeverity: 'warn',
  provenance: 'opinion',
  hostFacts: ['time'],

  evaluate(snapshot: Snapshot): RuleFinding[] {
    // Confirmed-absent only. null means "not Linux, or could not determine",
    // and neither supports a finding about missing hardware.
    if (snapshot.server.system.hasRTC !== false) return []

    const time = timeOf(snapshot)
    if (time === null) return []
    if (time.ntpSynchronized !== false) return []

    return [
      {
        title: 'No real-time clock, and the system clock is not synchronized',
        detail:
          'No /dev/rtc0 device was found, and the kernel reports the clock ' +
          'unsynchronized -- no NTP service (chrony, timesyncd, ntpd) is ' +
          'currently disciplining it. The clock may read correctly right ' +
          'now, but nothing will restore it after the next power cycle: the ' +
          'machine will boot into the past, and navigation logs, TLS ' +
          'certificate checks and anything else that reads a timestamp will ' +
          'misbehave until something sets it. If a GPS-time plugin sets the ' +
          'clock on this boat, it may not mark it synchronized and this ' +
          'finding can be ignored -- but verify that rather than assume it.',
        evidence: [
          { path: 'server.system.hasRTC', value: false },
          {
            path: 'host.time',
            value: { ntp: time.ntp, ntpSynchronized: time.ntpSynchronized }
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'Give the clock a source that survives power cycles: connect an ' +
            'RTC (Raspberry Pi 5 has one built in, needing only the battery; ' +
            'earlier boards take a DS3231 module for a few dollars), or ' +
            'ensure a time service syncs whenever a network or GPS is ' +
            'available -- chrony with a GPS refclock works at anchor with no ' +
            'internet.'
        }
      }
    ]
  }
}
