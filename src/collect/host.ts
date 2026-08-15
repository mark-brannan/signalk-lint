/**
 * Host facts collector: the machine under the server.
 *
 * Batch-2 rules reason about /sys, /etc, systemd and process state -- things
 * the config directory cannot show. This module gathers them once, into
 * `Snapshot.host`, under the same contract as every other collector: a
 * missing or unreadable source yields `null`, never an exception.
 *
 * Degradation is the design here, not an afterthought. This code also runs in
 * CI, in a dev container and on a Mac, none of which have a CAN bus or a
 * hardware watchdog:
 *
 *   - off Linux, the whole section is null -- every path below is a Linux
 *     convention, and probing for it elsewhere would manufacture facts.
 *   - on Linux, each group degrades independently: `null` for "could not
 *     look", `[]` for "looked, found none". lint() skips -- visibly -- any
 *     rule whose declared groups are null, so a rule never has to tell those
 *     apart itself.
 *
 * `root` and `exec` are injectable so tests can point this at a fixture tree
 * and a canned command runner. Production callers pass nothing.
 */
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { homedir, platform } from 'node:os'
import {
  DrmConnectorFacts,
  GpsdFacts,
  HostFacts,
  HostFileFacts,
  JournaldFacts,
  NetworkInterfaceFacts,
  SystemdDropinFacts,
  TimeSyncFacts,
  WatchdogFacts
} from '../types.js'
import { redactAssignmentLine } from './redact.js'

export type ExecFn = (cmd: string, args: string[]) => Promise<string | null>

/**
 * Runs a command for a fact that has no file to read (timedatectl, systemctl
 * show). Bounded and forgiving: a box without systemd, or a container without
 * D-Bus, answers with an error and that becomes null -- the same "could not
 * determine" every file-based collector produces.
 */
const defaultExec: ExecFn = (cmd, args) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout)
    )
  })

export interface HostCollectOptions {
  /** Filesystem prefix, '/' in production. Tests point this at a fixture tree. */
  root?: string
  /** Home directory for user-level files, or null to skip them. */
  home?: string | null
  platform?: string
  exec?: ExecFn
}

async function readLines(path: string): Promise<string[] | null> {
  try {
    const contents = await readFile(path, 'utf8')
    return contents.split('\n').map(redactAssignmentLine)
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const ARPHRD_CAN = 280
export { ARPHRD_CAN }

async function readTrimmed(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return null
  }
}

async function network(root: string): Promise<NetworkInterfaceFacts[] | null> {
  const base = join(root, 'sys/class/net')
  let names: string[]
  try {
    names = await readdir(base)
  } catch {
    return null
  }
  return Promise.all(
    names.sort().map(async (name) => {
      const typeRaw = await readTrimmed(join(base, name, 'type'))
      const flagsRaw = await readTrimmed(join(base, name, 'flags'))
      const type = typeRaw === null ? null : parseInt(typeRaw, 10)
      // flags is hex ("0x1003"); IFF_UP is bit 0 -- administratively up,
      // which for a CAN interface is the meaningful state. operstate is
      // captured too but is "unknown" on many CAN drivers, so it cannot be
      // the primary fact.
      const flags = flagsRaw === null ? null : parseInt(flagsRaw, 16)
      return {
        name,
        type: type !== null && Number.isFinite(type) ? type : null,
        up: flags !== null && Number.isFinite(flags) ? (flags & 1) === 1 : null,
        operstate: await readTrimmed(join(base, name, 'operstate'))
      }
    })
  )
}

/**
 * gpsd's Debian-convention config. `DEVICES="..."` in /etc/default/gpsd is
 * where Raspberry Pi OS and every Debian derivative put the device list; a
 * gpsd configured some other way is out of scope and yields null, which makes
 * the rule skip rather than guess.
 */
async function gpsd(root: string): Promise<GpsdFacts | null> {
  const file = join(root, 'etc/default/gpsd')
  let contents: string
  try {
    contents = await readFile(file, 'utf8')
  } catch {
    return null
  }
  const devices: { path: string; exists: boolean }[] = []
  for (const line of contents.split('\n')) {
    const match = /^\s*DEVICES\s*=\s*("([^"]*)"|'([^']*)'|(\S*))\s*$/.exec(line)
    if (!match) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    for (const path of value.split(/\s+/).filter(Boolean)) {
      // Existence is captured now because rules cannot perform I/O later.
      devices.push({ path, exists: await exists(join(root, path)) })
    }
  }
  return { file: '/etc/default/gpsd', devices }
}

