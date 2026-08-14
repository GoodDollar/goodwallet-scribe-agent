# GoodWallet Scribe Agent

Advisory GitHub Action and CLI that reviews the Markdown a pull request changes, runs deterministic checks plus an LLM-backed provider review, and posts the results as a job summary and/or a sticky PR comment. Content findings — no matter how severe — never block the PR; only a genuine technical failure (a crashing provider, invalid config, a GitHub API error) can fail the run.

## Problem and goals

Documentation drifts from the code and from itself: a setup guide says one Node version while CI enforces another, a renamed API is still documented under its old name, a relative link rots after a file move. Nobody catches this in review because it isn't a compile error or a failing test.

Scribe's goals:

- Review only the Markdown a PR actually touches, plus a small, bounded amount of surrounding context (linked docs, the nearby README, the non-Markdown files that changed alongside it).
- Combine cheap deterministic checks (e.g. broken relative links) with a pluggable, LLM-backed provider for fuzzier issues (contradictions, stale references, quality, duplication).
- Stay strictly advisory: findings are reported, never enforced. Only genuine technical failures (a crashing provider, invalid config, etc.) fail the run.
- Treat repository content as untrusted input everywhere it flows into a prompt or back into a rendered report.

## Live demo

- Repo: https://github.com/GoodDollar/goodwallet-scribe-agent
- Demo PR: https://github.com/GoodDollar/etoro-plus/pull/48
- Successful run: https://github.com/GoodDollar/etoro-plus/actions/runs/31796398583
- Sticky PR comment: https://github.com/GoodDollar/etoro-plus/pull/48#issuecomment-5292789162

The demo PR seeds an intentional contradiction (a doc saying "Use Node.js 18" while the workflow and README require Node.js 22) so the review has something real to catch. The live run above reported **5 advisory findings** (1 error, 2 warnings, 2 info), including that seeded Node 18 vs Node 22 contradiction as the error-level finding. The run shown was itself a job rerun on the same PR, and it **updated the same sticky comment ID** created by the first attempt rather than posting a duplicate — the comment's `created_at` and `updated_at` timestamps on GitHub correspond to the two separate job attempts of that run. The check completed successfully and never blocked the PR.

## Quick start

There is no tagged release yet — pin the action to the demo branch for now:

```yaml
name: Documentation Quality

on:
  pull_request:
    branches: [main]
    paths:
      - "**/*.md"
      - ".scribe.yml"

permissions:
  contents: read
  pull-requests: write
  copilot-requests: write

jobs:
  documentation-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: 22

      - name: Install GitHub Copilot CLI
        run: npm install --global @github/copilot@1.0.80

      - name: Run Scribe
        uses: GoodDollar/goodwallet-scribe-agent@feat/initial-demo
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

This mirrors the live demo workflow in `etoro-plus`. `fetch-depth: 0` matters: the action diffs `base`/`head` with `git diff`/`git show`, so it needs real git history, not a shallow checkout.

**Future v1 note:** once this repo cuts a `v1` tag/release, consumers should switch to `uses: GoodDollar/goodwallet-scribe-agent@v1` (or a pinned `v1.x.y` tag) instead of the mutable `feat/initial-demo` branch reference, so the action version used in CI can't change out from under a workflow without a deliberate bump. That tag does not exist yet.

## `.scribe.yml` reference

Config is optional — if `.scribe.yml` (or the path given via the `config` input/`--config` flag) doesn't exist, the built-in defaults below apply. If it exists, it's parsed as YAML and validated with a strict schema: **unknown top-level or `report` keys are rejected** with an "Unknown config key" error, and `maxFiles`/`maxBytes` must be positive integers.

| Key              | Type       | Default                                                              | Meaning                                                                 |
| ---------------- | ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `include`        | `string[]` | `["**/*.md"]`                                                          | Glob patterns (via `minimatch`, `dot: true`) selecting reviewable docs. |
| `exclude`        | `string[]` | `["node_modules/**", "dist/**", "vendor/**", "coverage/**", ".git/**"]` | Glob patterns removed from `include` matches.                          |
| `maxFiles`       | `number`   | `30`                                                                   | Max documents admitted into one primary document's bounded context.    |
| `maxBytes`       | `number`   | `200000`                                                               | Max total UTF-8 bytes admitted into one primary document's context.    |
| `provider`       | `string`   | `"copilot"`                                                            | Review provider name, resolved by the orchestrator.                    |
| `report.summary` | `boolean`  | `true`                                                                 | Write the Markdown report to the job summary.                          |
| `report.comment` | `boolean`  | `true`                                                                 | Upsert the Markdown report as a sticky PR comment.                     |

`maxFiles`/`maxBytes` are budgets **per changed primary document**, not a global cap — see [`docs/architecture.md`](docs/architecture.md) for how that budget is spent.

**Provider precedence:** the `provider` action input and the CLI's `--provider` flag have no built-in default of their own — they're only applied when explicitly set, in which case they override `.scribe.yml` for that run. When neither is set, `config.provider` governs, which itself defaults to `"copilot"` when `.scribe.yml` doesn't set `provider` (or doesn't exist at all). In short: **explicit `--provider`/`provider` input > `.scribe.yml`'s `provider` > built-in default `"copilot"`.** This means a workflow that omits the `provider` input entirely (like the live demo) resolves through `.scribe.yml`, not through a hardcoded Action default.

Example:

```yaml
include:
  - "**/*.md"
