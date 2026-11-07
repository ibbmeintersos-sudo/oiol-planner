import { topologicalWaves } from './graph.mjs';
import { deriveTaskInterfaces } from './task-interface.mjs';
import { buildTraceability } from './traceability.mjs';

const text = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
const list = values => Array.isArray(values) && values.length ? values.map(value => '- ' + text(value)).join('\n') : '- None recorded';

export function renderPlanMarkdown(plan = {}) {
  const validation = plan.validation || {};
  const evaluation = plan.evaluation?.metrics || {};
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const graph = plan.dependencyGraph || { nodes: [], edges: [] };
  const schedule = topologicalWaves(tasks, Array.isArray(graph.edges) ? graph.edges : []);
  const risks = Array.isArray(plan.risks) ? plan.risks : [];
  const clarifications = Array.isArray(plan.clarifications) ? plan.clarifications : [];
  const requirements = Array.isArray(plan.requirements) ? plan.requirements : [];
  const traceability = plan.traceability?.rows || buildTraceability(plan).rows;
  const taskInterfaces = Array.isArray(plan.taskInterfaces) ? plan.taskInterfaces : deriveTaskInterfaces(plan);
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
    '## Requirements', '',
    requirements.length ? requirements.map(req => '- **' + text(req.id) + '** — ' + text(req.statement) + (req.priority ? ' (priority: ' + text(req.priority) + ')' : '')).join('\n') : '- No requirements recorded.',
    '', '## Architecture', '',
    ...(Array.isArray(plan.architecture?.components) && plan.architecture.components.length
      ? plan.architecture.components.map(component => '### ' + text(component.name || component.id) + '\n\n' + list(component.responsibilities))
      : ['No architecture components recorded.']),
    ...(Array.isArray(plan.architecture?.dataFlows) && plan.architecture.dataFlows.length
      ? ['', '### Key data flows', '', ...plan.architecture.dataFlows.map(flow => '- **' + text(flow.from || flow.source) + ' → ' + text(flow.to || flow.target) + ':** ' + text(flow.description || flow.purpose))]
      : []),
    '', '### Architecture decisions', '',
    ...(Array.isArray(plan.architecture?.decisions) && plan.architecture.decisions.length
      ? plan.architecture.decisions.map(decision => '- **' + text(decision.decision || decision.title) + '** — ' + text(decision.reason || decision.rationale))
      : ['- No explicit decisions recorded.']),
    '', '## Task breakdown', '',
    '| ID | Task | Dependencies | Requirements | Acceptance criteria | Write scope |',
    '|---|---|---|---|---|---|',
    ...(tasks.length ? tasks.map(task => '| ' + text(task.id) + ' | ' + text(task.title) + ' | ' + text((task.dependencies || []).join(', ') || '—') + ' | ' + text((task.requirementIds || []).join(', ') || '—') + ' | ' + text((task.acceptanceCriteria || []).join('; ') || 'Missing') + ' | ' + text((task.writeScope || []).join(', ') || 'Not specified') + ' |') : ['| — | No tasks | — | — | — | — |']),
    '', '## Task handoff interfaces', '',
    '| Task | Inputs from dependencies | Declared outputs | Consumers |',
    '|---|---|---|---|',
    ...(taskInterfaces.length ? taskInterfaces.map(item => '| ' + text(item.taskId) + ' | ' + text((item.inputs || []).map(input => input.resolved ? input.fromTaskId + ': ' + input.outputs.map(output => output.name).join(', ') : 'MISSING OUTPUT from ' + input.fromTaskId).join('; ') || 'None') + ' | ' + text((item.outputs || []).map(output => output.name).join(', ') || 'None declared') + ' | ' + text((item.consumers || []).join(', ') || 'None') + ' |') : ['| — | No task interfaces | — | — |']),
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
