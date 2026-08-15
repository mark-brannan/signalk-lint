/**
 * Core types for signalk-lint.
 *
 * The pipeline is deliberately shaped like a linter:
 *
 *     collect(...)            -> Snapshot     // the only code that performs I/O
 *     lint(snapshot, config)  -> LintResult   // pure, offline, testable
 *
 * Rules never touch a live server. If a rule needs to know something, that
 * something must first be captured into the Snapshot. This is the constraint
 * that keeps rules unit-testable against fixtures and keeps the whole tool
 * usable at anchor with no internet -- which is where boat projects actually
 * happen. Break it once and none of the rest holds.
 */

/**
 * Snapshot format version. Bump on any breaking shape change.
 *
 * 1 -> 2: `server.pluginConfig` and `server.system.hasRTC` were added, and
 * plugin config values are now redacted on capture. The version was not bumped
 * when the fields landed, which is why `parseSnapshot` has to treat a v1
 * capture as "fields absent" rather than trusting the number alone -- a v1
 * snapshot may or may not carry them. Bumping now is what lets a v2 reader
 * know redaction was applied, rather than inferring it from the values.
 *
 * 2 -> 3: `host` was added -- facts about the machine under the server (/sys,
 * /etc, systemd, cron) rather than the server's own files. Older captures
 * arrive with `host: null`, which already means "could not determine" -- an
 * older capture is exactly one that could not determine them.
 */
export const SNAPSHOT_SCHEMA_VERSION = 3

/** Finding format version. Consumers should check this before trusting fields. */
export const FINDING_SCHEMA_VERSION = 1

export type Severity = 'off' | 'info' | 'warn' | 'error'

/**
 * Where a rule's authority comes from.
 *
 * This is surfaced to users because the findings are argued differently: an
 * `advisory` is a fact you can look up, an `opinion` is a conversation we are
 * inviting. Conflating the two is how a linter loses trust.
 */
export type Provenance =
  /** A published CVE / GitHub Security Advisory. Not our judgement. */
  | 'advisory'
  /**
   * Stated in the governing specification or official documentation -- Signal
   * K's for Signal K behaviour, the subsystem's own for host behaviour (a rule
   * about systemd unit syntax answers to systemd's documentation, and citing
   * it there is the same honesty as citing the Signal K spec).
   */
  | 'documented'
  /** Widespread practice in the Signal K community, not formally written down. */
  | 'convention'
  /** Our judgement. Arguable in good faith; say so plainly. */
  | 'opinion'

// ---------------------------------------------------------------------------
// Snapshot -- the "source file" a rule analyses
// ---------------------------------------------------------------------------

export interface SnapshotSource {
  /**
   * How this snapshot was obtained. Some rules can only run against some
   * sources, so they must be able to tell.
   */
  kind: 'config-dir' | 'plugin-runtime' | 'fixture'
  /** Absolute path to the Signal K config directory, when known. */
  configDir?: string
}

export interface Snapshot {
  schemaVersion: number
  /** ISO 8601 timestamp of capture. */
  capturedAt: string
  source: SnapshotSource
  server: ServerFacts
  /**
   * Facts about the machine under the server: /sys, /etc, systemd, cron.
   * null when the capture could not look at all -- a non-Linux platform, or a
   * snapshot from before this section existed. Individual groups inside are
   * null when that one group could not be determined; see HostFacts.
   */
  host: HostFacts | null
}

// ---------------------------------------------------------------------------
// Host facts -- the machine under the server
// ---------------------------------------------------------------------------

