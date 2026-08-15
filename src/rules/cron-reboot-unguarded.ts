/**
 * Rule: host/cron-reboot-unguarded
 *
 * A scheduled reboot and a Signal K update will eventually coincide. Server
 * updates run `npm install` for minutes, and a reboot that lands mid-install
 * leaves a half-written node_modules -- the server does not come back up,
 * on a schedule, with nobody watching. That is how the boat this rule comes
 * from lost its Signal K install: a 3am cron reboot hit an update someone
 * had started before going to sleep.
 *
 * The guard this looks for is any mention of npm on the same cron line --
 * `pgrep -x npm > /dev/null || /sbin/reboot` being the shape that fixed it.
 * That is deliberately loose in the safe direction: any npm-aware guard
 * passes, whatever its exact spelling.
 *
 * What legitimately looks like this and must not fire: a reboot wrapped in
 * a script (`/usr/local/bin/safe-reboot.sh`) whose guard lives inside the
 * script. The command token then is the script, not `reboot`, so the rule
 * stays silent -- it only matches the bare commands `reboot`, `shutdown`,
 * `poweroff` and `systemctl reboot/poweroff`, exactly delimited, never a
 * word inside a longer path or filename. `@reboot` is a cron schedule, not
 * a command, and does not match.
 *
 * Provenance: opinion. Nothing forbids a nightly reboot; the judgement that
 * an unguarded one is a loaded gun is ours, argued from a boat that got
 * shot.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { cronOf } from './host-facts.js'

/**
 * The bare commands, exactly delimited. The lookbehind alternatives are the
 * characters that can precede a command in shell (start, whitespace, ; & |),
 * which is what keeps `@reboot` (preceded by `@`) and `reboot-safely.sh`
 * (followed by `-`) from matching.
 */
const REBOOT_COMMAND =
  /(?:^|[\s;&|])(?:\/(?:usr\/)?s?bin\/)?(?:reboot|shutdown|poweroff)(?=$|[\s;&|])|(?:^|[\s;&|])systemctl\s+(?:reboot|poweroff)(?=$|[\s;&|])/

const GUARD = /npm/

export const cronRebootUnguarded: Rule = {
  id: 'host/cron-reboot-unguarded',
  description:
    'A cron job reboots this machine with no guard against an npm install in flight',
  defaultSeverity: 'warn',
  provenance: 'opinion',
  hostFacts: ['cron'],

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const tables = cronOf(snapshot)
    if (tables === null) return []

    const findings: RuleFinding[] = []
    for (const table of tables) {
      for (const [index, raw] of table.lines.entries()) {
        const line = raw.trim()
        if (line === '' || line.startsWith('#')) continue
        // Environment assignments (SHELL=, MAILTO=) are not jobs.
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue
        if (!REBOOT_COMMAND.test(line)) continue
        if (GUARD.test(line)) continue

        findings.push({
          title: `${table.file} reboots on a schedule with no npm guard`,
          detail:
            `${table.file} line ${index + 1} runs a reboot on a schedule. ` +
            'A Signal K update runs npm install for minutes, and a scheduled ' +
            'reboot that lands mid-install leaves a half-written ' +
            'node_modules: the server does not come back, at a time chosen ' +
            'precisely because nobody is watching. Guarding the reboot on ' +
            'npm not running closes the window. If this line already defers ' +
            'to a wrapper script that checks, the rule could not see inside ' +
            'it and this does not apply.',
          evidence: [
            {
              path: 'host.cron',
              value: { file: table.file, line: index + 1, text: line }
            }
          ],
          remediation: {
            kind: 'manual',
            description:
              'Make the reboot conditional on npm being idle, e.g. ' +
              '`pgrep -x npm > /dev/null || /sbin/reboot` -- the reboot ' +
              'skips one night rather than corrupting an install.'
          }
        })
      }
    }
    return findings
  }
}
