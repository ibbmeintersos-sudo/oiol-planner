# Benchmark protocol

No performance or quality benchmark is claimed for this preview. For a fair comparison against a baseline workflow, run the same task set through baseline OpenCode and OpenCode + OIOL, with identical model/provider, tool permissions, repository snapshot, and time/token budgets.

Record per task: requirement coverage, acceptance-criteria pass rate, invalid dependency count, rework count, changed-file scope, test outcome, elapsed time, token/cost estimate, and human review score. Use multiple runs and report median plus spread. Do not combine these dimensions into a single score without publishing the weighting.


See [PLANNER_QUALITY_GATE.md](./PLANNER_QUALITY_GATE.md) for the release certification protocol, minimum benchmark set, independent scoring rubric, and pass thresholds. The deterministic quality regression tests live in `test/planner-quality.test.mjs`; they are structural safeguards, not a substitute for real-provider and human-reviewed benchmark runs.
