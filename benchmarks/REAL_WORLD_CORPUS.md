# P12 — Real-world repository benchmark corpus

Status: **seven pinned real-world repositories have successful scanner-only intake artifacts; per-report coverage/diagnostic audit, repository-specific task approval, live planning benchmarks, and independent human adjudication remain pending**.

This registry is the intake list for P12. It is separate from the ten synthetic starter scenarios. A repository is not considered benchmarked merely because its README was inspected or its URL was collected.

## Selection method

The initial pool is drawn from projects represented in the Senior SWE-Bench source-repository sample, which spans libraries, developer tools, services, and full applications. Candidate README files were independently fetched from GitHub to confirm each project's stated purpose and broad technology context.

Selection goals:
- Cover more than one language and repository shape.
- Include applications, frameworks/libraries, developer tools, and services.
- Include both modular and multi-component codebases.
- Prefer repositories with clear documentation and public source.
- Avoid selecting only tiny tutorial projects or only very large monorepos.
- Distinguish a candidate, a scanned repository, and a completed benchmark case.

## Candidate corpus

| ID | Repository | Project type | Primary context from project README | Why it is useful |
|---|---|---|---|---|
| RW-GO-01 | https://github.com/go-gitea/gitea | Full application | Go; self-hosted Git service covering repositories, code review, issues, wiki, packages, and CI/CD | Large cohesive application with several related product areas |
| RW-TS-02 | https://github.com/better-auth/better-auth | Framework/library | TypeScript; authentication and authorization framework with plugin ecosystem | Tests planning around security-sensitive cross-cutting concerns and extensibility |
| RW-RS-03 | https://github.com/vercel/turborepo | Developer tool / monorepo | Rust and TypeScript ecosystem; build system for coding agents | Tests workspace and package-boundary understanding |
| RW-EX-04 | https://github.com/plausible/analytics | Full application / service | Elixir; privacy-focused web analytics with hosted and self-hosted editions | Tests data flow, privacy constraints, and service/application boundaries |
| RW-PY-05 | https://github.com/paperless-ngx/paperless-ngx | Full application | Document management and searchable archive | Tests document lifecycle, background processing, and integration planning |
| RW-TS-06 | https://github.com/immich-app/immich | Full application / multi-component | Self-hosted photo and video management | Tests a substantial application with multiple components and operational concerns |
| RW-PY-07 | https://github.com/PrefectHQ/prefect | Framework / service platform | Python; workflow authoring and deployment platform | Tests orchestration concepts, APIs, and framework architecture without adding execution to OIOL |

PostHog was reviewed as a stretch target because its repository is substantially larger than the initial balanced set and GitHub currently reports its license as `NOASSERTION`; verify licensing before any source excerpt is sent to a model provider: https://github.com/PostHog/posthog.

## Intake status

| Repository | README fetched | Pinned CI checkout | Scanner run | Planning task authored | Benchmark run |
|---|---:|---:|---:|---:|---:|
| go-gitea/gitea | Yes | Yes | Expanded scan complete (truncated) | Draft JSON (pending human approval) | Pending |
| better-auth/better-auth | Yes | Yes | Expanded scan complete (truncated) | Drafts (evidence-reviewed; pending JSON promotion) | Pending |
| vercel/turborepo | Yes | Yes | Report generated; audit pending | Not drafted | Pending |
| plausible/analytics | Yes | Yes | Report generated; audit pending | Not drafted | Pending |
| paperless-ngx/paperless-ngx | Yes | Yes | Expanded scan complete (truncated) | Drafts (evidence-reviewed; pending JSON promotion) | Pending |
| immich-app/immich | Yes | Yes | Expanded scan complete (truncated) | Drafts (evidence-reviewed; pending JSON promotion) | Pending |
| PrefectHQ/prefect | Yes | Yes | Expanded scan complete (truncated) | Drafts (evidence-reviewed; pending JSON promotion) | Pending |
| PostHog/posthog (stretch) | Yes | Pending | Pending | Pending | Pending |


## GitHub metadata snapshot (2026-11-08)

