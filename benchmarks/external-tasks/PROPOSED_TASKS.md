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

### BA-01 — Organization-scoped session revocation (candidate clear change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.1.0-draft`.
- Request: Plan an organization-administrator capability to revoke all active sessions for one selected organization member. Preserve tenant isolation, prevent a member of one organization from affecting another, and specify observable audit evidence for the action. Identify how the current code models organizations, users, sessions, plugins, and token invalidation before proposing changes. Do not assume that API keys or other credentials are sessions.
- Initial expected concepts: organization boundary; session revocation; authorization; token invalidation; audit event; plugin/package boundaries; migration or persistence compatibility; tests.
- Evidence to confirm after scan: organization and session data models; session lifecycle/invalidation paths; authorization checks; plugin registration and extension contracts; persistence adapters; test coverage.
- Human review focus: Does the plan distinguish sessions from API keys and other credentials? Does it enforce organization ownership at the server boundary? Does it preserve existing session semantics and plugin compatibility? Are concurrency, already-issued tokens, and audit requirements addressed?

### BA-02 — Ambiguous organization authentication policy (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.1.0-draft`; `mustClarify: true`.
- Request: “Add enterprise single sign-on for organizations.” Do not select a protocol or provider until the blocking product and security decisions are clarified.
- Required clarification areas: protocol/provider choice (for example OIDC or SAML); organization-domain verification and ownership; account linking/provisioning behavior; enforcement scope and fallback/recovery; identity-provider initiated versus application initiated flows.
- Evidence to confirm after scan: current provider/plugin abstractions; account identity model; organization membership and domain verification; callback/redirect handling; existing MFA and account-linking behavior.
- Human review focus: Does the plan stop before selecting a protocol, changing identity semantics, or inventing provider behavior? Does it ask only the decisions that materially affect architecture and security?

## Paperless-ngx — `paperless-ngx/paperless-ngx`

**Source basis:** README blob `f1e5141043dcb5e36b496c7ce71192d9e5e24aea`; root `pyproject.toml` blob `5eb0f59ed2c7f0b2d36d76d3446a16b10b639961`. Public description identifies a searchable document archive. The manifest declares a Python/Django application with Celery, Redis, and document-processing dependencies.

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

**Source basis:** README blob `8db638e3a225f8ab758c35ee72c055393e56a405`; root `pyproject.toml` blob `76525cc05f89a7e9f687aebffe39207041ac207d`. Public description identifies a Python workflow orchestration framework with flows, tasks, scheduling, caching, retries, event-based automations, server, and cloud monitoring.

### PF-01 — External delivery of workflow state events (candidate clear change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.1.0-draft`.
- Request: Plan an opt-in integration that delivers selected flow/task state-transition events to an administrator-configured HTTPS webhook. Define an at-least-once delivery contract, stable event identity for consumer deduplication, bounded retry/backoff, and safe secret handling. Preserve existing orchestration behavior when delivery is unavailable.
- Initial expected concepts: flow/task state; event schema; webhook; idempotency; retry/backoff; server/API boundary; secret management; observability; tests.
- Evidence to confirm after scan: state-transition/event models; server API; orchestration/event services; background delivery patterns; authentication/secrets; client/server package boundaries; tests.
- Human review focus: Does the plan distinguish event creation from delivery, prevent duplicate side effects through stable identity, avoid blocking workflow execution on remote webhook latency, and preserve tenant/secret isolation?

### PF-02 — “Trigger workflows automatically from events” (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.1.0-draft`; `mustClarify: true`.
- Request: “Make workflows start automatically when relevant events happen.” Do not choose event sources or trigger semantics until clarified.
- Required clarification areas: event sources and trust boundaries; matching/filtering semantics; target flow/deployment selection; duplicate and ordering guarantees; authorization/tenant scope; rate limits and failure behavior.
- Evidence to confirm after scan: current automations/event vocabulary; deployment model; event API; scheduling/trigger mechanisms; authentication and workspace/tenant concepts.
- Human review focus: Does the plan distinguish events, schedules, and deployment triggers? Does it block decisions about event source, delivery guarantees, and tenancy rather than assuming them?

## Gitea — `go-gitea/gitea`

