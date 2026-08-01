/**
 * Core types for signalk-lint.
 *
 * The pipeline is deliberately shaped like a linter:
 *
 *     collect(...)            -> Snapshot     // the only code that performs I/O
 *     lint(snapshot, config)  -> Finding[]    // pure, offline, testable
 *
 * Rules never touch a live server. If a rule needs to know something, that
 * something must first be captured into the Snapshot. This is the constraint
 * that keeps rules unit-testable against fixtures and keeps the whole tool
 * usable at anchor with no internet -- which is where boat projects actually
 * happen. Break it once and none of the rest holds.
 */

/** Snapshot format version. Bump on any breaking shape change. */
export const SNAPSHOT_SCHEMA_VERSION = 1

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
  /** Stated in the Signal K specification or official documentation. */
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
}
