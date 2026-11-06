# OIOL Planner v0.2.0 — Engineering hardening report

## Provenance

This codebase began as a reconstructed implementation based on the retained v0.1.0 design specification. It is not byte-for-byte identical to the earlier unavailable archive.

## v0.1.1 — Core integrity

- Enforced blocking requirement coverage and stricter plan structure.
- Required exact agreement between task dependencies and graph nodes/edges.
- Hardened topological scheduling, path validation and bounded repository discovery.
- Prevented high/critical review findings and review failures from being treated as approval.
- Added CI for syntax checks and automated tests.
- Removed the one-time archive extraction workflow from normal push events.

## v0.1.2 — Provider and OpenCode reliability

- Added injectable HTTP transports to all provider adapters.
- Validated successful response payloads and classified retryable HTTP errors.
- Exposed timeout and bounded retry settings through CLI configuration.
- Hardened OpenCode HTTP calls with URL validation, timeout handling, session ID encoding and JSON response validation.
- Added contract tests for OpenAI-compatible, Anthropic, Gemini, Ollama and OpenCode adapters.
- Improved evaluation dependency diagnostics.
- Propagated re-verification requirements to transitive downstream tasks when upstream tasks change.

## v0.2.0 — Human-gated execution orchestration

- Added a deterministic task state machine and dependency-aware execution engine.
- Requires explicit human approval bound to a SHA-256 fingerprint of the exact plan revision.
- Requires a runner with separate execute and verify methods.
- Requires an explicit event store; includes in-memory and append-only JSONL implementations with restrictive file permissions and sequence checks.
- Uses bounded concurrency, but only when the runner explicitly declares concurrency safety; otherwise it serializes work.
- Exposes only declared dependency outputs to each task.
- Retries default to zero; optional retries reuse stable task idempotency keys.
- Supports fail-fast, cancellation and blocked dependents after failures.
- Added OpenCode task runner using documented server routes; it requires a separate verification callback and serializes tasks because no Git worktree isolation is implemented.
- No automatic resume or exactly-once guarantee is claimed.

## Automated validation

GitHub Actions runs Node.js 20 syntax checks over every source module and the complete node:test suite.

- v0.1.2 integration CI: https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42298070272
- v0.2.0 push CI: https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42299201813

The v0.2.0 push CI passed 62 tests: 62 passed, 0 failed. Provider and OpenCode tests use fake HTTP transports; no live provider credentials or OpenCode server were used.

## Remaining limitations

- No Git worktree isolation or safe parallel OpenCode task execution.
- No process-crash recovery/reconciliation for uncertain tasks; no exactly-once semantics.
- No merge coordinator or final repository acceptance gate that runs a configurable test matrix.
- Repository scanning and secret redaction remain heuristic.
- No live provider/OpenCode end-to-end test matrix.
- No benchmark against stock OpenCode or other coding agents; superiority is not established.
- The CLI currently creates plans; the execution engine is exposed as a library and is not yet wired into an end-user execution command.
- Not production-ready for unattended autonomous repository modification.
