# OIOL Planner quality benchmark

This benchmark is an evaluation harness, not a claim that OIOL is already high quality. It contains six versioned scenarios across Greenfield, Existing Project, ambiguous requirements, and multi-component architecture.

## Scenario set

| ID | Type | Challenge |
|---|---|---|
| GF-API-001 | Greenfield | Field operations REST API |
| GF-COMMERCE-002 | Greenfield / multi-component | Multi-tenant commerce platform |
| EX-API-003 | Existing Project | Cursor pagination with compatibility |
| EX-MONOLITH-004 | Existing Project / multi-component | Reliable asynchronous notifications in a monolith |
| AMB-AUTH-005 | Ambiguous | SSO provider, protocol, and identity-domain ambiguity |
| AMB-DATA-006 | Ambiguous | Undefined metrics, data sources, and real-time latency |

The existing-project cases now point to checked-in, compact Node.js fixture repositories under `benchmarks/fixtures/`. The runner invokes the real repository scanner against those directories before planning; it does not pass the old hand-authored repository summary as if it were scan output. These fixtures are still small synthetic projects, not sanitized production repositories.

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

Do not commit API keys or private benchmark results containing sensitive repository details.

## Automated rubric (100 points)

| Dimension | Weight | Evidence |
|---|---:|---|
| Structural validity | 25 | Existing deterministic plan validator |
| Requirement signal coverage | 25 | Expected scenario concepts found in plan JSON |
| Clarification discipline | 20 | Required blocking clarification appears for ambiguous cases; no unnecessary blocker for clear cases |
| Acceptance criteria | 15 | At least two criteria per task reaches full credit |
| Scoped tasks | 10 | Each task has a non-empty write scope |
| Independent review | 5 | Planner marks review as independent |

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

Resolve reviewer disagreements by recording both original scores and an adjudicated score with a written rationale. Do not average away a critical safety or correctness objection.

## Certification decision

Do not certify based on a single model run or aggregate score. Minimum evidence before release:
- All six scenarios completed; no hidden failures.
- Every ambiguous case correctly blocks provider-specific implementation pending clarification.
- No critical or high severity human finding remains unresolved.
- Median human overall score >= 4/5, with no scenario below 3/5.
- Repeat the suite at least three times per provider/model configuration; report median, spread, and failures.
- Run the same scenarios through baseline OpenCode and OpenCode + OIOL with identical model, tools, repository snapshot, and time/token budget before claiming an advantage.
- Include token/cost data from provider usage metadata when available; this initial runner records elapsed time but does not estimate tokens or cost where providers do not expose usage.

## Current limitations

- The six-case set is a starter suite, not statistically representative.
- Existing-project fixtures are real checked-in fixture repositories scanned by the repository analyzer, but remain small synthetic projects and need sanitized production repositories for stronger external validity.
- Automated concept matching is lexical and requires human review.
- Human-review CSV is a blank collection template; scores must be entered by reviewers.
- Provider-reported token usage is aggregated when available; pricing is not estimated. A paired baseline OpenCode vs OpenCode+OIOL execution adapter is still required for a fair comparison.
