# OIOL Architecture

## Product boundary

OIOL is an **intelligent engineering planning system**. Its primary output is a versioned, reviewable engineering plan that a human or an external implementation tool may consume.

OIOL does not execute planned tasks. It does not run repository scripts, install project dependencies, modify project files, execute tests, apply migrations, deploy services, merge code, or maintain execution state. A test strategy or rollback plan inside an OIOL plan is a proposal for the downstream implementer, not evidence that the action has occurred.

The optional GitHub Issues and Linear adapters publish task descriptions as planning tickets only. They do not perform the task described by a ticket.

## Main data flow

~~~mermaid
flowchart TD
  U[Trusted user request] --> A[Project analyzer]
  A -->|greenfield| P[Project context]
  A -->|existing project| S[Bounded read-only scanner]
  S --> E[Repository evidence with provenance]
  E --> P
  P --> I[Structured planner input envelope]
  I --> H[Hybrid planner]
  H --> L[Configured planning model]
  H --> R[Configured reviewer model]
  L --> N[Plan normalization]
  R --> N
  N --> V[Semantic and versioned schema validation]
  V --> Q[Deterministic quality assessment]
  Q --> O[Plan JSON and Markdown report]
  O --> G[Optional GitHub Issues adapter]
  O --> T[Optional Linear adapter]
~~~

## Component responsibilities

### Analyzer and scanner

- Greenfield analysis packages the user's requirements and constraints.
- Existing-project analysis performs a bounded, read-only inventory of files and manifests.
- The scanner records file-selection limits, parser mode, syntax diagnostics, evidence IDs, and source/excerpt fingerprints.
- Tree-sitter is an optional parser dependency. When it or a language grammar is unavailable, bounded lexical analysis remains available.
- Scanner output is evidence, not a complete semantic model. It does not perform type checking or establish runtime behavior.
- For existing-project requests, Change Impact Analysis matches request terms to bounded paths/symbols, walks reverse import edges and workspace dependency edges, and links likely affected tests. It emits an evidence-backed estimate with confidence and coverage penalties; it does not run tests or modify project files.

### Prompt and trust boundary

The planner receives a structured JSON envelope that separates:

1. trusted user request and constraints;
2. untrusted repository payload and scanner evidence;
3. prior model output and diagnostics supplied during repair/review.

Repository files, comments, manifests, issue templates, and generated content are data, never higher-priority instructions. JSON encoding and prompt rules are defense-in-depth, not a model-isolation guarantee.

Change-impact output is included as untrusted deterministic analysis evidence. The planner must distinguish direct matches from reverse-dependency estimates, respect reported coverage gaps, and never interpret an affected-test suggestion as a test result.

### Hybrid planner

The planner requests a JSON plan, applies deterministic semantic and schema validation, and may ask the configured planner/reviewer models to revise or critique it. A model review is not human approval. Provider identity, validation outcomes, and review findings are recorded separately from the plan content.

### Contract and evaluation

- The current portable plan contract is in schemas/plan.schema.json.
- Immutable snapshots under schemas/ let validators select the schema version declared by a plan.
- validatePlan checks planning invariants such as requirement-to-task coverage and dependency graph consistency.
- evaluatePlanQuality reports measurable completeness signals for NFRs, tests, rollback, unknowns, assumptions, and risk estimates. These metrics do not prove future implementation quality.

### Reporting and handoff

JSON is the canonical artifact. Markdown is a human-readable view of that plan. GitHub Issues and Linear adapters map one plan task to one external issue. Preview generation is local and side-effect free. External publishing happens only when explicitly requested.

## Data contracts

- Plans declare schemaVersion and contractVersion.
- The 1.1.0 schema adds optional quality-evidence fields while preserving the immutable 1.0.0 schema.
- Task dependencies describe planning order; named task inputs/outputs describe artifact interfaces.
- writeScope, acceptance criteria, verification proposals, test strategy, and rollback plans are descriptions for a downstream implementer, not execution controls.

## Failure and uncertainty

- An unsupported schema version fails closed.
- Missing scanner evidence is not proof that a file, dependency, or behavior does not exist.
- An unresolved blocking clarification makes a plan invalid for handoff.
- Missing quality-evidence fields lower completeness metrics; OIOL must not invent values to make a plan score better.
- Adapter publishing can partially complete if a remote API rejects a later issue. Errors include the already-created issue references where available. Review those references before retrying to avoid duplicates.

## Key directories

| Path | Responsibility |
|---|---|
| src/analyzer/ | Build project context |
| src/scanner/ | Bounded repository inventory and static analysis |
| src/core/ | Prompt contracts, planning, validation, evaluation, reporting |
| src/contracts/ | Plan and schema version constants |
| src/providers/ | Provider-specific JSON request clients |
| src/adapters/ | Optional external issue handoff |
| schemas/ | Current and immutable plan schema snapshots |
| benchmarks/ | Scenario catalog, fixtures, scoring, and result protocols |
| test/ | Contract, regression, and adapter tests |

## Dependency policy

The planning core uses Node.js built-ins and optional provider/parser integrations. The GitHub Issues and Linear adapters use the platform fetch API; they do not add mandatory SDK dependencies. Keep integrations isolated so core plan generation and validation continue to work without adapter credentials or network access.
