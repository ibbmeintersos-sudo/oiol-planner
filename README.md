# OIOL — Intelligent Engineering Planning System

OIOL turns a software goal into a reviewable, structured engineering plan. Its product is the plan: requirement understanding, repository analysis, architecture, task decomposition, dependencies, acceptance criteria, risk analysis, and traceability.

**OIOL is a planning system. It does not implement tasks, run project commands, modify the target repository, verify completed implementation, or manage execution state.** The generated plan is handed to a human or an external implementation tool such as OpenCode.

## What OIOL produces

- Structured requirements, priorities, assumptions, unknowns, and clarifying questions.
- Existing-repository context based on bounded, read-only scanning.
- Architecture components, design decisions, alternatives, and rationale.
- Small, scoped tasks with requirement/component links and explicit dependencies. Dependencies express ordering; consumed artifacts are declared separately through named task inputs and outputs.
- Acceptance criteria that describe observable outcomes.
- A dependency graph and suggested planning waves.
- Risks, constraints, evidence references, and requirement-to-task traceability.
- Deterministic structural validation and a portable JSON contract.
- A human-readable Markdown engineering-plan report.

## Product boundary

| OIOL responsibility | Outside OIOL |
|---|---|
| Understand and analyze the request | Implementing source-code changes |
| Inspect repository structure and selected evidence read-only | Running tests, builds, scripts, or shell commands |
| Design and justify architecture | Applying migrations or deployments |
| Decompose work and define dependencies | Scheduling or executing implementation tasks |
| Define acceptance criteria and planned test strategy | Claiming tests passed or work was verified |
| Validate plan structure and internal consistency | Managing worktrees, commits, merges, retries, or recovery |
| Export a handoff artifact | Controlling the receiving implementation tool |

A task's write scope, dependencies, outputs, and acceptance criteria are planning interfaces. They describe intended work for the recipient; they are not execution permissions or enforcement mechanisms inside OIOL.

## Requirements

- Node.js 22 or newer.
- An LLM provider endpoint for plan generation. Ollama can be used locally.
- An optional pinned AST dependency: `@xberg-io/tree-sitter-language-pack-wasm` 1.25.0. When installed, the scanner uses bundled Tree-sitter grammars where available. If the package or a grammar is unavailable, bounded lexical analysis remains available; no parser grammar is downloaded at scan time.

## Quick start

Install the package or run it directly with npx:

    npx oiol-planner init
    # Add your provider API key to .env
    npx oiol-planner doctor

    npx oiol-planner plan --mode greenfield --name "Inventory Service" \
      --request "Design an inventory API with products, stock adjustments, and audit history" \
      --out plan.json

Existing repository:

    npx oiol-planner plan --mode existing --repo /path/to/repository \
      --request "Plan role-based access control without breaking existing API behavior" \
      --format md --out engineering-plan.md

