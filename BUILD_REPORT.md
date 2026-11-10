# OIOL — Intelligent Engineering Planning System
## Build and validation report — v0.5.1 (P12 distribution and CI quality gates)

## Product boundary

OIOL produces engineering plans. It analyzes requirements and existing repositories, proposes architecture and trade-offs, decomposes work, defines task dependencies and artifact interfaces, specifies acceptance criteria, records risks and unknowns, validates plan consistency, and exports reviewable handoff artifacts.

OIOL does not implement code, run project commands or tests, modify target repositories, verify completed implementation, or manage execution state. Repository analysis is read-only and is evidence for planning, not an execution feature.

## Implemented capabilities

- Four provider adapters: OpenAI-compatible, Anthropic, Gemini, and Ollama.
- Greenfield and bounded existing-repository analysis.
- Structured plan contract with JSON Schema Draft 2020-12, a complete example, and an internal validator for the published schema's supported keyword subset.
- Deterministic validation for IDs, requirement coverage, references, task inputs/outputs, dependency graph consistency, cycles, safe relative scopes, and blocking clarifications.
- Planning-only requirement traceability, Markdown plan reporting, and non-blocking plan-quality diagnostics.
- Repository evidence identifiers aligned between scanner context and analyzer evidence records, with separate SHA-256 fingerprints for original source files and redacted excerpts.
- Tree-sitter concrete-syntax-tree parsing through the pinned WebAssembly language-pack dependency for languages included in its bundled grammar subset.
- AST-derived declarations and import references, parser-recovery diagnostics, bounded source bytes, AST depth, and visited-node limits, and explicit AST-versus-lexical-fallback coverage.
- Bounded lexical fallback for unsupported grammars or files that cannot be parsed; scanner never executes repository code or scripts.
- Ten-scenario planning benchmark harness, paired OpenCode planning baseline, and human-review aggregation protocol.
- Self-review GitHub Actions with plan-level quality gates for OpenRouter and Ollama; both fail on a missing, blocked, or schema-invalid plan and publish plan metrics to the job summary.
- P12 36-case corpus distributed as 72 blinded review packets with a hash-only freeze gate that requires two valid independent reviews per case before evaluation.
- OpenCode V2.2.5 benchmark baseline adapter using the V2 `/api/*` contract, an `/api/info` version preflight, paginated history, and rejection of tool/shell messages or file changes.

## Validation evidence

CI run [42885204402](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42885204402) passed on Node.js 22 and Node.js 24 after PR #34 merged. The same OIOL CI matrix passed for PR #33 (run 42884201242) and PR #34 (run 42884879214). The 0.5.1 change itself is limited to the version, changelog, README, and this report; runtime behavior is unchanged.

The regression suite covers JavaScript AST extraction and comment false-positive checks, Python package-relative import resolution, syntax-recovery diagnostics, existing scanner evidence and graph behavior, independent-review validation and freezing, and the planning-only contract.

## Known limitations

- The WebAssembly grammar bundle is curated; unsupported languages use lexical fallback.
- Tree-sitter produces concrete syntax trees, not type checking, complete symbol resolution, or proof of runtime behavior.
- Package aliases, workspace resolution, dynamic imports, generated code, reflection, and runtime dependency injection may remain unresolved.
- The scanner remains bounded by file-count, file-size, context-size, AST-depth, and visited-node limits; absence from a scan is not proof of absence.
- No live provider benchmark or blinded human evaluation has been completed.
- The 72 P12 packets are incomplete skeletons: no reviews are frozen, no ground truth exists, and no real-world accuracy result is claimed.
- The OpenCode V2.2.5 baseline adapter is CI-verified only; no live paired benchmark against a running V2.2.5 server has been performed.
- npm publication requires a valid `NPM_TOKEN` or npm trusted publishing; the release workflow fails at the publish step without it.
- Prompt-injection resistance and secret redaction are defense-in-depth measures, not a security boundary.
- Reviewer configuration separation is not proof of independent judgment.
