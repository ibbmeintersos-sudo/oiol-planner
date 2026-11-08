import path from 'node:path';
import { redact } from '../core/utils.mjs';
import { analyzeWithTreeSitter, resolveLocalImport } from './tree-sitter-ast.mjs';
import { scanDatabaseSchema } from './database-schema.mjs';

const EXT = new Map([
  ['.js','javascript'],['.jsx','javascript'],['.mjs','javascript'],['.cjs','javascript'],
  ['.ts','typescript'],['.tsx','typescript'],['.py','python'],['.go','go'],['.rs','rust'],
  ['.java','java'],['.kt','kotlin'],['.php','php'],['.rb','ruby'],['.dart','dart'],['.swift','swift']
]);
const SOURCE_EXT = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|php|rb|dart|swift|m|mm|h|hpp|c|cc|cpp|cs|scala|sql|sh|ex|exs|erl|hrl|clj|cljs|cljc|fs|fsx|hs|ml|mli|vue|svelte)$/i;
const norm = value => path.posix.normalize(String(value || '').replaceAll('\\','/').replace(/^\.\//,''));
const FILE_SUFFIXES = [...EXT.keys(), '.d.ts', '.json'];
const INDEX_NAMES = ['index.js','index.jsx','index.mjs','index.cjs','index.ts','index.tsx','index.py','index.go','index.rs','__init__.py'];

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
  } else if (language === 'dart') {
    for (const m of source.matchAll(/^\s*(?:import|export)\s+['"]([^'"]+)['"]/gm)) add(m[1]);
  } else if (language === 'swift') {
    for (const m of source.matchAll(/^\s*import\s+(?:typealias|struct|class|enum|protocol|let|var|func)?\s*([\w.]+)/gm)) add(m[1]);
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
    ruby:[['class',/^\s*class\s+([\w]+)/gm],['module',/^\s*module\s+([\w]+)/gm],['function',/^\s*def\s+([\w]+)/gm]],
    dart:[['class',/^\s*class\s+([\w]+)/gm],['mixin',/^\s*mixin\s+([\w]+)/gm],['enum',/^\s*enum\s+([\w]+)/gm],['function',/^\s*(?:Future<[^>]+>|[\w<>?]+)\s+([\w]+)\s*\(/gm]],
    swift:[['class',/^\s*(?:open\s+|public\s+|final\s+)*class\s+([\w]+)/gm],['struct',/^\s*(?:public\s+)?struct\s+([\w]+)/gm],['enum',/^\s*(?:public\s+)?enum\s+([\w]+)/gm],['protocol',/^\s*(?:public\s+)?protocol\s+([\w]+)/gm],['function',/^\s*(?:public\s+|private\s+|internal\s+|static\s+|override\s+)*func\s+([\w]+)/gm]]
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

function resolveFileCandidate(base, fileSet) {
  const normalized = norm(base);
  const candidates = [normalized];
  const hasKnownExtension = FILE_SUFFIXES.some(ext => normalized.toLowerCase().endsWith(ext));
  if (!hasKnownExtension) candidates.push(...FILE_SUFFIXES.map(ext => normalized + ext));
  candidates.push(...INDEX_NAMES.map(name => path.posix.join(normalized, name)));
  return candidates.find(candidate => fileSet.has(candidate)) || null;
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
    const base = norm(path.posix.join(path.posix.dirname(file), specifier));
    return resolveFileCandidate(base, fileSet);
  }
  return null;
}

function globPatternToRegExp(pattern) {
  const clean = norm(pattern).replace(/\/$/, '');
  let expression = '';
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (char === '*' && clean[index + 1] === '*') {
      expression += '.*';
      index++;
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp('^' + expression + '$');
}

function workspacePatternsFor(contents, manifestObjects, diagnostics) {
  const rootPackage = manifestObjects.find(item => item.file === 'package.json');
  const patterns = [];
  const add = values => {
    if (!Array.isArray(values)) return;
    for (const value of values) if (typeof value === 'string' && value.trim()) patterns.push(value.trim());
  };
  if (rootPackage) {
    const workspaces = rootPackage.data.workspaces;
    add(Array.isArray(workspaces) ? workspaces : workspaces?.packages);
  }
  const pnpm = contents['pnpm-workspace.yaml'];
  if (typeof pnpm === 'string') {
    let inPackages = false;
    for (const rawLine of pnpm.split(/\r?\n/)) {
      if (/^\s*packages\s*:\s*(?:#.*)?$/.test(rawLine)) { inPackages = true; continue; }
      if (inPackages && /^\S/.test(rawLine)) inPackages = false;
      if (!inPackages) continue;
      const match = rawLine.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
      if (match) patterns.push(match[1].trim());
    }
  }
  const lerna = contents['lerna.json'];
  if (typeof lerna === 'string') {
    try { add(JSON.parse(lerna).packages); }
    catch { diagnostics.push({ kind: 'invalid_workspace_manifest', file: 'lerna.json' }); }
  }
  const unique = [...new Set(patterns.map(value => value.replaceAll('\\','/').replace(/^\.\//,'')))];
  return unique;
}

function workspaceInventory(files, contents, manifestObjects) {
  const diagnostics = [];
  const patterns = workspacePatternsFor(contents, manifestObjects, diagnostics);
  const packageByName = new Map();
  const workspacePackages = [];
  for (const item of manifestObjects) {
    const directory = path.posix.dirname(item.file) === '.' ? '' : path.posix.dirname(item.file);
    if (!directory) continue;
    const included = patterns.some(pattern => {
      if (pattern.startsWith('!')) return false;
      try { return globPatternToRegExp(pattern).test(directory); } catch { return false; }
    }) && !patterns.some(pattern => pattern.startsWith('!') && globPatternToRegExp(pattern.slice(1)).test(directory));
    if (!included) continue;
    const name = typeof item.data.name === 'string' ? item.data.name.trim() : '';
    if (!name) {
      diagnostics.push({ kind: 'workspace_package_missing_name', manifest: item.file });
      continue;
    }
    const entry = { name, path: directory, manifest: item.file, version: typeof item.data.version === 'string' ? item.data.version : null };
    workspacePackages.push(entry);
    if (!packageByName.has(name)) packageByName.set(name, []);
    packageByName.get(name).push(entry);
  }
  for (const [name, matches] of packageByName) if (matches.length > 1) diagnostics.push({ kind: 'duplicate_workspace_package_name', name, manifests: matches.map(item => item.manifest) });

  const dependencies = [];
  for (const item of manifestObjects) {
    const directory = path.posix.dirname(item.file) === '.' ? '' : path.posix.dirname(item.file);
    const fromPackage = workspacePackages.find(pkg => pkg.manifest === item.file);
    if (!fromPackage) continue;
    for (const field of ['dependencies','devDependencies','peerDependencies','optionalDependencies']) {
      const declarations = item.data[field];
      if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations)) continue;
      for (const [name, version] of Object.entries(declarations)) {
        const targets = packageByName.get(name) || [];
        if (targets.length === 0) {
          if (typeof version === 'string' && version.startsWith('workspace:')) diagnostics.push({ kind: 'workspace_dependency_target_not_found', from: fromPackage.path, packageName: name, fromManifest: item.file });
          continue;
        }
        if (targets.length !== 1) {
          diagnostics.push({ kind: 'workspace_dependency_target_ambiguous', from: fromPackage.path, packageName: name, targetManifests: targets.map(target => target.manifest) });
          continue;
        }
        dependencies.push({
          from: fromPackage.path,
          to: targets[0].path,
          packageName: name,
          dependencyType: field,
          declaredRange: typeof version === 'string' ? version : null,
          fromManifest: item.file,
          toManifest: targets[0].manifest
        });
      }
    }
  }
  const rootData = manifestObjects.find(item => item.file === 'package.json')?.data;
  let packageManager = typeof rootData?.packageManager === 'string' ? rootData.packageManager.split('@')[0] : null;
  if (!packageManager) {
    const locks = [
      ['pnpm','pnpm-lock.yaml'],['yarn','yarn.lock'],['npm','package-lock.json'],['bun','bun.lock'],['bun','bun.lockb']
    ].filter(([, file]) => files.includes(file)).map(([name]) => name);
    packageManager = locks.length === 1 ? locks[0] : null;
    if (locks.length > 1) diagnostics.push({ kind: 'multiple_lockfile_signals', managers: locks });
  }
  const declaredWorkspace = patterns.length > 0;
  return {
    packageManager,
    isMonorepo: declaredWorkspace && workspacePackages.length > 1,
    detection: declaredWorkspace ? 'declared_workspace_patterns' : 'no_workspace_declaration_detected',
    workspacePatterns: patterns,
    packages: workspacePackages.sort((a,b) => a.path.localeCompare(b.path)),
    dependencies,
    diagnostics
  };
}

function parseJsonWithComments(source) {
  let withoutComments = '';
  let inString = false, escaped = false, lineComment = false, blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (lineComment) {
      if (char === '\n' || char === '\r') {
        lineComment = false;
        withoutComments += char;
      } else withoutComments += ' ';
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        withoutComments += '  ';
        index++;
      } else withoutComments += char === '\n' || char === '\r' ? char : ' ';
      continue;
    }
    if (inString) {
      withoutComments += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      withoutComments += char;
    } else if (char === '/' && next === '/') {
      lineComment = true;
      withoutComments += '  ';
      index++;
    } else if (char === '/' && next === '*') {
      blockComment = true;
      withoutComments += '  ';
      index++;
    } else withoutComments += char;
  }

  let cleaned = '';
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index++) {
    const char = withoutComments[index];
    if (inString) {
      cleaned += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      cleaned += char;
    } else if (char === ',') {
      let lookahead = index + 1;
      while (/\s/.test(withoutComments[lookahead] || '')) lookahead++;
      if (withoutComments[lookahead] !== '}' && withoutComments[lookahead] !== ']') cleaned += char;
    } else cleaned += char;
  }
  return JSON.parse(cleaned);
}

function buildPathAliases(files, contents) {
  const aliases = [], diagnostics = [];
  for (const file of files.filter(item => ['tsconfig.json','jsconfig.json'].includes(path.posix.basename(item)))) {
    const raw = contents[file];
    if (typeof raw !== 'string') continue;
    let config;
    try { config = parseJsonWithComments(raw); }
    catch { diagnostics.push({ kind: 'invalid_path_alias_config', file }); continue; }
    const options = config.compilerOptions || {};
    const paths = options.paths;
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) continue;
    const configRoot = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file);
    const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : '.';
    for (const [pattern, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets)) continue;
      for (const target of targets) if (typeof target === 'string') {
        aliases.push({
          configFile: file,
          configRoot,
          baseDirectory: norm(path.posix.join(configRoot, baseUrl)),
          pattern,
          target
        });
      }
    }
    if (typeof config.extends === 'string') diagnostics.push({ kind: 'path_alias_inherited_config_not_loaded', file, extends: config.extends });
  }
  return { aliases, diagnostics };
}

function matchAlias(pattern, specifier) {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === specifier ? '' : null;
  const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function resolvePathAlias(file, specifier, aliases, fileSet) {
  const applicable = aliases
    .filter(alias => file === alias.configRoot || file.startsWith(alias.configRoot ? alias.configRoot + '/' : '') )
    .map(alias => ({ ...alias, wildcard: matchAlias(alias.pattern, specifier) }))
    .filter(alias => alias.wildcard !== null)
    .sort((a,b) => b.configRoot.length - a.configRoot.length || b.pattern.length - a.pattern.length);
  for (const alias of applicable) {
    const target = alias.target.replace('*', alias.wildcard);
    const resolved = resolveFileCandidate(path.posix.join(alias.baseDirectory, target), fileSet);
    if (resolved) return { path: resolved, configFile: alias.configFile };
  }
  return null;
}

function attachEvidence(item, file, evidenceByPath) {
  const evidence = evidenceByPath.get(norm(file));
  return {
    ...item,
    evidenceId: evidence?.id || null,
    sourceSha256: evidence?.sourceSha256 || null,
    excerptSha256: evidence?.excerptSha256 || null,
    evidenceStatus: evidence ? 'fingerprinted_source_excerpt' : 'source_file_read_without_excerpt'
  };
}

export function analyzeRepositoryStructure({
  files = [], contents = {}, manifests = [], sourceEvidence = [],
  maxFileBytes = 16000, analysisMode = 'auto'
} = {}) {
  if (!['auto', 'lexical'].includes(analysisMode)) throw new Error('analysisMode must be auto or lexical');
  const normalized = files.map(norm);
  const fileSet = new Set(normalized);
  const sources = normalized.filter(file => SOURCE_EXT.test(file));
  const supportedSources = sources.filter(file => EXT.has(path.posix.extname(file).toLowerCase()));
  const unsupportedSources = sources.filter(file => !EXT.has(path.posix.extname(file).toLowerCase()));
  const languages = {}, analyzed = [];
  for (const file of supportedSources) {
    if (typeof contents[file] !== 'string') continue;
    const language = EXT.get(path.posix.extname(file).toLowerCase());
    languages[language] = (languages[language] || 0) + 1;
    analyzed.push(file);
  }

  const goModFile = manifests.find(file => path.posix.basename(file) === 'go.mod');
  const goModulePath = typeof contents[goModFile] === 'string'
    ? contents[goModFile].match(/^\s*module\s+([^\s]+)\s*$/m)?.[1] || null
    : null;
  const pythonRoots = ['', 'src', 'lib', 'app'];
  const ast = analysisMode === 'lexical'
    ? {
        symbols: [], imports: [], diagnostics: [], parsedFiles: [], unsupportedFiles: [], failedFiles: [],
        parsedFileCount: 0, unsupportedFileCount: 0, failedFileCount: 0, parseCounts: {},
        visitedNodeCount: 0, method: 'lexical_only', availableLanguages: [], runtimeAvailable: false,
        runtimeLoadError: 'AST disabled by scanner configuration'
      }
    : analyzeWithTreeSitter({ files: analyzed, contents, maxFileBytes, goModulePath, pythonRoots });
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
      const target = resolveLocalImport(file, language, safeSpecifier, fileSet, { goModulePath, pythonRoots });
      imports.push({
        from: file, to: target, specifier: safeSpecifier, language, resolved: Boolean(target),
        trustLevel: 'untrusted_repository_metadata', source: 'bounded_lexical_heuristic', resolution: target ? (language === 'go' ? 'go-module-package-representative' : language === 'python' && !safeSpecifier.startsWith('.') ? 'python-module-root' : 'relative-path') : null
      });
    }
  }

  const manifestObjects = [];
  for (const file of manifests) if (path.posix.basename(file) === 'package.json') {
    try { manifestObjects.push({ file, data: JSON.parse(contents[file]) }); } catch {}
  }
  const aliasInfo = buildPathAliases(manifests, contents);
  const workspace = workspaceInventory(normalized, contents, manifestObjects);
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

  const evidenceByPath = new Map(sourceEvidence.map(item => [norm(item.path), item]));
  const resolvedImports = imports.map(item => {
    if (item.resolved || item.specifier.startsWith('.')) return item;
    const alias = resolvePathAlias(item.from, item.specifier, aliasInfo.aliases, fileSet);
    return alias ? {
      ...item, to: alias.path, resolved: true,
      resolutionKind: 'tsconfig_path_alias',
      resolutionConfig: alias.configFile,
      resolutionConfigEvidenceId: evidenceByPath.get(norm(alias.configFile))?.id || null,
      resolutionConfigSourceSha256: evidenceByPath.get(norm(alias.configFile))?.sourceSha256 || null,
      resolutionConfigExcerptSha256: evidenceByPath.get(norm(alias.configFile))?.excerptSha256 || null
    } : item;
  });
  const uniqueImports = [];
  const seenImports = new Set();
  for (const item of resolvedImports) {
    const key = [item.from, item.specifier, item.to || ''].join('\0');
    if (!seenImports.has(key)) { seenImports.add(key); uniqueImports.push(item); }
  }
  const evidencedSymbols = symbols.map(item => attachEvidence(item, item.file, evidenceByPath));
  const evidencedImports = uniqueImports.map(item => attachEvidence(item, item.from, evidenceByPath));
  const edges = evidencedImports.filter(item => item.resolved).map(item => ({
    from: item.from, to: item.to, kind: 'imports', specifier: item.specifier,
    source: item.source,
    resolutionKind: item.resolutionKind || (item.specifier.startsWith('.') ? 'relative_path' : 'parser_resolved'),
    resolution: item.resolution || (item.language === 'go' ? 'go-module-package-representative' : item.language === 'python' && !item.specifier.startsWith('.') ? 'python-module-root' : 'relative-path'),
    evidenceId: item.evidenceId, sourceSha256: item.sourceSha256, excerptSha256: item.excerptSha256
  }));
  const localPythonModules = new Set();
  for (const file of normalized) if (file.endsWith('.py')) {
    const parts = file.split('/');
    localPythonModules.add(parts[0] === 'src' && parts.length > 2 ? parts[1] : parts[0]);
  }
  const unresolved = evidencedImports.filter(item => {
    if (item.resolved) return false;
    if (item.specifier.startsWith('.')) return true;
    if (item.language === 'go' && goModulePath && (item.specifier === goModulePath || item.specifier.startsWith(goModulePath + '/'))) return true;
    if (item.language === 'python' && localPythonModules.has(item.specifier.split('.')[0])) return true;
    return false;
  });
  const unresolvedAliases = evidencedImports.filter(item => !item.resolved && aliasInfo.aliases.some(alias =>
    (item.from === alias.configRoot || item.from.startsWith(alias.configRoot ? alias.configRoot + '/' : '')) &&
    matchAlias(alias.pattern, item.specifier) !== null
  ));
  const manifestTexts = manifests.map(file => contents[file]).filter(value => typeof value === 'string');
  const workspaceDependencies = workspace.dependencies.map(item => ({
    ...item,
    fromEvidenceId: evidenceByPath.get(norm(item.fromManifest))?.id || null,
    fromSourceSha256: evidenceByPath.get(norm(item.fromManifest))?.sourceSha256 || null,
    toEvidenceId: evidenceByPath.get(norm(item.toManifest))?.id || null,
    toSourceSha256: evidenceByPath.get(norm(item.toManifest))?.sourceSha256 || null
  }));
  const findingCount = evidencedSymbols.length + evidencedImports.length + workspaceDependencies.length;
  const fingerprintedFindingCount =
    [...evidencedSymbols, ...evidencedImports].filter(item => item.evidenceId).length +
    workspaceDependencies.filter(item => item.fromEvidenceId && item.toEvidenceId).length;
  const resolvedAliasCount = evidencedImports.filter(item => item.resolutionKind === 'tsconfig_path_alias').length;
  const fingerprintedAliasConfigCount = evidencedImports.filter(item => item.resolutionKind === 'tsconfig_path_alias' && item.resolutionConfigEvidenceId).length;

  const databaseSchema = scanDatabaseSchema({ files: normalized, contents, sourceEvidence });

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
    unsupportedLanguageFileCount: ast.unsupportedFileCount + unsupportedSources.length,
    unsupportedLanguageFiles: [...ast.unsupportedFiles.map(item => item.file), ...unsupportedSources].slice(0, 500),
    parseFailureFileCount: ast.failedFileCount,
    syntaxErrorFileCount: ast.parsedFiles.filter(item => item.hasError).length,
    nodeLimitFileCount: ast.parsedFiles.filter(item => item.nodeLimitReached).length,
    depthLimitFileCount: ast.parsedFiles.filter(item => item.depthLimitReached).length,
    parseCounts: ast.parseCounts,
    availableGrammarLanguages: ast.availableLanguages,
    visitedAstNodeCount: ast.visitedNodeCount,
    symbols: evidencedSymbols.slice(0, 4000),
    symbolCount: evidencedSymbols.length,
    imports: evidencedImports.slice(0, 6000),
    importCount: evidencedImports.length,
    dependencyGraph: { nodes: [...new Set([...analyzed, ...edges.map(edge => edge.to)])].sort(), edges: edges.slice(0, 6000), edgeCount: edges.length },
    workspaceGraph: {
      packageManager: workspace.packageManager,
      isMonorepo: workspace.isMonorepo,
      detection: workspace.detection,
      workspacePatterns: workspace.workspacePatterns,
      packages: workspace.packages,
      dependencies: workspaceDependencies,
      diagnostics: workspace.diagnostics
    },
    pathAliases: {
      configCount: new Set(aliasInfo.aliases.map(item => item.configFile)).size,
      mappingCount: aliasInfo.aliases.length,
      resolvedImportCount: evidencedImports.filter(item => item.resolutionKind === 'tsconfig_path_alias').length,
      unresolvedImportCount: unresolvedAliases.length,
      unresolvedImports: unresolvedAliases.slice(0, 300).map(item => ({ from: item.from, specifier: item.specifier })),
      diagnostics: aliasInfo.diagnostics
    },
    evidenceCoverage: {
      findingCount,
      fingerprintedFindingCount,
      fingerprintedFindingRate: findingCount ? Number((fingerprintedFindingCount / findingCount).toFixed(4)) : 1,
      resolvedAliasCount,
      fingerprintedAliasConfigCount,
      aliasConfigFingerprintRate: resolvedAliasCount ? Number((fingerprintedAliasConfigCount / resolvedAliasCount).toFixed(4)) : 1
    },
    unresolvedLocalImports: unresolved.slice(0, 1000),
    unresolvedLocalImportCount: unresolved.length,
    frameworks: frameworksFor(manifestTexts.join('\n')),
    entryPoints: [...entries].filter(file => fileSet.has(file)).sort(),
    routeFiles: normalized.filter(file => /(^|\/)(routes?|controllers?|api)(\/|$)|(^|\/)app\/api\//i.test(file)),
    databaseSchema,
    testFiles: normalized.filter(file => /(^|\/)(__tests__|tests?|spec)(\/|\.|$)/i.test(file)),
    diagnostics: [...ast.diagnostics, ...aliasInfo.diagnostics, ...workspace.diagnostics].slice(0, 500),
    parserDiagnostics: [
      ...ast.unsupportedFiles.map(item => ({ ...item, kind: 'grammar_unavailable', trustLevel: 'untrusted_repository_analysis' })),
      ...ast.failedFiles.map(item => ({ ...item, kind: 'parse_failure', trustLevel: 'untrusted_repository_analysis' }))
    ].slice(0, 500),
    limitations: [
      'Tree-sitter provides concrete syntax trees, not type checking, symbol resolution, or proof of runtime behavior.',
      'Only grammars bundled with the pinned WebAssembly language pack are parsed; unsupported languages use bounded lexical fallback.',
      'Path aliases are resolved only from included tsconfig/jsconfig files; inherited configurations and extended aliases are not loaded.',
      'Workspace edges represent package-manifest declarations, not proof that a package is used at runtime.',
      'Package-manager resolution, package exports, dynamic runtime loading, generated code, reflection, and dependency injection may remain unresolved.',
      'Analysis is bounded to the files and bytes selected by the repository scanner; missing evidence is not proof of absence.',
      'Syntax-error diagnostics describe parser recovery and require human review.'
    ]
  };
}
