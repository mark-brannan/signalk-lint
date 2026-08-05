import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { noRealtimeClock } from '../../src/rules/no-realtime-clock.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = noRealtimeClock

describe('hardware/no-realtime-clock', () => {
  it('flags a confirmed absence of /dev/rtc0', () => {
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = false
    const findings = rule.evaluate(snapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence[0]).toEqual({
      path: 'server.system.hasRTC',
      value: false
    })
  })

  it('does not flag when an RTC is present', () => {
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = true
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not flag when the platform is not Linux (hasRTC is null)', () => {
    // null means "not applicable here", not "confirmed absent" -- a rule
    // that warned on null would misreport every macOS/Windows dev run.
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('current-server')
    snapshot.server.system.hasRTC = false
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
