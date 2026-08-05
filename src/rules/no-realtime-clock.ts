/**
 * Rule: hardware/no-realtime-clock
 *
 * A server with no battery-backed clock resets to the Unix epoch (1970) on
 * every power loss. Navigation logs get nonsense timestamps, TLS certificate
 * validation can fail, and GPS time corrections take longer to converge --
 * all from something that looks unrelated to time at first glance.
 *
 * Hardware-generic on purpose: this checks for /dev/rtc0, not for a specific
 * board. Raspberry Pi is common but not the only thing Signal K runs on, and
 * even within the Pi family this differs by generation -- Pi 5 is the first
 * with a built-in RTC chip, and even there it only holds time across a power
 * cycle once the separate battery is connected. A device node existing does
 * not prove the clock is actually battery-backed; it only proves this check
 * can't rule out a working RTC, which is why we do not warn when hasRTC is
 * true, only when it's confirmed absent.
 *
 * Provenance: convention. Not in the Signal K spec -- a hardware fact with
 * real consequences for anything that reads a timestamp.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'

export const noRealtimeClock: Rule = {
  id: 'hardware/no-realtime-clock',
  description: 'No real-time clock device found -- time resets on power loss',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const hasRTC = snapshot.server.system.hasRTC

    // null means "not Linux" or "couldn't determine" -- not "confirmed
    // absent". Nothing to say either way.
    if (hasRTC !== false) return []

    return [
      {
        title: 'No real-time clock found',
        detail:
          'No /dev/rtc0 device was found. Without a battery-backed clock, ' +
          'the system time resets on every power loss and has to be reset ' +
          'by NTP or GPS before anything with a timestamp -- logs, TLS, ' +
          'position fixes -- is trustworthy again.',
        evidence: [{ path: 'server.system.hasRTC', value: false }],
        remediation: {
          kind: 'manual',
          description:
            'Raspberry Pi 5 has a built-in RTC chip -- connect the official ' +
            'RTC battery and it works with no extra hardware. Earlier Pi ' +
            'boards (4 and older, Zero) and most other single-board ' +
            'computers have no onboard RTC at all and need an add-on module ' +
            '(e.g. a DS3231, a few dollars). If GPS is connected and always ' +
            'available before you need accurate timestamps, enabling NTP ' +
            'sync from GPS is a software-only alternative.'
        }
      }
    ]
  }
}
