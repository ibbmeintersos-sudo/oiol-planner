import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChangeImpact } from '../src/analyzer/change-impact.mjs';

function makeRepository({ truncated = false } = {}) {
  const files = [
    'packages/auth-core/src/session-manager.ts',
    'apps/customer-api/src/profile-route.ts',
    'apps/admin-worker/src/admin-route.ts',
    'apps/portal/src/portal-route.ts',
    'test/auth/session.test.ts',
    'test/profile/profile-route.test.ts',
    'packages/shared/src/logger.ts',
    'src/users/testimonial-service.ts'
  ];
  const edges = [
    { from: 'apps/customer-api/src/profile-route.ts', to: 'packages/auth-core/src/session-manager.ts', kind: 'imports' },
    { from: 'apps/admin-worker/src/admin-route.ts', to: 'packages/auth-core/src/session-manager.ts', kind: 'imports' },
    { from: 'apps/portal/src/portal-route.ts', to: 'apps/customer-api/src/profile-route.ts', kind: 'imports' },
    { from: 'test/auth/session.test.ts', to: 'packages/auth-core/src/session-manager.ts', kind: 'imports' },
    { from: 'test/profile/profile-route.test.ts', to: 'apps/customer-api/src/profile-route.ts', kind: 'imports' }
  ];
  const imports = [
    { from: edges[0].from, to: edges[0].to, specifier: '../../auth-core/src/session-manager.js', resolved: true },
    { from: edges[1].from, to: edges[1].to, specifier: '../../auth-core/src/session-manager.js', resolved: true },
    { from: edges[2].from, to: edges[2].to, specifier: '../../customer-api/src/profile-route.js', resolved: true },
    { from: edges[3].from, to: edges[3].to, specifier: '../../auth-core/src/session-manager.js', resolved: true },
    { from: edges[4].from, to: edges[4].to, specifier: '../../customer-api/src/profile-route.js', resolved: true }
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
        { file: files[1], name: 'UserProfileResponse', kind: 'interface', line: 14, source: 'tree_sitter_ast', exported: true },
        { file: files[0], name: 'userSession', kind: 'class', line: 3, source: 'tree_sitter_ast', exported: true },
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
          { name: '@app/portal', path: 'apps/portal', manifest: 'apps/portal/package.json' },
          { name: '@app/shared', path: 'packages/shared', manifest: 'packages/shared/package.json' }
        ],
        dependencies: [
          { from: 'apps/customer-api', to: 'packages/auth-core', packageName: '@app/auth-core' },
          { from: 'apps/admin-worker', to: 'apps/customer-api', packageName: '@app/customer-api' },
          { from: 'apps/portal', to: 'apps/customer-api', packageName: '@app/customer-api' }
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

test('long natural-language requests do not dilute strong path and symbol matches below the threshold', () => {
  const result = analyzeChangeImpact({
    request: 'Please add authentication for user accounts and ensure the profile route validates the session before reading customer information',
    repository: makeRepository()
  });

  assert.equal(result.status, 'analyzed');
  assert.ok(result.directMatches.some(item => item.path === 'packages/auth-core/src/session-manager.ts'));
  assert.ok(result.matchingDiagnostics.matchedRequestTerms.includes('auth'));
  assert.ok(result.matchingDiagnostics.matchedRequestTerms.includes('user'));
  assert.ok(result.matchingDiagnostics.requestTermCount > 4);
});

test('direct-match cap is explicit and reports omitted candidate count', () => {
  const result = analyzeChangeImpact({
    request: 'authentication user',
    repository: makeRepository(),
    maxDirectMatches: 1
  });

  assert.equal(result.matchingDiagnostics.directMatchLimitReached, true);
  assert.equal(result.matchingDiagnostics.directMatchLimit, 1);
  assert.ok(result.matchingDiagnostics.directMatchCountBeforeLimit > result.directMatches.length);
  assert.ok(result.confidence.penalties.includes('direct_match_result_limit_reached'));
});

test('depth-limit truncation is explicit for file and workspace propagation', () => {
  const result = analyzeChangeImpact({
    request: 'authentication user',
    repository: makeRepository(),
    maxDepth: 1
  });

  assert.equal(result.graph.traversalLimits.depthLimitReached, true);
  assert.ok(result.graph.traversalLimits.fileDepthFrontierCount > 0);
  assert.ok(result.graph.traversalLimits.packageDepthFrontierCount > 0);
  assert.ok(result.confidence.penalties.includes('impact_graph_depth_limit_reached'));
  assert.ok(result.risks.includes('impact_graph_depth_limit_reached'));
});

test('depth limit is not reported when the frontier has no unseen dependents', () => {
  const repository = makeRepository();
  repository.structure.workspaceGraph.dependencies = [
    { from: 'apps/customer-api', to: 'packages/auth-core', packageName: '@app/auth-core' }
  ];
  repository.structure.dependencyGraph.edges = repository.structure.dependencyGraph.edges.filter(
    edge => edge.from !== 'apps/portal/src/portal-route.ts'
  );
  const result = analyzeChangeImpact({
    request: 'authentication user',
    repository,
    maxDepth: 6
  });

  assert.equal(result.graph.traversalLimits.depthLimitReached, false);
  assert.equal(result.graph.traversalLimits.fileDepthFrontierCount, 0);
  assert.equal(result.graph.traversalLimits.packageDepthFrontierCount, 0);
});

test('API contract analysis matches exported symbols and identifies file-level consumers', () => {
  const result = analyzeChangeImpact({
    request: 'change public API response contract for user profile',
    repository: makeRepository()
  });

  assert.equal(result.apiContractImpact.status, 'analyzed');
  assert.ok(result.apiContractImpact.contractSymbols.some(item =>
    item.name === 'UserProfileResponse' &&
    item.kind === 'interface' &&
    item.exported === true &&
    item.matchedTerms.includes('user') &&
    item.matchedTerms.includes('profile')
  ));
  assert.ok(result.apiContractImpact.potentiallyAffectedConsumers.some(item =>
    item.path === 'apps/portal/src/portal-route.ts' &&
    item.relationship === 'imports_contract_candidate_file' &&
    item.confidence === 'medium' &&
    item.proofLevel === 'file_import_edge_not_symbol_binding'
  ));
  assert.ok(result.apiContractImpact.limitations.some(item => /not that the consumer imports or calls the specific changed symbol/.test(item)));
});

test('API contract analysis does not run for requests without contract intent', () => {
  const result = analyzeChangeImpact({
    request: 'update user profile validation',
    repository: makeRepository()
  });

  assert.equal(result.apiContractImpact.status, 'not_requested');
});

test('API contract analysis reports unavailable when export metadata is absent', () => {
  const repository = makeRepository();
  repository.structure.symbols = repository.structure.symbols.map(({ exported, ...symbol }) => symbol);
  const result = analyzeChangeImpact({
    request: 'change public API response contract for user profile',
    repository
  });

  assert.equal(result.apiContractImpact.status, 'unavailable');
  assert.equal(result.apiContractImpact.diagnostics.exportMetadataFileCount, 0);
});
