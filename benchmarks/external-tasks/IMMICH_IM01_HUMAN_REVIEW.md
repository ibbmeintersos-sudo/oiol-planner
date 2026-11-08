# P12 human-review rubric — Immich IM-01

Status: **review rubric prepared; no OIOL/OpenCode plan output has been generated or scored yet.**

## Benchmark identity

- Task: `RW-IM-01` — separate per-user external-library usage reporting.
- Task definition: `0.5.0-draft`.
- Repository: `immich-app/immich`.
- Pinned commit: `87ef895041e160aef4f61f2d7af1ad3f8e38827d`.
- Scanner: `1.7.0`.
- Evidence intake: [P12 task-specific evidence run](https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/42506197751).
- Evidence gate: 9/9 required paths and 12/12 required line ranges excerpted; no missing or unexcerpted ranges.
- Scope: planning only. OIOL must not edit the candidate repository, execute scripts, run tests, or build artifacts.

## Evidence manifest

The source and excerpt hashes below are from the scanner artifact for the pinned commit. The same task bytes, repository commit, and excerpt fingerprints must be used by OIOL and OpenCode.

| Evidence ID | Repository path | Required line range(s) | Source SHA-256 | Excerpt SHA-256 |
|---|---|---|---|---|
| REPO-4b501c92ef8c | `docs/docs/administration/server-stats.md` | 1–10 | `77b5c6b4a4c1cc726c3e3041d64a0d9a00ce6419e5caf0345439fca219f313c1` | `4545e2064bbcdea7870ebbc7083af4457ae2eb5372e80fae792b20ea8a290c97` |
| REPO-eb8221e2e99e | `server/src/dtos/server.dto.ts` | 88–110 | `deaae4ddd6132cc63c37b998d72be667176c84471eb5279ed7b2e557cda3bb99` | `d67129323e855342b2aa4d1855f536c2aef6439787a4d24233b18732fdebf7ab` |
| REPO-64c461336a43 | `server/src/dtos/user.dto.ts` | 118–157 | `545c418688f030b36603aafd2684896546b58ac9e72747e06f6e39182274d259` | `68f2b6c0b7ff492540abff7a4a952b38030024da235ac41709c7e8607c86c7c5` |
| REPO-1aa8b03d790b | `server/src/services/asset.service.ts` | 330–345 | `b78a8c515ec447ef5be6f00de8409ad2af61551dcd3e62892d6a916e21281cae` | `f68c48d292c92e94c7cf4cceb327d562b8495bc0bef0b0c87effe4d60dd69a78` |
| REPO-90f70a8aa3bc | `server/src/services/user.service.ts` | 230–250 | `e94370bd293b3e93285f0aad51daf8a15b11de7660f42961e57c1d93b93eba47` | `ae74d8c6ce139a16c55e47d1da625710078f8769faa0bceeae5162d584a9ba22` |
| REPO-0d88269af423 | `server/src/repositories/user.repository.ts` | 225–285; 310–325 | `588fbde95eab77ca993892327ab38069b504ba4a99b4089b622ddfe99fd41ad9` | `0e75b8eae595879af5adbe429993c5e34b83c0ed5124cace3188c6f3a0773721` |
| REPO-c572669cd763 | `server/src/services/library.service.ts` | 260–295; 400–425 | `3f04f0cc3ac3175bab72b7184723ad78ccc551badd11d13a22e740338931434c` | `417bf69a9741090fd3a489e3f3d6c236afced59629620fee7dd54c314a1f6c78` |
| REPO-dc8fe163fe55 | `server/src/repositories/library.repository.ts` | 85–105 | `dd4e9191b18ba36c2b7eab2f3106da53e96967587c289eafe0b9ec57f9f0c415` | `42cb71a0abdce429537f9f1308aa9003409805c435f1879e2874edad4e991cb4` |
| REPO-459b620e2bdf | `web/src/routes/admin/users/[id]/+layout.svelte` | 65–90; 165–190 | `d36a26374c59a127f4334e88b223efc6f5cc9839987692479cfa7a6961700ed7` | `c64dcc3412a6ee6ae5830da7e8a67e8094c920bdf27a1221c984bfd1fe33c4d5` |

## What a correct plan must understand

