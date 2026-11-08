const asText = value => String(value ?? '').trim();
const list = values => Array.isArray(values) ? values.map(asText).filter(Boolean) : [];
const marker = (planId, taskId) => '<!-- OIOL_PLAN:' + planId + ':TASK:' + taskId + ' -->';

function assertPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('A plan JSON object is required');
  if (plan.status === 'blocked') throw new Error('Blocked plans cannot be exported to Linear');
  if (plan.validation?.valid === false) throw new Error('Plans with failed validation cannot be exported to Linear');
  if (!asText(plan.id)) throw new Error('Plan id is required for an external handoff');
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new Error('The plan must contain at least one task');
  const ids = new Set();
  for (const task of plan.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task) || !asText(task.id) || !asText(task.title)) throw new Error('Every exported task requires an id and title');
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

function priorityValue(value) {
  const priorities = { urgent:1, critical:1, high:2, medium:3, normal:3, low:4 };
  return priorities[asText(value).toLowerCase()] || 0;
}

function descriptionFor(plan, task) {
  const requirements=list(task.requirementIds), components=list(task.componentIds);
  const dependencies=list(task.dependencies), criteria=list(task.acceptanceCriteria), scope=list(task.writeScope);
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

export function mapPlanToLinearIssues(plan, { teamId } = {}) {
  assertPlan(plan);
  const targetTeamId = asText(teamId);
  if (!targetTeamId) throw new Error('Linear team ID is required');
  return {
    adapter:'linear', planId:plan.id, target:{teamId:targetTeamId}, previewOnly:true,
    issues:plan.tasks.map(task=>({
      taskId:task.id,
      payload:{
        teamId:targetTeamId,
        title:('[OIOL] '+asText(task.title)).slice(0,255),
        description:descriptionFor(plan,task),
        priority:priorityValue(task.priority)
      }
    })),
    warnings:[
      'Publishing creates Linear issues; use a team ID that belongs to the intended workspace.',
      'The OIOL task ID marker is included for traceability; automatic duplicate detection is not performed.',
      'No source files are changed and no planned task is executed.'
    ]
  };
}

export async function publishLinearIssues(plan, options = {}) {
  const preview=mapPlanToLinearIssues(plan,options);
  if(options.publish!==true) return preview;
  const token=asText(options.token);
  if(!token) throw new Error('A Linear API key or OAuth access token is required when publish is true');
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  if(typeof fetchImpl!=='function') throw new Error('A fetch implementation is required');
  const authorization=options.authMode==='oauth'?'Bearer '+token:token;
  const mutation='mutation OIOLIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }';
  const created=[];
  for(const item of preview.issues){
    try{
      const response=await fetchImpl('https://api.linear.app/graphql',{
        method:'POST',
        headers:{Authorization:authorization,'Content-Type':'application/json'},
        body:JSON.stringify({query:mutation,variables:{input:item.payload}})
      });
      let data;
      try{data=await response.json();}catch{throw new Error('Linear API returned a non-JSON response (HTTP '+response.status+')');}
      if(!response.ok) throw new Error('Linear issue creation failed (HTTP '+response.status+')');
      if(Array.isArray(data.errors)&&data.errors.length) throw new Error('Linear GraphQL error: '+data.errors.map(error=>error.message||'Unknown error').join('; '));
      const result=data.data?.issueCreate;
      if(result?.success!==true||!result.issue?.id) throw new Error('Linear issueCreate did not return success and an issue ID');
      created.push({taskId:item.taskId,id:result.issue.id,identifier:result.issue.identifier,title:result.issue.title,url:result.issue.url});
    }catch(error){error.publishedIssues=created;error.partialPublish=created.length>0;throw error;}
  }
  return {...preview,previewOnly:false,published:true,created,warnings:preview.warnings};
}
