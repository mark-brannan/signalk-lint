import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { journaldNoMaxUse } from '../../src/rules/journald-no-max-use.js'
import { lint } from '../../src/lint.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = journaldNoMaxUse

describe('host/journald-no-max-use', () => {
  it('fires on a persistent journal with no explicit cap', () => {
    const findings = rule.evaluate(fixture('host-faulty'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'host.journald',
        value: {
          persistentJournalDir: true,
          storage: 'persistent',
          systemMaxUse: null
        }
      }
    ])
  })

  it('does not fire when SystemMaxUse is set', () => {
    expect(rule.evaluate(fixture('host-healthy'))).toEqual([])
  })

  it('does not second-guess the size someone chose', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.journald!.systemMaxUse = '4G'
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire without a persistent journal directory', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.journald!.persistentJournalDir = false
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('does not fire when Storage is explicitly volatile or none', () => {
    // tmpfs cannot crowd an SD card, whatever /var/log/journal says.
    for (const storage of ['volatile', 'none']) {
      const snapshot = fixture('host-faulty')
      snapshot.host!.journald!.storage = storage
      expect(rule.evaluate(snapshot)).toEqual([])
    }
  })

  it('fires with default (unset) Storage and the directory present', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.journald!.storage = null
    expect(rule.evaluate(snapshot)).toHaveLength(1)
  })

  it('declares the host facts it needs, so absence skips it visibly', () => {
    expect(rule.hostFacts).toEqual(['journald'])
    const snapshot = fixture('host-faulty')
    snapshot.host!.journald = null
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([
      { ruleId: rule.id, missing: ['host.journald'] }
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
