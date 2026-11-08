# P12 scanner evidence audit — 2026-11-08

## Executive decision

**Scanner intake succeeded operationally; corpus is not yet ready for an unqualified planning-quality comparison.**

All seven GitHub Actions jobs completed successfully and each report identifies the exact pinned commit, scanner version 1.5.0, clean Git checkout, and bounded scan settings. However:

- All seven reports set `contextTruncated=true`.
- Three repositories hit the 5,000-file cap: Gitea, Prefect, and Turborepo.
- The AST source-analysis ratio ranges from 12.8% to 53.5%; it is not semantic understanding coverage.
- Plausible has an 81.3% unsupported-source ratio, primarily because Elixir is not parsed by the bundled grammar pack.
- The Immich and Turborepo dependency graphs are suspiciously sparse (7 and 3 edges respectively for 484 and 437 nodes).
- Most importantly, **none of the task-specific source paths cited by the existing five-repository task drafts appears in the report's selected model-context excerpts**. A path being present in `includedPaths` does not mean its contents were supplied to the planner. The current task drafts therefore must not be promoted to scored tasks until this evidence-input gap is addressed or the task is redesigned around excerpts actually supplied.

This is an evidence-selection limitation, not proof that OIOL's planner itself is incapable of producing a good plan.

## Run and provenance

- Workflow: [P12 seven-repository scanner intake](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42503950232)
- All seven matrix jobs: success.
- Artifact count: 7; all downloaded and parsed as JSON.
- Scanner and scan runner: 1.5.0.
- Protocol: 1.0.
- All reports show `isRepo=true`, `dirty=false`, and the expected pinned commit SHA.
- The checkout is detached in Actions, so `git.branch` is empty. This is not a dirty-checkout or commit-identity failure; the commit SHA is the authoritative snapshot identity.
- Scan limits: 5,000 files; 32 KiB/file; 150,000 context characters; depth 16; up to 500 primary source files, 25 test files, and 25 config files.

## Per-repository results

| Repository / ID | Files included | Source files | AST analyzed | AST/source | Unsupported source | Unsupported ratio | Syntax-error files | Context truncated | Graph nodes / edges | Unresolved local imports | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| better-auth/better-auth — RW-TS-02 | 2,419 | 1,748 | 450 | 25.7% | 4 | 0.2% | 15 | Yes | 578 / 898 | 0 | Conditional |
| paperless-ngx/paperless-ngx — RW-PY-05 | 1,565 | 866 | 463 | 53.5% | 7 | 0.8% | 1 | Yes | 522 / 847 | 0 | Best current candidate, still bounded |
| PrefectHQ/prefect — RW-PY-07 | 5,000+ | 3,715 | 474 | 12.8% | 68 | 1.8% | 0 | Yes | 601 / 1,700 | 1 | Truncated / low source coverage |
| immich-app/immich — RW-TS-06 | 3,626 | 2,605 | 483 | 18.5% | 478 | 18.3% | 6 | Yes | 484 / 7 | 3 | Conditional; graph anomaly |
| go-gitea/gitea — RW-GO-01 | 5,000+ | 3,357 | 505 | 15.0% | 35 | 1.0% | 2 | Yes | 649 / 2,029 | 7 | Truncated / low source coverage |
| vercel/turborepo — RW-RS-03 | 5,000+ | 1,739 | 437 | 25.1% | 7 | 0.4% | 5 | Yes | 437 / 3 | 0 | Truncated; graph anomaly |
| plausible/analytics — RW-EX-04 | 2,135 | 1,640 | 304 | 18.5% | 1,334 | 81.3% | 1 | Yes | 308 / 1,077 | 14 | Not suitable for Elixir-dependent scoring |

Notes:
- The AST/source ratio is `analyzedSourceFileCount / sourceFileCount`. It measures files selected for AST analysis, not correctness or semantic coverage.
- The unsupported ratio is `unsupportedLanguageFileCount / sourceFileCount`.
- Test and configuration discovery counts are inventories, not counts of test/config contents sent to the model.
- A syntax-error node is a parser diagnostic from Tree-sitter recovery, not evidence that the repository fails to compile.
- No parse-failure, node-limit, or depth-limit file was reported in these seven artifacts. That does not negate context truncation or file-cap truncation.
- Gitea, Prefect, and Turborepo report 5,001 discovered / 5,000 included and `fileCountIsLowerBound=true`.

