import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collect } from '../src/collect/index.js'
import { Snapshot } from '../src/types.js'

async function configDirWith(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sk-lint-'))
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(contents))
  }
  return dir
}

async function configDirWithPlugins(
  plugins: Record<string, unknown>
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sk-lint-'))
  const pluginDir = join(dir, 'plugin-config-data')
  await mkdir(pluginDir)
  for (const [id, contents] of Object.entries(plugins)) {
    await writeFile(join(pluginDir, `${id}.json`), JSON.stringify(contents))
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
    // statfs() on a path that doesn't exist must degrade to null, not throw
    // and take the whole collector down with it.
    expect(snapshot.server.system.disk).toBeNull()
  })

  it('captures disk usage for the filesystem holding the config directory', async () => {
    const dir = await configDirWith({ 'settings.json': { port: 3000 } })
    const snapshot = await collect({ configDir: dir })
    const disk = snapshot.server.system.disk

    expect(disk).not.toBeNull()
    expect(disk!.totalMB).toBeGreaterThan(0)
    expect(disk!.usedMB).toBeGreaterThanOrEqual(0)
    expect(disk!.usedMB).toBeLessThanOrEqual(disk!.totalMB)
    expect(disk!.usedPercent).toBeGreaterThanOrEqual(0)
    expect(disk!.usedPercent).toBeLessThanOrEqual(100)
  })

  it('reads plugin configs, keyed by plugin id', async () => {
    const dir = await configDirWithPlugins({
      venus: { enabled: true, configuration: { useDeviceNames: false } }
    })
    const snapshot = await collect({ configDir: dir })
    expect(snapshot.server.pluginConfig).toEqual({
      venus: { enabled: true, configuration: { useDeviceNames: false } }
    })
  })

  it('yields null pluginConfig when plugin-config-data is absent', async () => {
    const dir = await configDirWith({})
    const snapshot = await collect({ configDir: dir })
    expect(snapshot.server.pluginConfig).toBeNull()
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
    // system.disk is a live statfs() read -- genuinely non-deterministic
    // between two calls, however unlikely to actually differ in practice.
    // Excluded here rather than asserted on luck.
    const { system: systemA, ...serverA } = a.server
    const { system: systemB, ...serverB } = b.server
    expect(serverA).toEqual(serverB)
    expect(systemA.nodeVersion).toBe(systemB.nodeVersion)
    expect(a.capturedAt).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('plugin config redaction', () => {
  async function snapshotWithPluginConfig(
    files: Record<string, unknown>
  ): Promise<Snapshot> {
    const dir = await mkdtemp(join(tmpdir(), 'sk-lint-'))
    await mkdir(join(dir, 'plugin-config-data'))
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(
        join(dir, 'plugin-config-data', name),
        JSON.stringify(contents)
      )
    }
    return collect({ configDir: dir })
  }

  it('keeps plugin credentials out of the snapshot', async () => {
    // Plugin configs are read whole, and boat plugins routinely hold broker
    // credentials. A snapshot gets pasted into bug reports, so this is the
    // same promise securityFactsFrom keeps for security.json.
    const snapshot = await snapshotWithPluginConfig({
      'venus.json': {
        enabled: true,
        configuration: {
          mqttHost: '192.168.1.20',
          mqttPassword: 'SUPER-SECRET-MQTT-PW',
          nested: { accessToken: 'TOKEN-SECRET' }
        }
      }
    })
    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain('SUPER-SECRET-MQTT-PW')
    expect(serialized).not.toContain('TOKEN-SECRET')
  })

  it('preserves the non-secret config a rule reads', async () => {
    // Redaction must not narrow what rules can see: venus reads these two.
    const snapshot = await snapshotWithPluginConfig({
      'venus.json': {
        enabled: true,
        configuration: {
          useDeviceNames: false,
          instanceMappings: [{ type: 'battery', venusId: 279 }],
          mqttPassword: 'SECRET'
        }
      }
    })
    const venus = snapshot.server.pluginConfig?.venus as {
      enabled: boolean
      configuration: Record<string, unknown>
    }

    expect(venus.enabled).toBe(true)
    expect(venus.configuration.useDeviceNames).toBe(false)
    expect(venus.configuration.instanceMappings).toEqual([
      { type: 'battery', venusId: 279 }
    ])
  })

  it('leaves marine and generic config alone', async () => {
    // The opposite failure to a missed secret, and the more likely one on a
    // boat: substring matching would redact compass (heading calibration) and
    // pinMode (a GPIO), destroying structure in the artifact whose whole
    // purpose is letting someone else debug the config.
    const snapshot = await snapshotWithPluginConfig({
      'x.json': {
        configuration: {
          compass: { offset: 12, calibrated: true },
          bypass: true,
          sessionTimeout: 30,
          pinMode: 'input',
          gpioPin: 17,
          keyName: 'heading'
        }
      }
    })
    const config = (
      snapshot.server.pluginConfig?.x as {
        configuration: Record<string, unknown>
      }
    ).configuration

    expect(config.compass).toEqual({ offset: 12, calibrated: true })
    expect(config.bypass).toBe(true)
    expect(config.sessionTimeout).toBe(30)
    expect(config.pinMode).toBe('input')
    expect(config.gpioPin).toBe(17)
    // keyName is accepted collateral: `key` is a credential word on its own.
    expect(config.keyName).not.toBe('heading')
  })

  it('redacts a session identifier but not a session timeout', async () => {
    const snapshot = await snapshotWithPluginConfig({
      'x.json': {
        configuration: { sessionId: 'SECRET-SID', sessionTimeout: 30 }
      }
    })
    const config = (
      snapshot.server.pluginConfig?.x as {
        configuration: Record<string, unknown>
      }
    ).configuration

    expect(config.sessionId).not.toBe('SECRET-SID')
    expect(config.sessionTimeout).toBe(30)
  })

  it('keeps the key so a rule can still tell a secret is set', async () => {
    // "MQTT configured with no TLS" is a finding someone will want, and it
    // must not need the password itself to reason.
    const snapshot = await snapshotWithPluginConfig({
      'gw.json': { configuration: { password: 'SECRET' } }
    })
    const gw = snapshot.server.pluginConfig?.gw as {
      configuration: Record<string, unknown>
    }

    expect(Object.keys(gw.configuration)).toContain('password')
    expect(gw.configuration.password).not.toBe('SECRET')
  })
})
