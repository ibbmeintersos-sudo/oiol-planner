# P13 — Scanner precision investigation

## Question

The P12 corpus (36 frozen cases, two blinded AI review slots, intersection and union adjudication) showed that the scanner over-reports four dimensions by orders of magnitude: `scannerSymbols` precision 0.004, `dependencyEdges` precision 0.1346, `directFiles` precision 0.0182, `affectedFiles` precision 0.0614. P13 asks why, and measures what happens when the causes are fixed. It adds no user-facing feature and no execution capability: OIOL remains a planning and analysis tool.

## Method

- The P12 corpus, the annotations and the adjudication are frozen. No ground-truth file was edited and no case was added or removed.
- Gate-0: `scripts/diagnose-real-world-precision.mjs` re-scores the current `main` code against the frozen corpora and diffs every dimension against the committed P12 table. Before any fix the diff was zero on all nine dimensions, which proves environment parity and makes later deltas attributable to the fixes.
- The same script emits per-case, item-level diagnostics: false-positive symbols by kind and parser source, false-positive edges by resolution kind, direct-match scores and matched-term counts, impacted-file depths, and test links by association and overlap size.
- Every fix is its own commit on `p13/scanner-precision`, passes the five required CI checks, and is measured by one diagnostics run over all 36 cases.
- `scripts/compare-real-world-scores.mjs` classifies each dimension: a regression is an F1 drop greater than 0.005 or both precision and recall falling; an improvement is an F1 gain greater than 0.005 with no other dimension regressing.

## Measured causes

| Dimension | Cause | Evidence |
| --- | --- | --- |
| `scannerSymbols` | The scanner reports a repository inventory, not a change surface: every declaration in the analyzed files. | nestjs case: 1,054 symbols against 1–3 expected; `variable` kind alone 520; pydantic 939; laravel 907. |
| `scannerSymbols` | Kind vocabulary gap: no `field`, `property`, `enum constant`, or config pseudo-symbol is ever emitted. | 10 ground-truth symbols are structurally unmatchable. |
| `dependencyEdges` | The scanner reports the whole resolved import graph while ground truth lists the 1–3 change-relevant edges. | nestjs 218 false positives after resolution improved; ky 87. |
| `dependencyEdges` | Go imports resolve to an arbitrary package-representative file. | chi case: 55 edges, all `go-module-package-representative`, zero true positives. |
| `dependencyEdges` | TypeScript ESM `.js` specifiers were never remapped to their `.ts` sources, so such projects produced no edges at all. | ky emits 0 edges while ground truth expects 3; sources import `../errors/HTTPError.js`. |
| `directFiles` | The 0.08 score floor admitted import-specifier-only matches (0.10), and a 30-match cap emitted everything up to the cap. | chi: 30 matches, GT file walked but not matched; import-only matches across Go/TS cases. |
| `affectedFiles` | Depth-6 reverse reachability from up to 30 weak seeds over an inflated edge set. | Direct inflation propagates; go-chi and nestjs dominate the false positives. |
| `tests` | Any single shared path token linked a test file, every walked test file was considered, and the cap was 100. | pydantic: 100 linked tests, 50 of them with exactly one shared token. |

### Why precision barely moves on symbols and edges

`scoreSet` computes precision per case as `tp / (tp + fp)`. A case with `tp = 0` therefore scores precision 0 no matter how many false positives are removed, and the reported dimension value is the macro-average over the 36 cases. Pruning inventory can only help cases that already contain a true positive. This is a measurement ceiling, not a scanner defect, and it is why removing 520 variable symbols per TypeScript case moved symbol F1 by 0.002 while the same cap logic moved the file dimensions by a factor of two.

## Fixes and measured effect

Intersection corpus, 36 cases. Baseline = frozen P12.

| Fix | Dimension | Precision | Recall | F1 | Verdict |
| --- | --- | --- | --- | --- | --- |
| F1 `.js`→`.ts` ESM resolution | `dependencyEdges` | 0.1346 → 0.1359 | 0.5242 → 0.5798 | 0.1349 → 0.1375 | neutral (recall +0.0556) |
| F2 exported-only JS/TS variables | `scannerSymbols` | 0.0040 → 0.0052 | 0.5069 → 0.5069 | 0.0074 → 0.0095 | neutral (+30% relative precision) |
| F4 score floor and direct cap | `directFiles` | 0.0182 → 0.0514 | 0.4537 → 0.4259 | 0.0312 → 0.0662 | **improvement** (F1 ×2.1) |
| F5 depth and node caps | `affectedFiles` | 0.0614 → 0.1188 | 0.6944 → 0.7222 | 0.0656 → 0.1250 | **improvement** (F1 ×1.9) |
| F6 two-token overlap and test cap | `tests` | 0.1209 → 0.1243 | 0.4167 → 0.3611 | 0.1293 → 0.1328 | neutral |

### Exact parameters changed

- `analyzeChangeImpact` defaults: `maxDepth` 6 → 2, `maxImpactedFiles` 250 → 120, `maxDirectMatches` 30 → 12, `maxTests` 100 → 20.
- `buildFileFeatures` score floor: 0.08 → 0.12, so an import-specifier-only match no longer describes a change surface.
- `impactedTests` path-overlap branch: requires at least two shared tokens, and the capped result now keeps high-confidence links instead of the alphabetically first.
- `resolveLocalImport` and `resolveFileCandidate`: a `.js`/`.mjs`/`.cjs`/`.jsx` specifier that does not exist literally is retried as `.ts`, `.tsx`, `/index.ts`, `/index.tsx`.
- `classifySymbol`: a JavaScript/TypeScript `variable_declarator` becomes a symbol only when the declaration is exported.

## Known artifacts and limits

- `apiConsumers` shows a 0.0277 F1 drop. It is an artifact of the macro-average: 30 of 36 cases have no expected consumers and score a vacuous precision of 1; one case (`sindresorhus-883`) now resolves consumers where ground truth expects none. Absolute counts are 0 true positives, 2 false positives on that case.
- `databaseConsumers` and `migrationFiles` have no positive examples, so their 1.0 is vacuous and is not a strength.
- P13 was measured on the intersection corpus only; the union bounds remain those recorded by P12.
- Symbol and edge precision remain near zero because the scanner reports an inventory and ground truth reports a change. Fixing that would require redefining the scored quantity, which would break comparability with the frozen P12 baseline; it is recorded here as a finding instead of being applied silently.

## Reproducing

```bash
npm run benchmark:real-world:freeze
node scripts/adjudicate-independent-reviews.mjs --out .p12-corpus
python scripts/acquire-real-world-snapshot.py --case-index <n> --output acquired
node scripts/assemble-real-world-corpus.mjs --artifacts-root acquired --corpus-root .p12-corpus
node scripts/diagnose-real-world-precision.mjs --corpus-root .p12-corpus
node scripts/compare-real-world-scores.mjs --before benchmarks/real-world/adjudication/real-world-benchmark.json --after benchmarks/real-world/evaluation-diagnostics/baseline-comparison.json
```