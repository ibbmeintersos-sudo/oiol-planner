const pathOf = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
const basename = value => pathOf(value).split('/').at(-1) || '';
const numericOrder = value => {
  const name = basename(value);
  const timestamp = name.match(/^(20\d{2}[01]\d[0-3]\d[0-2]\d[0-5]\d[0-5]\d)/);
  if (timestamp) return { kind: 'timestamp', value: timestamp[1] };
  const prefix = name.match(/^(\d{3,})/);
  if (prefix) return { kind: 'numeric_prefix', value: prefix[1].padStart(16, '0') };
  return { kind: 'unknown', value: null };
};
const destructive = new Set(['drop_table', 'drop_column', 'rename_table', 'rename_column', 'alter_column_type', 'set_not_null', 'drop_constraint']);
const additive = new Set(['create_table', 'add_column', 'add_constraint', 'add_index', 'drop_not_null']);

function classifyPhase(operations) {
  if (operations.some(item => destructive.has(item.operation))) return 'contract_or_destructive';
  if (operations.some(item => additive.has(item.operation))) return 'expand_or_additive';
  return 'unknown';
}

function classifyCompatibility(change, consumers) {
  const hasConsumer = consumers.length > 0;
  switch (change.operation) {
    case 'add_column':
      return {
        oldApplicationWithNewSchema: change.newNullable === false ? 'conditional_risk' : 'often_compatible_but_unverified',
        newApplicationWithOldSchema: 'potentially_incompatible_if_new_code_reads_or_writes_column',
        rolloutGuidance: 'Prefer an additive nullable column first; deploy code that tolerates both shapes before enforcing constraints.',
        confidence: 'low'
      };
    case 'create_table':
      return {
        oldApplicationWithNewSchema: 'often_compatible_but_unverified',
        newApplicationWithOldSchema: 'incompatible_if_new_code_requires_table',
        rolloutGuidance: 'Create the table before deploying code that depends on it; verify permissions, indexes, and initialization separately.',
        confidence: 'low'
      };
    case 'drop_column':
    case 'drop_table':
      return {
        oldApplicationWithNewSchema: hasConsumer ? 'breaking_change_candidate_for_detected_consumers' : 'unknown_unseen_consumers_possible',
        newApplicationWithOldSchema: 'incompatible_if_new_code_still_expects_removed_object',
        rolloutGuidance: 'Do not remove the old object until old application versions and background workers no longer depend on it; use a separately reviewed contract phase.',
        confidence: 'low'
      };
    case 'rename_column':
    case 'rename_table':
      return {
        oldApplicationWithNewSchema: 'breaking_change_candidate',
        newApplicationWithOldSchema: 'breaking_change_candidate',
        rolloutGuidance: 'Prefer expand-and-contract with an additive replacement, dual-read/write or compatibility mapping, backfill, and a separately approved removal phase.',
        confidence: 'low'
      };
    case 'alter_column_type':
      return {
        oldApplicationWithNewSchema: 'potentially_incompatible_type_contract',
        newApplicationWithOldSchema: 'potentially_incompatible_type_contract',
        rolloutGuidance: 'Validate conversion semantics and deploy compatibility code before changing the stored type; inspect actual data before selecting a conversion.',
        confidence: 'low'
      };
    case 'set_not_null':
      return {
        oldApplicationWithNewSchema: 'conditional_write_compatibility_risk',
        newApplicationWithOldSchema: 'conditional_write_compatibility_risk',
        rolloutGuidance: 'Establish a default or backfill and prove null count is zero before enforcing NOT NULL; scanner cannot verify data state.',
        confidence: 'low'
      };
    case 'add_constraint':
      return {
        oldApplicationWithNewSchema: 'conditional_write_compatibility_risk',
        newApplicationWithOldSchema: 'conditional_write_compatibility_risk',
        rolloutGuidance: 'Validate existing rows and application write patterns before enforcing the constraint.',
        confidence: 'low'
      };
    default:
      return {
        oldApplicationWithNewSchema: 'unknown',
        newApplicationWithOldSchema: 'unknown',
        rolloutGuidance: 'Review the database dialect and application contract before deployment.',
        confidence: 'low'
      };
  }
}

