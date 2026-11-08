# OIOL Planner quality benchmark

This benchmark is an evaluation harness, not a claim that OIOL is already high quality. It contains ten versioned scenarios across Greenfield, Existing Project, ambiguous requirements, and multi-component architecture.

## Scenario set

| ID | Type | Challenge |
|---|---|---|
| GF-API-001 | Greenfield | Field operations REST API |
| GF-COMMERCE-002 | Greenfield / multi-component | Multi-tenant commerce platform |
| EX-API-003 | Existing Project | Cursor pagination with compatibility |
| EX-MONOLITH-004 | Existing Project / multi-component | Reliable asynchronous notifications in a monolith |
| AMB-AUTH-005 | Ambiguous | SSO provider, protocol, and identity-domain ambiguity |
| AMB-DATA-006 | Ambiguous | Undefined metrics, data sources, and real-time latency |
| GF-ANALYTICS-007 | Greenfield / data pipeline | Event ingestion, idempotency, replay, privacy, and observability |
| GF-DOCUMENTS-008 | Greenfield / multi-component | Secure uploads, metadata extraction, background processing, and retention |
| EX-SEC-009 | Existing Project | Tenant-scoped invoice authorization without response regressions |
| AMB-PAY-010 | Ambiguous | Payment provider, markets, currencies, refunds, and disputes |

The existing-project cases point to checked-in, compact Node.js fixture repositories under `benchmarks/fixtures/`. Both OIOL and OpenCode runners invoke the real repository scanner against those directories before planning and retain the resulting evidence IDs/fingerprints for scoring; scoring must validate against that actual scan output, not stale hand-authored scenario metadata. These fixtures are still small synthetic projects, not sanitized production repositories.

## Run

Use Node.js 22 or 24. Configure planning and reviewer providers using the `OIOL_*` environment variables documented in `.env.example`.

The benchmark can incur provider charges. Explicitly opt in before live calls:

```sh
OIOL_BENCHMARK_ALLOW_LIVE=1 node scripts/run-planner-benchmark.mjs
```

Run a subset or choose an output path:

```sh
OIOL_BENCHMARK_ALLOW_LIVE=1 node scripts/run-planner-benchmark.mjs --scenarios GF-API-001,AMB-AUTH-005 --out benchmarks/results/smoke.json
```

The runner writes:
- A JSON record with full plans, provider metadata, elapsed times, deterministic scores, and blockers.
- A CSV human-review sheet with one row per scenario.

Aggregate repeated runs from the same provider/model/configuration after running the suite at least three times:

```sh
npm run benchmark:aggregate -- --inputs benchmarks/results/run-a.json,benchmarks/results/run-b.json,benchmarks/results/run-c.json
```

The aggregator rejects mixed configuration fingerprints and duplicate run IDs, reports per-scenario median/min/max/spread and failure rate, and only marks the automated gate ready for human review when at least three runs cover every scenario without automated failures. It does not itself certify quality.

## Scanner-only corpus intake

Before spending model calls, produce a scanner-only intake report for a clean local checkout:

```sh
npm run benchmark:scan-external -- \
  --repo /absolute/path/to/clean/checkout \
  --id RW-REPO-01 \
  --out benchmarks/results/RW-REPO-01-scan.json
```

This command uses the existing `analyzeProject` and `scanRepository` implementation. It records the pinned Git commit, bounded file coverage, manifests, discovered tests/configuration, AST-versus-lexical coverage, import-graph statistics, diagnostics, and evidence fingerprints. It does not include source excerpts or the operator's absolute local path in the report. It does not execute project commands, tests, builds, package scripts, or modify the checkout. Reject or investigate reports with missing evidence, parser failures, truncation, or unexpectedly low AST coverage before creating scored planning tasks.

P12 has completed scanner-only intake for the five prioritized real-world repositories at pinned commits using scanner version `1.5.0` in [workflow run 42461297388](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42461297388). Per-repository reports are workflow artifacts. Ten repository-specific task definitions exist as `0.2.0-draft` files and pass runner-contract tests; they still require two independent human approvals before promotion. No live model benchmark or human score is claimed.

## External real-repository mode

The benchmark runners accept an operator-supplied **local Git checkout** for Existing Project scenarios. OIOL does not clone repositories, install dependencies, execute project scripts, run tests, build artifacts, or modify the target checkout.

First, obtain a public repository checkout outside OIOL and ensure its working tree is clean. Then run one or more Existing Project scenarios against it:

