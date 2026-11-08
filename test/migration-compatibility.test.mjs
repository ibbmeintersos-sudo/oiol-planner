import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMigrationCompatibility } from '../src/analyzer/migration-compatibility.mjs';
import { scanDatabaseSchema } from '../src/scanner/database-schema.mjs';
import { analyzeDatabaseSchemaImpact } from '../src/analyzer/database-schema-impact.mjs';

const schema = {
  status: 'analyzed',
  tables: [
    { kind: 'table', name: 'customers', path: 'db/migrations/20261108010000_expand.sql', line: 1, columns: [], sourceKind: 'sql_ddl' }
  ],
  changes: [
    { operation: 'add_column', table: 'customers', column: 'email_new', newType: 'varchar(255)', newNullable: true, path: 'db/migrations/20261108010000_expand.sql', line: 4 },
    { operation: 'set_not_null', table: 'customers', column: 'email_new', path: 'db/migrations/20261108020000_enforce.sql', line: 2 },
    { operation: 'drop_column', table: 'customers', column: 'email', path: 'db/migrations/20261108030000_contract.sql', line: 5 }
  ],
  consumers: [
    { table: 'customers', path: 'src/customer-repository.ts', confidence: 'medium', proofLevel: 'textual_reference_not_runtime_binding' }
  ],
  diagnostics: { unclassifiedAlterStatementCount: 0 }
};

test('migration compatibility orders uniquely timestamped migrations and detects an expand-contract candidate', () => {
  const result = analyzeMigrationCompatibility({ databaseSchema: schema });

  assert.equal(result.status, 'analyzed');
  assert.deepEqual(result.orderedMigrations.map(item => item.path), [
    'db/migrations/20261108010000_expand.sql',
    'db/migrations/20261108020000_enforce.sql',
    'db/migrations/20261108030000_contract.sql'
  ]);
  assert.equal(result.diagnostics.orderedMigrationCount, 3);
  assert.ok(result.possibleExpandContractPairs.some(item =>
    item.kind === 'possible_expand_contract_pair' &&
    item.addedColumn === 'email_new' &&
    item.removedColumn === 'email'
  ));
  assert.ok(result.rolloutSequence.some(item => item.stage === 'backfill'));
  assert.match(result.limitations.join(' '), /backfills, dual writes.*not verified/i);
});

test('migration compatibility marks destructive changes as rollout risks for detected consumers', () => {
  const result = analyzeMigrationCompatibility({ databaseSchema: schema });
  const finding = result.compatibilityFindings.find(item => item.operation === 'drop_column');

  assert.equal(finding.severity, 'high');
  assert.equal(finding.consumerCandidateCount, 1);
  assert.equal(finding.compatibility.oldApplicationWithNewSchema, 'breaking_change_candidate_for_detected_consumers');
  assert.match(finding.compatibility.rolloutGuidance, /Do not remove the old object/i);
});

test('migration order remains unknown for filenames without recognized order keys', () => {
  const result = analyzeMigrationCompatibility({
    databaseSchema: {
      ...schema,
      changes: [
        { operation: 'add_column', table: 'customers', column: 'new_field', path: 'db/migrations/add_new_field.sql' }
      ],
      tables: []
    }
  });

  assert.equal(result.diagnostics.unorderedMigrationCount, 1);
  assert.ok(result.sequenceRisks.some(item => item.kind === 'migration_order_unproven'));
  assert.equal(result.orderedMigrations[0].orderKind, 'unknown');
});

test('migration order is not inferred across mixed numeric and timestamp naming schemes', () => {
  const result = analyzeMigrationCompatibility({
    databaseSchema: {
      ...schema,
      changes: [
        { operation: 'add_column', table: 'customers', column: 'first_name', path: 'db/migrations/001_add_first_name.sql' },
        { operation: 'add_column', table: 'customers', column: 'last_name', path: 'db/migrations/20261108020000_add_last_name.sql' }
      ],
      tables: []
    }
  });

  assert.equal(result.diagnostics.orderedMigrationCount, 0);
  assert.equal(result.diagnostics.unorderedMigrationCount, 2);
  assert.ok(result.sequenceRisks.some(item => item.kind === 'mixed_migration_order_schemes'));
});

test('database impact exposes migration compatibility as part of the static estimate', () => {
  const result = analyzeDatabaseSchemaImpact({
    request: 'review database migration order and backward compatibility for customers table',
    queryTokens: new Set(['database', 'migration', 'order', 'backward', 'compatibility', 'customer', 'table']),
    databaseSchema: schema
  });

  assert.equal(result.status, 'analyzed');
  assert.equal(result.migrationCompatibility.status, 'analyzed');
  assert.equal(result.migrationCompatibility.compatibilityFindings.length, 3);
});

test('migration compatibility reports unavailable evidence rather than claiming no migrations', () => {
  const result = analyzeMigrationCompatibility({ databaseSchema: null });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.orderedMigrations.length, 0);
});