async function systemdDropins(
  root: string
): Promise<SystemdDropinFacts[] | null> {
  const base = join(root, 'etc/systemd/system')
  let entries: string[]
  try {
    entries = await readdir(base)
  } catch {
    return null
  }
  const dropins: SystemdDropinFacts[] = []
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.d')) continue
    const dir = join(base, entry)
    let files: string[]
    try {
      if (!(await stat(dir)).isDirectory()) continue
      files = await readdir(dir)
    } catch {
      continue
    }
    for (const name of files.sort()) {
      if (!name.endsWith('.conf')) continue
      const lines = await readLines(join(dir, name))
      if (lines === null) continue
      dropins.push({
        unit: entry.slice(0, -'.d'.length),
        file: join('/etc/systemd/system', entry, name),
        lines
      })
    }
  }
  return dropins
}

/**
 * Cron tables, from the three places Debian keeps them. A user crontab that
 * is unreadable (they are mode 600) is silently absent from the result -- a
 * rule reading this sees less, not wrong, and the failure direction is
 * silence rather than a false finding.
 */
async function cron(root: string): Promise<HostFileFacts[] | null> {
  try {
    const files: HostFileFacts[] = []
    const push = async (abs: string, display: string): Promise<void> => {
      const lines = await readLines(abs)
      if (lines !== null) files.push({ file: display, lines })
    }
    await push(join(root, 'etc/crontab'), '/etc/crontab')
    for (const dir of ['etc/cron.d', 'var/spool/cron/crontabs']) {
      let names: string[]
      try {
        names = await readdir(join(root, dir))
      } catch {
        continue
      }
      for (const name of names.sort()) {
        await push(join(root, dir, name), join('/', dir, name))
      }
    }
    return files
  } catch {
    return null
  }
}

/**
 * Where a Raspberry Pi desktop starts things: lxsession (X11), labwc and
 * wayfire (Wayland), and freedesktop ~/.config/autostart entries. The list is
 * candidates, not a guarantee -- a session started some way not listed here
 * is invisible, which fails toward silence.
 */
async function autostart(
  root: string,
  home: string | null
): Promise<HostFileFacts[] | null> {
  try {
    const files: HostFileFacts[] = []
    const push = async (abs: string, display: string): Promise<void> => {
      const lines = await readLines(abs)
      if (lines !== null) files.push({ file: display, lines })
    }

    const sessionDirs = [join(root, 'etc/xdg/lxsession')]
    if (home !== null) sessionDirs.push(join(root, home, '.config/lxsession'))
    for (const base of sessionDirs) {
      let names: string[]
      try {
        names = await readdir(base)
      } catch {
        continue
      }
      for (const name of names.sort()) {
        const abs = join(base, name, 'autostart')
        await push(
          abs,
          abs.startsWith(root)
            ? '/' + abs.slice(root.length).replace(/^\/+/, '')
            : abs
        )
      }
    }

    if (home !== null) {
      const homeRoot = join(root, home)
      await push(
        join(homeRoot, '.config/labwc/autostart'),
        join(home, '.config/labwc/autostart')
      )
      await push(
        join(homeRoot, '.config/wayfire.ini'),
        join(home, '.config/wayfire.ini')
      )
      const desktopDir = join(homeRoot, '.config/autostart')
      try {
        for (const name of (await readdir(desktopDir)).sort()) {
          if (!name.endsWith('.desktop')) continue
          await push(
            join(desktopDir, name),
            join(home, '.config/autostart', name)
          )
        }
      } catch {
        // No user autostart directory is the common case, not a failure.
      }
    }
    return files
  } catch {
    return null
  }
}

