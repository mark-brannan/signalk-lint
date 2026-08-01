# signalk-lint

A linter for Signal K server installations.

Point it at a boat and it tells you what's misconfigured, unsecured, ambiguous,
or quietly broken — the things that are true about your install right now but
that nothing on the boat is going to tell you about.

> **Status: early.** The architecture is settled; the rule set is not. One rule
> ships today. See [Roadmap](#roadmap) for what's coming and
> [Contributing a rule](#contributing-a-rule) if you'd like to argue with the
> defaults in code rather than in an issue.

## Why

Signal K installs accumulate. A chartplotter, a GPS antenna and an AIS
transponder all publish position, and nothing tells you which one actually
won. A depth sensor drops off the bus and the last value it sent sits in the
data model looking perfectly plausible. The server ships with defaults that
were reasonable in a marina berth and less so on open guest wifi. Meanwhile
fourteen security advisories have been published against `signalk-server`, and
the only way you find out you're behind is by going and looking.

None of this is exotic. All of it is invisible unless something goes looking.

## Install

```bash
npm install -g signalk-lint
```

Or install **Lint** from the Signal K app store to run it inside the server.

## Use

```bash
signalk-lint --config-dir ~/.signalk
```

```
ERROR critical — Signal K Server has Unauthenticated State Pollution leading to Remote Code Execution (RCE)
      server/known-vulnerability  [advisory]
      signalk-server 2.18.0 is affected by GHSA-w3x5-7c4c-66p9 (CVE-2025-66398).
      Affected versions: < 2.19.0. Fixed in 2.19.0.
      → Upgrade signalk-server to 2.28.0 or later.
      https://github.com/advisories/GHSA-w3x5-7c4c-66p9

12 finding(s): 6 error, 5 warn, 1 info
```

Exit code is `1` when anything at error severity fires, so it drops into CI or
a cron job without ceremony.

### Linting someone else's boat

```bash
# on the boat, possibly with no internet:
signalk-lint --save-snapshot my-boat.json

# anywhere, later:
signalk-lint --snapshot my-boat.json
```

A snapshot is a complete, self-contained description of an installation. This
is what makes remote help possible: someone can send you a snapshot of a boat
you have never seen and you can run the entire rule set against it on your
laptop.

Snapshots never contain secrets — `security.json` is reduced to facts, and the
secret key, password hashes and device tokens are deliberately left behind. You
can paste one into a bug report.

## How it works

```
collect(configDir)        →  Snapshot     the only code that does I/O
lint(snapshot, config)    →  Finding[]    pure, offline, deterministic
```

The design is borrowed wholesale from ESLint, because ESLint already solved
this problem: collectors build a structured representation, rules are
independent pure functions over it, findings carry machine-readable fix
descriptors, and any eventual `--fix` is a separate executor that arrives
years later without a redesign.

Three constraints hold the whole thing up:

**The snapshot is the source file.** Rules never touch a live server. If a
rule needs to know something, it must be captured into the snapshot first.
That's what makes rules testable against fixtures and runnable at anchor.

**Nothing on the critical path needs a network.** Boats are offline, and boat
projects happen at anchor. Security advisory data is bundled with each release
rather than fetched, with the generation date shown in the finding so staleness
is visible rather than silent.

**Remediation is data, not action.** Every finding carries a structured
description of the change that would fix it. Nothing executes them — the tool
is read-only by design. They exist as data from day one so that if a write path
is ever built, it consumes a descriptor that has already shipped and been
argued about, rather than one invented late and in a hurry.

## Rules

| Rule | Provenance | Default |
| --- | --- | --- |
| `server/known-vulnerability` | advisory | error |

Run `signalk-lint --list-rules` for the current set.

Every finding declares where its authority comes from, because findings are
argued differently:

- **advisory** — a published CVE or GHSA. Not our judgement.
- **documented** — stated in the Signal K specification or docs.
- **convention** — widespread community practice, not formally written down.
- **opinion** — our judgement. Arguable in good faith, and we'll say so.

Conflating these is how a linter loses trust, so the distinction is in the
type system rather than in a style guide.

## Configuration

```json
{
  "extends": "recommended",
  "rules": {
    "server/known-vulnerability": "error"
  }
}
```

Severities are `off`, `info`, `warn`, `error`.

Presets exist because a charter operation and a solo cruiser have genuinely
different obligations, and neither should have to argue with us about defaults.
A boat that is open by design and physically secured is making a legitimate
choice — the answer to that is a shareable preset, not a hardcoded exception.

## Roadmap

Six rules seed the set. One is implemented.

1. ✅ **Known vulnerabilities** — installed version vs. published advisories.
2. ⬜ **Security not configured** — no admin account, everything open.
3. ⬜ **Readonly access combined with non-loopback binding** — benign at anchor
   alone, a data leak on marina wifi. The combination is the finding.
4. ⬜ **Unresolved source ambiguity** — multiple sources on one path with no
   priority configured. Multiple sources are *not* an error; unresolved
   ambiguity is. See [signalk-server#2162](https://github.com/SignalK/signalk-server/issues/2162).
5. ⬜ **Stale paths** — a value that stopped updating hours ago and still looks
   plausible to anything reading it.
6. ⬜ **No configuration backup** — the whole install lives in one directory on
   an SD card that will eventually fail.

## Contributing a rule

A rule is a pure function from `Snapshot` to findings, plus fixtures. That's
deliberately the smallest possible unit of contribution, because the useful
knowledge about boats is out there on boats, not here.

1. Add `src/rules/<name>.ts` exporting a `Rule`.
2. Register it in `src/rules/index.ts`.
3. Add a fixture in `test/fixtures/` and a test.

Rules must be deterministic: no I/O, no clock, no randomness, no network. If
your check genuinely needs judgement rather than logic, it doesn't belong here
— that's what [signalk-bosun](https://github.com/mark-brannan/signalk-bosun)
is for.

```bash
npm install
npm test
npm run build
npm run update-advisories   # refresh bundled advisory data
```

## Related

- [signalk-bosun](https://github.com/mark-brannan/signalk-bosun) — makes these
  findings useful to humans and agents. Separate on purpose: this package stays
  deterministic, offline, and free of any dependency on a model.
- [signalk-doctor](https://github.com/dirkwa/signalk-doctor) — platform and
  host health (containers, clock drift, recovery snapshots). Complementary:
  Doctor asks whether the machine is healthy, Lint asks whether the boat is
  configured correctly.

## License

Apache-2.0
