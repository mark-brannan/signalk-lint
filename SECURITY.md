# Security Policy

## Supported versions

This package is maintained as a single moving line. Only the latest version
published to npm (and to the Signal K app store) gets fixes; there are no
maintenance branches.

| Version | Supported |
| ------- | --------- |
| latest `0.x` on [npm](https://www.npmjs.com/package/signalk-lint) | yes |
| anything older | no — upgrade first |

## Reporting a vulnerability

**Two different things can be a "vulnerability" here, and they go to
different places.**

**A bug in the linter itself** — it crashes, hangs, or mishandles a
configuration snapshot. Report that privately through GitHub:

1. Go to
   [Security → Report a vulnerability](https://github.com/mark-brannan/signalk-lint/security/advisories/new).
2. Describe what you found and, if you can share it safely, the
   configuration snapshot that triggers it. See *What is out of scope* below
   for what not to attach.

You should get an acknowledgement within a week. This is a spare-time project
maintained by one person, so a fix may take longer than that — you will be told
where it stands rather than left waiting. If a report is valid and you want
credit, you will be named in the advisory.

If you get no response at all within two weeks, open a public issue saying only
that you are waiting on a private report — no details — and it will be picked
up.

**A real misconfiguration this tool flags on your own boat** (an exposed
`allow_readonly`, a vulnerable server version) is not a report to this
project — it's a finding about your installation. Fix it there; the rule
existing and firing correctly is the tool working as intended.

## What is in scope

This tool reads a snapshot of someone's live Signal K configuration and
data — files that may contain network topology, device identifiers, and
occasionally credentials left in a config value by mistake.

- **The collector and snapshot handling** (`src/collect`, `src/snapshot.ts`,
  `src/config-dir.ts`). Anything that reads outside the configured
  `--config-dir`, follows a symlink it shouldn't, or leaks snapshot content
  somewhere other than the requested output is in scope.
- **The webapp** (`public/index.html`). It renders values pulled from a
  boat's own configuration; anything that turns a config value into script
  execution rather than displayed text is in scope.
- **The advisory pipeline** (`scripts/update-advisories.mjs`,
  `src/data/advisories.ts`, `src/rules/server-version-advisories.ts`). Advisories ship
  compiled into the package rather than fetched live, specifically so a boat
  offline still gets a check — a way to make that check silently pass when it
  shouldn't is in scope.
- **A rule that crashes or hangs** on a malformed but plausible
  configuration or data snapshot, rather than reporting a finding or
  cleanly skipping.
- **The published package** — anything shipped in `files` that should not be
  there, or a discrepancy between npm and this repository at the
  corresponding tag.

## What is out of scope

- **A false positive or a missed check.** A rule that fires when it
  shouldn't, or fails to flag a real misconfiguration, is an ordinary bug:
  open a public issue with the (redacted, if needed) snapshot fragment that
  shows it.
- **Vulnerabilities in Signal K server itself or in a plugin.** Report those
  upstream, in the relevant project. This tool only detects and cites known
  issues; it does not fix them.
- **A misconfiguration on your own vessel that a rule correctly flagged.**
  That is the finding doing its job — see above.
- Requests for a new rule. That's a feature request, welcome as a public
  issue.

## Notes on how this package is built

- The advisory list is generated ahead of time and checked in
  (`src/data/advisories.ts`), not fetched at lint time, so the check still
  runs with no internet connection — the tradeoff is staleness, which the
  data's `GENERATED_AT` makes visible rather than silent.
- The linter reads a configuration snapshot; it does not connect to a live
  Signal K server, open a network port, or write back to the config it
  inspects.
- `npm test` runs against fixtures with the network unavailable.
