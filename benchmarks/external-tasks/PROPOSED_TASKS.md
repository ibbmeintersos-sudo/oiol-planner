# P12 external task blueprints — draft pending scanner evidence

Status: **task prompts drafted from public project documentation and root manifests; not approved for scored runs yet**.

These blueprints are deliberately separate from runnable task-definition JSON. The selected repositories have not yet been checked out and scanned in the local filesystem environment. Before turning any blueprint into a runnable task file:

1. Pin the repository to a clean local Git commit.
2. Run `npm run benchmark:scan-external` and inspect the complete scan report.
3. Confirm that the scanner included the relevant manifests, application source, tests, and cross-component paths.
4. Revise the task request and expected signals to match actual repository evidence; remove any unsupported assumptions.
5. Add a human-review rubric naming concrete paths/symbols from the scan.
6. Only then promote the task into a versioned `*.json` task definition and use it for OIOL/OpenCode runs.

The source blob SHAs below identify the public README and root manifest versions inspected on 2026-11-08. They are not repository commit SHAs and do not replace local checkout pinning.

## Better Auth — `better-auth/better-auth`

**Source basis:** README blob `0081a3d2d7157cec839734597e51bd0c0be5bec0`; root `package.json` blob `fb556e54e566eeeb6bf5111bb28315152aa46b65`. Public description identifies a TypeScript authentication/authorization framework with a plugin ecosystem, multi-tenant support, and 2FA. The manifest shows a pnpm/Turborepo package workspace.

### BA-01 — Optional session revocation when an organization member is removed (candidate specified change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.2.0-draft`.
- Request: Add an opt-in organization-plugin option that revokes **all active authentication sessions belonging to a user** after that user is successfully removed from an organization. Keep the default behavior unchanged. This is explicitly a user-wide revocation, so sessions used with the user's other organizations are also ended. Do not revoke API keys, OAuth grants, or unrelated credentials. Preserve the existing removal hook and error/transaction semantics.
- Confirmed code evidence from the pinned scan: `packages/better-auth/src/plugins/organization/routes/crud-members.ts` (member removal and `afterRemoveMember` hook); `packages/better-auth/src/plugins/organization/types.ts` (hook options); `packages/better-auth/src/plugins/multi-session/index.ts` (device-session operations and `maximumSessions`); `packages/better-auth/src/api/routes/session.ts`; `packages/core/src/db/schema/session.ts`.
- Tests to inspect: `packages/better-auth/src/plugins/organization/organization.test.ts`; `packages/better-auth/src/plugins/multi-session/multi-session.test.ts`.
- Initial expected concepts: opt-in compatibility; user-wide session invalidation; sequencing after successful membership removal; adapter/session-store capability; multi-session cookie behavior; failure handling; tests and docs.
- Human review focus: Does the plan avoid revoking sessions before the membership removal succeeds? Does it clearly communicate that revocation is global across the user's organizations? Does it avoid deleting API keys/OAuth grants? Does it cover session cookies and server-side session records without duplicating the existing `afterRemoveMember` hook?

### BA-02 — Organization-specific session limits (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.2.0-draft`; `mustClarify: true`.
- Request: “Allow each organization to control how many active sessions its members can have.” Do not choose a data model or enforcement rule until the scope is clarified.
- Confirmed code evidence: `packages/better-auth/src/plugins/multi-session/index.ts` exposes a plugin-level `maximumSessions` setting; organization configuration and membership permissions live under `packages/better-auth/src/plugins/organization/`; session persistence is represented in `packages/core/src/db/schema/session.ts`.
- Required clarification areas: Is the limit per user globally, per organization, or per organization-member relationship? What happens when a user belongs to several organizations? Which organization context governs a new session? Should existing sessions be revoked or only new sessions denied when a limit is lowered? How should trusted server-created sessions behave?
- Human review focus: Does OIOL identify the mismatch between user-level sessions and organization-level policy? Does it ask for the policy scope and enforcement semantics before proposing migrations or revocation behavior?
## Paperless-ngx — `paperless-ngx/paperless-ngx`

**Source basis:** README blob `f1e5141043dcb5e36b496c7ce71192d9e5e24aea`; root `pyproject.toml` blob `5eb0f59ed2c7f0b2d36d76d3446a16b10b639961`. Public description identifies a searchable document archive. The manifest declares a Python/Django application with Celery, Redis, and document-processing dependencies. The pinned scan confirms the document model, task processing, permission, API/view, signal, and test layers. Relevant paths include `src/documents/models.py`, `src/documents/tasks.py`, `src/documents/permissions.py`, `src/documents/views.py`, `src/documents/serialisers.py`, `src/documents/signals/handlers.py`, `src/paperless/urls.py`, `src/documents/tests/test_document_model.py`, `src/documents/tests/test_tasks.py`, and `src/documents/tests/test_api_documents.py`. No retention-policy implementation was identified in the bounded scan/search; verify again against the full checkout before promoting the task.

