# Real-world repository benchmark (P12)

## Status

This is the protocol and corpus intake layer. The corpus is intentionally empty until real snapshots and independently adjudicated annotations are supplied. An empty corpus is **not** a benchmark result and must never be reported as a pass.

## Evaluation unit

One case represents a real, historically observed change in a pinned repository snapshot:

- upstream repository URL and exact license;
- immutable base commit and change commit / merged pull request;
- a bounded, locally available snapshot of the base commit;
- a natural-language change request written without consulting OIOL output;
- an independently annotated expected impact set;
- two independent reviewers and an adjudication record where required.

The change commit / pull request is provenance for the historical change. It is not itself sufficient ground truth: reviewers must inspect the base snapshot and the change evidence, then annotate the expected impact set. Do not derive goldens from OIOL predictions.

## Independence and blinding

1. Corpus curators select changes before running the candidate OIOL version.
2. Annotators do not see OIOL output, scores, confidence, or diagnostics.
3. Two reviewers independently annotate each case. Use stable, non-identifying reviewer IDs.
4. Reviewers cite paths, symbols, contract/schema evidence, and the historical change evidence.
5. Disagreements are preserved; an adjudicator records the final set and rationale. Never silently average incompatible file sets.
6. Benchmark implementers receive only the adjudicated corpus after annotations are frozen.

A reviewer must not annotate a case they authored or implemented. Record conflicts of interest.

## Repository sampling

Target at least 12 repositories for the first external-validity tranche:

- 4 small (up to 2,000 tracked files);
- 4 medium (2,001–20,000 tracked files);
- 4 large (more than 20,000 tracked files).

Across the corpus, include at least 4 language families and a mix of monoliths, libraries, services, and multi-package workspaces. Include API, database, migration, and test-impact changes where repository evidence supports them. Record size and language distribution from the pinned snapshot, not from current upstream HEAD.

Select changes with traceable merged commits / pull requests and enough evidence to establish impact. Include negative and ambiguous requests only when reviewers can justify the expected empty/uncertain result. Avoid cherry-picking only easy changes.

## Snapshot and licensing rules

- Pin full 40-character base and change commit hashes.
- Record the repository license identifier and license file URL at the pinned revision.
- Keep snapshots outside the OIOL repository by default. Do not commit full third-party repositories.
- Corpus operators place snapshots under a separate corpus root and reference them using relative paths in case files.
- Include only the minimal files needed for reproducibility if redistribution is permitted; preserve copyright and license notices.
- Do not include secrets, personal data, private code, or proprietary customer data.
- If redistribution is not permitted, retain an external snapshot reference and run locally under the applicable license; do not publish source files or derived excerpts.
- The snapshot fingerprint is computed from sorted relative file paths and raw file bytes. It detects drift; it does not establish provenance by itself.

## Safe evaluation boundary

OIOL's scanner reads files and performs bounded static analysis only. The benchmark must not run commands, scripts, builds, tests, migrations, package managers, or application code from a target repository. It must not write to target snapshots.

The scanner currently probes Git metadata by invoking Git read-only commands. P12 must disable that probe in the benchmark path; repository identity and commit provenance come from the pinned corpus manifest. CI may run OIOL's own tests and benchmark harness, but never target-project commands. This boundary is a required P12 implementation item, not an optional convention.

## Metrics

Report each case and macro/micro aggregates separately:

- scanner declarations / symbols: precision, recall, F1;
- local import and dependency edges: precision, recall, F1;
- workspace package inventory and dependency edges;
- direct files and transitive affected files;
- API consumers, database objects/consumers, migration files/order findings;
- linked test files and recommended verification levels;
- unknowns and risk findings (reviewer-rated completeness and unsupported assertions);
- confidence calibration: Brier score / reliability buckets when enough cases exist, plus overconfidence rate on incomplete scans;
- scan coverage: file/depth/source caps, parser coverage, unresolved imports, read failures, unsupported languages.

Do not collapse all dimensions into one score. Publish per-repository, per-size, per-language, and per-change-category results. Report unsupported dimensions as unavailable, not zero.

For set-valued dimensions, count TP/FP/FN and calculate precision/recall/F1. For risk and unknown quality, use the blinded human rubric in addition to deterministic checks. Confidence is evaluated against adjudicated correctness and coverage, not against the model's self-reported label alone.

## Acceptance gates for a first report

A report may be called a real-world benchmark only when:

- at least 12 repositories and 30 independently annotated change cases are present;
- each case has two independent reviews and required adjudication;
- all snapshots are pinned and fingerprint-verified;
- every case is run against the same OIOL commit and scan limits;
- failures, unsupported languages, truncation, and missing evidence remain visible;
- results are broken down by repository size and language;
- no target-project command was run and no target snapshot was modified.

Until these gates are met, publish only an intake/protocol status report. Do not make a production-accuracy or superiority claim.

## Corpus layout

    <corpus-root>/
      snapshots/<repository-id>/<base-commit>/
      cases/<case-id>.json
      manifest.json

Validate intake metadata with:

    npm run benchmark:real-world:validate -- --corpus-root /absolute/path/to/corpus

Use --allow-empty only for CI protocol tests. It returns a not-ready status and never marks the corpus as complete.


## Initial repository intake — batch 1

The first candidate batch contains 12 repositories and 36 historical merged pull-request candidates (three changes per repository). Each pull request's merged state, base SHA, merge commit SHA, merged timestamp, and changed-file count were checked against the GitHub Pull Requests API. Each referenced license file was retrieved at the exact base commit. The recursive Git tree counts are recorded in the machine-readable inventory; the 12 selected tree responses were complete.

