import test from 'node:test';
import assert from 'node:assert/strict';
import { changeImpactCases } from '../benchmarks/change-impact-cases.mjs';
import { runChangeImpactBenchmark, scoreChangeImpactCase } from '../benchmarks/change-impact-scoring.mjs';

test('change impact benchmark catalog covers existing, multi-component, API, and ambiguous cases', () => {
  const categories = new Set(changeImpactCases.map(item => item.category));
  assert.ok(categories.has('existing_repository'));
  assert.ok(categories.has('multi_component'));
  assert.ok(categories.has('api_contract'));
  assert.ok(categories.has('ambiguous_or_unmatched'));
  assert.equal(new Set(changeImpactCases.map(item => item.id)).size, changeImpactCases.length);
});

test('change impact benchmark measures precision, recall, F1, and category scores', () => {
  const report = runChangeImpactBenchmark();
  assert.equal(report.benchmark, 'change_impact_analysis');
  assert.equal(report.summary.caseCount, changeImpactCases.length);
  assert.ok(report.summary.dimensions.directFiles.precision >= 0);
  assert.ok(report.summary.dimensions.affectedFiles.recall >= 0);
  assert.ok(report.summary.byCategory.multi_component);
  assert.ok(report.results.every(row => row.dimensions.directFiles.f1 >= 0 && row.dimensions.affectedFiles.f1 >= 0));
});

test('benchmark scorer detects false positives and false negatives', () => {
  const scenario = {
    id: 'CUSTOM-001', category: 'existing_repository',
    expected: { status: 'analyzed', directFiles: ['src/a.mjs'], affectedFiles: ['src/a.mjs','src/b.mjs'], testFiles: [], packagePaths: [] }
  };
  const result = {
    status: 'analyzed',
    directMatches: [{ path: 'src/a.mjs' }, { path: 'src/unexpected.mjs' }],
    potentiallyAffectedFiles: [{ path: 'src/a.mjs' }],
    affectedTests: [], affectedPackages: []
  };
  const score = scoreChangeImpactCase(scenario, result);
  assert.equal(score.dimensions.directFiles.falsePositive, 1);
  assert.equal(score.dimensions.affectedFiles.falseNegative, 1);
  assert.ok(score.dimensions.directFiles.precision < 1);
  assert.ok(score.dimensions.affectedFiles.recall < 1);
});

test('API contract case requires explicit export metadata and consumer evidence', () => {
  const report = runChangeImpactBenchmark();
  const row = report.results.find(item => item.scenarioId === 'CIA-API-004');
  assert.equal(row.dimensions.apiStatus.actual, 'analyzed');
  assert.equal(row.dimensions.apiStatus.pass, true);
  assert.equal(row.dimensions.apiConsumers.recall, 1);
});

test('unmatched case penalizes invented direct targets', () => {
  const report = runChangeImpactBenchmark();
  const row = report.results.find(item => item.scenarioId === 'CIA-AMB-005');
  assert.equal(row.status, 'no_relevant_matches');
  assert.equal(row.dimensions.directFiles.falsePositive, 0);
  assert.equal(row.dimensions.directFiles.precision, 1);
});