### PN-01 — Document retention metadata and safe expiry workflow (candidate clear change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.1.0-draft`.
- Request: Plan a document-retention capability that lets an authorized administrator assign a retention date to a document, view upcoming expirations, and preview the affected documents before an explicitly confirmed expiry operation. Do not schedule irreversible deletion automatically. Preserve document searchability and auditability.
- Initial expected concepts: document metadata; retention date; authorization; expiry preview; background task/Celery; audit trail; API/UI consistency; migration; tests.
- Evidence to confirm after scan: document model and lifecycle; ingestion/OCR processing; API serializers/views; permission model; task scheduling and retry patterns; UI routes/components; audit/history support.
- Human review focus: Are metadata, API, UI, background processing, permission checks, and migrations planned consistently? Does the plan separate preview from destructive action and preserve legal/audit records?

### PN-02 — “Automatically clean up old documents” (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.1.0-draft`; `mustClarify: true`.
- Request: “Automatically clean up old documents to save storage.” Do not assume that age alone authorizes deletion.
- Required clarification areas: retention duration and date semantics; scope (all documents, selected owners/tags/types); legal hold/exemptions; archive versus permanent deletion; approval/preview and recovery requirements; treatment of originals, thumbnails, OCR text, and backups.
- Evidence to confirm after scan: document storage layers; archival/deletion workflows; task scheduling; permission and audit facilities; backup/restore assumptions.
- Human review focus: Does the plan block destructive design until policy and legal-hold semantics are defined? Does it distinguish logical deletion from physical storage reclamation?

## Prefect — `PrefectHQ/prefect`

**Source basis:** README blob `8db638e3a225f8ab758c35ee72c055393e56a405`; root `pyproject.toml` blob `76525cc05f89a7e9f687aebffe39207041ac207d`. The pinned scanner confirms separate client/server event packages, automation actions, webhook blocks, API endpoints, and UI action forms.

### PF-01 — Bounded retries for automation webhook actions (candidate specified change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.2.0-draft`.
- Request: Add an opt-in bounded retry policy to the existing `CallWebhook` automation action for transient network failures, timeouts, and HTTP 5xx responses. Specify a maximum attempt count, exponential backoff with a cap, and a stable idempotency identifier for all attempts belonging to one triggered action. Do not retry ordinary HTTP 4xx responses. Preserve current behavior when retries are not configured and do not block event ingestion while waiting for remote delivery.
- Confirmed code evidence: `src/prefect/server/events/actions.py` contains the server-side `CallWebhook` action and response/failure handling; `src/prefect/events/actions.py` contains the client-facing action model; `src/prefect/server/events/clients.py`, `src/prefect/server/events/worker.py`, and `src/prefect/server/events/models/` provide event delivery/worker context; `ui-v2/src/components/automations/automations-wizard/actions-step/call-webhook-fields.tsx` exposes webhook action configuration.
- Tests to inspect: `tests/events/server/test_automation_events.py`; `tests/events/server/test_automations_api.py`; webhook/action tests under `tests/events/`.
- Initial expected concepts: transient versus permanent failures; idempotency; bounded retry state; event causal ordering; worker concurrency; timeout handling; secret-safe logs; UI/API/schema compatibility; tests.
- Human review focus: Does the plan reuse the existing automation action worker rather than inventing a parallel webhook system? Does it distinguish a failed delivery from a failed automation trigger? Does it prevent duplicate side effects and avoid unbounded retry loops?

### PF-02 — “Make webhook delivery more reliable” (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.2.0-draft`; `mustClarify: true`.
- Request: “Make webhook delivery more reliable.” Do not select delivery guarantees or retry behavior until clarified.
- Confirmed code evidence: existing `CallWebhook` action in `src/prefect/server/events/actions.py`; `Webhook` block and client/server action schemas; automation event and worker tests.
- Required clarification areas: at-most-once versus at-least-once delivery; retryable status codes and network failures; attempt/time budget; idempotency contract and receiver support; timeout and payload-size limits; ordering guarantees; dead-letter/manual replay expectations; secret rotation and audit visibility.
- Human review focus: Does OIOL recognize that webhook delivery already exists? Does it frame the work as reliability semantics around the current action rather than proposing a duplicate integration? Does it block on the delivery guarantee and retry policy?
## Gitea — `go-gitea/gitea`

**Source basis:** README blob `d11344cbf5e99f6d7d2b93f18ebf7da242b42b4e`; root `go.mod` blob `1d7f26bdb1a69e96a267958bace6f478904e0a46`. The pinned scan confirms package registry models, cleanup execution, owner settings, preview templates, and integration tests.

