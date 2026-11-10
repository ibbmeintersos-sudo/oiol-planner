#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateReview } from './validate-independent-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedCases = 36;

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function hashReview(review) {
  return crypto.createHash('sha256').update(canonicalJson(review)).digest('hex');
}

export function checkReviewFreeze({ worklist, assignments, reviews }) {
  const errors = [];
  if (worklist?.schemaVersion !== '1.0.0') errors.push('worklist schemaVersion must be 1.0.0');
  if (assignments?.schemaVersion !== '1.0.0') errors.push('review assignments must be generated before freezing');
  const cases = Array.isArray(worklist?.cases) ? worklist.cases : [];
  if (cases.length !== expectedCases) errors.push('expected exactly ' + expectedCases + ' worklist cases');
  const slots = Array.isArray(assignments?.reviewerSlots) ? assignments.reviewerSlots : [];
  if (slots.length !== 2 || new Set(slots).size !== 2) errors.push('exactly two distinct reviewer slots are required');
  const reviewIndex = new Map();
  for (const entry of reviews || []) {
    if (!entry || typeof entry !== 'object' || !entry.caseId) continue;
    if (!reviewIndex.has(entry.caseId)) reviewIndex.set(entry.caseId, new Map());
    reviewIndex.get(entry.caseId).set(entry.reviewerId, entry.review);
  }
  const frozenCases = [];
  let submittedReviews = 0;
  for (const item of cases) {
    const caseReviews = reviewIndex.get(item.caseId) || new Map();
    const frozen = [];
    for (const slot of slots) {
      const review = caseReviews.get(slot);
      if (!review) { errors.push(item.caseId + ': missing review from ' + slot); continue; }
      submittedReviews += 1;
      if (review.caseId !== item.caseId) errors.push(item.caseId + ': review caseId does not match the worklist');
      if (review.reviewerId !== slot) errors.push(item.caseId + ': reviewerId must match the assigned slot ' + slot);
      const result = validateReview(review, worklist);
      if (!result.ready) errors.push(item.caseId + '/' + slot + ': ' + result.errors.join('; '));
      frozen.push({ reviewerId: slot, sha256: hashReview(review) });
    }
    frozenCases.push({ caseId: item.caseId, reviews: frozen, adjudicationStatus: 'pending' });
  }
  const expectedReviews = cases.length * slots.length;
  const ready = errors.length === 0 && submittedReviews === expectedReviews;
  return {
    ready,
    caseCount: cases.length,
    expectedReviews,
    submittedReviews,
    frozen: ready ? {
      schemaVersion: '1.0.0',
      frozenAt: new Date().toISOString(),
      caseCount: cases.length,
      reviewCount: submittedReviews,
      cases: frozenCases
    } : null,
    errors
  };
}

export async function main(argv = process.argv.slice(2)) {
  const outIndex = argv.indexOf('--out');
  const base = path.join(root, 'benchmarks/real-world');
  const outFile = outIndex === -1 ? path.join(base, 'review-freeze.json') : path.resolve(argv[outIndex + 1]);
  const worklist = JSON.parse(await fs.readFile(path.join(base, 'annotation-worklist.json'), 'utf8'));
  const assignments = await fs.readFile(path.join(base, 'review-assignments.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const reviews = [];
  const cases = Array.isArray(worklist.cases) ? worklist.cases : [];
  const slots = Array.isArray(assignments?.reviewerSlots) ? assignments.reviewerSlots : [];
  for (const item of cases) {
    for (const slot of slots) {
      const file = path.join(base, 'reviews', item.caseId, slot + '.json');
      const raw = await fs.readFile(file, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (raw === null) continue;
      reviews.push({ caseId: item.caseId, reviewerId: slot, review: JSON.parse(raw) });
    }
  }
  const result = checkReviewFreeze({ worklist, assignments, reviews });
  if (result.ready) await fs.writeFile(outFile, JSON.stringify(result.frozen, null, 2) + '\n');
  const summary = {
    ready: result.ready,
    caseCount: result.caseCount,
    expectedReviews: result.expectedReviews,
    submittedReviews: result.submittedReviews,
    freezeFile: result.ready ? path.relative(root, outFile) : null,
    errors: result.errors
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  return result.ready ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Independent review freeze error: ' + error.message); process.exitCode = 1; }
}
