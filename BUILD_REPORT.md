# OIOL — Intelligent Engineering Planning System
## Build and validation report — v0.4.1

## Product boundary

OIOL produces engineering plans. It analyzes requirements and existing repositories, proposes architecture and trade-offs, decomposes work, defines task dependencies and artifact interfaces, specifies acceptance criteria, records risks and unknowns, validates plan consistency, and exports reviewable handoff artifacts.

OIOL does not implement code, run project commands or tests, modify target repositories, verify completed implementation, or manage execution state. The legacy execution prototype from earlier versions has been retired from the product source.

## Implemented capabilities

- Four provider adapters: OpenAI-compatible, Anthropic, Gemini, and Ollama.
- Greenfield and bounded existing-repository analysis.
- Structured plan contract with JSON Schema Draft 2020-12 and a complete example.
- Deterministic validation for IDs, requirement coverage, references, task inputs/outputs, dependency graph consistency, cycles, safe relative scopes, and blocking clarifications.
- Planning-only requirement traceability.
- Markdown engineering-plan report.
- Repository evidence identifiers and separate SHA-256 fingerprints for original source files and redacted excerpts.
- Ten-scenario planning benchmark harness, repeated-run aggregation, paired OpenCode planning baseline, and human-review aggregation protocol.

## Validation evidence

The latest recorded CI run before the v0.4.1 hardening follow-up is [42344839047](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42344839047), which passed on Node.js 22 and 24 with 103 tests passing and no failures.

The v0.4.1 follow-up adds regression coverage for malformed plan structures and repository evidence fingerprints. Its CI result must be checked after the commit is pushed; this report does not claim that those new tests have already passed.

## Known limitations

- No live provider benchmark or blinded human evaluation has been completed.
- The benchmark contains ten synthetic scenarios and is not statistically representative.
- Automated concept matching is lexical and can reward superficial keyword inclusion.
- Repository analysis is bounded and heuristic, not AST- or symbol-aware.
- Prompt-injection resistance and secret redaction are defense-in-depth measures, not a security boundary.
- Provider usage may be available; pricing is not estimated.
- Reviewer configuration separation is not proof of independent judgment.