### GT-01 — Repository-scoped package cleanup overrides (candidate specified change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.2.0-draft`.
- Request: Extend the existing owner-and-package-type package cleanup rules with optional repository-specific overrides. A repository-specific rule must take precedence for that repository; otherwise the current owner/type rule remains the fallback. Preserve the existing preview-before-cleanup workflow and all current owner-level behavior when no repository override is configured.
- Confirmed code evidence: `models/packages/package_cleanup_rule.go` stores owner/type, keep-count/pattern, and remove-days/pattern fields; `services/packages/cleanup/cleanup.go` executes enabled rules; `routers/web/shared/packages/packages.go` handles rule configuration; `templates/package/shared/cleanup_rules/preview.tmpl` renders the existing preview; `tests/integration/api_packages_test.go` exercises package cleanup.
- Initial expected concepts: repository identity and ownership; rule precedence; schema migration and indexes; cleanup execution selection; preview consistency; authorization; backwards compatibility; integration tests.
- Human review focus: Does the plan preserve owner-level fallback semantics? Does it prevent repository overrides from escaping the owning organization/user boundary? Does preview use exactly the same rule resolution as cleanup execution? Are migration and conflict cases covered?

### GT-02 — “Make package cleanup more granular” (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.2.0-draft`; `mustClarify: true`.
- Request: “Make package cleanup more granular.” Do not assume the intended scope or precedence.
- Confirmed code evidence: existing owner/type cleanup model and execution/preview paths listed in GT-01.
- Required clarification areas: scope (owner, repository, package, version, or tag); precedence when rules overlap; retention by age versus count/pattern; protected versions/tags; preview and approval requirements; cleanup schedule and rollback expectations.
- Human review focus: Does OIOL identify that cleanup rules and preview already exist? Does it ask what new granularity is required before designing another policy layer?
## Immich — `immich-app/immich`

**Source basis:** README blob `e8678456d0660e3fdbb43f8fe0442f49f3508ba4`; root `package.json` blob `b8755b803e41448cdd117bc890624cf3ad498b70`. The pinned scan confirms user quota DTOs, user/asset services, external-library services, admin usage UI, and multi-client architecture.

### IM-01 — Separate external-library usage reporting (candidate specified change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.2.0-draft`.
- Request: Add a separate per-user external-library storage-usage metric to administrator-facing user/server statistics. Keep it distinct from the existing upload quota and do not change quota enforcement. Use a clearly documented logical-size measurement based on indexed external-library assets; do not claim physical disk usage or deduplicated storage usage unless the repository evidence supports it.
- Confirmed code evidence: `docs/docs/administration/server-stats.md` explicitly states external libraries are excluded from storage quota because of custom mount points; `server/src/dtos/server.dto.ts` defines usage and per-user quota statistics; `server/src/dtos/user.dto.ts` exposes `quotaSizeInBytes` and `quotaUsageInBytes`; `server/src/services/asset.service.ts`, `server/src/services/user.service.ts`, and `server/src/repositories/user.repository.ts` participate in asset/user usage flows; `server/src/services/library.service.ts` and `server/src/repositories/library.repository.ts` cover external libraries; admin UI includes `web/src/routes/admin/users/[id]/+layout.svelte`.
- Initial expected concepts: external-library indexing and ownership; logical-size aggregation; DTO/API evolution; admin UI; custom mount points; performance/caching; no change to upload quota enforcement; tests and documentation.
- Human review focus: Does the plan keep external-library usage separate from the existing upload quota? Does it avoid claiming actual physical disk consumption for custom mounts? Does it identify ownership and indexing boundaries and prevent double counting?

### IM-02 — “Make external libraries count toward storage quotas” (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.2.0-draft`; `mustClarify: true`.
- Request: “Make external libraries count toward user storage quotas.” Do not change quota enforcement until the accounting policy is clarified.
- Confirmed code evidence: existing per-user quota fields and enforcement paths; external-library service/repository; server stats documentation explaining the current exclusion.
- Required clarification areas: logical versus physical bytes; shared mount ownership; duplicate assets and deduplication; symlinks and custom mount points; whether imported and external assets both count; behavior for users already over quota; hard rejection versus warning/grace period.
- Human review focus: Does OIOL identify why external libraries are currently excluded? Does it ask about ownership and storage measurement before proposing a schema or enforcement change?
## Promotion gate

None of these ten prompts is a completed benchmark task. The README and manifest evidence is sufficient to define candidate product-level questions, but not to claim that a particular internal module, API, table, queue, or test exists. The scanner run must validate the code-level evidence and the task must be revised before scoring. For the ambiguous cases, reviewers must verify that the model produces a blocking clarification and does not invent a protocol, policy, or destructive behavior.

After promotion, create one task JSON per task using the contract in [EXTERNAL_TASK_SCHEMA.md](../EXTERNAL_TASK_SCHEMA.md), increment the version to `1.0.0`, and use the exact same bytes for all OIOL and OpenCode repetitions.
