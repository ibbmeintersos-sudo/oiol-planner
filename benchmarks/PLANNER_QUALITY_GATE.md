# Planner quality gate and certification protocol

This document defines the evidence required before calling an OIOL Planner release quality-certified. Passing unit tests is necessary but not sufficient.

## Current certification level

The current branch is a **quality-hardening candidate**, not a certified release. CI and deterministic contract tests can establish structural correctness; they cannot establish that an LLM consistently produces useful plans for unseen software requests.

## Release gates

A release candidate must pass all applicable gates:

1. **Contract correctness** — malformed plans, duplicate identifiers, unmapped requirements, invalid references, dependency mismatches, cycles, unsafe paths, missing task descriptions, missing acceptance criteria, and unresolved blocking clarifications are rejected.
2. **Traceability** — every requirement maps to at least one task; every task has explicit acceptance criteria and a verifiable implementation scope.
3. **Graph correctness** — dependency edges exactly match task declarations; schedules are acyclic and deterministic; overlapping write scopes are not scheduled in the same wave.
4. **Ambiguity handling** — blocking unknowns are surfaced as blocking clarifications, never silently converted into assumptions that authorize execution.
5. **Repository fit** — existing-project plans preserve detected conventions, avoid unrelated rewrites, and distinguish observed repository facts from assumptions.
6. **Provider robustness** — malformed JSON, transient failures, timeouts, provider refusal, and reviewer unavailability fail safely and are reported.
7. **Security** — repository context is treated as untrusted input; secret redaction limitations are documented; write-scope checks are not represented as a sandbox.
8. **Integration** — live provider and OpenCode server smoke tests pass in a configured environment before live compatibility is claimed.
9. **Empirical plan quality** — a versioned scenario set is run against at least one named provider/model and independently reviewed by humans.
10. **Comparative value** — claims of improvement over stock OpenCode require paired baseline runs with the same model, repository snapshot, permissions, and budget.

## Minimum empirical benchmark

Use at least 20 tasks across both greenfield and existing-project modes. Include:
- small API/service creation;
- multi-component application planning;
- data import/reporting workflow;
- authentication and authorization changes;
- database schema migration;
- bug fixes spanning multiple modules;
- refactoring with compatibility constraints;
- incomplete or contradictory requests requiring clarification;
- repository with tests/configuration/conventions;
- repository with dirty working-tree changes.

For each run, preserve the exact request, repository commit, scanner output, provider/model/version, temperature, token/cost usage, plan JSON, validation output, review output, elapsed time, and benchmark rubric.

## Scoring rubric

Score each dimension from 0 to 4 using a human reviewer who did not author the plan:

- requirement completeness and fidelity (25%);
- task granularity and actionability (20%);
- dependency and interface correctness (15%);
- acceptance criteria and verification quality (15%);
- repository fit and change-scope discipline (15%);
- ambiguity, risk, and security handling (10%).

A score of 0 means unusable or unsafe; 1 means major omissions; 2 means partially usable with material rework; 3 means usable with minor corrections; 4 means clear, complete, and directly actionable.

Report every dimension, weighted score, reviewer disagreement, and failure case. Do not let the model that generated a plan be its only quality judge. Do not collapse hard safety failures into an average: any unsafe scope, fabricated repository fact, unhandled blocking ambiguity, or destructive recommendation is a benchmark failure.

## Pass thresholds

For a release candidate:
- all deterministic tests pass on Node.js 22 and 24;
- no critical/high security or correctness defect remains open;
- 100% of benchmark plans pass structural validation;
- no blocking ambiguity is silently ignored;
- median independent human score is at least 3.2/4;
- no benchmark dimension has a median below 3/4;
- all critical failures are zero;
- live integration evidence is attached when integration support is claimed.

A comparative claim that OIOL improves on stock OpenCode additionally requires paired runs and a predeclared success metric. Until then, make no superiority claim.

## Known evidence gaps to close

- Real provider/model plan-generation benchmark is not yet recorded.
- Independent human scoring of benchmark outputs is not yet recorded.
- Live provider request has not been run in this environment.
- Live OpenCode server smoke test has not been run.
- Write-scope enforcement in the OpenCode runner is post-execution detection, not a filesystem sandbox.
- Worktree isolation and safe merge coordination are not implemented.
- Recovery inspection does not automatically resume uncertain work.

## Decision

Until all relevant gates have attached evidence, describe OIOL Planner as an engineering preview or quality-hardening candidate, not production-ready or finally certified.
