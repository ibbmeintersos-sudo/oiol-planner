import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepository } from '../src/scanner/repository.mjs';
import { runScannerAccuracyBenchmark } from '../benchmarks/scanner-accuracy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('scanner defaults to bounded lexical analysis when optional Tree-sitter is absent', async () => {
  const result = await scanRepository(path.join(ROOT, 'benchmarks/fixtures/scanner-adversarial'));
  assert.equal(result.structure.analysisMode, 'auto');
  assert.equal(result.structure.astRuntimeAvailable, false);
  assert.equal(result.structure.astFileCount, 0);
  assert.ok(result.structure.lexicalFallbackFileCount > 0);
  assert.equal(result.structure.lexicalFallbackFileCount, result.structure.analyzedSourceFileCount);
  assert.match(result.structure.astRuntimeLoadError || result.structure.analysisNotes.join(' '), /Tree-sitter|runtime|grammar|AST/i);
});

test('scanner accuracy benchmark remains available without the optional AST package', async () => {
  const report = await runScannerAccuracyBenchmark();
  assert.equal(report.modes.auto.astRuntimeAvailable, false);
  assert.equal(report.modes.auto.astFileCount, 0);
  assert.ok(report.modes.auto.lexicalFallbackFileCount > 0);
  assert.ok(Number.isFinite(report.modes.auto.symbols.precision));
  assert.ok(Number.isFinite(report.modes.auto.imports.recall));
});
