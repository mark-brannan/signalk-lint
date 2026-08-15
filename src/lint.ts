/**
 * The lint core: pure, offline, deterministic.
 *
 * Everything here is a function of (Snapshot, LintConfig). No I/O, no clock,
 * no network. If you find yourself wanting any of those, the thing you want
 * belongs in a collector.
 */
import { rules as allRules } from './rules/index.js'
import {
  FINDING_SCHEMA_VERSION,
  Finding,
  LintConfig,
  LintResult,
  Rule,
  Severity,
  Snapshot
} from './types.js'

const SEVERITY_ORDER: Record<Severity, number> = {
  off: 0,
  info: 1,
  warn: 2,
  error: 3
}

/**
 * Built-in presets.
 *
 * Presets are the mechanism by which people who disagree with our defaults --
 * often correctly, because a charter operation and a solo cruiser have
 * genuinely different obligations -- can encode that disagreement as
 * configuration rather than as an argument in our issue tracker.
 */
export const PRESETS: Record<string, Record<string, Severity>> = {
  recommended: {}
}

function resolveConfig(config: LintConfig): Record<string, Severity> {
  const base = config.extends ? PRESETS[config.extends] : PRESETS.recommended
  if (config.extends && base === undefined) {
    throw new Error(
      `Unknown preset "${config.extends}". Known presets: ${Object.keys(
        PRESETS
      ).join(', ')}`
    )
  }
  return { ...base, ...(config.rules ?? {}) }
}

export function lint(
  snapshot: Snapshot,
  config: LintConfig = {},
  rules: readonly Rule[] = allRules
): LintResult {
  const overrides = resolveConfig(config)
  const findings: Finding[] = []
  const skipped: string[] = []
  const unevaluated: LintResult['unevaluated'] = []

  for (const rule of rules) {
    const configured = overrides[rule.id] ?? rule.defaultSeverity
    if (configured === 'off') {
      skipped.push(rule.id)
      continue
    }

    // The degradation contract for host rules, enforced once here rather than
    // as a null-check prologue in every rule: a rule whose declared facts this
    // snapshot does not carry is skipped visibly -- it must not crash, and it
    // must not be mistakable for "looked and found nothing".
    const missing = (rule.hostFacts ?? [])
      .filter((group) => (snapshot.host?.[group] ?? null) === null)
      .map((group) => `host.${group}`)
    if (missing.length > 0) {
      unevaluated.push({ ruleId: rule.id, missing })
      continue
    }

    for (const raw of rule.evaluate(snapshot)) {
      // A rule may weight its own findings (a critical CVE and a low one are
      // not the same finding), but an explicit user override always wins.
      const severity = overrides[rule.id] ?? raw.severity ?? configured
      findings.push({
        ...raw,
        schemaVersion: FINDING_SCHEMA_VERSION,
        ruleId: rule.id,
        provenance: rule.provenance,
        severity
      })
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.title.localeCompare(b.title)
  )

  return { snapshot, findings, skipped, unevaluated }
}

/** True when any finding would justify a non-zero exit code. */
export function hasErrors(result: LintResult): boolean {
  return result.findings.some((f) => f.severity === 'error')
}