## Critical task-evidence coverage check

The runner sends `project` to the planner and OpenCode baseline. The scanner stores every included path as path metadata, but only selected snippets contain source text. The task-specific paths below were checked against the report's `evidence[].source` entries (the actual selected excerpt inventory).

| Existing task family | Task-specific paths cited | Present in included path inventory | Present as selected excerpts |
|---|---:|---:|---:|
| Better Auth BA-01 / BA-02 | 7 | 7 | 0 |
| Paperless PN-01 / PN-02 | 10 | 10 | 0 |
| Prefect PF-01 / PF-02 | 7 | 6 | 0 |
| Gitea GT-01 / GT-02 | 5 | 4 | 0 |
| Immich IM-01 / IM-02 | 9 | 9 | 0 |

Additional checks:
- Better Auth's cited organization/multi-session files are not among the first 500 source candidates selected for AST analysis in this scan.
- Paperless' cited paths are within the first 500 source candidates, but their contents were not retained in the selected excerpt set because the 150,000-character context was exhausted.
- Prefect's task notes cite `src/prefect/server/events/worker.py`, which does not exist at the pinned commit. The actual worker is `src/prefect/events/worker.py`; it was confirmed by a pinned-commit source lookup. This path correction is required.
- Gitea's preview template exists at the pinned commit but is not in the included file inventory because the scan hit its file limit before reaching it. It was confirmed by a direct pinned-commit lookup.
- Immich's task-specific DTO/service/repository files are included as paths, but their excerpts were not selected for model context.

**Consequence:** the five task definitions are not currently evidence-complete for an end-to-end planner comparison. The fact that filenames occur in `includedPaths` or were read manually outside the scan does not mean either OIOL or OpenCode received their content. Do not score these as if the planner saw those source files.

## Repository-specific disposition

1. **Paperless-ngx:** strongest current scan coverage (53.5% AST/source), no file-count truncation, low unsupported-language ratio. Context is still truncated and task excerpts are missing. Candidate for first targeted evaluation after evidence selection is verified.
2. **Better Auth:** language support is good, but 15 syntax-error files and 25.7% AST/source. The organization/multi-session code cited by BA tasks was not AST-selected and not included in excerpts. Do not score BA tasks against the current scan projection.
3. **Prefect:** file cap reached and only 12.8% AST/source. Correct the worker path to `src/prefect/events/worker.py`. Current task-specific paths are not in selected excerpts.
4. **Gitea:** file cap reached and only 15.0% AST/source. Preview template is outside included inventory; current task-specific paths are not in selected excerpts. The cleanup execution/model files should be prioritized before any scored run.
5. **Immich:** no file-count truncation, but 18.3% unsupported-source ratio and only 18.5% AST/source. Graph edge count 7 for 484 nodes is a major anomaly to investigate before relying on change-impact claims. Current task-specific excerpts are absent.
6. **Turborepo:** file cap reached; AST/source 25.1%; graph edge count 3 for 437 nodes is a major anomaly. Do not use its graph as a reliable dependency map until independently checked.
7. **Plausible:** Elixir dominates the unsupported-source count. The current scanner projection is inadequate for a task whose correctness depends on Plausible's Elixir application layer. It may only support a tracker/frontend-scoped task if those files are explicitly evidenced.

## Task-prioritized evidence intake — scanner 1.7.0

The measured retrieval correction is now implemented and the five task-bearing repositories were rescanned using the `evidencePaths` in their task definitions. Workflow: [P12 task-specific evidence intake](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42505668870). All five scanner jobs completed successfully and uploaded artifacts.

| Repository / task family | Required paths | Found in bounded file inventory | Delivered as excerpts | Missing / unexcerpted | Task gate |
|---|---:|---:|---:|---|---|
| Better Auth BA | 7 | 7 | 6 | 1 oversized test file | Blocked |
| Paperless PN | 10 | 10 | 4 | 6 oversized implementation/test files | Blocked |
| Prefect PF | 7 | 7 | 5 | 2 oversized implementation/test files | Blocked |
| Gitea GT | 5 | 4 | 4 | 1 preview template beyond the 5,000-file cap | Blocked |
| Immich IM | 9 | 9 | 9 | None | **Evidence gate passed** |

