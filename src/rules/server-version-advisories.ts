/**
 * Rule: server/known-vulnerability
 *
 * Compares the installed signalk-server version against published security
 * advisories. This is the least opinionated rule in the set -- it makes no
 * judgement about how you run your boat, it only reports facts that someone
 * else already published and assigned a CVE to.
 *
 * It exists first because it is the rule most likely to be *right*, and a
 * linter earns the right to have opinions by first being reliably correct
 * about things that are not opinions.
 */
import semver from 'semver'
import { ADVISORIES, GENERATED_AT, Advisory } from '../data/advisories.js'
import { Rule, RuleFinding, Severity, Snapshot } from '../types.js'

/** GitHub severity vocabulary -> ours. */
function severityFor (advisory: Advisory): Severity {
  switch (advisory.severity) {
    case 'critical':
    case 'high':
      return 'error'
    case 'medium':
    case 'moderate':
      return 'warn'
    default:
      return 'info'
  }
}

function isAffected (version: string, advisory: Advisory): boolean {
  // includePrerelease matters: several Signal K advisories were patched in
  // beta releases (e.g. `< 2.24.0-beta.4`), and without this flag semver
  // refuses to match prerelease versions at all.
  return semver.satisfies(version, advisory.vulnerableVersions, {
    includePrerelease: true
  })
}

/**
 * The newest fix required to clear every advisory the running version is
 * affected by. Recommending the highest single target avoids the trap of
 * telling someone to upgrade three times.
 */
function highestPatch (matches: Advisory[]): string | null {
  const patches = matches
    .map(a => a.firstPatchedVersion)
    .filter((v): v is string => Boolean(v) && semver.valid(v) !== null)
  if (patches.length === 0) return null
  return patches.sort(semver.rcompare)[0]
}

export const serverVersionAdvisories: Rule = {
  id: 'server/known-vulnerability',
  description:
    'Installed signalk-server version is affected by a published security advisory',
  defaultSeverity: 'error',
  provenance: 'advisory',

  evaluate (snapshot: Snapshot): RuleFinding[] {
    const version = snapshot.server.version

    // An unknown version is reported, not silently passed. A security rule
    // that quietly does nothing when it cannot see is the worst failure mode
    // available to it.
    if (version === null) {
      return [
        {
          title: 'Could not determine the signalk-server version',
          detail:
            'This rule compares the running server version against published ' +
            'security advisories, and no version was captured in the snapshot. ' +
            'The check did not run -- treat this as unknown, not as a pass.',
          evidence: [{ path: 'server.version', value: null }],
          severity: 'warn',
          remediation: {
            kind: 'manual',
            description:
              'Capture the version by running against a live server, or pass ' +
              '--server-version explicitly.'
          }
        }
      ]
    }

    if (semver.valid(version) === null) {
      return [
        {
          title: `Unparseable signalk-server version: ${version}`,
          detail:
            'The captured version is not valid semver, so it cannot be ' +
            'compared against advisory ranges. The check did not run.',
          evidence: [{ path: 'server.version', value: version }],
          severity: 'warn',
          remediation: {
            kind: 'manual',
            description: 'Verify the installed server version by hand.'
          }
        }
      ]
    }

    const matches = ADVISORIES.filter(a => isAffected(version, a))
    if (matches.length === 0) return []

    const target = highestPatch(matches)
    const generatedOn = GENERATED_AT.slice(0, 10)

    return matches.map(advisory => ({
      title: `${advisory.severity} — ${advisory.summary}`,
      detail:
        `signalk-server ${version} is affected by ${advisory.ghsaId}` +
        (advisory.cveId ? ` (${advisory.cveId})` : '') +
        `. Affected versions: ${advisory.vulnerableVersions}. ` +
        (advisory.firstPatchedVersion
          ? `Fixed in ${advisory.firstPatchedVersion}. `
          : 'No patched version is listed. ') +
        `Advisory data bundled with this release was generated on ${generatedOn}; ` +
        'run `npm run update-advisories` in a fresh checkout for the current list.',
      severity: severityFor(advisory),
      evidence: [{ path: 'server.version', value: version }],
      remediation: target
        ? {
            kind: 'upgrade-package',
            description: `Upgrade signalk-server to ${target} or later.`,
            target: 'signalk-server',
            currentValue: version,
            proposedValue: target
          }
        : {
            kind: 'manual',
            description:
              'No patched version is published for this advisory. Review the ' +
              'advisory for mitigations.'
          },
      references: [advisory.url]
    }))
  }
}