/**
 * Everything here follows one degradation contract, because these facts only
 * exist on a Linux box that looks like a boat computer, and the tool also runs
 * in CI, in a dev container and on a laptop:
 *
 *   - a group is `null` when the collector could not determine anything about
 *     it (the file or /sys tree is absent or unreadable, the command failed).
 *     A rule that declares the group in `Rule.hostFacts` is then skipped --
 *     visibly, via `LintResult.unevaluated` -- rather than run against facts
 *     it does not have.
 *   - a group that is present but empty (`[]`) means "looked, found none",
 *     which is an answer, not an absence. A rule runs against it normally.
 *   - a field inside a group is `null` when that one fact could not be
 *     determined; the rule decides what silence it owes, same as everywhere
 *     else in this codebase.
 *
 * Line-oriented captures (cron, autostart, systemd drop-ins) carry raw file
 * lines, because judging them is the rules' job -- but raw lines are the same
 * hazard plugin config was: a `KEY=VALUE` assignment can hold a credential.
 * The collector redacts credential-shaped assignments on the way in, under
 * the same denylist limits documented for plugin config.
 */
export interface HostFacts {
  /** Network interfaces from /sys/class/net. */
  network: NetworkInterfaceFacts[] | null
  /** gpsd's device list from /etc/default/gpsd. null when gpsd is not set up there. */
  gpsd: GpsdFacts | null
  /** systemd drop-in files under /etc/systemd/system/*.d/. */
  systemdDropins: SystemdDropinFacts[] | null
  /** Cron tables: /etc/crontab, /etc/cron.d/*, and readable user crontabs. */
  cron: HostFileFacts[] | null
  /** Desktop autostart files (lxsession, labwc, wayfire, ~/.config/autostart). */
  autostart: HostFileFacts[] | null
  /** Display connectors from /sys/class/drm. */
  drm: DrmConnectorFacts[] | null
  /** Clock synchronization state, from timedatectl. */
  time: TimeSyncFacts | null
  /** Hardware watchdog: systemd's runtime setting and the /sys device view. */
  watchdog: WatchdogFacts | null
  /** journald's effective size configuration. */
  journald: JournaldFacts | null
}

export interface NetworkInterfaceFacts {
  name: string
  /** ARPHRD_* link type from /sys/class/net/<name>/type; 280 is CAN. */
  type: number | null
  /** IFF_UP bit of /sys/class/net/<name>/flags -- administratively up. */
  up: boolean | null
  /** /sys/class/net/<name>/operstate, e.g. "up", "down", "unknown". */
  operstate: string | null
}

export interface GpsdFacts {
  /** The file the device list came from, e.g. /etc/default/gpsd. */
  file: string
  /**
   * Each device gpsd is configured to read, with whether the path existed at
   * capture. Existence is captured here because rules cannot perform I/O.
   */
  devices: { path: string; exists: boolean }[]
}

export interface SystemdDropinFacts {
  /** The unit the drop-in applies to, e.g. "signalk.service". */
  unit: string
  /** Absolute path of the drop-in file. */
  file: string
  /** Raw lines, credential-shaped assignments redacted. */
  lines: string[]
}

/** A captured text file: cron tables, autostart files. */
export interface HostFileFacts {
  /** Absolute path the lines came from. */
  file: string
  /** Raw lines, credential-shaped assignments redacted. */
  lines: string[]
}

export interface DrmConnectorFacts {
  /** Connector name under /sys/class/drm, e.g. "card1-HDMI-A-1". */
  connector: string
  /** "connected", "disconnected" or "unknown". */
  status: string
}

export interface TimeSyncFacts {
  /** Whether an NTP service is enabled (timedatectl's NTP property). */
  ntp: boolean | null
  /** Whether the kernel reports the clock synchronized (NTPSynchronized). */
  ntpSynchronized: boolean | null
}

export interface WatchdogFacts {
  /**
   * systemd's RuntimeWatchdogUSec, verbatim as `systemctl show` printed it
   * ("0", "10s", "1min 30s"). Kept raw so evidence shows what was observed.
   */
  runtimeWatchdogRaw: string | null
  /** The same value parsed to whole seconds, or null when unparseable. */
  runtimeWatchdogSec: number | null
  /**
   * Watchdog devices under /sys/class/watchdog with their current timeout.
   * Empty means the class exists with no devices -- no hardware watchdog.
   */
  devices: { name: string; timeoutSec: number | null }[] | null
}

