import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { noRealtimeClock } from '../../src/rules/no-realtime-clock.js'
import { GENERATED_AT } from '../../src/data/advisories.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = noRealtimeClock

// One day either side of the floor, so tests don't depend on exactly where
// any given fixture's capturedAt happens to fall relative to it.
const BEFORE_FLOOR = new Date(
  new Date(GENERATED_AT).getTime() - 24 * 60 * 60 * 1000
).toISOString()
const AFTER_FLOOR = new Date(
  new Date(GENERATED_AT).getTime() + 24 * 60 * 60 * 1000
).toISOString()

describe('hardware/no-realtime-clock', () => {
  it('flags no RTC when the clock also reads implausibly early', () => {
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = false
    snapshot.capturedAt = BEFORE_FLOOR
    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toContainEqual({
      path: 'server.system.hasRTC',
      value: false
    })
  })

  it('does not flag no RTC when the clock already reads plausibly', () => {
    // Something -- NTP, GPS, anything -- is keeping the clock right. That's
    // the actual thing this rule cares about, not which mechanism did it.
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = false
    snapshot.capturedAt = AFTER_FLOOR
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not flag when an RTC is present, regardless of clock plausibility', () => {
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = true
    snapshot.capturedAt = BEFORE_FLOOR
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not flag when the platform is not Linux (hasRTC is null)', () => {
    // null means "not applicable here", not "confirmed absent" -- a rule
    // that warned on null would misreport every macOS/Windows dev run.
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = null
    snapshot.capturedAt = BEFORE_FLOOR
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = false
    snapshot.capturedAt = BEFORE_FLOOR
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
