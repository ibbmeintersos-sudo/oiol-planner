import { topologicalWaves } from './graph.mjs';
import { deriveTaskInterfaces } from './task-interface.mjs';
import { buildTraceability } from './traceability.mjs';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (character) {
    return HTML_ESCAPES[character];
  });
}

function plain(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const keys = ['statement', 'description', 'question', 'name', 'title', 'id'];
    for (let index = 0; index < keys.length; index++) {
      const candidate = plain(value[keys[index]]);
      if (candidate) return candidate;
    }
  }
  return '';
}

function text(value) {
  return escapeHtml(plain(value));
}

function objectList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(function (item) { return item && typeof item === 'object' && !Array.isArray(item); });
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(plain).filter(Boolean);
}

function names(value) {
  if (!Array.isArray(value)) return [];
  return value.map(function (item) {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') return plain(item.name || item.path || item.id);
    return plain(item);
  }).filter(Boolean);
}

function percent(value) {
  return Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : 'Not recorded';
}

function displayDate(value) {
  const raw = plain(value);
  if (!raw) return 'Not recorded';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function statusTone(status) {
  const normalized = plain(status).toLowerCase();
  if (normalized === 'ready_for_review' || normalized === 'valid' || normalized === 'ready' || normalized === 'low') return 'good';
  if (normalized === 'needs_revision' || normalized === 'medium' || normalized === 'warn' || normalized === 'warning') return 'warn';
  if (normalized === 'blocked' || normalized === 'invalid' || normalized === 'high' || normalized === 'critical') return 'bad';
  return 'neutral';
}

function badge(label, tone) {
  return '<span class="badge ' + tone + '">' + text(label) + '</span>';
}

function bulletList(values, empty) {
  const items = stringList(values);
  if (!items.length) return '<p class="muted">' + escapeHtml(empty || 'None recorded') + '</p>';
  return '<ul>' + items.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>';
}

function chipList(values, empty) {
  const items = stringList(values);
  if (!items.length) return '<span class="muted">' + escapeHtml(empty || 'None') + '</span>';
  return items.map(function (item) { return '<span class="chip">' + escapeHtml(item) + '</span>'; }).join(' ');
}

function metricCard(label, value, tone) {
  return '<div class="metric ' + (tone || '') + '"><span class="metric-value">' + text(value) + '</span><span class="metric-label">' + text(label) + '</span></div>';
}

function section(id, title, body) {
  return '<section id="' + id + '" class="panel"><h2>' + text(title) + '</h2>' + body + '</section>';
}

const QUALITY_SIGNALS = [
  ['requirementsWithoutAcceptanceCriteria', 'Requirements without acceptance criteria'],
  ['tasksWithoutDescription', 'Tasks without description'],
  ['tasksWithoutAcceptanceCriteria', 'Tasks without acceptance criteria'],
  ['tasksWithoutWriteScope', 'Tasks without write scope'],
  ['componentsWithoutResponsibilities', 'Components without responsibilities'],
  ['decisionsWithoutAlternatives', 'Decisions without alternatives'],
  ['risksWithoutMitigation', 'Risks without mitigation'],
  ['clarificationsWithoutQuestion', 'Clarifications without question'],
  ['unresolvedBlockingClarifications', 'Unresolved blocking clarifications']
];

const CSS = ':root{color-scheme:light;--ink:#17202a;--muted:#5b6770;--line:#d9e0e5;--bg:#f4f6f8;--panel:#fff;--accent:#14532d;--accent-soft:#dcfce7;--warn:#92400e;--warn-soft:#fef3c7;--bad:#991b1b;--bad-soft:#fee2e2;--chip:#eef2f5}' +
'*{box-sizing:border-box}' +
'html{font-size:16px}' +
'body{margin:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.55}' +
'.hero{background:#0f172a;color:#f8fafc;padding:3rem 1.5rem 2.5rem}' +
'.hero .eyebrow{letter-spacing:.14em;text-transform:uppercase;font-size:.72rem;color:#94a3b8;font-weight:700}' +
'.hero h1{margin:.5rem 0 .75rem;font-size:2.2rem;line-height:1.15;max-width:60rem}' +
'.hero .lede{max-width:60rem;color:#cbd5e1;margin:0 0 1.25rem}' +
'.hero-meta{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;font-size:.85rem;color:#cbd5e1}' +
'.hero-meta strong{color:#fff}' +
'main{max-width:72rem;margin:0 auto;padding:1.5rem}' +
'.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.5rem;margin:1rem 0;box-shadow:0 1px 2px rgba(15,23,42,.04)}' +
'.panel h2{margin:0 0 1rem;font-size:1.3rem;letter-spacing:-.01em}' +
'.panel h3{margin:1.25rem 0 .5rem;font-size:1rem}' +
'.panel h4{margin:1rem 0 .35rem;font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}' +
'.notice{border-left:4px solid #b45309;background:#fffbeb;color:#78350f;padding:1rem 1.25rem;border-radius:10px;margin:1rem 0}' +
'.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:.75rem;margin:1rem 0}' +
'.metric{border:1px solid var(--line);border-radius:10px;padding:.8rem .9rem;background:#fbfcfd;display:flex;flex-direction:column;gap:.15rem}' +
'.metric.good{border-color:#86efac;background:#f0fdf4}' +
'.metric.warn{border-color:#fcd34d;background:#fffbeb}' +
'.metric.bad{border-color:#fca5a5;background:#fef2f2}' +
'.metric-value{font-size:1.5rem;font-weight:700;letter-spacing:-.02em}' +
'.metric-label{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}' +
'.badge{display:inline-block;border-radius:999px;padding:.12rem .55rem;font-size:.75rem;font-weight:700;letter-spacing:.02em}' +
'.badge.good{background:var(--accent-soft);color:var(--accent)}' +
'.badge.warn{background:var(--warn-soft);color:var(--warn)}' +
'.badge.bad{background:var(--bad-soft);color:var(--bad)}' +
'.badge.neutral{background:var(--chip);color:var(--muted)}' +
'.chip{display:inline-block;background:var(--chip);border:1px solid var(--line);border-radius:6px;padding:.08rem .4rem;margin:.1rem .15rem .1rem 0;font-size:.78rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}' +
'.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85em}' +
'.muted{color:var(--muted)}' +
'.bad{color:var(--bad);font-weight:600}' +
'.table-wrap{overflow-x:auto;margin:.75rem 0}' +
'table{width:100%;border-collapse:collapse;font-size:.9rem}' +
'th,td{text-align:left;vertical-align:top;padding:.55rem .6rem;border-bottom:1px solid var(--line)}' +
'th{background:#f8fafc;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}' +
'ul{margin:.35rem 0;padding-left:1.2rem}' +
'ul.compact{margin:0}' +
'ul.compact li{margin:.1rem 0}' +
'.findings li{color:var(--bad)}' +
'.card{border:1px solid var(--line);border-radius:10px;padding:1rem;margin:.75rem 0;background:#fbfcfd}' +
'.card h3{margin:0 0 .25rem}' +
'.task header{display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}' +
'.task-meta{display:flex;flex-wrap:wrap;gap:.35rem 1rem;margin:.5rem 0;font-size:.85rem;color:var(--muted)}' +
'.signal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:.5rem;margin:.75rem 0}' +
'.signal{border:1px solid var(--line);border-radius:8px;padding:.6rem .7rem;background:#fbfcfd}' +
'.signal.good{border-color:#bbf7d0}' +
'.signal.warn{border-color:#fde68a;background:#fffdf5}' +
'.signal-label{display:block;font-size:.8rem;font-weight:600;margin-bottom:.3rem}' +
'.signal-value{font-size:.85rem}' +
'.waves{list-style:none;padding:0;margin:.5rem 0;display:flex;flex-direction:column;gap:.5rem}' +
'.waves li{border:1px solid var(--line);border-radius:8px;padding:.55rem .7rem;background:#fbfcfd}' +
'.wave-label{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-right:.4rem}' +
'footer{max-width:72rem;margin:0 auto;padding:1rem 1.5rem 3rem;color:var(--muted);font-size:.85rem}' +
'@media print{body{background:#fff}.hero{background:#fff;color:#111;border-bottom:2px solid #111}.hero .lede,.hero-meta{color:#333}.panel{box-shadow:none;break-inside:avoid;border-color:#bbb}}';

export function renderPlanHtml(plan, options) {
  plan = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : {};
  options = options && typeof options === 'object' ? options : {};
  const project = plan.project && typeof plan.project === 'object' && !Array.isArray(plan.project) ? plan.project : {};
  const architecture = plan.architecture && typeof plan.architecture === 'object' && !Array.isArray(plan.architecture) ? plan.architecture : {};
  const validation = plan.validation && typeof plan.validation === 'object' && !Array.isArray(plan.validation) ? plan.validation : {};
  const evaluation = plan.evaluation && typeof plan.evaluation === 'object' && !Array.isArray(plan.evaluation) ? plan.evaluation : {};
  const metrics = evaluation.metrics && typeof evaluation.metrics === 'object' && !Array.isArray(evaluation.metrics) ? evaluation.metrics : {};
  const quality = evaluation.qualityDiagnostics && typeof evaluation.qualityDiagnostics === 'object' && !Array.isArray(evaluation.qualityDiagnostics) ? evaluation.qualityDiagnostics : {};
  const tasks = objectList(plan.tasks);
  const requirements = objectList(plan.requirements);
  const risks = objectList(plan.risks);
  const clarifications = objectList(plan.clarifications);
  const components = objectList(architecture.components);
  const decisions = objectList(architecture.decisions);
  const dataFlows = objectList(architecture.dataFlows);
  const evidence = objectList(plan.evidence);
  const graph = plan.dependencyGraph && typeof plan.dependencyGraph === 'object' && !Array.isArray(plan.dependencyGraph) ? plan.dependencyGraph : {};
  const schedule = topologicalWaves(tasks, Array.isArray(graph.edges) ? graph.edges : []);
  const waves = Array.isArray(schedule.waves) ? schedule.waves : [];
  const suppliedTraceability = plan.traceability && typeof plan.traceability === 'object' && Array.isArray(plan.traceability.rows) ? objectList(plan.traceability.rows) : [];
  const traceabilityRows = suppliedTraceability.length ? suppliedTraceability : objectList(buildTraceability(plan).rows);
  const suppliedInterfaces = objectList(plan.taskInterfaces);
  const taskInterfaces = suppliedInterfaces.length ? suppliedInterfaces : objectList(deriveTaskInterfaces(plan));

  const validationErrors = stringList(validation.errors);
  const validationWarnings = stringList(validation.warnings);
  const valid = validation.valid === true;
  const coverage = Number.isFinite(metrics.requirementCoverage) ? metrics.requirementCoverage : validation.requirementCoverage;
  const acceptanceCount = Number.isFinite(metrics.acceptanceCriteriaCount) ? metrics.acceptanceCriteriaCount : tasks.reduce(function (total, task) { return total + stringList(task.acceptanceCriteria).length; }, 0);
  const status = plan.status || (valid ? 'ready_for_review' : 'unspecified');
  const projectName = plain(project.name) || plain(plan.id) || 'Engineering plan';
  const documentTitle = plain(options.title) || projectName + ' — OIOL plan review';
  const openQuestions = clarifications.filter(function (item) { return item.resolved !== true; }).length;
  const unmapped = traceabilityRows.filter(function (row) { return plain(row.status).toLowerCase() === 'unmapped'; }).length;

  const hero = '<header class="hero">' +
    '<div class="eyebrow">OIOL · Planning review</div>' +
    '<h1>' + text(projectName) + '</h1>' +
    '<p class="lede">' + text(plan.summary || project.request || 'No executive summary was supplied.') + '</p>' +
    '<div class="hero-meta">' +
      '<span>Plan <strong>' + text(plan.id || 'unspecified') + '</strong></span>' +
      '<span>Status ' + badge(status, statusTone(status)) + '</span>' +
      '<span>Contract ' + (valid ? 'valid' : 'not valid') + '</span>' +
      '<span>Created ' + text(displayDate(plan.metadata && plan.metadata.createdAt)) + '</span>' +
      '<span>Generated ' + text(displayDate(options.generatedAt || new Date().toISOString())) + '</span>' +
    '</div>' +
  '</header>';

  const notice = '<div class="notice"><strong>Planning artifact only.</strong> OIOL does not implement, test, build, deploy, or modify the target project. This report describes intended engineering work; it is not evidence that any task was executed.</div>';

  const metricCards = '<div class="metrics">' +
    metricCard('Validation', valid ? 'Valid' : 'Invalid', valid ? 'good' : 'bad') +
    metricCard('Requirement coverage', percent(coverage), Number.isFinite(coverage) && coverage >= 1 ? 'good' : 'warn') +
    metricCard('Requirements', requirements.length) +
    metricCard('Tasks', tasks.length) +
    metricCard('Acceptance criteria', acceptanceCount) +
    metricCard('Risks', risks.length) +
    metricCard('Open questions', openQuestions) +
    metricCard('Unmapped requirements', unmapped) +
  '</div>';

  const summaryBody = '<p>' + text(plan.summary || project.request || 'No executive summary was supplied.') + '</p>' + metricCards;

  const signalGrid = '<div class="signal-grid">' + QUALITY_SIGNALS.map(function (entry) {
    const values = stringList(quality[entry[0]]);
    return '<div class="signal ' + (values.length ? 'warn' : 'good') + '"><span class="signal-label">' + text(entry[1]) + '</span><span class="signal-value">' + (values.length ? chipList(values) : '<span class="muted">None</span>') + '</span></div>';
  }).join('') + '</div>';

  const validationBody = '<div class="status-line">' + badge(valid ? 'Valid' : 'Invalid', valid ? 'good' : 'bad') + ' <span class="muted">Deterministic semantic and schema validation</span></div>' +
    '<h3>Validation errors</h3>' + (validationErrors.length ? '<ul class="findings">' + validationErrors.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>' : '<p class="muted">No validation errors.</p>') +
    '<h3>Validation warnings</h3>' + bulletList(validationWarnings, 'No validation warnings.') +
    '<h3>Non-blocking quality signals</h3>' + signalGrid +
    '<p class="muted">These are review prompts, not automatic proof of a defective plan. Some may be intentional for the project context.</p>';

  const requirementRows = requirements.length ? requirements.map(function (requirement) {
    return '<tr><td class="mono">' + text(requirement.id || 'REQ') + '</td><td>' + text(requirement.statement) + '</td><td>' + text(requirement.priority || '—') + '</td><td>' + (stringList(requirement.acceptanceCriteria).length ? '<ul class="compact">' + stringList(requirement.acceptanceCriteria).map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>' : '<span class="muted">Missing</span>') + '</td></tr>';
  }).join('') : '<tr><td colspan="4" class="muted">No requirements recorded.</td></tr>';

  const componentHtml = components.length ? components.map(function (component) {
    const interfaces = objectList(component.interfaces);
    const interfaceHtml = interfaces.length ? '<h4>Interfaces</h4><ul>' + interfaces.map(function (item) {
      return '<li>' + text(item.name || item.id || 'Interface') + (plain(item.protocol) ? ' · ' + text(item.protocol) : '') + (plain(item.format) ? ' · ' + text(item.format) : '') + '</li>';
    }).join('') + '</ul>' : '';
    return '<article class="card"><h3>' + text(component.name || component.id || 'Component') + '</h3>' +
      (plain(component.id) ? '<p class="mono muted">' + text(component.id) + '</p>' : '') +
      (plain(component.description) ? '<p>' + text(component.description) + '</p>' : '') +
      '<h4>Responsibilities</h4>' + bulletList(component.responsibilities) + interfaceHtml + '</article>';
  }).join('') : '<p class="muted">No architecture components recorded.</p>';

  const decisionRows = decisions.length ? decisions.map(function (decision) {
    const alternatives = stringList(decision.alternatives);
    return '<tr><td>' + text(decision.decision || decision.title) + '</td><td>' + text(decision.reason || decision.rationale) + '</td><td>' + (alternatives.length ? alternatives.map(escapeHtml).join('; ') : '<span class="muted">None recorded</span>') + '</td></tr>';
  }).join('') : '<tr><td colspan="3" class="muted">No explicit decisions recorded.</td></tr>';

  const flowRows = dataFlows.length ? dataFlows.map(function (flow) {
    return '<tr><td>' + text(flow.from || flow.source) + '</td><td>' + text(flow.to || flow.target) + '</td><td>' + text(flow.description || flow.purpose) + '</td></tr>';
  }).join('') : '<tr><td colspan="3" class="muted">No data flows recorded.</td></tr>';

  const taskRows = tasks.length ? tasks.map(function (task) {
    return '<tr><td class="mono">' + text(task.id || 'TASK') + '</td><td><strong>' + text(task.title || 'Untitled task') + '</strong>' + (plain(task.description) ? '<div class="muted">' + text(task.description) + '</div>' : '') + '</td><td>' + chipList(task.dependencies, 'None') + '</td><td>' + chipList(task.requirementIds, 'None') + '</td><td>' + chipList(task.writeScope, 'Not specified') + '</td><td>' + stringList(task.acceptanceCriteria).length + '</td></tr>';
  }).join('') : '<tr><td colspan="6" class="muted">No tasks recorded.</td></tr>';

  const taskDetails = tasks.map(function (task) {
    return '<article class="card task"><header><span class="mono">' + text(task.id || 'TASK') + '</span><h3>' + text(task.title || 'Untitled task') + '</h3></header>' +
      (plain(task.description) ? '<p>' + text(task.description) + '</p>' : '') +
      '<div class="task-meta">' +
        '<span>Dependencies: ' + chipList(task.dependencies, 'None') + '</span>' +
        '<span>Requirements: ' + chipList(task.requirementIds, 'None') + '</span>' +
        '<span>Components: ' + chipList(task.componentIds, 'None') + '</span>' +
        '<span>Outputs: ' + chipList(names(task.outputs), 'None declared') + '</span>' +
      '</div>' +
      '<h4>Acceptance criteria</h4>' + bulletList(task.acceptanceCriteria, 'Missing') +
      '<h4>Write scope</h4>' + chipList(task.writeScope, 'Not specified') +
    '</article>';
  }).join('');

  let wavesHtml;
  if (schedule.cycle) wavesHtml = '<p class="bad">A dependency cycle was detected. Planning waves cannot be derived until the cycle is resolved.</p>';
  else if (schedule.error) wavesHtml = '<p class="bad">' + text(schedule.error) + '</p>';
  else if (waves.length) wavesHtml = '<ol class="waves">' + waves.map(function (wave, index) {
    return '<li><span class="wave-label">Wave ' + (index + 1) + '</span>' + chipList(wave) + '</li>';
  }).join('') + '</ol>';
  else wavesHtml = '<p class="muted">No planning waves could be derived from the supplied task graph.</p>';

  const interfaceRows = taskInterfaces.length ? taskInterfaces.map(function (item) {
    const inputs = objectList(item.inputs).map(function (input) {
      if (input.resolved === false) return '<span class="bad">Missing output from ' + text(input.fromTaskId) + '</span>';
      return text(input.fromTaskId) + ' → ' + chipList(names(input.outputs));
    }).join('<br>') || '<span class="muted">None</span>';
    return '<tr><td class="mono">' + text(item.taskId) + '</td><td>' + inputs + '</td><td>' + chipList(names(item.outputs), 'None declared') + '</td><td>' + chipList(item.consumers, 'None') + '</td></tr>';
  }).join('') : '<tr><td colspan="4" class="muted">No task interfaces recorded.</td></tr>';

  const traceabilityRowsHtml = traceabilityRows.length ? traceabilityRows.map(function (row) {
    const criteria = stringList(row.acceptanceCriteria);
    return '<tr><td class="mono">' + text(row.requirementId || 'REQ') + '</td><td>' + text(row.statement) + '</td><td>' + chipList(row.taskIds, 'Unmapped') + '</td><td>' + (criteria.length ? criteria.map(escapeHtml).join('; ') : '<span class="muted">Not specified</span>') + '</td><td>' + badge(row.status === 'unmapped' ? 'Unmapped' : 'Mapped', row.status === 'unmapped' ? 'warn' : 'good') + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="muted">Traceability not supplied.</td></tr>';

  const riskRows = risks.length ? risks.map(function (risk) {
    return '<tr><td class="mono">' + text(risk.id || 'RISK') + '</td><td>' + badge(risk.severity || 'unspecified', statusTone(risk.severity)) + '</td><td>' + text(risk.description) + (plain(risk.mitigation) ? '<div class="muted">Mitigation: ' + text(risk.mitigation) + '</div>' : '') + '</td></tr>';
  }).join('') : '<tr><td colspan="3" class="muted">No risks recorded.</td></tr>';

  const clarificationItems = clarifications.length ? clarifications.map(function (item) {
    return '<li>' + badge(item.blocking ? 'Blocking' : 'Non-blocking', item.blocking ? 'bad' : 'neutral') + ' ' + text(item.question || item.statement || item.id) + (item.resolved ? ' ' + badge('Resolved', 'good') : '') + '</li>';
  }).join('') : '<li class="muted">No open questions recorded.</li>';

  const evidenceRows = evidence.length ? evidence.map(function (item) {
    return '<tr><td class="mono">' + text(item.id || 'EV') + '</td><td>' + text(item.type || '—') + '</td><td>' + text(item.description) + '</td><td>' + text(item.source || '—') + '</td><td>' + text(item.trustLevel || '—') + '</td></tr>';
  }).join('') : '<tr><td colspan="5" class="muted">No evidence records supplied.</td></tr>';

  const lines = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">',
    '<title>' + escapeHtml(documentTitle) + '</title>',
    '<style>' + CSS + '</style>',
    '</head>',
    '<body>',
    hero,
    '<main>',
    notice,
    section('summary', 'Executive summary', summaryBody),
    section('validation', 'Validation and plan quality', validationBody),
    section('requirements', 'Requirements', '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Statement</th><th>Priority</th><th>Acceptance criteria</th></tr></thead><tbody>' + requirementRows + '</tbody></table></div>'),
    section('architecture', 'Architecture', componentHtml +
      '<h3>Architecture decisions</h3><div class="table-wrap"><table><thead><tr><th>Decision</th><th>Reason</th><th>Alternatives</th></tr></thead><tbody>' + decisionRows + '</tbody></table></div>' +
      '<h3>Key data flows</h3><div class="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Description</th></tr></thead><tbody>' + flowRows + '</tbody></table></div>'),
    section('tasks', 'Task breakdown', '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Task</th><th>Dependencies</th><th>Requirements</th><th>Write scope</th><th>Criteria</th></tr></thead><tbody>' + taskRows + '</tbody></table></div><h3>Task detail</h3>' + (taskDetails || '<p class="muted">No tasks recorded.</p>')),
    section('waves', 'Suggested planning waves', wavesHtml),
    section('handoff', 'Task handoff interfaces', '<div class="table-wrap"><table><thead><tr><th>Task</th><th>Inputs from dependencies</th><th>Declared outputs</th><th>Consumers</th></tr></thead><tbody>' + interfaceRows + '</tbody></table></div>'),
    section('traceability', 'Requirement traceability', '<div class="table-wrap"><table><thead><tr><th>Requirement</th><th>Statement</th><th>Mapped tasks</th><th>Acceptance evidence</th><th>Status</th></tr></thead><tbody>' + traceabilityRowsHtml + '</tbody></table></div>'),
    section('risks', 'Risks', '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Severity</th><th>Risk and mitigation</th></tr></thead><tbody>' + riskRows + '</tbody></table></div>'),
    section('context', 'Assumptions, unknowns, and open questions', '<h3>Assumptions</h3>' + bulletList(plan.assumptions) + '<h3>Unknowns requiring investigation</h3>' + bulletList(plan.unknowns) + '<h3>Open questions and clarifications</h3><ul>' + clarificationItems + '</ul>'),
    section('evidence', 'Evidence', '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Type</th><th>Description</th><th>Source</th><th>Trust level</th></tr></thead><tbody>' + evidenceRows + '</tbody></table></div>'),
    '</main>',
    '<footer><p><strong>OIOL</strong> — planning-only engineering review. No project tasks were executed. This report is a planning artifact, not evidence of implementation, testing, or deployment.</p></footer>',
    '</body>',
    '</html>'
  ];
  return lines.join('\n') + '\n';
}
