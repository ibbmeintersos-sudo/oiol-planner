import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { renderPlanMarkdown } from '../src/core/report.mjs';
import { buildTraceability } from '../src/core/traceability.mjs';
import { SCHEMA_VERSION, emptyPlan } from '../src/contracts/types.mjs';
import { validatePlan } from '../src/core/validator.mjs';

const plan = {
  schemaVersion: SCHEMA_VERSION,
  id: 'plan_test',
  status: 'ready_for_review',
  project: { kind: 'greenfield', name: 'Sample API', request: 'Create a sample API' },
  requirements: [{ id: 'req_1', statement: 'Users can sign in', priority: 'high' }],
  architecture: {
    components: [{ id: 'cmp_auth', name: 'Authentication', responsibilities: ['Validate credentials'] }],
    decisions: [{ decision: 'Use token sessions', reason: 'Stateless API boundary' }]
  },
  tasks: [{
    id: 'task_1', title: 'Define sign-in contract', requirementIds: ['req_1'],
    componentIds: ['cmp_auth'], dependencies: [], acceptanceCriteria: ['Contract documents success and failure responses'],
    writeScope: ['docs/api']
  }],
  dependencyGraph: { nodes: ['task_1'], edges: [] },
  risks: [{ id: 'risk_1', severity: 'medium', description: 'Session theft', mitigation: 'Short-lived tokens' }],
  clarifications: [{ id: 'q1', question: 'Which identity provider?', blocking: true, resolved: false }],
  assumptions: [{ statement: 'Users are internal staff.' }],
  unknowns: [{ question: 'Which identity provider will be selected?' }],
  validation: { valid: true, errors: [], warnings: [] }
};

test('markdown report includes planning essentials and explicit planning-only disclaimer', () => {
  const markdown = renderPlanMarkdown(plan);
  for (const value of ['Engineering Plan', 'Sample API', 'task_1', 'Wave 1', 'Session theft', 'Which identity provider?', 'Requirement traceability', 'req_1', 'Users can sign in', 'Task handoff interfaces', 'Users are internal staff.', 'Which identity provider will be selected?', 'not evidence that implementation']) {
    assert.ok(markdown.includes(value), 'missing report content: ' + value);
  }
});

test('markdown report distinguishes direct candidates, affected tests, and static impact limitations', () => {
  const impactPlan = {
    ...plan,
    project: {
      ...plan.project,
      changeImpact: {
        status: 'analyzed',
        summary: 'One direct candidate and two dependents were identified.',
        scope: 'contained',
        method: 'deterministic_static_impact_estimate',
        confidence: { score: 0.84, level: 'high' },
        directMatches: [{ path: 'src/auth/session.ts', score: 0.6, matchedTerms: ['auth'], evidenceId: 'REPO-123' }],
        potentiallyAffectedFiles: [{ path: 'src/api/profile.ts', depth: 1, propagation: 'reverse_import_dependency', dependsOn: 'src/auth/session.ts' }],
        affectedTests: [{ path: 'test/auth.test.ts', association: 'resolved_test_import_to_impacted_file', confidence: 'high' }],
        affectedPackages: [{ path: 'packages/auth', name: '@app/auth', depth: 0, propagation: 'direct_file_or_request_match' }],
        apiContractImpact: {
          status: 'analyzed',
          diagnostics: { matchedContractSymbolCount: 1, exportMetadataFileCount: 3 },
          contractSymbols: [{ name: 'UserProfileResponse', kind: 'interface', file: 'src/api/profile.ts', line: 12, matchedTerms: ['user', 'profile'], evidenceId: 'REPO-456' }],
          potentiallyAffectedConsumers: [{ path: 'apps/web/profile-client.ts', contractFile: 'src/api/profile.ts', depth: 1, confidence: 'medium' }],
          limitations: ['A file-level import does not prove symbol-level use.']
        },
        risks: ['unresolved_local_dependencies_may_hide_additional_impacts'],
        limitations: ['The affected test list is not evidence that tests were executed.']
      }
    }
  };
  const markdown = renderPlanMarkdown(impactPlan);
  for (const value of [
    'Existing-repository change-impact estimate',
    'Direct candidate files',
    'src/auth/session.ts',
    'Potentially affected files',
    'src/api/profile.ts',
    'Potentially affected tests (not executed)',
    'test/auth.test.ts',
    'Affected workspace packages',
    'API and contract impact (static estimate)',
    'UserProfileResponse',
    'apps/web/profile-client.ts',
    'A file-level import does not prove symbol-level use.',
    'The affected test list is not evidence that tests were executed.'
  ]) {
    assert.ok(markdown.includes(value), 'missing change-impact report content: ' + value);
  }
});

