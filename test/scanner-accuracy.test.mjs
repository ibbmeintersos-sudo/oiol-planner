import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScannerAccuracyBenchmark } from '../benchmarks/scanner-accuracy.mjs';
import { scanRepository } from '../src/scanner/repository.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('scanner fixture benchmark reports precision, recall, and F1 for AST and lexical modes', async () => {
  const report = await runScannerAccuracyBenchmark();
  assert.equal(report.fixtureCount, 4);
  for (const mode of ['auto', 'lexical']) {
    for (const signal of ['symbols', 'imports']) {
      const result = report.modes[mode][signal];
      for (const metric of ['precision', 'recall', 'f1']) {
        assert.ok(Number.isFinite(result[metric]), mode + ' ' + signal + ' ' + metric);
        assert.ok(result[metric] >= 0 && result[metric] <= 1);
      }
      for (const count of ['truePositive', 'falsePositive', 'falseNegative']) {
        assert.ok(Number.isInteger(result[count]), mode + ' ' + signal + ' ' + count);
      }
    }
  }
  const lexicalAdversarial = report.modes.lexical.fixtures.find(item => item.id === 'scanner-adversarial');
  assert.ok(lexicalAdversarial.symbols.falsePositive >= 1);
  assert.ok(lexicalAdversarial.imports.falsePositive >= 1);
  if (report.modes.auto.astRuntimeAvailable) {
    const astAdversarial = report.modes.auto.fixtures.find(item => item.id === 'scanner-adversarial');
    assert.ok(astAdversarial.symbols.falsePositive < lexicalAdversarial.symbols.falsePositive);
    assert.ok(astAdversarial.imports.falsePositive < lexicalAdversarial.imports.falsePositive);
  }
});

test('scanner can run explicitly in lexical-only mode without invoking AST parsing', async () => {
  const result = await scanRepository(path.join(ROOT, 'benchmarks/fixtures/scanner-adversarial'), { analysisMode: 'lexical' });
  assert.equal(result.structure.analysisMode, 'lexical');
  assert.equal(result.structure.astFileCount, 0);
  assert.equal(result.structure.lexicalFallbackFileCount, result.structure.analyzedSourceFileCount);
  assert.equal(result.scanLimits.analysisMode, 'lexical');
});

test('scanner rejects unknown AST analysis modes', async () => {
  await assert.rejects(
    () => scanRepository(path.join(ROOT, 'benchmarks/fixtures/scanner-adversarial'), { analysisMode: 'semantic' }),
    /analysisMode must be auto or lexical/
  );
});
