#!/usr/bin/env node
/**
 * Command-line entry point.
 *
 * Two modes, and the split matters:
 *
 *   signalk-lint --config-dir ~/.signalk      capture a snapshot, then lint it
 *   signalk-lint --snapshot snap.json         lint a snapshot captured elsewhere
 *
 * The second mode is the point of the architecture. Someone can send you a
 * snapshot of a boat you have never seen, from a marina with no internet, and
 * you can run the full rule set against it on your laptop.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { assertConfigDir } from './config-dir.js'
import { parseSnapshot } from './snapshot.js'
import { collect } from './collect/index.js'
import { hasErrors, lint } from './lint.js'
import { rules } from './rules/index.js'
import { Finding, LintConfig, Severity, Snapshot } from './types.js'

const USAGE = `signalk-lint — a linter for Signal K server installations

Usage:
  signalk-lint [options]

Options:
  --config-dir <path>      Signal K config directory (default: ~/.signalk)
  --server-version <ver>   Installed signalk-server version, if not discoverable
  --snapshot <file>        Lint a previously captured snapshot instead
  --save-snapshot <file>   Write the captured snapshot to a file
  --json                   Emit findings as JSON
  --list-rules             List all rules and exit
  --help                   Show this message

Exit codes:
  0  no error-severity findings
  1  at least one error-severity finding
  2  the check could not run (bad arguments, missing config directory)

1 and 2 are deliberately distinct: 1 is a verdict, 2 is the absence of one.
Anything scripting this tool should treat 2 as "no answer", not as "clean".
`

interface Args {
  configDir: string
  serverVersion?: string
  snapshot?: string
  saveSnapshot?: string
  json: boolean
  listRules: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    configDir: join(homedir(), '.signalk'),
    json: false,
    listRules: false,
    help: false
  }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--config-dir':
        args.configDir = argv[++i]
        break
      case '--server-version':
        args.serverVersion = argv[++i]
        break
      case '--snapshot':
        args.snapshot = argv[++i]
        break
      case '--save-snapshot':
        args.saveSnapshot = argv[++i]
        break
      case '--json':
        args.json = true
        break
      case '--list-rules':
        args.listRules = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`Unknown argument: ${argv[i]}`)
    }
  }
  return args
}

/**
 * Best-effort discovery of the installed server version.
 *
 * Returns null rather than guessing. The rule reports "could not determine"
 * as a finding, so a null here is visible to the user rather than silently
 * turning the security check into a no-op.
 */
async function discoverServerVersion(
  configDir: string
): Promise<string | null> {
  const candidates = [
    join(configDir, 'node_modules', 'signalk-server', 'package.json'),
    join(configDir, '..', 'node_modules', 'signalk-server', 'package.json'),
    '/usr/lib/node_modules/signalk-server/package.json',
    '/usr/local/lib/node_modules/signalk-server/package.json'
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const pkg = JSON.parse(await readFile(path, 'utf8')) as {
        version?: string
      }
      if (typeof pkg.version === 'string') return pkg.version
    } catch {
      // Unreadable candidate is not an error; try the next one.
    }
  }
  return null
}

const COLOURS: Record<Severity, string> = {
  error: '[31m',
  warn: '[33m',
  info: '[36m',
  off: ''
}
const RESET = '[0m'

function format(findings: Finding[], snapshot: Snapshot): string {
  if (findings.length === 0) {
    return `[32m✓[0m No findings. Snapshot captured ${snapshot.capturedAt}.\n`
  }
  const useColour = process.stdout.isTTY
  const paint = (s: Severity, text: string): string =>
    useColour ? `${COLOURS[s]}${text}${RESET}` : text

  const lines: string[] = ['']
  for (const f of findings) {
    lines.push(
      `${paint(f.severity, f.severity.toUpperCase().padEnd(5))} ${f.title}`
    )
    lines.push(`      ${f.ruleId}  [${f.provenance}]`)
    for (const line of wrap(f.detail, 72)) lines.push(`      ${line}`)
    if (f.remediation) lines.push(`      → ${f.remediation.description}`)
    for (const ref of f.references ?? []) lines.push(`      ${ref}`)
    lines.push('')
  }
  const errors = findings.filter((f) => f.severity === 'error').length
  const warnings = findings.filter((f) => f.severity === 'warn').length
  const info = findings.filter((f) => f.severity === 'info').length
  lines.push(
    `${findings.length} finding(s): ${errors} error, ${warnings} warn, ${info} info`
  )
  return lines.join('\n') + '\n'
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(USAGE)
    return 0
  }

  if (args.listRules) {
    for (const rule of rules) {
      process.stdout.write(
        `${rule.id}\n  ${rule.description}\n  default: ${rule.defaultSeverity}  provenance: ${rule.provenance}\n\n`
      )
    }
    return 0
  }

  let snapshot: Snapshot
  if (args.snapshot) {
    snapshot = parseSnapshot(await readFile(args.snapshot, 'utf8'))
  } else {
    assertConfigDir(args.configDir)
    const serverVersion =
      args.serverVersion ?? (await discoverServerVersion(args.configDir))
    snapshot = await collect({ configDir: args.configDir, serverVersion })
  }

  if (args.saveSnapshot) {
    await writeFile(args.saveSnapshot, JSON.stringify(snapshot, null, 2))
  }

  const config: LintConfig = {}
  const result = lint(snapshot, config)

  process.stdout.write(
    args.json
      ? JSON.stringify(result, null, 2) + '\n'
      : format(result.findings, result.snapshot)
  )

  // A check that did not happen must be visible: a clean report that silently
  // omitted the host rules reads as "the host is fine", which this capture
  // cannot support.
  if (!args.json && result.unevaluated.length > 0) {
    for (const entry of result.unevaluated) {
      process.stdout.write(
        `note: ${entry.ruleId} did not run -- this capture has no ` +
          `${entry.missing.join(', ')}\n`
      )
    }
  }

  return hasErrors(result) ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`signalk-lint: ${(error as Error).message}\n`)
    process.exit(2)
  }
)
