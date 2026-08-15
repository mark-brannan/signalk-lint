/**
 * The rule registry.
 *
 * Adding a rule means adding a file here and an entry below. Each rule is a
 * pure function over a Snapshot with fixtures in test/fixtures -- which is
 * deliberately the smallest possible unit of contribution, because rules are
 * where community knowledge about boats will come from, not from us.
 */
import { Rule } from '../types.js'
import { serverVersionAdvisories } from './server-version-advisories.js'
import { allowReadonlyNonLoopback } from './allow-readonly-non-loopback.js'
import { unstableSerialDevicePath } from './unstable-serial-device-path.js'
import { noRealtimeClock } from './no-realtime-clock.js'
import { venusRawDeviceInstance } from './venus-raw-device-instance.js'
import { btSensorsScanStarvation } from './bt-sensors-scan-starvation.js'
import { alarmPathDead } from './alarm-path-dead.js'
import { noDataConnections } from './no-data-connections.js'
import { fallbackIsPrimary } from './fallback-is-primary.js'
import { canBusWithoutProvider } from './can-bus-without-provider.js'
import { noRtcNoTimeSync } from './no-rtc-no-time-sync.js'

export const rules: readonly Rule[] = [
  serverVersionAdvisories,
  allowReadonlyNonLoopback,
  unstableSerialDevicePath,
  noRealtimeClock,
  venusRawDeviceInstance,
  btSensorsScanStarvation,
  alarmPathDead,
  noDataConnections,
  fallbackIsPrimary,
  canBusWithoutProvider,
  noRtcNoTimeSync
]

export {
  serverVersionAdvisories,
  allowReadonlyNonLoopback,
  unstableSerialDevicePath,
  noRealtimeClock,
  venusRawDeviceInstance,
  btSensorsScanStarvation,
  alarmPathDead,
  noDataConnections,
  fallbackIsPrimary,
  canBusWithoutProvider,
  noRtcNoTimeSync
}
