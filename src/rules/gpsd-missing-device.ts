/**
 * Rule: host/gpsd-missing-device
 *
 * /etc/default/gpsd names the devices gpsd reads. A device path that does
 * not exist means gpsd is configured for hardware that is not there --
 * unplugged, renumbered (ttyACM0 became ttyACM1 after a reshuffle, the same
 * churn hardware/unstable-serial-device-path exists for), or gone. gpsd
 * itself is silent about it: it waits politely for the device to appear,
 * there is no GPS fix, and every symptom points at the antenna.
 *
 * What legitimately looks like this and must not fire is a hot-pluggable
 * GPS that is deliberately unplugged right now -- gpsd's USBAUTO workflow
 * exists for exactly that. It cannot be told apart from a stale path from
 * here, so this is `warn`, not `error`, and the finding says the unplugged
 * case out loud. The boat this rule comes from had the stale-path version:
 * a udev-renamed device, gpsd waiting on the old name for weeks.
 *
 * Existence was checked by the collector at capture time (rules do no I/O),
 * so the finding is about that moment and says so.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { gpsdOf } from './host-facts.js'

export const gpsdMissingDevice: Rule = {
  id: 'host/gpsd-missing-device',
  description:
    'gpsd is configured to read a device that does not exist on this machine',
  defaultSeverity: 'warn',
  provenance: 'opinion',
  hostFacts: ['gpsd'],

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const gpsd = gpsdOf(snapshot)
    if (gpsd === null) return []

    return gpsd.devices
      .filter((device) => !device.exists)
      .map((device) => ({
        title: `gpsd is configured for ${device.path}, which does not exist`,
        detail:
          `${gpsd.file} lists ${device.path} in DEVICES, but that path did ` +
          'not exist when this snapshot was captured. gpsd does not complain ' +
          'about a missing device -- it waits for it -- so the visible ' +
          'symptom is simply no GPS fix, which looks exactly like an antenna ' +
          'or receiver fault. If the GPS is a USB device that was ' +
          'deliberately unplugged at capture time, this is expected. If it ' +
          'was plugged in, the path is stale: USB serial devices renumber ' +
          'when ports or devices change, and a udev rule pinning a stable ' +
          'name is the durable fix.',
        evidence: [
          {
            path: 'host.gpsd.devices',
            value: { path: device.path, exists: false },
            file: gpsd.file
          }
        ],
        remediation: {
          kind: 'manual',
          description:
            `Check what the GPS actually enumerates as (ls /dev/tty* with it ` +
            'plugged in), update DEVICES in /etc/default/gpsd to match, and ' +
            'prefer a /dev/serial/by-id/ path or a udev rule so the name ' +
            'survives replugging. Then restart gpsd.'
        }
      }))
  }
}
