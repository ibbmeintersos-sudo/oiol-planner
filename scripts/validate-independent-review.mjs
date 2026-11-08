#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dimensions = ['directFiles','affectedFiles','tests','packages','apiConsumers','databaseConsumers','migrationFiles','scannerSymbols','dependencyEdges','unknowns','risks'];
const pathDimensions = ['directFiles','affectedFiles','tests','migrationFiles'];
const safePath = value => typeof value === 'string' && value.length > 0 &&
  !value.startsWith('/') && !/^[A-Za-z]:[\\\\/]/.test(value) &&
  !value.split(/[\\\\/]/).includes('..') && !value.includes('\0');

export function validateReview(review, worklist, otherReview = null) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return { ready: false, errors: ['review must be an object'] };
  if (review.schemaVersion !== '1.0.0') errors.push('schemaVersion must be 1.0.0');
  if (!worklist?.cases?.some(item => item.caseId === review.caseId)) errors.push('caseId is not present in the annotation worklist');
  if (typeof review.reviewerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(review.reviewerId)) errors.push('reviewerId must be a stable pseudonymous ID');
  if (review.independence?.attested !== true) errors.push('independence must be explicitly attested');
  if (review.independence?.conflictOfInterest !== false) errors.push('conflicted or undeclared reviewers cannot submit');
  if (typeof review.independence?.declaration !== 'string' || review.independence.declaration.trim().length < 20) errors.push('independence declaration is required');
  if (review.blinded !== true) errors.push('reviewer must attest blinding from OIOL and other reviews');
  if (!Number.isFinite(Date.parse(review.reviewedAt || ''))) errors.push('reviewedAt must be a valid timestamp');
  if (typeof review.scopeSummary !== 'string' || review.scopeSummary.trim().length < 20) errors.push('scopeSummary must explain the interpreted change scope');
  if (!otherReview && review.reviewerId && otherReview?.reviewerId === review.reviewerId) errors.push('reviewer IDs must differ');
  if (otherReview && otherReview.reviewerId === review.reviewerId) errors.push('paired reviews must have distinct reviewer IDs');

  const coverage = review.dimensionCoverage || {};
  const truth = review.groundTruth || {};
  for (const key of dimensions) {
    if (!['complete','partial','unsupported'].includes(coverage[key])) errors.push('dimensionCoverage.' + key + ' must be complete, partial, or unsupported');
    if (!Array.isArray(truth[key])) errors.push('groundTruth.' + key + ' must be an array');
  }
  for (const key of pathDimensions) {
    if (Array.isArray(truth[key]) && truth[key].some(item => !safePath(item))) errors.push('groundTruth.' + key + ' contains an unsafe path');
  }
  if (Array.isArray(truth.scannerSymbols) && truth.scannerSymbols.some(item => !item || !safePath(item.file) || typeof item.name !== 'string' || !item.name || typeof item.kind !== 'string' || !item.kind)) {
    errors.push('groundTruth.scannerSymbols contains an invalid symbol');
  }
  if (Array.isArray(truth.dependencyEdges) && truth.dependencyEdges.some(item => !item || !safePath(item.from) || !safePath(item.to))) {
    errors.push('groundTruth.dependencyEdges contains an invalid edge');
  }
  if (Array.isArray(truth.risks) && truth.risks.some(item => !item || typeof item.id !== 'string' || !item.id || !['low','medium','high','critical'].includes(item.severity) || typeof item.rationale !== 'string' || item.rationale.trim().length < 12)) {
    errors.push('groundTruth.risks contains an invalid risk');
  }
  if (!Array.isArray(review.evidenceNotes) || review.evidenceNotes.length === 0) errors.push('at least one evidence note is required');
  else for (const [index, note] of review.evidenceNotes.entries()) {
    if (!note || ![...dimensions,'exclusions'].includes(note.dimension)) errors.push('evidenceNotes[' + index + '] has an invalid dimension');
    if (typeof note.claim !== 'string' || note.claim.trim().length < 8) errors.push('evidenceNotes[' + index + '] requires a specific claim');
    if (typeof note.evidence !== 'string' || note.evidence.trim().length < 12) errors.push('evidenceNotes[' + index + '] requires supporting evidence');
    if (note.path !== undefined && !safePath(note.path)) errors.push('evidenceNotes[' + index + '] has an unsafe path');
    if (note.immutableUrl !== undefined) {
      try { const url = new URL(note.immutableUrl); if (url.protocol !== 'https:') errors.push('evidenceNotes[' + index + '] immutableUrl must use HTTPS'); }
      catch { errors.push('evidenceNotes[' + index + '] immutableUrl must be a valid URL'); }
    }
  }
  return { ready: errors.length === 0, caseId: review.caseId, reviewerId: review.reviewerId, errors };
}

function option(name) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? null : process.argv[index + 1];
}

export async function main() {
  const reviewFile = option('review');
  if (!reviewFile) throw new Error('Pass --review <review.json>');
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const worklistFile = option('worklist') || path.join(scriptRoot, 'benchmarks/real-world/annotation-worklist.json');
  const review = JSON.parse(await fs.readFile(path.resolve(reviewFile), 'utf8'));
  const worklist = JSON.parse(await fs.readFile(path.resolve(worklistFile), 'utf8'));
  const otherFile = option('other-review');
  const other = otherFile ? JSON.parse(await fs.readFile(path.resolve(otherFile), 'utf8')) : null;
  const result = validateReview(review, worklist, other);
  process.stdout.write(JSON.stringify(result, null, 2) + '\\n');
  return result.ready ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Independent review validation error: ' + error.message); process.exitCode = 1; }
}
