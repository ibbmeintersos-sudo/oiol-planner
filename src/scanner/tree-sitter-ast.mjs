import * as TreeSitter from '@xberg-io/tree-sitter-language-pack-wasm';
import path from 'node:path';
import { redact } from '../core/utils.mjs';

const EXTENSION_LANGUAGE = new Map([
  ['.js', 'javascript'], ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.ts', 'typescript'], ['.tsx', 'tsx'],
  ['.py', 'python'], ['.go', 'go'], ['.rs', 'rust'], ['.java', 'java'],
  ['.kt', 'kotlin'], ['.php', 'php'], ['.rb', 'ruby'], ['.dart', 'dart'], ['.swift', 'swift']
]);

const parserCache = new Map();
let grammarCatalogCache = null;

function availableGrammarLanguages() {
  if (grammarCatalogCache) return grammarCatalogCache;
  try {
    grammarCatalogCache = typeof TreeSitter.availableLanguages === 'function'
      ? [...new Set(TreeSitter.availableLanguages())].sort()
      : [];
  } catch {
    grammarCatalogCache = [];
  }
  return grammarCatalogCache;
}
const MAX_NODES_PER_FILE = 50000;
const MAX_DEPTH = 128;

function safeFree(value) {
  try { value?.free?.(); } catch {}
}

function parserFor(language) {
  if (parserCache.has(language)) return parserCache.get(language);
  if (typeof TreeSitter.getParser !== 'function') throw new Error('Tree-sitter WASM getParser API is unavailable');
  const parser = TreeSitter.getParser(language);
  parserCache.set(language, parser);
  return parser;
}

function nodeText(node, sourceBytes) {
  const start = node.startByte();
  const end = node.endByte();
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > sourceBytes.length) return '';
  return sourceBytes.subarray(start, end).toString('utf8');
}

function nodeName(node, sourceBytes) {
  let nameNode;
  try { nameNode = node.childByFieldName('name'); } catch {}
  if (nameNode) {
    try { return nodeText(nameNode, sourceBytes).trim(); }
    finally { safeFree(nameNode); }
  }
  const count = Math.min(node.childCount(), 32);
  for (let index = 0; index < count; index++) {
    const child = node.child(index);
    if (!child) continue;
    try {
      const kind = child.kind();
      if (['identifier', 'type_identifier', 'field_identifier', 'constant'].includes(kind)) {
        const value = nodeText(child, sourceBytes).trim();
        if (value) return value;
      }
    } finally { safeFree(child); }
  }
  return '';
}

function lineStartsFor(sourceBytes) {
  const starts = [0];
  for (let i = 0; i < sourceBytes.length; i++) if (sourceBytes[i] === 10) starts.push(i + 1);
  return starts;
}

