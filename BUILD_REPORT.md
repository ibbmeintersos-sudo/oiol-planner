# OIOL — Intelligent Engineering Planning System
## Build and validation report — v0.4.1

## Product boundary

OIOL produces engineering plans. It analyzes requirements and existing repositories, proposes architecture and trade-offs, decomposes work, defines task dependencies and artifact interfaces, specifies acceptance criteria, records risks and unknowns, validates plan consistency, and exports reviewable handoff artifacts.

OIOL does not implement code, run project commands or tests, modify target repositories, verify completed implementation, or manage execution state. The legacy execution prototype from earlier versions has been retired from the product source.

## Implemented capabilities

- Four provider adapters: OpenAI-compatible, Anthropic, Gemini, and Ollama.
- Greenfield and bounded existing-repository analysis.
- Structured plan contract with JSON Schema Draft 2020-12, a complete example, and an internal validator for the published schema's supported keyword subset.
- Schema validation in HybridPlanner before reviewer evaluation, plus offline schema and semantic validation in the CLI.
- Deterministic validation for IDs, requirement coverage, references, task inputs/outputs, dependency graph consistency, cycles, safe relative scopes, and blocking clarifications.
- Planning-only requirement traceability.
- Non-blocking plan-quality diagnostics surfaced in JSON and Markdown reports.
- Markdown engineering-plan report.
- Repository evidence identifiers aligned between scanner context and analyzer evidence records, with separate SHA-256 fingerprints for original source files and redacted excerpts; plan citations are checked against the supplied IDs and fingerprints.
- Benchmark scoring validates against the actual scanner evidence captured by each run, not stale fixture summaries; schema-invalid plans are structural blockers.
- Ten-scenario planning benchmark harness, repeated-run aggregation, paired OpenCode planning baseline, and human-review aggregation protocol.

## Validation evidence

The latest CI run is [42347639742](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42347639742). Both Node.js 22 and 24 jobs passed syntax checks and all 125 tests (125 passed, 0 failed).

The passing suite covers published-schema validation, planner gating before reviewer evaluation, malformed plan structures, planning-only contract boundaries, evidence ID alignment, exact source/excerpt fingerprint matching, structured secret redaction, quality diagnostics, schema validation, Markdown reporting, and benchmark evidence matching.

## Known limitations

- No live provider benchmark or blinded human evaluation has been completed.
- The benchmark contains ten synthetic scenarios and is not statistically representative.
- Automated concept matching is lexical and can reward superficial keyword inclusion.
- Repository analysis is bounded and heuristic, not AST- or symbol-aware.
- Prompt-injection resistance and secret redaction are defense-in-depth measures, not a security boundary.
- Provider usage may be available; pricing is not estimated.
- Reviewer configuration separation is not proof of independent judgment.
