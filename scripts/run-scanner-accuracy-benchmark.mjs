#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runScannerAccuracyBenchmark } from '../benchmarks/scanner-accuracy.mjs';

function readArg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export async function main() {
  const report = await runScannerAccuracyBenchmark();
  const output = path.resolve(readArg('out', 'benchmarks/results/scanner-accuracy.json'));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    fixtureCount: report.fixtureCount,
    autoAstRuntimeAvailable: report.modes.auto.astRuntimeAvailable,
    autoSymbols: report.modes.auto.symbols,
    autoImports: report.modes.auto.imports,
    lexicalSymbols: report.modes.lexical.symbols,
    lexicalImports: report.modes.lexical.imports,
    output
  }, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Scanner accuracy benchmark error: ' + error.message); process.exitCode = 1; }
}
