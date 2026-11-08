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
      ""
    ].join('\n'));
    await writeFile(path.join(f.root, 'src', 'helper.js'), 'export function helper() { return true; }\n');

    const result = await scanRepository(f.root);
    const structure = result.structure;
    assert.equal(structure.astFileCount, 2, JSON.stringify(structure.parserDiagnostics));
    assert.ok(structure.availableGrammarLanguages.includes('javascript'));
    assert.ok(structure.imports.some(item => item.specifier === './helper.js' && item.line === 2 && item.trustLevel === 'untrusted_repository_metadata'));
    assert.ok(structure.symbols.some(item => item.name === 'boot' && item.kind === 'function' && item.source === 'tree_sitter_ast'));
    assert.ok(structure.symbols.some(item => item.name === 'make' && item.kind === 'function'));
    assert.ok(structure.symbols.some(item => item.name === 'Engine' && item.kind === 'class'));
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
    assert.ok(result.snippets.length < 4);
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
