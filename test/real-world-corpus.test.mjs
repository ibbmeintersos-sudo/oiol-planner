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
    changeUrl: 'https://github.com/example/project/commit/' + 'b'.repeat(40),
    sizeClass: 'small',
    repositoryKind: 'library'
  },
  change: { request: 'change the invoice response contract', category: 'api_change', summary: 'Historical API response change with a traceable downstream consumer.' },
  snapshot: { relativePath: 'snapshots/project/base', sha256: '0'.repeat(64) },
  groundTruth: {
    directFiles: [], affectedFiles: [], tests: [], packages: [], apiConsumers: [],
    databaseConsumers: [], migrationFiles: [], scannerSymbols: [], dependencyEdges: [], unknowns: [], risks: []
  },
  annotation: {
    reviewers: [
      { reviewerId: 'reviewer-a', independent: true, blinded: true, reviewedAt: '2026-11-01T00:00:00Z', evidenceNotes: ['Reviewed source and change evidence.'] },
      { reviewerId: 'reviewer-b', independent: true, blinded: true, reviewedAt: '2026-11-02T00:00:00Z', evidenceNotes: ['Independently reviewed consumer evidence.'] }
    ],
    adjudication: { required: false, status: 'not_needed', rationale: 'Both independent reviewers agreed on all annotated impact sets.' }
  }
});

test('case validation requires immutable provenance and independent blinded reviewers', () => {
  assert.deepEqual(validateCase(makeCase()), []);
  const invalid = makeCase();
  invalid.source.baseCommit = 'main';
  invalid.annotation.reviewers[1].reviewerId = 'reviewer-a';
  invalid.annotation.reviewers[0].blinded = false;
  const errors = validateCase(invalid);
  assert.ok(errors.some(message => message.includes('full commit SHA')));
  assert.ok(errors.some(message => message.includes('distinct')));
  assert.ok(errors.some(message => message.includes('blinding')));
});

test('case validation rejects unsafe ground-truth paths and unsupported adjudication states', () => {
  const invalid = makeCase();
  invalid.groundTruth.affectedFiles = ['../outside.js'];
  invalid.annotation.adjudication = { required: true, status: 'pending' };
  const errors = validateCase(invalid);
  assert.ok(errors.some(message => message.includes('unsafe relative path')));
  assert.ok(errors.some(message => message.includes('adjudication is incomplete')));
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

test('non-empty corpus below real-world acceptance thresholds is not ready', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oiol-underfilled-corpus-'));
  try {
    const snapshot = path.join(root, 'snapshots', 'project', 'base');
    await fs.mkdir(snapshot, { recursive: true });
    await fs.writeFile(path.join(snapshot, 'sample.js'), 'export const sample = true;');
    const item = makeCase();
    item.snapshot.sha256 = (await fingerprintSnapshot(snapshot)).sha256;
    await fs.mkdir(path.join(root, 'cases'), { recursive: true });
    await fs.writeFile(path.join(root, 'cases', 'sample-case-001.json'), JSON.stringify(item));
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      schemaVersion: '1.0.0',
      corpusVersion: '0.1.0',
      cases: [{ caseFile: 'cases/sample-case-001.json' }]
    }));
    const result = await validateCorpus(root);
    assert.equal(result.ready, false);
    assert.equal(result.status, 'invalid_corpus');
    assert.ok(result.errors.some(message => message.includes('at least 30')));
    assert.ok(result.errors.some(message => message.includes('at least 12 unique repositories')));
    assert.ok(result.errors.some(message => message.includes('small repositories')));
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
