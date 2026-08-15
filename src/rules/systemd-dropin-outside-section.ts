/**
 * Rule: host/systemd-dropin-outside-section
 *
 * A systemd drop-in whose directives appear before any [Section] header is
 * silently ineffective: systemd logs "Assignment outside of section.
 * Ignoring." at daemon-reload and applies nothing. The file sits in
 * /etc/systemd/system looking exactly like the fix it was meant to be --
 * on the boat this rule comes from, a Restart=always meant to keep Signal K
 * alive was ignored for months because the [Service] line was missing.
 *
 * Provenance: documented. systemd.syntax(7) states configuration files are
 * organised in sections and systemd.unit(5) defines the unit file format;
 * an assignment before any section header is defined to be ignored. This is
 * not our judgement about style -- it is the documented behaviour of the
 * thing being configured.
 *
 * Only assignments (KEY=...) before the first section header fire. Comments
 * and blank lines before a header are fine and common; a line that is
 * neither a comment, a header nor an assignment is garbage this rule does
 * not diagnose -- systemd has its own error for that, and inventing a
 * second opinion here would be guessing.
 */
import { Rule, RuleFinding, Snapshot } from '../types.js'
import { systemdDropinsOf } from './host-facts.js'

export const systemdDropinOutsideSection: Rule = {
  id: 'host/systemd-dropin-outside-section',
  description:
    'A systemd drop-in has directives before any [Section], which systemd silently ignores',
  defaultSeverity: 'error',
  provenance: 'documented',
  hostFacts: ['systemdDropins'],

  evaluate(snapshot: Snapshot): RuleFinding[] {
    const dropins = systemdDropinsOf(snapshot)
    if (dropins === null) return []

    const findings: RuleFinding[] = []
    for (const dropin of dropins) {
      const ignored: { line: number; text: string }[] = []
      for (const [index, raw] of dropin.lines.entries()) {
        const line = raw.trim()
        if (line === '' || line.startsWith('#') || line.startsWith(';')) {
          continue
        }
        // The first section header ends the dangerous region for the whole
        // file: everything after it belongs to some section, right or wrong.
        if (/^\[.+\]$/.test(line)) break
        if (/^[A-Za-z][A-Za-z0-9]*\s*=/.test(line)) {
          ignored.push({ line: index + 1, text: line })
        }
      }
      if (ignored.length === 0) continue

      findings.push({
        title: `${dropin.file} has directives systemd silently ignores`,
        detail:
          `${dropin.file} assigns ${ignored
            .map((entry) => entry.text.split('=')[0])
            .join(', ')} before any [Section] header. systemd ignores an ` +
          'assignment outside a section -- it logs one line at daemon-reload ' +
          'and applies nothing -- so whatever this drop-in was meant to ' +
          `change about ${dropin.unit} is not in effect, while the file ` +
          'sits there looking like it is. This is the worst kind of broken ' +
          'on a boat: the fix you remember making is not actually active.',
        evidence: ignored.map((entry) => ({
          path: 'host.systemdDropins',
          value: { file: dropin.file, line: entry.line, text: entry.text }
        })),
        remediation: {
          kind: 'manual',
          description:
            `Add the missing section header (usually [Service] for a service ` +
            `unit) above the first directive in ${dropin.file}, then run ` +
            'systemctl daemon-reload and verify with systemctl cat ' +
            `${dropin.unit}.`
        },
        references: [
          'https://www.freedesktop.org/software/systemd/man/latest/systemd.syntax.html'
        ]
      })
    }
    return findings
  }
}
