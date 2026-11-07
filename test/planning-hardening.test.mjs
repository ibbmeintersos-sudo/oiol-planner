import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePlan } from '../src/core/validator.mjs';
import { dependencyEdgesFromTasks, topologicalWaves } from '../src/core/graph.mjs';
import { deriveTaskInterfaces } from '../src/core/task-interface.mjs';
import { evaluatePlan } from '../src/core/evaluate.mjs';
import { scanRepository } from '../src/scanner/repository.mjs';
import { renderPlanMarkdown } from '../src/core/report.mjs';
import { redact } from '../src/core/utils.mjs';
import { validatePlanSchema } from '../src/core/schema-validator.mjs';
import { analyzeProject } from '../src/analyzer/project-analyzer.mjs';
import { buildTraceability } from '../src/core/traceability.mjs';

const validPlan = () => ({
  schemaVersion: '1.0.0',
  id: 'plan_hardening',
  status: 'needs_revision',
  project: { kind: 'greenfield', name: 'Hardening fixture' },
  requirements: [{ id: 'r1', statement: 'Expose a stable API' }],
  architecture: { components: [{ id: 'c1', name: 'API' }], decisions: [] },
  tasks: [{
    id: 't1', title: 'Define API contract', requirementIds: ['r1'], componentIds: ['c1'],
    dependencies: [], acceptanceCriteria: ['The contract defines the response'], writeScope: ['docs/api']
  }],
  dependencyGraph: { nodes: ['t1'], edges: [] },
  risks: [],
  clarifications: []
});

test('malformed task dependencies never crash graph derivation', () => {
  assert.deepEqual(dependencyEdgesFromTasks([{ id: 't1', dependencies: 'not-an-array' }]), []);
  assert.equal(topologicalWaves([{ id: 't1', dependencies: 'not-an-array' }], []).waves.length, 1);
  assert.equal(topologicalWaves([null], []).error, 'invalid_task_id');
  assert.equal(topologicalWaves([{ id: 't1' }], [null]).error, 'invalid_edge');
});

test('validator reports malformed dependency arrays instead of throwing', () => {
  const plan = validPlan();
  plan.tasks[0].dependencies = 't2';
  assert.doesNotThrow(() => validatePlan(plan));
  assert.equal(validatePlan(plan).valid, false);
});

test('evaluation and handoff interfaces tolerate malformed task entries', () => {
  const plan = validPlan();
  plan.tasks.push(null);
  assert.doesNotThrow(() => evaluatePlan(plan));
  assert.equal(deriveTaskInterfaces(plan).length, 1);
});

test('repository snippets carry verifiable source and excerpt fingerprints', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-provenance-'));
  try {
    await mkdir(path.join(root, 'src'));
    const source = 'export const api_key = "sk-123456789012345678901234567890";\nexport const value = 1;\n';
    await writeFile(path.join(root, 'src', 'index.js'), source);
    const result = await scanRepository(root);
    const snippet = result.snippets.find(item => item.path === 'src/index.js');
    assert.ok(snippet);
    assert.match(snippet.id, /^REPO-[a-f0-9]{12}$/);
    assert.equal(snippet.sourceSha256, createHash('sha256').update(source).digest('hex'));
    assert.equal(snippet.excerptSha256, createHash('sha256').update(snippet.content).digest('hex'));
    assert.equal(snippet.sha256, snippet.sourceSha256);
    assert.equal(snippet.redactionChangedContent, true);
    assert.doesNotMatch(snippet.content, /sk-123456789012345678901234567890/);
    assert.match(result.context, new RegExp(snippet.id));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Markdown reporting remains available for structurally malformed plans', () => {
  const plan = validPlan();
  plan.tasks.push(null);
  plan.architecture.components.push(null);
  assert.doesNotThrow(() => renderPlanMarkdown(plan));
  assert.match(renderPlanMarkdown(plan), /Define API contract/);
});

test('planning-only validator rejects execution state at plan and task levels', () => {
  const rootState = validPlan();
  rootState.execution = { status: 'completed' };
  assert.equal(validatePlan(rootState).valid, false);
  const taskState = validPlan();
  taskState.tasks[0].status = 'completed';
  assert.equal(validatePlan(taskState).valid, false);
});

test('secret redaction handles quoted JSON keys, YAML assignments, and bearer headers', () => {
  const source = '{"api_key":"super secret with spaces","password":"p@ss"}\nAPI_KEY=plain-secret\nAuthorization: Bearer header-secret-value';
  const safe = redact(source);
  for (const secret of ['super secret with spaces', 'p@ss', 'plain-secret', 'header-secret-value']) {
    assert.equal(safe.includes(secret), false, 'secret leaked: ' + secret);
  }
  assert.match(safe, /\[REDACTED\]/);
});

