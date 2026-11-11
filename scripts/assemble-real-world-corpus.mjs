#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fingerprintSnapshot } from './validate-real-world-corpus.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const option = (name, fallback = null) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};

export function sourceCaseIdFor(cases, item) {
  const sharedIndex = item.snapshot?.sharedAcquisitionIndex;
  if (typeof sharedIndex !== "number") return item.caseId;
  const source = cases.find(candidate => candidate.caseIndex === sharedIndex);
  return source ? source.caseId : item.caseId;
}

async function collectSnapshotDirs(directory, found = new Map()) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const metadata = entries.find(entry => entry.isFile() && entry.name === 'snapshot-metadata.json');
  const snapshot = entries.find(entry => entry.isDirectory() && entry.name === 'snapshot');
  if (metadata && snapshot) {
    const record = JSON.parse(await fs.readFile(path.join(directory, metadata.name), "utf8"));
    if (record.caseId) found.set(record.caseId, path.join(directory, snapshot.name));
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await collectSnapshotDirs(path.join(directory, entry.name), found);
  }
  return found;
}

async function fingerprintIfPresent(target) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) return null;
  return fingerprintSnapshot(target);
}

async function placeSnapshot(source, target, { move }) {
  if (move) {
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(source, target);
      return "moved";
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
    }
  }
  await fs.cp(source, target, { recursive: true, verbatimSymlinks: true });
  return "copied";
}

export async function assembleCorpus({ artifactsRoot, corpusRoot, worklistPath }) {
  const worklist = JSON.parse(await fs.readFile(worklistPath, "utf8"));
  const cases = worklist.cases || [];
  const sources = await collectSnapshotDirs(path.resolve(artifactsRoot));
  const snapshotsRoot = path.join(path.resolve(corpusRoot), "snapshots");
  const errors = [];
  const reused = [];
  const assembled = [];
  const demand = new Map();
  for (const item of cases) demand.set(sourceCaseIdFor(cases, item), (demand.get(sourceCaseIdFor(cases, item)) || 0) + 1);
  for (const item of cases) {
    const sourceCaseId = sourceCaseIdFor(cases, item);
    const source = sources.get(sourceCaseId);
    const expected = item.snapshot?.fingerprintSha256;
    if (!source) {
      errors.push(item.caseId + ": missing acquired snapshot for " + sourceCaseId);
      continue;
    }
    const target = path.join(snapshotsRoot, item.caseId);
    const existing = await fingerprintIfPresent(target);
    if (existing && existing.sha256 === expected) {
      assembled.push({ caseId: item.caseId, sourceCaseId, action: "already-present", fileCount: existing.fileCount });
      continue;
    }
    const move = demand.get(sourceCaseId) === 1;
    const action = await placeSnapshot(source, target, { move });
    const fingerprint = await fingerprintSnapshot(target);
    if (fingerprint.sha256 !== expected) {
      errors.push(item.caseId + ": snapshot fingerprint mismatch (expected " + expected + ", got " + fingerprint.sha256 + ")");
      continue;
    }
    if (action !== "already-present") reused.push({ caseId: item.caseId, sourceCaseId, action });
    assembled.push({ caseId: item.caseId, sourceCaseId, action, fileCount: fingerprint.fileCount });
  }
  return { caseCount: cases.length, placed: assembled.length, uniqueSnapshots: sources.size, reused, errors };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

export async function main() {
  const artifactsRoot = option("artifacts-root", path.join(root, "artifacts"));
  const corpusRoot = option("corpus-root");
  if (!corpusRoot) throw new Error('Pass --corpus-root <path>');
  const result = await assembleCorpus({
    artifactsRoot,
    corpusRoot,
    worklistPath: path.join(root, 'benchmarks/real-world/annotation-worklist.json')
  });
  process.stdout.write(JSON.stringify(result, null, 2) + String.fromCharCode(10));
  return result.errors.length ? 2 : 0;
}

if (isMain) {
  main().then(code => process.exitCode = code).catch(error => {
    process.stderr.write(String(error?.message || error) + String.fromCharCode(10));
    process.exitCode = 2;
  });
}