async function drm(root: string): Promise<DrmConnectorFacts[] | null> {
  const base = join(root, 'sys/class/drm')
  let names: string[]
  try {
    names = await readdir(base)
  } catch {
    return null
  }
  const connectors: DrmConnectorFacts[] = []
  for (const name of names.sort()) {
    // Connectors are card<N>-<output>; the bare card<N> device and version
    // files also live here and have no status.
    if (!/^card\d+-/.test(name)) continue
    const status = await readTrimmed(join(base, name, 'status'))
    if (status !== null) connectors.push({ connector: name, status })
  }
  return connectors
}

function yesNo(value: string | undefined): boolean | null {
  if (value === 'yes') return true
  if (value === 'no') return false
  return null
}

async function time(exec: ExecFn): Promise<TimeSyncFacts | null> {
  const out = await exec('timedatectl', ['show'])
  if (out === null) return null
  const props = new Map<string, string>()
  for (const line of out.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) props.set(line.slice(0, eq), line.slice(eq + 1).trim())
  }
  return {
    ntp: yesNo(props.get('NTP')),
    ntpSynchronized: yesNo(props.get('NTPSynchronized'))
  }
}

/**
 * Parse systemctl's formatted timespan ("10s", "1min 30s", "0") to seconds.
 * Unknown forms ("infinity", garbage) yield null rather than a wrong number.
 */
export function parseTimespanSec(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '0') return 0
  const UNITS: Record<string, number> = {
    usec: 1e-6,
    us: 1e-6,
    µs: 1e-6,
    msec: 1e-3,
    ms: 1e-3,
    s: 1,
    sec: 1,
    second: 1,
    seconds: 1,
    min: 60,
    minute: 60,
    minutes: 60,
    m: 60,
    h: 3600,
    hr: 3600,
    hour: 3600,
    hours: 3600,
    d: 86400,
    day: 86400,
    days: 86400,
    w: 604800,
    week: 604800,
    weeks: 604800
  }
  let total = 0
  let matchedTo = 0
  const pattern = /\s*(\d+(?:\.\d+)?)\s*([a-zµ]+)/gy
  let match: RegExpExecArray | null
  while ((match = pattern.exec(trimmed)) !== null) {
    // UNITS is a plain object literal, so it inherits Object.prototype -- a
    // token like "constructor" would otherwise resolve to a function rather
    // than undefined, and `Number * function` is NaN, not the null this
    // function promises for an unknown unit.
    if (!Object.hasOwn(UNITS, match[2])) return null
    total += Number(match[1]) * UNITS[match[2]]
    matchedTo = pattern.lastIndex
  }
  return matchedTo === trimmed.length && matchedTo > 0 ? total : null
}

/**
 * Some systemd versions print `*USec`-suffixed D-Bus properties like
 * RuntimeWatchdogUSec as a bare integer count of microseconds rather than the
 * pretty "30s" / "1min 30s" form -- verified both ways: systemd 252 (Debian
 * 12, the boat this rule comes from) prints "30s", but documentation for
 * newer systemd describes the bare-microseconds form as the norm for `USec`
 * properties. Both are accepted here rather than assumed. Rounded to whole
 * seconds because that is what this value is compared against:
 * /sys/class/watchdog's integer timeout.
 */
function parseWatchdogSec(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Math.round(Number(raw) / 1e6)
  const parsed = parseTimespanSec(raw)
  return parsed === null ? null : Math.round(parsed)
}