1. External-library assets have a non-null `libraryId` and are associated with the owning user. The import path in the library service sets the asset owner from the library owner.
2. Existing upload quota usage is intentionally separate: repository aggregation filters for `libraryId IS NULL`; asset deletion updates the upload usage only when the asset has no library ID.
3. The new metric is a separate **logical indexed-byte** measure based on `asset_exif.fileSizeInByte` for external-library assets, grouped by user ownership. It is not physical disk usage, actual mount consumption, or deduplicated storage.
4. The server statistics DTO and user DTO currently expose existing usage/quota fields. The new metric needs an explicit, non-conflicting API contract.
5. The administrator user page currently displays the existing quota usage. A new metric must be visibly distinct and labelled so administrators do not confuse it with upload quota.
6. External libraries can use custom mount points. The feature must not claim that indexed logical bytes equal physical bytes on disk.
7. The plan must identify consistency behavior when assets are imported, rescanned, deleted, or have missing EXIF size metadata.

## Weighted scoring rubric

Each dimension is scored from 0 to 4. Weighted points = `score / 4 × weight`. Total = 100.

| Dimension | Weight | What reviewers assess |
|---|---:|---|
| Technical correctness and measurement semantics | 15 | Correct definition of logical indexed bytes; correct external-asset filter; null/missing file-size behavior; no unsupported physical-storage claims |
| Upload-quota isolation | 15 | Existing upload quota query, updates, and enforcement remain unchanged; separate metric is added without contaminating existing usage |
| Per-user attribution and aggregation | 12 | Correct owner grouping, external-library membership, no cross-user leakage, no duplicate counting |
| Cross-layer architecture and API contract | 12 | Coherent repository/service/DTO/API/admin-UI flow; backward compatibility and naming consistency |
| Lifecycle and data consistency | 10 | Import, rescan, delete, owner changes, stale metadata, and synchronization behavior considered |
| Performance and query efficiency | 10 | Set-based aggregation, avoiding per-asset N+1 queries, appropriate indexes/joins, bounded response cost |
| Authorization and data exposure | 8 | Admin-only visibility and correct user scoping; no accidental disclosure in ordinary user APIs |
| Tests and acceptance criteria | 8 | Testable criteria across repository/service/API/UI; null values, multiple libraries, multiple users, and quota non-regression covered |
| Risks, unknowns, and rollback | 5 | Explicit assumptions, unresolved questions, migration/rollout concerns, and safe rollback |
| Evidence grounding | 5 | Claims cite the supplied evidence IDs/paths; no invented symbols, methods, or behavior |

### Score anchors

- **0 — Incorrect/absent:** missing, contradicted by evidence, or unsafe.
- **1 — Weak:** generic statements; key behavior or boundaries omitted.
- **2 — Partial:** directionally correct but important integration, edge cases, or tests missing.
- **3 — Strong:** technically sound, evidence-grounded, and sufficiently complete.
- **4 — Excellent:** cross-layer complete, precise, testable, and explicitly handles relevant edge cases and unknowns.

## Critical failure gates

Any one of these makes the plan **not acceptable**, regardless of numeric score:

- Changes the existing upload-quota calculation or enforcement, or counts external-library assets in that existing quota.
- Presents logical indexed bytes as physical disk usage or deduplicated storage without evidence.
- Fails to scope the metric by asset owner or can expose one user's details to another user.
- Introduces double counting across libraries or silently treats unknown size metadata as a verified zero without documenting the policy.
- Ignores the custom-mount-point distinction.
- Invents APIs, fields, tables, services, or repository behavior not supported by the pinned evidence.
- Proposes OIOL modifying the repository, executing commands, or running tests; OIOL is a planning-only system.

## Blinded review protocol

1. Export the complete OIOL and OpenCode plans with provider/model metadata removed and random labels A/B.
2. Give both reviewers the same task JSON, evidence manifest, and pinned snapshot identity.
3. Reviewers score each dimension independently and cite plan sections plus evidence IDs.
4. Resolve any dimension disagreement greater than one point through a short adjudication note.
5. Record critical failures separately; do not average them away.
6. Keep automated lexical score as a diagnostic only. It cannot override technical review.

## Current execution gate

This rubric is ready for use, but no plan output has been produced. Before scoring:
- Configure an OIOL provider and model.
- Configure a reachable OpenCode server and explicit planning model.
- Use the same planning model and reviewer configuration where possible; otherwise mark the comparison non-equivalent.
- Run one paired pilot on the same pinned commit and task bytes.
- Inspect the complete plans and their cited evidence before authorizing repeated paired runs.

A single pilot is diagnostic only. A superiority conclusion requires at least three repeated paired runs and blinded human adjudication.