```sh
OIOL_BENCHMARK_ALLOW_LIVE=1 \
OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE=1 \
node scripts/run-planner-benchmark.mjs \
  --repo /absolute/path/to/clean/checkout \
  --task-file /absolute/path/to/repository-task.json \
  --scenarios EX-API-003 \
  --out benchmarks/results/external-oiol.json
```

Run the OpenCode planning baseline against the same checkout and scenario:

```sh
OIOL_OPENCODE_MODEL=providerID/modelID \
OIOL_OPENCODE_AGENT=plan \
OIOL_BENCHMARK_ALLOW_LIVE=1 \
OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE=1 \
npm run benchmark:opencode -- --repo /absolute/path/to/clean/checkout \
  --task-file /absolute/path/to/repository-task.json \
  --scenarios EX-API-003 \
  --out benchmarks/results/external-opencode.json
```

External mode requires a Git checkout with a 40-character commit SHA and a clean working tree. The scanner records the commit SHA; dirty or non-Git directories are rejected so results are tied to a reproducible snapshot. The absolute local path is not written to the plan or result artifact.

The OIOL runner scans the supplied checkout using the existing bounded read-only scanner. The OpenCode baseline receives a disposable workspace containing only the scanner's bounded, redacted excerpts; it does not receive a raw copy of the checkout. External runs additionally require `OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE=1` as a separate consent gate, because bounded source excerpts are included in prompts sent to the configured model provider. Redaction is best-effort, not a guarantee: inspect the scan report and your source-handling obligations before enabling this flag. This is intentionally conservative, but it means external baseline results are a comparison against the same sanitized evidence projection, not a full checkout mirror. Review scanner coverage and truncation diagnostics before interpreting any result.

Only Existing Project scenarios are valid with --repo, and external mode now requires a repository-specific --task-file. Exactly one Existing Project scenario is selected. The task file replaces the generic request and lexical scoring rubric; use the same exact file for OIOL and OpenCode. See [EXTERNAL_TASK_SCHEMA.md](EXTERNAL_TASK_SCHEMA.md) for the required fields, versioning, and reproducibility contract. Do not score arbitrary task/repository pairings as if they were equivalent. The five initial real-world candidates have two evidence-reviewed draft prompts each and ten schema-valid JSON task drafts under [external-tasks/drafts/](external-tasks/drafts/), documented in [external-tasks/PROPOSED_TASKS.md](external-tasks/PROPOSED_TASKS.md). They remain unapproved for scored runs until two reviewers approve the task wording, evidence paths, and rubrics and the definitions are promoted to version 1.0.0.

The local environment running the command must have access to the checkout. GitHub API access alone is not a local checkout and cannot be substituted for the scanner's filesystem input.

## OpenCode baseline and paired comparison

Run the OpenCode-only baseline against the same scenario set. Configure an explicit model reference and use the OpenCode `plan` agent (or another agent whose permissions are verified as read-only):

```sh
OIOL_OPENCODE_MODEL=providerID/modelID \
OIOL_OPENCODE_AGENT=plan \
OIOL_BENCHMARK_COMPARISON_KEY=model-family-and-version \
OIOL_BENCHMARK_BUDGET_KEY=declared-budget-profile \
OIOL_BENCHMARK_ALLOW_LIVE=1 \
npm run benchmark:opencode -- --scenarios all
```

Run OIOL with the matching model identity and the same comparison/budget keys:

```sh
OIOL_PROVIDER=openai-compatible \
OIOL_MODEL=model-id \
OIOL_BENCHMARK_COMPARISON_KEY=model-family-and-version \
OIOL_BENCHMARK_BUDGET_KEY=declared-budget-profile \
OIOL_BENCHMARK_ALLOW_LIVE=1 \
npm run benchmark:planner -- --scenarios all
```

The keys are operator attestations, not automatic proof that server-side model settings, token limits, tools, or compute budgets are identical. Do not compare runs unless they truly use the same model, scenario snapshot, reviewer setup, and resource budget.

Create a paired report:

```sh
npm run benchmark:compare -- --oiol benchmarks/results/oiol.json --baseline benchmarks/results/opencode-baseline.json
```

The OpenCode baseline runs in a disposable copy of each fixture workspace, inspects the session diff, rejects any file changes, and removes the temporary workspace afterwards. This is post-execution detection plus cleanup, not a sandbox; configure the OpenCode plan agent with read-only permissions. The paired report includes per-scenario score deltas and explicitly flags whether reviewer configuration matches. A positive automated score delta is not a quality claim. Repeat paired comparisons at least three times and complete blinded human review before drawing conclusions.

