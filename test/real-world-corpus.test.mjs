import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fingerprintSnapshot, validateCase, validateCorpus } from '../scripts/validate-real-world-corpus.mjs';
import { scanRepository } from '../src/scanner/repository.mjs';

const makeCase = () => ({
  schemaVersion: '1.0.0',
  caseId: 'sample-case-001',
  source: {
    repositoryUrl: 'https://github.com/example/project',
    license: 'MIT',
    licenseFileUrl: 'https://github.com/example/project/blob/' + 'a'.repeat(40) + '/LICENSE',
    baseCommit: 'a'.repeat(40),
    changeCommit: 'b'.repeat(40),
    changeUrl: 'https://github.com/example/project/commit/' + 'b'.repeat(40)
  },
  change: { request: 'change the invoice response contract', category: 'api_change', summary: 'Historical API response change with a traceable downstream consumer.' },
  snapshot: { relativePath: 'snapshots/project/base', sha256: '0'.repeat(64) },
  groundTruth: {
    directFiles: [], affectedFiles: [], tests: [], packages: [], apiConsumers: [],
    databaseConsumers: [], migrationFiles: [], scannerSymbols: [], dependencyEdges: [], unknowns: [], risks: []
  },
  annotation: {
    reviewers: [
      { reviewerId: 'reviewer-a', independent: true, evidenceNotes: ['Reviewed source and change evidence.'] },
      { reviewerId: 'reviewer-b', independent: true, evidenceNotes: ['Independently reviewed consumer evidence.'] }
    ],
    adjudication: { required: false, status: 'not_needed' }
  }
});

test('case validation requires immutable provenance and independent reviewers', () => {
  assert.deepEqual(validateCase(makeCase()), []);
  const invalid = makeCase();
  invalid.source.baseCommit = 'main';
  invalid.annotation.reviewers[1].reviewerId = 'reviewer-a';
  assert.ok(validateCase(invalid).some(message => message.includes('full commit SHA')));
  assert.ok(validateCase(invalid).some(message => message.includes('distinct')));
});

test('snapshot fingerprint is deterministic and content-sensitive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oiol-corpus-'));
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;');
    const first = await fingerprintSnapshot(root);
    assert.deepEqual(await fingerprintSnapshot(root), first);
    await fs.writeFile(path.join(root, 'src', 'a.js'), 'export const a = 2;');
    assert.notEqual((await fingerprintSnapshot(root)).sha256, first.sha256);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('empty corpus is pending, never a passing benchmark', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oiol-empty-corpus-'));
  try {
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: '1.0.0', cases: [] }));
    const blocked = await validateCorpus(root);
    assert.equal(blocked.ready, false);
    assert.equal(blocked.status, 'collection_pending');
    assert.ok(blocked.errors.some(message => message.includes('corpus is empty')));
    const intakeOnly = await validateCorpus(root, { allowEmpty: true });
    assert.equal(intakeOnly.ready, false);
    assert.equal(intakeOnly.status, 'collection_pending');
    assert.equal(intakeOnly.errors.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('scanner does not execute Git commands to inspect target repositories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oiol-readonly-scan-'));
  try {
    await fs.writeFile(path.join(root, 'sample.mjs'), 'export function sample() { return true; }');
    const result = await scanRepository(root, { analysisMode: 'lexical' });
    assert.equal(result.git.status, 'not_collected');
    assert.equal(result.git.commit, null);
    assert.equal(result.git.branch, null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
