import { Parser, Language } from 'web-tree-sitter';
import { getWasmPath } from 'tree-sitter-wasm';

const EXTENSION_LANGUAGE = new Map([
  ['.js', 'javascript'], ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.ts', 'typescript'], ['.tsx', 'tsx'], ['.py', 'python'], ['.go', 'go'],
  ['.rs', 'rust'], ['.java', 'java'], ['.kt', 'kotlin'], ['.php', 'php'], ['.rb', 'ruby']
]);

const SYMBOL_TYPES = {
  javascript: { function_declaration: 'function', generator_function_declaration: 'function', class_declaration: 'class', method_definition: 'method' },
  typescript: { function_declaration: 'function', generator_function_declaration: 'function', class_declaration: 'class', abstract_class_declaration: 'class', interface_declaration: 'interface', type_alias_declaration: 'type', enum_declaration: 'enum', method_definition: 'method' },
  tsx: { function_declaration: 'function', generator_function_declaration: 'function', class_declaration: 'class', abstract_class_declaration: 'class', interface_declaration: 'interface', type_alias_declaration: 'type', enum_declaration: 'enum', method_definition: 'method' },
  python: { function_definition: 'function', class_definition: 'class' },
  go: { function_declaration: 'function', method_declaration: 'method', type_spec: 'type' },
  rust: { function_item: 'function', struct_item: 'struct', enum_item: 'enum', trait_item: 'trait', mod_item: 'module', type_item: 'type' },
  java: { class_declaration: 'class', interface_declaration: 'interface', enum_declaration: 'enum', record_declaration: 'record', method_declaration: 'method', constructor_declaration: 'constructor' },
  kotlin: { class_declaration: 'class', object_declaration: 'object', function_declaration: 'function' },
  php: { class_declaration: 'class', interface_declaration: 'interface', trait_declaration: 'trait', enum_declaration: 'enum', function_definition: 'function', method_declaration: 'method' },
  ruby: { class: 'class', module: 'module', method: 'function', singleton_method: 'method' }
};

const NAME_TYPES = new Set(['identifier', 'type_identifier', 'property_identifier', 'field_identifier', 'constant', 'name', 'simple_identifier', 'namespace_name']);
const IMPORT_NODE_TYPES = {
  javascript: new Set(['import_statement', 'export_statement']),
  typescript: new Set(['import_statement', 'export_statement']),
  tsx: new Set(['import_statement', 'export_statement']),
  python: new Set(['import_statement', 'import_from_statement']),
  go: new Set(['import_spec']),
  rust: new Set(['use_declaration', 'mod_item']),
  java: new Set(['import_declaration']),
  kotlin: new Set(['import_header']),
  php: new Set(['namespace_use_declaration', 'use_declaration']),
  ruby: new Set(['call'])
};

let parserInitialization;
const nodeText = node => typeof node?.text === 'string' ? node.text : '';

function declaredName(node) {
  const field = node.childForFieldName?.('name');
  if (field) return nodeText(field);
  const candidate = node.namedChildren?.find(child => NAME_TYPES.has(child.type));
  if (candidate) return nodeText(candidate);
  const match = nodeText(node).match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|struct|trait|mod|fn|def|fun|module|object)\s+([\w$]+)/);
  return match?.[1] || null;
}

