# OIOL Plan Schema Contract

## Current contract

- Current schema: `plan.schema.json`
- Current `schemaVersion`: `1.1.0`
- Current `contractVersion`: `1.1`
- Schema dialect: JSON Schema Draft 2020-12
- Immutable snapshots: `plan-1.0.0.schema.json`, `plan-1.1.0.schema.json`

The plan schema is a planning-artifact contract, not an execution-state contract. The 1.1.0 additions are optional, so 1.0.0 plans remain valid when validated against their own frozen schema.

## Built-in validator keyword support

The built-in validator is a deliberately bounded subset, not a complete Draft 2020-12 implementation.

| Keyword | Implemented behavior | Limitations |
|---|---|---|
| `$schema`, `$id`, `title`, `description` | Metadata accepted | No remote schema loading or dialect negotiation |
| `$defs`, `$ref` | Local definitions and JSON Pointer references | No remote refs, anchors, or dynamic refs |
| `type`, `required`, `properties` | Type and required-property validation | No dependent-required or pattern properties |
| `items`, `additionalProperties` | Item and extra-property validation | No tuple arrays or unevaluated-properties semantics |
| `const`, `enum` | Deep JSON equality | No coercion |
| `minLength`, `minItems`, `uniqueItems` | Basic string/array constraints | No max constraints or regex patterns |
| `oneOf`, `anyOf`, `not` | Boolean schema composition | Evaluates only the listed keyword subset |

Unknown keywords are rejected. Keywords such as `format`, `pattern`, `minimum`, `maximum`, `contains`, `if/then/else`, and `unevaluatedProperties` are not supported by the built-in validator.

## 1.1.0 quality fields

- `qualityAttribute` identifies a non-functional quality dimension; `measurement` records metric, target, unit, and method.
- `testStrategy` records the planned verification approach, levels, coverage, entry/exit criteria, and test-data approach.
- `rollbackPlan` records applicability or a reasoned non-applicability statement; applicable changes describe strategy, triggers, steps, verification, and data compatibility.
- `unknownsReviewed` distinguishes an explicitly reviewed empty unknowns list from an unreviewed omission.
- `unknowns` records impact, resolution approach, and whether each unknown blocks a decision.
- `assumptions` records confidence and how each assumption should be checked.
- Risks may carry integer `likelihood` and `impact` estimates from 1 to 5. OIOL derives exposure as likelihood × impact; the model must not invent an exposure score.

These sections are optional in the schema to preserve backward compatibility. Quality evaluation reports missing or incomplete evidence; it does not claim that an absent section proves the corresponding concern is irrelevant.

## Version and migration policy

1. Patch version: validator or documentation corrections that do not intentionally alter the data contract.
2. Minor version: backward-compatible optional fields or metadata. Publish a new immutable snapshot and retain all older snapshots.
3. Major version: breaking structure or meaning changes. Publish a migration guide and explicit conversion procedure; do not silently reinterpret older plans.
4. Validate a plan using the snapshot matching its declared `schemaVersion`. Unsupported versions fail closed.
5. The current `plan.schema.json` is a convenience copy of the current immutable snapshot.
6. `schemaVersion` and package version are independent; implementation releases do not automatically require a schema bump.

## Change checklist

Update `src/contracts/types.mjs`, `plan.schema.json`, a new immutable snapshot, examples, prompt instructions, contract tests, and this document in one change. Never edit a released versioned snapshot.


## Risk estimate calibration

Likelihood and impact are ordinal planning scales, not statistical probabilities.

| Score | Likelihood anchor | Impact anchor |
|---:|---|---|
| 1 | Rare: exceptional conditions required | Negligible: no material service or user effect |
| 2 | Unlikely: possible but not expected | Minor: limited, readily recoverable effect |
| 3 | Plausible: credible under normal project conditions | Moderate: material degradation or rework |
| 4 | Likely: expected unless mitigated | Major: serious service, security, data, or delivery effect |
| 5 | Almost certain: already occurring or expected in the stated conditions | Severe: critical service, safety, legal, or irreversible data effect |

Derived exposure is likelihood × impact. Bands are 1–4 low, 5–9 medium, 10–14 high, and 15–25 critical. Record confidence and assessment basis separately. Do not treat the product as a probability or compare it as if the scale were ratio-valued. Low-confidence estimates should be identified as uncertain rather than presented as precise facts.