async function watchdog(
  root: string,
  exec: ExecFn
): Promise<WatchdogFacts | null> {
  const raw = await exec('systemctl', [
    'show',
    '--property=RuntimeWatchdogUSec',
    '--value'
  ])
  const runtimeWatchdogRaw = raw === null ? null : raw.trim()

  let devices: WatchdogFacts['devices'] = null
  try {
    const names = await readdir(join(root, 'sys/class/watchdog'))
    devices = await Promise.all(
      names.sort().map(async (name) => {
        const timeout = await readTrimmed(
          join(root, 'sys/class/watchdog', name, 'timeout')
        )
        const parsed = timeout === null ? NaN : parseInt(timeout, 10)
        return { name, timeoutSec: Number.isFinite(parsed) ? parsed : null }
      })
    )
  } catch {
    devices = null
  }

  // Neither side visible means there is nothing to say about watchdogs at
  // all -- null, so the rule skips instead of running on two unknowns.
  if (runtimeWatchdogRaw === null && devices === null) return null
  return {
    runtimeWatchdogRaw,
    runtimeWatchdogSec:
      runtimeWatchdogRaw === null ? null : parseWatchdogSec(runtimeWatchdogRaw),
    devices
  }
}

/**
 * journald's explicit size configuration: the main file plus conf.d, later
 * files overriding earlier, matching systemd's own precedence. Only explicit
 * assignments are captured -- an unset SystemMaxUse is the fact the rule
 * cares about, so the collector must not fill in the compiled-in default.
 */
async function journald(root: string): Promise<JournaldFacts | null> {
  try {
    const candidates = [join(root, 'etc/systemd/journald.conf')]
    try {
      const dir = join(root, 'etc/systemd/journald.conf.d')
      for (const name of (await readdir(dir)).sort()) {
        if (name.endsWith('.conf')) candidates.push(join(dir, name))
      }
    } catch {
      // No conf.d is the normal case.
    }

    let storage: string | null = null
    let systemMaxUse: string | null = null
    const files: string[] = []
    for (const path of candidates) {
      let contents: string
      try {
        contents = await readFile(path, 'utf8')
      } catch {
        continue
      }
      files.push('/' + path.slice(root.length).replace(/^\/+/, ''))
      let section: string | null = null
      for (const line of contents.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('#') || trimmed.startsWith(';')) continue
        const sectionMatch = /^\[(.+)\]$/.exec(trimmed)
        if (sectionMatch) {
          section = sectionMatch[1]
          continue
        }
        if (section !== 'Journal') continue
        const assignment = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(trimmed)
        if (!assignment) continue
        if (assignment[1] === 'Storage') storage = assignment[2]
        if (assignment[1] === 'SystemMaxUse') {
          systemMaxUse = assignment[2] === '' ? null : assignment[2]
        }
      }
    }
    return {
      storage,
      systemMaxUse,
      persistentJournalDir: await exists(join(root, 'var/log/journal')),
      files
    }
  } catch {
    return null
  }
}

export async function collectHostFacts(
  options: HostCollectOptions = {}
): Promise<HostFacts | null> {
  const {
    root = '/',
    home = safeHomedir(),
    platform: platformName = platform(),
    exec = defaultExec
  } = options

  // Every fact below is a Linux convention. Probing for /sys/class/net on a
  // Mac would not degrade gracefully, it would manufacture a machine that
  // does not exist -- same judgement hasRTC already makes.
  if (platformName !== 'linux') return null

  const [
    networkFacts,
    gpsdFacts,
    dropinFacts,
    cronFacts,
    autostartFacts,
    drmFacts,
    timeFacts,
    watchdogFacts,
    journaldFacts
  ] = await Promise.all([
    network(root),
    gpsd(root),
    systemdDropins(root),
    cron(root),
    autostart(root, home),
    drm(root),
    time(exec),
    watchdog(root, exec),
    journald(root)
  ])

  return {
    network: networkFacts,
    gpsd: gpsdFacts,
    systemdDropins: dropinFacts,
    cron: cronFacts,
    autostart: autostartFacts,
    drm: drmFacts,
    time: timeFacts,
    watchdog: watchdogFacts,
    journald: journaldFacts
  }
}

function safeHomedir(): string | null {
  try {
    const dir = homedir()
    return dir === '' ? null : dir
  } catch {
    return null
  }
}
