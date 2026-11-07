import path from 'node:path';
import { redact } from '../core/utils.mjs';
import { analyzeWithTreeSitter } from './tree-sitter-ast.mjs';

const EXT = new Map([
  ['.js','javascript'],['.jsx','javascript'],['.mjs','javascript'],['.cjs','javascript'],
  ['.ts','typescript'],['.tsx','typescript'],['.py','python'],['.go','go'],['.rs','rust'],
  ['.java','java'],['.kt','kotlin'],['.php','php'],['.rb','ruby']
]);
const norm = value => value.replaceAll('\\','/').replace(/^\.\//,'');

function importsFor(source, language) {
  const out = [], add = value => { if (value && !out.includes(value)) out.push(value); };
  if (language === 'javascript' || language === 'typescript') {
    for (const re of [/\b(?:import|export)\s+(?:[\s\S]*?\s+from\s*)?['"]([^'"]+)['"]/g,/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) for (const m of source.matchAll(re)) add(m[1]);
  } else if (language === 'python') {
    for (const m of source.matchAll(/^\s*from\s+([.\w]+)\s+import\s+/gm)) add(m[1]);
    for (const m of source.matchAll(/^\s*import\s+([\w.]+)/gm)) add(m[1]);
  } else if (language === 'go') {
    for (const m of source.matchAll(/\bimport\s+\w*\s*"([^"]+)"/g)) add(m[1]);
    const block = source.match(/\bimport\s*\(([\s\S]*?)\)/);
    if (block) for (const m of block[1].matchAll(/\w*\s*"([^"]+)"/g)) add(m[1]);
  } else if (language === 'rust') {
    for (const m of source.matchAll(/^\s*(?:pub\s+)?(?:use|mod)\s+([\w:]+)/gm)) add(m[1]);
  } else if (language === 'java' || language === 'kotlin') {
    for (const m of source.matchAll(/^\s*import\s+([\w.]+)/gm)) add(m[1]);
  } else if (language === 'php') {
    for (const m of source.matchAll(/^\s*use\s+([\w\\\\]+)/gm)) add(m[1]);
    for (const m of source.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g)) add(m[1]);
  } else if (language === 'ruby') {
    for (const m of source.matchAll(/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm)) add(m[1]);
  }
  return out;
}

function symbolsFor(source, language) {
  const rules = {
    javascript:[['class',/^\s*(?:export\s+)?class\s+([\w$]+)/gm],['function',/^\s*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/gm],['variable',/^\s*export\s+(?:const|let|var)\s+([\w$]+)/gm]],
    typescript:[['class',/^\s*(?:export\s+)?class\s+([\w$]+)/gm],['function',/^\s*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/gm],['interface',/^\s*(?:export\s+)?interface\s+([\w$]+)/gm],['type',/^\s*(?:export\s+)?type\s+([\w$]+)/gm],['enum',/^\s*(?:export\s+)?enum\s+([\w$]+)/gm]],
    python:[['class',/^\s*class\s+([\w]+)/gm],['function',/^\s*(?:async\s+)?def\s+([\w]+)/gm]],
    go:[['type',/^\s*type\s+([\w]+)\s+(?:struct|interface)/gm],['function',/^\s*func\s+(?:\([^)]*\)\s*)?([\w]+)\s*\(/gm]],
    rust:[['struct',/^\s*(?:pub\s+)?struct\s+([\w]+)/gm],['enum',/^\s*(?:pub\s+)?enum\s+([\w]+)/gm],['function',/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([\w]+)/gm]],
    java:[['type',/^\s*(?:(?:public|protected|private|abstract|final|static)\s+)*(?:class|interface|enum|record)\s+([\w]+)/gm]],
    kotlin:[['class',/^\s*(?:(?:data|sealed|open)\s+)?class\s+([\w]+)/gm],['function',/^\s*fun\s+([\w]+)/gm]],
    php:[['class',/^\s*(?:abstract\s+|final\s+)?class\s+([\w]+)/gm],['function',/^\s*(?:public|protected|private|static|\s)*function\s+([\w]+)/gm]],
    ruby:[['class',/^\s*class\s+([\w]+)/gm],['module',/^\s*module\s+([\w]+)/gm],['function',/^\s*def\s+([\w]+)/gm]]
  };
  const out = [];
  for (const [kind, re] of rules[language] || []) for (const match of source.matchAll(re)) out.push({ name: match[1], kind, line: source.slice(0, match.index).split('\n').length, source: 'bounded_lexical_heuristic' });
  if (language === 'javascript' || language === 'typescript') {
    for (const match of source.matchAll(/^\s*export\s+(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/gm)) out.push({ name: match[1], kind: 'function', line: source.slice(0, match.index).split('\n').length, source: 'bounded_lexical_heuristic' });
  }
  return out;
}

function frameworksFor(text) {
  const lower = text.toLowerCase();
  const defs = [
    ['next.js',['"next"','next==']],['react',['"react"','react==']],['vue',['"vue"','vue==']],
    ['svelte',['"svelte"']],['angular',['@angular/core']],['express',['"express"','express==']],
    ['fastify',['"fastify"']],['nestjs',['@nestjs/core']],['vite',['"vite"']],
    ['django',['django==','django>']],['flask',['flask==','flask>']],['fastapi',['fastapi==','fastapi>']],
    ['spring',['spring-boot','org.springframework']],['laravel',['laravel/framework']],['rails',['gem "rails"']]
  ];
  return defs.filter(([, needles]) => needles.some(needle => lower.includes(needle))).map(([name]) => name);
}

function resolveRelativeImport(file, language, specifier, fileSet) {
  if (language === 'python' && /^\.+/.test(specifier)) {
    const dots = specifier.match(/^\.+/)[0].length, rest = specifier.slice(dots).replaceAll('.', '/');
    let baseDir = path.posix.dirname(file);
    for (let i = 1; i < dots; i++) baseDir = path.posix.dirname(baseDir);
    const base = norm(path.posix.join(baseDir, rest));
    return [base + '.py', path.posix.join(base, '__init__.py')].find(candidate => fileSet.has(candidate)) || null;
  }
  if (specifier.startsWith('.')) {
    const base = norm(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
    const candidates = [base, ...[...EXT.keys()].map(ext => base + ext), ...['index.js','index.ts','index.tsx','index.mjs','__init__.py'].map(name => path.posix.join(base, name))];
    return candidates.find(candidate => fileSet.has(candidate)) || null;
  }
  return null;
}

export function analyzeRepositoryStructure({ files = [], contents = {}, manifests = [], maxFileBytes = 16000, analysisMode = 'auto' } = {}) {
  if (!['auto', 'lexical'].includes(analysisMode)) throw new Error('analysisMode must be auto or lexical');
  const normalized = files.map(norm);
  const fileSet = new Set(normalized);
  const sources = normalized.filter(file => EXT.has(path.posix.extname(file).toLowerCase()));
  const languages = {}, analyzed = [];
  for (const file of sources) {
    if (typeof contents[file] !== 'string') continue;
    const language = EXT.get(path.posix.extname(file).toLowerCase());
    languages[language] = (languages[language] || 0) + 1;
    analyzed.push(file);
  }

  const ast = analysisMode === 'lexical'
    ? {
        symbols: [], imports: [], diagnostics: [], parsedFiles: [], unsupportedFiles: [], failedFiles: [],
        parsedFileCount: 0, unsupportedFileCount: 0, failedFileCount: 0, parseCounts: {},
        visitedNodeCount: 0, method: 'lexical_only', availableLanguages: [], runtimeAvailable: false,
        runtimeLoadError: 'AST disabled by scanner configuration'
      }
    : analyzeWithTreeSitter({ files: analyzed, contents, maxFileBytes });
  const astFiles = new Set(ast.parsedFiles.map(item => item.file));
  const symbols = [...ast.symbols], imports = [...ast.imports];
  const lexicalFallbackFiles = [];

  for (const file of analyzed) {
    if (astFiles.has(file)) continue;
    lexicalFallbackFiles.push(file);
    const language = EXT.get(path.posix.extname(file).toLowerCase());
    const source = contents[file];
    for (const symbol of symbolsFor(source, language)) symbols.push({ file, ...symbol, trustLevel: 'untrusted_repository_metadata' });
    for (const specifier of importsFor(source, language)) {
      const safeSpecifier = redact(specifier.split(/[?#]/, 1)[0]).slice(0, 200);
      const target = resolveRelativeImport(file, language, safeSpecifier, fileSet);
      imports.push({
        from: file, to: target, specifier: safeSpecifier, resolved: Boolean(target),
        trustLevel: 'untrusted_repository_metadata', source: 'bounded_lexical_heuristic'
      });
    }
  }

  const manifestObjects = [];
  for (const file of manifests) if (path.posix.basename(file) === 'package.json') {
    try { manifestObjects.push({ file, data: JSON.parse(contents[file]) }); } catch {}
  }
  const entries = new Set();
  for (const file of normalized) if (/(^|\/)(index|main|app|server|cli|manage|wsgi|asgi)\.(js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|php|rb)$/.test(file)) entries.add(file);
  for (const { file, data } of manifestObjects) {
    const dir = path.posix.dirname(file);
    for (const key of ['main','module','types','bin']) {
      const value = data[key];
      if (typeof value === 'string') entries.add(norm(path.posix.join(dir, value)));
      else if (value && typeof value === 'object') for (const target of Object.values(value)) if (typeof target === 'string') entries.add(norm(path.posix.join(dir, target)));
    }
    for (const script of Object.values(data.scripts || {})) {
      const match = typeof script === 'string' && script.match(/(?:node|tsx?|vite|next)\s+([.\w/-]+\.(?:js|mjs|cjs|ts|tsx))/);
      if (match) entries.add(norm(path.posix.join(dir, match[1])));
    }
  }

  const uniqueImports = [];
  const seenImports = new Set();
  for (const item of imports) {
    const key = [item.from, item.specifier, item.to || ''].join('\0');
    if (!seenImports.has(key)) { seenImports.add(key); uniqueImports.push(item); }
  }
  const edges = uniqueImports.filter(item => item.resolved).map(item => ({ from: item.from, to: item.to, kind: 'imports' }));
  const unresolved = uniqueImports.filter(item => item.specifier.startsWith('.') && !item.resolved);
  const manifestTexts = manifests.map(file => contents[file]).filter(value => typeof value === 'string');

  return {
    method: ast.parsedFileCount ? 'tree_sitter_ast_with_lexical_fallback' : 'bounded_static_heuristics',
    analysisMode,
    astRuntimeAvailable: Boolean(ast.runtimeAvailable),
    astRuntimeLoadError: ast.runtimeLoadError || null,
    trustLevel: 'untrusted_repository_analysis',
    languages,
    sourceFileCount: sources.length,
    analyzedSourceFileCount: analyzed.length,
    astFileCount: ast.parsedFileCount,
    lexicalFallbackFileCount: lexicalFallbackFiles.length,
    unsupportedLanguageFileCount: ast.unsupportedFileCount,
    parseFailureFileCount: ast.failedFileCount,
    syntaxErrorFileCount: ast.parsedFiles.filter(item => item.hasError).length,
    nodeLimitFileCount: ast.parsedFiles.filter(item => item.nodeLimitReached).length,
    depthLimitFileCount: ast.parsedFiles.filter(item => item.depthLimitReached).length,
    parseCounts: ast.parseCounts,
    availableGrammarLanguages: ast.availableLanguages,
    visitedAstNodeCount: ast.visitedNodeCount,
    symbols: symbols.slice(0, 4000),
    symbolCount: symbols.length,
    imports: uniqueImports.slice(0, 6000),
    importCount: uniqueImports.length,
    dependencyGraph: { nodes: analyzed, edges: edges.slice(0, 6000), edgeCount: edges.length },
    unresolvedLocalImports: unresolved.slice(0, 1000),
    unresolvedLocalImportCount: unresolved.length,
    frameworks: frameworksFor(manifestTexts.join('\n')),
    entryPoints: [...entries].filter(file => fileSet.has(file)).sort(),
    routeFiles: normalized.filter(file => /(^|\/)(routes?|controllers?|api)(\/|$)|(^|\/)app\/api\//i.test(file)),
    testFiles: normalized.filter(file => /(^|\/)(__tests__|tests?|spec)(\/|\.|$)/i.test(file)),
    diagnostics: ast.diagnostics.slice(0, 500),
    parserDiagnostics: [
      ...ast.unsupportedFiles.map(item => ({ ...item, kind: 'grammar_unavailable', trustLevel: 'untrusted_repository_analysis' })),
      ...ast.failedFiles.map(item => ({ ...item, kind: 'parse_failure', trustLevel: 'untrusted_repository_analysis' }))
    ].slice(0, 500),
    limitations: [
      'Tree-sitter provides concrete syntax trees, not type checking, symbol resolution, or proof of runtime behavior.',
      'Only grammars bundled with the pinned WebAssembly language pack are parsed; unsupported languages use bounded lexical fallback.',
      'Import aliases, package-manager resolution, dynamic runtime loading, generated code, reflection, and dependency injection may remain unresolved.',
      'Analysis is bounded to the files and bytes selected by the repository scanner; missing evidence is not proof of absence.',
      'Syntax-error diagnostics describe parser recovery and require human review.'
    ]
  };
}
