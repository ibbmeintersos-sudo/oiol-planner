import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepository } from '../src/scanner/repository.mjs';
import { scannerGoldens } from './scanner-goldens.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function keyOfSymbol(item) {
  return [item.file, item.kind, item.name].join('::');
}
function keyOfImport(item) {
  return [item.from, item.specifier].join('::');
}
function keyOfWorkspaceDependency(item) {
  return [item.from, item.packageName, item.to].join('::');
}
function countMetrics(expectedValues, actualValues) {
  const expected = new Set(expectedValues);
  const actual = new Set(actualValues);
  let truePositive = 0;
  for (const value of actual) if (expected.has(value)) truePositive++;
  const falsePositive = actual.size - truePositive;
  const falseNegative = expected.size - truePositive;
  const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 1;
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 1;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return {
    truePositive, falsePositive, falseNegative,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4))
  };
}
function addCounts(target, metrics) {
  target.truePositive += metrics.truePositive;
  target.falsePositive += metrics.falsePositive;
  target.falseNegative += metrics.falseNegative;
}
function finishCounts(counts) {
  const precision = counts.truePositive + counts.falsePositive
    ? counts.truePositive / (counts.truePositive + counts.falsePositive) : 1;
  const recall = counts.truePositive + counts.falseNegative
    ? counts.truePositive / (counts.truePositive + counts.falseNegative) : 1;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return {
    ...counts,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4))
  };
}

export async function runScannerAccuracyBenchmark() {
  const modes = ['auto', 'lexical'];
  const modeResults = {};
  for (const mode of modes) {
    const totals = {
      symbols: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
      imports: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
      workspaceDependencies: { truePositive: 0, falsePositive: 0, falseNegative: 0 }
    };
    const fixtures = [];
    let astFileCount = 0;
    let lexicalFallbackFileCount = 0;
    let astRuntimeAvailable = false;

    for (const golden of scannerGoldens) {
      const root = path.join(REPO_ROOT, golden.fixturePath);
      const scan = await scanRepository(root, { analysisMode: mode });
      const structure = scan.structure;
      const actualSymbols = (structure.symbols || [])
        .filter(item => item.kind === 'function')
        .map(keyOfSymbol);
      const expectedSymbols = golden.symbols.map(item => item.join('::'));
      const actualImports = (structure.imports || []).map(keyOfImport);
      const expectedImports = golden.imports.map(item => item.join('::'));
      const actualWorkspaceDependencies = (structure.workspaceGraph?.dependencies || []).map(keyOfWorkspaceDependency);
      const expectedWorkspaceDependencies = (golden.workspaceDependencies || []).map(item => item.join('::'));
      const symbolMetrics = countMetrics(expectedSymbols, actualSymbols);
      const importMetrics = countMetrics(expectedImports, actualImports);
      const workspaceMetrics = countMetrics(expectedWorkspaceDependencies, actualWorkspaceDependencies);
      addCounts(totals.symbols, symbolMetrics);
      addCounts(totals.imports, importMetrics);
      addCounts(totals.workspaceDependencies, workspaceMetrics);
      astFileCount += structure.astFileCount || 0;
      lexicalFallbackFileCount += structure.lexicalFallbackFileCount || 0;
      astRuntimeAvailable ||= Boolean(structure.astRuntimeAvailable);
      fixtures.push({
        id: golden.id,
        scannedSourceFiles: structure.analyzedSourceFileCount,
        astFileCount: structure.astFileCount,
        lexicalFallbackFileCount: structure.lexicalFallbackFileCount,
        symbols: symbolMetrics,
        imports: importMetrics,
        workspaceDependencies: workspaceMetrics
      });
    }

    modeResults[mode] = {
      astRuntimeAvailable,
      astFileCount,
      lexicalFallbackFileCount,
      symbols: finishCounts(totals.symbols),
      imports: finishCounts(totals.imports),
      workspaceDependencies: finishCounts(totals.workspaceDependencies),
      fixtures
    };
  }

  return {
    protocolVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    fixtureCount: scannerGoldens.length,
    groundTruthSource: 'benchmarks/scanner-goldens.mjs; manually reviewed expectations',
    measuredSignals: [
      'named function declarations',
      'import specifiers',
      'manifest-declared workspace package dependencies'
    ],
    modes: modeResults,
    interpretation: {
      precision: 'true positives / (true positives + false positives)',
      recall: 'true positives / (true positives + false negatives)',
      f1: 'harmonic mean of precision and recall',
      limits: [
        'The goldens cover selected named function declarations, import specifiers, and declared workspace package dependencies.',
        'These compact fixtures are not representative of production repositories or every supported language.',
        'Auto mode uses Tree-sitter when the optional runtime and grammar are available, otherwise bounded lexical fallback.',
        'Workspace edges represent manifest declarations; they do not prove runtime package use.',
        'Scores do not measure type resolution, runtime behavior, dynamic imports, or architectural reasoning.'
      ]
    }
  };
}