\`oiol init\` writes \`oiol.config.json\` without secrets and creates a \`.env\` template for the API key. Configuration precedence is: existing environment variables, then the selected profile, then built-in defaults. Use \`--config <path>\` (or \`OIOL_CONFIG\`) to select a different config file and \`--profile <name>\` to select a profile. The legacy \`node src/cli.mjs ...\` form remains supported.

Supported providers:

| Provider | OIOL_PROVIDER | Notes |
|---|---|---|
| OpenAI-compatible | openai-compatible | Default; configurable base URL |
| Anthropic | anthropic | Messages API |
| Google Gemini | gemini | generateContent API |
| Ollama | ollama | Local /api/chat endpoint |

Configuration is read from .env when supported by the Node runtime, or from shell environment variables. For a distinct reviewer configuration, configure OIOL_REVIEW_PROVIDER and optional reviewer model, base URL, API key, and timeout variables. A critique using the same provider configuration cannot certify readiness. A distinct reviewer approval can move a structurally valid plan to ready_for_review; this means ready for human review, not implementation authorization or evidence of implementation.
## GitHub Action

OIOL can review pull requests as a planning-only GitHub Action. It scans the repository, generates a plan, uploads `plan.json` and `plan.md` as artifacts, and optionally posts a short summary comment. It does not run the target project's tests, builds, or scripts.

Copy [`examples/github-actions/oiol-review.yml`](examples/github-actions/oiol-review.yml) to `.github/workflows/`, add an `OIOL_API_KEY` repository secret, and adjust the planning request. See [`docs/GITHUB_ACTION.md`](docs/GITHUB_ACTION.md) for inputs, permissions, and the security model. Never use `pull_request_target` with a checkout of pull request code.

### Self-review workflows

Two dispatch-only workflows exercise the action without leaving the repository:

- `.github/workflows/oiol-self-review.yml` uses an OpenAI-compatible endpoint, defaults to OpenRouter (`openai/gpt-4o-mini` planner, `anthropic/claude-3.5-haiku` reviewer), and requires the `OIOL_API_KEY` secret.
- `.github/workflows/oiol-self-review-ollama.yml` runs locally with Ollama and accepts planner and reviewer model inputs.

Both end with a plan quality gate that reads `oiol-plan/plan.json` and fails the job when the plan is missing, its `status` is `blocked`, or `validation.valid` is not `true`. The gate prints `status`, `validation.valid`, `evaluation.metrics`, and `evaluation.qualityDiagnostics` to the job summary, so a green run means the plan passed the measured gate, not only that the step executed.

## HTML review report

Render an existing plan as a self-contained, print-ready HTML report:

    npx oiol-planner report plan.json --out plan.html
    npx oiol-planner report plan.json --format md
    npx oiol-planner report plan.json --format json

The HTML output is a single file with inline CSS, no scripts, and no external assets. It includes validation findings, non-blocking quality signals, requirements, architecture, tasks, planning waves, handoff interfaces, traceability, risks, and open questions. Every plan value is HTML-escaped.

`report` performs local deterministic validation only and makes no provider calls. The exit code is `2` when the plan is invalid, but the report is still written so the findings can be reviewed.

## Configuration file

\`oiol.config.json\` is optional; OIOL also works with environment variables only. Profiles keep provider settings in one place:

    {
      "$schema": "https://raw.githubusercontent.com/ibbmeintersos-sudo/oiol-planner/main/schemas/oiol-config.schema.json",
      "version": 1,
      "defaultProfile": "default",
      "profiles": {
        "default": {
          "provider": "openai-compatible",
          "model": "gpt-4o-mini",
          "baseUrl": "https://api.openai.com/v1",
          "apiKeyEnv": "OIOL_API_KEY",
          "timeoutMs": 60000,
          "maxRetries": 2
        }
      }
    }

Never put an API key in \`oiol.config.json\`; \`apiKeyEnv\` names the environment variable that holds it.

## Plan contract and validation

The published JSON Schema is schemas/plan.schema.json (JSON Schema Draft 2020-12). A complete example is available at examples/plan.v1.json. New plans declare `schemaVersion: "1.1.0"` and `contractVersion: "1.1"`; plans at `1.0.0` remain validated against their frozen schema snapshot. The built-in validator supports a documented keyword subset; exact semantics, unsupported keywords, and the migration policy are in `schemas/README.md`.

Validate an existing plan without calling a model:

    npx oiol-planner validate plan.json

Produce a review report from an existing plan:

    npx oiol-planner validate plan.json --format md --out engineering-plan.md

Both HybridPlanner and the CLI validate the current published plan schema; the CLI also applies OIOL's additional semantic checks for requirement coverage, unique IDs, task/component references, safe relative write-scope syntax, dependency graph consistency, cycles, and unresolved blocking clarifications. The built-in schema checker intentionally supports the keywords used by the published contract; it is not a general-purpose Draft 2020-12 implementation. External consumers should use a standards-compliant Draft 2020-12 validator against schemas/plan.schema.json.

## Human-readable report

Use --format md when generating a plan, or combine --validate with --format md to render an existing JSON plan. The report includes executive summary, requirements, architecture, task table, dependencies, scopes, acceptance criteria, suggested planning waves, risks, open clarifications, requirement traceability, and validation findings.

The report explicitly distinguishes planned work from completed or verified work. It also surfaces non-blocking quality review signals—such as missing task descriptions, weakly specified architecture decisions, and risks without mitigations—without disguising them as a definitive quality score.

## Existing repository analysis

The scanner collects Git branch/commit/dirty state, bounded file candidates, manifests, scripts, test/config paths, and bounded source context. The structural scan now has a separate budget from the prompt-context budget: when maxContextChars is reached, the scanner continues analyzing the selected source files and reports which excerpts could not be added to model context. Source selection is bounded by maxFiles, maxDepth, maxFileBytes, and maxSourceFiles (default 100); test/config excerpts do not bypass the source-analysis cap. TypeScript path mapping files accept JSONC comments and trailing commas. Coverage counts report discovered, included, selected, read, and omitted files. Each read excerpt has a stable evidence ID, a SHA-256 fingerprint of the original file, and a separate SHA-256 fingerprint of the redacted excerpt. Symbol and import findings carry the evidence ID and fingerprints for their source file. The structural pass uses Tree-sitter concrete syntax trees when the optional WebAssembly language-pack dependency is installed and a bundled grammar is available; bounded lexical fallback remains available with analysisMode: lexical. It records parser-recovery diagnostics, resolves supported relative imports and direct tsconfig.json/jsconfig.json path mappings, and reports inherited path configuration that it did not load. It also inventories declared npm-style workspaces, package-manager signals, and manifest-declared dependencies between workspace packages. Workspace edges and path aliases are configuration evidence, not proof of runtime dependency use. The scanner reports framework signals, entry points, route-like files, test-like files, and AST/lexical coverage. Every structural result is marked as untrusted repository-derived metadata. It skips common dependency/build/cache folders, does not follow symlinks, avoids likely secret files, and applies heuristic redaction. It does not run project scripts, tests, builds, hooks, or arbitrary repository code.

Tree-sitter produces concrete syntax trees, not type checking, complete symbol resolution, or proof of runtime behavior. The bundled WASM grammar set is curated; unsupported languages use lexical fallback. Direct tsconfig.json/jsconfig.json path mappings are resolved only when both the config and target file are inside the bounded scan; inherited configurations are reported but not loaded. Workspace package edges are derived from declared package manifests and workspace patterns, and do not prove runtime use. Package-manager resolution, package exports, dynamic imports, generated code, reflection, and runtime dependency injection may remain unresolved. Parser errors are retained as diagnostics rather than treated as proof that the whole file is unusable. Coverage counts distinguish source files discovered, selected, read, and parsed by AST. Repository claims should be grounded in scanner evidence; absence from the bounded scan is not proof that a file, dependency, or behavior does not exist.

Repository content is passed to the planner in a structured JSON input envelope that separates trusted user requests from explicitly labeled untrusted repository payloads. Planner and reviewer instructions treat repository fields and prior generated plans as data, not instructions. This is defense in depth, not a guaranteed isolation boundary: model behavior can still be influenced by adversarial content, so repository evidence remains untrusted and requires human review. Secret redaction is heuristic and must not be treated as a security boundary.

## Change Impact Analysis

For existing-project requests, OIOL runs a deterministic, read-only impact estimate over the bounded Scanner evidence before planning. It identifies direct candidate files by matching request terms against file paths and extracted symbol names, then follows reverse import edges to identify likely dependents. It also follows declared workspace dependency edges in reverse to identify consumer packages and associates test files with impacted source through resolved imports. When only test-path naming overlap exists, the relationship is marked lower confidence.

The result distinguishes direct matches from transitive files, affected workspace packages, and potentially affected tests. It includes evidence IDs, matched terms, dependency depth, an overall confidence estimate, and explicit penalties/risks for scan truncation, omitted files, parser issues, unresolved imports, and result limits. The natural-language matching is intentionally deterministic and bounded; it does not use an LLM to invent dependency edges.

**Interpretation:** this is a planning aid, not a complete semantic or runtime impact proof. It can miss dynamic imports, reflection, generated code, dependency injection, conditional paths, and relationships outside the bounded scan. A missing match does not establish zero impact. Listed tests are candidates for the downstream implementer to consider; OIOL does not execute or verify them. OIOL does not alter target files or run project commands.

## Planning quality benchmark

The ten-scenario benchmark covers Greenfield, Existing Project, multi-component architecture, and ambiguous requirements. Read benchmarks/README.md.

List scenarios or validate a selection without provider calls:

    npm run benchmark:planner -- --list
    npm run benchmark:planner -- --scenarios GF-API-001,EX-API-003 --dry-run

Live planning benchmark calls can incur provider charges and require explicit opt-in:

    OIOL_BENCHMARK_ALLOW_LIVE=1 npm run benchmark:planner

Run a full repeated 3 × 10-scenario series and create blinded review packets:

    OIOL_BENCHMARK_ALLOW_LIVE=1 npm run benchmark:series -- --runs 3 --out-dir benchmarks/results/series-2026-11-07

The series writes raw runs, aggregate medians/min/max/spread, one sanitized review-plan file per scenario/run (provider and automatic-review metadata removed), and a consolidated CSV with two reviewer slots per plan. Every one of the 30 plans requires two independent blind human reviews (60 completed rows). Reviewers fill separate slots in the same sheet, use distinct reviewer IDs, and cite plan evidence. Human review remains pending until actual reviewers complete the rows; the runner does not invent scores.

The automated rubric is a screening heuristic, not proof of planning quality. The benchmark protocol requires repeated runs, blinded human review, and transparent reporting. Filled consolidated review sheets can be combined with `npm run benchmark:human-review`; the gate requires two distinct reviewers per scenario/run plan, documented evidence, adjudication of large disagreements, and no high or critical findings. No live provider quality score or superiority claim is made until those experiments have actually been completed. Run `npm run benchmark:scanner` to measure function-symbol and import precision/recall against manually reviewed fixture goldens in both `auto` and `lexical` modes.

An OpenCode planning-only baseline adapter and paired comparison scripts are available for evaluation. They are benchmark tooling, not OIOL execution features. Configure the receiving OpenCode plan agent with read-only permissions; the adapter's diff check is not a sandbox.

## Development

    npm run check
    npm test

CI tests Node.js 22 and 24.

## Current limitations

- Live provider results and blinded human evaluation are not committed by default; use the opt-in repeated benchmark and retain its raw outputs and completed review aggregate.
- The starter benchmark contains ten scenarios and compact synthetic repository fixtures; it is not statistically representative.
- Automated concept matching is lexical and can miss valid paraphrases or reward superficial keyword inclusion.
- Repository analysis is bounded and uses optional Tree-sitter AST where a bundled grammar is available, with lexical fallback elsewhere. `npm run benchmark:scanner` reports precision/recall on compact manually reviewed fixtures; these measurements do not establish production-repository accuracy or a complete semantic dependency graph.
- Prompt-injection handling uses structured trusted/untrusted input fields and explicit system instructions, but is not a model isolation guarantee; provenance and heuristic redaction still require adversarial evaluation.
- Provider-reported usage may be available, but pricing is not estimated.

## License

MIT


## Plan quality evidence (schema 1.1.0)

OIOL reports measurable quality evidence for non-functional requirements, test-strategy completeness, rollback-plan completeness, explicit unknown review, assumption validation, and risk estimation. These deterministic completeness metrics are not proof that future implementation will pass tests or meet production targets. A plan can mark rollback as not applicable only with a rationale.

## Optional delivery adapters

The GitHub Issues and Linear adapters sit outside the planning core. They can produce a local JSON preview without network access. Publishing is a separate explicit CLI action using a user-supplied token; neither adapter runs code, changes repository files, or marks a planned task as complete.


### Create external planning tickets

Preview planned tasks as local JSON; neither command makes a network request by default:

~~~sh
node src/cli.mjs --export github-issues --input plan.json --owner OWNER --repo REPO --out issues-preview.json
node src/cli.mjs --export linear --input plan.json --team-id TEAM_UUID --out linear-preview.json
~~~

Review the preview and destination before publishing. External writes require the additional `--publish` flag and credentials supplied through environment variables (GitHub: `OIOL_GITHUB_TOKEN` or `GITHUB_TOKEN`; Linear: `LINEAR_API_KEY`, optionally `LINEAR_AUTH_MODE=oauth`). These adapters create issue descriptions only. They do not implement tasks or track completion.


## Independent Change Impact benchmark

The deterministic Change Impact Analyzer has a separate offline regression benchmark at `npm run benchmark:change-impact`. It measures direct-file, reverse-dependency, test-association, workspace-package, and API-consumer predictions against manually curated synthetic goldens using precision, recall, and F1. It is deliberately separate from the LLM engineering-plan quality score: these are distinct capabilities and must not be combined into one score.

The benchmark does not call an LLM provider and does not run any target-project commands. Its synthetic graph cases measure algorithm behavior against authored expected sets; they do not establish semantic or runtime completeness. See [benchmarks/README.md](benchmarks/README.md) for the protocol, limitations, and expansion requirements.


## P12 real-world benchmark intake

P12 adds a separate corpus protocol, pinned-snapshot fingerprinting, independent annotation requirements, and an offline runner for Scanner + Change Impact evaluation. The initial corpus manifest is deliberately empty: **no real-world accuracy result is claimed yet**. See [the corpus protocol](benchmarks/real-world/README.md).

Validate a locally curated corpus:

    npm run benchmark:real-world:validate -- --corpus-root /absolute/path/to/corpus

The worklist is distributed as 72 blinded packets under `benchmarks/real-world/reviews/<case-id>/`, two per case (`R1.json`, `R2.json`), with `benchmarks/real-world/review-assignments.json` recording case and snapshot provenance. Packet skeletons are intentionally incomplete and fail the review schema until independent reviewers attest them.

Freeze completed reviews before any benchmark run:

    npm run benchmark:real-world:freeze

The freeze command exits non-zero until all 72 reviews are valid and writes a hash-only `benchmarks/real-world/review-freeze.json`; ground-truth content is not published before adjudication.

Run the benchmark after at least two independent reviews have been frozen for every case:

    npm run benchmark:real-world -- --corpus-root /absolute/path/to/corpus --out benchmarks/results/real-world-benchmark.json

The runner performs bounded filesystem scanning only. It does not invoke Git, package managers, scripts, builds, tests, migrations, or application code in target snapshots. OIOL's own tests remain runnable in CI.
