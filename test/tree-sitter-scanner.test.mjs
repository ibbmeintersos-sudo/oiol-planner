import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanRepository } from '../src/scanner/repository.mjs';

async function fixture(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { root, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

test('Tree-sitter AST extracts JavaScript declarations and ignores import-like comments', async () => {
  const f = await fixture('oiol-ast-js-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    await writeFile(path.join(f.root, 'src', 'app.js'), [
      "// import fake from './ghost.js';",
      "import { helper } from './helper.js';",
      "export function boot() { return helper(); }",
      "export const make = () => ({ ok: true });",
      "export class Engine {}",
      "// export ",
      "function internalHelper() { return false; }",
      ""
    ].join('\n'));
    await writeFile(path.join(f.root, 'src', 'helper.js'), 'export function helper() { return true; }\n');

    const result = await scanRepository(f.root);
    const structure = result.structure;
    assert.equal(structure.astFileCount, 2, JSON.stringify(structure.parserDiagnostics));
    assert.ok(structure.availableGrammarLanguages.includes('javascript'));
    assert.ok(structure.imports.some(item => item.specifier === './helper.js' && item.line === 2 && item.trustLevel === 'untrusted_repository_metadata'));
    assert.ok(structure.symbols.some(item => item.name === 'boot' && item.kind === 'function' && item.source === 'tree_sitter_ast' && item.exported === true));
    assert.ok(structure.symbols.some(item => item.name === 'make' && item.kind === 'function'));
    assert.ok(structure.symbols.some(item => item.name === 'Engine' && item.kind === 'class' && item.exported === true));
    assert.ok(structure.symbols.some(item => item.name === 'internalHelper' && item.exported === false));
    assert.equal(structure.imports.some(item => item.specifier === './ghost.js'), false);
    assert.ok(structure.imports.some(item => item.specifier === './helper.js' && item.to === 'src/helper.js'));
    assert.equal(structure.dependencyGraph.edgeCount, 1);
    assert.match(structure.method, /tree_sitter_ast/);
  } finally {
    await f.cleanup();
  }
});

test('Tree-sitter AST resolves Python relative imports and extracts class/function symbols', async () => {
  const f = await fixture('oiol-ast-python-');
  try {
    await mkdir(path.join(f.root, 'pkg'), { recursive: true });
    await writeFile(path.join(f.root, 'pkg', '__init__.py'), '');
    await writeFile(path.join(f.root, 'pkg', 'helpers.py'), 'def compute():\n    return 7\n');
    await writeFile(path.join(f.root, 'pkg', 'service.py'), [
      'from .helpers import compute',
      'class Planner:',
      '    pass',
      'def build_plan():',
      '    return compute()',
      ''
    ].join('\n'));

    const result = await scanRepository(f.root);
    const structure = result.structure;
    assert.ok(structure.astFileCount >= 2, JSON.stringify(structure.parserDiagnostics));
    assert.ok(structure.availableGrammarLanguages.includes('python'));
    assert.ok(structure.symbols.some(item => item.file === 'pkg/service.py' && item.name === 'Planner' && item.kind === 'class'));
    assert.ok(structure.symbols.some(item => item.file === 'pkg/service.py' && item.name === 'build_plan' && item.kind === 'function'));
    assert.ok(structure.imports.some(item => item.from === 'pkg/service.py' && item.specifier === '.helpers' && item.to === 'pkg/helpers.py'));
  } finally {
    await f.cleanup();
  }
});

test('Tree-sitter syntax recovery is surfaced as evidence instead of crashing the scan', async () => {
  const f = await fixture('oiol-ast-errors-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    await writeFile(path.join(f.root, 'src', 'broken.js'), 'export function broken( {\n');
    const result = await scanRepository(f.root);
    assert.equal(result.structure.astFileCount, 1, JSON.stringify(result.structure.parserDiagnostics));
    assert.equal(result.structure.syntaxErrorFileCount, 1);
    assert.ok(result.structure.diagnostics.some(item => item.file === 'src/broken.js'));
  } finally {
    await f.cleanup();
  }
});

test('Tree-sitter distinguishes exported and module-local TypeScript contract declarations', async () => {
  const f = await fixture('oiol-ast-ts-exports-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    await writeFile(path.join(f.root, 'src', 'contracts.ts'), [
      'export interface UserProfileResponse { userId: string; }',
      'export type PublicUserId = string;',
      'interface InternalProfile { secret: boolean; }',
      ''
    ].join('\n'));

    const result = await scanRepository(f.root);
    const symbols = result.structure.symbols.filter(item => item.file === 'src/contracts.ts');
    assert.ok(symbols.some(item => item.name === 'UserProfileResponse' && item.kind === 'interface' && item.exported === true));
    assert.ok(symbols.some(item => item.name === 'PublicUserId' && item.kind === 'type' && item.exported === true));
    assert.ok(symbols.some(item => item.name === 'InternalProfile' && item.exported === false));
  } finally {
    await f.cleanup();
  }
});

