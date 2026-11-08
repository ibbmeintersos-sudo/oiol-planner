const norm = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
const evidenceMap = items => new Map((items || []).map(item => [norm(item.path), item]));
const lineAt = (source, index) => source.slice(0, index).split('\n').length;
const cleanIdentifier = value => String(value || '').trim().replace(/^[\`"[]|[\`"\]]$/g, '');
const tableKey = value => cleanIdentifier(value).split('.').at(-1).toLowerCase();

function parseColumns(body) {
  const columns = [];
  for (const raw of body.split(/,(?![^()]*\))/)) {
    const line = raw.trim();
    if (!line || /^(?:constraint|primary\s+key|foreign\s+key|unique|check|index|key)\b/i.test(line)) continue;
    const match = line.match(/^[\`"[]?([\w$-]+)[\`"\]]?\s+([\w]+(?:\s*\([^)]*\))?)/);
    if (!match) continue;
    columns.push({
      name: match[1],
      type: match[2].replace(/\s+/g, ' ').toLowerCase(),
      nullable: !/\bnot\s+null\b/i.test(line),
      primaryKey: /\bprimary\s+key\b/i.test(line),
      unique: /\bunique\b/i.test(line),
      references: (line.match(/\breferences\s+([\w.\`"[]+)/i) || [])[1] || null
    });
  }
  return columns;
}

function addObject(objects, item) {
  const key = item.kind + ':' + item.name.toLowerCase() + ':' + item.path;
  if (!objects.some(existing => existing.key === key)) objects.push({ ...item, key });
}

export function scanDatabaseSchema({ files = [], contents = {}, sourceEvidence = [] } = {}) {
  const evidence = evidenceMap(sourceEvidence);
  const objects = [], changes = [], diagnostics = [];
  const analyzedFiles = files.map(norm).filter(file => typeof contents[file] === 'string');
  let sqlFileCount = 0, migrationFileCount = 0;
  const ormFiles = new Set();

  for (const file of analyzedFiles) {
    const source = contents[file];
    const isMigration = /(^|\/)(migrations?|schema|ddl)(\/|$)|\d{4,}[_-].*(?:migration|schema)/i.test(file);
    if (isMigration) migrationFileCount++;

    if (/\.(?:sql)$/i.test(file)) {
      sqlFileCount++;
      const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\`"[]?[\w.]+[\`"\]]?)\s*\(([\s\S]*?)\)\s*;/gi;
      for (const match of source.matchAll(createRe)) {
        addObject(objects, { kind: 'table', name: tableKey(match[1]), path: file, line: lineAt(source, match.index), columns: parseColumns(match[2]), sourceKind: 'sql_ddl', evidence: evidence.get(file) || null });
      }
      const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?([\`"[]?[\w.]+[\`"\]]?)\s+([\s\S]*?);/gi;
      for (const match of source.matchAll(alterRe)) {
        const table = tableKey(match[1]), body = match[2].trim();
        const base = { table, path: file, line: lineAt(source, match.index), sourceKind: 'sql_ddl', evidence: evidence.get(file) || null };
        let op;
        if (/^add\s+(?:column\s+)?/i.test(body)) {
          const col = body.replace(/^add\s+(?:column\s+)?/i, '').match(/^([\`"[]?[\w$-]+[\`"\]]?)\s+([\w]+(?:\s*\([^)]*\))?)/);
          op = col ? { operation: 'add_column', column: cleanIdentifier(col[1]), newType: col[2] } : { operation: 'add_constraint' };
        } else if (/^drop\s+(?:column\s+)?/i.test(body)) {
          op = { operation: 'drop_column', column: cleanIdentifier(body.replace(/^drop\s+(?:column\s+)?/i, '').split(/\s/)[0]) };
        } else if (/^rename\s+column\s+/i.test(body)) {
          const m = body.match(/^rename\s+column\s+([\w$-]+)\s+to\s+([\w$-]+)/i);
          op = m ? { operation: 'rename_column', oldName: m[1], newName: m[2] } : null;
        } else if (/^rename\s+to\s+/i.test(body)) {
          op = { operation: 'rename_table', newName: cleanIdentifier(body.replace(/^rename\s+to\s+/i, '')) };
        } else if (/^(?:alter\s+column\s+)?[\w$-]+\s+(?:type|set\s+data\s+type)\b/i.test(body)) {
          const m = body.match(/^(?:alter\s+column\s+)?([\w$-]+)\s+(?:type|set\s+data\s+type)\s+([\w]+(?:\s*\([^)]*\))?)/i);
          op = m ? { operation: 'alter_column_type', column: m[1], newType: m[2] } : null;
        } else if (/^alter\s+column\s+/i.test(body)) {
          const m = body.match(/^alter\s+column\s+([\w$-]+)\s+(set\s+not\s+null|drop\s+not\s+null)/i);
          op = m ? { operation: /set/i.test(m[2]) ? 'set_not_null' : 'drop_not_null', column: m[1] } : null;
        } else if (/^drop\s+constraint\b/i.test(body)) {
          op = { operation: 'drop_constraint', constraint: cleanIdentifier(body.replace(/^drop\s+constraint\s+/i, '').split(/\s/)[0]) };
        } else if (/^add\s+constraint\b/i.test(body)) {
          op = { operation: 'add_constraint' };
        }
        if (op) changes.push({ ...base, ...op });
        else diagnostics.push({ kind: 'unclassified_alter_table_statement', file, line: base.line, table });
      }
      for (const match of source.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([\`"[]?[\w.]+[\`"\]]?)/gi)) {
        changes.push({ operation: 'drop_table', table: tableKey(match[1]), path: file, line: lineAt(source, match.index), sourceKind: 'sql_ddl', evidence: evidence.get(file) || null });
      }
      for (const match of source.matchAll(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([\w$-]+)\s+on\s+([\w.]+)/gi)) {
        changes.push({ operation: 'add_index', index: match[1], table: tableKey(match[2]), path: file, line: lineAt(source, match.index), sourceKind: 'sql_ddl', evidence: evidence.get(file) || null });
      }
    }

    if (/\.prisma$/i.test(file)) {
      ormFiles.add(file);
      for (const match of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
        const fields = [];
        for (const row of match[2].split(/\r?\n/)) {
          const field = row.trim().match(/^(\w+)\s+(\w+(?:\[\])?\??)(.*)$/);
          if (field && !field[1].startsWith('@@')) fields.push({ name: field[1], type: field[2], nullable: field[2].endsWith('?'), primaryKey: /@id\b/.test(field[3]), unique: /@unique\b/.test(field[3]) });
        }
        const mapped = (match[2].match(/@@map\(\"([^\"]+)\"\)/) || [])[1];
        addObject(objects, { kind: 'table', name: mapped || match[1], model: match[1], path: file, line: lineAt(source, match.index), columns: fields, sourceKind: 'prisma_model', evidence: evidence.get(file) || null });
      }
    }

    if (/\.(?:[cm]?[jt]sx?|py)$/i.test(file)) {
      const ormPatterns = [
        { re: /@Entity\(\s*['"]([^'"]+)['"]\s*\)/g, kind: 'typeorm_entity' },
        { re: /__tablename__\s*=\s*['"]([^'"]+)['"]/g, kind: 'sqlalchemy_model' },
        { re: /db_table\s*=\s*['"]([^'"]+)['"]/g, kind: 'django_model' },
        { re: /(?:sequelize\.define|define)\(\s*['"]([^'"]+)['"]/g, kind: 'sequelize_model' },
        { re: /(?:pgTable|mysqlTable|sqliteTable)\(\s*['"]([^'"]+)['"]/g, kind: 'drizzle_table' }
      ];
      for (const pattern of ormPatterns) for (const match of source.matchAll(pattern.re)) {
        ormFiles.add(file);
        const className = source.slice(match.index + match[0].length).match(/^\\s*(?:export\\s+)?(?:abstract\\s+)?class\\s+(\\w+)/m)?.[1] || null;
        addObject(objects, { kind: 'table', name: match[1], model: className, path: file, line: lineAt(source, match.index), columns: [], sourceKind: pattern.kind, evidence: evidence.get(file) || null });
      }
    }
  }

  const tables = new Map(objects.filter(item => item.kind === 'table').map(item => [tableKey(item.name), item]));
  const modelToTable = new Map(objects.filter(item => item.model).map(item => [String(item.model).toLowerCase(), tableKey(item.name)]));
  const consumers = [];
  for (const file of analyzedFiles) {
    if (/\.(?:sql|prisma)$/i.test(file)) continue;
    const source = contents[file];
    const names = new Set();
    for (const match of source.matchAll(/\b(?:from|join|into|update|references)\s+[\`"[]?([\w.]+)[\`"\]]?/gi)) names.add(tableKey(match[1]));
    for (const match of source.matchAll(/\b(?:repository|manager)\.?(?:find|findOne|save|update|delete|insert)\w*\s*<\s*(\w+)/gi)) names.add(tableKey(match[1]));
    for (const name of names) if (tables.has(name)) {
      consumers.push({ table: name, path: file, relationship: 'static_table_name_reference', confidence: 'medium', proofLevel: 'textual_reference_not_runtime_binding', evidence: evidence.get(file) || null });
    }
  }

  return {
    method: 'bounded_sql_ddl_prisma_and_orm_pattern_scan',
    status: objects.length || changes.length ? 'analyzed' : 'no_schema_metadata_found',
    tableCount: objects.length,
    tables: objects.slice(0, 1000),
    changes: changes.slice(0, 2000),
    consumers: consumers.slice(0, 3000),
    diagnostics: {
      analyzedFileCount: analyzedFiles.length,
      sqlFileCount,
      ormFileCount: ormFiles.size,
      migrationFileCount,
      changeCountBeforeLimit: changes.length,
      changeLimitReached: changes.length > 2000,
      consumerCountBeforeLimit: consumers.length,
      consumerLimitReached: consumers.length > 3000,
      unclassifiedAlterStatementCount: diagnostics.length
    },
    unclassifiedStatements: diagnostics.slice(0, 200),
    limitations: [
      'Schema extraction is bounded and pattern-based; it does not build a complete database dialect grammar or execute SQL.',
      'SQL parsing is strongest for conventional CREATE TABLE and single-operation ALTER TABLE statements; compound statements may be only partially recognized.',
      'ORM discovery covers selected Prisma, TypeORM, SQLAlchemy, Django, Sequelize, and Drizzle declaration patterns; dynamic model construction and framework conventions may be missed.',
      'Consumer references are textual table-name candidates, not proof of runtime queries, ORM bindings, or actual data flow.',
      'Migration order, database state, generated schemas, stored procedures, triggers, views, vendor-specific semantics, and data contents are not evaluated.'
    ]
  };
}
