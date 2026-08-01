/**
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
export const GENERATED_AT = '2026-08-01T18:32:29.520Z'

export const ADVISORIES: readonly Advisory[] = [
  {
    ghsaId: 'GHSA-q59x-jc9f-gfqf',
    cveId: 'CVE-2026-55591',
    severity: 'medium',
    summary:
      'Signal K Server: Server-Side Request Forgery via Remote Connection Endpoints',
    vulnerableVersions: '<= 2.27.0',
    firstPatchedVersion: '2.28.0',
    publishedAt: '2026-06-18T21:13:36Z',
    url: 'https://github.com/advisories/GHSA-q59x-jc9f-gfqf'
  },
  {
    ghsaId: 'GHSA-vmfm-ch9h-5c7g',
    cveId: 'CVE-2026-41893',
    severity: 'high',
    summary:
      "Signal K Server's WebSocket Login Endpoint Lacks Rate Limiting (Credential Brute-Force)",
    vulnerableVersions: '<= 2.24.0',
    firstPatchedVersion: '2.25.0',
    publishedAt: '2026-05-04T20:52:06Z',
    url: 'https://github.com/advisories/GHSA-vmfm-ch9h-5c7g'
  },
  {
    ghsaId: 'GHSA-7gcj-phff-2884',
    cveId: 'CVE-2026-39320',
    severity: 'high',
    summary:
      'Signal K Server has an Unauthenticated Regular Expression Denial of Service (ReDoS) via WebSocket Subscription Paths',
    vulnerableVersions: '< 2.25.0',
    firstPatchedVersion: '2.25.0',
    publishedAt: '2026-04-21T17:17:00Z',
    url: 'https://github.com/advisories/GHSA-7gcj-phff-2884'
  },
  {
    ghsaId: 'GHSA-cxj8-ggf2-p57c',
    cveId: 'CVE-2026-34083',
    severity: 'medium',
    summary:
      'Signal K Server: OAuth Authorization Code Theft via Unvalidated Host Header in OIDC Flow',
    vulnerableVersions: '>= 2.20.0 < 2.24.0',
    firstPatchedVersion: '2.24.0',
    publishedAt: '2026-04-03T21:43:22Z',
    url: 'https://github.com/advisories/GHSA-cxj8-ggf2-p57c'
  },
  {
    ghsaId: 'GHSA-gfmv-vh34-h2x5',
    cveId: 'CVE-2026-33951',
    severity: 'medium',
    summary: 'Signal K Server: Unauthenticated Source Priorities Manipulation',
    vulnerableVersions: '< 2.24.0-beta.1',
    firstPatchedVersion: '2.24.0-beta.1',
    publishedAt: '2026-04-03T21:42:11Z',
    url: 'https://github.com/advisories/GHSA-gfmv-vh34-h2x5'
  },
  {
    ghsaId: 'GHSA-x8hc-fqv3-7gwf',
    cveId: 'CVE-2026-33950',
    severity: 'critical',
    summary:
      'Signal K Server: Privilege Escalation by Admin Role Injection via /enableSecurity',
    vulnerableVersions: '< 2.24.0-beta.4',
    firstPatchedVersion: '2.24.0-beta.4',
    publishedAt: '2026-04-03T21:37:19Z',
    url: 'https://github.com/advisories/GHSA-x8hc-fqv3-7gwf'
  },
  {
    ghsaId: 'GHSA-qh3j-mrg8-f234',
    cveId: 'CVE-2026-35038',
    severity: 'low',
    summary:
      'Signal K Server: Arbitrary Prototype Read via `from` Field Bypass',
    vulnerableVersions: '< 2.24.0',
    firstPatchedVersion: '2.24.0',
    publishedAt: '2026-04-03T04:04:22Z',
    url: 'https://github.com/advisories/GHSA-qh3j-mrg8-f234'
  },
  {
    ghsaId: 'GHSA-vrhw-v2hw-jffx',
    cveId: 'CVE-2026-25228',
    severity: 'medium',
    summary:
      'SignalK Server has Path Traversal leading to information disclosure',
    vulnerableVersions: '<= 2.20.2',
    firstPatchedVersion: '2.20.3',
    publishedAt: '2026-02-02T22:26:31Z',
    url: 'https://github.com/advisories/GHSA-vrhw-v2hw-jffx'
  },
  {
    ghsaId: 'GHSA-fq56-hvg6-wvm5',
    cveId: 'CVE-2025-68620',
    severity: 'critical',
    summary:
      'Signal K Server vulnerable to JWT Token Theft via WebSocket Enumeration and Unauthenticated Polling',
    vulnerableVersions: '< 2.19.0',
    firstPatchedVersion: '2.19.0',
    publishedAt: '2026-01-02T15:28:54Z',
    url: 'https://github.com/advisories/GHSA-fq56-hvg6-wvm5'
  },
  {
    ghsaId: 'GHSA-vfrf-vcj7-wvr8',
    cveId: 'CVE-2025-69203',
    severity: 'medium',
    summary: 'Signal K Server Vulnerable to Access Request Spoofing',
    vulnerableVersions: '< 2.19.0',
    firstPatchedVersion: '2.19.0',
    publishedAt: '2026-01-02T15:26:11Z',
    url: 'https://github.com/advisories/GHSA-vfrf-vcj7-wvr8'
  },
  {
    ghsaId: 'GHSA-93jc-vqqc-vvvh',
    cveId: 'CVE-2025-68619',
    severity: 'high',
    summary:
      'Signal K Server Vulnerable to Remote Code Execution via Malicious npm Package',
    vulnerableVersions: '< 2.9.0',
    firstPatchedVersion: '2.9.0',
    publishedAt: '2026-01-02T15:23:39Z',
    url: 'https://github.com/advisories/GHSA-93jc-vqqc-vvvh'
  },
  {
    ghsaId: 'GHSA-fpf5-w967-rr2m',
    cveId: 'CVE-2025-68273',
    severity: 'medium',
    summary:
      'Signal K Server Vulnerable to Unauthenticated Information Disclosure via Exposed Endpoints',
    vulnerableVersions: '< 2.19.0',
    firstPatchedVersion: '2.19.0',
    publishedAt: '2026-01-02T15:22:11Z',
    url: 'https://github.com/advisories/GHSA-fpf5-w967-rr2m'
  },
  {
    ghsaId: 'GHSA-7rqc-ff8m-7j23',
    cveId: 'CVE-2025-68272',
    severity: 'high',
    summary:
      'Signal K Server Vulnerable to Denial of Service via Unrestricted Access Request Flooding',
    vulnerableVersions: '< 2.19.0',
    firstPatchedVersion: '2.19.0',
    publishedAt: '2026-01-02T15:20:05Z',
    url: 'https://github.com/advisories/GHSA-7rqc-ff8m-7j23'
  },
  {
    ghsaId: 'GHSA-w3x5-7c4c-66p9',
    cveId: 'CVE-2025-66398',
    severity: 'critical',
    summary:
      'Signal K Server has Unauthenticated State Pollution leading to Remote Code Execution (RCE)',
    vulnerableVersions: '< 2.19.0',
    firstPatchedVersion: '2.19.0',
    publishedAt: '2026-01-02T15:11:49Z',
    url: 'https://github.com/advisories/GHSA-w3x5-7c4c-66p9'
  }
]
