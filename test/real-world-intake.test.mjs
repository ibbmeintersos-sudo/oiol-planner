import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateIntake } from '../scripts/validate-real-world-intake.mjs';

const inventoryPath = fileURLToPath(new URL('../benchmarks/real-world/intake-candidates.json', import.meta.url));

test('P12 intake contains 12 repositories and 36 pinned historical change candidates', async () => {
  const data = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  const result = validateIntake(data);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.repositoryCount, 12);
  assert.equal(result.caseCandidateCount, 36);
  assert.deepEqual(result.distribution, { small: 4, medium: 4, large: 4 });
});

test('intake validator rejects mutable commit refs and path/count mismatches', async () => {
  const data = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  data.additionalChangeCandidates[0].source.baseCommit = 'main';
  data.additionalChangeCandidates[1].change.historicalChangedPaths.pop();
  const result = validateIntake(data);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('immutable commit pair')));
  assert.ok(result.errors.some(error => error.includes('historical changed-path count')));
});
