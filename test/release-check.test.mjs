import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRelease } from '../scripts/check-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('release check confirms package, changelog, current schema and immutable snapshots agree', async () => {
  const errors = await checkRelease(ROOT);
  assert.deepEqual(errors, []);
});
