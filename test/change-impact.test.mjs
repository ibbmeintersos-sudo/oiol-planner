import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChangeImpact } from '../src/analyzer/change-impact.mjs';

function makeRepository({ truncated = false } = {}) {
  const files = [
    'packages/auth-core/src/session-manager.ts',
    'apps/customer-api/src/profile-route.ts',
    'apps/admin-worker/src/admin-route.ts',
    'test/auth/session.test.ts',
    'test/profile/profile-route.test.ts',
    'packages/shared/src/logger.ts',
    'src/users/testimonial-service.ts'
  ];
  const edges = [
    { from: 'apps/customer-api/src/profile-route.ts', to: 'packages/auth-core/src/session-manager.ts', kind: 'imports' },
    { from: 'apps/admin-worker/src/admin-route.ts', to: 'packages/auth-core/src/session-manager.ts', kind: 'imports' },
    { from: 'test/auth/session.test.ts', to: 'packages/auth-core/src/session-manager.ts', kind: 'imports' },
    { from: 'test/profile/profile-route.test.ts', to: 'apps/customer-api/src/profile-route.ts', kind: 'imports' }
  ];
  const imports = [
    { from: edges[0].from, to: edges[0].to, specifier: '../../auth-core/src/session-manager.js', resolved: true },
    { from: edges[1].from, to: edges[1].to, specifier: '../../auth-core/src/session-manager.js', resolved: true },
    { from: edges[2].from, to: edges[2].to, specifier: '../../auth-core/src/session-manager.js', resolved: true },
    { from: edges[3].from, to: edges[3].to, specifier: '../../customer-api/src/profile-route.js', resolved: true }
  ];
  const sourceEvidence = files.map((path, index) => ({
    id: 'REPO-' + String(index + 1).padStart(12, '0'),
    path,
    sourceSha256: 'a'.repeat(64),
    excerptSha256: 'b'.repeat(64),
    trustLevel: 'untrusted_repository_content'
  }));
  const repository = {
    fileCount: files.length,
    fileCountIsLowerBound: truncated,
    truncated,
    depthTruncated: false,
    tests: ['test/auth/session.test.ts', 'test/profile/profile-route.test.ts', 'src/users/testimonial-service.ts'],
    coverage: { sourceFilesOmittedBySelectionLimit: 0, readFailureCount: 0, oversizedFileCount: 0 },
    structure: {
      analysisMode: 'auto',
      astFileCount: 4,
      syntaxErrorFileCount: 0,
      parseFailureFileCount: 0,
      unresolvedLocalImportCount: 0,
      pathAliases: { unresolvedImportCount: 0 },
      symbols: [
        { file: files[0], name: 'userSession', kind: 'class' },
        { file: files[1], name: 'readProfile', kind: 'function' },
        { file: files[2], name: 'loadAdminDashboard', kind: 'function' },
        { file: files[6], name: 'findUserReviews', kind: 'function' }
      ],
      imports,
      testFiles: ['test/auth/session.test.ts', 'test/profile/profile-route.test.ts'],
      sourceEvidence,
      dependencyGraph: { nodes: files, edges, edgeCount: edges.length },
      workspaceGraph: {
        packages: [
          { name: '@app/auth-core', path: 'packages/auth-core', manifest: 'packages/auth-core/package.json' },
          { name: '@app/customer-api', path: 'apps/customer-api', manifest: 'apps/customer-api/package.json' },
          { name: '@app/admin-worker', path: 'apps/admin-worker', manifest: 'apps/admin-worker/package.json' },
          { name: '@app/shared', path: 'packages/shared', manifest: 'packages/shared/package.json' }
        ],
        dependencies: [
          { from: 'apps/customer-api', to: 'packages/auth-core', packageName: '@app/auth-core' },
          { from: 'apps/admin-worker', to: 'apps/customer-api', packageName: '@app/customer-api' }
        ]
      }
    }
  };
  return repository;
}

test('change impact distinguishes direct targets, reverse dependents, and likely tests', () => {
  const repository = makeRepository();
  const result = analyzeChangeImpact({
    request: 'تعديل مصادقة المستخدم',
    repository
  });

  assert.equal(result.status, 'analyzed');
  assert.ok(result.directMatches.some(item => item.path === 'packages/auth-core/src/session-manager.ts'));
  assert.ok(result.potentiallyAffectedFiles.some(item =>
    item.path === 'apps/customer-api/src/profile-route.ts' &&
    item.propagation === 'reverse_import_dependency' &&
    item.depth === 1
  ));
  assert.ok(result.potentiallyAffectedFiles.some(item =>
    item.path === 'apps/admin-worker/src/admin-route.ts' &&
    item.propagation === 'reverse_import_dependency'
  ));
  assert.equal(result.potentiallyAffectedFiles.some(item => item.path.startsWith('test/')), false);
  assert.ok(result.directMatches.some(item => item.path === 'src/users/testimonial-service.ts'));
  assert.equal(result.affectedTests.some(item => item.path === 'src/users/testimonial-service.ts'), false);
  assert.ok(result.affectedTests.some(item =>
    item.path === 'test/auth/session.test.ts' &&
    item.association === 'resolved_test_import_to_impacted_file' &&
    item.confidence === 'high'
  ));
  assert.ok(result.affectedTests.some(item => item.path === 'test/profile/profile-route.test.ts'));
  assert.ok(result.directMatches[0].evidenceId);
  assert.equal(result.method, 'deterministic_static_impact_estimate');
  assert.match(result.limitations.join(' '), /does not execute or verify tests/i);
});

test('workspace dependency consumers are included with direction and depth', () => {
  const result = analyzeChangeImpact({
    request: 'تغيير مصادقة المستخدم',
    repository: makeRepository()
  });
  const packages = new Map(result.affectedPackages.map(item => [item.path, item]));
  assert.equal(packages.get('packages/auth-core').depth, 0);
  assert.equal(packages.get('apps/customer-api').depth, 1);
  assert.equal(packages.get('apps/admin-worker').depth, 2);
  assert.equal(result.affectedPackages.find(item => item.path === 'apps/customer-api').propagation, 'reverse_workspace_dependency');
});

test('bounded scan gaps lower confidence and appear as explicit impact risks', () => {
  const result = analyzeChangeImpact({
    request: 'update authentication',
    repository: makeRepository({ truncated: true })
  });
  assert.ok(result.confidence.penalties.includes('repository_file_or_depth_scan_truncated'));
  assert.ok(result.confidence.score < 0.84);
  assert.ok(result.risks.includes('bounded_repository_scan_incomplete'));
});

test('missing request and unmatched terms do not become false claims of zero impact', () => {
  const repository = makeRepository();
  const missing = analyzeChangeImpact({ request: '', repository });
  assert.equal(missing.status, 'not_applicable');

  const unmatched = analyzeChangeImpact({
    request: 'quantum telescope astrophysics',
    repository
  });
  assert.equal(unmatched.status, 'no_relevant_matches');
  assert.equal(unmatched.confidence.level, 'low');
  assert.ok(unmatched.confidence.penalties.includes('no_direct_request_match_found'));
  assert.match(unmatched.summary, /does not establish that the request has no repository impact/);
});

test('impact traversal is bounded by configured result limits', () => {
  const result = analyzeChangeImpact({
    request: 'authentication user',
    repository: makeRepository(),
    maxImpactedFiles: 1,
    maxImpactedPackages: 1
  });
  assert.ok(result.potentiallyAffectedFiles.length <= 1);
  assert.ok(result.affectedPackages.length <= 1);
  assert.ok(result.risks.includes('impact_graph_truncated_by_result_limit'));
});
