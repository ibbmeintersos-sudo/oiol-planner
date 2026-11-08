import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAnnotationWorklist } from '../scripts/validate-annotation-worklist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'benchmarks', 'real-world');
const read = name => fs.readFile(path.join(root, name), 'utf8').then(JSON.parse);

async function fixture() {
  const [intake, primaryReport, additionalReport, batch, worklist] = await Promise.all([
    read('intake-candidates.json'),
    read('acquisition-report.json'),
    read('additional-acquisition-report.json'),
    read('additional-snapshot-batch.json'),
    read('annotation-worklist.json')
  ]);
  return { intake, primaryReport, additionalReport, batch, worklist };
}

test('annotation worklist maps all 36 candidates to 34 verified snapshots', async () => {
  const result = validateAnnotationWorklist(await fixture());
  assert.equal(result.ready, true, result.errors.join('\n'));
  assert.equal(result.caseCount, 36);
  assert.equal(result.uniqueSnapshots, 34);
  assert.equal(result.uniqueArtifacts, 34);
});

test('annotation worklist rejects a changed base commit', async () => {
  const data = await fixture();
  data.worklist.cases[0].baseCommit = 'f'.repeat(40);
  const result = validateAnnotationWorklist(data);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some(error => error.includes('baseCommit differs from intake')));
});

test('annotation worklist rejects prefilled historical paths and labels', async () => {
  const data = await fixture();
  data.worklist.cases[0].historicalChangedPaths = ['src/guess.ts'];
  const result = validateAnnotationWorklist(data);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some(error => error.includes('must not contain historical paths or prefilled ground truth')));
});

test('shared base snapshots map to the same acquired artifact but remain separate cases', async () => {
  const data = await fixture();
  const ripgrepA = data.worklist.cases.find(item => item.caseIndex === 18);
  const ripgrepB = data.worklist.cases.find(item => item.caseIndex === 19);
  const pydanticA = data.worklist.cases.find(item => item.caseIndex === 4);
  const pydanticB = data.worklist.cases.find(item => item.caseIndex === 21);
  assert.equal(ripgrepA.snapshot.artifactId, ripgrepB.snapshot.artifactId);
  assert.equal(pydanticA.snapshot.artifactId, pydanticB.snapshot.artifactId);
  assert.notEqual(ripgrepA.caseId, ripgrepB.caseId);
  assert.notEqual(pydanticA.caseId, pydanticB.caseId);
});
