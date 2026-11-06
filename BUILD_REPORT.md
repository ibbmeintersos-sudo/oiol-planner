# OIOL Planner v0.1.1 — Core hardening report

## Scope

This release hardens the reconstructed v0.1.0 planning core. It does not add an execution engine and does not claim production readiness.

## Changes

- Enforced strict plan structure and blocking requirement coverage.
- Required dependency graph nodes and edges to exactly match task IDs and task dependency declarations.
- Added deterministic scheduling checks for unknown references, duplicate IDs, cycles and overlapping write scopes.
- Prevented review approval when critical/high findings remain; review failures cannot produce a ready-for-review plan.
- Tightened provider JSON parsing to reject prose-wrapped or non-object responses.
- Bounded repository discovery by file count and depth; retained symlink avoidance and heuristic redaction.
- Expanded regression tests and added GitHub Actions CI for syntax and test checks.

## Validation

GitHub Actions run: https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42297398671

The run completed successfully on Node.js 20. Both static syntax checks and the automated test suite passed. This is a successful CI run for commit `75de3051ffa2c17ed3b05d23bbd73d8a37dbe05f`.

## Limitations

- No live LLM provider integration test was run.
- No live OpenCode server integration test was run.
- No benchmark establishes planning quality against other agents.
- The scanner's redaction remains heuristic; it is not a guarantee that all secrets are removed.
- The product remains a planner, not an autonomous execution/orchestration system.