test('quality diagnostics identify review gaps without converting them into hidden scores', () => {
  const plan = validPlan();
  plan.tasks[0].description = '';
  plan.tasks[0].acceptanceCriteria = [];
  plan.tasks[0].writeScope = [];
  plan.architecture.components[0].responsibilities = [];
  plan.architecture.decisions = [{ id: 'd1', decision: 'Use a modular boundary' }];
  plan.risks = [{ id: 'risk1', description: 'Provider choice is unknown' }];
  plan.clarifications = [{ id: 'q1', question: 'Which provider?', blocking: true, resolved: false }];
  const result = evaluatePlan(plan);
  assert.deepEqual(result.qualityDiagnostics.tasksWithoutDescription, ['t1']);
  assert.deepEqual(result.qualityDiagnostics.tasksWithoutAcceptanceCriteria, ['t1']);
  assert.deepEqual(result.qualityDiagnostics.tasksWithoutWriteScope, ['t1']);
  assert.deepEqual(result.qualityDiagnostics.componentsWithoutResponsibilities, ['c1']);
  assert.deepEqual(result.qualityDiagnostics.decisionsWithoutAlternatives, ['d1']);
  assert.deepEqual(result.qualityDiagnostics.risksWithoutMitigation, ['risk1']);
  assert.deepEqual(result.qualityDiagnostics.unresolvedBlockingClarifications, ['q1']);
});

test('Markdown report includes non-blocking plan quality diagnostics', () => {
  const plan = validPlan();
  plan.tasks[0].description = '';
  plan.evaluation = evaluatePlan(plan);
  const markdown = renderPlanMarkdown(plan);
  assert.match(markdown, /Non-blocking quality review signals/);
  assert.match(markdown, /Tasks without descriptions:\*\* t1/);
});

test('published JSON Schema validates the example and rejects missing required contract fields', async () => {
  const example = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../examples/plan.v1.json', import.meta.url), 'utf8'));
  const valid = await validatePlanSchema(example);
  assert.equal(valid.valid, true, valid.errors.join('\n'));
  const invalid = structuredClone(example);
  delete invalid.status;
  const result = await validatePlanSchema(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('status')));
});

test('published JSON Schema rejects execution state in plans and tasks', async () => {
  const example = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../examples/plan.v1.json', import.meta.url), 'utf8'));
  const rootState = structuredClone(example);
  rootState.execution = { status: 'completed' };
  assert.equal((await validatePlanSchema(rootState)).valid, false);
  const taskState = structuredClone(example);
  taskState.tasks[0].status = 'completed';
  assert.equal((await validatePlanSchema(taskState)).valid, false);
});

test('analyzer evidence IDs and hashes match the exact scanner excerpts supplied to the planner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-analyzer-evidence-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'service.mjs'), 'export const value = 42;\n');
    const project = await analyzeProject({ mode: 'existing', repo: root, request: 'Review this service' });
    const snippet = project.repository.snippets.find(item => item.path === 'src/service.mjs');
    const evidence = project.evidence.find(item => item.source === 'src/service.mjs');
    assert.ok(snippet);
    assert.ok(evidence);
    assert.equal(evidence.id, snippet.id);
    assert.equal(evidence.sourceSha256, snippet.sourceSha256);
    assert.equal(evidence.excerptSha256, snippet.excerptSha256);
    assert.equal(evidence.trustLevel, 'untrusted_repository_content');
    assert.match(project.repository.context, new RegExp(evidence.id));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('null plan input is reported safely by evaluation, traceability, interfaces, and Markdown', () => {
  assert.doesNotThrow(() => evaluatePlan(null));
  assert.deepEqual(deriveTaskInterfaces(null), []);
  assert.doesNotThrow(() => buildTraceability(null));
  assert.doesNotThrow(() => renderPlanMarkdown(null));
  assert.equal(evaluatePlan(null).validation.valid, false);
});

test('evidence citations must resolve to supplied project evidence and preserve fingerprints', () => {
  const plan = validPlan();
  const evidence = {
    id: 'REPO-0123456789ab',
    type: 'repository_file_excerpt',
    description: 'Redacted source excerpt',
    source: 'src/service.mjs',
    trustLevel: 'untrusted_repository_content',
    sourceSha256: 'a'.repeat(64),
    excerptSha256: 'b'.repeat(64)
  };
  const project = { kind: 'existing', evidence: [evidence] };
  plan.evidence = [{ ...evidence }];
  assert.equal(validatePlan(plan, project).valid, true);
  plan.evidence[0].excerptSha256 = 'c'.repeat(64);
  assert.ok(validatePlan(plan, project).errors.some(error => error.includes('excerpt fingerprint')));
  plan.evidence[0] = { ...evidence, id: 'REPO-UNKNOWN' };
  assert.ok(validatePlan(plan, project).errors.some(error => error.includes('not present')));
});

test('existing repository plans without citations receive an explicit review warning', () => {
  const plan = validPlan();
  const project = { kind: 'existing', evidence: [{ id: 'REPO-1', type: 'repository_file_excerpt', source: 'src/a.mjs' }] };
  const result = validatePlan(plan, project);
  assert.ok(result.warnings.some(warning => warning.includes('no explicit evidence citations')));
});

test('repository evidence citations require both exact source and excerpt fingerprints', () => {
  const plan = validPlan();
  const evidence = {
    id: 'REPO-0123456789ab',
    type: 'repository_file_excerpt',
    description: 'Redacted source excerpt',
    source: 'src/service.mjs',
    trustLevel: 'untrusted_repository_content',
    sourceSha256: 'a'.repeat(64),
    excerptSha256: 'b'.repeat(64)
  };
  const project = { kind: 'existing', evidence: [evidence] };
  plan.evidence = [{ id: evidence.id, type: evidence.type, description: evidence.description, source: evidence.source, trustLevel: evidence.trustLevel }];
  const result = validatePlan(plan, project);
  assert.ok(result.errors.some(error => error.includes('exact source fingerprint')));
  assert.ok(result.errors.some(error => error.includes('exact excerpt fingerprint')));
});