The following values were retrieved from GitHub repository metadata on 2026-11-08. License identifiers are GitHub's SPDX metadata and should be checked against the repository's license files and any applicable third-party notices before redistribution. Repository size is GitHub's reported size in KiB, not source LOC, a scanner file count, or a reliable estimate of a shallow checkout size.

| Repository | Default branch | License (SPDX) | GitHub size (KiB) | Public | Archived |
|---|---|---|---:|---:|---:|
| go-gitea/gitea | main | MIT | 371202 | Yes | No |
| better-auth/better-auth | main | MIT | 170753 | Yes | No |
| vercel/turborepo | main | MIT | 849433 | Yes | No |
| plausible/analytics | master | AGPL-3.0 | 715873 | Yes | No |
| paperless-ngx/paperless-ngx | dev | GPL-3.0 | 234146 | Yes | No |
| immich-app/immich | main | AGPL-3.0 | 323636 | Yes | No |
| PrefectHQ/prefect | main | Apache-2.0 | 253254 | Yes | No |
| PostHog/posthog (stretch) | master | NOASSERTION (Other) | 9056955 | Yes | No |

The initial balanced checkout subset should prioritize better-auth, paperless-ngx, Prefect, Gitea, and Immich, subject to a successful shallow checkout and scanner feasibility check. Turborepo and Plausible remain candidates but have larger reported repository sizes. PostHog remains a stretch target due to its much larger reported size and unresolved GitHub license metadata.

A local checkout attempt from the current work environment failed three times because the environment could not resolve github.com. This is an environment/network limitation, not evidence that the public repositories are unavailable. GitHub Actions provided a working networked checkout path. The original five-repository intake and the expanded seven-repository scanner-only workflow have completed; the newest two reports still require coverage and diagnostics review. No live model benchmark is claimed.

## Observed remote default-branch tips

GitHub's commits API returned the following default-branch tip SHAs on 2026-11-08. These are **remote observations only**: they have not been checked out or scanned locally. Pin the exact same SHA after a successful clone, and record the actual checkout result before scoring.

| Repository | Branch | Observed remote tip SHA |
|---|---|---|
| go-gitea/gitea | main | `edebfaa12516a140d7ee3fcbaf25a6a1cc2cdb76` |
| better-auth/better-auth | main | `de6ef28b86c002c3a3683861d803daf482ec603f` |
| vercel/turborepo | main | `17691acd9bc80171e5ef4b3532ff0748ba231813` |
| plausible/analytics | master | `31fc1910fe9be0362b27dacbd2886f16442da20f` |
| paperless-ngx/paperless-ngx | dev | `32bc5522e914f1e5f3a36eb60de6988611ca310f` |
| immich-app/immich | main | `87ef895041e160aef4f61f2d7af1ad3f8e38827d` |
| PrefectHQ/prefect | main | `b0479c0c26045b06321191bbad0cdfbb334d7380` |

Do not treat these observations as a substitute for local checkout verification. A branch can move after the observation, and the scanner report must show the commit actually present in the checkout.

## Manifest-level technology verification

Root manifest/configuration files were also fetched from GitHub. These are direct file-level checks, not full repository scans:

| Repository | File checked | Verified signal | Manifest blob SHA |
|---|---|---|---|
| go-gitea/gitea | go.mod | Go module; module path gitea.dev | 1d7f26bdb1a69e96a267958bace6f478904e0a46 |
| better-auth/better-auth | package.json | TypeScript/JavaScript monorepo indicators; pnpm and Turborepo scripts | fb556e54e566eeeb6bf5111bb28315152aa46b65 |
| vercel/turborepo | package.json | Rust workspace build via Cargo plus Node tooling; pnpm | 32b95afc4dc745ccca3530ccf2392c0ec509d6b2 |
| plausible/analytics | mix.exs | Elixir Mix application; Plausible project module | e839f4403108ce68f7bd39bff54b9b931f49a96f |
| paperless-ngx/paperless-ngx | pyproject.toml | Python project; Django and Celery dependencies | 5eb0f59ed2c7f0b2d36d76d3446a16b10b639961 |
| immich-app/immich | package.json | pnpm-managed monorepo | b8755b803e41448cdd117bc890624cf3ad498b70 |
| PrefectHQ/prefect | pyproject.toml | Python package; Apache-2.0 license declaration; workflow orchestration description | 76525cc05f89a7e9f687aebffe39207041ac207d |

