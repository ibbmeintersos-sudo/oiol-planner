#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function validateAnnotationWorklist({ intake, primaryReport, additionalReport, batch, worklist }) {
  const errors = [];
  const candidates = [...(intake?.candidates || []), ...(intake?.additionalChangeCandidates || [])];
  const workCases = worklist?.cases;
  if (!Array.isArray(workCases)) return { ready: false, caseCount: 0, uniqueSnapshots: 0, errors: ['worklist.cases must be an array'] };
  if (worklist.schemaVersion !== '1.0.0') errors.push('worklist schemaVersion must be 1.0.0');
  if (worklist.totalCases !== candidates.length) errors.push('worklist totalCases must match intake candidate count');
  if (workCases.length !== candidates.length) errors.push('worklist case count must match intake candidate count');

  const acquired = new Map([
    ...(primaryReport?.cases || []),
    ...(additionalReport?.cases || [])
  ].map(item => [item.index, item]));
  const sharedIndexToSnapshot = new Map();
  for (const group of batch?.deduplication || []) {
    const indices = group.sharedCaseIndices || [];
    for (const index of indices) sharedIndexToSnapshot.set(index, group.acquisitionIndex);
  }

  const seenIds = new Set();
  const seenIndices = new Set();
  const uniqueSnapshotKeys = new Set();
  const uniqueArtifactKeys = new Set();
  for (const item of workCases) {
    if (!item || typeof item !== 'object') { errors.push('worklist case must be an object'); continue; }
    const index = item.caseIndex;
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      errors.push('caseIndex is outside the intake candidate range');
      continue;
    }
    if (seenIndices.has(index)) errors.push('duplicate caseIndex: ' + index);
    seenIndices.add(index);
    const candidate = candidates[index];
    if (item.caseId !== candidate.caseId) errors.push('caseId does not match intake at index ' + index);
    if (seenIds.has(item.caseId)) errors.push('duplicate caseId: ' + item.caseId);
    seenIds.add(item.caseId);

    const source = candidate.source || {};
    const change = candidate.change || {};
    for (const key of ['repository', 'repositoryUrl', 'repositoryKind', 'sizeClass', 'license', 'licenseFile', 'licenseFileUrl', 'baseCommit', 'changeCommit']) {
      if (item[key] !== source[key]) errors.push(item.caseId + ': ' + key + ' differs from intake');
    }
    if (item.pullRequest !== change.pullRequest || item.pullRequestUrl !== change.url) errors.push(item.caseId + ': pull request provenance differs from intake');
    if (item.pullRequestTitle !== change.title || item.changeCategory !== change.category || item.changeRequest !== change.candidateRequest) {
      errors.push(item.caseId + ': change request metadata differs from intake');
    }
    if (Object.hasOwn(item, 'historicalChangedPaths') || Object.hasOwn(item, 'groundTruth') || Object.hasOwn(item, 'directFiles') || Object.hasOwn(item, 'affectedFiles')) {
      errors.push(item.caseId + ': worklist must not contain historical paths or prefilled ground truth');
    }

    const snapshotIndex = sharedIndexToSnapshot.get(index) ?? index;
    const expected = acquired.get(snapshotIndex);
    if (!expected) { errors.push(item.caseId + ': no acquired snapshot report for index ' + snapshotIndex); continue; }
    const snapshot = item.snapshot || {};
    const expectedRunId = snapshotIndex < 12 ? primaryReport.workflowRun.id : additionalReport.workflowRun.id;
    const expectedArtifactName = 'p12-snapshot-' + snapshotIndex;
    const expectedArtifactUrl = 'https://github.com/ibbmeintersos-sudo/oiol-planner/actions/runs/' + expectedRunId + '/artifacts/' + expected.artifactId;
    const pairs = [
      ['sharedAcquisitionIndex', snapshotIndex],
      ['gitTreeSha', expected.gitTreeSha],
      ['gitTreeFileCount', expected.gitTreeFileCount],
      ['fingerprintSha256', expected.snapshotSha256],
      ['licenseFileSha256', expected.licenseFileSha256],
      ['artifactName', expectedArtifactName],
      ['artifactId', expected.artifactId],
      ['artifactDigest', expected.artifactDigest],
      ['workflowRunId', expectedRunId],
      ['artifactUrl', expectedArtifactUrl]
    ];
    for (const [key, value] of pairs) if (snapshot[key] !== value) errors.push(item.caseId + ': snapshot.' + key + ' does not match acquisition report');
    if (expected.baseCommit !== source.baseCommit) errors.push(item.caseId + ': acquired snapshot base commit differs from intake');
    uniqueSnapshotKeys.add(source.repository + '@' + source.baseCommit);
    uniqueArtifactKeys.add(String(expected.artifactId));
    if (item.annotationStatus !== 'awaiting_independent_review') errors.push(item.caseId + ': annotationStatus must remain pending');
    if (!Array.isArray(item.reviewers) || item.reviewers.length !== 0) errors.push(item.caseId + ': reviewer slots must remain unassigned in the intake worklist');
    if (item.adjudication?.status !== 'pending') errors.push(item.caseId + ': adjudication must remain pending');
    if (item.groundTruthStatus !== 'not_annotated') errors.push(item.caseId + ': groundTruthStatus must remain not_annotated');
  }
  if (seenIndices.size !== candidates.length) errors.push('worklist must contain every intake candidate index exactly once');
  if (uniqueSnapshotKeys.size !== 34) errors.push('expected exactly 34 unique repository/base snapshot pairs');
  if (uniqueArtifactKeys.size !== 34) errors.push('expected exactly 34 unique acquisition artifacts');
  return { ready: errors.length === 0, caseCount: workCases.length, uniqueSnapshots: uniqueSnapshotKeys.size, uniqueArtifacts: uniqueArtifactKeys.size, errors };
}

export async function main() {
  const read = file => fs.readFile(path.join(root, 'benchmarks/real-world', file), 'utf8').then(JSON.parse);
  const [intake, primaryReport, additionalReport, batch, worklist] = await Promise.all([
    read('intake-candidates.json'),
    read('acquisition-report.json'),
    read('additional-acquisition-report.json'),
    read('additional-snapshot-batch.json'),
    read('annotation-worklist.json')
  ]);
  const result = validateAnnotationWorklist({ intake, primaryReport, additionalReport, batch, worklist });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.ready ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Annotation worklist validation error: ' + error.message); process.exitCode = 1; }
}
