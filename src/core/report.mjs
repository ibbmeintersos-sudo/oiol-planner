import { topologicalWaves } from './graph.mjs';
import { deriveTaskInterfaces } from './task-interface.mjs';
import { buildTraceability } from './traceability.mjs';

const text = value => String(value && typeof value === 'object' ? (value.statement || value.description || value.question || JSON.stringify(value)) : value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
const list = values => Array.isArray(values) && values.length ? values.map(value => '- ' + text(value)).join('\n') : '- None recorded';

export function renderPlanMarkdown(plan = {}) {
  const validation = plan.validation || {};
  const evaluation = plan.evaluation?.metrics || {};
  const quality = plan.evaluation?.qualityDiagnostics || {};
  const signal = value => Array.isArray(value) && value.length ? value.map(text).join(', ') : 'None recorded';
  const tasks = Array.isArray(plan.tasks) ? plan.tasks.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const graph = plan.dependencyGraph || { nodes: [], edges: [] };
  const schedule = topologicalWaves(tasks, Array.isArray(graph.edges) ? graph.edges : []);
  const risks = Array.isArray(plan.risks) ? plan.risks.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const clarifications = Array.isArray(plan.clarifications) ? plan.clarifications.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const requirements = Array.isArray(plan.requirements) ? plan.requirements.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const traceability = (Array.isArray(plan.traceability?.rows) ? plan.traceability.rows : buildTraceability(plan).rows).filter(item => item && typeof item === 'object' && !Array.isArray(item));
  const taskInterfaces = Array.isArray(plan.taskInterfaces) ? plan.taskInterfaces.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : deriveTaskInterfaces(plan);
  const assumptions = Array.isArray(plan.assumptions) ? plan.assumptions : [];
  const unknowns = Array.isArray(plan.unknowns) ? plan.unknowns : [];
  const lines = [
    '# Engineering Plan', '',
    '- **Plan:** ' + text(plan.id || 'unspecified'),
    '- **Project:** ' + text(plan.project?.name || plan.project?.kind || 'Unspecified'),
    '- **Status:** ' + text(plan.status || 'unspecified'),
    '- **Schema:** ' + text(plan.schemaVersion || 'legacy / unspecified'),
    '- **Created:** ' + text(plan.metadata?.createdAt || 'unspecified'), '',
    '## Executive summary', '',
    text(plan.summary || plan.project?.request || 'No executive summary was supplied.'), '',
    '## Planning quality checks', '',
    '- **Deterministic validation:** ' + (validation.valid === true ? 'Valid' : validation.valid === false ? 'Invalid' : 'Not recorded'),
    '- **Requirement coverage:** ' + (Number.isFinite(evaluation.requirementCoverage) ? (evaluation.requirementCoverage * 100).toFixed(1) + '%' : Number.isFinite(validation.requirementCoverage) ? (validation.requirementCoverage * 100).toFixed(1) + '%' : 'Not recorded'),
    '- **Acceptance criteria:** ' + (Number.isFinite(evaluation.acceptanceCriteriaCount) ? evaluation.acceptanceCriteriaCount : tasks.reduce((n, task) => n + (task.acceptanceCriteria?.length || 0), 0)),
    '- **Dependency graph:** ' + (schedule.cycle ? 'Cycle detected' : schedule.error ? 'Invalid graph' : 'Acyclic'), '',
    '',
    '## Non-blocking quality review signals',
    '',
    '- **Requirements without requirement-level acceptance criteria:** ' + signal(quality.requirementsWithoutAcceptanceCriteria),
    '- **Tasks without descriptions:** ' + signal(quality.tasksWithoutDescription),
    '- **Tasks without acceptance criteria:** ' + signal(quality.tasksWithoutAcceptanceCriteria),
    '- **Tasks without a declared write scope:** ' + signal(quality.tasksWithoutWriteScope),
    '- **Components without responsibilities:** ' + signal(quality.componentsWithoutResponsibilities),
    '- **Architecture decisions without alternatives:** ' + signal(quality.decisionsWithoutAlternatives),
    '- **Risks without mitigation:** ' + signal(quality.risksWithoutMitigation),
    '- **Clarifications without a question:** ' + signal(quality.clarificationsWithoutQuestion),
    '- **Unresolved blocking clarifications:** ' + signal(quality.unresolvedBlockingClarifications),
    '',
    '*These are review prompts, not automatic proof of a defective plan. Some may be intentional for the project context.*',
    '',
    '## Requirements',
    requirements.length ? requirements.map(req => '- **' + text(req.id) + '** — ' + text(req.statement) + (req.priority ? ' (priority: ' + text(req.priority) + ')' : '')).join('\n') : '- No requirements recorded.',
    '', '## Architecture', '',
    ...(Array.isArray(plan.architecture?.components) && plan.architecture.components.some(item => item && typeof item === 'object' && !Array.isArray(item))
      ? plan.architecture.components.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(component => '### ' + text(component.name || component.id) + '\n\n' + list(component.responsibilities))
      : ['No architecture components recorded.']),
    ...(Array.isArray(plan.architecture?.dataFlows) && plan.architecture.dataFlows.some(item => item && typeof item === 'object' && !Array.isArray(item))
      ? ['', '### Key data flows', '', ...plan.architecture.dataFlows.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(flow => '- **' + text(flow.from || flow.source) + ' → ' + text(flow.to || flow.target) + ':** ' + text(flow.description || flow.purpose))]
      : []),
    '', '### Architecture decisions', '',
    ...(Array.isArray(plan.architecture?.decisions) && plan.architecture.decisions.some(item => item && typeof item === 'object' && !Array.isArray(item))
      ? plan.architecture.decisions.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(decision => '- **' + text(decision.decision || decision.title) + '** — ' + text(decision.reason || decision.rationale))
      : ['- No explicit decisions recorded.']),
    '', '## Task breakdown', '',
    '| ID | Task | Dependencies | Requirements | Acceptance criteria | Write scope |',
    '|---|---|---|---|---|---|',
    ...(tasks.length ? tasks.map(task => '| ' + text(task.id) + ' | ' + text(task.title) + ' | ' + text((Array.isArray(task.dependencies) ? task.dependencies : []).join(', ') || '—') + ' | ' + text((Array.isArray(task.requirementIds) ? task.requirementIds : []).join(', ') || '—') + ' | ' + text((Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : []).join('; ') || 'Missing') + ' | ' + text((Array.isArray(task.writeScope) ? task.writeScope : []).join(', ') || 'Not specified') + ' |') : ['| — | No tasks | — | — | — | — |']),
    '', '## Task handoff interfaces', '',
    '| Task | Inputs from dependencies | Declared outputs | Consumers |',
    '|---|---|---|---|',
    ...(taskInterfaces.length ? taskInterfaces.map(item => '| ' + text(item.taskId) + ' | ' + text((Array.isArray(item.inputs) ? item.inputs : []).map(input => input.resolved ? input.fromTaskId + ': ' + (Array.isArray(input.outputs) ? input.outputs : []).map(output => output.name).join(', ') : 'MISSING OUTPUT from ' + input.fromTaskId).join('; ') || 'None') + ' | ' + text((Array.isArray(item.outputs) ? item.outputs : []).map(output => output.name).join(', ') || 'None declared') + ' | ' + text((Array.isArray(item.consumers) ? item.consumers : []).join(', ') || 'None') + ' |') : ['| — | No task interfaces | — | — |']),
    '', '## Suggested planning waves', '',
    ...(schedule.waves.length ? schedule.waves.map((wave, index) => '- **Wave ' + (index + 1) + ':** ' + wave.map(text).join(', ')) : ['- No waves could be derived from the supplied task graph.']),
    '', '## Risks', '',
    ...(risks.length ? risks.map(risk => '- **' + text(risk.severity || 'unspecified') + ' — ' + text(risk.id || 'risk') + ':** ' + text(risk.description) + '\n  - Mitigation: ' + text(risk.mitigation || 'Not specified')) : ['- No risks recorded.']),
    '', '## Assumptions', '',
    list(assumptions),
    '',
    '## Unknowns requiring investigation',
    '',
    list(unknowns),
    '', '## Open questions and clarifications', '',
    ...(clarifications.length ? clarifications.map(item => '- **' + (item.blocking ? 'Blocking' : 'Non-blocking') + ':** ' + text(item.question || item.statement || item.id) + (item.resolved ? ' (resolved)' : '')) : ['- No open questions recorded.']),
    '', '## Requirement traceability', '',
    '| Requirement | Mapped tasks | Acceptance evidence in plan |',
    '|---|---|---|',
    ...(traceability.length ? traceability.map(row => '| ' + text(row.requirementId) + ' | ' + text((row.taskIds || []).join(', ') || 'Unmapped') + ' | ' + text((row.acceptanceCriteria || []).map(item => item.statement).join('; ') || 'Not specified') + ' |') : ['| — | Traceability not supplied | — |']),
    '', '## Validation findings', '', list(validation.errors),
    '', '## Validation warnings', '', list(validation.warnings),
    '', '---', '',
    '*This document describes intended engineering work. It is a planning artifact, not evidence that implementation, tests, or deployment have occurred.*', ''
  ];
  return lines.join('\n');
}
