import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDatabaseSchema } from '../src/scanner/database-schema.mjs';
import { analyzeDatabaseSchemaImpact } from '../src/analyzer/database-schema-impact.mjs';
import { analyzeChangeImpact } from '../src/analyzer/change-impact.mjs';

const migrationPath = 'db/migrations/20261108_remove_customer_email.sql';
const consumerPath = 'src/customer-repository.ts';
const migration = `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP
);
ALTER TABLE customers DROP COLUMN email;
`;
const consumer = `
export async function findCustomer(email) {
  return db.query('SELECT id FROM customers WHERE email = ?', [email]);
}
`;
const evidence = [migrationPath, consumerPath].map((path, index) => ({
  id: 'REPO-' + String(index + 1).padStart(12, '0'),
  path,
  sourceSha256: 'a'.repeat(64),
  excerptSha256: 'b'.repeat(64),
  trustLevel: 'untrusted_repository_content'
}));

test('database schema scanner extracts SQL tables, columns, DDL operations and textual consumers', () => {
  const result = scanDatabaseSchema({
    files: [migrationPath, consumerPath],
    contents: { [migrationPath]: migration, [consumerPath]: consumer },
    sourceEvidence: evidence
  });

  assert.equal(result.status, 'analyzed');
  const table = result.tables.find(item => item.name === 'customers');
  assert.ok(table);
  assert.deepEqual(table.columns.map(item => item.name), ['id', 'email', 'created_at']);
  assert.equal(table.columns.find(item => item.name === 'email').nullable, false);
  assert.ok(result.changes.some(item => item.operation === 'drop_column' && item.table === 'customers' && item.column === 'email'));
  assert.ok(result.consumers.some(item => item.table === 'customers' && item.path === consumerPath));
  assert.equal(result.diagnostics.migrationFileCount, 1);
  assert.ok(table.evidence?.id);
});

test('database schema impact classifies destructive DDL as risk signals without claiming actual data loss', () => {
  const databaseSchema = scanDatabaseSchema({
    files: [migrationPath, consumerPath],
    contents: { [migrationPath]: migration, [consumerPath]: consumer },
    sourceEvidence: evidence
  });
  const result = analyzeDatabaseSchemaImpact({
    request: 'drop email column from customers database schema migration',
    queryTokens: new Set(['email', 'customer', 'database', 'schema', 'migration', 'column']),
    databaseSchema
  });

  assert.equal(result.status, 'analyzed');
  assert.ok(result.matchedTables.some(item => item.table === 'customers'));
  assert.ok(result.schemaChanges.some(item => item.operation === 'drop_column' && item.severity === 'critical'));
  assert.ok(result.potentiallyAffectedConsumers.some(item => item.path === consumerPath));
  assert.ok(result.riskSignals.includes('data_loss_risk'));
  assert.match(result.limitations.join(' '), /do not prove runtime query execution/i);
  assert.ok(result.schemaChanges[0].evidenceId);
});

test('change impact includes database schema analysis while preserving planning-only behavior', () => {
  const databaseSchema = scanDatabaseSchema({
    files: [migrationPath, consumerPath],
    contents: { [migrationPath]: migration, [consumerPath]: consumer },
    sourceEvidence: evidence
  });
  const repository = {
    fileCount: 2,
    includedFileCount: 2,
    fileCountIsLowerBound: false,
    truncated: false,
    depthTruncated: false,
    tests: [],
    coverage: { sourceFilesOmittedBySelectionLimit: 0, readFailureCount: 0, oversizedFileCount: 0 },
    structure: {
      astFileCount: 1,
      syntaxErrorFileCount: 0,
      parseFailureFileCount: 0,
      unresolvedLocalImportCount: 0,
      pathAliases: { unresolvedImportCount: 0 },
      symbols: [{ file: consumerPath, name: 'findCustomer', kind: 'function' }],
      imports: [],
      testFiles: [],
      sourceEvidence: evidence,
      dependencyGraph: { nodes: [consumerPath], edges: [], edgeCount: 0 },
      workspaceGraph: { packages: [], dependencies: [] },
      databaseSchema
    }
  };
  const result = analyzeChangeImpact({
    request: 'drop email column from customers database schema migration',
    repository
  });

  assert.equal(result.status, 'analyzed');
  assert.equal(result.databaseSchemaImpact.status, 'analyzed');
  assert.equal(result.apiContractImpact.status, 'not_requested');
  assert.ok(result.databaseSchemaImpact.schemaChanges.some(item => item.operation === 'drop_column'));
  assert.match(result.limitations.join(' '), /does not edit repository files or execute commands/i);
});

test('database schema analysis reports missing metadata as unavailable rather than no database', () => {
  const result = analyzeDatabaseSchemaImpact({
    request: 'change database schema table customer',
    databaseSchema: { status: 'no_schema_metadata_found', tables: [], changes: [], consumers: [] }
  });
  assert.equal(result.status, 'unavailable');
  assert.match(result.limitations.join(' '), /not evidence that the project has no database schema/i);
});

test('database schema analysis stays inactive for unrelated requests', () => {
  const result = analyzeDatabaseSchemaImpact({
    request: 'improve the login page',
    databaseSchema: { status: 'analyzed', tables: [], changes: [], consumers: [] }
  });
  assert.equal(result.status, 'not_requested');
});
