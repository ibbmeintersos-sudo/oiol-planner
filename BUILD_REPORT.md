# OIOL Planner v0.1.0 — Reconstruction build report

## Provenance

This package is a **reconstructed implementation** based on the retained v0.1.0 design specification and test/architecture notes. It is not asserted to be byte-for-byte identical to the earlier session's ZIP archive, which was no longer available in the active workspace.

## Included

- Greenfield and existing-project analysis.
- Conservative repository scanner with bounded context and basic redaction.
- Provider abstraction for OpenAI-compatible, Anthropic, Gemini and Ollama APIs.
- Hybrid planner with deterministic validation and optional independent review.
- Dependency graph validation and conservative topological scheduling.
- Task interface derivation, plan revision comparison, traceability and evaluation metrics.
- Minimal OpenCode HTTP adapter.
- CLI, tests and documentation.

## Validation performed in this build

The automated test suite covers deterministic plan validation, invalid references, unsafe paths, dependency cycles, dependency ordering, overlapping write scopes, revision classification, traceability, and evaluation conflict reporting.

Live LLM, live OpenCode, and end-to-end GitHub-hosted package tests are not represented as completed unless separately reported after execution.
