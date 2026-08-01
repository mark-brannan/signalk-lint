#!/usr/bin/env node
/**
 * Regenerates src/data/advisories.ts from the GitHub Advisory Database.
 *
 * The advisory list ships *with the code* rather than being fetched at runtime.
 * A boat at anchor has no internet, and a security rule that silently passes
 * when offline is worse than no rule at all. The cost is staleness, which we
 * make visible via GENERATED_AT and surface in the finding itself.
 *
 * Usage:  node scripts/update-advisories.mjs
 * Requires: gh CLI authenticated, or GITHUB_TOKEN in the environment.
 */
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const OUT = new URL('../src/data/advisories.ts', import.meta.url)

function fetchAdvisories () {
  const raw = execFileSync(
    'gh',
    ['api', '/advisories?ecosystem=npm&affects=signalk-server&per_page=100'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
  return JSON.parse(raw)
}

/**
 * GitHub writes ranges as `>= 2.20.0, < 2.24.0`; node-semver wants
 * `>=2.20.0 <2.24.0`. Commas are ANDs, so a plain swap to spaces is correct.
 */
function normalizeRange (range) {
  return range.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
}

const advisories = fetchAdvisories()
  .flatMap((a) =>
    (a.vulnerabilities || [])
      .filter((v) => v.package && v.package.name === 'signalk-server')
      .map((v) => ({
        ghsaId: a.ghsa_id,
        cveId: a.cve_id || null,
        severity: a.severity,
        summary: a.summary.trim().replace(/\s+/g, ' '),
        vulnerableVersions: normalizeRange(v.vulnerable_version_range || '*'),
        firstPatchedVersion: v.first_patched_version || null,
        publishedAt: a.published_at,
        url: a.html_url
      }))
  )
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

const banner = `/**
 * Signal K server security advisories, sourced from the GitHub Advisory Database.
 *
 * GENERATED FILE -- do not edit by hand.
 * Regenerate with:  npm run update-advisories
 *
 * Bundled rather than fetched so that the rule works offline, which is the
 * normal condition on a boat. See scripts/update-advisories.mjs.
 */

export interface Advisory {
  ghsaId: string
  cveId: string | null
  severity: 'low' | 'moderate' | 'medium' | 'high' | 'critical'
  summary: string
  /** node-semver range of affected versions. */
  vulnerableVersions: string
  firstPatchedVersion: string | null
  publishedAt: string
  url: string
}

/** When this file was generated. Surfaced in findings so staleness is visible. */
export const GENERATED_AT = '${new Date().toISOString()}'

export const ADVISORIES: readonly Advisory[] = ${JSON.stringify(advisories, null, 2)}
`

writeFileSync(OUT, banner)
console.log(`wrote ${advisories.length} advisories to src/data/advisories.ts`)
