# signalk-lint

A linter for Signal K server installations. It captures a snapshot of a boat's
configuration and checks it against deterministic rules.

**Read [AGENTS.md](AGENTS.md) too.** It holds the conventions — scope, comments,
type safety, tests, commits, pull requests, and the bar a new rule has to clear.
This file is what the codebase *is*; that one is how to work in it.

## Architecture

Two stages, and the boundary between them is the whole design:

```text
collect(...)            -> Snapshot     // the only code that performs I/O
lint(snapshot, config)  -> LintResult   // pure, offline, deterministic
```

`LintResult` carries the `findings`, the `snapshot` they were derived from, and
the ids of rules `skipped` because they were configured `off` — a finding is
never handed over without the evidence base it came from. Individual rules
return `RuleFinding[]`; `lint()` stamps on the rule id, provenance, schema
version and resolved severity.

**A rule is a pure function of a `Snapshot`.** No I/O, no clock, no randomness,
no network, no live server. If a rule needs to know something, that something
must first be captured into the snapshot by a collector. This is what makes
rules testable against JSON fixtures, and what makes the whole tool work at
anchor with no internet — which is where boat problems actually get debugged.
Break it once and none of the rest holds.

```text
src/
  types.ts            Snapshot, Finding, Rule, Provenance -- the contracts
  collect/index.ts    the ONLY module that performs I/O; produces a Snapshot
                      (config files, plugin-config-data/, system + disk facts)
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
  error findings, 1 at least one, 2 the check could not run at all — bad
  arguments, or a config directory that isn't there. **1 and 2 must stay
  distinct**: 1 is a verdict, 2 is the absence of one, and anything scripting
  this tool has to be able to tell "your boat has a problem" from "I never
  looked." CI pins the exact code for the missing-directory case.
- **Webapp** (`public/index.html`) — reads `/findings` and `/snapshot`. Not
  covered by any build, test or format step in this repo.
- **Library** — `src/index.ts` re-exports `collect`, `lint`, `hasErrors`,
  `PRESETS`, `rules` and the types, so other packages can consume the engine
  without going through the plugin. `package.json` also publishes `./rules` and
  `./types` as subpath exports.

## Non-obvious constraints

**A snapshot is meant to be safe to paste into a bug report, and
`pluginConfig` currently breaks that.** People will paste them into bug reports,
so this is the design's most load-bearing promise.

Where it holds: `securityFactsFrom` in `collect/index.ts` reduces
`security.json` to counts and booleans and deliberately does not carry
`secretKey`, user password hashes or device tokens across; `SecurityFacts` in
`types.ts` says so and means it. `collect.test.ts` pins it by serializing a
snapshot and asserting the secrets are absent.

Where it does not: `pluginConfig` copies every `plugin-config-data/*.json`
**verbatim**, and plugin configs routinely hold MQTT passwords, broker
credentials and API tokens. A snapshot from a real boat can therefore contain
secrets, and `--save-snapshot` output and the `/snapshot` route carry them.
Reducing the security file to facts while copying plugin files whole is a gap in
one promise, not two separate decisions. **Until it is closed: treat a snapshot
off a real installation as credential-bearing, and do not tell users it is safe
to share.** The fix is redaction in the collector, where the existing
`securityFactsFrom` boundary already lives.

The promise still constrains rules the same way regardless: a rule that needs a
credential to reason is a rule that does not get written. Rules do not need the
secrets to reason about posture — `plugin/venus-raw-device-instance` reads
`useDeviceNames` and `instanceMappings`, never a password, which is why
redaction can land without changing what any rule can see.

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

**`null` is a meaningful state, and what a rule owes it depends on what the
absence means.** Collectors are forgiving by design — a missing or unreadable
file yields `null`, never an exception, because half a snapshot is useful and a
crash is not. That pushes a judgement onto every rule, and the two answers are
both live in the current rule set:

- **Report it** when `null` means "something that could be dangerous is
  invisible to me". `server/known-vulnerability` emits a `warn` on an unknown
  server version, and `config/allow-readonly-non-loopback` emits one when
  `settings.json` is unreadable while `allow_readonly` is on — a security rule
  that goes quiet when it cannot see looks clean on a server that may be wide
  open, which is the worst failure mode available to it.
- **Stay silent** when `null` means "there is nothing here to evaluate".
  `hardware/unstable-serial-device-path` returns `[]` with no `settings.json`
  because absent settings are no evidence a serial connection exists at all;
  `plugin/venus-raw-device-instance` returns `[]` with no `pluginConfig`
  because the plugin is then not configured; `hardware/no-realtime-clock`
  returns `[]` when `hasRTC` is `null`, which means "not Linux, or could not
  determine" rather than "confirmed absent".

The test is whether the absence is itself suspicious, not whether the rule
happens to be about security. Note also that `{}` and `null` are different
facts for `sourcePriorities`: the file existing with nothing configured is a
real finding, absence is not.

**Rule ids are namespaced `<area>/<name>`, and the area names the part of the
installation the rule reasons about** — not the rule's severity, subject matter
or provenance. It is what a user disables by, and it maps onto the part of the
snapshot the rule reads. The four in use:

- `server/` — the signalk-server package itself (`server.version`)
- `config/` — the server's own config files (`server.settings`, `server.security`)
- `hardware/` — the machine and what is plugged into it (`server.system`, and
  the serial devices named in `settings.pipedProviders`)
- `plugin/` — a third-party plugin's saved config (`server.pluginConfig`)

New areas are fine when a rule genuinely reads a new part of the snapshot;
inventing one for a rule that reads `server.settings` is not.

**A plugin's id is the JSON filename under `plugin-config-data/`, which is not
always the npm package name.** `server.pluginConfig` is keyed by that filename —
`venus.json` is the id `venus`, though the package is `signalk-venus-plugin`.
Verify the id per plugin rather than deriving it from the package name; this has
already bitten. The collector reads the directory generically and keeps
plugin-specific knowledge in the rules, the same way `sourcePriorities` works, so
a rule that understands one plugin's config shape reaches in by id.

That kind of rule also carries a maintenance surface the others do not: it is
pinned to a third party's config schema, which can change in a release we do not
control, unlike our own reading of `settings.json`.
`plugin/venus-raw-device-instance` says so in its own header, and a new
`plugin/` rule should cite where in that plugin's source the behaviour was
verified.

**`SnapshotSource.kind` is `config-dir`, `plugin-runtime` or `fixture`, and
exists so a rule can tell.** Not every fact is capturable from every source —
the config directory does not contain the server version, so the CLI probes for
it or takes `--server-version` while the plugin reads `app.config.version`. No
rule reads `snapshot.source` today: every fact the current rules need is either
present under all three kinds or already nullable in a way the rule handles. A
rule that depends on something only one collector can supply must check the kind
and report that it could not evaluate, rather than firing on the absence.

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
That is adequate only because every shipped rule reads static config files, or
host facts, that are complete at t=0. The `requiresLiveData` flag on `Rule` is declared and unset
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
npm ci && npm run format:check && npm run build && npm test
```

That is every CI check that can fail on your code, in CI's order — run it before
pushing and a red build is a surprise rather than the norm. CI then adds one
step this does not: an end-to-end smoke test of the built CLI, covered below.
Fast and fully offline: the whole suite
runs in well under a second, and nothing here needs a running Signal K server, a
network, or a boat. (No test count here on purpose — it went stale twice in this
file's first day, once when rules landed on main and once from a test added
three commits later. A number nobody can keep current is worse than the shape of
the claim, which is what actually matters: if the suite ever needs a server or a
minute, something has gone wrong.)

There is no ESLint in this repo. "Lint the code" means `npm run format:check`
plus `npm run build` (`tsc`) — the same two commands, which CI runs on both Node
22 and 24. `npm run format` fixes what `format:check` reports.

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
  otherwise `~/.signalk`. Both halves match signalk-server's own resolution in
  `getConfigDirectory` (`src/config/config.ts`), which reads that variable and
  falls back to `$HOME/.signalk`. Worth knowing if a config directory ever turns
  up somewhere unexpected: upstream checks the **misspelled**
  `SIGNALK_NODE_CONDFIG_DIR` first, ahead of the correctly spelled one, and it is
  still there. It fails loudly if the path is missing:
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

`snapshot*.json` is gitignored. A snapshot carries a boat's configuration —
treat one from someone else's vessel as theirs — and until the `pluginConfig`
gap above is closed it can also carry plugin credentials, so check before
sharing one rather than assuming it is safe.

## Releasing

Tag `vX.Y.Z` and push. `.github/workflows/publish.yml` runs on version tags
only, verifies the tag matches `package.json`, and publishes via npm OIDC
trusted publishing — no npm token exists on any developer machine. Nothing
publishes on a plain push to `main`.

Version bumps are manual here: edit `package.json`, then tag to match. There is
no auto-version hook and no `CHANGELOG.md`.
