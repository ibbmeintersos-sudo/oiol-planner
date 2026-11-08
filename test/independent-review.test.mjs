import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReview } from '../scripts/validate-independent-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../benchmarks/real-world');
const worklist = JSON.parse(await fs.readFile(path.join(root, 'annotation-worklist.json'), 'utf8'));
const dims = ['directFiles','affectedFiles','tests','packages','apiConsumers','databaseConsumers','migrationFiles','scannerSymbols','dependencyEdges','unknowns','risks'];

function validReview(caseId = worklist.cases[0].caseId, reviewerId = 'reviewer-alpha') {
  return {
    schemaVersion: '1.0.0', caseId, reviewerId,
    independence: { attested: true, conflictOfInterest: false, declaration: 'I did not author, implement, or directly review this historical change.' },
    blinded: true, reviewedAt: '2026-11-08T10:00:00Z',
    scopeSummary: 'Preserve the documented behavior while correcting the request option handling.',
    dimensionCoverage: Object.fromEntries(dims.map(key => [key, 'partial'])),
    groundTruth: { directFiles: ['src/request.ts'], affectedFiles: [], tests: ['test/request.test.ts'], packages: [], apiConsumers: [], databaseConsumers: [], migrationFiles: [], scannerSymbols: [{ file: 'src/request.ts', name: 'createRequest', kind: 'function' }], dependencyEdges: [{ from: 'src/request.ts', to: 'src/options.ts' }], unknowns: ['External adapter behavior is not visible in the pinned snapshot.'], risks: [] },
    evidenceNotes: [{ dimension: 'directFiles', claim: 'Request option normalization is implemented here.', evidence: 'The function reads and forwards dispatcher configuration to the request adapter.', path: 'src/request.ts' }]
  };
}

test('accepts a complete blinded independent review tied to a worklist case', () => {
  const result = validateReview(validReview(), worklist);
  assert.equal(result.ready, true, result.errors.join('\\n'));
});

test('rejects a review that is not blinded or not independent', () => {
  const review = validReview();
  review.blinded = false;
  review.independence.conflictOfInterest = true;
  const result = validateReview(review, worklist);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some(error => error.includes('blinding')));
  assert.ok(result.errors.some(error => error.includes('conflicted')));
});

test('rejects unsafe paths and incomplete evidence', () => {
  const review = validReview();
  review.groundTruth.directFiles = ['../../outside'];
  review.evidenceNotes = [];
  const result = validateReview(review, worklist);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some(error => error.includes('unsafe path')));
  assert.ok(result.errors.some(error => error.includes('evidence note')));
});

test('rejects duplicate reviewer IDs in a paired review', () => {
  const review = validReview('ky-dispatcher-option-ignored', 'reviewer-alpha');
  const other = validReview('ky-dispatcher-option-ignored', 'reviewer-alpha');
  const result = validateReview(review, worklist, other);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some(error => error.includes('distinct reviewer IDs')));
});

test('rejects cases not present in the pinned worklist', () => {
  const result = validateReview(validReview('not-a-real-case'), worklist);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some(error => error.includes('not present in the annotation worklist')));
});
