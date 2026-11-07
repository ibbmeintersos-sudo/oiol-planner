import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanRepository } from '../src/scanner/repository.mjs';

async function fixture(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
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
