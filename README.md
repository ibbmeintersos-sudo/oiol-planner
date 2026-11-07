# OIOL Planner

**OpenCode Intelligence & Optimization Layer — Planner and execution preview v0.3.0**

OIOL is a hybrid planning and human-gated execution layer intended to sit above OpenCode. It turns a software request into a structured plan, validates it deterministically, then can coordinate approved tasks through an injected runner.

 > OIOL does not perform unreviewed autonomous changes. Execution requires an explicit approval bound to the exact plan revision and a separate task-verification callback. The OpenCode runner can delegate implementation to an OpenCode server.

## Design principles

- Keep OpenCode Core untouched; integrate through a thin HTTP adapter.
- Support both greenfield and existing repositories.
- Use an LLM for understanding and planning, deterministic code for validation and scheduling.
- Treat repository content as untrusted context. Do not execute project scripts during scanning.
- No automatic plan approval. A review result of `approved` yields `ready_for_review`, not execution authorization.
- Preserve user changes and expose uncertainty rather than inventing repository facts.

## Requirements

- Node.js 22 or newer (the package engine requirement is `>=22`).
- An LLM provider endpoint for plan generation. Ollama can be used locally.
- No runtime npm dependencies in this preview.

## Quick start

```bash
cp .env.example .env
# Edit .env and set OIOL_API_KEY / provider configuration
npm test
node src/cli.mjs --mode greenfield --name "Inventory Service" \
  --request "Build an inventory API with products, stock adjustments, and audit history" \
  --out plan.json
```

Existing repository:

```bash
node src/cli.mjs --mode existing --repo /path/to/repository \
  --request "Add role-based access control without breaking existing API behavior" \
  --out plan.json
```

Supported providers:

| Provider | `OIOL_PROVIDER` | Notes |
|---|---|---|
| OpenAI-compatible | `openai-compatible` | Default; configurable base URL |
| Anthropic | `anthropic` | Messages API |
| Google Gemini | `gemini` | `generateContent` API |
| Ollama | `ollama` | Local `/api/chat` endpoint |

Configuration is read from `.env` when supported by the Node runtime, or from shell environment variables. `OIOL_TIMEOUT_MS` controls planning request timeout and `OIOL_MAX_RETRIES` controls bounded retry attempts (0–5). For an independent review gate, configure `OIOL_REVIEW_PROVIDER` and its optional model, base URL, API key, and timeout variables. If no distinct reviewer provider is configured, the planner may perform a same-provider critique, but the result is deliberately kept at `needs_revision`; self-review cannot certify readiness. A distinct reviewer provider returning `approved` with no high/critical findings can produce `ready_for_review`, which still requires human approval before execution. Do not commit `.env`.

## Output structure

The JSON plan contains:

- `project`: greenfield or existing-project context and scan evidence.
- `requirements`: uniquely identified requirements and priorities.
- `architecture`: components and decisions.
- `tasks`: scoped tasks, requirement/component references, dependencies, acceptance criteria, and write scopes.
- `dependencyGraph`: finish-to-start edges and topological execution waves.
- `risks`, `clarifications`, `review`, and deterministic `validation`.
- `evaluation`: transparent metrics rather than one opaque score.
- `taskInterfaces`: derived task inputs, outputs and consumers.
- `traceability`: planned mapping separated from actual verification completion.

## Existing repository scanner

The scanner collects Git branch/commit/dirty state, bounded working-tree file candidates, manifests, scripts, test/config paths and a bounded source context. Discovery stops at the configured file/depth limits rather than enumerating the entire tree first. It skips common dependency/build/cache folders, does not follow symlinks, avoids likely secret files, and applies basic secret redaction. File/import mapping is intentionally heuristic in this preview; it is not a full AST or semantic index.

The scanner does **not** run package scripts, tests, build commands, hooks, or arbitrary code from the target repository.

## OpenCode adapter

`src/adapters/opencode/client.mjs` exposes HTTP methods for health, session creation, session retrieval, prompting, aborting and reading diffs. It validates the base URL, supports configurable Basic Auth, propagates cancellation, bounds request duration, encodes session IDs, and rejects malformed responses. Configure the client with an absolute `directory` path to route every API request to the intended repository through OpenCode's `x-opencode-directory` header; omitting it falls back to the server's default working directory. `OpenCodeTaskRunner` uses this client to create one session per task and collect its response and diff.

## Validation and scheduling

The deterministic validator enforces the plan structure, unique IDs, requirement coverage, valid task/component references, safe relative write scopes, exact agreement between task dependencies and graph edges/nodes, supported edge types, and cycle-free scheduling. Missing requirement coverage is a blocking error. The scheduler builds deterministic topological waves and conservatively serializes tasks whose write scopes overlap. It does not prove semantic independence of tasks.

## Execution orchestration preview

The execution package is a separate orchestration core. It does not execute shell commands itself; callers must inject a runner implementing `execute(task, context)` and `verify(task, result, context)`.

Before execution, the engine requires:

- A plan with status `ready_for_review` that passes deterministic validation.
- An explicit approval object bound to the exact plan fingerprint, approver and timestamp.
- An explicit event store. `JsonlEventStore` persists append-only events with restrictive file permissions and validates the event schema plus strictly increasing per-run sequence numbers; `InMemoryEventStore` is for tests and ephemeral use. The JSONL implementation is a single-process, single-writer store, not a distributed lock or multi-process transaction coordinator. On initialization it discards an invalid, non-newline-terminated final fragment as a torn append, while malformed newline-terminated records remain hard errors; this is crash-tail repair, not tamper-proof audit storage.

Execution uses validated dependency waves, bounded concurrency, dependency-scoped task outputs, verification gates, fail-fast as an option, cancellation signaling and stable per-task idempotency keys. Automatic retries default to **zero** because repeating a task can duplicate side effects. Enabling execution retries requires `runner.idempotent === true`, and an error is retried only when the configured `retryOn(error, task, context)` policy returns `true` (default: `error.retryable === true`). A stable idempotency key is supplied, but the engine cannot prove that an external runner actually honors it.

The run-start event now records the exact planned task-ID ledger (in addition to its count); the recovery inspector checks that subsequent task events refer only to those IDs and rejects duplicate event IDs within a run. Older event logs without the optional `taskIds` field remain inspectable, but do not receive this stronger membership check. The JSONL store is intentionally single-process/single-writer: sharing one file between multiple Node processes is not safe.

Recovery is deliberately not automatic. `engine.inspectRun(runId)` (also exported as `inspectExecutionRun()`) replays a validated event stream and reports completed, failed, blocked, skipped, not-started, and uncertain tasks without resuming anything. Reusing a run ID is rejected, and a process interruption after a side effect but before its completion event can leave the task outcome uncertain. The event log is not an exactly-once guarantee. A future recovery manager must reconcile uncertain tasks with the runner before retrying.

The OpenCode runner is covered by fake-transport contract tests, but it has not yet been tested against a live OpenCode server.
### OpenCode runner

`OpenCodeTaskRunner` is an adapter for the documented OpenCode server API. It creates one session per task, submits a typed text part, collects the assistant response and session diff, applies a configurable task timeout (10 minutes by default), aborts failed sessions when possible, and delegates acceptance verification to a separate `verifyTask` callback. The callback is mandatory: an assistant saying that work is complete is not sufficient verification.

Live API smoke test (requires a running OpenCode server and an absolute project path):
```bash
OIOL_OPENCODE_DIRECTORY=/absolute/path/to/repository npm run smoke:opencode
```
Optional settings: `OIOL_OPENCODE_URL`, `OIOL_OPENCODE_USERNAME`, and `OIOL_OPENCODE_PASSWORD`. The smoke test checks server health, creates a temporary session, reads it back, and deletes it; it does not send a prompt or modify project files. This test must be run against the actual OpenCode server before claiming live integration.

The OpenCode server operates against the project directory in which `opencode serve` is started. The server adapter follows the documented `/session` and `/session/:id/message` API shape; session creation sends a title, and prompts use typed `parts`. The runner currently does not isolate tasks in Git worktrees, so it declares itself non-concurrency-safe and the engine serializes its tasks. Do not enable parallel writes until a tested worktree adapter exists.
## Security notes

- Never put credentials in project prompts or repository files.
- Repository text is untrusted input and may contain prompt injection.
- Redaction is heuristic and cannot guarantee removal of all secrets.
- Review all generated plans before execution.
- The planner does not modify the scanned repository.

## Current limitations

- Provider contract tests exercise request/response shapes and retry behavior through fake HTTP transports. No live provider request with real credentials has been run.
- OpenCode adapter and task runner have fake-transport contract tests; no live OpenCode server end-to-end test is included.
- No AST-based import graph, Git worktree isolation, worker recovery manager, merge coordinator, or exactly-once recovery.
- No baseline benchmark against stock OpenCode has yet been run. Performance or quality superiority is not claimed.
- Provider review can be unavailable; in that case the plan remains `needs_revision`.
- Provider and OpenCode tests use fake HTTP transports; live API/server compatibility still needs environment-backed integration tests.
- This is an engineering preview, not a production-ready autonomous development platform.

## Development

```bash
npm run check
npm test
```

CI workflow: `.github/workflows/ci.yml`.


## Planner quality benchmark

A six-scenario starter benchmark covers Greenfield, Existing Project, multi-component design, and ambiguous requirements. Read the [benchmark protocol](benchmarks/README.md), configure planning/reviewer providers, then explicitly opt in to live provider calls:

```bash
OIOL_BENCHMARK_ALLOW_LIVE=1 npm run benchmark:planner
```

The runner writes a JSON result and a blank human-review CSV under `benchmarks/results/` (ignored by Git). The automated rubric is a screening heuristic; certification still requires independent human review and repeated runs. No benchmark result or superiority claim is made until the live suite has actually been run.

## License

MIT