function importsFromNode(node, language) {
  const text = nodeText(node).trim();
  if (!text) return [];
  let match;
  if (language === 'javascript' || language === 'typescript' || language === 'tsx') {
    const source = node.childForFieldName?.('source');
    if (source) return [nodeText(source).replace(/^['"]|['"]$/g, '')];
    if (node.type === 'export_statement') match = text.match(/\bfrom\s*['"]([^'"]+)['"]/);
    else match = text.match(/(?:import\s*)['"]([^'"]+)['"]/);
  } else if (language === 'python') {
    match = text.match(/^from\s+([.\w]+)\s+import\b/) || text.match(/^import\s+([\w.]+)/);
  } else if (language === 'go') {
    match = text.match(/["']([^"']+)["']/);
  } else if (language === 'rust') {
    match = text.match(/^(?:pub\s+)?(?:use|mod)\s+([\w:]+)/);
  } else if (language === 'java' || language === 'kotlin') {
    match = text.match(/^import\s+(?:static\s+)?([\w.*]+)/);
  } else if (language === 'php') {
    match = text.match(/^use\s+([\w\\.]+)/);
  } else if (language === 'ruby') {
    match = text.match(/\b(?:require|require_relative)\s*\(?\s*['"]([^'"]+)['"]/);
  }
  return match?.[1] ? [match[1]] : [];
}

function collectTreeFacts(root, language) {
  const symbols = [];
  const imports = [];
  const stack = [root];
  const symbolTypes = SYMBOL_TYPES[language] || {};
  const importTypes = IMPORT_NODE_TYPES[language] || new Set();

  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const kind = symbolTypes[node.type];
    if (kind) {
      const name = declaredName(node);
      if (name) symbols.push({ name, kind, line: (node.startPosition?.row ?? 0) + 1, nodeType: node.type, source: 'tree_sitter_ast' });
    }

    if (importTypes.has(node.type)) {
      for (const specifier of importsFromNode(node, language)) if (specifier) imports.push(specifier);
    }

    if (['javascript', 'typescript', 'tsx'].includes(language) && node.type === 'variable_declarator') {
      const value = node.childForFieldName?.('value');
      const name = node.childForFieldName?.('name');
      if (value && name && ['arrow_function', 'function_expression', 'generator_function'].includes(value.type)) {
        symbols.push({ name: nodeText(name), kind: 'function', line: (node.startPosition?.row ?? 0) + 1, nodeType: node.type, source: 'tree_sitter_ast' });
      }
    }

    const children = node.namedChildren || [];
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }

  return {
    symbols: [...new Map(symbols.map(item => [item.kind + ':' + item.name + ':' + item.line, item])).values()],
    imports: [...new Set(imports)]
  };
}

function countSyntaxErrors(root) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const missing = typeof node.isMissing === 'function' ? node.isMissing() : node.isMissing === true;
    if (node.type === 'ERROR' || missing) count++;
    for (const child of node.namedChildren || []) stack.push(child);
  }
  return count;
}

/**
 * Parse bounded source text only. Repository modules are never imported or executed.
 */
export async function analyzeSourcesWithTreeSitter({ files = [], contents = {} } = {}) {
  const result = {
    parser: 'tree-sitter-wasm',
    runtimeVersion: '0.27.1',
    parsedFileCount: 0,
    parseErrorFileCount: 0,
    parseErrorNodeCount: 0,
    unsupportedFileCount: 0,
    unavailable: false,
    files: [],
    symbolsByFile: Object.create(null),
    importsByFile: Object.create(null)
  };

  try {
    parserInitialization ||= Parser.init();
    await parserInitialization;
  } catch (error) {
    result.unavailable = true;
    result.error = String(error?.message || error).slice(0, 300);
    result.unsupportedFileCount = files.length;
    result.files = files.map(file => ({ path: file, parser: 'lexical_fallback', reason: 'tree_sitter_runtime_unavailable' }));
    return result;
  }

  const languages = new Map();
  for (const file of files) {
    const extension = file.slice(file.lastIndexOf('.')).toLowerCase();
    const language = EXTENSION_LANGUAGE.get(extension);
    if (!language || typeof contents[file] !== 'string') {
      result.unsupportedFileCount++;
      result.files.push({ path: file, parser: 'lexical_fallback', reason: 'unsupported_language_or_unavailable_source' });
      continue;
    }

    let parser;
    let tree;
    try {
      if (!languages.has(language)) languages.set(language, await Language.load(getWasmPath(language)));
      parser = new Parser();
      parser.setLanguage(languages.get(language));
      tree = parser.parse(contents[file]);
      if (!tree?.rootNode) throw new Error('Tree-sitter returned no syntax tree');

      const syntaxErrorNodes = countSyntaxErrors(tree.rootNode);
      const rootHasErrors = typeof tree.rootNode.hasError === 'function' ? tree.rootNode.hasError() : tree.rootNode.hasError === true;
      const hasErrors = rootHasErrors || syntaxErrorNodes > 0;
      result.parseErrorNodeCount += syntaxErrorNodes;
      if (hasErrors) {
        result.parseErrorFileCount++;
        result.files.push({ path: file, language, parser: 'lexical_fallback', parserAttempt: 'tree_sitter_ast', reason: 'syntax_errors', syntaxErrorNodeCount: syntaxErrorNodes });
        continue;
      }

      const facts = collectTreeFacts(tree.rootNode, language);
      result.parsedFileCount++;
      result.symbolsByFile[file] = facts.symbols;
      result.importsByFile[file] = facts.imports;
      result.files.push({ path: file, language, parser: 'tree_sitter_ast', hasSyntaxErrors: false, syntaxErrorNodeCount: 0 });
    } catch (error) {
      result.unsupportedFileCount++;
      result.files.push({ path: file, language, parser: 'lexical_fallback', reason: 'grammar_unavailable_or_parse_failed', error: String(error?.message || error).slice(0, 200) });
    } finally {
      tree?.delete?.();
      parser?.delete?.();
    }
  }

  return result;
}
