# Conventions

How to work in this repo.

[`CLAUDE.md`](CLAUDE.md) is the companion: it holds what this codebase *is* —
the collect/lint split, the non-obvious constraints, local development,
releasing. This file holds how to behave. Read both.

## Scope

Follow YAGNI, DRY and KISS. Only make changes that were asked for or are clearly
necessary. A bug fix does not need the surrounding code cleaned up. A new rule
does not need a configuration knob.

Validate at the boundaries — a config file read off disk, a snapshot loaded from
JSON, a CLI argument — and trust internal code in between. Do not add error
handling for cases that cannot happen. Note that "the file is missing or
malformed" is a case that happens constantly and is already handled: collectors
return `null`. Do not add throws to that path.

**Verify before asserting.** Check the source, the running server, or the
project's own docs. Never infer behaviour from a config field name, a plugin's
title, or a type's shape and write it up as fact — this is a tool whose entire
value is being right about other people's configuration, and a rule built on a
guess about what a Signal K field means is worse than no rule. When a claim
cannot be verified, leave it out or raise it in conversation. A gap beats a
confident guess.

## The bar a new rule has to clear

**False positives are the failure mode for a linter.** A noisy linter gets
ignored entirely, and once ignored it costs more than the rule was ever worth —
including for the rules that were right. Every new rule is spending trust that
the whole tool shares.

So, before adding one:

- **Name the configuration that legitimately looks like this and must not
  fire.** If you cannot, you do not yet understand the rule. Frequently the
  answer is that neither half of the condition is a problem alone, which is why
  a real rule ends up a conjunction: `config/allow-readonly-non-loopback` fires
  on `allow_readonly` **and** a non-loopback binding, because unauthenticated
  read access is entirely reasonable alone at anchor, and a network binding is
  the normal case on every boat with a chartplotter.
- **Write the fixture that must stay clean** before the one that must fire.
  Both belong in the rule's tests.
- **Set `provenance` honestly**, per the four values in `CLAUDE.md`. Claiming
  `documented` for something the spec does not say is a defect, not a wording
  choice.
- **Decide what the rule does when it cannot see.** Silently returning `[]` on a
  `null` is only correct when absence genuinely means "fine" — as it does when
  `security.json` is missing, since the server defaults do not include
  `allow_readonly`. Everywhere else, report that the check did not run.
- **Say why it matters on a boat.** `detail` is read by someone standing in an
  engine room, not by a security auditor. The finding has to be actionable
  there.

A rule that is right but unactionable is still a bad rule. If the answer to
"what do I do about this" is nothing, do not ship it.

Presets are how people who disagree with our defaults — a charter operation and
a solo cruiser have genuinely different obligations, and both are arguing in
good faith — encode that as configuration rather than as an argument in the
issue tracker. Reach for a preset before reaching for a softer default.

## Comments and docs

Comments explain **why**, never what. No echo comments restating the line below
them. The existing comments in `src/types.ts`, `src/lint.ts` and the rules carry
the reasoning behind the design; when you change one of those decisions, change
the comment in the same commit rather than leaving it to contradict the code.

Documentation describes the current state, not how it got there. No version
archaeology in source, in the README, or in these two files.

An open design question is worth writing down where the decision will be made —
the scheduling comment in `src/index.ts` is the model. Write out what is
unresolved and why solving it now would be premature, not a `TODO`.

## Type safety

`tsconfig.json` sets `strict: true`. Keep it there. No `any` in new code; prefer
narrowing to casting.

Where a cast is genuinely unavoidable — the Signal K `app` object carries more
than `@signalk/server-api` types admit — reach for it narrowly and say why.
`ServerInternals` in `src/index.ts` is the pattern: declare the one property you
need, not the whole untyped surface.

Note that `tsc` does not typecheck `test/` (see `CLAUDE.md`). Write tests as if
it did.

## Tests

All new code needs tests. Assert behaviour — findings, severities, evidence
paths, evidence values, exit codes — never display strings. Titles and `detail`
text will be rewritten; a test that pins their wording just breaks.

- **A rule's test data is a fixture file**, a whole `Snapshot` under
  `test/fixtures/`, not an object built inline. Fixtures are readable by someone
  who wants to know what configuration this rule cares about, and they are what
  a bug report can be turned into.
- **Every rule gets a purity test.** `expect(rule.evaluate(s)).toEqual(
  rule.evaluate(s))` — cheap, and it catches a rule that has quietly acquired
  state or a clock.
- **Every rule gets a must-not-fire test**, not just a must-fire one.
- **Test the cannot-evaluate path.** A rule that silently passes on a `null` is
  the specific bug this project cares most about not shipping.
- Tests run with no network and no server. Keep it that way; a rule that needs
  either is a rule whose facts belong in a collector.

## Generated files

`src/data/advisories.ts` is generated by `npm run update-advisories`. Never
hand-edit it, and do not commit a regeneration alongside unrelated work — the
diff is large and buries everything else. It is its own commit.

## Commits

Conventional format: `<type>(<scope>): <subject>`, where type is one of
`feat|fix|docs|style|refactor|test|chore|perf`. Subject in the imperative, 50
characters or fewer, no trailing period. Body wrapped at 72, explaining what and
why. One-liners are fine for small changes.

One logical change per commit. Split unrelated work. Amend a correction into the
commit it belongs to rather than stacking "fix typo" on top — history should
read as intentional steps.

**Always commit with an explicit pathspec: `git commit -m "..." -- path1
path2`.** Plain `git commit` commits the whole index, not the files you meant
to stage, so anything another session staged in between rides along under your
message. Checking `git status` first does not close this — it is an observation,
not a constraint. The pathspec form removes the race instead of watching for it.

Never `git add -A` or `git add .`.

## Pull requests

- Branch from latest `main`
- `npm run format:check`, `npm run build` and `npm test` must pass
- One logical change per PR. A refactor and a behaviour change are two PRs.
- Title as if it were the release note, because it becomes one
- Description: motivation and approach, not mechanics — the diff shows what
  changed. For a new rule, state what it fires on and what it deliberately does
  not.
- Call out breaking changes to `Snapshot` or `Finding` explicitly, and bump the
  corresponding `SCHEMA_VERSION` in `src/types.ts` in the same PR. Consumers
  check those before trusting fields.
- Reference issues with `closes` / `fixes` / `resolves`
- Rebase onto `main`; never merge `main` into the branch

If a request arrives that is outside the current PR's topic, say so and propose
a separate PR rather than quietly folding it in.