test('traceability is planning-only and exposes requirement-to-acceptance mapping', () => {
  const trace = buildTraceability(plan);
  assert.equal(trace.mappingCoverage, 1);
  assert.deepEqual(trace.rows[0].taskIds, ['task_1']);
  assert.equal(trace.rows[0].acceptanceCriteria[0].statement, 'Contract documents success and failure responses');
  assert.equal('verificationComplete' in trace, false);
  assert.equal('verified' in trace.rows[0], false);
});

test('empty plans declare the published schema version', () => {
  assert.equal(emptyPlan({ kind: 'greenfield' }).schemaVersion, SCHEMA_VERSION);
});

test('published plan schema is draft 2020-12 and defines the planning contract', async () => {
  const schema = JSON.parse(await fs.readFile(new URL('../schemas/plan.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schemaVersion.const, SCHEMA_VERSION);
  assert.ok(schema.required.includes('dependencyGraph'));
  assert.ok(schema.required.includes('tasks'));
});

test('published example plan satisfies deterministic planning validation', async () => {
  const example = JSON.parse(await fs.readFile(new URL('../examples/plan.v1.json', import.meta.url), 'utf8'));
  const validation = validatePlan(example, example.project);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(example.schemaVersion, SCHEMA_VERSION);
});

test('markdown report surfaces P2 quality metrics, test strategy, rollback, and risk estimates', () => {
  const qualityPlan = {
    ...plan,
    testStrategy: { approach: 'Risk-based testing', levels: ['unit','integration'], coverage: ['req_1'], entryCriteria: ['Contract reviewed'], exitCriteria: ['Required checks pass'], testData: 'Synthetic accounts' },
    rollbackPlan: { applicability: 'applicable', rationale: 'Deployment changes a data path', strategy: 'Restore prior compatible version', triggerConditions: ['Error budget exceeded'], steps: ['Stop rollout'], verification: ['Confirm service health'], dataCompatibility: 'Old version can read new records during the rollback window' },
    unknownsReviewed: true,
    assumptions: [{ statement: 'Database supports additive migration.', confidence: 'medium', validationApproach: 'Check deployed database version.' }],
    unknowns: [{ description: 'Production load baseline is unknown.', impact: 'Latency target may be miscalibrated.', resolutionApproach: 'Measure representative load.', blocking: false }],
    risks: [{ id: 'risk_1', description: 'Capacity may be exceeded', likelihood: 3, impact: 4, severity: 'high', mitigation: 'Load test and admission control' }],
    evaluation: { planQuality: { nfr: { measurableCount: 1, requirementCount: 1, measurableRate: 1 }, testStrategy: { completedFields: 6, totalFields: 6 }, rollback: { applicability: 'applicable', completeness: 1 }, unknowns: { reviewed: true, count: 1, withResolutionCount: 1 }, assumptions: { validatedCount: 1, count: 1 }, risks: { estimatedCount: 1, count: 1, meanExposure: 12, highOrCriticalCount: 1 } } }
  };
  const markdown = renderPlanMarkdown(qualityPlan);
  for (const value of ['Plan quality evidence','Measurable NFRs','Test strategy','Rollback plan','Likelihood × impact','Derived exposure','resolution: Measure representative load.']) {
    assert.ok(markdown.includes(value), 'missing P2 quality evidence: ' + value);
  }
});

test('markdown report surfaces database schema impact, DDL risk, consumers, and limitations', () => {
  const schemaPlan = {
    ...plan,
    project: {
      ...plan.project,
      changeImpact: {
        databaseSchemaImpact: {
          status: 'analyzed',
          diagnostics: { matchedTableCount: 1, matchedChangeCount: 1, consumerCandidateCount: 1, migrationFileCount: 1 },
          matchedTables: [{ table: 'customers', path: 'db/schema.sql', line: 4, matchedTerms: ['customer'], evidenceId: 'REPO-000000000001' }],
          schemaChanges: [{ operation: 'drop_column', table: 'customers', column: 'email', path: 'db/migrations/001.sql', line: 8, severity: 'critical', riskSignals: ['data_loss_risk'] }],
          potentiallyAffectedConsumers: [{ path: 'src/customer-repository.ts', table: 'customers', confidence: 'medium', proofLevel: 'textual_reference_not_runtime_binding' }],
          riskSignals: ['data_loss_risk'],
          limitations: ['Textual consumer references do not prove runtime query execution.']
        }
      }
    }
  };
  const markdown = renderPlanMarkdown(schemaPlan);
  for (const value of ['Database schema impact','Schema objects matched','drop_column','customers','src/customer-repository.ts','data_loss_risk','Textual consumer references do not prove runtime query execution.']) {
    assert.ok(markdown.includes(value), 'missing database schema impact evidence: ' + value);
  }
});

test('markdown report surfaces migration sequencing, compatibility matrix, and rollout gates', () => {
  const migrationPlan = {
    ...plan,
    project: {
      ...plan.project,
      changeImpact: {
        databaseSchemaImpact: {
          status: 'analyzed',
          diagnostics: { matchedTableCount: 1, matchedChangeCount: 1, consumerCandidateCount: 1, migrationFileCount: 2 },
          matchedTables: [],
          schemaChanges: [],
          potentiallyAffectedConsumers: [],
          riskSignals: [],
          limitations: [],
          migrationCompatibility: {
            status: 'analyzed',
            diagnostics: { orderedMigrationCount: 2, unorderedMigrationCount: 0, expandContractPairCount: 1 },
            orderedMigrations: [{ path: 'db/migrations/001_expand.sql', orderKey: '001', phase: 'expand_or_additive', operations: [{ operation: 'add_column', table: 'customers', column: 'email_new' }] }],
            sequenceRisks: [],
            possibleExpandContractPairs: [{ table: 'customers', addedColumn: 'email_new', removedColumn: 'email', earlierMigration: 'db/migrations/001_expand.sql', laterMigration: 'db/migrations/002_contract.sql' }],
            compatibilityFindings: [{ operation: 'drop_column', table: 'customers', compatibility: { oldApplicationWithNewSchema: 'breaking_change_candidate_for_detected_consumers', newApplicationWithOldSchema: 'incompatible_if_new_code_still_expects_removed_object', rolloutGuidance: 'Wait until old consumers are retired.' } }],
            rolloutSequence: [{ stage: 'backfill', purpose: 'Populate the new representation.', gates: ['Validate completion before contract.'] }],
            limitations: ['Filename order does not prove migration execution order.']
          }
        }
      }
    }
  };
  const markdown = renderPlanMarkdown(migrationPlan);
  for (const value of ['Migration ordering and rollout compatibility', 'Ordered migration candidates', 'possible expand/contract', 'old app/new schema', 'breaking_change_candidate_for_detected_consumers', 'backfill', 'Filename order does not prove migration execution order.']) {
    assert.ok(markdown.toLowerCase().includes(value.toLowerCase()), 'missing migration compatibility report content: ' + value);
  }
});
