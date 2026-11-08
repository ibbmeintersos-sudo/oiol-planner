const edge = (from, to) => ({ from, to });
const pkg = (name, path) => ({ name, path });
const base = ({ nodes, edges = [], imports = [], testFiles = [], symbols = [], workspacePackages = [], workspaceDependencies = [] }) => ({
  kind: 'existing',
  fileCount: nodes.length,
  fileCountIsLowerBound: false,
  truncated: false,
  depthTruncated: false,
  coverage: { sourceFilesOmittedBySelectionLimit: 0, readFailureCount: 0, oversizedFileCount: 0 },
  tests: testFiles,
  structure: {
    astFileCount: 0,
    syntaxErrorFileCount: 0,
    parseFailureFileCount: 0,
    unresolvedLocalImportCount: 0,
    pathAliases: { unresolvedImportCount: 0 },
    symbols,
    imports,
    testFiles,
    dependencyGraph: { nodes, edges, edgeCount: edges.length },
    workspaceGraph: { packages: workspacePackages, dependencies: workspaceDependencies },
    sourceEvidence: []
  }
});

export const changeImpactCases = [
  {
    id: 'CIA-INV-001',
    category: 'existing_repository',
    description: 'Direct service change propagates to reverse importers and a resolved test import.',
    request: 'change invoice service',
    repository: base({
      nodes: ['src/billing/invoice-service.mjs','src/routes/list.mjs','src/audit/history.mjs','src/admin/dashboard.mjs','test/invoice-service.test.mjs'],
      edges: [edge('src/routes/list.mjs','src/billing/invoice-service.mjs'),edge('src/audit/history.mjs','src/billing/invoice-service.mjs'),edge('src/admin/dashboard.mjs','src/audit/history.mjs'),edge('test/invoice-service.test.mjs','src/billing/invoice-service.mjs')],
      imports: [{from:'test/invoice-service.test.mjs',to:'src/billing/invoice-service.mjs',resolved:true}],
      testFiles: ['test/invoice-service.test.mjs']
    }),
    expected: {
      status: 'analyzed',
      directFiles: ['src/billing/invoice-service.mjs'],
      affectedFiles: ['src/billing/invoice-service.mjs','src/routes/list.mjs','src/audit/history.mjs','src/admin/dashboard.mjs'],
      testFiles: ['test/invoice-service.test.mjs'],
      packagePaths: []
    }
  },
  {
    id: 'CIA-AUTH-002',
    category: 'existing_repository',
    description: 'Authentication intent identifies both the session module and login route as direct candidates, plus a profile consumer and test impact.',
    request: 'update authentication session',
    repository: base({
      nodes: ['src/auth/session.mjs','src/routes/login.mjs','src/routes/profile.mjs','test/session.test.mjs'],
      edges: [edge('src/routes/login.mjs','src/auth/session.mjs'),edge('src/routes/profile.mjs','src/auth/session.mjs'),edge('test/session.test.mjs','src/auth/session.mjs')],
      imports: [{from:'test/session.test.mjs',to:'src/auth/session.mjs',resolved:true}],
      testFiles: ['test/session.test.mjs']
    }),
    expected: {
      status: 'analyzed',
      directFiles: ['src/auth/session.mjs','src/routes/login.mjs'],
      affectedFiles: ['src/auth/session.mjs','src/routes/login.mjs','src/routes/profile.mjs'],
      testFiles: ['test/session.test.mjs'],
      packagePaths: []
    }
  },
  {
    id: 'CIA-WORKSPACE-003',
    category: 'multi_component',
    description: 'Workspace dependency propagation identifies consumer package boundaries.',
    request: 'change catalog service',
    repository: base({
      nodes: ['packages/catalog/src/catalog-service.mjs','packages/storefront/src/product-page.mjs','packages/admin/src/inventory-admin.mjs'],
      edges: [edge('packages/storefront/src/product-page.mjs','packages/catalog/src/catalog-service.mjs'),edge('packages/admin/src/inventory-admin.mjs','packages/catalog/src/catalog-service.mjs')],
      workspacePackages: [pkg('@shop/catalog','packages/catalog'),pkg('@shop/storefront','packages/storefront'),pkg('@shop/admin','packages/admin')],
      workspaceDependencies: [edge('packages/storefront','packages/catalog'),edge('packages/admin','packages/catalog')]
    }),
    expected: {
      status: 'analyzed',
      directFiles: ['packages/catalog/src/catalog-service.mjs'],
      affectedFiles: ['packages/catalog/src/catalog-service.mjs','packages/storefront/src/product-page.mjs','packages/admin/src/inventory-admin.mjs'],
      testFiles: [],
      packagePaths: ['packages/catalog','packages/storefront','packages/admin']
    }
  },
  {
    id: 'CIA-API-004',
    category: 'api_contract',
    description: 'Exported API contract candidate is connected to a downstream consumer.',
    request: 'change customer API response contract',
    repository: base({
      nodes: ['src/api/customer-response.mjs','apps/web/profile-view.mjs','test/customer-response.test.mjs'],
      edges: [edge('apps/web/profile-view.mjs','src/api/customer-response.mjs'),edge('test/customer-response.test.mjs','src/api/customer-response.mjs')],
      imports: [{from:'test/customer-response.test.mjs',to:'src/api/customer-response.mjs',resolved:true}],
      testFiles: ['test/customer-response.test.mjs'],
      symbols: [{file:'src/api/customer-response.mjs',name:'CustomerResponse',exported:true,source:'tree_sitter_ast'}]
    }),
    expected: {
      status: 'analyzed',
      directFiles: ['src/api/customer-response.mjs'],
      affectedFiles: ['src/api/customer-response.mjs','apps/web/profile-view.mjs'],
      testFiles: ['test/customer-response.test.mjs'],
      packagePaths: [],
      apiStatus: 'analyzed',
      apiConsumerFiles: ['apps/web/profile-view.mjs']
    }
  },
  {
    id: 'CIA-AMB-005',
    category: 'ambiguous_or_unmatched',
    description: 'Broad request with no matching repository evidence must not invent a target.',
    request: 'improve real-time insights',
    repository: base({
      nodes: ['src/billing/invoice-service.mjs','src/auth/session.mjs','src/catalog/product-service.mjs'],
      edges: []
    }),
    expected: {
      status: 'no_relevant_matches',
      directFiles: [],
      affectedFiles: [],
      testFiles: [],
      packagePaths: []
    }
  }
];
