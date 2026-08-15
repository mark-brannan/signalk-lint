import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lint } from '../src/lint.js'
import { HostFacts, Rule, Snapshot } from '../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

/** A host rule that records whether lint() actually called it. */
function probeRule(hostFacts: (keyof HostFacts)[]): {
  rule: Rule
  calls: () => number
} {
  let calls = 0
  return {
    rule: {
      id: 'host/probe',
      description: 'test probe',
      defaultSeverity: 'warn',
      provenance: 'opinion',
      hostFacts,
      evaluate: () => {
        calls++
        return []
      }
    },
    calls: () => calls
  }
}

describe('lint() host fact gating', () => {
  it('skips a host rule visibly when the snapshot has no host section', () => {
    const { rule, calls } = probeRule(['network'])
    const snapshot = fixture('current-server')
    snapshot.host = null

    const result = lint(snapshot, {}, [rule])

    expect(calls()).toBe(0)
    expect(result.unevaluated).toEqual([
      { ruleId: 'host/probe', missing: ['host.network'] }
    ])
    // Unevaluated is not the same statement as "configured off".
    expect(result.skipped).toEqual([])
  })

  it('skips when one declared group is null, naming exactly the gaps', () => {
    const { rule, calls } = probeRule(['network', 'drm'])
    const snapshot = fixture('host-can0-no-provider')
    snapshot.host!.drm = null

    const result = lint(snapshot, {}, [rule])

    expect(calls()).toBe(0)
    expect(result.unevaluated).toEqual([
      { ruleId: 'host/probe', missing: ['host.drm'] }
    ])
  })

  it('runs the rule when its declared groups are present', () => {
    const { rule, calls } = probeRule(['network'])
    const result = lint(fixture('host-can0-no-provider'), {}, [rule])

    expect(calls()).toBe(1)
    expect(result.unevaluated).toEqual([])
  })

  it('an empty group is an answer, not an absence -- the rule runs', () => {
    const { rule, calls } = probeRule(['drm'])
    const snapshot = fixture('host-can0-no-provider')
    snapshot.host!.drm = []

    const result = lint(snapshot, {}, [rule])

    expect(calls()).toBe(1)
    expect(result.unevaluated).toEqual([])
  })

  it('a rule configured off is skipped, not reported unevaluated', () => {
    const { rule, calls } = probeRule(['network'])
    const snapshot = fixture('current-server')
    snapshot.host = null

    const result = lint(snapshot, { rules: { 'host/probe': 'off' } }, [rule])

    expect(calls()).toBe(0)
    expect(result.skipped).toEqual(['host/probe'])
    expect(result.unevaluated).toEqual([])
  })
})