test('scanner prioritizes root manifests and application source over metadata and documentation', async () => {
  const f = await fixture('oiol-scan-priority-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    await mkdir(path.join(f.root, 'tests'), { recursive: true });
    await mkdir(path.join(f.root, '.github', 'workflows'), { recursive: true });
    await mkdir(path.join(f.root, 'docs'), { recursive: true });
    await writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'priority-fixture' }));
    await writeFile(path.join(f.root, 'README.md'), '# Priority fixture\n');
    await writeFile(path.join(f.root, 'src', 'app.js'), 'export function app() { return true; }\n');
    await writeFile(path.join(f.root, 'src', 'helper.js'), 'export function helper() { return true; }\n');
    await writeFile(path.join(f.root, 'tests', 'app.test.js'), 'test("app", () => {});\n');
    await writeFile(path.join(f.root, '.github', 'workflows', 'pull-db-tests.yml'), 'name: test\n');
    await writeFile(path.join(f.root, '.github', 'ISSUE_TEMPLATE', 'config.yml').replace('/ISSUE_TEMPLATE/', '/'), 'blank_issues_enabled: true\n').catch(() => {});
    for (let index = 0; index < 30; index++) {
      await writeFile(path.join(f.root, 'docs', 'page-' + index + '.md'), '# Documentation ' + index + '\n');
    }

    const result = await scanRepository(f.root, { maxFiles: 5 });
    const paths = result.files.map(file => file.path);
    assert.ok(paths.includes('package.json'));
    assert.ok(paths.includes('src/app.js'));
    assert.ok(paths.includes('src/helper.js'));
    assert.ok(paths.includes('tests/app.test.js'));
    assert.equal(paths.some(file => file.startsWith('.github/')), false);
    assert.equal(result.tests.includes('tests/app.test.js'), true);
    assert.equal(result.tests.includes('.github/workflows/pull-db-tests.yml'), false);
    assert.equal(result.truncated, true);
  } finally {
    await f.cleanup();
  }
});

test('AST analysis continues across bounded source files after prompt context is full', async () => {
  const f = await fixture('oiol-ast-context-bound-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    for (let index = 0; index < 4; index++) {
      await writeFile(path.join(f.root, 'src', 'module-' + index + '.js'),
        'export function module' + index + '() { return "' + 'x'.repeat(700) + '"; }\n');
    }
    const result = await scanRepository(f.root, { maxContextChars: 1000 });
    assert.equal(result.structure.astFileCount, 4);
    assert.equal(result.contextTruncated, true);
    assert.ok(result.snippets.filter(snippet => snippet.contextIncluded).length < 4);
    assert.ok(result.structure.symbols.some(item => item.name === 'module3'));
  } finally {
    await f.cleanup();
  }
});

test('scanner balances high-value server and web roots before mobile and OpenAPI trees', async () => {
  const f = await fixture('oiol-scan-multi-root-');
  try {
    for (const directory of ['server/src', 'web/src', 'mobile/lib', 'open-api/specs', 'i18n']) {
      await mkdir(path.join(f.root, directory), { recursive: true });
    }
    await writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'multi-root-fixture' }));
    for (let index = 0; index < 10; index++) {
      await writeFile(path.join(f.root, 'server/src', 'server-' + index + '.ts'), 'export const server' + index + ' = true;\n');
      await writeFile(path.join(f.root, 'web/src', 'web-' + index + '.ts'), 'export const web' + index + ' = true;\n');
      await writeFile(path.join(f.root, 'mobile/lib', 'mobile-' + index + '.dart'), 'class Mobile' + index + ' {}\n');
      await writeFile(path.join(f.root, 'open-api/specs', 'api-' + index + '.yaml'), 'openapi: 3.0.0\n');
    }
    const result = await scanRepository(f.root, { maxFiles: 25 });
    const paths = result.files.map(file => file.path);
    assert.ok(paths.some(file => file.startsWith('server/src/')));
    assert.ok(paths.some(file => file.startsWith('web/src/')));
    assert.equal(paths.some(file => file.startsWith('open-api/')), false);
    assert.equal(paths.some(file => file.startsWith('i18n/')), false);
  } finally {
    await f.cleanup();
  }
});

