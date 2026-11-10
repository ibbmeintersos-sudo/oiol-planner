import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridPlanner } from '../src/core/planner.mjs';

const rawPlan = () => ({
  requirements: [{ id: 'r1', statement: 'Expose the inventory API' }],
  architecture: { components: [{ id: 'c1', name: 'Inventory API' }], decisions: [] },
  tasks: [
    { id: 't1', title: 'Implement the service', requirementIds: ['r1'], componentIds: ['c1'], dependencies: [], acceptanceCriteria: ['The service returns inventory data'], writeScope: ['src/service'], outputs: [{ description: 'Updated service' }] },
    { id: 't2', title: 'Implement the route', requirementIds: ['r1'], componentIds: ['c1'], dependencies: [{ taskId: 't1' }], acceptanceCriteria: ['The route returns inventory data'], writeScope: ['src/routes'], inputs: [{ fromTaskId: 't1', outputName: 'updated service' }] }
  ],
  dependencyGraph: { nodes: [], edges: [] },
  risks: [],
  clarifications: []
});

function createPlanner(raw, project = {}) {
  const provider = { model: 'planner-model', baseUrl: 'https://planner.example', async requestJson() { return { data: raw }; } };
  const reviewer = { model: 'reviewer-model', baseUrl: 'https://reviewer.example', async requestJson() { return { data: { status: 'approved', summary: 'Independent review passed', findings: [] } }; } };
  return new HybridPlanner({ provider, reviewer, maxRepairRounds: 0 }).createPlan(project);
}

test('planner normalizes object dependencies and output references before validation', async () => {
  const plan = await createPlanner(rawPlan());
  assert.equal(plan.validation.valid, true, plan.validation.errors.join('; '));
  assert.deepEqual(plan.tasks[1].dependencies, ['t1']);
  assert.equal(plan.tasks[0].outputs[0].name, 'Updated service');
  assert.equal(plan.tasks[1].inputs[0].outputName, 'Updated service');
  assert.deepEqual(plan.dependencyGraph.edges, [{ from: 't1', to: 't2', type: 'finish_to_start' }]);
});

test('planner unwraps evidence maps and restores supplied provenance', async () => {
  const sourceSha256 = 'a'.repeat(64), excerptSha256 = 'b'.repeat(64);
  const project = {
    kind: 'existing',
    evidence: [{ id: 'REPO-1', type: 'repository_file_excerpt', description: 'Customer route', source: 'src/routes/customers.mjs', trustLevel: 'untrusted_repository_content', sourceSha256, excerptSha256 }]
  };
  const raw = rawPlan();
  raw.evidence = { source: [{ id: 'REPO-1', path: 'src/routes/customers.mjs', sourceSha256, excerptSha256, trustLevel: 'untrusted_repository_content' }] };
  const plan = await createPlanner(raw, project);
  assert.equal(plan.validation.valid, true, plan.validation.errors.join('; '));
  assert.equal(Array.isArray(plan.evidence), true);
  assert.equal(plan.evidence[0].source, 'src/routes/customers.mjs');
  assert.equal(plan.evidence[0].type, 'repository_file_excerpt');
  assert.equal(plan.evidence[0].description, 'Customer route');
});

test('planner keeps unknown evidence identifiers visible to validation', async () => {
  const project = { kind: 'existing', evidence: [{ id: 'REPO-1', type: 'repository_file_excerpt', description: 'Customer route', source: 'src/routes/customers.mjs', trustLevel: 'untrusted_repository_content', sourceSha256: 'a'.repeat(64), excerptSha256: 'b'.repeat(64) }] };
  const raw = rawPlan();
  raw.evidence = [{ id: 'REPO-unknown', source: 'src/unknown.mjs' }];
  const plan = await createPlanner(raw, project);
  assert.equal(plan.validation.valid, false);
  assert.equal(plan.validation.errors.some(error => error.includes('not present in the supplied project evidence')), true);
});
