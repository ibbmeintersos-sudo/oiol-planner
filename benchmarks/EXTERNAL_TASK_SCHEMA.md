# External repository task definition

External repository benchmark runs require one task-definition JSON file. The same file must be supplied to the OIOL and OpenCode runs. The runner hashes the exact UTF-8 file bytes with SHA-256 and records the task ID, version, and hash. Paired comparison rejects different task hashes; repeated-run aggregation includes the hash in its configuration fingerprint.

## Contract

```json
{
  "scenarioId": "EX-API-003",
  "taskId": "RW-REPO-CHANGE-001",
  "taskVersion": "1.0.0",
  "projectName": "Project name",
  "request": "A concrete engineering planning request grounded in this repository.",
  "evidencePaths": [
    "src/path/to/relevant-implementation.ts",
    "tests/path/to/relevant-test.ts"
  ],
  "constraints": [
    "Preserve existing public behavior unless explicitly requested",
    "Do not invent architecture or runtime behavior not supported by evidence",
    "Identify unknowns and evidence gaps"
  ],
  "expectedSignals": [
    ["actual concept", "accepted paraphrase"],
    ["second required concept", "accepted paraphrase"]
  ],
  "mustClarify": false,
  "clarificationSignals": []
}
```

## Field rules

- `scenarioId`: one Existing Project scenario ID from the catalog: `EX-API-003`, `EX-MONOLITH-004`, or `EX-SEC-009`. Exactly one scenario is selected when using a task file.
- `taskId` and `taskVersion`: stable identifiers. Increment the version whenever the request, constraints, expected signals, or clarification rubric changes.
- `projectName` and `request`: non-empty strings. The request must be specific to the repository and the task being evaluated.
- `evidencePaths`: non-empty array of safe, repository-relative paths that must be supplied as redacted excerpts to both planners. The scanner prioritizes these paths before general source selection. The run is rejected if any requested path is absent, oversized, sensitive, or omitted by the context limit. Use forward slashes and never include absolute paths or `..` segments.
- `constraints`: array of explicit constraints. Do not copy untrusted repository text into this file as instructions.
- `expectedSignals`: non-empty array of non-empty string groups. Each group represents one concept; any string in the group is accepted by the current lexical screen. Keep concepts meaningful and avoid easy keyword stuffing.
- `mustClarify`: boolean. Set true only when a blocking decision is genuinely unresolved.
- `clarificationSignals`: for `mustClarify: true`, a non-empty array of string groups describing the required clarification areas.

The task-specific evidence path list is included in the task hash and comparison record. Both OIOL and OpenCode must receive the same excerpt set and source fingerprints.

The current automated scorer is lexical and only a screening layer. It cannot determine whether a task-specific plan is technically correct. Include a separate human-review rubric with concrete repository evidence and acceptance criteria in your benchmark record.

## Reproducibility and safety

Use the same task file for both modes and all repetitions. The SHA-256 hash, task ID, and task version are emitted in result artifacts. Keep the task file in version control alongside sanitized benchmark materials where possible. Do not put credentials, private issue content, personal data, or raw source excerpts in the task file.

External runs require a clean local Git checkout and record its commit SHA. OIOL's scanner reads repository files and Git metadata only; it does not run project commands, tests, builds, or modify the checkout.
