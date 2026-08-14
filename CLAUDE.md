# signalk-lint

A linter for Signal K server installations. It captures a snapshot of a boat's
configuration and checks it against deterministic rules.

**Read [AGENTS.md](AGENTS.md) too.** It holds the conventions — scope, comments,
type safety, tests, commits, pull requests, and the bar a new rule has to clear.
This file is what the codebase *is*; that one is how to work in it.

## Architecture

Two stages, and the boundary between them is the whole design:

```
collect(...)            -> Snapshot     // the only code that performs I/O
lint(snapshot, config)  -> Finding[]    // pure, offline, deterministic
```

**A rule is a pure function of a `Snapshot`.** No I/O, no clock, no randomness,
no network, no live server. If a rule needs to know something, that something
must first be captured into the snapshot by a collector. This is what makes
rules testable against JSON fixtures, and what makes the whole tool work at
anchor with no internet — which is where boat problems actually get debugged.
Break it once and none of the rest holds.

```
src/
  types.ts            Snapshot, Finding, Rule, Provenance -- the contracts
  collect/index.ts    the ONLY module that performs I/O; produces a Snapshot
  lint.ts             pure: (Snapshot, LintConfig) -> LintResult; presets, severity
  rules/              one file per rule; rules/index.ts is the registry
  data/advisories.ts  GENERATED -- GitHub Advisory Database, bundled for offline use
  index.ts            Signal K plugin entry point: scheduling, HTTP routes
  cli.ts              standalone CLI
public/index.html     webapp: plain HTML/JS, no build step, no bundler
test/fixtures/        snapshots as JSON -- a rule's test data is a file
```

**To add a rule: write `src/rules/<name>.ts` exporting a `Rule`, add it to the
array in `rules/index.ts`, and add fixtures under `test/fixtures/`.** Nothing
else. That is deliberately the smallest possible unit of contribution, because
rules are where community knowledge about boats comes from.

### Surfaces

The plugin, the CLI and the webapp are surfaces over the same engine; none of
them contain judgement.

- **Plugin** (`src/index.ts`) — runs in-process, which is the reason it can see
  what it sees: the REST API shows the data model, but `settings.json`,
  `security.json` and `priorities.json` are only visible from inside. Exposes
  `/plugins/signalk-lint/{findings,snapshot,rules}`.
- **CLI** (`src/cli.ts`) — `--config-dir` captures and lints; `--snapshot` lints
  a snapshot captured elsewhere. The second mode is the point of the
  architecture: someone can send you a snapshot of a boat you have never seen
  and you can run the full rule set against it on your laptop. Exit codes: 0 no
  error findings, 1 at least one, 2 the tool itself crashed.
- **Webapp** (`public/index.html`) — reads `/findings` and `/snapshot`. Not
  covered by any build, test or format step in this repo.
- **Library** — `src/index.ts` re-exports `collect`, `lint`, `rules` and the
  types so other packages can consume the engine without the plugin.

## Non-obvious constraints

**A snapshot must stay safe to paste into a bug report.** People will paste
them into bug reports. `securityFactsFrom` in `collect/index.ts` reduces
`security.json` to counts and booleans and deliberately does not carry
`secretKey`, user password hashes or device tokens across; `SecurityFacts` in
`types.ts` says so and means it. `collect.test.ts` pins it by serializing a
snapshot and asserting the secrets are absent. This is a hard limit on what a
rule can ever check — a rule that needs a credential to reason is a rule that
does not get written. Rules do not need the secrets to reason about posture.

**Every finding carries `Evidence`: a dotted path into the snapshot and the
value observed there.** Evidence is what separates a linter from a horoscope —
every finding must be able to show its work. A finding with no evidence, or
with a path that does not resolve in the snapshot it was produced from, is not
a finding.

**Provenance is where a rule's authority comes from, and there are four
values, not two.** `advisory` (a published CVE — not our judgement),
`documented` (stated in the Signal K specification or official docs),
`convention` (widespread community practice, not formally written down), and
`opinion` (ours, arguable in good faith). The distinction is surfaced to users
because the findings are argued differently. **A rule that asserts community
practice as though it were the specification is a defect**, not a wording
choice: `config/allow-readonly-non-loopback` is `convention` precisely because
nothing in the spec says it. Conflating the two is how a linter loses trust.

**`null` is a meaningful state and must be reported, not silently passed.**
Collectors are forgiving by design — a missing or unreadable file yields `null`,
never an exception, because half a snapshot is useful and a crash is not. That
pushes the responsibility onto rules: seeing a `null` means "I could not
evaluate this", and saying nothing is the worst failure mode available,
especially to a security rule. Both shipped rules emit a `warn` finding rather
than returning `[]` when they cannot see — an unknown server version, an
unreadable `settings.json`. Note also that `{}` and `null` are different facts
for `sourcePriorities`: the file existing with nothing configured is a real
finding, absence is not.

**Rule ids are namespaced `<area>/<name>`, and the area names the part of the
installation the rule reasons about** — not the rule's severity, subject matter
or provenance. It is what a user disables by, and it should map onto the shape
of the snapshot the rule reads. Today that is `config/` (server config files)
and `server/` (the server package itself). New areas are fine when a rule
genuinely reads a new part of the snapshot; inventing one for a rule that reads
`server.settings` is not.