| Size class | Repository | Tracked files at base | Main language(s) | Historical change |
|---|---|---:|---|---|
| Small | [sindresorhus/ky](https://github.com/sindresorhus/ky) | 56 | TypeScript / JavaScript | [PR 757](https://github.com/sindresorhus/ky/pull/757) |
| Small | [pallets/itsdangerous](https://github.com/pallets/itsdangerous) | 49 | Python | [PR 405](https://github.com/pallets/itsdangerous/pull/405) |
| Small | [go-chi/chi](https://github.com/go-chi/chi) | 108 | Go | [PR 1220](https://github.com/go-chi/chi/pull/1220) |
| Small | [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | 226 | Rust | [PR 3561](https://github.com/BurntSushi/ripgrep/pull/3561) |
| Medium | [pydantic/pydantic](https://github.com/pydantic/pydantic) | 3,579 | Python | [PR 14244](https://github.com/pydantic/pydantic/pull/14244) |
| Medium | [nestjs/nest](https://github.com/nestjs/nest) | 2,748 | TypeScript | [PR 18439](https://github.com/nestjs/nest/pull/18439) |
| Medium | [laravel/framework](https://github.com/laravel/framework) | 3,502 | PHP | [PR 62342](https://github.com/laravel/framework/pull/62342) |
| Medium | [spring-projects/spring-boot](https://github.com/spring-projects/spring-boot) | 11,383 | Java | [PR 52557](https://github.com/spring-projects/spring-boot/pull/52557) |
| Large | [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | 31,452 | Go | [PR 143073](https://github.com/kubernetes/kubernetes/pull/143073) |
| Large | [tensorflow/tensorflow](https://github.com/tensorflow/tensorflow) | 37,712 | C++ / Python | [PR 129352](https://github.com/tensorflow/tensorflow/pull/129352) |
| Large | [grafana/grafana](https://github.com/grafana/grafana) | 24,718 | Go / TypeScript | [PR 137251](https://github.com/grafana/grafana/pull/137251) |
| Large | [home-assistant/core](https://github.com/home-assistant/core) | 30,403 | Python | [PR 190773](https://github.com/home-assistant/core/pull/190773) |

The full machine-readable intake record, including exact 40-character base and merged-change commit IDs, license identifiers and file URLs, PR metadata, candidate change requests, and historical changed paths, is [intake-candidates.json](./intake-candidates.json). VS Code is retained as a medium-size reserve candidate (19,119 tracked files), not part of this balanced first batch.

The 24 additional historical changes are distributed evenly across the same 12 repositories:

| Repository | Additional merged PR candidates |
|---|---|
| sindresorhus/ky | [#883](https://github.com/sindresorhus/ky/pull/883), [#881](https://github.com/sindresorhus/ky/pull/881) |
| pallets/itsdangerous | [#404](https://github.com/pallets/itsdangerous/pull/404), [#406](https://github.com/pallets/itsdangerous/pull/406) |
| go-chi/chi | [#1213](https://github.com/go-chi/chi/pull/1213), [#1218](https://github.com/go-chi/chi/pull/1218) |
| BurntSushi/ripgrep | [#3578](https://github.com/BurntSushi/ripgrep/pull/3578), [#3560](https://github.com/BurntSushi/ripgrep/pull/3560) |
| pydantic/pydantic | [#14249](https://github.com/pydantic/pydantic/pull/14249), [#14246](https://github.com/pydantic/pydantic/pull/14246) |
| nestjs/nest | [#18385](https://github.com/nestjs/nest/pull/18385), [#18419](https://github.com/nestjs/nest/pull/18419) |
| laravel/framework | [#62326](https://github.com/laravel/framework/pull/62326), [#62360](https://github.com/laravel/framework/pull/62360) |
| spring-projects/spring-boot | [#52619](https://github.com/spring-projects/spring-boot/pull/52619), [#52585](https://github.com/spring-projects/spring-boot/pull/52585) |
| kubernetes/kubernetes | [#143816](https://github.com/kubernetes/kubernetes/pull/143816), [#143291](https://github.com/kubernetes/kubernetes/pull/143291) |
| tensorflow/tensorflow | [#129795](https://github.com/tensorflow/tensorflow/pull/129795), [#129473](https://github.com/tensorflow/tensorflow/pull/129473) |
| grafana/grafana | [#136907](https://github.com/grafana/grafana/pull/136907), [#137046](https://github.com/grafana/grafana/pull/137046) |
| home-assistant/core | [#189946](https://github.com/home-assistant/core/pull/189946), [#189189](https://github.com/home-assistant/core/pull/189189) |

### Intake status

- 12/12 repositories selected and pinned to immutable base commits.
- 4 small, 4 medium, and 4 large repositories.
- 36/36 historical PRs confirmed merged; base and merge commit IDs independently checked.
- 36/36 license files retrieved at each exact pinned base revision.
- Three candidate changes per repository are identified; the 30-case numerical threshold is met at the candidate-intake stage.
- Historical changed paths are provenance evidence only, **not** accepted as complete impact ground truth.
- Snapshot archives and SHA-256 content fingerprints: pending.
- Two independent blinded annotations per case: pending.
- Cases may be excluded during independent review; collect a reserve set before freezing the final 30+ adjudicated cases.

The corpus manifest remains empty until snapshots and independent annotations are complete. These entries are an intake shortlist, not completed benchmark cases.
