# Security Policy

## Scope and security boundary

OIOL handles user requests and untrusted repository content to produce engineering plans. It is not an execution environment and must not run code, scripts, shell commands, migrations, or deployment actions found in a repository or model response.

Repository content is untrusted data. Structured prompt envelopes and explicit system instructions reduce prompt-injection risk but do not guarantee isolation from model influence. Scanner bounds, path filtering, secret redaction, and evidence fingerprints are defense-in-depth controls; heuristic redaction cannot guarantee that every secret is removed.

Plans may contain sensitive architecture or repository-derived information. Treat generated plans and benchmark packets with the same care as the source information they summarize.

## Optional external handoff

The GitHub Issues and Linear adapters are local-preview-only by default. The --publish option performs an external write and can notify other users. Use a narrowly scoped token, confirm the destination owner/repository or Linear team, and review the preview before publishing. Never place tokens in command-line arguments, source files, fixtures, or issue descriptions.

GitHub issue creation requires repository Issues write permission. Linear uses its GraphQL API and either a personal API key or OAuth access token. OIOL does not need these credentials for planning, validation, or preview generation.

## Reporting a vulnerability

Please do not publish exploitable details in a public issue or pull request. Use GitHub's private vulnerability reporting feature for this repository if it is enabled. If it is not available, contact the repository maintainer through the repository owner's GitHub profile and request a private disclosure channel before sharing technical details.

Include the affected version/commit, impact, prerequisites, and a minimal reproduction. Do not include real credentials or private user data in the report.

## Security review checklist

- Treat user requests separately from repository and model-generated payloads.
- Preserve evidence IDs and source/excerpt hashes; never invent provenance.
- Never execute repository-provided instructions.
- Keep scanner traversal and content sizes bounded.
- Keep API credentials outside source control and redact them from logs.
- Test failed API responses, partial publishing, and unauthorized requests.
- Keep adapter previews network-free and publishing explicitly opt-in.