Blob SHAs identify the fetched manifest contents, not the repository commit SHA. Exact repository commit SHAs still must be captured from pinned checkouts before any scored run.

## First-pass real-repository scanner results

The first external scanner-only intake workflow completed successfully for all five prioritized repositories. The run used pinned commits and the existing OIOL scanner; no repository scripts, tests, builds, or model-provider calls were executed.

Workflow: [P12 first-pass scanner intake](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42459270734). The five reports were uploaded as per-repository workflow artifacts.

| Repository | Included files | Source files discovered | AST analyzed | Tests discovered | Unsupported languages | Syntax-error files | Truncated |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gitea | 250 | 210 | 95 | 58 | 0 | 0 | Yes |
| Better Auth | 250 | 133 | 88 | 27 | 0 | 4 | Yes |
| Paperless-ngx | 250 | 155 | 90 | 7 | 1 | 0 | Yes |
| Immich | 250 | 192 | 95 | 79 | 3 | 1 | Yes |
| Prefect | 250 | 128 | 76 | 0 | 0 | 0 | Yes |

All five first-pass scans reached the original 250-file limit. The discovered file counts are lower bounds; these results must not be treated as complete repository understanding. The initial profile also limited primary source selection to 100 files, which explains why the AST-analyzed counts are below the discovered source counts. Prefect's zero discovered tests is a coverage warning, not evidence that the repository has no tests.

The first-pass reports did not record parser failures. Better Auth and Immich did report Tree-sitter syntax-error files requiring review. Paperless-ngx and Immich reported source files in languages without a bundled grammar; the scanner surfaced these as unsupported rather than silently claiming AST coverage.

### Final expanded scanner profile

The scanner now supports a separate bounded profile for external repositories:

- Maximum discovered files: 5,000.
- Maximum primary source files: 500, plus up to 25 test files and 25 configuration files.
- Maximum bytes per file: 32 KiB.
- Maximum model context: 150,000 characters.
- Maximum directory depth: 16.
- Evidence selection interleaves manifests, implementation source, tests, and configuration rather than filling the context with source files first.
- Scanner version and exact scan limits are included in the report and benchmark configuration fingerprint.

The five repositories have been rescanned with this wider profile. The results below are the current evidence baseline; they remain bounded scans, not exhaustive source-code understanding.

## Expanded pinned scanner results

The final expanded scan completed successfully for all five pinned repositories in [P12 scanner run](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42459958922). All checkouts were clean and the report commit SHAs match the observed remote tips recorded above.

| Repository | Included files | Source files in scan | AST analyzed | Tests discovered | Unsupported source files | Syntax-error files | File-limit reached |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gitea | 5,000 | 3,357 | 505 | 1,412 | 35 | 2 | Yes |
| Better Auth | 2,419 | 1,748 | 450 | 596 | 4 | 15 | No |
| Paperless-ngx | 1,565 | 866 | 463 | 466 | 7 | 1 | No |
| Immich | 3,626 | 2,605 | 483 | 542 | 1,353 | 6 | No |
| Prefect | 5,000 | 3,715 | 474 | 1,236 | 68 | 0 | Yes |

Interpretation and limitations:

- Paperless-ngx, Better Auth, and Immich completed within the 5,000-file bound. Gitea and Prefect remain truncated at 5,000 discovered files; their file counts are lower bounds.
- AST analysis is bounded to the selected source/test/config files and files under the 32 KiB per-file limit. It is not a full type-check or semantic analysis.
- Immich has a substantial unsupported-language gap, including mobile/native source files outside the bundled Tree-sitter grammar set. The plan must not treat those components as understood.
- Better Auth, Immich, Paperless-ngx, and Gitea report syntax-error nodes from Tree-sitter recovery. These are diagnostics, not necessarily build failures; human review is required.
- The Go dependency graph is under-resolved because module-path imports are not currently mapped to local package nodes. Workspace aliases and package-manager resolution also remain incomplete for several repositories.
- The scanner reports ignored, sensitive, symbolic-link, depth-limit, and file-limit exclusions separately. No excluded file contents are included in benchmark evidence.
- A completed scan is not a completed planning benchmark. No live model runs or human scores have been claimed.

