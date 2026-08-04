import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serverVersionAdvisories } from '../../src/rules/server-version-advisories.js'
import { lint } from '../../src/lint.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = serverVersionAdvisories

describe('server/known-vulnerability', () => {
  it('flags a server affected by published advisories', () => {
    const findings = rule.evaluate(fixture('vulnerable-server'))
    expect(findings.length).toBeGreaterThan(0)
  })

  it('recommends a single upgrade target that clears every match', () => {
    const findings = rule.evaluate(fixture('vulnerable-server'))
    const targets = new Set(
      findings
        .map((f) => f.remediation)
        .filter((r) => r?.kind === 'upgrade-package')
        .map((r) => r?.proposedValue)
    )
    // One recommendation, not one per advisory -- nobody should be told to
    // upgrade three times.
    expect(targets.size).toBe(1)
  })

  it('cites an advisory URL for every finding', () => {
    const findings = rule.evaluate(fixture('vulnerable-server'))
    for (const f of findings) {
      expect(f.references?.[0]).toMatch(
        /^https:\/\/github\.com\/advisories\/GHSA-/
      )
    }
  })

  it('shows its evidence', () => {
    const findings = rule.evaluate(fixture('vulnerable-server'))
    for (const f of findings) {
      expect(f.evidence[0]?.path).toBe('server.version')
      expect(f.evidence[0]?.value).toBe('2.18.0')
    }
  })

  it('passes a server newer than every advisory', () => {
    expect(rule.evaluate(fixture('current-server'))).toEqual([])
  })

  it('reports rather than silently passes when the version is unknown', () => {
    const findings = rule.evaluate(fixture('unknown-version'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.title).toMatch(/[Cc]ould not determine/)
  })

  it('reports rather than throws on an unparseable version', () => {
    const snapshot = fixture('vulnerable-server')
    snapshot.server.version = 'v2-custom-build'
    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toMatch(/Unparseable/)
  })

  it('matches prerelease versions against prerelease-patched advisories', () => {
    // Several Signal K advisories were fixed in betas (`< 2.24.0-beta.4`).
    // Without includePrerelease, semver silently matches nothing and the whole
    // rule becomes a no-op for anyone running a beta.
    const findings = rule.evaluate(fixture('prerelease-server'))
    expect(findings.length).toBeGreaterThan(0)
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('vulnerable-server')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})

describe('lint()', () => {
  it('stamps rule id, provenance and schema version onto findings', () => {
    const { findings } = lint(fixture('vulnerable-server'))
    for (const f of findings) {
      expect(f.ruleId).toBe('server/known-vulnerability')
      expect(f.provenance).toBe('advisory')
      expect(f.schemaVersion).toBe(1)
    }
  })

  it('sorts findings by descending severity', () => {
    const { findings } = lint(fixture('vulnerable-server'))
    const rank = { off: 0, info: 1, warn: 2, error: 3 } as const
    for (let i = 1; i < findings.length; i++) {
      expect(rank[findings[i - 1]!.severity]).toBeGreaterThanOrEqual(
        rank[findings[i]!.severity]
      )
    }
  })

  it('honours a rule being configured off', () => {
    const result = lint(fixture('vulnerable-server'), {
      rules: { 'server/known-vulnerability': 'off' }
    })
    expect(result.findings).toEqual([])
    expect(result.skipped).toContain('server/known-vulnerability')
  })

  it('lets an explicit severity override the rule default', () => {
    const { findings } = lint(fixture('vulnerable-server'), {
      rules: { 'server/known-vulnerability': 'info' }
    })
    expect(findings.every((f) => f.severity === 'info')).toBe(true)
  })

  it('rejects an unknown preset rather than silently linting with defaults', () => {
    expect(() => lint(fixture('current-server'), { extends: 'nope' })).toThrow(
      /Unknown preset/
    )
  })
})