exclude:
  - "node_modules/**"
  - "dist/**"
  - "vendor/**"
  - "coverage/**"
  - ".git/**"
maxFiles: 30
maxBytes: 200000
provider: copilot
report:
  summary: true
  comment: true
```

## CLI usage

```bash
scribe --base <ref> --head <ref> [--config <path>] [--provider <name>]
```

- `--base`, `--head` — required. Any git refs/SHAs resolvable in the current repo.
- `--config` — optional path to a config file (relative paths resolve against the CLI's working directory).
- `--provider` — optional override of `config.provider` for this run only.

The report renders to stdout; the process exits `0` on success (regardless of findings) and `1` with the error message on stderr for technical failures. After `npm run build`, run it via the built binary or the `scribe` bin alias:

```bash
node dist/cli.js --base origin/main --head HEAD
# or, after `npm link` / global install:
scribe --base origin/main --head HEAD
```

During development, run it directly with `tsx`:

```bash
npx tsx src/cli.ts --base origin/main --head HEAD
```

## Architecture and data flow

See [`docs/architecture.md`](docs/architecture.md) for the full component breakdown. In short: an entry point (CLI or Action) resolves `repoRoot`/`base`/`head`/config, then `runScribeReview` (`src/orchestrator.ts`) discovers changed files, selects the changed Markdown files as "primary documents," assembles a bounded context per primary document, runs the deterministic link check, calls the configured provider once with all contexts, merges the two finding sets, and hands the result to `renderMarkdownReport` for output.

## Deterministic vs. probabilistic checks

- **Deterministic** (`source: "deterministic"`): currently just `checkLocalLinks` (`src/core/local-links.ts`) — for every Markdown link `[text](target)` in a primary document's **head** content, resolves `target` relative to the document and flags it (`category: "broken-link"`, `severity: "error"`, `confidence: 1`) if it doesn't exist on disk or resolves outside the repo. This runs unconditionally on every primary document's head content, independent of the context budget below.
- **Probabilistic** (`source: "agent"`): everything the configured provider returns — `contradiction`, `stale-reference`, `quality`, `duplicate`, and provider-reported `broken-link` findings, each with a model-assigned `confidence` between 0 and 1. Only runs when at least one primary document exists.

Deterministic findings are always listed first; both sets share one `Finding` shape and are merged into a single report.

## Finding fields and severities

Every finding (`src/core/findings.ts`) is a strict object with exactly these fields:

| Field         | Type                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| `category`    | `"contradiction" \| "stale-reference" \| "broken-link" \| "quality" \| "duplicate"` |
| `severity`    | `"info" \| "warning" \| "error"`                                                    |
| `confidence`  | `number` (0–1 inclusive)                                                            |
| `evidence`    | non-empty `string`                                                                  |
| `file`        | non-empty `string`                                                                  |
| `line`        | positive integer                                                                    |
| `explanation` | non-empty `string`                                                                  |
| `suggestion`  | non-empty `string`                                                                  |
| `source`      | `"deterministic" \| "agent"`                                                        |

`severity` is a signal for the reader ("this looks like a real bug" vs. "this is a style nit") — see the next section for what it does *not* do.

## Advisory semantics

Severity never gates the run. `severity: "error"` findings are reported exactly like `"info"` findings: rendered into the same report, never causing `core.setFailed`. The **only** thing that fails the Action or exits the CLI non-zero is a genuine technical failure — an unhandled exception from config loading, git, the provider, or the GitHub API (see `src/action/index.test.ts`, `"calls setFailed for technical errors only"`). Content findings — however severe — always pass.

## Provider architecture

```ts
export interface ProviderRequest {
  contexts: PrimaryDocumentContext[];
}

