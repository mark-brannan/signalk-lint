import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gpsdMissingDevice } from '../../src/rules/gpsd-missing-device.js'
import { lint } from '../../src/lint.js'
import { Snapshot } from '../../src/types.js'

function fixture(name: string): Snapshot {
  const path = join(import.meta.dirname, '..', 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot
}

const rule = gpsdMissingDevice

describe('host/gpsd-missing-device', () => {
  it('fires per configured device that did not exist at capture', () => {
    const findings = rule.evaluate(fixture('host-faulty'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toEqual([
      {
        path: 'host.gpsd.devices',
        value: { path: '/dev/ttyACM0', exists: false },
        file: '/etc/default/gpsd'
      }
    ])
  })

  it('does not fire when the device exists', () => {
    expect(rule.evaluate(fixture('host-healthy'))).toEqual([])
  })

  it('does not fire when gpsd lists no devices at all', () => {
    // An empty DEVICES= is a choice (USBAUTO), not a stale path.
    const snapshot = fixture('host-faulty')
    snapshot.host!.gpsd = { file: '/etc/default/gpsd', devices: [] }
    expect(rule.evaluate(snapshot)).toEqual([])
  })

  it('fires once per missing device, not once per file', () => {
    const snapshot = fixture('host-faulty')
    snapshot.host!.gpsd!.devices = [
      { path: '/dev/ttyACM0', exists: false },
      { path: '/dev/gps0', exists: false },
      { path: '/dev/ttyUSB0', exists: true }
    ]
    expect(rule.evaluate(snapshot)).toHaveLength(2)
  })

  it('declares the host facts it needs, so absence skips it visibly', () => {
    expect(rule.hostFacts).toEqual(['gpsd'])
    const snapshot = fixture('host-faulty')
    snapshot.host!.gpsd = null
    const result = lint(snapshot, {}, [rule])
    expect(result.findings).toEqual([])
    expect(result.unevaluated).toEqual([
      { ruleId: rule.id, missing: ['host.gpsd'] }
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
