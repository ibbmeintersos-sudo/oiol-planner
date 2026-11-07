# Changelog

## 0.4.1 — planning integrity and provenance hardening

### Changed
- Made graph derivation, task-interface projection, and plan evaluation fail safely on malformed task structures instead of throwing incidental runtime errors.
- Added stable repository evidence IDs and distinct SHA-256 fingerprints for original source files and redacted excerpts.
- Included evidence IDs directly in repository context so planner claims can cite the exact excerpt supplied to the model.
- Retired the legacy execution engine, state machine, event store, recovery inspector, OpenCode task runner, and execution-only tests from the product source.
- Clarified the package description as planning-only.

### Validation
- Added regression tests for malformed dependency data, malformed task entries, source/excerpt provenance fingerprints, and secret redaction.
- Hardened redaction for quoted JSON keys, YAML-style assignments, bearer headers, GitHub/AWS/Slack token patterns, and private-key blocks. This remains heuristic defense-in-depth, not a guarantee that all secrets are detected.
- Made scan truncation explicit with included-file counts and lower-bound metadata.
- Added non-blocking plan-quality diagnostics for missing descriptions, acceptance criteria, component responsibilities, decision alternatives, mitigations, and clarification questions. These are review prompts, not an opaque quality score.
- Added these diagnostics to generated plans, validation output, and Markdown reports.
- Added a schema-aware validator for the published contract's supported JSON Schema keywords. HybridPlanner now rejects schema-invalid plans before reviewer evaluation; the offline CLI validates the same contract without provider calls.
- Kept the validator explicit about its supported keyword subset; external consumers should use a standards-compliant Draft 2020-12 implementation.
- CI run 42346850007 passed on Node.js 22 and 24: 116 tests passed, 0 failed.

## 0.4.0 — planning-only contract and quality foundations

- Published JSON Schema Draft 2020-12 contract and a complete versioned plan example.
- Added offline plan validation and human-readable Markdown plan reports.
- Added planning-only requirement traceability and explicit task artifact handoff contracts.
- Added a ten-scenario planning benchmark and a blinded human-review protocol.
- Re-established OIOL as an engineering planning system; implementation belongs to a human or external implementation tool.

## Historical note

Versions 0.1.x–0.3.x included an experimental human-gated execution prototype. That prototype is historical and is not part of the current planning-only product boundary.
