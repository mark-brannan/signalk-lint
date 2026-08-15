import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ARPHRD_CAN,
  ExecFn,
  collectHostFacts,
  parseTimespanSec
} from '../src/collect/host.js'

/** A fake machine: paths relative to a root, written as a fixture tree. */
async function fakeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sk-lint-host-'))
  for (const [rel, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true })
    await writeFile(join(root, rel), contents)
  }
  return root
}

const noExec: ExecFn = () => Promise.resolve(null)

function opts(root: string, exec: ExecFn = noExec) {
  return { root, home: null, platform: 'linux', exec }
}

describe('collectHostFacts()', () => {
  it('is null off Linux -- these paths are Linux conventions', async () => {
    const facts = await collectHostFacts({
      root: await fakeRoot({}),
      platform: 'darwin',
      exec: noExec
    })
    expect(facts).toBeNull()
  })

  it('degrades each group to null independently on an empty machine', async () => {
    const facts = await collectHostFacts(opts(await fakeRoot({})))
    expect(facts).not.toBeNull()
    expect(facts!.network).toBeNull()
    expect(facts!.gpsd).toBeNull()
    expect(facts!.systemdDropins).toBeNull()
    expect(facts!.drm).toBeNull()
    expect(facts!.time).toBeNull()
    expect(facts!.watchdog).toBeNull()
  })

  it('reads CAN interface state from /sys/class/net', async () => {
    const root = await fakeRoot({
      'sys/class/net/can0/type': `${ARPHRD_CAN}\n`,
      'sys/class/net/can0/flags': '0x1c1\n',
      'sys/class/net/can0/operstate': 'unknown\n',
      'sys/class/net/eth0/type': '1\n',
      'sys/class/net/eth0/flags': '0x1002\n',
      'sys/class/net/eth0/operstate': 'down\n'
    })
    const facts = await collectHostFacts(opts(root))
    expect(facts!.network).toEqual([
      { name: 'can0', type: ARPHRD_CAN, up: true, operstate: 'unknown' },
      { name: 'eth0', type: 1, up: false, operstate: 'down' }
    ])
  })

  it('captures gpsd devices with their existence at capture time', async () => {
    const root = await fakeRoot({
      'etc/default/gpsd':
        '# comment\nSTART_DAEMON="true"\nDEVICES="/dev/ttyACM0 /dev/gps0"\n',
      'dev/ttyACM0': ''
    })
    const facts = await collectHostFacts(opts(root))
    expect(facts!.gpsd).toEqual({
      file: '/etc/default/gpsd',
      devices: [
        { path: '/dev/ttyACM0', exists: true },
        { path: '/dev/gps0', exists: false }
      ]
    })
  })

  it('captures systemd drop-ins with their unit and lines', async () => {
    const root = await fakeRoot({
      'etc/systemd/system/signalk.service.d/override.conf':
        'Restart=always\n[Service]\nWatchdogSec=30\n'
    })
    const facts = await collectHostFacts(opts(root))
    expect(facts!.systemdDropins).toEqual([
      {
        unit: 'signalk.service',
        file: '/etc/systemd/system/signalk.service.d/override.conf',
        lines: ['Restart=always', '[Service]', 'WatchdogSec=30', '']
      }
    ])
  })

  it('collects cron tables and redacts credential-shaped assignments', async () => {
    const root = await fakeRoot({
      'etc/crontab': 'MQTT_PASSWORD=hunter2\n0 3 * * * root /sbin/reboot\n',
      'etc/cron.d/backup': '0 4 * * * pi /usr/local/bin/backup.sh\n'
    })
    const facts = await collectHostFacts(opts(root))
    expect(facts!.cron).toHaveLength(2)
    const serialized = JSON.stringify(facts!.cron)
    expect(serialized).not.toContain('hunter2')
    expect(facts!.cron![0]!.lines[1]).toBe('0 3 * * * root /sbin/reboot')
  })

  it('collects lxsession and user autostart files', async () => {
    const root = await fakeRoot({
      'etc/xdg/lxsession/LXDE-pi/autostart':
        '@lxpanel --profile LXDE-pi\n@chromium-browser --kiosk http://localhost:3000\n',
      'home/pi/.config/autostart/kiosk.desktop':
        '[Desktop Entry]\nExec=chromium-browser --kiosk\n'
    })
    const facts = await collectHostFacts({
      root,
      home: '/home/pi',
      platform: 'linux',
      exec: noExec
    })
    expect(facts!.autostart!.map((f) => f.file)).toEqual([
      '/etc/xdg/lxsession/LXDE-pi/autostart',
      '/home/pi/.config/autostart/kiosk.desktop'
    ])
  })

  it('reads DRM connector status, skipping the bare card devices', async () => {
    const root = await fakeRoot({
      'sys/class/drm/card1-HDMI-A-1/status': 'disconnected\n',
      'sys/class/drm/card1-HDMI-A-2/status': 'disconnected\n'
    })
    await mkdir(join(root, 'sys/class/drm/card1'), { recursive: true })
    const facts = await collectHostFacts(opts(root))
    expect(facts!.drm).toEqual([
      { connector: 'card1-HDMI-A-1', status: 'disconnected' },
      { connector: 'card1-HDMI-A-2', status: 'disconnected' }
    ])
  })

  it('parses timedatectl output into time sync facts', async () => {
    const exec: ExecFn = (cmd) =>
      Promise.resolve(
        cmd === 'timedatectl'
          ? 'Timezone=Etc/UTC\nNTP=yes\nNTPSynchronized=no\n'
          : null
      )
    const facts = await collectHostFacts(opts(await fakeRoot({}), exec))
    expect(facts!.time).toEqual({ ntp: true, ntpSynchronized: false })
  })

  it('combines systemd and /sys views of the watchdog', async () => {
    const root = await fakeRoot({
      'sys/class/watchdog/watchdog0/timeout': '15\n'
    })
    const exec: ExecFn = (cmd) =>
      Promise.resolve(cmd === 'systemctl' ? '10s\n' : null)
    const facts = await collectHostFacts(opts(root, exec))
    expect(facts!.watchdog).toEqual({
      runtimeWatchdogRaw: '10s',
      runtimeWatchdogSec: 10,
      devices: [{ name: 'watchdog0', timeoutSec: 15 }]
    })
  })

  it('keeps only explicit journald assignments, last file winning', async () => {
    const root = await fakeRoot({
      'etc/systemd/journald.conf': '[Journal]\n#SystemMaxUse=\nStorage=auto\n',
      'etc/systemd/journald.conf.d/size.conf': '[Journal]\nSystemMaxUse=200M\n',
      'var/log/journal/.keep': ''
    })
    const facts = await collectHostFacts(opts(root))
    expect(facts!.journald).toEqual({
      storage: 'auto',
      systemMaxUse: '200M',
      persistentJournalDir: true,
      files: [
        '/etc/systemd/journald.conf',
        '/etc/systemd/journald.conf.d/size.conf'
      ]
    })
  })

  it('treats a commented-out SystemMaxUse as not set', async () => {
    const root = await fakeRoot({
      'etc/systemd/journald.conf': '[Journal]\n#SystemMaxUse=4G\n'
    })
    const facts = await collectHostFacts(opts(root))
    expect(facts!.journald!.systemMaxUse).toBeNull()
    expect(facts!.journald!.persistentJournalDir).toBe(false)
  })
})

describe('parseTimespanSec()', () => {
  it('parses the forms systemctl actually prints', () => {
    expect(parseTimespanSec('0')).toBe(0)
    expect(parseTimespanSec('10s')).toBe(10)
    expect(parseTimespanSec('1min 30s')).toBe(90)
    expect(parseTimespanSec('2h')).toBe(7200)
    expect(parseTimespanSec('500ms')).toBe(0.5)
  })

  it('yields null rather than a wrong number for unknown forms', () => {
    expect(parseTimespanSec('infinity')).toBeNull()
    expect(parseTimespanSec('')).toBeNull()
    expect(parseTimespanSec('10 parsecs')).toBeNull()
  })
})
