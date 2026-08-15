import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { watchdogTimeoutMismatch } from '../../src/rules/watchdog-timeout-mismatch.js'
import { lint } from '../../src/lint.js'
import { Snapshot, WatchdogFacts } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

function withWatchdog(watchdog: WatchdogFacts): Snapshot {
  const snapshot = fixture('host-faulty')
  snapshot.host!.watchdog = watchdog
  return snapshot
}

const rule = watchdogTimeoutMismatch

describe('host/watchdog-timeout-mismatch', () => {
  it('fires when systemd and the device disagree', () => {
    const findings = rule.evaluate(fixture('host-faulty'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toEqual([
      { path: 'host.watchdog.runtimeWatchdogSec', value: 10 },
      {
        path: 'host.watchdog.devices',
        value: { name: 'watchdog0', timeoutSec: 15 }
      }
    ])
  })

  it('does not fire when they agree', () => {
    expect(rule.evaluate(fixture('host-healthy'))).toEqual([])
  })

  it('does not fire when systemd is not running the watchdog', () => {
    // RuntimeWatchdogSec=0 means the device timeout belongs to whoever else
    // opened the watchdog -- a different situation, not this mismatch.
    expect(
      rule.evaluate(
        withWatchdog({
          runtimeWatchdogRaw: '0',
          runtimeWatchdogSec: 0,
          devices: [{ name: 'watchdog0', timeoutSec: 15 }]
        })
      )
    ).toEqual([])
  })

  it('stays silent when either side is unknown', () => {
    expect(
      rule.evaluate(
        withWatchdog({
          runtimeWatchdogRaw: 'infinity',
          runtimeWatchdogSec: null,
          devices: [{ name: 'watchdog0', timeoutSec: 15 }]
        })
      )
    ).toEqual([])
    expect(
      rule.evaluate(
        withWatchdog({
          runtimeWatchdogRaw: '10s',
          runtimeWatchdogSec: 10,
          devices: null
        })
      )
    ).toEqual([])
    expect(
      rule.evaluate(
        withWatchdog({
          runtimeWatchdogRaw: '10s',
          runtimeWatchdogSec: 10,
          devices: [{ name: 'watchdog0', timeoutSec: null }]
        })
      )
    ).toEqual([])
  })

  it('stays silent with no watchdog0 device at all', () => {
    expect(
      rule.evaluate(
        withWatchdog({
          runtimeWatchdogRaw: '10s',
          runtimeWatchdogSec: 10,
          devices: []
        })
      )
    ).toEqual([])
  })

  it('declares the host facts it needs, so absence skips it visibly', () => {
    expect(rule.hostFacts).toEqual(['watchdog'])
    const snapshot = fixture('host-faulty')
    snapshot.host!.watchdog = null
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([
      { ruleId: rule.id, missing: ['host.watchdog'] }
    ])
  })

  it('survives a garbage snapshot without throwing', () => {
    const garbage = fixture('host-garbage')
    expect(() => rule.evaluate(garbage)).not.toThrow()
    expect(rule.evaluate(garbage)).toEqual([])
  })

  it('is pure: repeated evaluation yields identical results', () => {
    const snapshot = fixture('host-faulty')
    expect(rule.evaluate(snapshot)).toEqual(rule.evaluate(snapshot))
  })
})
