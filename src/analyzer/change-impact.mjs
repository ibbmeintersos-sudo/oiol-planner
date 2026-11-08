import { createHash } from 'node:crypto';
import { analyzeDatabaseSchemaImpact } from './database-schema-impact.mjs';

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','in','into','is','it','of','on','or','our',
  'the','to','was','we','with','without','please','should','need','want','implement','support','new','existing','api',
  'add','change','create','update','modify','fix','make','remove','delete','refactor','improve','enhance',
  'اريد','أريد','نريد','من','في','على','الى','إلى','عن','مع','هذا','هذه','ذلك','ثم','و','او','أو',
  'ان','أن','يتم','تم','لي','النظام','التطبيق','المشروع','الخاص','به','تعديل','تحديث','اضافه','إضافة',
  'حذف','انشاء','إنشاء','اصلاح','إصلاح','تحسين','تغيير','تطوير','بناء','دعم'
]);

const TOKEN_GROUPS = [
  ['auth','authentication','authenticate','authorization','authorize','login','signin','sign-in','log-in','دخول','الدخول','تسجيل','مصادقة'],
  ['user','users','account','accounts','مستخدم','مستخدمين','المستخدم','المستخدمين','حساب','حسابات','الحساب'],
  ['order','orders','طلب','طلبات','الطلب','الطلبات'],
  ['product','products','منتج','منتجات','المنتج','المنتجات'],
  ['payment','payments','pay','billing','دفع','مدفوعات','المدفوعات','الفوترة'],
  ['invoice','invoices','فاتورة','فواتير','الفاتورة','الفواتير'],
  ['notification','notifications','notify','إشعار','اشعار','إشعارات','اشعارات','التنبيهات'],
  ['customer','customers','client','clients','عميل','عملاء','العميل','العملاء'],
  ['inventory','stock','warehouse','مخزون','المخزون','المستودع','المخازن'],
  ['report','reports','analytics','تقرير','تقارير','التقارير','تحليلات'],
  ['search','query','بحث','البحث','استعلام'],
  ['route','routes','endpoint','مسار','مسارات','نقطة']
];

function normalizeToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي');
}

const TOKEN_CANONICAL = new Map();
for (const group of TOKEN_GROUPS) {
  const canonical = group[0];
  for (const token of group) TOKEN_CANONICAL.set(normalizeToken(token), canonical);
}

function tokenSet(value) {
  const prepared = String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const raw = prepared.match(/[\p{L}\p{N}]+/gu) || [];
  const tokens = new Set();
  for (let token of raw) {
    token = normalizeToken(token);
    if (/^[\u0600-\u06FF]+$/u.test(token) && token.length > 4 && token.startsWith('ال')) {
      token = token.slice(2);
    }
    if (token.length < 2 || STOP_WORDS.has(token)) continue;
    tokens.add(TOKEN_CANONICAL.get(token) || token);
  }
  return tokens;
}

const sorted = values => [...values].sort((a, b) => a.localeCompare(b));
const round = value => Number(value.toFixed(3));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const normPath = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/');

function isTestFilePath(value) {
  const file = normPath(value);
  const base = file.split('/').at(-1) || '';
  return /(^|\/)(__tests__|tests?|spec)(\/|$)/i.test(file) ||
    /\.(?:test|spec)\.[^.]+$/i.test(base) ||
    /(^|\/)(?:test|spec)[_-]/i.test(file);
}

function tokenIntersection(queryTokens, featureTokens) {
  return new Set([...queryTokens].filter(token => featureTokens.has(token)));
}

function confidenceLevel(score) {
  if (score >= 0.8) return 'high';
  if (score >= 0.58) return 'medium';
  return 'low';
}

