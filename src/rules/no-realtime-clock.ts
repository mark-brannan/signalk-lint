/**
 * Rule: hardware/no-realtime-clock
 *
 * A server with no battery-backed clock resets to the Unix epoch (1970) on
 * every power loss. Navigation logs get nonsense timestamps, TLS certificate
 * validation can fail, and GPS time corrections take longer to converge --
 * all from something that looks unrelated to time at first glance.
 *
 * Deliberately mechanism-agnostic. The fix isn't always an RTC -- NTP over a
 * network connection, a GPS-time plugin, or something this rule has never
 * heard of can all keep the clock right. Checking for one specific plugin
 * would mean telling someone "you didn't fix it the way I expected" when
 * they may have fixed it perfectly well a different way -- worse than saying
 * nothing. So this checks the actual outcome instead: is the system clock,
 * at the moment of capture, a plausible date at all? If something is keeping
 * it right, the clock reads correctly regardless of what that something is.
 * If nothing is, it reads implausibly -- most visibly, epoch-adjacent.
 *
 * The floor for "plausible" is GENERATED_AT, the bundled advisories'
 * generation timestamp: this code cannot have been built before that
 * moment, so a clock reading earlier than it is unambiguous, not a guess.
 * This makes the check one-directional-safe -- it can only miss a wrong
 * clock (drifted by hours, wrong by a few days), never falsely accuse a
 * correct one, which matters more here.
 *
 * Only checked when hasRTC is confirmed false. A present RTC is not
 * re-checked against this same floor -- a Pi 5 with the RTC chip but no
 * battery connected would show hasRTC true yet still read wrong. That's a
 * real gap, but a different, unbuilt rule; this one is scoped to "no RTC
 * device at all".
 *
 * Provenance: convention. Not in the Signal K spec -- a hardware fact with
 * real consequences for anything that reads a timestamp.
 */
import { GENERATED_AT } from '../data/advisories.js'
import { Rule, RuleFinding, Snapshot } from '../types.js'

const PLAUSIBLE_FLOOR = new Date(GENERATED_AT)

export const noRealtimeClock: Rule = {
  id: 'hardware/no-realtime-clock',
  description:
    'No real-time clock, and the system clock looks unfixed at capture time',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const hasRTC = snapshot.server.system.hasRTC

    // null means "not Linux" or "couldn't determine" -- not "confirmed
    // absent". Nothing to say either way.
    if (hasRTC !== false) return []

    const capturedAt = new Date(snapshot.capturedAt)

    // The clock already reads plausibly. Something -- NTP, GPS, a plugin we
    // don't know about, someone setting it by hand -- is keeping it right.
    // That's the actual thing that matters, not which mechanism did it.
    if (capturedAt >= PLAUSIBLE_FLOOR) return []

    return [
      {
        title: 'No real-time clock, and the system clock looks unfixed',
        detail:
          'No /dev/rtc0 device was found, and the system clock read ' +
          `${snapshot.capturedAt} at capture time -- earlier than this ` +
          "tool's own bundled data, which is not possible if the clock were " +
          'correct. Nothing currently appears to be correcting it. This can ' +
          'be fixed by RTC hardware, NTP, a GPS-time plugin, or anything ' +
          'else that sets the clock -- the mechanism does not matter, only ' +
          'that the clock ends up right.',
        evidence: [
          { path: 'server.system.hasRTC', value: false },
          { path: 'capturedAt', value: snapshot.capturedAt }
        ],
        remediation: {
          kind: 'manual',
          description:
            'Get the clock reading correctly, by whatever means fits this ' +
            'boat: connect an RTC (Raspberry Pi 5 has one built in, needing ' +
            'only the official battery; earlier Pi boards and most other ' +
            'single-board computers need an add-on module, e.g. a DS3231, a ' +
            'few dollars), enable NTP when a network is available, or use a ' +
            "GPS-time plugin if GPS is reliably present before the clock's " +
            'accuracy matters.'
        }
      }
    ]
  }
}