test('scanner reports source files in unsupported languages instead of silently omitting them', async () => {
  const f = await fixture('oiol-unsupported-languages-');
  try {
    await mkdir(path.join(f.root, 'server', 'src'), { recursive: true });
    await mkdir(path.join(f.root, 'mobile', 'lib'), { recursive: true });
    await mkdir(path.join(f.root, 'native'), { recursive: true });
    await writeFile(path.join(f.root, 'server', 'src', 'main.ts'), 'export function main() { return true; }\n');
    await writeFile(path.join(f.root, 'mobile', 'lib', 'main.scala'), 'class MainScreen {}\n');
    await writeFile(path.join(f.root, 'native', 'main.cs'), 'public class NativeApp {}\n');
    const result = await scanRepository(f.root);
    assert.equal(result.structure.sourceFileCount, 3);
    assert.equal(result.structure.analyzedSourceFileCount, 1);
    assert.equal(result.structure.unsupportedLanguageFileCount, 2);
    assert.deepEqual(result.structure.unsupportedLanguageFiles.sort(), ['mobile/lib/main.scala', 'native/main.cs']);
  } finally {
    await f.cleanup();
  }
});

test('scanner descends into application source before large low-priority root directories', async () => {
  const f = await fixture('oiol-scan-nested-priority-');
  try {
    await mkdir(path.join(f.root, 'server', 'src'), { recursive: true });
    await mkdir(path.join(f.root, 'i18n'), { recursive: true });
    await writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'nested-priority-fixture' }));
    for (let index = 0; index < 12; index++) {
      await writeFile(path.join(f.root, 'server', 'src', 'module-' + index + '.ts'), 'export const module' + index + ' = true;\n');
      await writeFile(path.join(f.root, 'i18n', 'locale-' + index + '.json'), '{}\n');
    }
    const result = await scanRepository(f.root, { maxFiles: 13 });
    const paths = result.files.map(file => file.path);
    assert.equal(paths.filter(file => file.startsWith('server/src/')).length, 12);
    assert.equal(paths.some(file => file.startsWith('i18n/')), false);
  } finally {
    await f.cleanup();
  }
});

test('scanner excludes common credential and private-key file formats from evidence collection', async () => {
  const f = await fixture('oiol-sensitive-files-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    await writeFile(path.join(f.root, 'src', 'app.js'), 'export const safe = true;\n');
    const sensitive = [
      '.env.production', '.npmrc', '.pypirc', '.netrc',
      'credentials.json', 'credentials.yaml', 'secrets.yml',
      'server.p12', 'server.pfx', 'signing.jks', 'private.keystore',
      'id_rsa', 'id_ed25519', 'tls/private-key.pem'
    ];
    for (const relative of sensitive) {
      const destination = path.join(f.root, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, 'DO_NOT_INCLUDE_THIS_SECRET_MATERIAL');
    }
    const result = await scanRepository(f.root);
    const included = result.files.map(file => file.path);
    for (const relative of sensitive) {
      assert.equal(included.includes(relative), false, 'sensitive file included: ' + relative);
    }
    assert.ok(result.snippets.some(snippet => snippet.path === 'src/app.js'));
    assert.equal(result.skipped.counts.sensitive, sensitive.length);
    assert.ok(result.skipped.paths.some(item => item.path === '.npmrc' && item.reason === 'sensitive'));
    assert.equal(JSON.stringify(result.snippets).includes('DO_NOT_INCLUDE_THIS_SECRET_MATERIAL'), false);
  } finally {
    await f.cleanup();
  }
});

test('scanner reports file-limit and depth-limit exclusions without claiming complete coverage', async () => {
  const f = await fixture('oiol-scan-exclusion-report-');
  try {
    await mkdir(path.join(f.root, 'src', 'nested', 'deeper'), { recursive: true });
    await writeFile(path.join(f.root, 'a.txt'), 'a');
    await writeFile(path.join(f.root, 'b.txt'), 'b');
    await writeFile(path.join(f.root, 'src', 'nested', 'deeper', 'module.js'), 'export const nested = true;');
    const fileLimited = await scanRepository(f.root, { maxFiles: 1 });
    assert.equal(fileLimited.truncated, true);
    assert.equal(fileLimited.skipped.counts.fileLimit, 1);
    assert.ok(fileLimited.skipped.fileLimitReachedAt);
    const depthLimited = await scanRepository(f.root, { maxDepth: 1 });
    assert.equal(depthLimited.depthTruncated, true);
    assert.equal(depthLimited.skipped.counts.depthLimit, 1);
    assert.ok(depthLimited.skipped.paths.some(item => item.path === 'src/nested' && item.reason === 'depthLimit'));
  } finally {
    await f.cleanup();
  }
});

