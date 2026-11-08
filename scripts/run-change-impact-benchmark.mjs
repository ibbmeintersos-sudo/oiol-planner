#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runChangeImpactBenchmark } from '../benchmarks/change-impact-scoring.mjs';

function arg(name, fallback) { const index = process.argv.indexOf('--' + name); return index >= 0 ? process.argv[index + 1] : fallback; }
export async function main() {
  const report = runChangeImpactBenchmark();
  const output = path.resolve(arg('out', 'benchmarks/results/change-impact-benchmark.json'));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.summary, output }, null, 2));
  return report.summary.passCount === report.summary.caseCount ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Change impact benchmark error: ' + error.message); process.exitCode = 1; }
}
