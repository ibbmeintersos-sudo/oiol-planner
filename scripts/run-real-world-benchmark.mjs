#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanRepository } from '../src/scanner/repository.mjs';
import { analyzeChangeImpact } from '../src/analyzer/change-impact.mjs';
import { fingerprintSnapshot, validateCorpus } from './validate-real-world-corpus.mjs';

const option = (name, fallback = null) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value))].sort();
const pathValues = values => unique((values || []).map(item => typeof item === 'string' ? item : item?.path || item?.file || item?.migrationPath));
const edgeValues = values => unique((values || []).map(item => typeof item === 'string' ? item : item?.from && item?.to ? item.from + ' -> ' + item.to : null));
const symbolValues = values => unique((values || []).map(item => item?.file && item?.name ? item.file + '::' + (item.kind || 'unknown') + '::' + item.name : null));

export function scoreSet(expectedValues = [], actualValues = []) {
  const expected = new Set(unique(expectedValues));
  const actual = new Set(unique(actualValues));
  const tp = [...actual].filter(value => expected.has(value)).length;
  const fp = [...actual].filter(value => !expected.has(value)).length;
  const fn = [...expected].filter(value => !actual.has(value)).length;
  const precision = tp + fp ? tp / (tp + fp) : expected.size ? 0 : 1;
  const recall = tp + fn ? tp / (tp + fn) : expected.size ? 0 : 1;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : expected.size || actual.size ? 0 : 1;
  return { tp, fp, fn, precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)), f1: Number(f1.toFixed(4)), expectedCount: expected.size, actualCount: actual.size };
}

export function scoreRealWorldCase(item, repositoryScan, impact) {
  const truth = item.groundTruth;
  const api = impact.apiContractImpact || {};
  const database = impact.databaseSchemaImpact || {};
  const migration = database.migrationCompatibility || {};
  const actual = {
    directFiles: pathValues(impact.directMatches),
    affectedFiles: pathValues(impact.potentiallyAffectedFiles),
    tests: pathValues(impact.affectedTests),
    packages: pathValues(impact.affectedPackages),
    apiConsumers: pathValues(api.potentiallyAffectedConsumers),
    databaseConsumers: pathValues(database.potentiallyAffectedConsumers),
    migrationFiles: pathValues([...(migration.orderedMigrations || []), ...(migration.compatibilityFindings || [])]),
    scannerSymbols: symbolValues(repositoryScan.structure?.symbols),
    dependencyEdges: edgeValues(repositoryScan.structure?.dependencyGraph?.edges)
  };
  const dimensions = {};
  for (const key of Object.keys(actual)) dimensions[key] = scoreSet(truth[key] || [], actual[key]);
  return {
    caseId: item.caseId,
    category: item.change.category,
    status: impact.status,
    confidence: impact.confidence,
    dimensions,
    scan: {
      fileCount: repositoryScan.fileCount,
      includedFileCount: repositoryScan.includedFileCount,
      truncated: repositoryScan.truncated,
      depthTruncated: repositoryScan.depthTruncated,
      coverage: repositoryScan.coverage,
      languages: repositoryScan.structure?.languages || {},
      astFileCount: repositoryScan.structure?.astFileCount || 0,
      lexicalFallbackFileCount: repositoryScan.structure?.lexicalFallbackFileCount || 0,
      unresolvedLocalImportCount: repositoryScan.structure?.unresolvedLocalImportCount || 0
    },
    apiStatus: api.status || 'unavailable',
    databaseStatus: database.status || 'unavailable',
    migrationStatus: migration.status || 'unavailable',
    observedUnknowns: impact.unknowns || impact.diagnostics?.unknowns || [],
    observedRisks: impact.risks || [],
    planningOnlyVerification: impact.testImpactAnalysis || null,
    reviewOnlyDimensions: {
      unknowns: 'Requires independent human scoring; the deterministic analyzer does not emit an adjudicated unknowns list.',
      risks: 'Raw risk signals are reported; severity and rationale quality require independent human scoring.',
      confidenceCalibration: 'Raw confidence is reported; calibration is not scored until adjudicated correctness labels are available.',
      verificationLevelQuality: 'Recommendations are retained; their adequacy requires independent human review.'
    }
  };
}

function average(values) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : null;
}

export async function runRealWorldBenchmark({ corpusRoot, maxFiles = 250, maxDepth = 12, maxSourceFiles = 100, analysisMode = 'auto' } = {}) {
  const root = path.resolve(corpusRoot);
  const validation = await validateCorpus(root, {
    minimumCases: Number(process.env.P12_MIN_CASES || 30),
    minimumRepositories: Number(process.env.P12_MIN_REPOS || 12),
    minimumPerSizeClass: Number(process.env.P12_MIN_PER_SIZE_CLASS || 4)
  });
  if (!validation.ready) throw new Error('Corpus is not ready: ' + validation.errors.join('; '));
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const rows = [];
  for (const record of manifest.cases) {
    const item = JSON.parse(await fs.readFile(path.resolve(root, record.caseFile), 'utf8'));
    const snapshotPath = path.resolve(root, item.snapshot.relativePath);
    const fingerprint = await fingerprintSnapshot(snapshotPath);
    if (fingerprint.sha256 !== item.snapshot.sha256) throw new Error(item.caseId + ': snapshot changed during evaluation');
    const repository = await scanRepository(snapshotPath, { maxFiles, maxDepth, maxSourceFiles, analysisMode });
    const impact = analyzeChangeImpact({ request: item.change.request, repository });
    rows.push(scoreRealWorldCase(item, repository, impact));
  }
  const dimensionNames = Object.keys(rows[0]?.dimensions || {});
  const dimensions = Object.fromEntries(dimensionNames.map(name => [name, {
    precision: average(rows.map(row => row.dimensions[name].precision)),
    recall: average(rows.map(row => row.dimensions[name].recall)),
    f1: average(rows.map(row => row.dimensions[name].f1))
  }]));
  return {
    protocolVersion: '1.0.0',
    benchmark: 'real_world_repository_change_impact',
    createdAt: new Date().toISOString(),
    oiolVersion: JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version,
    corpusVersion: manifest.corpusVersion || null,
    caseCount: rows.length,
    dimensions,
    results: rows,
    limitations: [
      'The corpus must be independently curated and adjudicated; this runner does not establish annotation independence.',
      'Static scanner evidence does not prove runtime behavior or complete semantic dependencies.',
      'Confidence and human-rated unknown/risk quality require a separate blinded review; raw confidence is reported, not certified.',
      'Target repositories are read as files only. No target-project command, script, build, test, migration, or application code is executed.'
    ]
  };
}

export async function main() {
  const corpusRoot = option('corpus-root');
  if (!corpusRoot) throw new Error('Pass --corpus-root <path>');
  const output = path.resolve(option('out', 'benchmarks/results/real-world-benchmark.json'));
  const report = await runRealWorldBenchmark({
    corpusRoot,
    maxFiles: Number(option('max-files', 250)),
    maxDepth: Number(option('max-depth', 12)),
    maxSourceFiles: Number(option('max-source-files', 100)),
    analysisMode: option('analysis-mode', 'auto')
  });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ benchmark: report.benchmark, caseCount: report.caseCount, dimensions: report.dimensions, output }, null, 2));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Real-world benchmark error: ' + error.message); process.exitCode = 1; }
}
