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
