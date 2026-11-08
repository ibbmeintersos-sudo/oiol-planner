import { createHash } from 'node:crypto';

const sha256 = value => createHash('sha256').update(String(value || '')).digest('hex');
const normPath = value => String(value || '').replaceAll('\\\\', '/').replace(/^\\.\\//, '');
const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[\\u064B-\\u065F\\u0670\\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const tokens = value => {
  const prepared = String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return new Set((prepared.match(/[\\p{L}\\p{N}]+/gu) || []).map(normalize).filter(item => item.length > 1));
};
const sorted = values => [...values].sort((a, b) => a.localeCompare(b));
const overlap = (a, b) => sorted([...a].filter(item => b.has(item)));
const isRequested = request => /\\b(?:database|db|schema|table|column|migration|migrations|ddl|sql|orm|prisma|drizzle|typeorm|sequelize|django|sqlalchemy|foreign\\s+key|index|constraint|nullable|not\\s+null)\\b|قاعد(?:ة|ه)\\s+بيانات|مخطط\\s+البيانات|جدول|جداول|عمود|اعمده|أعمدة|ترحيل|ترحيلات|فهرس|فهارس|قيد\\s+مرجع/u.test(request);
const evidenceFields = evidence => evidence ? {
  evidenceId: evidence.id || null,
  sourceSha256: evidence.sourceSha256 || null,
  excerptSha256: evidence.excerptSha256 || null,
  trustLevel: evidence.trustLevel || 'untrusted_repository_content'
} : { evidenceId: null, sourceSha256: null, excerptSha256: null, trustLevel: 'untrusted_repository_metadata' };

function classifyRisk(change) {
  switch (change.operation) {
    case 'drop_table': return { severity: 'critical', risks: ['breaking_change_candidate', 'data_loss_risk'] };
    case 'drop_column': return { severity: 'critical', risks: ['breaking_change_candidate', 'data_loss_risk'] };
    case 'rename_table':
    case 'rename_column': return { severity: 'high', risks: ['breaking_change_candidate', 'migration_order_risk'] };
    case 'alter_column_type': return { severity: 'high', risks: ['breaking_change_candidate', 'possible_data_conversion_or_loss'] };
    case 'set_not_null': return { severity: 'high', risks: ['existing_null_data_may_block_migration', 'migration_order_risk'] };
    case 'drop_constraint': return { severity: 'medium', risks: ['integrity_constraint_removed'] };
    case 'add_constraint': return { severity: 'medium', risks: ['existing_data_may_violate_new_constraint', 'migration_order_risk'] };
    case 'add_column': return { severity: 'medium', risks: ['consumer_contract_may_require_coordination'] };
    case 'add_index': return { severity: 'low', risks: ['migration_operational_cost_requires_review'] };
    default: return { severity: 'unknown', risks: ['unclassified_schema_change_requires_review'] };
  }
}

export function analyzeDatabaseSchemaImpact({ request = '', queryTokens = new Set(), databaseSchema = null, maxResults = 250 } = {}) {
  const requestText = String(request || '');
  if (!isRequested(requestText)) return {
    status: 'not_requested', method: 'bounded_schema_metadata_and_reference_analysis',
    matchedTables: [], schemaChanges: [], potentiallyAffectedConsumers: [],
    diagnostics: { tableMetadataCount: 0, matchedTableCount: 0, matchedChangeCount: 0, consumerCandidateCount: 0 }
  };
  if (!databaseSchema || !Array.isArray(databaseSchema.tables) || databaseSchema.status === 'no_schema_metadata_found') return {
    status: 'unavailable', method: 'bounded_schema_metadata_and_reference_analysis',
    matchedTables: [], schemaChanges: [], potentiallyAffectedConsumers: [],
    diagnostics: { tableMetadataCount: databaseSchema?.tables?.length || 0, matchedTableCount: 0, matchedChangeCount: 0, consumerCandidateCount: 0 },
    limitations: ['No supported SQL DDL, Prisma, or recognized ORM schema metadata was available in the bounded scan.', 'Unavailable schema metadata is not evidence that the project has no database schema.']
  };

  const tableRecords = databaseSchema.tables || [];
  const changes = databaseSchema.changes || [];
  const requestTerms = new Set(queryTokens?.size ? queryTokens : tokens(requestText));
  const matchedTables = tableRecords.map(table => {
    const tableTerms = tokens(table.name);
    const columnMatches = (table.columns || []).map(column => ({ column: column.name, matchedTerms: overlap(requestTerms, tokens(column.name)), type: column.type || column.typeName || null, nullable: column.nullable ?? null, primaryKey: column.primaryKey === true }))
      .filter(column => column.matchedTerms.length);
    const matchedTerms = overlap(requestTerms, tableTerms);
    const score = matchedTerms.length * 2 + columnMatches.reduce((sum, column) => sum + column.matchedTerms.length, 0);
    return { table: table.name, model: table.model || null, path: normPath(table.path), line: table.line || null, sourceKind: table.sourceKind, matchedTerms, matchedColumns: columnMatches, score, ...evidenceFields(table.evidence) };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.table.localeCompare(b.table) || a.path.localeCompare(b.path));

  const matchedNames = new Set(matchedTables.map(item => String(item.table).toLowerCase()));
  const matchedChanges = changes.map(change => {
    const tableName = String(change.table || '').toLowerCase();
    const table = matchedTables.find(item => item.table.toLowerCase() === tableName);
    const fieldTerms = tokens([change.column, change.oldName, change.newName, change.constraint, change.index].filter(Boolean).join(' '));
    const tableTerms = tokens(change.table || '');
    const matchedTerms = sorted(new Set([...overlap(requestTerms, fieldTerms), ...overlap(requestTerms, tableTerms)]));
    const relevant = Boolean(table || matchedNames.has(tableName) || matchedTerms.length >= 2);
    if (!relevant) return null;
    const risk = classifyRisk(change);
    return {
      operation: change.operation, table: change.table || null, column: change.column || null,
      oldName: change.oldName || null, newName: change.newName || null,
      oldType: change.oldType || null, newType: change.newType || null,
      path: normPath(change.path), line: change.line || null,
      matchedTerms, severity: risk.severity, riskSignals: risk.risks,
      migrationFileCandidate: /(^|\\/)(migrations?|schema|ddl)(\\/|$)|\\d{4,}[_-].*(?:migration|schema)/i.test(change.path || ''),
      ...evidenceFields(change.evidence)
    };
  }).filter(Boolean).sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3, unknown: 4 }[a.severity] - { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 }[b.severity]) || a.path.localeCompare(b.path) || (a.line || 0) - (b.line || 0));

  const matchedTableNames = new Set(matchedTables.map(item => item.table.toLowerCase()));
  const matchedChangeTables = new Set(matchedChanges.map(item => String(item.table || '').toLowerCase()));
  const relevantTables = new Set([...matchedTableNames, ...matchedChangeTables]);
  const consumers = (databaseSchema.consumers || []).filter(item => relevantTables.has(String(item.table || '').toLowerCase()))
    .map(item => ({ table: item.table, path: normPath(item.path), relationship: item.relationship || 'static_table_name_reference', confidence: item.confidence || 'medium', proofLevel: item.proofLevel || 'textual_reference_not_runtime_binding', ...evidenceFields(item.evidence) }))
    .sort((a, b) => a.table.localeCompare(b.table) || a.path.localeCompare(b.path));
  const limitedChanges = matchedChanges.slice(0, maxResults);
  const limitedConsumers = consumers.slice(0, maxResults);
  const riskSignals = sorted(new Set(matchedChanges.flatMap(item => item.riskSignals)));
  const status = matchedTables.length || matchedChanges.length ? 'analyzed' : 'insufficient_schema_match';
  return {
    status,
    method: 'bounded_schema_metadata_and_reference_analysis',
    matchedTables: matchedTables.slice(0, maxResults),
    schemaChanges: limitedChanges,
    potentiallyAffectedConsumers: limitedConsumers,
    riskSignals,
    diagnostics: {
      tableMetadataCount: tableRecords.length,
      matchedTableCount: matchedTables.length,
      schemaChangeCount: changes.length,
      matchedChangeCount: matchedChanges.length,
      consumerCandidateCount: consumers.length,
      resultLimit: maxResults,
      tableResultLimitReached: matchedTables.length > maxResults,
      changeResultLimitReached: matchedChanges.length > maxResults,
      consumerResultLimitReached: consumers.length > maxResults,
      unclassifiedAlterStatementCount: databaseSchema.diagnostics?.unclassifiedAlterStatementCount || 0,
      migrationFileCount: databaseSchema.diagnostics?.migrationFileCount || 0
    },
    limitations: [
      ...(databaseSchema.limitations || []),
      'A textual match between a request term and a table or column name is a candidate match, not semantic proof that the requested change targets that object.',
      'Static consumer references do not prove runtime query execution, ORM entity binding, or complete downstream data flow.',
      'A migration filename or DDL statement does not establish its execution order or the current production database state.',
      'Risk labels identify review scenarios; they do not prove that data loss, migration failure, or a breaking change will occur.',
      'OIOL does not execute migrations, SQL, tests, builds, or project scripts.'
    ]
  };
}