export interface JournaldFacts {
  /** Storage= from journald.conf(.d), or null when not explicitly set. */
  storage: string | null
  /** SystemMaxUse= from journald.conf(.d), or null when not explicitly set. */
  systemMaxUse: string | null
  /** Whether /var/log/journal exists -- the marker for a persistent journal. */
  persistentJournalDir: boolean
  /** The config files that were actually read, for evidence. */
  files: string[]
}

export interface SystemInfo {
  /** Node.js version, e.g. "v22.11.0" */
  nodeVersion: string
  /** Operating system, e.g. "linux" */
  platform: string
  /** CPU architecture, e.g. "arm64" */
  arch: string
  /** Total system memory in bytes, or null if unavailable */
  totalMemMB: number | null
  /**
   * Disk usage of the filesystem holding the config directory -- not the
   * root filesystem. A boat Pi often has the SD card (config) and a data
   * drive on different mounts, so statting the actual config path is what
   * makes "am I about to fill the SD card" a meaningful question.
   */
  disk: DiskInfo | null
  /**
   * Whether a real-time clock device node exists (/dev/rtc0). null when the
   * platform isn't Linux -- there's no equivalent convention to check, and a
   * false there would misreport "no RTC" on a dev laptop that has nothing to
   * do with the question.
   *
   * A device node existing is necessary but not sufficient: some hardware
   * (Raspberry Pi 5 and later) ships an RTC chip that only holds time across
   * a power cycle once a battery is physically connected. This check cannot
   * tell a populated RTC from an unpopulated one -- both show a device node.
   */
  hasRTC: boolean | null
}

export interface DiskInfo {
  totalMB: number
  usedMB: number
  /** 0-100, rounded to one decimal place. */
  usedPercent: number
}

export interface ServerFacts {
  /**
   * Installed signalk-server version, or null when it could not be determined.
   * Null is a meaningful state, not a failure to paper over -- rules should
   * report that they could not evaluate rather than silently passing.
   */
  version: string | null
  /** Parsed settings.json, or null if absent/unreadable. */
  settings: Record<string, unknown> | null
  /** Facts derived from security.json. Never contains secrets. */
  security: SecurityFacts | null
  /**
   * Parsed priorities.json. An empty object means the file exists but no
   * source priorities are configured -- which is different from null (absent).
   */
  sourcePriorities: Record<string, unknown> | null
  /** System info (Node version, OS, arch). */
  system: SystemInfo
  /**
   * Every plugin's saved config, keyed by plugin id (the JSON filename under
   * plugin-config-data/, e.g. "venus", "signalk-datetime" -- not always the
   * same as the npm package name; verify per plugin, don't assume). null
   * when the directory itself is absent.
   *
   * Read generically here so plugin-specific knowledge stays in rules, not
   * in the collector -- matching how sourcePriorities works. A rule that
   * knows a particular plugin's config shape reaches into this by id.
   */
  pluginConfig: Record<string, unknown> | null
}

/**
 * Security posture, reduced to facts.
 *
 * Deliberately does NOT carry secretKey, password hashes, tokens or device
 * credentials. A snapshot should be safe to paste into a bug report, because
 * people will paste them into bug reports.
 */
export interface SecurityFacts {
  /** True when security.json exists at all. */
  configured: boolean
  /** Whether unauthenticated clients may read the data model. */
  allowReadonly: boolean | null
  /** Number of configured users. Zero with `configured: true` is suspicious. */
  userCount: number | null
  /** Number of authorised devices. */
  deviceCount: number | null
  allowNewUserRegistration: boolean | null
  allowDeviceAccessRequests: boolean | null
}

// ---------------------------------------------------------------------------
// Findings -- what a rule emits
// ---------------------------------------------------------------------------

/**
 * A concrete pointer to what triggered a finding.
 *
 * Evidence is what separates a linter from a horoscope: every finding must be
 * able to show its work.
 */
export interface Evidence {
  /** Dotted path into the snapshot, e.g. `server.security.allowReadonly`. */
  path: string
  /** The value observed there. */
  value: unknown
  /** Optional file this came from, relative to the config directory. */
  file?: string
}

