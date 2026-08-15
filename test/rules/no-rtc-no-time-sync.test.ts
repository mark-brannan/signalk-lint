import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { noRtcNoTimeSync } from '../../src/rules/no-rtc-no-time-sync.js'
import { lint } from '../../src/lint.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = noRtcNoTimeSync

describe('host/no-rtc-no-time-sync', () => {
  it('fires on no RTC with an unsynchronized clock', () => {
    // host-can0-no-provider models the boat: hasRTC false, NTP enabled but
    // never synchronized because the boat is offline.
    const findings = rule.evaluate(fixture('host-can0-no-provider'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toEqual([
      { path: 'server.system.hasRTC', value: false },
      { path: 'host.time', value: { ntp: true, ntpSynchronized: false } }
    ])
  })

  it('does not fire when the clock is synchronized', () => {
    expect(rule.evaluate(fixture('host-healthy'))).toEqual([])
  })

  it('does not fire when an RTC is present', () => {
    const snapshot = fixture('host-can0-no-provider')
    snapshot.server.system.hasRTC = true
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('stays silent when RTC presence is unknown', () => {
    // null is "not Linux, or could not determine" -- not "confirmed absent".
    const snapshot = fixture('host-can0-no-provider')
    snapshot.server.system.hasRTC = null
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('stays silent when sync state is unknown', () => {
    const snapshot = fixture('host-can0-no-provider')
    snapshot.host!.time = { ntp: null, ntpSynchronized: null }
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('declares the host facts it needs, so absence skips it visibly', () => {
    expect(rule.hostFacts).toEqual(['time'])
    const snapshot = fixture('host-can0-no-provider')
    snapshot.host!.time = null
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([
      { ruleId: rule.id, missing: ['host.time'] }
    ])
  })

  it('survives a garbage snapshot without throwing', () => {
    const garbage = fixture('host-garbage')
    expect(() => rule.evaluate(garbage)).not.toThrow()
    expect(rule.evaluate(garbage)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('host-can0-no-provider')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
