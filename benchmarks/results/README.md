# Benchmark result artifacts

This directory is reserved for reproducible benchmark outputs.

- \`run-*.json\`: one live OIOL run containing the plans, provider metadata, timings, deterministic scores, and blockers for the selected scenarios.
- \`run-*-human-review.csv\`: one review row per scenario/run; two independent reviewers must complete each plan row.
- \`repeat-aggregate.json\`: medians, min/max, spread, run coverage, and automated failures across at least three same-configuration runs.
- \`human-review-all-runs.csv\`: consolidated review sheet for every plan in a repeated series.
- \`human-review-aggregate.json\`: human-entered scores, reviewer coverage, disagreements, and certification decision.
- \`scanner-accuracy.json\`: precision/recall/F1 against the checked-in, manually reviewed scanner goldens.

Live planning benchmarks may incur provider charges. Do not commit credentials or results containing private repository contents. A series is not human-certified until two reviewers complete each scenario/run row and the review aggregator passes.