**`SnapshotSource.kind` is `config-dir`, `plugin-runtime` or `fixture`, and
exists so a rule can tell.** Not every fact is capturable from every source —
the config directory does not contain the server version, so the CLI probes for
it or takes `--server-version` while the plugin reads `app.config.version`. No
rule reads `snapshot.source` today, because both shipped rules read config files
that are present under all three. A rule that depends on something only one
collector can supply must check the kind and report that it could not evaluate,
rather than firing on the absence.

**Advisory data ships with the code rather than being fetched at runtime.** A
boat at anchor has no internet, and a security rule that silently passes when
offline is worse than no rule at all. The cost is staleness, made visible by
`GENERATED_AT` and restated in every finding the rule emits.
`src/data/advisories.ts` is generated by `scripts/update-advisories.mjs` (which
needs `gh` authenticated) — never hand-edit it.

**`semver.satisfies` needs `includePrerelease` here.** Several Signal K
advisories were patched in betas (`< 2.24.0-beta.4`), and without the flag
semver refuses to match prerelease versions at all — the rule silently becomes a
no-op for anyone running one. `prerelease-server.json` exists to pin this.

**An explicit user severity override flattens a rule's own per-finding
weighting.** `lint()` resolves severity as `overrides[ruleId] ?? raw.severity ??
configured`, so `server/known-vulnerability` weights a critical CVE `error` and
a low one `info` by default, but a user who sets that rule to `info` gets every
finding at `info`. That is intentional — an explicit override wins — but it
means a rule cannot rely on its own weighting surviving configuration.

**Remediation is data that nothing executes.** The tool is read-only by design.
`Remediation` exists as a descriptor from day one so that an eventual write path
consumes something that has already shipped, been reviewed and been argued about
for a long time, rather than being invented late. In read-only mode it renders
as instructions a human follows. Do not add code that applies one.

**A linter that takes the server down has failed at its actual job.** The
plugin's `run()` catches everything and reports through `setPluginError`. Keep
it that way.

**Scheduling is provisional and the code says so.** The plugin runs once on
`start()` and then every `intervalMinutes` (default 60) on a plain
`setInterval` that resets on every plugin start or server restart; the webapp
renders the last completed run, and returns 503 until there has been one.
That is adequate only because both shipped rules read static config files that
are complete at t=0. The `requiresLiveData` flag on `Rule` is declared and unset
on every shipped rule — it exists so a future scheduler has something to key
off. The open questions (boot-time false positives on paths that have not
arrived yet; findings that flap as the NMEA bus warms up) are written out in
full in the comment above the plugin factory in `src/index.ts`. Read it before
changing scheduling, and do not solve it speculatively.

## Conventions

No semicolons, two-space indent, single quotes — run `npm run format`
(prettier, configured in `.prettierrc`); `npm run format:check` verifies, and CI
runs it. Comments explain *why*, not what.

## Local development

```shell
npm ci && npm run build && npm test
```

Fast and fully offline — 30 tests in well under a second. Nothing here needs a
running Signal K server, a network, or a boat.

There is no ESLint in this repo. "Lint the code" means `npm run format:check`
plus `npm run build` (`tsc`), which is exactly what CI runs, on Node 22 and 24.

Four things that are easy to get wrong:

- **`tsc` typechecks `src/` only.** `tsconfig.json` sets `include:
  ["src/**/*.ts"]`, and vitest does not typecheck either, so a type error in
  `test/` is caught by neither `npm run build` nor `npm test`. Tests are
  strict-mode TypeScript by convention here, not by enforcement.
- **Prettier's globs cover `src/**/*.ts` and `test/**/*.ts` only.**
  `public/index.html` is neither formatted nor checked; match the surrounding
  style by hand.
- **`npm run lint:local` is not a code linter.** It builds and runs the CLI
  against a real Signal K installation — `$SIGNALK_NODE_CONFIG_DIR` if set,
  otherwise `~/.signalk`, matching both the server's own environment variable and
  the CLI's own default. It fails loudly if that path is missing:
  `assertConfigDir` in `src/config-dir.ts` validates the directory before
  anything reads it, because the collector's forgiving nulls would otherwise turn
  a wrong path into a clean run that exits 0. To point it at a config directory
  that mirrors a real boat, set the variable rather than editing the script.
- **The fastest way to exercise a change end to end is a fixture, not a
  server:** `node dist/cli.js --snapshot test/fixtures/vulnerable-server.json`.
  CI does exactly this as a smoke test, asserting a non-zero exit, to catch the
  case where a rule stops matching but the unit tests still pass because the CLI
  wiring is what broke.

To capture a snapshot from a real installation for later analysis:

```shell
node dist/cli.js --config-dir ~/.signalk --save-snapshot snap.json
```

`snapshot*.json` is gitignored. Snapshots carry no secrets by construction, but
they do carry a boat's configuration — treat one from someone else's vessel as
theirs.

## Releasing

Tag `vX.Y.Z` and push. `.github/workflows/publish.yml` runs on version tags
only, verifies the tag matches `package.json`, and publishes via npm OIDC
trusted publishing — no npm token exists on any developer machine. Nothing
publishes on a plain push to `main`.

Version bumps are manual here: edit `package.json`, then tag to match. There is
no auto-version hook and no `CHANGELOG.md`.
