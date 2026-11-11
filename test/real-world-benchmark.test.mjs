import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSet, scoreRealWorldCase } from '../scripts/run-real-world-benchmark.mjs';

test('real-world set scoring reports TP, FP, FN, precision, recall, and F1', () => {
  const result = scoreSet(['a', 'b'], ['a', 'c']);
  assert.equal(result.tp, 1);
  assert.equal(result.fp, 1);
  assert.equal(result.fn, 1);
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 0.5);
  assert.equal(result.f1, 0.5);
});

test('real-world scorer keeps scanner and impact dimensions separate', () => {
  const item = {
    caseId: 'sample-case-001',
    change: { category: 'api_change' },
    groundTruth: {
      directFiles: ['src/api.mjs'], affectedFiles: ['src/api.mjs'], tests: [], packages: [],
      apiConsumers: ['apps/web.mjs'], databaseConsumers: [], migrationFiles: [],
      scannerSymbols: ['src/api.mjs::function::getApi'],
      dependencyEdges: ['apps/web.mjs -> src/api.mjs']
    }
  };
  const scan = {
    fileCount: 2, includedFileCount: 2, truncated: false, depthTruncated: false,
    coverage: {}, structure: {
      symbols: [{ file: 'src/api.mjs', name: 'getApi', kind: 'function' }],
      dependencyGraph: { edges: [{ from: 'apps/web.mjs', to: 'src/api.mjs' }] }
    }
  };
  const impact = {
    status: 'analyzed', confidence: { score: 0.8, level: 'high' },
    directMatches: [{ path: 'src/api.mjs' }],
    potentiallyAffectedFiles: [{ path: 'src/api.mjs' }],
    affectedTests: [], affectedPackages: [],
    apiContractImpact: { status: 'analyzed', potentiallyAffectedConsumers: [{ path: 'apps/web.mjs' }] },
    databaseSchemaImpact: { status: 'not_requested', potentiallyAffectedConsumers: [] },
    testImpactAnalysis: { status: 'analyzed' }, risks: []
  };
  const result = scoreRealWorldCase(item, scan, impact);
  assert.equal(result.dimensions.directFiles.f1, 1);
  assert.equal(result.dimensions.apiConsumers.recall, 1);
  assert.equal(result.dimensions.scannerSymbols.precision, 1);
  assert.equal(result.dimensions.dependencyEdges.f1, 1);
});

test('real-world scorer matches object ground truth against object scanner output', () => {
  const item = {
    caseId: 'sample-case-002',
    change: { category: 'source_change' },
    groundTruth: {
      directFiles: [], affectedFiles: [], tests: [], packages: [], apiConsumers: [],
      databaseConsumers: [], migrationFiles: [],
      scannerSymbols: [{ file: 'src/api.mjs', name: 'getApi', kind: 'function' }],
      dependencyEdges: [{ from: 'apps/web.mjs', to: 'src/api.mjs' }]
    }
  };
  const scan = {
    fileCount: 2, includedFileCount: 2, truncated: false, depthTruncated: false,
    coverage: {}, structure: {
      symbols: [{ file: 'src/api.mjs', name: 'getApi', kind: 'function' }],
      dependencyGraph: { edges: [{ from: 'apps/web.mjs', to: 'src/api.mjs' }] }
    }
  };
  const impact = {
    status: 'analyzed', confidence: { score: 0.5, level: 'medium' },
    directMatches: [], potentiallyAffectedFiles: [], affectedTests: [], affectedPackages: [],
    apiContractImpact: { status: 'not_requested', potentiallyAffectedConsumers: [] },
    databaseSchemaImpact: { status: 'not_requested', potentiallyAffectedConsumers: [] },
    testImpactAnalysis: { status: 'not_requested' }, risks: []
  };
  const result = scoreRealWorldCase(item, scan, impact);
  assert.equal(result.dimensions.scannerSymbols.tp, 1);
  assert.equal(result.dimensions.scannerSymbols.fp, 0);
  assert.equal(result.dimensions.scannerSymbols.fn, 0);
  assert.equal(result.dimensions.dependencyEdges.f1, 1);
});
