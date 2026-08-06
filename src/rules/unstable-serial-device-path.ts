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
 * settings.pipedProviders[].pipeElements[].
 *
 * Provenance: convention. This isn't in the Signal K spec -- it's a Linux
 * udev fact that repeatedly bites people wiring up NMEA 0183 over USB.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'

const UNSTABLE_PATTERN = /^\/dev\/tty(USB|ACM)\d+$/

interface PipeElement {
  type?: string
  options?: { device?: string }
}

interface PipedProvider {
  id?: string
  pipeElements?: PipeElement[]
}

export const unstableSerialDevicePath: Rule = {
  id: 'hardware/unstable-serial-device-path',
  description:
    'A serial connection uses a /dev/ttyUSB* or /dev/ttyACM* path that can change on reboot',
  defaultSeverity: 'warn',
  provenance: 'convention',

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const settings = snapshot.server.settings
    if (settings === null) return []

    const providers = settings.pipedProviders as PipedProvider[] | undefined
    if (!Array.isArray(providers)) return []

    const findings: RuleFinding[] = []

    for (const provider of providers) {
      const elements = provider.pipeElements
      if (!Array.isArray(elements)) continue

      for (const element of elements) {
        if (element.type !== 'providers/serialport') continue
        const device = element.options?.device
        if (typeof device !== 'string') continue
        if (!UNSTABLE_PATTERN.test(device)) continue

        const providerId = provider.id ?? '(unnamed connection)'
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