function byteLine(lineStarts, byteOffset) {
  let low = 0, high = lineStarts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lineStarts[middle] <= byteOffset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function classifySymbol(language, node, sourceBytes, lineStarts) {
  const kind = node.kind();
  const direct = {
    javascript: {
      class_declaration: 'class', function_declaration: 'function', method_definition: 'method'
    },
    typescript: {
      class_declaration: 'class', abstract_class_declaration: 'class', function_declaration: 'function',
      method_definition: 'method', interface_declaration: 'interface', type_alias_declaration: 'type',
      enum_declaration: 'enum'
    },
    tsx: {
      class_declaration: 'class', abstract_class_declaration: 'class', function_declaration: 'function',
      method_definition: 'method', interface_declaration: 'interface', type_alias_declaration: 'type',
      enum_declaration: 'enum'
    },
    python: { class_definition: 'class', function_definition: 'function' },
    go: { function_declaration: 'function', method_declaration: 'method', type_spec: 'type' },
    rust: {
      function_item: 'function', struct_item: 'struct', enum_item: 'enum',
      trait_item: 'trait', mod_item: 'module', type_item: 'type'
    },
    java: {
      class_declaration: 'class', interface_declaration: 'interface', enum_declaration: 'enum',
      record_declaration: 'record', method_declaration: 'method'
    },
    kotlin: {
      class_declaration: 'class', object_declaration: 'object', function_declaration: 'function',
      type_alias: 'type'
    },
    php: {
      function_definition: 'function', class_declaration: 'class', interface_declaration: 'interface',
      trait_declaration: 'trait', enum_declaration: 'enum', method_declaration: 'method'
    },
    ruby: { class: 'class', module: 'module', method: 'method', singleton_method: 'method' },
    dart: { class_definition: 'class', enum_declaration: 'enum', mixin_declaration: 'mixin', extension_declaration: 'extension', function_signature: 'function', method_signature: 'method' },
    swift: { class_declaration: 'class', struct_declaration: 'struct', enum_declaration: 'enum', protocol_declaration: 'protocol', function_declaration: 'function', init_declaration: 'initializer' }
  };
  let symbolKind = direct[language]?.[kind] || null;
  if (language === 'go' && kind === 'type_spec') {
    const body = node.childByFieldName('type');
    if (body) {
      try {
        const bodyKind = body.kind();
        if (bodyKind === 'struct_type') symbolKind = 'struct';
        else if (bodyKind === 'interface_type') symbolKind = 'interface';
      } finally { safeFree(body); }
    }
  }
  if (['javascript', 'typescript', 'tsx'].includes(language) && kind === 'variable_declarator') {
    const value = node.childByFieldName('value');
    if (value) {
      try {
        if (['arrow_function', 'function_expression', 'generator_function'].includes(value.kind())) symbolKind = 'function';
      } finally { safeFree(value); }
    }
    symbolKind ||= 'variable';
  }
  if (!symbolKind) return null;
  const name = nodeName(node, sourceBytes);
  if (!name) return null;
  return { name, kind: symbolKind, line: byteLine(lineStarts, node.startByte()), source: 'tree_sitter_ast', trustLevel: 'untrusted_repository_metadata' };
}

function importSpecifiers(language, nodeKind, text) {
  const values = [];
  const add = value => {
    const clean = String(value || '').trim().replace(/^['"`]|['"`]$/g, '');
    if (clean && !values.includes(clean)) values.push(clean);
  };
  if (['javascript', 'typescript', 'tsx'].includes(language)) {
    if (nodeKind === 'import_statement' || nodeKind === 'export_statement') {
      const match = text.match(/\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/s);
      if (match) add(match[1] || match[2]);
    } else if (nodeKind === 'call_expression') {
      const match = text.match(/^\s*(?:import|require)\s*\(\s*['"]([^'"]+)['"]/);
      if (match) add(match[1]);
    }
  } else if (language === 'python') {
    let match = text.match(/^\s*from\s+([.\w]+)\s+import\b/);
    if (match) add(match[1]);
    else {
      match = text.match(/^\s*import\s+([\w.]+)/);
      if (match) add(match[1]);
    }
  } else if (language === 'go') {
    for (const match of text.matchAll(/["']([^"']+)["']/g)) add(match[1]);
  } else if (language === 'rust') {
    const match = text.match(/^\s*(?:pub\s+)?use\s+([^;]+);?/s);
    if (match) add(match[1].replace(/\{.*$/s, '').replace(/\s+as\s+\w+$/, '').trim());
  } else if (language === 'java' || language === 'kotlin') {
    const match = text.match(/^\s*import\s+(?:static\s+)?([\w.*]+)/);
    if (match) add(match[1]);
  } else if (language === 'php') {
    const match = text.match(/^\s*use\s+([\w\\]+)/);
    if (match) add(match[1]);
  } else if (language === 'ruby') {
    const match = text.match(/\b(?:require|require_relative)\s*\(?\s*['"]([^'"]+)['"]/);
    if (match) add(match[1]);
  } else if (language === 'dart') {
    const match = text.match(/^\s*(?:import|export)\s+['"]([^'"]+)['"]/);
    if (match) add(match[1]);
  } else if (language === 'swift') {
    const match = text.match(/^\s*import\s+(?:typealias|struct|class|enum|protocol|let|var|func)?\s*([\w.]+)/);
    if (match) add(match[1]);
  }
  return values;
}

const IMPORT_NODES = {
  javascript: new Set(['import_statement', 'export_statement', 'call_expression']),
  typescript: new Set(['import_statement', 'export_statement', 'call_expression']),
  tsx: new Set(['import_statement', 'export_statement', 'call_expression']),
  python: new Set(['import_statement', 'import_from_statement']),
  go: new Set(['import_declaration', 'import_spec']),
  rust: new Set(['use_declaration']),
  java: new Set(['import_declaration']),
  kotlin: new Set(['import_header']),
  php: new Set(['namespace_use_declaration', 'include_expression', 'require_expression']),
  ruby: new Set(['call']),
  dart: new Set(['import_or_export']),
  swift: new Set(['import_declaration'])
};

export function resolveLocalImport(file, language, specifier, fileSet, { goModulePath = null, pythonRoots = ['', 'src', 'lib', 'app'] } = {}) {
  if (language === 'go' && goModulePath && (specifier === goModulePath || specifier.startsWith(goModulePath + '/'))) {
    const packagePath = specifier === goModulePath ? '' : specifier.slice(goModulePath.length + 1);
    const candidates = [...fileSet]
      .filter(candidate => candidate.endsWith('.go') && path.posix.dirname(candidate) === (packagePath || '.'))
      .sort();
    return candidates.find(candidate => path.posix.basename(candidate) === 'doc.go') || candidates[0] || null;
  }
  if (language === 'python' && /^\.+/.test(specifier)) {
    const dots = specifier.match(/^\.+/)[0].length;
    const rest = specifier.slice(dots).replaceAll('.', '/');
    let baseDir = file.split('/').slice(0, -1).join('/');
    for (let i = 1; i < dots; i++) baseDir = baseDir.split('/').slice(0, -1).join('/');
    const base = [baseDir, rest].filter(Boolean).join('/');
    return [base + '.py', base + '/__init__.py'].find(candidate => fileSet.has(candidate)) || null;
  }
  if (language === 'python' && !specifier.startsWith('.')) {
    const modulePath = specifier.replaceAll('.', '/');
    for (const root of pythonRoots) {
      const base = root ? root + '/' + modulePath : modulePath;
      const target = [base + '.py', base + '/__init__.py'].find(candidate => fileSet.has(candidate));
      if (target) return target;
    }
  }
  if (specifier.startsWith('.')) {
    const base = file.split('/').slice(0, -1).concat(specifier).join('/').replace(/\/+/g, '/');
    const normalized = [];
    for (const part of base.split('/')) {
      if (part === '..') normalized.pop();
      else if (part !== '.' && part !== '') normalized.push(part);
    }
    const resolvedBase = normalized.join('/');
    const extensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py'];
    const candidates = [
      resolvedBase, ...extensions.map(ext => resolvedBase + ext),
      ...['index.js', 'index.ts', 'index.tsx', 'index.mjs', '__init__.py'].map(name => resolvedBase + '/' + name)
    ];
    return candidates.find(candidate => fileSet.has(candidate)) || null;
  }
  return null;
}

export function analyzeWithTreeSitter({ files = [], contents = {}, maxFileBytes = 16000, goModulePath = null, pythonRoots = ['', 'src', 'lib', 'app'] } = {}) {
  const fileSet = new Set(files.map(file => file.replaceAll('\\', '/').replace(/^\.\//, '')));
  const symbols = [], imports = [], diagnostics = [];
  const parsedFiles = [], unsupportedFiles = [], failedFiles = [];
  const parseCounts = Object.create(null);
  let visitedNodes = 0;

  for (const rawFile of fileSet) {
    const file = rawFile;
    const source = contents[file];
    if (typeof source !== 'string') continue;
    const language = EXTENSION_LANGUAGE.get(file.slice(file.lastIndexOf('.')).toLowerCase());
    if (!language) continue;
    const sourceBytes = Buffer.from(source, 'utf8');
    if (sourceBytes.length > maxFileBytes) continue;
    const lineStarts = lineStartsFor(sourceBytes);
    let parser;
    try { parser = parserFor(language); }
    catch (error) {
      unsupportedFiles.push({ file, language, reason: String(error?.message || error).slice(0, 180) });
      continue;
    }
    let tree, root;
    try {
      tree = parser.parse(source);
      if (!tree) {
        failedFiles.push({ file, language, reason: 'parse_returned_no_tree' });
        continue;
      }
      root = tree.rootNode();
      const stack = [{ node: root, depth: 0 }];
      let fileNodeCount = 0;
      let depthLimitReached = false;
      while (stack.length && fileNodeCount < MAX_NODES_PER_FILE) {
        const current = stack.pop();
        const node = current.node;
        try {
          visitedNodes++;
          fileNodeCount++;
          if (current.depth > MAX_DEPTH) continue;
          if (current.depth === MAX_DEPTH && node.childCount() > 0) depthLimitReached = true;
          const kind = node.kind();
          const symbol = classifySymbol(language, node, sourceBytes, lineStarts);
          if (symbol) symbols.push({ file, ...symbol });
          if (IMPORT_NODES[language]?.has(kind)) {
            const text = nodeText(node, sourceBytes);
            for (const specifier of importSpecifiers(language, kind, text)) {
              const safeSpecifier = redact(specifier.split(/[?#]/, 1)[0]).slice(0, 200);
              const target = resolveLocalImport(file, language, safeSpecifier, fileSet, { goModulePath, pythonRoots });
              imports.push({
                from: file, to: target, specifier: safeSpecifier, language,
                line: byteLine(lineStarts, node.startByte()),
                resolved: Boolean(target), trustLevel: 'untrusted_repository_metadata',
                source: 'tree_sitter_ast'
              });
            }
          }
          if (node.isError?.() || node.isMissing?.()) {
            diagnostics.push({
              file, language, kind, line: byteLine(lineStarts, node.startByte()),
              issue: node.isMissing?.() ? 'missing_syntax_node' : 'syntax_error_node',
              trustLevel: 'untrusted_repository_analysis'
            });
          }
          const count = Math.min(node.childCount(), MAX_NODES_PER_FILE);
          for (let index = count - 1; index >= 0; index--) {
            const child = node.child(index);
            if (child) stack.push({ node: child, depth: current.depth + 1 });
          }
          if (fileNodeCount >= MAX_NODES_PER_FILE) break;
        } finally {
          if (node !== root) safeFree(node);
        }
      }
      while (stack.length) safeFree(stack.pop().node);
      parsedFiles.push({ file, language, hasError: Boolean(root.hasError?.()), nodeLimitReached: fileNodeCount >= MAX_NODES_PER_FILE, depthLimitReached });
      parseCounts[language] = (parseCounts[language] || 0) + 1;
    } catch (error) {
      failedFiles.push({ file, language, reason: String(error?.message || error).slice(0, 180) });
    } finally {
      safeFree(root);
      safeFree(tree);
    }
  }

  return {
    symbols, imports, diagnostics, parsedFiles, unsupportedFiles, failedFiles,
    parsedFileCount: parsedFiles.length,
    unsupportedFileCount: unsupportedFiles.length,
    failedFileCount: failedFiles.length,
    parseCounts,
    visitedNodeCount: visitedNodes,
    method: 'tree_sitter_ast',
    availableLanguages: availableGrammarLanguages()
  };
}
