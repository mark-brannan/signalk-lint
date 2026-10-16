/**
 * Convention: no rule may throw on malformed input.
 *
 * A rule that throws takes the whole lint run down with it, and the snapshot
 * it choked on is exactly the broken machine the user is trying to diagnose.
 * Malformed data is a finding or silence, never an exception.
 *
 * This runs every registered rule against garbage: whole-snapshot garbage, and
 * every real fixture with each node replaced in turn by a wrongly typed value.
 * A new rule is covered the moment it is added to the registry.
 *
 * Limit: mutations only replace nodes that already exist in a fixture. A field
 * a rule reads that no fixture sets is never made garbage, so this is a net
 * for regressions, not a proof; add a fixture that sets the field to extend it.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rules } from '../src/rules/index.js'
import { parseSnapshot, SnapshotError } from '../src/snapshot.js'
import { Rule, Snapshot } from '../src/types.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

const WRONG_VALUES: unknown[] = [
  null,
  'garbage',
  '',
  42,
  -1,
  true,
  [],
  [null],
  {},
  { x: null }
]

const NOT_SNAPSHOTS: string[] = [
  '',
  'not json {',
  'null',
  '42',
  '"x"',
  '[]',
  '{}',
  '{"schemaVersion":"x","server":null,"host":"x"}',
  '{"schemaVersion":3,"server":[],"host":[]}'
]

function fixtures(): [string, unknown][] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f, JSON.parse(readFileSync(join(FIXTURES, f), 'utf8'))])
}

/** Every copy of `root` with exactly one node replaced by `value`. */
function* mutations(root: unknown, value: unknown): Generator<unknown> {
  const walk = function* (
    node: unknown,
    path: (string | number)[]
  ): Generator<(string | number)[]> {
    yield path
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        yield* walk(v, [...path, Array.isArray(node) ? Number(k) : k])
      }
    }
  }
  for (const path of walk(root, [])) {
    if (path.length === 0) {
      yield value
      continue
    }
    const copy = structuredClone(root) as Record<string | number, unknown>
    let parent = copy
    for (const k of path.slice(0, -1)) {
      parent = parent[k] as Record<string | number, unknown>
    }
    parent[path[path.length - 1]] = value
    yield copy
  }
}

/**
 * Rules see what parseSnapshot hands them, so that is the contract under test:
 * a mutated capture is either rejected at the boundary with a SnapshotError, or
 * accepted and then no rule may throw on it.
 */
function attempt(rule: Rule, mutated: unknown): string | null {
  let snapshot: Snapshot
  try {
    snapshot = parseSnapshot(JSON.stringify(mutated) ?? 'null')
  } catch (error) {
    if (error instanceof SnapshotError) return null
    throw error
  }
  try {
    // Drain lazily-produced findings too.
    ;[...rule.evaluate(snapshot)]
    return null
  } catch (error) {
    return String((error as Error)?.stack ?? error)
      .split('\n')
      .slice(0, 2)
      .join(' | ')
      .replace(/\(.*\/(src\/[^)]*)\)/, '$1')
  }
}

describe('parseSnapshot on non-snapshots', () => {
  it.each(NOT_SNAPSHOTS)('rejects %j with SnapshotError only', (input) => {
    expect(() => parseSnapshot(input)).toThrow(SnapshotError)
  })
})

describe.each(rules.map((r) => [r.id, r] as const))('%s', (_id, rule) => {
  it('does not throw when any single field has the wrong shape', () => {
    const failures = new Set<string>()
    for (const [name, snapshot] of fixtures()) {
      for (const wrong of WRONG_VALUES) {
        for (const mutated of mutations(snapshot, wrong)) {
          const where = attempt(rule, mutated)
          if (where) failures.add(`${name}: ${where.trim()}`)
        }
      }
    }
    expect([...failures]).toEqual([])
  })
})
