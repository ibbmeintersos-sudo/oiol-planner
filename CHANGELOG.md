# Changelog

## 0.5.0 — Tree-sitter AST repository analysis

### Added
- Added a pinned WebAssembly Tree-sitter language-pack dependency with a bundled grammar subset, avoiding parser grammar downloads during repository scans.
- Added syntax-tree-based extraction of declarations and import references, syntax-recovery diagnostics, bounded source-size/depth/node traversal, and AST coverage metadata.
- Preserved bounded lexical fallback for unsupported grammars or files that cannot be parsed.
- Added regression fixtures for JavaScript AST extraction, comment false positives, Python relative imports, and syntax-error recovery.

### Changed
- Updated the scanner methodology and limitations documentation to distinguish AST evidence from lexical fallback.
- Updated CI to install the locked dependency set before running static checks and tests.
- Kept the product planning-only: repository scanning remains read-only and does not run project code or commands.

### Validation
- CI run [42407390684](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42407390684) passed on Node.js 22 and 24: 138 tests passed, 0 failed in each job.

## 0.4.1 — planning integrity and provenance hardening

### Changed
- Made graph derivation, task-interface projection, and plan evaluation fail safely on malformed task structures instead of throwing incidental runtime errors.
- Added stable repository evidence IDs and distinct SHA-256 fingerprints for original source files and redacted excerpts.
- Included evidence IDs directly in repository context and aligned analyzer evidence records with those same IDs and fingerprints, so planner citations resolve to the exact excerpt supplied to the model.
- Retired the legacy execution engine, state machine, event store, recovery inspector, OpenCode task runner, and execution-only tests from the product source.
- Clarified the package description as planning-only.

### Validation
- Added regression tests for malformed dependency data, malformed task entries, source/excerpt provenance fingerprints, and secret redaction.
- Hardened redaction for quoted JSON keys, YAML-style assignments, bearer headers, GitHub/AWS/Slack token patterns, and private-key blocks. This remains heuristic defense-in-depth, not a guarantee that all secrets are detected.
- Made scan truncation explicit with included-file counts and lower-bound metadata.
- Added non-blocking plan-quality diagnostics for missing descriptions, acceptance criteria, component responsibilities, decision alternatives, mitigations, and clarification questions.
- Added a schema-aware validator for the published contract's supported JSON Schema keywords. HybridPlanner rejects schema-invalid plans before reviewer evaluation; the offline CLI validates the same contract without provider calls.
- Added plan-evidence contract validation and aligned benchmark scoring with actual scanner evidence.
- CI run 42349275375 passed on Node.js 22 and 24.

## 0.4.0 — planning-only contract and quality foundations

- Published JSON Schema Draft 2020-12 contract and a complete versioned plan example.
- Added offline plan validation and human-readable Markdown plan reports.
- Added planning-only requirement traceability and explicit task artifact handoff contracts.
- Added a ten-scenario planning benchmark and a blinded human-review protocol.
- Re-established OIOL as an engineering planning system; implementation belongs to a human or external implementation tool.

## Historical note

Versions 0.1.x–0.3.x included an experimental human-gated execution prototype. That prototype is historical and is not part of the current planning-only product boundary.
