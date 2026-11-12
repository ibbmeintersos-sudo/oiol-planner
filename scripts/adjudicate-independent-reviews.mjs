#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashReview } from './freeze-independent-reviews.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const categories = ['source_change','api_change','database_change','migration_change','test_change','cross_component','ambiguous'];

const dimensions = ['directFiles','affectedFiles','tests','packages','apiConsumers','databaseConsumers','migrationFiles','scannerSymbols','dependencyEdges','unknowns','risks'];

const option = (name, fallback = null) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};

function keyOf(dimension, value) {
  if (dimension === 'scannerSymbols') return [value?.file, value?.kind, value?.name].join('::');
  if (dimension === 'dependencyEdges') return (value?.from || '') + ' -> ' + (value?.to || '');
  if (dimension === 'risks') return (value?.id || '') + '::' + (value?.severity || '');
  if (typeof value === 'string') return value;
  return value?.path || value?.file || JSON.stringify(value);
}

function indexBy(dimension, values) {
  const map = new Map();
  for (const value of values || []) {
    const key = keyOf(dimension, value);
    if (key && !map.has(key)) map.set(key, value);
  }
  return map;
}

const sorted = map => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, value]) => value);

export function adjudicateDimension(dimension, first, second, mode = 'intersection') {
  const a = indexBy(dimension, first);
  const b = indexBy(dimension, second);
  const accepted = new Map();
  const onlyFirst = new Map();
  const onlySecond = new Map();
  for (const [key, value] of a) {
    if (b.has(key)) accepted.set(key, value);
    else onlyFirst.set(key, value);
  }
  for (const [key, value] of b) if (!a.has(key)) onlySecond.set(key, value);
  const union = mode === 'union' || dimension === 'unknowns' || dimension === 'risks';
  const agreed = union ? new Map([...a, ...b]) : accepted;
  return {
    accepted: sorted(agreed),
    onlyFirst: sorted(onlyFirst),
    onlySecond: sorted(onlySecond),
    firstCount: a.size,
    secondCount: b.size,
    contested: !union && agreed.size === 0 && (a.size > 0 || b.size > 0)
  };
}

function reviewerRecord(review) {
  const declaration = review.independence?.declaration || '';
  return {
    reviewerId: review.reviewerId,
    independent: review.independence?.attested === true,
    conflictOfInterest: review.independence?.conflictOfInterest === true,
    blinded: review.blinded === true,
    reviewedAt: review.reviewedAt,
    declaration,
    generatedBy: /AI-generated/.test(declaration) ? 'declared-ai-run' : 'unspecified',
    evidenceNotes: review.evidenceNotes || []
  };
}

function adjudicationRationale(mode) {
  if (mode === 'union') return 'Automated adjudication kept every item accepted by either blinded slot and recorded every slot-only item as a disagreement; no silent averaging.';
  return 'Automated adjudication kept only items present in both blinded slots and recorded every slot-only item as a disagreement; no silent averaging.';
}

export function buildAdjudicatedCase(item, first, second, snapshotPrefix, mode = 'intersection') {
  const truth = {};
  const disagreements = [];
  for (const dimension of dimensions) {
    const result = adjudicateDimension(dimension, first.groundTruth?.[dimension], second.groundTruth?.[dimension], mode);
    truth[dimension] = result.accepted;
    if (result.onlyFirst.length || result.onlySecond.length || result.contested) {
      disagreements.push({
        dimension,
        onlyFirst: result.onlyFirst,
        onlySecond: result.onlySecond,
        contested: result.contested
      });
    }
  }
  const caseJson = {
    schemaVersion: '1.0.0',
    caseId: item.caseId,
    source: {
      repositoryUrl: item.repositoryUrl,
      baseCommit: item.baseCommit,
      changeCommit: item.changeCommit,
      changeUrl: item.pullRequestUrl,
      license: item.license,
      licenseFile: item.licenseFile,
      licenseFileUrl: item.licenseFileUrl,
      sizeClass: item.sizeClass,
      repositoryKind: item.repositoryKind,
      trackedFileCountAtBase: item.snapshot?.gitTreeFileCount,
      primaryLanguages: item.primaryLanguages
    },
    change: {
      request: item.changeRequest,
      summary: item.pullRequestTitle + ' (' + item.repository + ' #' + item.pullRequest + ')',
      category: categories.includes(item.changeCategory) ? item.changeCategory : 'ambiguous'
    },
    snapshot: {
      relativePath: snapshotPrefix + '/' + item.caseId,
      sha256: item.snapshot?.fingerprintSha256,
      gitTreeSha: item.snapshot?.gitTreeSha,
      artifactName: item.snapshot?.artifactName
    },
    groundTruth: truth,
    annotation: {
      reviewers: [first, second].map(reviewerRecord),
      adjudication: {
        required: disagreements.length > 0,
        status: disagreements.length ? 'completed' : 'not_needed',
        reviewerId: 'automated-adjudicator',
        method: mode === 'union' ? 'set union of both blinded slots for every dimension' : 'set intersection for scored dimensions; union for unknowns and risks',
        rationale: disagreements.length
          ? adjudicationRationale(mode)
          : 'Both blinded slots produced identical accepted sets, so no adjudication was required.',
        disagreements
      }
    }
  };
  return { caseJson, disagreements };
}

