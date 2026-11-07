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
async function put(root, file, content) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

test('scanner resolves workspace package edges and TypeScript path aliases with evidence provenance', async () => {
  const f = await fixture('oiol-workspaces-');
  try {
    await put(f.root, 'package.json', JSON.stringify({
      name: 'workspace-platform', private: true, packageManager: 'pnpm@9.0.0',
      workspaces: ['apps/*', 'packages/*']
    }, null, 2));
    await put(f.root, 'apps/api/package.json', JSON.stringify({
      name: '@oiol/api', dependencies: {
        '@oiol/shared': 'workspace:*',
        '@oiol/missing': 'workspace:*'
      }
    }, null, 2));
    await put(f.root, 'packages/shared/package.json', JSON.stringify({
      name: '@oiol/shared', version: '1.0.0'
    }, null, 2));
    await put(f.root, 'tsconfig.json', [
      '{',
      '  // JSONC comments and trailing commas are valid in TypeScript configuration files.',
      '  "compilerOptions": {',
      '    "baseUrl": ".",',
      '    "paths": {',
      '      "@oiol/shared/*": ["packages/shared/src/*",],',
      '    },',
      '  },',
      '}',
      ''
    ].join('\n'));
    await put(f.root, 'apps/api/src/handler.ts', [
      "import { log } from '@oiol/shared/logger';",
      'export function createHandler() { return log("ready"); }',
      ''
    ].join('\n'));
    await put(f.root, 'packages/shared/src/logger.ts', [
      'export function log(message: string) { return message; }',
      ''
    ].join('\n'));

    const result = await scanRepository(f.root, { analysisMode: 'lexical' });
    const structure = result.structure;
    assert.equal(structure.workspaceGraph.packageManager, 'pnpm');
    assert.equal(structure.workspaceGraph.isMonorepo, true);
    assert.deepEqual(
      structure.workspaceGraph.dependencies.map(item => [item.from, item.packageName, item.to]),
      [['apps/api', '@oiol/shared', 'packages/shared']]
    );
    const imported = structure.imports.find(item => item.specifier === '@oiol/shared/logger');
    assert.ok(imported);
    assert.equal(imported.resolved, true);
    assert.equal(imported.to, 'packages/shared/src/logger.ts');
    assert.equal(imported.resolutionKind, 'tsconfig_path_alias');
    assert.ok(imported.evidenceId);
    assert.ok(imported.resolutionConfigEvidenceId);
    assert.match(imported.resolutionConfigSourceSha256, /^[a-f0-9]{64}$/);
    assert.match(imported.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(imported.excerptSha256, /^[a-f0-9]{64}$/);
    assert.equal(structure.evidenceCoverage.fingerprintedFindingRate, 1);
    assert.equal(structure.evidenceCoverage.aliasConfigFingerprintRate, 1);
    assert.ok(structure.workspaceGraph.diagnostics.some(item => item.kind === 'workspace_dependency_target_not_found' && item.packageName === '@oiol/missing'));
    assert.ok(structure.workspaceGraph.dependencies[0].fromEvidenceId);
    assert.ok(structure.workspaceGraph.dependencies[0].toEvidenceId);
  } finally {
    await f.cleanup();
  }
});

test('context budget truncation does not stop bounded structural scanning', async () => {
  const f = await fixture('oiol-context-budget-');
  try {
    await put(f.root, 'src/main.mjs', [
      "import { helper } from './helper.mjs';",
      'export function main() { return helper(); }',
      ''
    ].join('\n'));
    await put(f.root, 'src/helper.mjs', 'export function helper() { return true; }\n');
    const result = await scanRepository(f.root, {
      analysisMode: 'lexical', maxContextChars: 1, maxSourceFiles: 10
    });
    assert.equal(result.contextTruncated, true);
    assert.equal(result.structure.analyzedSourceFileCount, 2);
    assert.ok(result.structure.symbols.some(item => item.name === 'main'));
    assert.ok(result.structure.symbols.some(item => item.name === 'helper'));
    assert.ok(result.structure.imports.some(item => item.specifier === './helper.mjs' && item.resolved));
    assert.equal(result.coverage.selectedSourceFiles, 2);
    assert.equal(result.coverage.contextBudgetIndependentOfStructuralAnalysis, true);
    assert.equal(result.coverage.contextOmittedExcerptCount, result.coverage.selectedFiles);
  } finally {
    await f.cleanup();
  }
});

test('source-file selection cap cannot be exceeded by separately selected test/config files', async () => {
  const f = await fixture('oiol-source-cap-');
  try {
    await put(f.root, 'src/core.js', 'export function core() {}\n');
    await put(f.root, 'tests/extra.test.js', 'export function outsideCap() {}\n');
    const result = await scanRepository(f.root, {
      analysisMode: 'lexical', maxSourceFiles: 1, maxFiles: 20
    });
    assert.equal(result.coverage.sourceCandidates, 2);
    assert.equal(result.coverage.selectedSourceFiles, 1);
    assert.equal(result.structure.analyzedSourceFileCount, 1);
    assert.ok(result.structure.symbols.some(item => item.name === 'core'));
    assert.equal(result.structure.symbols.some(item => item.name === 'outsideCap'), false);
    assert.equal(result.snippets.some(item => item.path === 'tests/extra.test.js'), true);
  } finally {
    await f.cleanup();
  }
});

test('source-file selection limit is explicit and reported as an analysis coverage gap', async () => {
  const f = await fixture('oiol-source-limit-');
  try {
    await put(f.root, 'src/a.js', 'export function a() {}\n');
    await put(f.root, 'src/b.js', 'export function b() {}\n');
    await put(f.root, 'src/c.js', 'export function c() {}\n');
    const result = await scanRepository(f.root, {
      analysisMode: 'lexical', maxSourceFiles: 2, maxFiles: 20
    });
    assert.equal(result.coverage.sourceCandidates, 3);
    assert.equal(result.coverage.selectedSourceFiles, 2);
    assert.equal(result.coverage.sourceFilesOmittedBySelectionLimit, 1);
    assert.equal(result.structure.analyzedSourceFileCount, 2);
  } finally {
    await f.cleanup();
  }
});