/**
 * A described change that would resolve a finding.
 *
 * Nothing in signalk-lint executes these -- the tool is read-only by design.
 * They exist as data from day one so that the eventual write path (if there
 * ever is one) consumes a descriptor that has already been shipped, reviewed
 * and argued about for a long time, rather than being invented late.
 *
 * In read-only mode this renders as instructions a human follows.
 */
export interface Remediation {
  kind: 'upgrade-package' | 'set-config' | 'manual'
  /** Human-readable instruction. Always present. */
  description: string
  /** Dotted config path to change, for `set-config`. */
  target?: string
  currentValue?: unknown
  proposedValue?: unknown
}

export interface Finding {
  schemaVersion: number
  /** Stable rule identifier, e.g. `server/known-vulnerability`. */
  ruleId: string
  severity: Severity
  /** One line. Shown in list views. */
  title: string
  /** Full explanation, including why it matters on a boat. */
  detail: string
  provenance: Provenance
  evidence: Evidence[]
  remediation?: Remediation
  /** Links to advisories, docs, or discussion. */
  references?: string[]
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface Rule {
  /** Stable across versions. Users disable rules by this id. */
  id: string
  /** One-line description, shown by `--list-rules`. */
  description: string
  defaultSeverity: Severity
  provenance: Provenance
  /**
   * True for rules that reason about the live data model (which paths are
   * actually reporting) rather than static config files.
   *
   * Unset/false today for every shipped rule -- config files are complete the
   * instant the server starts, so there's nothing to wait for. This exists so
   * a future scheduler has something to key off of: a live-data rule run
   * moments after boot will false-positive on paths that just haven't arrived
   * yet, and a naive fix (delay every rule by N minutes) is the wrong shape --
   * it penalizes config rules that were already correct at t=0. See
   * src/index.ts for the open scheduling question this doesn't yet answer.
   */
  requiresLiveData?: boolean
  /**
   * Host fact groups this rule reads. `lint()` checks them before calling
   * `evaluate`: if any declared group is null in the snapshot -- non-Linux,
   * an older capture, a source that could not see it -- the rule is skipped
   * and recorded in `LintResult.unevaluated` instead of being run.
   *
   * This is the degradation contract for host rules stated once, in the
   * engine, rather than re-implemented as a null-check prologue in every
   * rule: a rule that cannot get its facts must skip visibly -- not crash,
   * and not silently pass as if it had looked.
   */
  hostFacts?: (keyof HostFacts)[]
  /**
   * Pure function. No I/O, no clock, no randomness, no network.
   *
   * Returns findings without severity applied -- `lint()` overlays the
   * configured severity, so a rule never needs to know how it was configured.
   */
  evaluate(snapshot: Snapshot): RuleFinding[]
}

/** What a rule returns: a Finding minus the fields lint() fills in. */
export type RuleFinding = Omit<
  Finding,
  'schemaVersion' | 'ruleId' | 'severity' | 'provenance'
> & {
  /**
   * Optional per-finding severity override, for rules that emit findings of
   * genuinely different weight (a critical CVE and a low one are not the same
   * finding at the same level).
   */
  severity?: Severity
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LintConfig {
  /**
   * Preset to inherit from. Presets are how the community encodes differing
   * expectations -- a charter operation and a solo cruiser disagree about
   * defaults in good faith, and neither should have to argue with us.
   */
  extends?: string
  /** Per-rule severity overrides. `off` disables. */
  rules?: Record<string, Severity>
}

export interface LintResult {
  snapshot: Snapshot
  findings: Finding[]
  /** Rules that were skipped because they were configured `off`. */
  skipped: string[]
  /**
   * Rules that could not run because a host fact group they declared is null
   * in this snapshot. Distinct from `skipped` because the two mean opposite
   * things to a reader: `skipped` is a choice the user made, `unevaluated` is
   * a check that did not happen -- and "did not happen" must never be
   * mistakable for "looked and found nothing".
   */
  unevaluated: { ruleId: string; missing: string[] }[]
}