export async function main() {
  const base = path.join(root, 'benchmarks/real-world');
  const reviewsRoot = path.resolve(option('reviews-root', path.join(base, 'reviews')));
  const outRoot = path.resolve(option('out', path.join(root, 'benchmarks/real-world-corpus')));
  const snapshotPrefix = option('snapshot-prefix', 'snapshots');
  const mode = option('mode', 'intersection');
  if (mode !== 'intersection' && mode !== 'union') throw new Error('--mode must be intersection or union');
  const freezeFile = path.resolve(option('freeze', path.join(base, 'review-freeze.json')));
  const worklist = JSON.parse(await fs.readFile(path.join(base, 'annotation-worklist.json'), 'utf8'));
  const assignments = JSON.parse(await fs.readFile(path.join(base, 'review-assignments.json'), 'utf8'));
  const slots = assignments.reviewerSlots;
  if (!Array.isArray(slots) || slots.length !== 2) throw new Error('exactly two reviewer slots are required');
  const freeze = await fs.readFile(freezeFile, 'utf8').then(JSON.parse).catch(() => null);
  if (!freeze) throw new Error('run the freeze gate before adjudication');
  const freezeIndex = new Map((freeze.cases || []).map(entry => [entry.caseId, new Map((entry.reviews || []).map(review => [review.reviewerId, review.sha256]))]));
  const records = [];
  const report = { schemaVersion: '1.0.0', mode, createdAt: new Date().toISOString(), caseCount: 0, contested: [], errors: [] };
  for (const item of worklist.cases) {
    try {
      const reviews = [];
      for (const slot of slots) {
        const raw = await fs.readFile(path.join(reviewsRoot, item.caseId, slot + '.json'), 'utf8').catch(() => null);
        if (raw === null) throw new Error(item.caseId + ': missing review ' + slot);
        const review = JSON.parse(raw);
        const expected = freezeIndex.get(item.caseId)?.get(slot);
        if (expected && hashReview(review) !== expected) throw new Error(item.caseId + '/' + slot + ': review changed after freeze');
        reviews.push(review);
      }
      const built = buildAdjudicatedCase(item, reviews[0], reviews[1], snapshotPrefix, mode);
      for (const dimension of dimensions) {
        if (!Array.isArray(built.caseJson.groundTruth[dimension])) throw new Error(item.caseId + ': missing dimension ' + dimension);
      }
      records.push({ caseId: item.caseId, caseFile: 'cases/' + item.caseId + '.json', caseJson: built.caseJson, disagreementCount: built.disagreements.length });
      if (built.disagreements.some(entry => entry.contested)) report.contested.push(item.caseId);
    } catch (error) {
      report.errors.push(error.message);
    }
  }
  await fs.mkdir(path.join(outRoot, 'cases'), { recursive: true });
  for (const record of records) {
    await fs.writeFile(path.join(outRoot, record.caseFile), JSON.stringify(record.caseJson, null, 2) + '\n');
  }
  const manifest = {
    schemaVersion: '1.0.0',
    corpusVersion: worklist.schemaVersion + '-' + (freeze.frozenAt || 'unfrozen'),
    annotationProvenance: 'AI-generated blinded slots with automated ' + (mode === 'union' ? 'union' : 'intersection') + ' adjudication; not human review',
    cases: records.map(record => ({ caseId: record.caseId, caseFile: record.caseFile }))
  };
  await fs.writeFile(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  report.caseCount = records.length;
  report.disagreementTotal = records.reduce((sum, record) => sum + record.disagreementCount, 0);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.errors.length === 0 && records.length === worklist.cases.length ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Adjudication error: ' + error.message); process.exitCode = 1; }
}
