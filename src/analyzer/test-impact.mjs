const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const isTestPath = value => { const normalized = String(value || '').split(String.fromCharCode(92)).join('/'); const segments = normalized.split('/'); const base = (segments.at(-1) || '').toLowerCase(); return segments.some(segment => ['__tests__', 'test', 'tests', 'spec'].includes(segment.toLowerCase())) || base.includes('.test.') || base.includes('.spec.'); };

function addCandidate(map, level, rationale, evidence = []) {
  if (!map.has(level)) map.set(level, { level, rationale: [], evidence: [] });
  const item = map.get(level);
  item.rationale.push(rationale);
  item.evidence.push(...evidence.filter(Boolean));
}

/**
 * Build a planning-only verification recommendation from bounded scanner and impact evidence.
 * It never invokes a test runner or claims that a test exists, passed, or was executed.
 */
export function analyzeTestImpact({ request = '', repository = null, changeImpact = null, maxCandidates = 100 } = {}) {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 500) {
    throw new Error('maxCandidates must be an integer from 1 to 500');
  }
  const structure = repository?.structure || {};
  const inventory = sorted([
    ...(Array.isArray(repository?.tests) ? repository.tests : []),
    ...(Array.isArray(structure.testFiles) ? structure.testFiles : [])
  ].filter(isTestPath));
  const linked = Array.isArray(changeImpact?.affectedTests) ? changeImpact.affectedTests : [];
  const linkedByPath = new Map(linked.map(item => [item.path, item]));
  const selectedTests = inventory.filter(path => linkedByPath.has(path)).map(path => ({
    path,
    association: linkedByPath.get(path).association || 'scanner_reported_test_candidate',
    confidence: linkedByPath.get(path).confidence || 'unknown',
    relatedFile: linkedByPath.get(path).relatedFile || null,
    evidenceId: linkedByPath.get(path).evidenceId || null,
    executionStatus: 'not_executed'
  })).slice(0, maxCandidates);

  const candidates = new Map();
  const direct = (changeImpact?.directMatches || []).map(item => item.path);
  const affected = (changeImpact?.potentiallyAffectedFiles || []).map(item => item.path);
  const api = changeImpact?.apiContractImpact || {};
  const db = changeImpact?.databaseSchemaImpact || {};
  const migrations = db.migrationCompatibility || {};
  const schemaChanges = db.schemaChanges || [];
  const requestText = String(request).toLowerCase();
  const requestTerms = new Set(requestText.match(/[a-z0-9]+/g) || []);
  const hasAnyTerm = (...terms) => terms.some(term => requestTerms.has(term));

  if (direct.length || affected.length) {
    addCandidate(candidates, 'unit', 'Add or update focused unit checks for directly matched and transitively affected components.', [...direct, ...affected].slice(0, 20));
  }
  if ((changeImpact?.potentiallyAffectedFiles || []).length || (api.potentiallyAffectedConsumers || []).length || (db.potentiallyAffectedConsumers || []).length) {
    addCandidate(candidates, 'integration', 'Verify interactions across the identified dependency, API-consumer, and schema-consumer boundaries.', [
      ...affected, ...(api.potentiallyAffectedConsumers || []).map(item => item.path), ...(db.potentiallyAffectedConsumers || []).map(item => item.path)
    ].slice(0, 30));
  }
  if (api.status === 'analyzed' || hasAnyTerm('api', 'contract', 'endpoint', 'response', 'request')) {
    addCandidate(candidates, 'contract', 'Check request/response compatibility, validation, serialization, and consumer expectations for the identified contract candidates.', (api.contractSymbols || []).map(item => item.file));
  }
  if (schemaChanges.length || migrations.status === 'analyzed') {
    addCandidate(candidates, 'migration_compatibility', 'Plan old-application/new-schema and new-application/old-schema checks, migration ordering review, representative data validation, and rollback compatibility checks.', schemaChanges.map(item => item.path));
  }
  if (/\\b(auth|authentication|authorization|permission|security|token|credential)\\b/.test(requestText)) {
    addCandidate(candidates, 'security', 'Review authorization boundaries, identity/session handling, negative access cases, and sensitive-data exposure.');
  }
  if (/\\b(performance|latency|throughput|scale|load|index|query)\\b/.test(requestText) || schemaChanges.some(item => /index|alter_column_type|drop_column/i.test(item.operation || ''))) {
    addCandidate(candidates, 'performance', 'Consider representative query/load checks where the changed path or schema can affect latency, throughput, or resource use.', schemaChanges.map(item => item.path));
  }
  addCandidate(candidates, 'regression', 'Run the relevant existing regression suite and adjacent critical workflows selected by the implementation team after reviewing the impact graph.', selectedTests.map(item => item.path));

  const testLevels = [...candidates.values()].map(item => ({
    ...item,
    rationale: sorted(item.rationale),
    evidence: sorted(item.evidence)
  }));
  const scanIncomplete = Boolean(repository?.truncated || repository?.depthTruncated || repository?.fileCountIsLowerBound ||
    repository?.coverage?.sourceFilesOmittedBySelectionLimit || repository?.coverage?.readFailureCount);
  const inventoryAvailable = inventory.length > 0;
  const selectedCount = selectedTests.length;
  const gaps = [];
  if (!inventoryAvailable) gaps.push('No test files were present in the bounded scanner test inventory; this does not prove the project has no tests.');
  if (inventoryAvailable && !selectedCount) gaps.push('No existing test file was linked to the current impact evidence; inspect test discovery, aliases, dynamic imports, and naming conventions.');
  if (scanIncomplete) gaps.push('Repository scan coverage is incomplete or bounded; additional tests and dependencies may be outside the analyzed evidence.');
  if (changeImpact?.graph?.traversalLimits?.depthLimitReached || changeImpact?.graph?.traversalLimits?.nodeLimitReached) gaps.push('Impact graph traversal reached a configured limit; test selection may omit downstream consumers.');
  if (api.status === 'unavailable') gaps.push('API export metadata is unavailable; contract-focused test selection may be incomplete.');
  if (db.status === 'unavailable' && hasAnyTerm('database', 'schema', 'migration', 'sql')) gaps.push('Database schema evidence is unavailable; database and migration verification needs manual discovery.');
  if (!Array.isArray(changeImpact?.directMatches) || !changeImpact.directMatches.length) gaps.push('No direct source-file match was established; proposed test levels are broad planning prompts, not targeted selections.');

  const prerequisites = [];
  if (testLevels.some(item => ['integration', 'contract', 'migration_compatibility'].includes(item.level))) prerequisites.push('Identify an isolated, representative test environment and record service/dependency versions.');
  if (testLevels.some(item => ['migration_compatibility'].includes(item.level))) prerequisites.push('Prepare synthetic or safely anonymized fixtures covering old and new schema representations; do not assume production data is available.');
  if (testLevels.some(item => ['security'].includes(item.level))) prerequisites.push('Use non-production identities and fixtures for authorization-negative cases.');
  prerequisites.push('Record test commands, required configuration, external dependencies, and cleanup expectations for the separate execution tool or human operator.');

  const verificationGates = [
    { id: 'test_scope_reviewed', description: 'A reviewer confirms selected test levels and affected components against the approved change scope.', status: 'proposed' },
    { id: 'acceptance_criteria_mapped', description: 'Each requirement acceptance criterion has at least one named verification method or an explicit justified exception.', status: 'proposed', evidenceStatus: 'not_assessed_by_static_impact_analyzer' },
    { id: 'required_checks_pass', description: 'The external implementation workflow records results for required unit, integration, contract, regression, and applicable specialized checks.', status: 'proposed', evidenceStatus: 'not_executed_by_oiol' },
    { id: 'known_gaps_accepted', description: 'Uncovered paths, unavailable evidence, skipped checks, and residual risks are reviewed and explicitly accepted or resolved.', status: 'proposed' }
  ];

  return {
    status: 'planned',
    method: 'deterministic_test_impact_and_verification_planning',
    inventory: { discoveredTestFileCount: inventory.length, linkedTestFileCount: selectedCount, inventoryAvailable, selectedResultLimit: maxCandidates, resultLimitReached: linked.length > maxCandidates },
    selectedTests,
    recommendedTestLevels: testLevels,
    coverageAssessment: {
      status: 'not_measured',
      requirementAcceptanceCriteria: 'not_assessed',
      codeCoverage: 'not_available',
      rationale: 'Static scanner relationships cannot establish test assertions, requirement coverage, execution, or pass status.'
    },
    gaps: sorted(gaps),
    prerequisites: sorted(prerequisites),
    verificationGates,
    confidence: scanIncomplete || gaps.length >= 3 ? 'low' : selectedCount ? 'medium' : 'low',
    limitations: [
      'Test file discovery and import links are bounded static evidence; they do not prove test assertion quality or complete coverage.',
      'Filename similarity is not treated as proof that a test verifies a requirement.',
      'No test, build, script, migration, or target-project command is executed by OIOL.',
      'All proposed checks are planning recommendations; execution status remains not_executed until reported by an external workflow.'
    ]
  };
}