The expanded reports are scanner-only artifacts. They do not contain raw source excerpts; they retain bounded paths, hashes, manifest metadata, AST/lexical coverage, diagnostics, and scan limits.

### Scanner follow-up after language coverage improvements (scanner 1.5.0)

A subsequent scanner intake completed successfully for all five pinned repositories in [P12 scanner follow-up](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42461297388). This run included the Dart/Swift selection changes: Swift files are parsed with the bundled Tree-sitter grammar; Dart files are read and analyzed through bounded lexical fallback because the pinned WASM grammar pack does not expose a Dart parser. These are different evidence levels and must remain distinguishable in any plan or review.

The follow-up run's per-repository artifacts are the authoritative reports for the updated scanner behavior. The quantitative table above describes the earlier expanded profile run and must not be reused as if it were the new run's coverage numbers. Refresh the table only after inspecting and comparing all five follow-up artifacts.


## Seven-repository scanner intake — 2026-11-08

The expanded scanner workflow completed successfully for all seven pinned checkouts in [P12 run 39](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42503950232). GitHub Actions reports seven successful jobs and seven uploaded artifacts. The two added candidates are Turborepo (Rust/TypeScript developer tooling) and Plausible (Elixir analytics application). This establishes checkout and scanner-run feasibility only; it does not establish adequate evidence coverage.

Before either new repository is used in a scored planning run, inspect its artifact for file-count bounds, truncation, AST-versus-lexical coverage, unsupported languages, parse/syntax diagnostics, discovered tests/configuration, and evidence fingerprints. Do not author or promote repository-specific tasks until their paths and claims are checked against the pinned scan evidence. The existing five repositories' prior quantitative table remains tied to the earlier five-repository follow-up run and must not be extrapolated to this seven-repository run.

## Required intake record before a repository can enter a scored run

For every selected repository, record:
1. Canonical repository URL and exact checked-out commit SHA.
2. Retrieval date, default branch, license identifier, and repository size indicators.
3. Scanner configuration and limits, including files discovered/read, AST coverage, lexical fallback, skipped paths, and diagnostics.
4. Whether the scan completed, was truncated, or failed. A bounded scan must never be described as complete repository understanding.
5. One or more planning tasks grounded in inspectable repository evidence. Each task must state the request, constraints, expected unknowns, and evidence-backed evaluation rubric.
6. The exact repository commit and task version used for every model run.

Do not copy private code, secrets, personal data, or proprietary issue content into benchmark artifacts. Prefer public documentation and sanitized, reproducible task descriptions. Keep repository-derived text untrusted.

## Repository-specific task drafting

Ten product-level task blueprints and ten schema-valid draft JSON task definitions have been created for the five prioritized repositories (two per repository: one specified change and one deliberately underspecified request). They are documented in [PROPOSED_TASKS.md](external-tasks/PROPOSED_TASKS.md) and stored under [external-tasks/drafts/](external-tasks/drafts/).

These are explicitly **drafts, not approved or scored tasks**. They have been reconciled with the pinned scanner output and targeted code-file inspection, and the test suite validates their JSON contract. They still require independent human approval and promotion to version 1.0.0 before any model evaluation. This avoids inventing internal architecture from product descriptions.

## External input capability status

The earlier fixture-only input gap has been addressed in the benchmark harness:

