/**
 * Shared narrowing for `snapshot.host`.
 *
 * lint() already guarantees a host rule only runs when its declared groups
 * are non-null -- but non-null is not well-shaped. A snapshot loaded from
 * JSON can carry anything: a hand-edited fixture, a capture mangled in
 * transit, a file someone assembled by analogy. A malformed connection entry
 * once crashed an entire lint run, and a linter fails hardest on exactly the
 * box that most needs it -- so the same contract piped-providers.ts states
 * for settings.json holds here: these functions give rules the narrow
 * guarantee they need in order not to throw, returning null when a group is
 * not readable as what it claims to be. They are not schema validation.
 */
import {
  DrmConnectorFacts,
  GpsdFacts,
  HostFileFacts,
  JournaldFacts,
  NetworkInterfaceFacts,
  Snapshot,
  SystemdDropinFacts,
  TimeSyncFacts,
  WatchdogFacts
} from '../types.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * Narrow an array group in one motion: null unless every entry passes.
 * An unreadable entry poisons the whole group rather than being skipped,
 * for the same reason pipedProvidersOf does it -- a rule cannot report on
 * entries it cannot read, and reporting on the rest as if they were all of
 * them is a quiet lie about what was seen.
 */
function arrayOf<T>(
  value: unknown,
  isEntry: (entry: unknown) => entry is T
): T[] | null {
  if (!Array.isArray(value)) return null
  return value.every(isEntry) ? (value as T[]) : null
}

export function networkInterfacesOf(
  snapshot: Snapshot
): NetworkInterfaceFacts[] | null {
  return arrayOf(
    snapshot.host?.network,
    (entry): entry is NetworkInterfaceFacts =>
      isObject(entry) &&
      typeof entry.name === 'string' &&
      isNumberOrNull(entry.type ?? null) &&
      isBooleanOrNull(entry.up ?? null) &&
      isStringOrNull(entry.operstate ?? null)
  )
}

export function gpsdOf(snapshot: Snapshot): GpsdFacts | null {
  const gpsd = snapshot.host?.gpsd
  if (!isObject(gpsd) || typeof gpsd.file !== 'string') return null
  const devices = arrayOf(
    gpsd.devices,
    (entry): entry is { path: string; exists: boolean } =>
      isObject(entry) &&
      typeof entry.path === 'string' &&
      typeof entry.exists === 'boolean'
  )
  return devices === null ? null : { file: gpsd.file, devices }
}

export function systemdDropinsOf(
  snapshot: Snapshot
): SystemdDropinFacts[] | null {
  return arrayOf(
    snapshot.host?.systemdDropins,
    (entry): entry is SystemdDropinFacts =>
      isObject(entry) &&
      typeof entry.unit === 'string' &&
      typeof entry.file === 'string' &&
      isStringArray(entry.lines)
  )
}

function isHostFile(entry: unknown): entry is HostFileFacts {
  return (
    isObject(entry) &&
    typeof entry.file === 'string' &&
    isStringArray(entry.lines)
  )
}

export function cronOf(snapshot: Snapshot): HostFileFacts[] | null {
  return arrayOf(snapshot.host?.cron, isHostFile)
}

export function autostartOf(snapshot: Snapshot): HostFileFacts[] | null {
  return arrayOf(snapshot.host?.autostart, isHostFile)
}

export function drmOf(snapshot: Snapshot): DrmConnectorFacts[] | null {
  return arrayOf(
    snapshot.host?.drm,
    (entry): entry is DrmConnectorFacts =>
      isObject(entry) &&
      typeof entry.connector === 'string' &&
      typeof entry.status === 'string'
  )
}

export function timeOf(snapshot: Snapshot): TimeSyncFacts | null {
  const time = snapshot.host?.time
  if (
    !isObject(time) ||
    !isBooleanOrNull(time.ntp ?? null) ||
    !isBooleanOrNull(time.ntpSynchronized ?? null)
  ) {
    return null
  }
  return {
    ntp: time.ntp ?? null,
    ntpSynchronized: time.ntpSynchronized ?? null
  }
}

export function watchdogOf(snapshot: Snapshot): WatchdogFacts | null {
  const watchdog = snapshot.host?.watchdog
  if (
    !isObject(watchdog) ||
    !isStringOrNull(watchdog.runtimeWatchdogRaw ?? null) ||
    !isNumberOrNull(watchdog.runtimeWatchdogSec ?? null)
  ) {
    return null
  }
  const rawDevices = watchdog.devices ?? null
  const devices =
    rawDevices === null
      ? null
      : arrayOf(
          rawDevices,
          (entry): entry is { name: string; timeoutSec: number | null } =>
            isObject(entry) &&
            typeof entry.name === 'string' &&
            isNumberOrNull(entry.timeoutSec ?? null)
        )
  if (rawDevices !== null && devices === null) return null
  return {
    runtimeWatchdogRaw: watchdog.runtimeWatchdogRaw ?? null,
    runtimeWatchdogSec: watchdog.runtimeWatchdogSec ?? null,
    devices
  }
}

export function journaldOf(snapshot: Snapshot): JournaldFacts | null {
  const journald = snapshot.host?.journald
  if (
    !isObject(journald) ||
    !isStringOrNull(journald.storage ?? null) ||
    !isStringOrNull(journald.systemMaxUse ?? null) ||
    typeof journald.persistentJournalDir !== 'boolean' ||
    !isStringArray(journald.files)
  ) {
    return null
  }
  return {
    storage: journald.storage ?? null,
    systemMaxUse: journald.systemMaxUse ?? null,
    persistentJournalDir: journald.persistentJournalDir,
    files: journald.files
  }
}