test('scanner source-file cap is configurable and evidence selection interleaves manifests, source, tests, and config', async () => {
  const f = await fixture('oiol-balanced-context-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    await mkdir(path.join(f.root, 'tests'), { recursive: true });
    await writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'balanced-fixture' }));
    await writeFile(path.join(f.root, 'src', 'a.js'), 'export const a = 1;');
    await writeFile(path.join(f.root, 'src', 'b.js'), 'export const b = 2;');
    await writeFile(path.join(f.root, 'src', 'c.js'), 'export const c = 3;');
    await writeFile(path.join(f.root, 'tests', 'a.test.js'), 'test("a", () => {});');
    await writeFile(path.join(f.root, 'vite.config.json'), 'export default {};');
    const result = await scanRepository(f.root, { maxSourceFiles: 2, maxContextChars: 2000 });
    assert.equal(result.scanLimits.maxSourceFiles, 2);
    assert.ok(result.structure.analyzedSourceFileCount <= 17);
    const snippetPaths = result.snippets.map(item => item.path);
    assert.ok(snippetPaths.includes('package.json'));
    assert.ok(snippetPaths.includes('tests/a.test.js'));
    assert.ok(snippetPaths.includes('vite.config.json'));
    assert.ok(snippetPaths.includes('src/a.js'));
    assert.ok(snippetPaths.includes('src/b.js'));
    assert.equal(snippetPaths.includes('src/c.js'), false);
  } finally {
    await f.cleanup();
  }
});

test('scanner resolves Go module imports and Python absolute package imports', async () => {
  const f = await fixture('oiol-module-import-resolution-');
  try {
    await mkdir(path.join(f.root, 'pkg', 'b'), { recursive: true });
    await mkdir(path.join(f.root, 'src', 'pypkg'), { recursive: true });
    await writeFile(path.join(f.root, 'go.mod'), 'module example.com/oiol\n\ngo 1.22\n');
    await writeFile(path.join(f.root, 'pkg', 'a.go'), 'package pkg\nimport "example.com/oiol/pkg/b"\nfunc A() { b.B() }\n');
    await writeFile(path.join(f.root, 'pkg', 'b', 'b.go'), 'package b\nfunc B() {}\n');
    await writeFile(path.join(f.root, 'src', 'pypkg', '__init__.py'), '');
    await writeFile(path.join(f.root, 'src', 'pypkg', 'a.py'), 'from pypkg.b import B\ndef a(): return B()\n');
    await writeFile(path.join(f.root, 'src', 'pypkg', 'b.py'), 'def B(): return True\n');
    const result = await scanRepository(f.root, { maxSourceFiles: 50 });
    const edges = result.structure.dependencyGraph.edges;
    assert.ok(edges.some(edge => edge.from === 'pkg/a.go' && edge.to === 'pkg/b/b.go' && edge.resolution === 'go-module-package-representative'));
    assert.ok(edges.some(edge => edge.from === 'src/pypkg/a.py' && edge.to === 'src/pypkg/b.py' && edge.resolution === 'python-module-root'));
    assert.ok(result.structure.dependencyGraph.nodes.includes('pkg/b/b.go'));
    assert.ok(result.structure.dependencyGraph.nodes.includes('src/pypkg/b.py'));
  } finally {
    await f.cleanup();
  }
});

test('scanner parses Dart and Swift sources and extracts their import declarations', async () => {
  const f = await fixture('oiol-ast-dart-swift-');
  try {
    await mkdir(path.join(f.root, 'mobile', 'lib'), { recursive: true });
    await mkdir(path.join(f.root, 'native'), { recursive: true });
    await writeFile(path.join(f.root, 'mobile', 'lib', 'service.dart'), [
      "import 'package:flutter/material.dart';",
      'class MobileService {',
      '  Future<void> load() async {}',
      '}',
      ''
    ].join('\n'));
    await writeFile(path.join(f.root, 'native', 'Service.swift'), [
      'import Foundation',
      'public struct NativeService {',
      '  public func load() {}',
      '}',
      ''
    ].join('\n'));
    const result = await scanRepository(f.root, { maxSourceFiles: 20 });
    const structure = result.structure;
    assert.equal(structure.astFileCount, 1, JSON.stringify(structure.parserDiagnostics));
    assert.equal(structure.lexicalFallbackFileCount, 1);
    assert.equal(structure.unsupportedLanguageFileCount, 1);
    assert.equal(structure.parseCounts.dart, undefined);
    assert.equal(structure.parseCounts.swift, 1);
    assert.ok(structure.parserDiagnostics.some(item => item.file === 'mobile/lib/service.dart' && item.kind === 'grammar_unavailable'));
    assert.ok(structure.imports.some(item => item.from === 'mobile/lib/service.dart' && item.specifier === 'package:flutter/material.dart'));
    assert.ok(structure.imports.some(item => item.from === 'native/Service.swift' && item.specifier === 'Foundation'));
  } finally {
    await f.cleanup();
  }
});


