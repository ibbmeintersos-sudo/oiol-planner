#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const inventoryPath = fileURLToPath(new URL('../benchmarks/real-world/intake-candidates.json', import.meta.url));

export function validateIntake(data) {
  const errors = [];
  if (data?.schemaVersion !== '1.0.0') errors.push('schemaVersion must be 1.0.0');
  const initial = Array.isArray(data?.candidates) ? data.candidates : [];
  const additional = Array.isArray(data?.additionalChangeCandidates) ? data.additionalChangeCandidates : [];
  const all = [...initial, ...additional];
  if (initial.length !== 12) errors.push('initial repository batch must contain 12 cases');
  if (additional.length !== 24) errors.push('additional change batch must contain 24 cases');
  if (all.length !== 36) errors.push('intake must contain 36 historical change candidates');
  if (data?.caseCandidateCount !== all.length) errors.push('caseCandidateCount does not match inventory');
  if (data?.targetDistribution?.small !== 4 || data?.targetDistribution?.medium !== 4 || data?.targetDistribution?.large !== 4) {
    errors.push('target repository distribution must be 4 small / 4 medium / 4 large');
  }
  const ids = new Set();
  const perRepo = new Map();
  const repoClass = new Map();
  for (const item of all) {
    const id = item?.caseId;
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id || '')) errors.push((id || '<missing>') + ': invalid caseId');
    if (ids.has(id)) errors.push(id + ': duplicate caseId');
    ids.add(id);
    const source = item?.source || {};
    const change = item?.change || {};
    const repo = source.repository;
    if (!repo || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repositoryUrl || '')) errors.push(id + ': repository provenance is invalid');
    if (repo) perRepo.set(repo, (perRepo.get(repo) || 0) + 1);
    if (!/^[0-9a-f]{40}$/.test(source.baseCommit || '') || !/^[0-9a-f]{40}$/.test(source.changeCommit || '') || source.baseCommit === source.changeCommit) errors.push(id + ': immutable commit pair is invalid');
    if (!source.license || !source.licenseFile || !source.licenseFileUrl?.includes(source.baseCommit || '')) errors.push(id + ': license provenance is incomplete or not pinned to base');
    if (!['small','medium','large'].includes(source.sizeClass)) errors.push(id + ': invalid sizeClass');
    const count = source.trackedFileCountAtBase;
    const validSize = source.sizeClass === 'small' ? count <= 2000 : source.sizeClass === 'medium' ? count > 2000 && count <= 20000 : count > 20000;
    if (!Number.isInteger(count) || !validSize) errors.push(id + ': size class does not match pinned tracked-file count');
    if (!Array.isArray(source.primaryLanguages) || !source.primaryLanguages.length) errors.push(id + ': primaryLanguages is required');
    if (!Number.isInteger(change.pullRequest) || !change.url?.endsWith('/pull/' + change.pullRequest)) errors.push(id + ': pull request URL is invalid');
    if (!Number.isFinite(Date.parse(change.mergedAt || ''))) errors.push(id + ': mergedAt is invalid');
    if (typeof change.candidateRequest !== 'string' || change.candidateRequest.length < 20) errors.push(id + ': candidateRequest is missing');
    if (!Array.isArray(change.historicalChangedPaths) || change.historicalChangedPaths.length !== change.changedFileCount) errors.push(id + ': historical changed-path count does not match PR metadata');
    const paths = change.historicalChangedPaths || [];
    if (new Set(paths).size !== paths.length || paths.some(p => typeof p !== 'string' || path.posix.isAbsolute(p) || p.split('/').includes('..'))) errors.push(id + ': historical paths are duplicated or unsafe');
    if (!['source_change','api_change','database_change','migration_change','test_change','cross_component','ambiguous'].includes(change.category)) errors.push(id + ': unsupported change category');
    const previous = repoClass.get(repo);
    if (previous && previous !== source.sizeClass) errors.push(repo + ': inconsistent size class across cases');
    repoClass.set(repo, source.sizeClass);
  }
  if (perRepo.size !== 12) errors.push('exactly 12 unique repositories are required');
  for (const [repo, count] of perRepo) if (count !== 3) errors.push(repo + ': expected exactly three candidate changes, got ' + count);
  const distribution = { small: 0, medium: 0, large: 0 };
  for (const [repo, sizeClass] of repoClass) distribution[sizeClass]++;
  for (const key of Object.keys(distribution)) if (distribution[key] !== data.targetDistribution?.[key]) errors.push('actual ' + key + ' repository count does not match target distribution');
  return { valid: errors.length === 0, repositoryCount: perRepo.size, caseCandidateCount: all.length, distribution, errors };
}

export async function main() {
  const data = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  const result = validateIntake(data);
  process.stdout.write(JSON.stringify(result, null, 2) + '\\n');
  return result.valid ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Real-world intake validation error: ' + error.message); process.exitCode = 1; }
}
