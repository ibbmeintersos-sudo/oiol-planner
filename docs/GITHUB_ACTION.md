# GitHub Action: planning-only pull request review

The OIOL composite action scans a pull request, asks the configured model for a
structured engineering plan, uploads the plan and Markdown report as artifacts,
and can post a short summary comment.

**It never implements changes, runs the target project's tests or builds, executes
scripts, modifies the checkout, or manages execution state.** The plan is input
for a human reviewer, not an execution engine.

## Quick start

1. Add a repository secret named `OIOL_API_KEY` under **Settings → Secrets and
   variables → Actions**.
2. Copy [`examples/github-actions/oiol-review.yml`](../examples/github-actions/oiol-review.yml)
   to `.github/workflows/oiol-review.yml` in the repository you want to review.
3. Adjust `request`, `provider`, and `model` for your project.
4. Open or update a pull request. The workflow uploads an `oiol-plan` artifact
   containing `plan.json`, `plan.md`, and `comment.md`.

The action installs OIOL from the action's own checkout. The target repository
is only scanned; none of its scripts are executed.

## Inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `request` | yes | — | Planning request describing what to analyze. |
| `api-key` | yes | — | Provider API key. Pass `${{ secrets.OIOL_API_KEY }}`. |
| `mode` | no | `existing` | `existing` or `greenfield`. |
| `path` | no | `.` | Repository path to scan, relative to the workspace. |
| `provider` | no | empty | `openai-compatible`, `anthropic`, `gemini`, or `ollama`. Empty uses the config or the built-in default. |
| `model` | no | empty | Provider model name. |
| `base-url` | no | empty | Provider base URL. |
| `review-provider` | no | empty | Optional independent reviewer provider. |
| `review-model` | no | empty | Optional reviewer model. |
| `review-base-url` | no | empty | Optional reviewer base URL. |
| `review-api-key` | no | empty | Optional reviewer API key. |
| `config` | no | empty | Path to an `oiol.config.json` in the workspace. The checkout's own config is never loaded implicitly. |
| `output-dir` | no | `oiol-plan` | Artifact directory. |
| `artifact-name` | no | `oiol-plan` | Uploaded artifact name. Change it when one workflow runs several reviews. |
| `comment` | no | `false` | Post a short summary comment on the pull request. |
| `github-token` | no | empty | Token used only for the optional comment. Use `${{ github.token }}`. |
| `node-version` | no | `22` | Node.js version. |

## Outputs

| Output | Description |
| --- | --- |
| `plan-path` | Absolute path to `plan.json`. |
| `report-path` | Absolute path to `plan.md`. |
| `status` | `ready_for_review`, `needs_revision`, `blocked`, or `unknown`. |
| `exit-code` | `0` valid, `2` blocked or invalid, `1` execution error. |

The job fails when the CLI returns a non-zero exit code. Artifacts are uploaded
with `if: always()` so a blocked or failed plan can still be inspected.

## Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
```

`pull-requests: write` is needed only when `comment: true`. Otherwise keep
`contents: read` and omit the write permission.

## Using a configuration file

Commit an `oiol.config.json` outside the scanned path, or pass a path that is
not controlled by the pull request:

```yaml
- uses: ibbmeintersos-sudo/oiol-planner/.github/actions/oiol-review@main
  with:
    request: Review this pull request.
    api-key: ${{ secrets.OIOL_API_KEY }}
    config: .github/oiol.config.json
```

API keys are never read from the config file; `apiKeyEnv` only names an
environment variable. The action passes keys through step environment variables,
and GitHub masks registered secrets in logs.

## Security model

- The example uses `pull_request`, never `pull_request_target`. Do not switch to
  `pull_request_target` and check out pull request code: that combination exposes
  repository secrets to untrusted code.
- GitHub does not provide secrets to workflows triggered by pull requests from
  forks. Such runs fail at the API-key check. Run the workflow manually from a
  trusted branch (see `.github/workflows/oiol-self-review.yml`) or after a
  maintainer copies the change to a trusted branch.
- The action runs OIOL from its own checkout. It does not run `npm install`,
  `npm test`, or any script from the target repository.
- The action does not load the target checkout's `.env` or `oiol.config.json`.
  Its working directory is the action's own checkout; pass `config` explicitly
  if you need one.
- Repository content is untrusted. OIOL sends bounded, redacted excerpts to the
  configured model provider. Review your provider's data-handling policy before
  enabling the action on private or regulated repositories.
- Plan artifacts can contain repository excerpts. Artifact access follows the
  repository's normal permissions.
- The optional comment contains counts, status, and a workflow link. It does not
  quote repository content.

## Limitations

- The action produces a plan and a report; it does not prove that the pull
  request is correct, secure, or complete.
- Planning quality depends on the model, the request, and the repository scan
  limits. Review the plan rather than trusting its status.
- The action targets `ubuntu-latest`; the composite steps use `bash`.
- A reviewer configured with the same provider, model, and endpoint as the
  planner still leaves the plan in `needs_revision`; configure an independent
  reviewer for a passing review gate.
