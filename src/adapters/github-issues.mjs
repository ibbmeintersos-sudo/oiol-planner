const asText = value => String(value ?? '').trim();
const list = values => Array.isArray(values) ? values.map(asText).filter(Boolean) : [];
const marker = (planId, taskId) => '<!-- OIOL_PLAN:' + planId + ':TASK:' + taskId + ' -->';

function assertPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('A plan JSON object is required');
  if (plan.status === 'blocked') throw new Error('Blocked plans cannot be exported to GitHub Issues');
  if (plan.validation?.valid === false) throw new Error('Plans with failed validation cannot be exported to GitHub Issues');
  if (!asText(plan.id)) throw new Error('Plan id is required for an external handoff');
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new Error('The plan must contain at least one task');
  const ids = new Set();
  for (const task of plan.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Every exported task must be an object');
    if (!asText(task.id) || !asText(task.title)) throw new Error('Every exported task requires an id and title');
    if (ids.has(task.id)) throw new Error('Duplicate task id: ' + task.id);
    ids.add(task.id);
    for (const key of ['status','execution','executionState','executionRun','executionId','runId','startedAt','completedAt','verified','verificationStatus']) {
      if (Object.hasOwn(task, key)) throw new Error('Planning-only export rejects execution-state field: ' + key);
    }
  }
  for (const key of ['execution','executionState','executionRun','runId','executionId']) {
    if (Object.hasOwn(plan, key)) throw new Error('Planning-only export rejects execution-state field: ' + key);
  }
}

function taskBody(plan, task) {
  const requirements = list(task.requirementIds), components = list(task.componentIds);
  const dependencies = list(task.dependencies), criteria = list(task.acceptanceCriteria), scope = list(task.writeScope);
  return [
    '## OIOL plan context', asText(plan.summary || plan.project?.request || 'No project summary was supplied.'), '',
    '## Task description', asText(task.description || task.title), '',
    '## Requirement links', requirements.length ? requirements.map(id => '- ' + id).join('\n') : '- No requirement IDs supplied.', '',
    '## Architecture components', components.length ? components.map(id => '- ' + id).join('\n') : '- No component IDs supplied.', '',
    '## Dependencies', dependencies.length ? dependencies.map(id => '- ' + id).join('\n') : '- None declared.', '',
    '## Acceptance criteria', criteria.length ? criteria.map(value => '- [ ] ' + value).join('\n') : '- No acceptance criteria supplied.', '',
    '## Proposed write scope', scope.length ? scope.map(value => '- \`' + value + '\`').join('\n') : '- Not specified.', '',
    '---', 'This is a planning handoff from OIOL. Creating this issue does not mean implementation or verification has occurred.',
    marker(plan.id, task.id)
  ].join('\n');
}

export function mapPlanToGitHubIssues(plan, { owner, repo: repository, labels = [] } = {}) {
  assertPlan(plan);
  const targetOwner = asText(owner), targetRepo = asText(repository);
  if (!targetOwner || !targetRepo) throw new Error('GitHub owner and repository are required');
  return {
    adapter: 'github-issues', planId: plan.id, target: { owner: targetOwner, repo: targetRepo }, previewOnly: true,
    issues: plan.tasks.map(task => ({
      taskId: task.id,
      payload: {
        title: ('[OIOL] ' + asText(task.title)).slice(0, 240),
        body: taskBody(plan, task),
        ...(Array.isArray(labels) && labels.length ? { labels: list(labels) } : {})
      }
    })),
    warnings: [
      'Publishing creates GitHub issues and may notify repository watchers.',
      'The OIOL task ID marker is included for traceability; automatic duplicate detection is not performed.',
      'No source files are changed and no planned task is executed.'
    ]
  };
}

async function readResponse(response) {
  let data;
  try { data = await response.json(); }
  catch { throw new Error('GitHub API returned a non-JSON response (HTTP ' + response.status + ')'); }
  if (!response.ok) throw new Error('GitHub issue creation failed (HTTP ' + response.status + '): ' + (data.message || 'Unknown API error'));
  if (!Number.isInteger(data.number) || !asText(data.html_url)) throw new Error('GitHub API response did not include an issue number and URL');
  return data;
}

export async function publishGitHubIssues(plan, options = {}) {
  const preview = mapPlanToGitHubIssues(plan, options);
  if (options.publish !== true) return preview;
  const token = asText(options.token);
  if (!token) throw new Error('A GitHub token is required when publish is true');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const created = [];
  for (const item of preview.issues) {
    const url = 'https://api.github.com/repos/' + encodeURIComponent(preview.target.owner) + '/' + encodeURIComponent(preview.target.repo) + '/issues';
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2026-03-10',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(item.payload)
      });
      const data = await readResponse(response);
      created.push({ taskId: item.taskId, number: data.number, title: data.title, url: data.html_url });
    } catch (error) {
      error.publishedIssues = created;
      error.partialPublish = created.length > 0;
      throw error;
    }
  }
  return { ...preview, previewOnly: false, published: true, created, warnings: preview.warnings };
}
