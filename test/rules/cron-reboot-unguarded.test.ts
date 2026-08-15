import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cronRebootUnguarded } from '../../src/rules/cron-reboot-unguarded.js'
import { lint } from '../../src/lint.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

function withCronLines(lines: string[]): Snapshot {
  const snapshot = fixture('host-faulty')
  snapshot.host!.cron = [{ file: '/etc/crontab', lines }]
  return snapshot
}

const rule = cronRebootUnguarded

describe('host/cron-reboot-unguarded', () => {
  it('fires on an unguarded scheduled reboot, citing the line', () => {
    const findings = rule.evaluate(fixture('host-faulty'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'host.cron',
        value: {
          file: '/etc/crontab',
          line: 2,
          text: '0 3 * * * root /sbin/reboot'
        }
      }
    ])
  })

  it('does not fire when the reboot is guarded on npm', () => {
    expect(rule.evaluate(fixture('host-healthy'))).toEqual([])
  })

  it('matches shutdown, poweroff and systemctl variants', () => {
    for (const command of [
      '0 3 * * * root shutdown -r now',
      '0 3 * * * root /usr/sbin/poweroff',
      '0 3 * * * root systemctl reboot'
    ]) {
      expect(rule.evaluate(withCronLines([command]))).toHaveLength(1)
    }
  })

  it('does not treat the @reboot schedule as a reboot command', () => {
    expect(
      rule.evaluate(withCronLines(['@reboot pi /usr/local/bin/kiosk.sh']))
    ).toEqual([])
  })

  it('does not match a script that merely contains the word', () => {
    // A wrapper script may hold the guard inside; the rule cannot see in,
    // so it must stay silent rather than accuse the wrapper.
    expect(
      rule.evaluate(
        withCronLines(['0 3 * * * root /usr/local/bin/reboot-safely.sh'])
      )
    ).toEqual([])
  })

  it('skips comments and environment assignments', () => {
    expect(
      rule.evaluate(
        withCronLines(['# 0 3 * * * root reboot', 'SHELL=/bin/reboot'])
      )
    ).toEqual([])
  })

  it('declares the host facts it needs, so absence skips it visibly', () => {
    expect(rule.hostFacts).toEqual(['cron'])
    const snapshot = fixture('host-faulty')
    snapshot.host!.cron = null
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([
      { ruleId: rule.id, missing: ['host.cron'] }
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
