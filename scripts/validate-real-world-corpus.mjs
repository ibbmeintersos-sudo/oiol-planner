#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const option = name => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? null : process.argv[index + 1];
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const ignored = new Set(['.git', 'node_modules', '.venv', 'venv', 'vendor', 'dist', 'build', 'coverage']);

export async function fingerprintSnapshot(root) {
  const entries = [];
  async function walk(dir, relative = '') {
    const children = await fs.readdir(dir, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (ignored.has(child.name) || child.isSymbolicLink()) continue;
      const rel = path.posix.join(relative, child.name);
      const full = path.join(dir, child.name);
      if (child.isDirectory()) await walk(full, rel);
      else if (child.isFile()) entries.push({ path: rel, bytes: await fs.readFile(full) });
    }
  }
  await walk(root);
  const hash = createHash('sha256');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of entries) {
    hash.update(entry.path); hash.update(Buffer.from([0]));
    hash.update(entry.bytes); hash.update(Buffer.from([0]));
  }
  return { sha256: hash.digest('hex'), fileCount: entries.length };
}

export function validateCase(item, seen = new Set()) {
  const errors = [];
  if (!item || typeof item !== 'object') return ['case must be an object'];
  if (item.schemaVersion !== '1.0.0') errors.push('schemaVersion must be 1.0.0');
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(item.caseId || '')) errors.push('caseId is invalid');
  if (seen.has(item.caseId)) errors.push('duplicate caseId');
  const source = item.source || {};
  for (const key of ['repositoryUrl', 'license', 'licenseFileUrl', 'changeUrl']) if (!source[key]) errors.push('source.' + key + ' is required');
  for (const key of ['baseCommit', 'changeCommit']) if (!/^[0-9a-f]{40}$/.test(source[key] || '')) errors.push('source.' + key + ' must be a full commit SHA');
  if (source.baseCommit && source.baseCommit === source.changeCommit) errors.push('baseCommit and changeCommit must differ');
  if (typeof item.change?.request !== 'string' || item.change.request.trim().length < 8) errors.push('change.request is too short');
  if (!['source_change','api_change','database_change','migration_change','test_change','cross_component','ambiguous'].includes(item.change?.category)) errors.push('change.category is invalid');
  const snapshot = item.snapshot || {};
  if (!snapshot.relativePath || path.isAbsolute(snapshot.relativePath) || snapshot.relativePath.split(/[\\/]/).includes('..')) errors.push('snapshot.relativePath must be safe and relative');
  if (!/^[0-9a-f]{64}$/.test(snapshot.sha256 || '')) errors.push('snapshot.sha256 must be a SHA-256 fingerprint');
  const truth = item.groundTruth || {};
  for (const key of ['directFiles','affectedFiles','tests','packages','apiConsumers','databaseConsumers','migrationFiles','scannerSymbols','dependencyEdges','unknowns','risks']) {
    if (!Array.isArray(truth[key])) errors.push('groundTruth.' + key + ' must be an array');
  }
  const reviewers = item.annotation?.reviewers || [];
  if (reviewers.length < 2) errors.push('at least two independent reviewers are required');
  const ids = reviewers.map(r => r?.reviewerId).filter(Boolean);
  if (new Set(ids).size !== ids.length) errors.push('reviewer IDs must be distinct');
  for (const reviewer of reviewers) {
    if (reviewer.independent !== true) errors.push('reviewer must attest independence');
    if (!Number.isFinite(Date.parse(reviewer.reviewedAt || ''))) errors.push('reviewer reviewedAt must be a valid timestamp');
    if (!Array.isArray(reviewer.evidenceNotes) || !reviewer.evidenceNotes.length) errors.push('reviewer evidence notes are required');
  }
  const adjudication = item.annotation?.adjudication || {};
  if (adjudication.required === true && adjudication.status !== 'completed') errors.push('required adjudication is incomplete');
  if (adjudication.required !== true && !['not_needed', 'completed'].includes(adjudication.status)) errors.push('adjudication status is invalid');
  return errors;
}

export async function validateCorpus(root, { allowEmpty = false } = {}) {
  const errors = [];
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== '1.0.0') errors.push('manifest schemaVersion must be 1.0.0');
  if (!Array.isArray(manifest.cases)) errors.push('manifest.cases must be an array');
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  if (!cases.length && !allowEmpty) errors.push('corpus is empty; real-world evaluation is not ready');
  const seen = new Set();
  const verified = [];
  for (const record of cases) {
    if (!record?.caseFile) { errors.push('manifest record requires caseFile'); continue; }
    const casePath = path.resolve(root, record.caseFile);
    if (!casePath.startsWith(path.resolve(root) + path.sep)) { errors.push('caseFile escapes corpus root'); continue; }
    try {
      const item = JSON.parse(await fs.readFile(casePath, 'utf8'));
      for (const message of validateCase(item, seen)) errors.push(item.caseId + ': ' + message);
      seen.add(item.caseId);
      const snapshotPath = path.resolve(root, item.snapshot.relativePath);
      if (!snapshotPath.startsWith(path.resolve(root) + path.sep)) { errors.push(item.caseId + ': snapshot path escapes corpus root'); continue; }
      const fingerprint = await fingerprintSnapshot(snapshotPath);
      if (fingerprint.sha256 !== item.snapshot.sha256) errors.push(item.caseId + ': snapshot fingerprint mismatch');
      verified.push({ caseId: item.caseId, fileCount: fingerprint.fileCount, sha256: fingerprint.sha256 });
    } catch (error) {
      errors.push(record.caseFile + ': ' + error.message);
    }
  }
  const ready = cases.length > 0 && errors.length === 0;
  return { ready, status: ready ? 'ready_for_analysis' : cases.length ? 'invalid_corpus' : 'collection_pending', caseCount: cases.length, verified, errors };
}

export async function main() {
  const corpusRoot = option('corpus-root');
  if (!corpusRoot) throw new Error('Pass --corpus-root <path>');
  const result = await validateCorpus(path.resolve(corpusRoot), { allowEmpty: process.argv.includes('--allow-empty') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.ready || (process.argv.includes('--allow-empty') && result.caseCount === 0 && result.errors.length === 0) ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Real-world corpus validation error: ' + error.message); process.exitCode = 1; }
}
