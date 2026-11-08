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

## Decision for the planning-quality benchmark

Do not promote the ten `0.3.0-draft` tasks yet. The current automated scorer is lexical and the current scan excerpt selector did not deliver the cited core implementation files to the model. A result from these inputs would conflate planner quality with a known evidence-retrieval failure and could reward keyword coverage rather than technical correctness.

The next measured step is narrow and testable:
- Make the task's explicitly reviewed evidence paths available to the existing read-only scanner as first-priority excerpt candidates (without running repository code or changing the target checkout).
- Verify each requested path is actually emitted as a redacted excerpt with source and excerpt SHA-256 fingerprints.
- Reject a scored run if required evidence paths are missing, over-size, redacted to unusability, or excluded by context limits; record the reason instead of silently proceeding.
- Then run one pilot task on Paperless-ngx, compare OIOL and OpenCode using the same pinned commit and exact task bytes, inspect the full plans, and only then expand to three repeated paired runs.
- Preserve a separate end-to-end measure of default scanner retrieval quality; do not hide the current retrieval weakness by reporting only task-prioritized runs.

No live planning-quality score is claimed in this audit. The available environment has not yet supplied an authorized OIOL provider credential or an OpenCode endpoint/model configuration for live paired runs.