- Both OIOL and OpenCode benchmark runners accept `--repo` for an operator-supplied local Git checkout.
- External mode is limited to Existing Project scenarios and requires a repository-specific `--task-file`; one scenario/task definition is selected per run.
- The OIOL runner calls the existing `analyzeProject` and bounded read-only `scanRepository` path. It does not clone, install, build, test, execute project scripts, or modify the target checkout.
- External checkouts must have a clean working tree and a resolvable 40-character Git commit SHA. The commit and task-file SHA-256 are recorded and included in the run configuration fingerprint.
- The OpenCode baseline receives a disposable workspace containing only bounded, redacted scanner excerpts; it does not copy the raw external checkout.
- Paired comparisons reject different repository commit sets, task-definition hashes, or source modes. Repeated paired aggregation also rejects drift in repository commit sets, task hashes, or either runner's configuration fingerprint.
- External live runs require the separate `OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE=1` consent flag because bounded source excerpts are sent to the configured model provider. Scanner redaction and sensitive-file exclusion are best-effort safeguards, not a guarantee that every secret is detected.

The local environment used for this development could not clone GitHub after three attempts because DNS resolution failed. GitHub Actions was used instead to check out five public repositories at pinned commits and run OIOL's scanner. The first pass completed but hit the 250-file bound on all five; the expanded second pass is being prepared. No live model benchmark is claimed yet.

**Current P12 state (2026-11-08):** external-repository input plumbing is implemented and committed. Seven pinned scanner-only jobs completed successfully in [P12 seven-repository intake run](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42503950232), producing seven per-repository artifacts. The two newly added repositories (Turborepo and Plausible) have not yet had their report coverage/diagnostics audited and have no repository-specific task drafts. Five repositories have two task drafts each; all ten remain drafts pending independent human approval and promotion. No live model benchmark or blinded human score is claimed. The candidate corpus is not a completed benchmark.

## Harness validation snapshot (2026-11-08)

The benchmark and scanner harness passed the repository CI matrix at commit `69d8cc7124d1c506ca9922db08692502aae48bd3`:

- Linux and Windows.
- Node.js 22 and 24.
- Static syntax check: 32 JavaScript modules passed.
- Unit/regression suite: 163 tests passed, 0 failed.
- Coverage includes external-input validation against the checked-in scanner fixture, path redaction, sensitive-file exclusion, external-source consent, paired commit/task matching, and repeated-run configuration identity.

This validates the harness implementation. It does **not** mean any of the seven external candidate repositories has been cloned, scanned, or benchmarked.

## P12 execution protocol

1. Select an initial balanced subset of at least five candidates after confirming clone/checkout feasibility and license metadata.
2. Pin each repository to an immutable commit SHA; do not benchmark against moving default branches.
3. Run OIOL's existing read-only scanner against each pinned checkout and preserve the actual evidence IDs/fingerprints in the run record.
4. Author at least two independent planning tasks per repository: one repository-understanding/change-impact task and one multi-component or constraint-heavy task where applicable.
5. Include at least one deliberately underspecified request per applicable repository. Score whether OIOL identifies blocking unknowns instead of inventing project facts.
6. Run each task at least three times per model/configuration. Record failures, latency, provider usage when exposed, and all scanner limitations.
7. Compare with a read-only OpenCode planning baseline only when model, repository snapshot, task, reviewer setup, and resource budget are genuinely matched.
8. Have two reviewers independently assess anonymized plans using the human-review protocol in benchmarks/README.md; adjudicate material disagreements.
9. Publish per-repository and per-task results, including failures and low scores. Do not collapse scanner coverage, planning quality, and baseline comparison into one opaque score.

## Important boundary

This is an evaluation corpus for OIOL's planning and analysis output only. OIOL must not modify candidate repositories, run their scripts/tests/builds, apply changes, or manage implementation. Any optional baseline tooling must be configured read-only and is not an OIOL execution capability.

## Source notes

- Senior SWE-Bench describes a curated sample of twelve open-source repositories across libraries, tools, services, and applications, and lists Gitea, PostHog, Prefect, Better Auth, Turborepo, Plausible, Paperless-ngx, and Immich among its sources: https://snorkel.ai/leaderboard/senior-swe-bench/
- Candidate project descriptions were checked against each repository's public README on GitHub on 2026-11-08.
- This file records candidate selection only. It does not claim that the repositories have been cloned, scanned, or benchmarked.
