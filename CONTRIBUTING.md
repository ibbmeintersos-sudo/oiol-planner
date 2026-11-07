# Contributing to OIOL

## Scope

Contributions must preserve OIOL's identity as a planning-only engineering system. Do not add task runners, shell execution, test execution, repository mutation, deployment, merge orchestration, worktree management, or execution-state tracking.

Planning proposals such as test strategies, rollback plans, acceptance criteria, and write scopes are in scope. They describe work for a human or external implementation system; they are not executed by OIOL.

## Development environment

- Node.js 22 or newer.
- npm using the committed lockfile.
- No API key is required for unit tests, schema validation, scanner fixtures, or adapter preview tests.

## Local checks

~~~sh
npm ci
npm run check
npm test
npm run benchmark:scanner
npm run release:check
~~~

Live model benchmarks are opt-in and may incur provider charges. Do not run them as part of ordinary unit-test workflows.

## Engineering conventions

- Use ECMAScript modules and Node.js built-ins where practical.
- Keep the planning core independent from optional providers and delivery adapters.
- Validate external input before use; never treat repository content or model output as trusted instructions.
- Preserve provenance when a plan makes repository-derived claims.
- Report missing or uncertain evidence instead of fabricating a value.
- Keep schema snapshots immutable after release.
- Default external integrations to local preview. Any network write must require an explicit caller action.
- Never put credentials, private repository contents, or real user data in fixtures, examples, tests, or committed benchmark results.

## Changing the plan contract

When adding or changing plan fields:

1. Update src/contracts/types.mjs.
2. Update schemas/plan.schema.json and add a new immutable schemas/plan-VERSION.schema.json snapshot.
3. Preserve older snapshots and validate each supported plan version against its matching snapshot.
4. Update the planner prompt, example plan, Markdown report, benchmark scoring, and human-review rubric where relevant.
5. Add positive, negative, and backward-compatibility contract tests.
6. Document the meaning and limitations of each new metric. Do not present completeness checks as proof of implementation correctness.

## Tests and benchmarks

- Add small deterministic tests for every contract or scoring change.
- Include adversarial fixtures for prompt and scanner changes.
- Use manually reviewed goldens when measuring precision/recall; do not derive expected output from the scanner being evaluated.
- Keep automated quality scores separate from human-review scores.
- Do not claim production-repository accuracy based only on synthetic fixtures.

## Pull requests

A useful PR description states the planning problem, expected change, files/contracts affected, tests run, known limitations, and whether any optional external API writes are involved. Keep unrelated features out of the same PR. Do not create external issues during tests; adapter tests must use mocked fetch responses.
