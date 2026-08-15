import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { systemdDropinOutsideSection } from '../../src/rules/systemd-dropin-outside-section.js'
import { lint } from '../../src/lint.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = systemdDropinOutsideSection

describe('host/systemd-dropin-outside-section', () => {
  it('fires on assignments before any [Section], citing each line', () => {
    const findings = rule.evaluate(fixture('host-faulty'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'host.systemdDropins',
        value: {
          file: '/etc/systemd/system/signalk.service.d/override.conf',
          line: 2,
          text: 'Restart=always'
        }
      },
      {
        path: 'host.systemdDropins',
        value: {
          file: '/etc/systemd/system/signalk.service.d/override.conf',
          line: 3,
          text: 'RestartSec=5'
        }
      }
    ])
  })

  it('is an error: the drop-in is silently not in effect', () => {
    expect(rule.defaultSeverity).toBe('error')
    expect(rule.provenance).toBe('documented')
  })

  it('does not fire on a drop-in that opens with a section header', () => {
    expect(rule.evaluate(fixture('host-healthy'))).toEqual([])
  })

  it('allows comments and blank lines before the first header', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.systemdDropins![0]!.lines = [
      '# comment',
      '; also a comment',
      '',
      '[Service]',
      'Restart=always'
    ]
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('ignores assignments after the first header, even in a wrong section', () => {
    // A directive in the wrong section is a different mistake with different
    // behaviour (systemd rejects unknown keys per section, loudly). This rule
    // is only about the silently-ignored region before any header.
    const snapshot = fixture('host-faulty')
    snapshot.host!.systemdDropins![0]!.lines = ['[Unit]', 'Restart=always']
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not diagnose garbage lines that are not assignments', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.systemdDropins![0]!.lines = ['%% not systemd syntax at all']
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('declares the host facts it needs, so absence skips it visibly', () => {
    expect(rule.hostFacts).toEqual(['systemdDropins'])
    const snapshot = fixture('host-faulty')
    snapshot.host!.systemdDropins = null
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([
      { ruleId: rule.id, missing: ['host.systemdDropins'] }
    ])
  })

  it('runs against an empty drop-in list and finds nothing', () => {
    // [] is "looked, found none" -- an answer, not a skip.
    const snapshot = fixture('host-faulty')
    snapshot.host!.systemdDropins = []
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([])
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
