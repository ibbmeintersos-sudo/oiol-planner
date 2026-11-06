# OIOL Planner

**OpenCode Intelligence & Optimization Layer — Planner preview v0.1.0**

OIOL Planner is a hybrid planning layer intended to sit above OpenCode. It turns a software request into a structured, reviewable execution plan. The LLM proposes requirements, architecture, tasks and risks; deterministic code validates references, requirement coverage, paths and dependency graphs.

> This is a planning component, not an autonomous coding agent. It does not execute project commands, modify repositories, create OpenCode workers, or claim that planned work has been implemented.

## Design principles

- Keep OpenCode Core untouched; integrate through a thin HTTP adapter.
- Support both greenfield and existing repositories.
- Use an LLM for understanding and planning, deterministic code for validation and scheduling.
- Treat repository content as untrusted context. Do not execute project scripts during scanning.
- No automatic plan approval. A review result of `approved` yields `ready_for_review`, not execution authorization.
- Preserve user changes and expose uncertainty rather than inventing repository facts.

## Requirements

- Node.js 20 or newer.
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

Configuration is read from `.env` when supported by the Node runtime, or from shell environment variables. Do not commit `.env`.

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

The scanner collects Git branch/commit/dirty state, tracked working-tree file candidates, manifests, scripts, test/config paths and a bounded source context. It skips common dependency/build/cache folders, does not follow symlinks, avoids likely secret files, and applies basic secret redaction. File/import mapping is intentionally heuristic in this preview; it is not a full AST or semantic index.

The scanner does **not** run package scripts, tests, build commands, hooks, or arbitrary code from the target repository.

## OpenCode adapter

`src/adapters/opencode/client.mjs` exposes small HTTP methods for health, session creation, session retrieval and prompting. It is deliberately thin and does not assume that experimental endpoints are stable. This preview does not yet orchestrate OpenCode subagents or worktrees.

## Validation and scheduling

The deterministic validator checks duplicate/missing IDs, task references, requirement coverage, acceptance criteria, unsafe write paths, unknown graph edges and cycles. The scheduler builds topological waves and conservatively serializes tasks whose write scopes overlap. It does not prove semantic independence of tasks.

## Security notes

- Never put credentials in project prompts or repository files.
- Repository text is untrusted input and may contain prompt injection.
- Redaction is heuristic and cannot guarantee removal of all secrets.
- Review all generated plans before execution.
- The planner does not modify the scanned repository.

## Current limitations

- No real provider request is included in the automated tests; provider integrations require live credentials and network access to validate end-to-end.
- OpenCode adapter is a minimal HTTP wrapper; no live OpenCode server test is included.
- No AST-based import graph, persistent event store, execution engine, worker manager, merge coordinator, or exactly-once recovery.
- No baseline benchmark against stock OpenCode has yet been run. Performance or quality superiority is not claimed.
- Provider review can be unavailable; in that case the plan remains `needs_revision`.
- This is an engineering preview, not a production-ready autonomous development platform.

## Development

```bash
npm test
npm run check
```

## License

MIT