Aggregate three or more paired comparison reports:

```sh
npm run benchmark:compare:aggregate -- --inputs benchmarks/results/pair-1.json,benchmarks/results/pair-2.json,benchmarks/results/pair-3.json
```

The paired aggregator reports median/min/max/spread for each scenario. For external repositories it also rejects repeat sets that drift across repository commit SHAs, task-definition hashes, or either runner's configuration fingerprint. It blocks human-adjudication readiness unless at least three paired runs exist and reviewer configurations match.

Do not commit API keys or private benchmark results containing sensitive repository details.

## Automated rubric (100 points)

| Dimension | Weight | Evidence |
|---|---:|---|
| Structural validity | 25 | Deterministic plan validator, including exact evidence-ID/source/fingerprint matching against the actual scanned project and schema validity when recorded |
| Requirement signal coverage | 25 | Expected scenario concepts found in plan JSON |
| Clarification discipline | 20 | Required blocking clarification appears for ambiguous cases; no unnecessary blocker for clear cases |
| Acceptance criteria | 15 | At least two criteria per task reaches full credit |
| Scoped tasks | 10 | Each task has a non-empty write scope |
| Reviewer configuration separation | 5 | Planner and reviewer have different provider/model/endpoint configuration; this is not proof of independent judgment |

This rubric is intentionally transparent and imperfect. Signal matching is lexical, not semantic; it can miss good paraphrases and reward superficial keyword inclusion. Treat automated scores as screening signals, not a final quality verdict. The current score does not measure code correctness, architecture novelty, real test execution, or factual grounding beyond the scenario fixtures.

A scenario passes the automated gate only at 80+ with no deterministic blockers. Report every scenario; never hide failed or low-scoring cases.

## Human review protocol

At least two reviewers should independently score every plan, without seeing provider identity or automated scores before submitting their review. Reviewers must cite concrete plan evidence and must not infer missing details in the model's favor.

Score each dimension from 1 to 5:

1. **Technical correctness:** Is the architecture technically coherent and feasible?
2. **Requirement understanding:** Does it preserve explicit requirements and constraints without inventing facts?
3. **Task decomposition:** Are tasks atomic, ordered correctly, and sized for a coding agent?
4. **Acceptance criteria:** Are outcomes observable, testable, and sufficiently complete?
5. **Scope and safety:** Are write scopes bounded, destructive actions avoided, and existing-project conventions respected?
6. **Clarification quality:** Does it ask only necessary questions and block decisions that cannot safely be assumed?
7. **Overall:** Would you approve this plan for a supervised implementation stage?

Anchors: 1 = materially unsafe or unusable; 2 = major omissions or rework required; 3 = usable only with meaningful revision; 4 = strong with minor corrections; 5 = precise, complete, and implementation-ready.

Resolve reviewer disagreements by recording both original scores and an adjudicated score with a written rationale. Do not average away a critical safety or correctness objection. After collecting the filled CSVs, aggregate them with:

    npm run benchmark:human-review -- --inputs reviewer-a.csv,reviewer-b.csv --out benchmarks/results/human-review-aggregate.json

The aggregator requires two distinct reviewers per scenario, evidence notes, and a documented adjudication when overall scores differ by 2 or more points. Any high or critical finding blocks the human-review gate regardless of averages.

## Certification decision

Do not certify based on a single model run or aggregate score. Minimum evidence before release:
- All ten scenarios completed; no hidden failures.
- Every ambiguous case correctly blocks provider-specific implementation pending clarification.
- No critical or high severity human finding remains unresolved.
- Median human overall score >= 4/5, with no scenario below 3/5.
- Repeat the suite at least three times per provider/model configuration; report median, spread, and failures.
- Run the same scenarios through baseline OpenCode and OpenCode + OIOL with identical model, tools, repository snapshot, and time/token budget before claiming an advantage.
- Include token/cost data from provider usage metadata when available; this initial runner records elapsed time but does not estimate tokens or cost where providers do not expose usage.

## Current limitations

- The ten-case set is a starter suite, not statistically representative.
- Existing-project fixtures are real checked-in fixture repositories scanned by the repository analyzer, but remain small synthetic projects and need sanitized production repositories for stronger external validity.
- Automated concept matching is lexical and requires human review.
- Human-review CSV is a blank collection template; scores must be entered by reviewers.
- Provider-reported token usage is aggregated when available; pricing is not estimated. A paired planning-only baseline harness is available; comparable runs still require identical models, inputs, reviewer configuration, and resource budgets.
