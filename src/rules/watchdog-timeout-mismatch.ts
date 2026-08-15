/**
 * Rule: host/watchdog-timeout-mismatch
 *
 * When systemd pings a hardware watchdog, it programs the device with its
 * RuntimeWatchdogSec -- systemd-system.conf(5) documents the setting and
 * systemd owns /dev/watchdog while it is set. So systemd's view and the
 * device's /sys timeout agreeing is the healthy state, and disagreement
 * means one of two real faults: the driver clamped the requested timeout to
 * something it supports (systemd asked for 10s, the chip does 15s), or
 * something other than systemd programmed the watchdog and both think they
 * own it. Either way, the reboot-on-hang behaviour someone configured is
 * not the behaviour armed in hardware -- on the boat this rule comes from,
 * a hung server was rebooting on the chip's clamp, not the configured
 * timeout, and the difference was long enough to matter mid-channel.
 *
 * Fires only when both sides are known and disagree, with systemd's side
 * non-zero -- RuntimeWatchdogSec=0 means systemd is not running the
 * watchdog at all, and then the device timeout belongs to whoever else
 * opened it, which is not this mismatch. Either side unknown is silence:
 * a comparison needs two numbers, and there is nothing safe to say with
 * one. Provenance: documented, per systemd-system.conf(5)'s definition of
 * the setting this checks.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { watchdogOf } from './host-facts.js'

export const watchdogTimeoutMismatch: Rule = {
  id: 'host/watchdog-timeout-mismatch',
  description:
    "systemd's configured watchdog timeout disagrees with what the hardware is armed with",
  defaultSeverity: 'warn',
  provenance: 'documented',
  hostFacts: ['watchdog'],

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const watchdog = watchdogOf(snapshot)
    if (watchdog === null) return []

    const configured = watchdog.runtimeWatchdogSec
    if (configured === null || configured === 0) return []
    if (watchdog.devices === null) return []

    const device = watchdog.devices.find((entry) => entry.name === 'watchdog0')
    if (device === undefined || device.timeoutSec === null) return []
    if (device.timeoutSec === configured) return []

    return [
      {
        title: 'The hardware watchdog is not armed with the configured timeout',
        detail:
          `systemd is configured with RuntimeWatchdogSec=${configured} ` +
          `(reported as "${watchdog.runtimeWatchdogRaw}"), but ` +
          `/sys/class/watchdog/watchdog0/timeout reads ${device.timeoutSec}s. ` +
          'When systemd runs the watchdog it programs the device with its ' +
          'own timeout, so a disagreement means either the driver clamped ' +
          'the requested value to what the chip supports, or something else ' +
          'has programmed the watchdog and two things believe they own it. ' +
          'Either way, the hang-recovery behaviour configured is not the ' +
          'behaviour armed in hardware: a hung machine will reboot on the ' +
          "device's timeout, not the configured one, or possibly not at all.",
        evidence: [
          {
            path: 'host.watchdog.runtimeWatchdogSec',
            value: configured
          },
          {
            path: 'host.watchdog.devices',
            value: { name: device.name, timeoutSec: device.timeoutSec }
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            'Pick a RuntimeWatchdogSec the hardware actually supports (check ' +
            'dmesg for the driver clamping message, or the watchdog chip ' +
            'documentation), set it in /etc/systemd/system.conf, run ' +
            'systemctl daemon-reexec, and confirm /sys/class/watchdog/' +
            'watchdog0/timeout now matches. If something other than systemd ' +
            'is meant to run the watchdog, set RuntimeWatchdogSec=0 so only ' +
            'one owner remains.'
        },
        references: [
          'https://www.freedesktop.org/software/systemd/man/latest/systemd-system.conf.html#RuntimeWatchdogSec='
        ]
      }
    ]
  }
}