All five task-specific reports still indicate general context truncation. That flag means lower-priority general evidence was omitted; it does not invalidate the Immich pilot because all nine explicitly required task paths were excerpted before the context filled. Conversely, the other four tasks are rejected by the benchmark runner because at least one required path was not delivered.

The failures have concrete causes:
- **Better Auth:** `packages/better-auth/src/plugins/organization/organization.test.ts` exceeds the 32 KiB per-file cap.
- **Paperless:** `models.py`, `tasks.py`, `views.py`, `serialisers.py`, `signals/handlers.py`, and `test_api_documents.py` exceed the per-file cap.
- **Prefect:** `src/prefect/server/events/actions.py` and `tests/events/server/test_automations_api.py` exceed the per-file cap.
- **Gitea:** `templates/package/shared/cleanup_rules/preview.tmpl` is outside the 5,000-file inventory bound.
- **Immich:** all nine paths are present as bounded, redacted excerpts with source/excerpt fingerprints.

### Pilot selection

Select **Immich IM-01 — separate per-user external-library usage reporting** as the first real planning-quality pilot. Its nine required source/documentation paths were all delivered at pinned commit `87ef895041e160aef4f61f2d7af1ad3f8e38827d`. The task is scoped to the server DTO/service/repository and administrator UI paths; the scanner's wider unsupported-language ratio and sparse import graph remain explicit limitations and must not be used to claim whole-repository understanding.

The runner now rejects a task before provider calls if any required path is absent or has no excerpt. This prevents a score from being reported for a plan generated without the task's declared evidence.

## Planning-quality execution status

The Immich IM-01 task is evidence-ready, but **no live OIOL or OpenCode plan has yet been generated**. The benchmark runner requires a configured OIOL provider endpoint/model and an OpenCode server endpoint/model. No provider credentials or reachable OpenCode server configuration are available to this connected execution context. Dry-run and CI success are not planning-quality results.

The next live pilot must:
1. Use the exact Immich commit and the same task JSON bytes for both systems.
2. Record the task SHA-256, scanner version/configuration, excerpt source/excerpt hashes, model IDs, reviewer IDs, timeouts, retry counts, and token usage.
3. Use identical planning model and reviewer configuration where possible; if not, label the comparison non-equivalent.
4. Run one paired pilot first; inspect both complete plans and the evidence citations before authorizing repeated runs.
5. Score technical correctness, requirement coverage, architecture fit, evidence-grounding, task decomposition, acceptance-criteria testability, risk/rollback, NFRs, and clarification discipline using blinded human review. The lexical scorer remains only a screening signal.

No superiority claim is permitted from one pilot or from lexical scores alone.

## Decision for the planning-quality benchmark

Do not promote the ten draft tasks yet: nine are `0.4.0-draft` and Immich IM-01 is `0.5.0-draft`. Immich IM-01 is the only task whose path and line-range evidence gates passed; the other four repository task families remain blocked. The current automated scorer is lexical and the current scan excerpt selector did not deliver the cited core implementation files to the model. A result from these inputs would conflate planner quality with a known evidence-retrieval failure and could reward keyword coverage rather than technical correctness.

The task-specific priority selection, line-ranged excerpts, and missing-evidence gate are implemented and measured. The latest Immich IM-01 evidence artifact confirms 9/9 paths and 12/12 line ranges delivered, with no missing or unexcerpted ranges. A separate blinded human rubric is ready at [IMMICH_IM01_HUMAN_REVIEW.md](external-tasks/IMMICH_IM01_HUMAN_REVIEW.md). The next live step is one paired Immich IM-01 pilot, but it cannot start until an OIOL provider and OpenCode endpoint/model are configured. Preserve a separate end-to-end measure of default scanner retrieval quality; do not hide the current retrieval weakness by reporting only task-prioritized runs.

No live planning-quality score is claimed in this audit. The available environment has not yet supplied an authorized OIOL provider credential or an OpenCode endpoint/model configuration for live paired runs.