export interface Provider {
  review(request: ProviderRequest): Promise<Finding[]>;
}
```

(`src/providers/index.ts`) One provider is invoked **once per run**, with every primary document's context passed together in a single `contexts` array — not once per file.

**Current provider: Copilot CLI only.** `createCopilotCliProvider` (`src/providers/copilot.ts`) is the sole real implementation, resolved when the effective provider name (see "Provider precedence" above) is `"copilot"`. It:

1. Serializes `contexts` into a prompt that frames the content as untrusted data (see [`docs/security.md`](docs/security.md)) and states the exact response contract (one JSON object, `{ findings: [...] }`, one key per finding, `source` must be `"agent"`).
2. Spawns `copilot -s --no-ask-user -p "<prompt>"` as a child process, inheriting `process.env`.
3. Parses and validates the response against `findingSchema`; on a contract-invalid response (bad JSON, schema mismatch, or `source !== "agent"`), retries **once** with the validation error appended to the prompt; a second failure throws a real `Error` (a technical failure, not a finding).

**Adding and registering another provider:**

1. Implement `Provider` in a new file under `src/providers/`, e.g. `src/providers/my-provider.ts`, returning `Finding[]` that pass `findingSchema` with `source: "agent"`.
2. Register it in the resolution path in `src/orchestrator.ts` (`resolveProvider`) — either add a name-based branch alongside the existing `"copilot"` check, or pass it through the `providers: Record<string, Provider>` map that `runScribeReview`/`runCli`/`runAction` accept (this is how tests inject fakes today).
3. Point `.scribe.yml`'s `provider` key (or the `provider` action input / `--provider` flag) at the new provider's name.

There is no dynamic/plugin loading — a new provider is a code change and a registration in `resolveProvider`, not a config-only addition.

## Security and threat model

Full detail lives in [`docs/security.md`](docs/security.md). Highlights: repository content is explicitly framed as untrusted data in the provider prompt; the Copilot CLI subprocess is invoked with no `--allow-all`/`--yolo`/`--allow-tool` grants; the action performs no repository writes (read-only `git show`/`git diff` only); paths are containment-checked against `repoRoot` before any read; files that look like secrets by filename are always excluded from context; and report text is HTML-escaped into `<code>` blocks before being posted, to neutralize anything an LLM might echo back from attacker-influenced content.

## Permissions

The action itself needs:

- `contents: read` — to check out the repo and run `git diff`/`git show` (the CLI needs equivalent local git access).
- `pull-requests: write` — for the `github-token` input (Octokit) to read/create/update the sticky PR comment. Without it, comments are skipped in favor of the job summary (see below).

The live demo workflow also grants `copilot-requests: write`, since the Copilot CLI subprocess authenticates its own model requests using the job's `GITHUB_TOKEN` environment variable — a separate concern from the action's own `github-token` input, which is used only for the Octokit PR-comment list/create/update calls. The job summary needs no token at all: it's written through `@actions/core`'s `summary` object straight to the runner's `GITHUB_STEP_SUMMARY` file.

## Fork comment fallback

`upsertPullRequestComment` (`src/github.ts`) catches `403`/`404` responses from the comment API (the typical result of a fork PR's restricted default token) and returns `{ mode: "summary-only", warning }` instead of throwing. The Action logs that warning via `core.warning` and still succeeds — a denied comment never fails the run, and the job summary still carries the full report when `report.summary` is enabled.

## Context and cost behavior, and limits

- Context is assembled **per primary document** (`collectBoundedContexts` in `src/core/context.ts`), each with its own `maxFiles`/`maxBytes` budget — budgets are not shared or capped globally across primary documents, so a PR touching many Markdown files multiplies total prompt size.
- Within a primary document's budget, candidates are added in a fixed priority order: `primary-head`/`primary-base` first, then other changed Markdown, then other changed non-Markdown files, then Markdown linked from the primary document, then the nearest `README.md`/`index.md` walking up parent directories. Once a candidate would exceed `maxFiles` the loop stops; a candidate that would exceed `maxBytes` is skipped but the loop continues (smaller later candidates can still fit).
- The Copilot CLI provider is invoked **once per run** (plus at most one retry on a contract-invalid response) — cost does not scale per changed file, only prompt size does.
- The deterministic broken-link check always runs over primary documents' head content, even if context assembly dropped that document from the LLM-facing context for budget reasons.

## Known limitations

- Only one real provider exists (Copilot CLI); it requires the `copilot` binary to be pre-installed and authenticated in the job — the action does not install or authenticate it.
- Deterministic checks cover local relative link existence only; there's no anchor validation, no external URL checks, and no check across renamed/moved link targets beyond what git rename detection already resolves.
- `checkLocalLinks` reads a primary document's own content from the git object at `headRef` (via `git show`), but validates that a link's *target* exists with `existsSync` against the real working tree on disk — not another `git show` at `headRef`. This assumes the checked-out working tree matches `headRef`, which holds for the Action's typical `actions/checkout` of the PR head, but is not guaranteed for the CLI when `--head` names a ref that isn't currently checked out; in that case link-existence results reflect whatever happens to be on disk, not the actual tree at `headRef`.
- Provider technical failures (e.g. Copilot CLI unreachable) fail the whole run via `core.setFailed`, even though findings themselves are advisory — an infrastructure problem with the provider is not distinguished from a code bug in the run today.
- The sticky comment is matched by an HTML comment marker (`<!-- goodwallet-scribe-agent -->`); if that comment is deleted or edited to remove the marker, the next run creates a new comment instead of finding it.
- Secret exclusion from context is filename-based, not content-based (see [`docs/security.md`](docs/security.md)).
- The CLI requires explicit `--base`/`--head`; only the Action infers them automatically, and only from a `pull_request` event payload.

## Not implemented: confidence-based blocking

`Finding.confidence` and `Finding.severity` are recorded and rendered, but nothing in this codebase reads them to decide pass/fail. There is no threshold, no "fail on error-severity finding," and no plan for one implemented here — this document explicitly does not promise it as a roadmap item, only notes that it does not exist today. Any future gating behavior would be a deliberate, separate change to the advisory semantics described above.

## Development, test, and build commands

```bash
npm ci             # install exact dependency versions
npm run lint        # eslint . (flat config, typescript-eslint strictTypeChecked)
npm run typecheck   # tsc --noEmit
npm run test        # vitest run src
npm run test:watch  # vitest src (watch mode)
npm run check       # lint + typecheck + test, in that order
npm run build       # scripts/build.mjs: clean dist/, tsc -p tsconfig.build.json, ncc-bundle the action, chmod the CLI
npm run bundle      # ncc build src/action/index.ts -o dist/action (bundling step only)
```

`dist/` is committed (it is not in `.gitignore`) because the Action runs the built `dist/action/index.js` directly and the CLI ships as `dist/cli.js` — CI (`.github/workflows/ci.yml`) rebuilds and runs `git diff --exit-code -- dist` to catch a stale, uncommitted build.
