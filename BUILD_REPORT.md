# OIOL Planner v0.1.2 — Hardening and integration contract report

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

## Automated validation

GitHub Actions runs Node.js 20 syntax checks over every source module and the complete node:test suite. The v0.1.2 pull request checks completed successfully:

- Push CI: https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42298039133
- Pull request CI: https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42298070272

The tests use fake HTTP transports. They do not establish compatibility against live provider accounts or a running OpenCode server.

## Remaining limitations

- No autonomous execution/orchestration engine, worker lifecycle manager, worktree isolation manager, merge coordinator, or durable execution event log.
- No exactly-once recovery guarantee.
- Repository scanning remains heuristic; redaction cannot guarantee all secrets are removed.
- No live provider/OpenCode end-to-end test matrix.
- No baseline or comparative benchmark demonstrating planning quality or speed against stock OpenCode or other coding agents.
- Not production-ready for autonomous repository modification.
