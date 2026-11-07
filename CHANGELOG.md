# Changelog

## 0.4.1 — planning integrity and provenance hardening

### Changed
- Made graph derivation, task-interface projection, and plan evaluation fail safely on malformed task structures instead of throwing incidental runtime errors.
- Added stable repository evidence IDs and distinct SHA-256 fingerprints for original source files and redacted excerpts.
- Included evidence IDs directly in repository context so planner claims can cite the exact excerpt supplied to the model.
- Retired the legacy execution engine, state machine, event store, recovery inspector, OpenCode task runner, and execution-only tests from the product source.
- Clarified the package description as planning-only.

### Validation
- Added regression tests for malformed dependency data, malformed task entries, and source/excerpt provenance fingerprints.
- CI for this follow-up is pending; no passing result is claimed here.

## 0.4.0 — planning-only contract and quality foundations

- Published JSON Schema Draft 2020-12 contract and a complete versioned plan example.
- Added offline plan validation and human-readable Markdown plan reports.
- Added planning-only requirement traceability and explicit task artifact handoff contracts.
- Added a ten-scenario planning benchmark and a blinded human-review protocol.
- Re-established OIOL as an engineering planning system; implementation belongs to a human or external implementation tool.

## Historical note

Versions 0.1.x–0.3.x included an experimental human-gated execution prototype. That prototype is historical and is not part of the current planning-only product boundary.
