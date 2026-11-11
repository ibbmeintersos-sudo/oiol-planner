# P12 — Independent annotation guide

## Purpose

Create a defensible expected-impact record for one historical change against its exact pinned **base** snapshot. The current 36-case queue is in [annotation-worklist.json](./annotation-worklist.json); it is a reviewer worklist, not a validated corpus or source of ground-truth labels. The annotation is a declared ground-truth artifact; it is not a transcription of the pull request's changed-file list and must never be seeded from OIOL output.

## AI-generated annotation disclosure

The current corpus annotations are **AI-generated, not human-reviewed**. Each reviewer slot (`R1`, `R2`) is an independent run of `nvidia/nemotron-3.5-super-vl:free` through OpenRouter, given the same change request and pinned base snapshot. The slots do not see OIOL output, scores, confidence, diagnostics, or each other's annotation before freezing.

- `independence.attested: true` means the repository operator attests that the generation run was isolated from OIOL output and from the other slot. It does **not** assert human independence.
- The model declaration, model ID, and generation timestamp are stored in every review file; the run manifest is `benchmarks/real-world/reviews/.p12-run.json`.
- AI annotations can be over-inclusive and are weaker evidence than expert human review. Do not describe this corpus as human-annotated or expert-validated.
- Disagreements between slots remain visible and adjudication stays `pending` until a reviewer records it.

## Blinding and reviewer independence

- Assign two distinct stable reviewer IDs before annotation. Do not put names, email addresses, employer identifiers, or other personal data in the corpus.
- Reviewer slots work independently and must not see OIOL plans, Scanner output, confidence values, diagnostics, or each other's annotation.
- Reviewers may inspect the natural-language request, the pinned base snapshot, the historical change commit/PR and its discussion, and public documentation needed to understand contracts.
- A reviewer must disclose a conflict if they authored, implemented, or directly reviewed the historical change. A conflicted reviewer cannot serve as one of the two independent reviewers.
- Record evidence notes as paths plus symbol/section names and, where practical, line ranges or immutable commit URLs. Avoid unsupported assertions.
- Preserve each original reviewer record. Never overwrite a disagreement with a consensus value.

## Annotation sequence

1. Verify the repository, base SHA, change SHA, license, and snapshot fingerprint match the acquisition report.
2. Read the change request before exploring the repository. Write down the intended behavior and explicit scope in your own words.
3. Inspect the base snapshot to identify existing contracts, entry points, call sites, dependency edges, data models, and tests relevant to the request.
4. Inspect the historical change commit/PR as evidence of what the maintainers changed and why. Treat it as evidence, not an automatic golden file list.
5. Annotate every ground-truth dimension below. Use an empty array only when you have evidence that no item belongs in that dimension. If evidence is insufficient, record the uncertainty in `unknowns`; do not silently convert uncertainty into an empty set.
6. Write evidence notes for both positive findings and important exclusions. Mark any category that cannot be evaluated because the repository or language evidence is unsupported.
7. Submit and freeze the independent record before the other reviewer or OIOL output is revealed.

## Ground-truth field definitions

### File and package scope

- `directFiles`: files that must be added, edited, or removed to implement the requested behavior in the pinned base tree. This is a semantic implementation set, not simply every file touched by the historical PR.
- `affectedFiles`: additional existing files whose behavior, contract, generated output, or consumers are materially affected, even if they need no edit. Include direct files only if the schema's evaluation protocol explicitly treats this as an inclusive set; otherwise keep direct and transitive sets separate and document the convention.
- `packages`: workspace/package/module identities affected by the change. Use stable manifest names where available, not guessed directory labels.
- `tests`: existing test files that should be run or extended to verify the change. Do not include a test merely because the historical PR happened to modify it; explain the verification relationship.

### Contracts and data

- `apiConsumers`: concrete routes, handlers, clients, generated bindings, or other consumers relying on a changed public/internal API contract. Record the contract and direction of dependency in evidence notes.
- `databaseConsumers`: concrete models, queries, repositories, serializers, jobs, or services whose behavior depends on a changed database object or data contract. Do not infer a database impact where the request does not touch persisted data.
- `migrationFiles`: existing migration/schema evolution files required or implicated by the requested change. Include ordering or compatibility concerns in evidence notes; do not invent a migration when none is justified.
- `scannerSymbols`: symbols visible to the Scanner in the pinned base snapshot. Use the exact file path, declared symbol name, and symbol kind supported by the source language.
- `dependencyEdges`: directed relationships supported by source evidence. Keep a consistent convention (`from` depends on `to`) throughout the corpus. Do not add conceptual relationships that are not visible in the repository.

### Uncertainty and risk

- `unknowns`: facts that cannot be established from the pinned snapshot and permitted historical evidence, such as unresolved dynamic loading, generated code unavailable in the snapshot, external service behavior, or incomplete language support. State what is unknown and why it matters.
- `risks`: specific failure modes introduced or exposed by the requested change. Each risk needs a stable ID, severity, and evidence-based rationale. Do not inflate severity to make a case look complex.

## Adjudication

Compare the two frozen records dimension by dimension.

- Exact agreement: retain the agreed set and note that no adjudication was needed.
- Missing/extra item disagreement: adjudicator inspects the cited evidence and records the accepted item, rejected item, and rationale.
- Scope-definition disagreement: resolve the definition first, then re-evaluate affected cases consistently.
- Insufficient evidence: preserve the item as unknown or mark the dimension unavailable; do not force a false positive or false negative.
- Reviewer independence/blinding failure: invalidate the affected review and obtain a replacement independent annotation.

The adjudication record must say whether adjudication was required, its final status, who adjudicated (stable ID only), and a rationale. A pending adjudication blocks the case from the accepted corpus.

## Prohibited shortcuts

- Do not copy historical PR changed paths into `directFiles` or `affectedFiles` without independent reasoning.
- Do not run project scripts, builds, tests, package managers, migrations, or application code. OIOL and this benchmark are static-analysis-only.
- Do not inspect or use OIOL output while creating ground truth.
- Do not treat absence of a finding as proof of absence when the scan/evidence is incomplete.
- Do not collapse unsupported dimensions into zero or an empty set.
- Do not fabricate reviewer identities, timestamps, evidence, or adjudication.

## Readiness checklist

A case is annotation-ready only when:
- [ ] the exact base snapshot is acquired and fingerprinted;
- [ ] Git tree path-set parity and license hash are verified;
- [ ] the change request is written independently of OIOL output;
- [ ] two distinct, non-conflicted reviewer slots are assigned (human reviewers or declared AI runs);
- [ ] both reviewers can access the same immutable evidence set;
- [ ] OIOL output remains hidden until both records are frozen.

A case is benchmark-ready only when both independent records exist, blinding and independence are attested, disagreements are adjudicated, and the final case passes `case.schema.json` and the corpus validator.