test('scanner prioritizes task evidence paths and reports missing or unexcerpted paths', async () => {
  const f = await fixture('oiol-task-evidence-priority-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    await mkdir(path.join(f.root, 'tests'), { recursive: true });
    await writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'task-evidence-fixture' }));
    await writeFile(path.join(f.root, 'src', 'a.js'), 'export const a = 1;\n');
    await writeFile(path.join(f.root, 'src', 'z-critical.js'), 'export function critical() { return "critical evidence"; }\n');
    await writeFile(path.join(f.root, 'tests', 'z-critical.test.js'), 'test("critical", () => {});\n');
    const result = await scanRepository(f.root, {
      maxContextChars: 5000,
      maxSourceFiles: 1,
      priorityPaths: ['src/z-critical.js', 'tests/z-critical.test.js', 'src/missing.js']
    });
    const snippetPaths = result.snippets.map(item => item.path);
    assert.deepEqual(snippetPaths.slice(0, 2), ['src/z-critical.js', 'tests/z-critical.test.js']);
    assert.deepEqual(result.evidenceSelection.requestedPaths, ['src/z-critical.js', 'tests/z-critical.test.js', 'src/missing.js']);
    assert.deepEqual(result.evidenceSelection.excerptedPaths, ['src/z-critical.js', 'tests/z-critical.test.js']);
    assert.deepEqual(result.evidenceSelection.missingPaths, ['src/missing.js']);
    assert.deepEqual(result.evidenceSelection.unexcerptedPaths, []);
  } finally {
    await f.cleanup();
  }
});

test('scanner rejects unsafe task evidence paths', async () => {
  const f = await fixture('oiol-task-evidence-unsafe-');
  try {
    await assert.rejects(() => scanRepository(f.root, { priorityPaths: ['../outside.js'] }), /Unsafe priority evidence path/);
    await assert.rejects(() => scanRepository(f.root, { priorityPaths: ['.env'] }), /Sensitive priority evidence path/);
  } finally {
    await f.cleanup();
  }
});


test('scanner emits bounded line-ranged excerpts from oversized task evidence files', async () => {
  const f = await fixture('oiol-task-evidence-ranges-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    const lines = Array.from({ length: 260 }, (_, index) => 'const line' + (index + 1) + ' = ' + index + ';');
    lines[219] = 'export function criticalQuotaRule() { return "external library"; }';
    await writeFile(path.join(f.root, 'src', 'large.ts'), lines.join('\n') + '\n');
    const result = await scanRepository(f.root, {
      maxFileBytes: 100,
      maxPriorityFileBytes: 20000,
      maxPriorityExcerptChars: 2000,
      maxContextChars: 5000,
      priorityPaths: ['src/large.ts'],
      priorityRanges: [{ path: 'src/large.ts', startLine: 218, endLine: 222 }]
    });
    const snippet = result.snippets.find(item => item.path === 'src/large.ts');
    assert.ok(snippet);
    assert.match(snippet.content, /criticalQuotaRule/);
    assert.doesNotMatch(snippet.content, /const line1 =/);
    assert.deepEqual(result.evidenceSelection.excerptedRanges, [{ path: 'src/large.ts', startLine: 218, endLine: 222 }]);
    assert.deepEqual(result.evidenceSelection.unexcerptedRanges, []);
  } finally {
    await f.cleanup();
  }
});

test('scanner reports line ranges that cannot be supplied', async () => {
  const f = await fixture('oiol-task-evidence-range-missing-');
  try {
    await mkdir(path.join(f.root, 'src'), { recursive: true });
    await writeFile(path.join(f.root, 'src', 'short.ts'), 'export const present = true;\n');
    const result = await scanRepository(f.root, {
      priorityPaths: ['src/short.ts'],
      priorityRanges: [{ path: 'src/short.ts', startLine: 99, endLine: 101 }]
    });
    assert.deepEqual(result.evidenceSelection.excerptedRanges, []);
    assert.deepEqual(result.evidenceSelection.unexcerptedRanges, [{ path: 'src/short.ts', startLine: 99, endLine: 101 }]);
  } finally {
    await f.cleanup();
  }
});