function packageForFile(file, packages) {
  return packages
    .filter(item => file === item.path || file.startsWith(item.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0] || null;
}

function createCoverageConfidence(repository, structure) {
  let score = structure.astFileCount > 0 ? 0.84 : 0.67;
  const coverage = repository.coverage || {};
  const penalties = [];
  if (repository.fileCountIsLowerBound || repository.truncated || repository.depthTruncated) {
    score -= 0.12;
    penalties.push('repository_file_or_depth_scan_truncated');
  }
  if ((coverage.sourceFilesOmittedBySelectionLimit || 0) > 0) {
    score -= 0.12;
    penalties.push('source_file_selection_limit_reached');
  }
  if ((structure.syntaxErrorFileCount || 0) > 0 || (structure.parseFailureFileCount || 0) > 0) {
    score -= 0.04;
    penalties.push('parser_recovery_or_failure_present');
  }
  if ((structure.unresolvedLocalImportCount || 0) > 0) {
    score -= 0.04;
    penalties.push('unresolved_local_imports_present');
  }
  if ((structure.pathAliases?.unresolvedImportCount || 0) > 0) {
    score -= 0.03;
    penalties.push('unresolved_path_aliases_present');
  }
  if ((coverage.readFailureCount || 0) > 0 || (coverage.oversizedFileCount || 0) > 0) {
    score -= 0.04;
    penalties.push('some_selected_files_were_not_read');
  }
  score = Math.max(0.3, Math.min(0.95, score));
  return {
    score: round(score),
    level: confidenceLevel(score),
    basis: structure.astFileCount > 0 ? 'tree_sitter_with_bounded_static_fallback' : 'bounded_lexical_static_analysis',
    penalties
  };
}

function buildFileFeatures(structure, sourceFiles, queryTokens, evidenceByPath, workspacePackages) {
  const symbolsByFile = new Map();
  for (const symbol of structure.symbols || []) {
    const file = normPath(symbol.file);
    if (!symbolsByFile.has(file)) symbolsByFile.set(file, new Set());
    for (const token of tokenSet(symbol.name)) symbolsByFile.get(file).add(token);
  }

  const importsByFile = new Map();
  for (const item of structure.imports || []) {
    const file = normPath(item.from);
    if (!importsByFile.has(file)) importsByFile.set(file, new Set());
    for (const token of tokenSet(item.specifier)) importsByFile.get(file).add(token);
  }

  const results = [];
  for (const file of sourceFiles) {
    const pathTokens = tokenSet(file);
    const symbolTokens = symbolsByFile.get(file) || new Set();
    const importTokens = importsByFile.get(file) || new Set();
    const pathMatches = tokenIntersection(queryTokens, pathTokens);
    const symbolMatches = tokenIntersection(queryTokens, symbolTokens);
    const importMatches = tokenIntersection(queryTokens, importTokens);
    const matchedTerms = new Set([...pathMatches, ...symbolMatches, ...importMatches]);
    if (!matchedTerms.size) continue;

    // Long natural-language requests often contain context terms unrelated to file naming.
    // Cap the denominator so one strong path/symbol signal is not diluted by request length.
    // Import-specifier-only matches remain deliberately weak.
    const denominator = Math.min(queryTokens.size || 1, 4);
    const score = (
      0.55 * pathMatches.size / denominator +
      0.35 * symbolMatches.size / denominator +
      0.10 * importMatches.size / denominator
    );
    if (score < 0.08) continue;
    const evidence = evidenceByPath.get(file);
    const pkg = packageForFile(file, workspacePackages);
    const signals = [];
    if (pathMatches.size) signals.push('path_match');
    if (symbolMatches.size) signals.push('symbol_match');
    if (importMatches.size) signals.push('import_specifier_match');
    results.push({
      path: file,
      score: round(Math.min(1, score)),
      matchedTerms: sorted(matchedTerms),
      signals,
      packagePath: pkg?.path || null,
      evidenceId: evidence?.id || null,
      sourceSha256: evidence?.sourceSha256 || null,
      excerptSha256: evidence?.excerptSha256 || null,
      evidenceStatus: evidence ? 'fingerprinted_source_excerpt' : 'source_read_without_excerpt'
    });
  }
  return results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function reverseReachability(seeds, reverseEdges, { maxDepth, maxNodes }) {
  const reached = new Map();
  const seedSet = new Set(seeds);
  const queue = seeds.map(path => ({ path, depth: 0, origin: path }));
  const seenAtDepth = new Map(seeds.map(path => [path, 0]));
  const depthFrontier = new Set();
  let nodeLimitReached = false;

  // Cursor-based breadth-first traversal avoids repeated Array.shift() costs on large graphs.
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const dependents = sorted(reverseEdges.get(current.path) || []);
    if (current.depth >= maxDepth) {
      for (const dependent of dependents) {
        if (!seedSet.has(dependent) && !seenAtDepth.has(dependent)) depthFrontier.add(dependent);
      }
      continue;
    }
    for (const dependent of dependents) {
      if (seedSet.has(dependent)) continue;
      const nextDepth = current.depth + 1;
      const knownDepth = seenAtDepth.get(dependent);
      if (knownDepth !== undefined && knownDepth <= nextDepth) continue;
      if (!reached.has(dependent) && reached.size >= maxNodes) {
        nodeLimitReached = true;
        queue.length = cursor + 1;
        break;
      }
      seenAtDepth.set(dependent, nextDepth);
      reached.set(dependent, {
        path: dependent,
        depth: nextDepth,
        dependsOn: current.path,
        origin: current.origin,
        propagation: 'reverse_import_dependency'
      });
      queue.push({ path: dependent, depth: nextDepth, origin: current.origin });
    }
  }
  return {
    reached,
    nodeLimitReached,
    depthLimitReached: depthFrontier.size > 0,
    depthFrontierCount: depthFrontier.size,
    truncated: nodeLimitReached || depthFrontier.size > 0
  };
}

function hasApiContractIntent(requestText) {
  return /\b(?:api|apis|contract|interface|dto|endpoint|request\s*\/\s*response|public\s+api|breaking\s+change|backward\s+compatib(?:le|ility))\b|واجه(?:ة|ات)|عقد\s+(?:ال)?واجه|مخطط(?:\s+ال)?بيانات|نقط(?:ة|ه)\s+نهاي/u.test(requestText);
}

function analyzeApiContractImpact({
  requestText,
  queryTokens,
  structure,
  directMatches,
  reverseImports,
  testPathSet,
  maxDepth,
  maxNodes
}) {
  const requested = hasApiContractIntent(requestText);
  if (!requested) {
    return {
      status: 'not_requested',
      method: 'ast_export_metadata_plus_reverse_import_graph',
      contractSymbols: [],
      potentiallyAffectedConsumers: [],
      diagnostics: { exportedSymbolCount: 0, matchedContractSymbolCount: 0, exportMetadataFileCount: 0 }
    };
  }

  const symbols = Array.isArray(structure.symbols) ? structure.symbols : [];
  const exportMetadata = symbols.filter(item =>
    /\.(?:jsx?|mjs|cjs|tsx?|mts|cts)$/i.test(String(item.file || '')) &&
    item.source === 'tree_sitter_ast' && typeof item.exported === 'boolean'
  );
  const exportMetadataFileCount = new Set(exportMetadata.map(item => normPath(item.file))).size;
  const exportedSymbols = exportMetadata.filter(item => item.exported === true);
  const directPaths = new Set(directMatches.map(item => normPath(item.path)));
  const contractSymbols = exportedSymbols
    .filter(item => directPaths.has(normPath(item.file)))
    .map(item => {
      const matchedTerms = sorted(tokenIntersection(queryTokens, tokenSet(item.name)));
      return {
        name: item.name,
        kind: item.kind,
        file: normPath(item.file),
        line: Number.isInteger(item.line) ? item.line : null,
        matchedTerms,
        evidenceId: item.evidenceId || null,
        sourceSha256: item.sourceSha256 || null,
        excerptSha256: item.excerptSha256 || null,
        trustLevel: item.trustLevel || 'untrusted_repository_metadata',
        exportVisibilitySource: item.exportVisibilitySource || null,
        exported: true,
        source: item.source
      };
    })
    .filter(item => item.matchedTerms.length >= 2)
    .sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
    .slice(0, 100);

  if (!exportMetadataFileCount) {
    return {
      status: 'unavailable',
      method: 'ast_export_metadata_plus_reverse_import_graph',
      contractSymbols: [],
      potentiallyAffectedConsumers: [],
      diagnostics: {
        exportedSymbolCount: 0,
        matchedContractSymbolCount: 0,
        exportMetadataFileCount: 0,
        reason: 'No AST-backed JavaScript/TypeScript export metadata was available; lexical declarations are not treated as proven public contracts.'
      },
      limitations: [
        'API contract matching requires AST-backed JavaScript/TypeScript export metadata in the bounded scanner evidence.',
        'A lack of export metadata is not evidence that the repository has no public API.'
      ]
    };
  }

  const contractFiles = sorted(new Set(contractSymbols.map(item => item.file)));
  const reachability = reverseReachability(contractFiles, reverseImports, { maxDepth, maxNodes });
  const allConsumerCandidates = [...reachability.reached.values()]
    .filter(item => !testPathSet.has(normPath(item.path)))
    .map(item => ({
      path: normPath(item.path),
      depth: item.depth,
      dependsOn: item.dependsOn,
      contractFile: item.origin,
      relationship: 'imports_contract_candidate_file',
      confidence: 'medium',
      proofLevel: 'file_import_edge_not_symbol_binding'
    }))
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const potentiallyAffectedConsumers = allConsumerCandidates.slice(0, 250);

  return {
    status: contractSymbols.length ? 'analyzed' : 'insufficient_symbol_match',
    method: 'ast_export_metadata_plus_reverse_import_graph',
    contractSymbols,
    potentiallyAffectedConsumers,
    diagnostics: {
      exportedSymbolCount: exportedSymbols.length,
      matchedContractSymbolCount: contractSymbols.length,
      exportMetadataFileCount,
      contractSeedFileCount: contractFiles.length,
      consumerCandidateCountBeforeLimit: allConsumerCandidates.length,
      consumerResultLimit: 250,
      consumerResultLimitReached: allConsumerCandidates.length > 250,
      depthLimitReached: reachability.depthLimitReached,
      depthFrontierCount: reachability.depthFrontierCount,
      nodeLimitReached: reachability.nodeLimitReached
    },
    limitations: [
      'Export visibility is recorded only for AST-parsed JavaScript/TypeScript/TSX declarations; re-export lists and language-specific public visibility are not fully modeled.',
      'A consumer import edge proves a file-level dependency, not that the consumer imports or calls the specific changed symbol.',
      'Type resolution, overload resolution, package export maps, generated declarations, and runtime API registration are not analyzed.',
      'Consumer candidates are planning leads and require human review; OIOL does not execute compatibility checks or tests.'
    ]
  };
}

function packageReachability(seeds, reverseEdges, { maxDepth, maxNodes }) {
  const reached = new Map();
  const seedSet = new Set(seeds);
  const queue = seeds.map(path => ({ path, depth: 0, origin: path }));
  const seen = new Map(seeds.map(path => [path, 0]));
  const depthFrontier = new Set();
  let nodeLimitReached = false;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const dependents = sorted(reverseEdges.get(current.path) || []);
    if (current.depth >= maxDepth) {
      for (const dependent of dependents) {
        if (!seedSet.has(dependent) && !seen.has(dependent)) depthFrontier.add(dependent);
      }
      continue;
    }
    for (const dependent of dependents) {
      if (seedSet.has(dependent)) continue;
      const depth = current.depth + 1;
      if (seen.has(dependent) && seen.get(dependent) <= depth) continue;
      if (!reached.has(dependent) && reached.size >= maxNodes) {
        nodeLimitReached = true;
        queue.length = cursor + 1;
        break;
      }
      seen.set(dependent, depth);
      reached.set(dependent, {
        path: dependent,
        depth,
        dependsOn: current.path,
        origin: current.origin,
        propagation: 'reverse_workspace_dependency'
      });
      queue.push({ path: dependent, depth, origin: current.origin });
    }
  }
  return {
    reached,
    nodeLimitReached,
    depthLimitReached: depthFrontier.size > 0,
    depthFrontierCount: depthFrontier.size,
    truncated: nodeLimitReached || depthFrontier.size > 0
  };
}

