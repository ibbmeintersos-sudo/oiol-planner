#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dimensions = ['directFiles','affectedFiles','tests','packages','apiConsumers','databaseConsumers','migrationFiles','scannerSymbols','dependencyEdges','unknowns','risks'];

export function buildReviewPackets({ worklist, reviewerIds = ['R1', 'R2'] }) {
  const errors = [];
  if (worklist?.schemaVersion !== '1.0.0') errors.push('worklist schemaVersion must be 1.0.0');
  if (!Array.isArray(worklist?.cases)) return { ready: false, caseCount: 0, packetCount: 0, packets: [], assignments: null, errors: [...errors, 'worklist.cases must be an array'] };
  if (!Array.isArray(reviewerIds) || reviewerIds.length !== 2 || new Set(reviewerIds).size !== 2) {
    errors.push('exactly two distinct reviewer IDs are required');
  }
  const cases = worklist.cases;
  if (cases.length !== worklist.totalCases) errors.push('worklist case count must match totalCases');
  const packets = [];
  const assignments = [];
  for (const item of cases) {
    if (!item || typeof item !== 'object') { errors.push('worklist contains a non-object case'); continue; }
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(item.caseId || '')) errors.push('invalid caseId: ' + item.caseId);
    if (Object.hasOwn(item, 'historicalChangedPaths') || Object.hasOwn(item, 'groundTruth') || Object.hasOwn(item, 'directFiles') || Object.hasOwn(item, 'affectedFiles')) {
      errors.push(item.caseId + ': worklist must not contain historical paths or prefilled ground truth');
    }
    if (item.annotationStatus !== 'awaiting_independent_review') errors.push(item.caseId + ': annotationStatus must be awaiting_independent_review');
    if (!Array.isArray(item.reviewers) || item.reviewers.length !== 0) errors.push(item.caseId + ': reviewer slots must remain unassigned');
    if (item.groundTruthStatus !== 'not_annotated') errors.push(item.caseId + ': groundTruthStatus must be not_annotated');
    if (item.adjudication?.status !== 'pending') errors.push(item.caseId + ': adjudication must remain pending');
    const packetPaths = [];
    for (const reviewerId of reviewerIds) {
      const packet = {
        schemaVersion: '1.0.0',
        caseId: item.caseId,
        reviewerId,
        independence: { attested: false, conflictOfInterest: false, declaration: '' },
        blinded: false,
        reviewedAt: '',
        scopeSummary: '',
        dimensionCoverage: Object.fromEntries(dimensions.map(dimension => [dimension, 'partial'])),
        groundTruth: Object.fromEntries(dimensions.map(dimension => [dimension, []])),
        evidenceNotes: []
      };
      const relativePath = 'benchmarks/real-world/reviews/' + item.caseId + '/' + reviewerId + '.json';
      packetPaths.push(relativePath);
      packets.push({ caseId: item.caseId, reviewerId, relativePath, content: JSON.stringify(packet, null, 2) + '\n' });
    }
    assignments.push({
      caseId: item.caseId,
      caseIndex: item.caseIndex,
      repository: item.repository,
      baseCommit: item.baseCommit,
      changeCommit: item.changeCommit,
      changeRequest: item.changeRequest,
      pullRequestUrl: item.pullRequestUrl,
      snapshotFingerprintSha256: item.snapshot?.fingerprintSha256 ?? null,
      reviewers: reviewerIds.slice(),
      packetPaths,
      status: 'awaiting_review'
    });
  }
  return {
    ready: errors.length === 0,
    caseCount: cases.length,
    packetCount: packets.length,
    packets,
    assignments: {
      schemaVersion: '1.0.0',
      generatedFrom: 'annotation-worklist.json',
      reviewerSlots: reviewerIds.slice(),
      totalCases: cases.length,
      totalPackets: packets.length,
      cases: assignments
    },
    errors
  };
}

export function parseReviewerIds(argv) {
  const index = argv.indexOf('--reviewers');
  if (index === -1) return ['R1', 'R2'];
  const value = argv[index + 1];
  if (!value) throw new Error('--reviewers requires two comma-separated reviewer IDs');
  const ids = value.split(',').map(id => id.trim());
  if (ids.length !== 2 || new Set(ids).size !== 2) {
    throw new Error('--reviewers requires exactly two distinct reviewer IDs');
  }
  if (!ids.every(id => /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(id))) {
    throw new Error('--reviewers IDs must match ^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$');
  }
  return ids;
}

async function main(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  const base = path.join(root, 'benchmarks/real-world');
  const worklist = JSON.parse(await fs.readFile(path.join(base, 'annotation-worklist.json'), 'utf8'));
  const result = buildReviewPackets({ worklist, reviewerIds: parseReviewerIds(argv) });
  if (!result.ready) {
    process.stdout.write(JSON.stringify({ ready: false, errors: result.errors }, null, 2) + '\n');
    return 2;
  }
  const mismatches = [];
  for (const packet of result.packets) {
    const target = path.join(root, packet.relativePath);
    if (checkOnly) {
      const existing = await fs.readFile(target, 'utf8').catch(() => null);
      if (existing !== packet.content) mismatches.push(packet.relativePath);
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, packet.content);
    }
  }
  const assignmentPath = path.join(base, 'review-assignments.json');
  const assignmentContent = JSON.stringify(result.assignments, null, 2) + '\n';
  if (checkOnly) {
    const existing = await fs.readFile(assignmentPath, 'utf8').catch(() => null);
    if (existing !== assignmentContent) mismatches.push('benchmarks/real-world/review-assignments.json');
  } else {
    await fs.writeFile(assignmentPath, assignmentContent);
  }
  const summary = {
    ready: mismatches.length === 0,
    mode: checkOnly ? 'check' : 'write',
    caseCount: result.caseCount,
    packetCount: result.packetCount,
    reviewerSlots: result.assignments.reviewerSlots,
    mismatches
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  return summary.ready ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Review packet generation error: ' + error.message); process.exitCode = 1; }
}