**Source basis:** README blob `d11344cbf5e99f6d7d2b93f18ebf7da242b42b4e`; root `go.mod` blob `1d7f26bdb1a69e96a267958bace6f478904e0a46`. Public description identifies a self-hosted development service with Git hosting, code review, issue tracking, collaboration, package registry, and CI/CD.

### GT-01 — Package registry retention policies (candidate clear change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.1.0-draft`.
- Request: Plan administrator-configurable retention rules for package-registry versions, scoped to an owner and package type. Include a dry-run report, protected versions, and explicit confirmation before deletion. Preserve package download behavior and permission boundaries.
- Initial expected concepts: package registry; owner scope; package version; retention rule; dry run; protected versions; permission checks; storage cleanup; audit; tests.
- Evidence to confirm after scan: package registry handlers/services; package type adapters; package/version persistence; blob storage/deletion paths; owner/permission checks; background cleanup patterns; tests.
- Human review focus: Does the plan cover each supported package type only where evidence supports it? Does it avoid deleting protected or referenced artifacts? Are storage cleanup and database metadata consistency handled?

### GT-02 — “Delete old package versions” (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.1.0-draft`; `mustClarify: true`.
- Request: “Automatically delete old package versions.” Do not assume age, package type, owner scope, or which versions are safe to remove.
- Required clarification areas: retention age/count; scope across owners and package ecosystems; protected tags/releases/dependencies; dry-run and approval; rollback/recovery expectations; audit requirements.
- Evidence to confirm after scan: package types and metadata; storage model; package permissions; deletion behavior and references.
- Human review focus: Does the plan identify the destructive ambiguities and block deletion design until retention and protection rules are defined?

## Immich — `immich-app/immich`

**Source basis:** README blob `e8678456d0660e3fdbb43f8fe0442f49f3508ba4`; root `package.json` blob `b8755b803e41448cdd117bc890624cf3ad498b70`. Public description identifies a self-hosted photo/video management system with mobile and web clients, multi-user support, uploads, background backup, metadata, albums, sharing, and user-defined storage structure. The root manifest identifies a pnpm monorepo.

### IM-01 — Per-user storage quotas (candidate clear change)

- Suggested scenario: `EX-MONOLITH-004`; task version: `0.1.0-draft`.
- Request: Plan per-user storage quotas with an administrator-configurable limit, usage visibility, and server-side enforcement for new uploads. Preserve multi-user isolation and avoid counting the same stored asset multiple times. Identify how shared assets, imports, background mobile backup, and existing libraries should be treated; surface unresolved semantics rather than assuming them.
- Initial expected concepts: per-user quota; storage accounting; upload enforcement; shared assets; background backup; mobile/web clients; API; concurrency; tests.
- Evidence to confirm after scan: asset ownership and storage accounting; upload/import pipelines; background jobs; mobile/web API consumers; shared album semantics; administrative settings and tests.
- Human review focus: Is quota enforcement server-authoritative and concurrency-safe? Does the plan distinguish asset ownership from shared visibility and avoid double counting? Are existing libraries and background uploads addressed?

### IM-02 — “Limit storage for each user” (candidate clarification task)

- Suggested scenario: `EX-API-003`; task version: `0.1.0-draft`; `mustClarify: true`.
- Request: “Add storage limits for each user.” Do not choose quota units or enforcement behavior until clarified.
- Required clarification areas: quota metric (logical size, deduplicated physical size, or another measure); treatment of shared assets and partner sharing; hard versus soft limits and grace periods; behavior for existing users already above quota; imports and background backups; administrator overrides.
- Evidence to confirm after scan: asset storage/accounting model; ownership and sharing relationships; upload admission paths; client behavior; existing admin configuration patterns.
- Human review focus: Does the plan block policy decisions with material data-model and UX consequences? Does it ask about shared ownership, deduplication, and already-over-quota users?

## Promotion gate

None of these ten prompts is a completed benchmark task. The README and manifest evidence is sufficient to define candidate product-level questions, but not to claim that a particular internal module, API, table, queue, or test exists. The scanner run must validate the code-level evidence and the task must be revised before scoring. For the ambiguous cases, reviewers must verify that the model produces a blocking clarification and does not invent a protocol, policy, or destructive behavior.

After promotion, create one task JSON per task using the contract in [EXTERNAL_TASK_SCHEMA.md](../EXTERNAL_TASK_SCHEMA.md), increment the version to `1.0.0`, and use the exact same bytes for all OIOL and OpenCode repetitions.
