# Changelog

## 0.3.0 — execution hardening preview

### Added
- OpenCode task runner with an end-to-end task deadline, cancellation propagation, failed-session cleanup, and mandatory independent verification.
- Durable JSONL event-store schema validation and strict per-run sequence enforcement.
- Node.js 22/24 CI matrix.
- Regression coverage for task lifecycle, cancellation, retries, event-store restart, corruption, and concurrent appends.

### Changed
- Execution retries require an explicitly idempotent runner.
- Only errors accepted by the retry policy are retried; policy callback failures fail closed.
- OpenCode task prompts now use actual multiline formatting.
- Runtime requirement is Node.js 22 or newer.

### Known limitations
- No live OpenCode server integration test.
- No Git worktree isolation; OpenCode task runner remains serial.
- No automatic recovery, exactly-once execution, or multi-process JSONL locking.
- No benchmark evidence that OIOL outperforms stock OpenCode.