function impactedTests(repository, structure, impactedPaths, directMatches, maxTests) {
  const testPaths = new Set([
    ...(Array.isArray(repository.tests) ? repository.tests : []),
    ...(Array.isArray(structure.testFiles) ? structure.testFiles : [])
  ].filter(isTestFilePath).map(normPath));
  const directSet = new Set(directMatches.map(item => item.path));
  const impactedSet = new Set(impactedPaths);
  const importsByTest = new Map();

  for (const item of structure.imports || []) {
    const from = normPath(item.from), to = normPath(item.to);
    if (!testPaths.has(from) || !item.resolved || !to) continue;
    if (!importsByTest.has(from)) importsByTest.set(from, []);
    importsByTest.get(from).push(to);
  }

  const results = [];
  for (const file of sorted(testPaths)) {
    const importedTargets = importsByTest.get(file) || [];
    const linkedTarget = importedTargets.find(target => directSet.has(target) || impactedSet.has(target));
    if (linkedTarget) {
      results.push({
        path: file,
        association: 'resolved_test_import_to_impacted_file',
        relatedFile: linkedTarget,
        confidence: 'high',
        evidenceId: (structure.sourceEvidence || []).find(item => normPath(item.path) === file)?.id || null
      });
      continue;
    }

    const pathTokens = tokenSet(file);
    const directlyMatchedPathTokens = new Set(directMatches.flatMap(item => item.path.split('/').flatMap(segment => [...tokenSet(segment)])));
    const overlap = tokenIntersection(pathTokens, directlyMatchedPathTokens);
    if (overlap.size) {
      results.push({
        path: file,
        association: 'test_path_name_overlap',
        matchedTerms: sorted(overlap),
        confidence: 'low',
        evidenceId: (structure.sourceEvidence || []).find(item => normPath(item.path) === file)?.id || null
      });
    }
  }
  return results.slice(0, maxTests);
}

