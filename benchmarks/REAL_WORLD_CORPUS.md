# P12 — Real-world repository benchmark corpus

Status: **candidate corpus assembled; repository scans and benchmark runs not yet completed**.

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

PostHog was reviewed as a stretch target because its repository is substantially larger than the initial balanced set: https://github.com/PostHog/posthog.

## Intake status

| Repository | README fetched | Local checkout | Scanner run | Planning task authored | Benchmark run |
|---|---:|---:|---:|---:|---:|
| go-gitea/gitea | Yes | Pending | Pending | Pending | Pending |
| better-auth/better-auth | Yes | Pending | Pending | Pending | Pending |
| vercel/turborepo | Yes | Pending | Pending | Pending | Pending |
| plausible/analytics | Yes | Pending | Pending | Pending | Pending |
| paperless-ngx/paperless-ngx | Yes | Pending | Pending | Pending | Pending |
| immich-app/immich | Yes | Pending | Pending | Pending | Pending |
| PrefectHQ/prefect | Yes | Pending | Pending | Pending | Pending |
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

The initial balanced checkout subset should prioritize better-auth, paperless-ngx, Prefect, Gitea, and Immich, subject to a successful shallow checkout and scanner feasibility check. Turborepo and Plausible remain candidates but have larger reported repository sizes. PostHog remains a stretch target due to its much larger reported size.

A local checkout attempt from the current work environment failed three times because the environment could not resolve github.com. This is an environment/network limitation, not evidence that the public repositories are unavailable. Consequently, no local scanner run or live benchmark is claimed here.

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

## Required intake record before a repository can enter a scored run

For every selected repository, record:
1. Canonical repository URL and exact checked-out commit SHA.
2. Retrieval date, default branch, license identifier, and repository size indicators.
3. Scanner configuration and limits, including files discovered/read, AST coverage, lexical fallback, skipped paths, and diagnostics.
4. Whether the scan completed, was truncated, or failed. A bounded scan must never be described as complete repository understanding.
5. One or more planning tasks grounded in inspectable repository evidence. Each task must state the request, constraints, expected unknowns, and evidence-backed evaluation rubric.
6. The exact repository commit and task version used for every model run.

Do not copy private code, secrets, personal data, or proprietary issue content into benchmark artifacts. Prefer public documentation and sanitized, reproducible task descriptions. Keep repository-derived text untrusted.

## External input capability status

The earlier fixture-only input gap has been addressed in the benchmark harness:

- Both OIOL and OpenCode benchmark runners accept `--repo` for an operator-supplied local Git checkout.
- External mode is limited to Existing Project scenarios and requires a repository-specific `--task-file`; one scenario/task definition is selected per run.
- The OIOL runner calls the existing `analyzeProject` and bounded read-only `scanRepository` path. It does not clone, install, build, test, execute project scripts, or modify the target checkout.
- External checkouts must have a clean working tree and a resolvable 40-character Git commit SHA. The commit and task-file SHA-256 are recorded and included in the run configuration fingerprint.
- The OpenCode baseline receives a disposable workspace containing only bounded, redacted scanner excerpts; it does not copy the raw external checkout.
- Paired comparisons reject different repository commit sets, task-definition hashes, or source modes. Unit tests cover input validation, path redaction, sanitized baseline materialization, and paired-snapshot matching.

The local environment used for this development could not clone GitHub after three attempts because DNS resolution failed. GitHub's connected repository API remained usable for metadata and file inspection, but no full local scanner run or live external benchmark is claimed.

**Current P12 state:** external-repository input plumbing is implemented and committed; the seven candidate repositories still need clean local checkouts, repository-specific task definitions, actual scanner runs, repeated model runs, and blinded human reviews. The candidate corpus is not a completed benchmark.

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
