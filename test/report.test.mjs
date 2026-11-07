import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { renderPlanMarkdown } from '../src/core/report.mjs';
import { buildTraceability } from '../src/core/traceability.mjs';
import { SCHEMA_VERSION, emptyPlan } from '../src/contracts/types.mjs';
import { validatePlan } from '../src/core/validator.mjs';

const plan = {
  schemaVersion: SCHEMA_VERSION,
  id: 'plan_test',
  status: 'ready_for_review',
  project: { kind: 'greenfield', name: 'Sample API', request: 'Create a sample API' },
  requirements: [{ id: 'req_1', statement: 'Users can sign in', priority: 'high' }],
  architecture: {
    components: [{ id: 'cmp_auth', name: 'Authentication', responsibilities: ['Validate credentials'] }],
    decisions: [{ decision: 'Use token sessions', reason: 'Stateless API boundary' }]
  },
  tasks: [{
    id: 'task_1', title: 'Define sign-in contract', requirementIds: ['req_1'],
    componentIds: ['cmp_auth'], dependencies: [], acceptanceCriteria: ['Contract documents success and failure responses'],
    writeScope: ['docs/api']
  }],
  dependencyGraph: { nodes: ['task_1'], edges: [] },
  risks: [{ id: 'risk_1', severity: 'medium', description: 'Session theft', mitigation: 'Short-lived tokens' }],
  clarifications: [{ id: 'q1', question: 'Which identity provider?', blocking: true, resolved: false }],
  validation: { valid: true, errors: [], warnings: [] }
};

test('markdown report includes planning essentials and explicit planning-only disclaimer', () => {
  const markdown = renderPlanMarkdown(plan);
  for (const value of ['Engineering Plan', 'Sample API', 'task_1', 'Wave 1', 'Session theft', 'Which identity provider?', 'Requirement traceability', 'Task handoff interfaces', 'not evidence that implementation']) {
    assert.ok(markdown.includes(value), 'missing report content: ' + value);
  }
});

test('traceability is planning-only and exposes requirement-to-acceptance mapping', () => {
  const trace = buildTraceability(plan);
  assert.equal(trace.mappingCoverage, 1);
  assert.deepEqual(trace.rows[0].taskIds, ['task_1']);
  assert.equal(trace.rows[0].acceptanceCriteria[0].statement, 'Contract documents success and failure responses');
  assert.equal('verificationComplete' in trace, false);
  assert.equal('verified' in trace.rows[0], false);
});

test('empty plans declare the published schema version', () => {
  assert.equal(emptyPlan({ kind: 'greenfield' }).schemaVersion, '1.0.0');
});

test('published plan schema is draft 2020-12 and defines the planning contract', async () => {
  const schema = JSON.parse(await fs.readFile(new URL('../schemas/plan.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schemaVersion.const, SCHEMA_VERSION);
  assert.ok(schema.required.includes('dependencyGraph'));
  assert.ok(schema.required.includes('tasks'));
});

test('published example plan satisfies deterministic planning validation', async () => {
  const example = JSON.parse(await fs.readFile(new URL('../examples/plan.v1.json', import.meta.url), 'utf8'));
  const validation = validatePlan(example, example.project);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(example.schemaVersion, SCHEMA_VERSION);
});
