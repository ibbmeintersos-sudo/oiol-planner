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
- No runtime npm dependencies in this preview.

## Quick start

    cp .env.example .env
    # Configure provider settings in .env
    npm test
    node src/cli.mjs --mode greenfield --name "Inventory Service" \
      --request "Design an inventory API with products, stock adjustments, and audit history" \
      --out plan.json

Existing repository:

    node src/cli.mjs --mode existing --repo /path/to/repository \
      --request "Plan role-based access control without breaking existing API behavior" \
      --format md --out engineering-plan.md

Supported providers:

| Provider | OIOL_PROVIDER | Notes |
|---|---|---|
| OpenAI-compatible | openai-compatible | Default; configurable base URL |
| Anthropic | anthropic | Messages API |
| Google Gemini | gemini | generateContent API |
| Ollama | ollama | Local /api/chat endpoint |

Configuration is read from .env when supported by the Node runtime, or from shell environment variables. For a distinct reviewer configuration, configure OIOL_REVIEW_PROVIDER and optional reviewer model, base URL, API key, and timeout variables. A critique using the same provider configuration cannot certify readiness. A distinct reviewer approval can move a structurally valid plan to ready_for_review; this means ready for human review, not implementation authorization or evidence of implementation.

## Plan contract and validation

The published JSON Schema is schemas/plan.schema.json (JSON Schema Draft 2020-12). A complete example is available at examples/plan.v1.json. Every newly generated plan declares schemaVersion: "1.0.0".

Validate an existing plan without calling a model:

    node src/cli.mjs --validate plan.json

Produce a review report from an existing plan:

    node src/cli.mjs --validate plan.json --format md --out engineering-plan.md

Both HybridPlanner and the CLI validate the current published plan schema; the CLI also applies OIOL's additional semantic checks for requirement coverage, unique IDs, task/component references, safe relative write-scope syntax, dependency graph consistency, cycles, and unresolved blocking clarifications. The built-in schema checker intentionally supports the keywords used by the published contract; it is not a general-purpose Draft 2020-12 implementation. External consumers should use a standards-compliant Draft 2020-12 validator against schemas/plan.schema.json.

## Human-readable report

Use --format md when generating a plan, or combine --validate with --format md to render an existing JSON plan. The report includes executive summary, requirements, architecture, task table, dependencies, scopes, acceptance criteria, suggested planning waves, risks, open clarifications, requirement traceability, and validation findings.

The report explicitly distinguishes planned work from completed or verified work. It also surfaces non-blocking quality review signals—such as missing task descriptions, weakly specified architecture decisions, and risks without mitigations—without disguising them as a definitive quality score.

## Existing repository analysis

The scanner collects Git branch/commit/dirty state, bounded file candidates, manifests, scripts, test/config paths, and bounded source context. Each included excerpt has a stable evidence ID, a SHA-256 fingerprint of the original file, and a separate SHA-256 fingerprint of the redacted excerpt; the same evidence ID and fingerprints are propagated into the analyzer's evidence records and the context so planner citations resolve to the exact excerpt supplied. It skips common dependency/build/cache folders, does not follow symlinks, avoids likely secret files, and applies heuristic redaction. It does not run project scripts, tests, builds, hooks, or arbitrary repository code.

File/import mapping is heuristic in this version. OIOL does not yet provide a complete AST-based symbol index or semantic dependency graph. Repository claims should be grounded in scanner evidence; absence from the bounded scan is not proof that a file, dependency, or behavior does not exist.

Repository text is untrusted input. Prompt-injection patterns and secret redaction require further hardening; neither should be treated as a security boundary.

## Planning quality benchmark

The ten-scenario benchmark covers Greenfield, Existing Project, multi-component architecture, and ambiguous requirements. Read benchmarks/README.md.

List scenarios or validate a selection without provider calls:

    npm run benchmark:planner -- --list
    npm run benchmark:planner -- --scenarios GF-API-001,EX-API-003 --dry-run

Live planning benchmark calls can incur provider charges and require explicit opt-in:

    OIOL_BENCHMARK_ALLOW_LIVE=1 npm run benchmark:planner

The automated rubric is a screening heuristic, not proof of planning quality. The benchmark protocol requires repeated runs, blinded human review, and transparent reporting. Filled review sheets can be combined with npm run benchmark:human-review; the gate requires two reviewers per scenario, documented evidence, adjudication of large disagreements, and no critical findings. No live provider quality score or superiority claim is made until those experiments have actually been completed.

An OpenCode planning-only baseline adapter and paired comparison scripts are available for evaluation. They are benchmark tooling, not OIOL execution features. Configure the receiving OpenCode plan agent with read-only permissions; the adapter's diff check is not a sandbox.

## Development

    npm run check
    npm test

CI tests Node.js 22 and 24.

## Current limitations

- No live provider benchmark or blinded human evaluation has been completed.
- The starter benchmark contains ten scenarios and compact synthetic repository fixtures; it is not statistically representative.
- Automated concept matching is lexical and can miss valid paraphrases or reward superficial keyword inclusion.
- The repository scanner is bounded and heuristic, not AST- or symbol-aware.
- Prompt-injection isolation, provenance, and secret redaction need stronger evidence and tests.
- Provider-reported usage may be available, but pricing is not estimated.

## License

MIT
