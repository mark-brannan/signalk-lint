import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collect } from '../src/collect/index.js'

async function configDirWith(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sk-lint-'))
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(contents))
  }
  return dir
}

describe('collect()', () => {
  it('reads settings, security and priorities', async () => {
    const dir = await configDirWith({
      'settings.json': { port: 3000, ssl: false },
      'security.json': { allow_readonly: true, users: [{ username: 'a' }] },
      'priorities.json': { 'navigation.position': ['gps'] }
    })
    const snapshot = await collect({ configDir: dir, serverVersion: '2.30.0' })

    expect(snapshot.server.settings?.port).toBe(3000)
    expect(snapshot.server.security?.allowReadonly).toBe(true)
    expect(snapshot.server.security?.userCount).toBe(1)
    expect(snapshot.server.sourcePriorities).toEqual({
      'navigation.position': ['gps']
    })
  })

  it('never carries secrets into the snapshot', async () => {
    // Snapshots get pasted into bug reports. This test is the reason the
    // collector reduces security.json to facts instead of copying it.
    const dir = await configDirWith({
      'security.json': {
        secretKey: 'SUPER-SECRET-VALUE',
        users: [{ username: 'a', passwordHash: 'HASHED-SECRET' }],
        devices: [{ clientId: 'x', accessToken: 'TOKEN-SECRET' }],
        allow_readonly: false
      }
    })
    const snapshot = await collect({ configDir: dir })
    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain('SUPER-SECRET-VALUE')
    expect(serialized).not.toContain('HASHED-SECRET')
    expect(serialized).not.toContain('TOKEN-SECRET')
    expect(snapshot.server.security?.userCount).toBe(1)
    expect(snapshot.server.security?.deviceCount).toBe(1)
  })

  it('yields nulls rather than throwing on a missing config directory', async () => {
    const snapshot = await collect({ configDir: '/nonexistent/path/xyz' })
    expect(snapshot.server.settings).toBeNull()
    expect(snapshot.server.sourcePriorities).toBeNull()
    expect(snapshot.server.security?.configured).toBe(false)
  })

  it('distinguishes absent priorities from empty priorities', async () => {
    // {} means "the file exists and nothing is configured", which is a real
    // finding. null means "we could not see". Collapsing them loses the rule.
    const withEmpty = await collect({
      configDir: await configDirWith({ 'priorities.json': {} })
    })
    const withNone = await collect({ configDir: await configDirWith({}) })

    expect(withEmpty.server.sourcePriorities).toEqual({})
    expect(withNone.server.sourcePriorities).toBeNull()
  })

  it('produces a deterministic snapshot given a fixed clock', async () => {
    const dir = await configDirWith({ 'settings.json': { port: 3000 } })
    const now = new Date('2026-08-01T00:00:00.000Z')
    const a = await collect({ configDir: dir, now })
    const b = await collect({ configDir: dir, now })
    expect(a).toEqual(b)
    expect(a.capturedAt).toBe('2026-08-01T00:00:00.000Z')
  })
})