function scopeLabel(fileCount, packageCount) {
  if (fileCount >= 20 || packageCount >= 6) return 'broad';
  if (fileCount >= 6 || packageCount >= 3) return 'moderate';
  return 'contained';
}

/**
 * Estimate potentially affected files and tests from a natural-language change request.
 * This is deterministic read-only analysis: it does not inspect file contents beyond
 * scanner evidence, invoke project commands, or modify the repository.
 */
export function analyzeChangeImpact({
  request = '',
  repository = null,
  maxDepth = 6,
  maxImpactedFiles = 250,
  maxImpactedPackages = 100,
  maxDirectMatches = 30,
  maxTests = 100
} = {}) {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 20) throw new Error('maxDepth must be an integer from 1 to 20');
  for (const [name, value] of Object.entries({ maxImpactedFiles, maxImpactedPackages, maxDirectMatches, maxTests })) {
    if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error(name + ' must be an integer from 1 to 1000');
  }

  const requestText = String(request || '').trim();
  const requestHash = sha256(requestText);
  if (!requestText || !repository?.structure) {
    return {
      protocolVersion: '1.0.0',
      status: 'not_applicable',
      method: 'deterministic_static_impact_estimate',
      requestSha256: requestHash,
      summary: 'Change impact analysis was not run because either a change request or repository structure evidence is unavailable.',
      confidence: { score: 0, level: 'low', basis: 'insufficient_input', penalties: ['missing_request_or_repository'] },
      directMatches: [],
      potentiallyAffectedFiles: [],
      affectedTests: [],
      affectedPackages: [],
      risks: [],
      limitations: ['No target project commands, tests, builds, or scripts are executed by OIOL.']
    };
  }

  const structure = repository.structure;
  const queryTokens = tokenSet(requestText);
  const testPathSet = new Set([
    ...(Array.isArray(repository.tests) ? repository.tests : []),
    ...(Array.isArray(structure.testFiles) ? structure.testFiles : [])
  ].filter(isTestFilePath).map(normPath));
  const sourceFiles = sorted(new Set((structure.dependencyGraph?.nodes || []).map(normPath)))
    .filter(file => !testPathSet.has(file));
  const workspacePackages = structure.workspaceGraph?.packages || [];
  const evidenceByPath = new Map((structure.sourceEvidence || []).map(item => [normPath(item.path), item]));
  const coverageConfidence = createCoverageConfidence(repository, structure);

  if (!queryTokens.size || (!sourceFiles.length && !(structure.databaseSchema?.tables?.length || structure.databaseSchema?.changes?.length))) {
    return {
      protocolVersion: '1.0.0',
      status: 'insufficient_evidence',
      method: 'deterministic_static_impact_estimate',
      requestSha256: requestHash,
      requestTerms: sorted(queryTokens),
      summary: !queryTokens.size
        ? 'The request did not contain enough identifiable domain terms for deterministic file matching.'
        : 'No source files were available to the bounded structural analysis.',
      confidence: { ...coverageConfidence, score: Math.min(coverageConfidence.score, 0.35), level: 'low' },
      directMatches: [],
      potentiallyAffectedFiles: [],
      affectedTests: [],
      affectedPackages: [],
      risks: ['insufficient_source_evidence'],
      limitations: [
        'A lack of matching evidence is not proof that no files are affected.',
        'No target project commands, tests, builds, or scripts are executed by OIOL.'
      ]
    };
  }

  const directMatches = buildFileFeatures(
    structure, sourceFiles, queryTokens, evidenceByPath, workspacePackages
  );
  const directSeeds = directMatches.slice(0, maxDirectMatches);
  const matchedRequestTerms = sorted(new Set(directMatches.flatMap(item => item.matchedTerms)));
  const matchingDiagnostics = {
    requestTermCount: queryTokens.size,
    matchedRequestTermCount: matchedRequestTerms.length,
    matchedRequestTerms,
    unmatchedRequestTerms: sorted(new Set([...queryTokens].filter(term => !matchedRequestTerms.includes(term)))),
    directMatchCountBeforeLimit: directMatches.length,
    directMatchLimit: maxDirectMatches,
    directMatchLimitReached: directMatches.length > maxDirectMatches
  };
  const directSeedPaths = directSeeds.map(item => item.path);
  const reverseImports = new Map();
  for (const item of structure.dependencyGraph?.edges || []) {
    const from = normPath(item.from), to = normPath(item.to);
    if (!from || !to) continue;
    if (!reverseImports.has(to)) reverseImports.set(to, new Set());
    reverseImports.get(to).add(from);
  }

  const fileReachability = reverseReachability(directSeedPaths, reverseImports, {
    maxDepth, maxNodes: maxImpactedFiles
  });
  const apiContractImpact = analyzeApiContractImpact({
    requestText,
    queryTokens,
    structure,
    directMatches: directSeeds,
    reverseImports,
    testPathSet,
    maxDepth,
    maxNodes: maxImpactedFiles
  });
  const databaseSchemaImpact = analyzeDatabaseSchemaImpact({
    request: requestText,
    queryTokens,
    databaseSchema: structure.databaseSchema,
    maxResults: maxImpactedFiles
  });
  const impactedFileMap = new Map(directSeeds.map(item => [item.path, {
    path: item.path,
    depth: 0,
    propagation: 'direct_request_match',
    score: item.score,
    matchedTerms: item.matchedTerms,
    signals: item.signals,
    packagePath: item.packagePath,
    evidenceId: item.evidenceId
  }]));
  for (const [file, info] of fileReachability.reached) {
    if (testPathSet.has(file)) continue;
    const evidence = evidenceByPath.get(file);
    impactedFileMap.set(file, {
      ...info,
      score: null,
      matchedTerms: [],
      signals: ['transitive_import_dependency'],
      packagePath: packageForFile(file, workspacePackages)?.path || null,
      evidenceId: evidence?.id || null,
      sourceSha256: evidence?.sourceSha256 || null,
      excerptSha256: evidence?.excerptSha256 || null
    });
  }

  const packageReverse = new Map();
  for (const item of structure.workspaceGraph?.dependencies || []) {
    const consumer = normPath(item.from), dependency = normPath(item.to);
    if (!consumer || !dependency) continue;
    if (!packageReverse.has(dependency)) packageReverse.set(dependency, new Set());
    packageReverse.get(dependency).add(consumer);
  }

  const directPackageSet = new Set(directSeeds.map(item => item.packagePath).filter(Boolean));
  const packageRequestMatches = new Map();
  for (const pkg of workspacePackages) {
    const pkgTerms = new Set([...tokenSet(pkg.name), ...tokenSet(pkg.path)]);
    const matchedTerms = sorted(tokenIntersection(queryTokens, pkgTerms));
    if (matchedTerms.length) {
      directPackageSet.add(normPath(pkg.path));
      packageRequestMatches.set(normPath(pkg.path), matchedTerms);
    }
  }
  const packageSeeds = sorted(directPackageSet);
  const packageReachabilityResult = packageReachability(packageSeeds, packageReverse, {
    maxDepth, maxNodes: maxImpactedPackages
  });
  const packagesByPath = new Map(workspacePackages.map(item => [normPath(item.path), item]));
  const allAffectedPackages = [
    ...packageSeeds.map(path => ({
      path,
      name: packagesByPath.get(path)?.name || null,
      depth: 0,
      propagation: 'direct_file_or_request_match',
      matchedTerms: packageRequestMatches.get(path) || []
    })),
    ...[...packageReachabilityResult.reached.values()].map(item => ({
      ...item,
      name: packagesByPath.get(item.path)?.name || null
    }))
  ].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const affectedPackagesTruncated = allAffectedPackages.length > maxImpactedPackages;
  const affectedPackages = allAffectedPackages.slice(0, maxImpactedPackages);

  const allPotentiallyAffectedFiles = [...impactedFileMap.values()]
    .sort((a, b) => a.depth - b.depth || (b.score || 0) - (a.score || 0) || a.path.localeCompare(b.path));
  const affectedFilesTruncated = allPotentiallyAffectedFiles.length > maxImpactedFiles;
  const potentiallyAffectedFiles = allPotentiallyAffectedFiles.slice(0, maxImpactedFiles);
  const affectedPaths = potentiallyAffectedFiles.map(item => item.path);
  const affectedTests = impactedTests(
    repository, structure, affectedPaths, directSeeds, maxTests
  );
  const reverseTruncated = fileReachability.truncated || packageReachabilityResult.truncated || affectedFilesTruncated || affectedPackagesTruncated;
  const depthLimitReached = fileReachability.depthLimitReached || packageReachabilityResult.depthLimitReached;
  const nodeLimitReached = fileReachability.nodeLimitReached || packageReachabilityResult.nodeLimitReached;
  const directMatchConfidence = directSeeds.length
    ? round(directSeeds.reduce((sum, item) => sum + item.score, 0) / directSeeds.length)
    : packageSeeds.length ? 0.4 : 0;
  const overallConfidence = {
    ...coverageConfidence,
    penalties: [
      ...coverageConfidence.penalties,
      ...(reverseTruncated ? ['impact_graph_result_limit_reached'] : []),
      ...(depthLimitReached ? ['impact_graph_depth_limit_reached'] : []),
      ...(nodeLimitReached || affectedFilesTruncated || affectedPackagesTruncated ? ['impact_graph_node_or_output_limit_reached'] : []),
      ...(directMatches.length > maxDirectMatches ? ['direct_match_result_limit_reached'] : []),
      ...(apiContractImpact.status === 'unavailable' ? ['api_contract_export_metadata_unavailable'] : []),
      ...(apiContractImpact.status === 'insufficient_symbol_match' ? ['api_contract_symbol_match_not_found'] : []),
      ...(databaseSchemaImpact.status === 'unavailable' ? ['database_schema_metadata_unavailable'] : []),
      ...(databaseSchemaImpact.status === 'insufficient_schema_match' ? ['database_schema_match_not_found'] : []),
      ...(databaseSchemaImpact.diagnostics?.tableResultLimitReached || databaseSchemaImpact.diagnostics?.changeResultLimitReached || databaseSchemaImpact.diagnostics?.consumerResultLimitReached ? ['database_schema_results_truncated'] : []),
      ...(apiContractImpact.diagnostics?.depthLimitReached || apiContractImpact.diagnostics?.nodeLimitReached || apiContractImpact.diagnostics?.consumerResultLimitReached ? ['api_contract_consumer_graph_truncated'] : [])
    ],
    score: round(Math.max(0.25, coverageConfidence.score * (0.65 + 0.35 * directMatchConfidence) - (reverseTruncated ? 0.08 : 0) - (directMatches.length > maxDirectMatches ? 0.04 : 0) - (apiContractImpact.status === 'unavailable' ? 0.06 : apiContractImpact.status === 'insufficient_symbol_match' ? 0.04 : 0) - (apiContractImpact.diagnostics?.depthLimitReached || apiContractImpact.diagnostics?.nodeLimitReached || apiContractImpact.diagnostics?.consumerResultLimitReached ? 0.04 : 0)))
  };
  if (!directSeeds.length && !packageSeeds.length) {
    overallConfidence.score = Math.min(overallConfidence.score, 0.35);
    overallConfidence.penalties.push('no_direct_request_match_found');
  }
  overallConfidence.level = confidenceLevel(overallConfidence.score);

  const risks = [];
  if (repository.fileCountIsLowerBound || repository.truncated || repository.depthTruncated) risks.push('bounded_repository_scan_incomplete');
  if ((repository.coverage?.sourceFilesOmittedBySelectionLimit || 0) > 0) risks.push('source_analysis_selection_limit_reached');
  if ((structure.unresolvedLocalImportCount || 0) > 0) risks.push('unresolved_local_dependencies_may_hide_additional_impacts');
  if ((structure.pathAliases?.unresolvedImportCount || 0) > 0) risks.push('unresolved_path_aliases_may_hide_additional_impacts');
  if (reverseTruncated) risks.push('impact_graph_truncated_by_result_limit');
  if (depthLimitReached) risks.push('impact_graph_depth_limit_reached');
  if (nodeLimitReached || affectedFilesTruncated || affectedPackagesTruncated) risks.push('impact_graph_node_or_output_limit_reached');
  if (apiContractImpact.status === 'unavailable') risks.push('api_contract_analysis_unavailable');
  if (apiContractImpact.status === 'insufficient_symbol_match') risks.push('api_contract_symbol_match_not_found');
  if (databaseSchemaImpact.status === 'unavailable') risks.push('database_schema_analysis_unavailable');
  if (databaseSchemaImpact.status === 'insufficient_schema_match') risks.push('database_schema_match_not_found');
  if (databaseSchemaImpact.diagnostics?.tableResultLimitReached || databaseSchemaImpact.diagnostics?.changeResultLimitReached || databaseSchemaImpact.diagnostics?.consumerResultLimitReached) risks.push('database_schema_analysis_truncated');
  if (apiContractImpact.diagnostics?.depthLimitReached || apiContractImpact.diagnostics?.nodeLimitReached || apiContractImpact.diagnostics?.consumerResultLimitReached) risks.push('api_contract_consumer_graph_truncated');
  if (potentiallyAffectedFiles.length >= 20 || affectedPackages.length >= 6) risks.push('broad_change_impact_scope');
  if (affectedTests.length === 0 && (repository.tests?.length || structure.testFiles?.length)) risks.push('no_test_file_could_be_linked_to_the_current_impact_evidence');

  const confidence = {
    ...overallConfidence,
    level: confidenceLevel(overallConfidence.score),
    directMatchConfidence
  };
  const scope = scopeLabel(potentiallyAffectedFiles.length, affectedPackages.length);
  const status = directSeeds.length || packageSeeds.length || databaseSchemaImpact.status === 'analyzed' ? 'analyzed' : 'no_relevant_matches';

  return {
    protocolVersion: '1.0.0',
    status,
    method: 'deterministic_static_impact_estimate',
    requestSha256: requestHash,
    requestTerms: sorted(queryTokens),
    matchingDiagnostics,
    apiContractImpact,
    databaseSchemaImpact,
    summary: directSeeds.length || packageSeeds.length || databaseSchemaImpact.status === 'analyzed'
      ? 'The bounded scanner evidence suggests ' + directSeeds.length + ' direct candidate file(s), ' +
        (potentiallyAffectedFiles.length - directSeeds.length) + ' reverse-dependency file(s), ' +
        affectedTests.length + ' potentially affected test file(s), and ' +
        affectedPackages.length + ' affected workspace package(s), and ' + (databaseSchemaImpact.schemaChanges?.length || 0) + ' matched database schema change(s). This is a review estimate, not a complete dependency proof.'
      : 'No repository file matched the request terms strongly enough to nominate a direct change target. This does not establish that the request has no repository impact.',
    scope,
    confidence,
    graph: {
      analyzedSourceFileCount: sourceFiles.length,
      resolvedImportEdgeCount: structure.dependencyGraph?.edgeCount || 0,
      unresolvedLocalImportCount: structure.unresolvedLocalImportCount || 0,
      traversedReverseDependencyCount: fileReachability.reached.size,
      traversedWorkspaceDependencyCount: packageReachabilityResult.reached.size,
      maxDepth,
      traversalLimits: {
        depthLimitReached,
        fileDepthFrontierCount: fileReachability.depthFrontierCount,
        packageDepthFrontierCount: packageReachabilityResult.depthFrontierCount,
        nodeLimitReached,
        fileNodeLimitReached: fileReachability.nodeLimitReached,
        packageNodeLimitReached: packageReachabilityResult.nodeLimitReached,
        affectedFilesOutputLimitReached: affectedFilesTruncated,
        affectedPackagesOutputLimitReached: affectedPackagesTruncated
      }
    },
    directMatches: directSeeds,
    potentiallyAffectedFiles,
    affectedTests,
    affectedPackages,
    risks,
    limitations: [
      'This is deterministic lexical/static impact estimation based on the bounded scanner inventory, not semantic program analysis.',
      'Import edges point from importer to imported file; impact is propagated in reverse to likely dependents.',
      'Tree-sitter syntax extraction does not perform type resolution, control-flow analysis, or runtime dependency discovery.',
      'Workspace package dependencies and TypeScript path aliases are declared configuration evidence, not proof of runtime use.',
      'Dynamic imports, reflection, generated code, dependency injection, conditional compilation, and external runtime configuration may be missed.',
      'A missing file, test, edge, or match is not proof of absence when scanner coverage is bounded or incomplete.',
      'The affected test list identifies likely related test files; OIOL does not execute or verify tests.',
      'OIOL does not edit repository files or execute commands, scripts, builds, tests, or implementation tasks.'
    ]
  };
}