export function analyzeMigrationCompatibility({ databaseSchema = null, maxMigrations = 200, maxFindings = 300 } = {}) {
  if (!databaseSchema || (!Array.isArray(databaseSchema.changes) && !Array.isArray(databaseSchema.tables))) {
    return {
      status: 'unavailable',
      orderedMigrations: [],
      compatibilityFindings: [],
      rolloutSequence: [],
      diagnostics: { migrationCount: 0, orderedMigrationCount: 0, unorderedMigrationCount: 0 },
      limitations: ['Migration metadata was not available in the bounded repository scan.']
    };
  }

  const groups = new Map();
  for (const change of databaseSchema.changes || []) {
    const path = pathOf(change.path);
    if (!path || !/(^|\/)(migrations?|schema|ddl)(\/|$)|\d{3,}[_-]/i.test(path)) continue;
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push({ ...change });
  }
  for (const table of databaseSchema.tables || []) {
    const path = pathOf(table.path);
    if (!path || /(^|\/)(migrations?|schema|ddl)(\/|$)|\d{4,}[_-]/i.test(path) === false) continue;
    if (!groups.has(path)) groups.set(path, []);
    if (!groups.get(path).some(item => item.operation === 'create_table' && String(item.table || item.name).toLowerCase() === String(table.name).toLowerCase())) {
      groups.get(path).push({
        operation: 'create_table',
        table: table.name,
        path,
        line: table.line || null,
        sourceKind: table.sourceKind,
        evidence: table.evidence || null
      });
    }
  }

  const migrations = [...groups.entries()].map(([path, operations]) => {
    const order = numericOrder(path);
    const orderedOps = [...operations].sort((a, b) => (a.line || 0) - (b.line || 0) || String(a.operation).localeCompare(String(b.operation)));
    return {
      path,
      orderKey: order.value,
      orderKind: order.kind,
      operations: orderedOps.map(item => ({
        operation: item.operation,
        table: item.table || null,
        column: item.column || null,
        oldName: item.oldName || null,
        newName: item.newName || null,
        oldType: item.oldType || null,
        newType: item.newType || null,
        line: item.line || null,
        newNullable: item.newNullable ?? null
      })),
      phase: classifyPhase(orderedOps),
      evidenceId: operations.find(item => item.evidence?.id)?.evidence.id || null,
      sourceSha256: operations.find(item => item.evidence?.sourceSha256)?.evidence.sourceSha256 || null
    };
  }).sort((a, b) => {
    if (a.orderKind !== 'unknown' && b.orderKind !== 'unknown' && a.orderKind === b.orderKind) return a.orderKey.localeCompare(b.orderKey) || a.path.localeCompare(b.path);
    if (a.orderKind !== b.orderKind) return a.orderKind === 'unknown' ? 1 : b.orderKind === 'unknown' ? -1 : a.orderKind.localeCompare(b.orderKind);
    return a.path.localeCompare(b.path);
  });

  const keyCounts = new Map();
  for (const item of migrations) if (item.orderKey) keyCounts.set(item.orderKind + ':' + item.orderKey, (keyCounts.get(item.orderKind + ':' + item.orderKey) || 0) + 1);
  const duplicateOrderKeys = [...keyCounts].filter(([, count]) => count > 1).map(([key]) => key);
  const recognizedKinds = new Set(migrations.filter(item => item.orderKind !== 'unknown').map(item => item.orderKind));
  const mixedOrderSchemes = recognizedKinds.size > 1;
  const ordered = mixedOrderSchemes ? [] : migrations.filter(item => item.orderKind !== 'unknown' && !duplicateOrderKeys.includes(item.orderKind + ':' + item.orderKey));
  const unordered = mixedOrderSchemes ? migrations : migrations.filter(item => item.orderKind === 'unknown' || duplicateOrderKeys.includes(item.orderKind + ':' + item.orderKey));

  const consumerByTable = new Map();
  for (const consumer of databaseSchema.consumers || []) {
    const table = String(consumer.table || '').toLowerCase();
    if (!consumerByTable.has(table)) consumerByTable.set(table, []);
    consumerByTable.get(table).push(consumer);
  }
  const findings = [];
  for (const migration of migrations) for (const operation of migration.operations) {
    const consumers = consumerByTable.get(String(operation.table || '').toLowerCase()) || [];
    const compatibility = classifyCompatibility(operation, consumers);
    findings.push({
      migrationPath: migration.path,
      operation: operation.operation,
      table: operation.table,
      column: operation.column,
      severity: destructive.has(operation.operation) ? 'high' : operation.operation === 'add_constraint' || operation.operation === 'set_not_null' ? 'medium' : 'low',
      compatibility,
      consumerCandidateCount: consumers.length,
      consumerPaths: [...new Set(consumers.map(item => pathOf(item.path)))].sort(),
      evidenceId: migration.evidenceId
    });
  }

  const sequenceRisks = [];
  if (unordered.length) sequenceRisks.push({
    kind: 'migration_order_unproven',
    severity: 'high',
    paths: unordered.map(item => item.path),
    message: 'Some migration filenames do not provide a unique recognized numeric or timestamp order. Lexical path order is not proof of execution order.'
  });
  if (mixedOrderSchemes) sequenceRisks.push({
    kind: 'mixed_migration_order_schemes',
    severity: 'high',
    paths: migrations.map(item => item.path),
    message: 'Migration files mix timestamp and numeric-prefix schemes; this analyzer does not compare unlike order-key formats.'
  });
  if (duplicateOrderKeys.length) sequenceRisks.push({
    kind: 'duplicate_migration_order_keys',
    severity: 'high',
    keys: duplicateOrderKeys,
    message: 'Multiple migration files share an order key; their relative execution order cannot be inferred.'
  });

  const orderedPairs = [];
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const earlier = ordered[i], later = ordered[j];
    const earlierOps = earlier.operations, laterOps = later.operations;
    for (const first of earlierOps) for (const next of laterOps) {
      if (String(first.table || '').toLowerCase() !== String(next.table || '').toLowerCase()) continue;
      if (first.operation === 'add_column' && next.operation === 'drop_column' && String(first.column || '').toLowerCase() !== String(next.column || '').toLowerCase()) {
        orderedPairs.push({
          kind: 'possible_expand_contract_pair',
          earlierMigration: earlier.path,
          laterMigration: later.path,
          table: first.table,
          addedColumn: first.column || null,
          removedColumn: next.column || null,
          assessment: 'possible_pattern_only_backfill_and_application_compatibility_not_proven',
          requiredReview: ['Confirm the new column is populated and validated before old-column removal.', 'Confirm all deployed application versions and workers have stopped using the old column.', 'Confirm dual-write/read or compatibility behavior and rollback strategy.']
        });
      }
      if (first.operation === 'add_column' && next.operation === 'set_not_null' && String(first.column || '').toLowerCase() === String(next.column || '').toLowerCase()) {
        orderedPairs.push({
          kind: 'add_then_enforce_not_null',
          earlierMigration: earlier.path,
          laterMigration: later.path,
          table: first.table,
          column: first.column,
          assessment: 'backfill_and_null_validation_not_proven',
          requiredReview: ['Verify backfill completion and zero remaining NULL values before enforcing NOT NULL.', 'Verify old application versions cannot write NULL during the rollout window.']
        });
      }
    }
  }

  const rolloutSequence = [
    { stage: 'expand', purpose: 'Add backward-compatible schema elements first where possible; preserve existing columns and constraints.', gates: ['Review additive schema changes.', 'Deploy application code that tolerates both old and expanded schema shapes.'] },
    { stage: 'backfill', purpose: 'Populate or transform existing data using a separately designed, observable, restartable process.', gates: ['Define idempotency, batching, rate limits, and reconciliation.', 'Measure completion and validate data invariants; no backfill execution is performed by OIOL.'] },
    { stage: 'switch', purpose: 'Move application reads/writes to the new representation while retaining compatibility with older instances during rollout.', gates: ['Verify all active application versions and background workers.', 'Monitor errors, data consistency, and rollback readiness.'] },
    { stage: 'contract', purpose: 'Remove obsolete schema elements only after consumers have migrated and the rollback window is explicitly addressed.', gates: ['Require evidence that old consumers are retired.', 'Review restore/rollback implications and retention requirements.'] }
  ];

  return {
    status: migrations.length ? 'analyzed' : 'no_migration_files_detected',
    method: 'bounded_filename_order_and_ddl_operation_compatibility_estimate',
    orderedMigrations: migrations.slice(0, maxMigrations),
    compatibilityFindings: findings.slice(0, maxFindings),
    possibleExpandContractPairs: orderedPairs.slice(0, maxFindings),
    sequenceRisks,
    rolloutSequence,
    diagnostics: {
      migrationCount: migrations.length,
      orderedMigrationCount: ordered.length,
      unorderedMigrationCount: unordered.length,
      duplicateOrderKeys,
      compatibilityFindingCount: findings.length,
      compatibilityFindingLimitReached: findings.length > maxFindings,
      migrationLimitReached: migrations.length > maxMigrations,
      expandContractPairCount: orderedPairs.length,
      unclassifiedStatementCount: databaseSchema.diagnostics?.unclassifiedAlterStatementCount || 0
    },
    limitations: [
      'Migration order is inferred only from unique numeric or timestamp filename prefixes; the repository migration runner configuration is not evaluated.',
      'A recognized filename order does not prove migrations were applied, applied successfully, or applied in that order in any environment.',
      'Expand/contract patterns are candidates only; backfills, dual writes, feature flags, application deployment windows, and data validation are not verified.',
      'Old/new application compatibility is a conservative static scenario, not a proof of runtime compatibility.',
      'The analysis does not inspect production data, active application versions, migration history tables, database locks, replication lag, or rollback feasibility.',
      'No migration, SQL statement, test, build, or target-project script is executed.'
    ]
  };
}
