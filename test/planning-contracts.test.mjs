import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTaskInterfaces } from '../src/core/task-interface.mjs';
import { comparePlans } from '../src/core/revision.mjs';

test('task interfaces resolve consumer inputs only from explicit producer outputs', () => {
  const plan = { tasks: [
    { id: 'design', title: 'Design API', dependencies: [], outputs: [{ name: 'api-contract', type: 'openapi', description: 'Versioned API contract' }] },
    { id: 'implement', title: 'Implement API', dependencies: ['design'], outputs: ['api-source'], acceptanceCriteria: ['API matches contract'] }
  ] };
  const interfaces = deriveTaskInterfaces(plan);
  assert.equal(interfaces[1].inputs[0].resolved, true);
  assert.equal(interfaces[1].inputs[0].outputs[0].name, 'api-contract');
  assert.deepEqual(interfaces[0].consumers, ['implement']);
});

test('task interfaces expose missing producer outputs instead of inventing placeholder artifacts', () => {
  const interfaces = deriveTaskInterfaces({ tasks: [
    { id: 'a', title: 'A', dependencies: [] },
    { id: 'b', title: 'B', dependencies: ['a'] }
  ] });
  assert.equal(interfaces[1].inputs[0].resolved, false);
  assert.deepEqual(interfaces[1].inputs[0].outputs, []);
});

test('plan changes propagate as replanning impact, not execution reverification', () => {
  const previous = { tasks: [{ id: 'a', dependencies: [] }, { id: 'b', dependencies: ['a'] }] };
  const next = structuredClone(previous);
  next.tasks[0].title = 'Updated design';
  const impact = comparePlans(previous, next);
  assert.deepEqual(impact.replanningRequired, ['a', 'b']);
  assert.equal('reverificationRequired' in impact, false);
});
