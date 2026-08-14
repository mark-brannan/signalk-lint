/**
 * Rule: hardware/unstable-serial-device-path
 *
 * Linux assigns /dev/ttyUSB0, /dev/ttyUSB1 etc. in the order USB devices are
 * detected, not by which physical device they are. Add or remove any USB
 * device -- including one unrelated to Signal K -- and the numbering can
 * shift. A connection pointed at /dev/ttyUSB0 can silently end up reading a
 * different instrument after a reboot, or reading nothing at all if the
 * enumeration order changed.
 *
 * /dev/serial/by-id/* and /dev/serial/by-path/* are stable across reboots and
 * USB reordering -- they're derived from the device's own vendor/serial info,
 * not detection order.
 *
 * Verified against @signalk/streams' serialport.js: the field is
 * `options.device` on a `providers/serialport` pipe element, nested inside
 * settings.pipedProviders[].pipeElements[]. That field is read through the
 * shared helper in piped-providers.ts, which every rule reasoning about
 * connections goes through -- so they agree on what a provider is, and none
 * of them can be the one that crashes the run on a malformed entry.
 *
 * Provenance: convention. This isn't in the Signal K spec -- it's a Linux
 * udev fact that repeatedly bites people wiring up NMEA 0183 over USB.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { pipedProvidersOf } from './piped-providers.js'

const UNSTABLE_PATTERN = /^\/dev\/tty(USB|ACM)\d+$/

export const unstableSerialDevicePath: Rule = {
  id: 'hardware/unstable-serial-device-path',
  description:
    'A serial connection uses a /dev/ttyUSB* or /dev/ttyACM* path that can change on reboot',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    // Shared with the other rules that read this field. It validates every
    // entry before handing it back, which matters here: this rule used to
    // parse pipedProviders through its own un-validated interfaces, and a
    // null entry threw -- taking down every other rule's findings with it,
    // because lint() evaluates the whole set in one pass.
    const providers = pipedProvidersOf(snapshot)
    if (providers === null) return []

    const findings: RuleFinding[] = []

    for (const provider of providers) {
      const elements = provider.pipeElements
      if (!Array.isArray(elements)) continue

      for (const element of elements) {
        if (element.type !== 'providers/serialport') continue
        const device = element.options?.device
        if (typeof device !== 'string') continue
        if (!UNSTABLE_PATTERN.test(device)) continue

        const providerId =
          typeof provider.id === 'string' ? provider.id : '(unnamed connection)'
        findings.push({
          title: `Connection "${providerId}" uses a device path that can change: ${device}`,
          detail:
            `This connection reads from ${device}, which Linux assigns by ` +
            'detection order, not by which physical device it is. Add or ' +
            'remove any USB device -- even one unrelated to Signal K -- and ' +
            'the numbering can shift. After that, this connection may read a ' +
            'different instrument, or nothing at all, with no error to warn ' +
            'you.',
          evidence: [
            {
              path: 'server.settings.pipedProviders',
              value: device,
              file: 'settings.json'
            }
          ],
          remediation: {
            kind: 'manual',
            description:
              'Run `ls -la /dev/serial/by-id/` on the server to find this ' +
              "device's stable path, then update the connection's Device " +
              'field (Server → Data Connections) to use it instead.',
            target: `pipedProviders.${providerId}`,
            currentValue: device
          }
        })
      }
    }

    return findings
  }
}
