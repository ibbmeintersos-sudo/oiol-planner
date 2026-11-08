import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTestImpact } from '../src/analyzer/test-impact.mjs';

function fixture() {
  const repository = {
    tests: ['test/auth/session.test.ts', 'test/profile.contract.test.ts'],
    truncated: false,
    structure: {
      testFiles: ['test/auth/session.test.ts', 'test/profile.contract.test.ts'],
      dependencyGraph: { nodes: ['src/auth/session.ts', 'src/api/profile.ts'], edges: [] }
    }
  };
  const changeImpact = {
    directMatches: [{ path: 'src/auth/session.ts' }],
    potentiallyAffectedFiles: [{ path: 'src/api/profile.ts' }],
    affectedTests: [{ path: 'test/auth/session.test.ts', association: 'resolved_test_import_to_impacted_file', confidence: 'high', relatedFile: 'src/auth/session.ts' }],
    apiContractImpact: { status: 'analyzed', contractSymbols: [{ file: 'src/api/profile.ts' }], potentiallyAffectedConsumers: [{ path: 'apps/web/profile.ts' }] },
    databaseSchemaImpact: { status: 'not_requested', schemaChanges: [], potentiallyAffectedConsumers: [] },
    graph: { traversalLimits: { depthLimitReached: false, nodeLimitReached: false } }
  };
  return { repository, changeImpact };
}

test('test impact selects only scanner-linked tests and marks them not executed', () => {
  const { repository, changeImpact } = fixture();
  const result = analyzeTestImpact({ request: 'update authentication API contract', repository, changeImpact });
  assert.equal(result.status, 'planned');
  assert.deepEqual(result.selectedTests.map(item => item.path), ['test/auth/session.test.ts']);
  assert.equal(result.selectedTests[0].executionStatus, 'not_executed');
  assert.ok(result.recommendedTestLevels.some(item => item.level === 'unit'));
  assert.ok(result.recommendedTestLevels.some(item => item.level === 'integration'));
  assert.ok(result.recommendedTestLevels.some(item => item.level === 'contract'));
  assert.ok(result.recommendedTestLevels.some(item => item.level === 'security'));
  assert.equal(result.coverageAssessment.status, 'not_measured');
});

test('database changes recommend migration compatibility and performance checks conservatively', () => {
  const { repository, changeImpact } = fixture();
  changeImpact.databaseSchemaImpact = {
    status: 'analyzed',
    schemaChanges: [{ operation: 'add_index', path: 'db/migrations/001.sql' }],
    migrationCompatibility: { status: 'analyzed' },
    potentiallyAffectedConsumers: [{ path: 'src/customer-repository.ts' }]
  };
  const result = analyzeTestImpact({ request: 'change database index query performance', repository, changeImpact });
  assert.ok(result.recommendedTestLevels.some(item => item.level === 'migration_compatibility'));
  assert.ok(result.recommendedTestLevels.some(item => item.level === 'performance'));
});

test('missing test inventory and incomplete scan become explicit gaps, not zero-test claims', () => {
  const result = analyzeTestImpact({
    request: 'change authentication',
    repository: { truncated: true, structure: { testFiles: [] } },
    changeImpact: { directMatches: [], affectedTests: [], graph: { traversalLimits: { depthLimitReached: true } } }
  });
  assert.equal(result.inventory.inventoryAvailable, false);
  assert.ok(result.gaps.some(item => /does not prove the project has no tests/.test(item)));
  assert.ok(result.gaps.some(item => /scan coverage is incomplete/.test(item)));
  assert.equal(result.confidence, 'low');
});

test('verification gates remain proposed and never claim execution or passing checks', () => {
  const { repository, changeImpact } = fixture();
  const result = analyzeTestImpact({ request: 'update authentication', repository, changeImpact });
  assert.ok(result.verificationGates.every(item => item.status === 'proposed'));
  assert.ok(result.verificationGates.some(item => item.evidenceStatus === 'not_executed_by_oiol'));
  assert.match(result.limitations.join(' '), /No test, build, script.*is executed by OIOL/i);
});

test('test impact validates result limits', () => {
  assert.throws(() => analyzeTestImpact({ maxCandidates: 0 }), /maxCandidates/);
});
