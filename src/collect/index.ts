/**
 * Collectors: the only code in this package that performs I/O.
 *
 * A collector's whole job is to turn a live, messy, partially-readable Signal K
 * installation into one serializable Snapshot. Everything downstream is pure.
 *
 * Collectors are deliberately forgiving: a missing or unreadable file yields
 * `null`, not an exception. Half a snapshot is useful; a crash is not. Rules
 * are responsible for saying "I could not evaluate this" when they see a null.
 */
import { readFile, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { arch, platform, totalmem } from 'node:os'
import {
  SNAPSHOT_SCHEMA_VERSION,
  DiskInfo,
  SecurityFacts,
  ServerFacts,
  SystemInfo,
  Snapshot
} from '../types.js'

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function countOf(v: unknown): number | null {
  return Array.isArray(v) ? v.length : null
}

/**
 * Reduce security.json to facts.
 *
 * Note what is *not* carried across: secretKey, user password hashes, device
 * tokens. Snapshots get pasted into bug reports and shared with people helping
 * you debug -- so a snapshot must never be a credential disclosure. Rules do
 * not need the secrets to reason about posture.
 */
function securityFactsFrom(raw: Record<string, unknown> | null): SecurityFacts {
  if (raw === null) {
    return {
      configured: false,
      allowReadonly: null,
      userCount: null,
      deviceCount: null,
      allowNewUserRegistration: null,
      allowDeviceAccessRequests: null
    }
  }
  return {
    configured: true,
    allowReadonly: asBool(raw.allow_readonly),
    userCount: countOf(raw.users),
    deviceCount: countOf(raw.devices),
    allowNewUserRegistration: asBool(raw.allowNewUserRegistration),
    allowDeviceAccessRequests: asBool(raw.allowDeviceAccessRequests)
  }
}

export interface CollectOptions {
  /** Path to the Signal K config directory (the one holding settings.json). */
  configDir: string
  /**
   * Installed signalk-server version. Supplied by the caller because the
   * config directory does not contain it: at runtime a plugin reads
   * `app.config.version`, and the CLI takes a flag or probes the install.
   */
  serverVersion?: string | null
  /** Overrides the capture timestamp. Tests pass a fixed value. */
  now?: Date
}

/**
 * Disk usage of the filesystem holding `configDir`, not the root filesystem.
 * `statfs` reports blocks in units of `bsize`, which varies by filesystem --
 * everything below is normalized to MB before it leaves this function.
 */
async function diskInfo(configDir: string): Promise<DiskInfo | null> {
  try {
    const stats = await statfs(configDir)
    const blockToMB = stats.bsize / (1024 * 1024)
    const totalMB = Math.round(stats.blocks * blockToMB)
    const freeMB = Math.round(stats.bfree * blockToMB)
    const usedMB = totalMB - freeMB
    const usedPercent =
      totalMB > 0 ? Math.round((usedMB / totalMB) * 1000) / 10 : 0
    return { totalMB, usedMB, usedPercent }
  } catch {
    // Not every platform/filesystem supports statfs. Absence is a fact, not
    // a failure -- same convention as every other collector in this file.
    return null
  }
}

async function systemInfo(configDir: string): Promise<SystemInfo> {
  const totalBytes = totalmem()
  return {
    nodeVersion: process.version,
    platform: platform(),
    arch: arch(),
    totalMemMB: totalBytes ? Math.round(totalBytes / (1024 * 1024)) : null,
    disk: await diskInfo(configDir)
  }
}

export async function collect(options: CollectOptions): Promise<Snapshot> {
  const { configDir, serverVersion = null, now = new Date() } = options

  const [settings, security, sourcePriorities, system] = await Promise.all([
    readJson(join(configDir, 'settings.json')),
    readJson(join(configDir, 'security.json')),
    readJson(join(configDir, 'priorities.json')),
    systemInfo(configDir)
  ])

  const server: ServerFacts = {
    version: serverVersion,
    settings,
    security: securityFactsFrom(security),
    sourcePriorities,
    system
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: now.toISOString(),
    source: { kind: 'config-dir', configDir },
    server
  }
}
