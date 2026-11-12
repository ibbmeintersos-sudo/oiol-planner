#!/usr/bin/env node
// P13: compare two real-world benchmark reports against the frozen P12 rules.
// Per dimension: regression = F1 drops > 0.005 or both precision and recall
// drop; improvement = F1 rises > 0.005; neutral = within +-0.005.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const option = (name, fallback = null) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};

const EPSILON = 0.005;
const round4 = value => Math.round(value * 10000) / 10000;

function classify(before, after) {
  const deltaPrecision = (after.precision ?? 0) - (before.precision ?? 0);
  const deltaRecall = (after.recall ?? 0) - (before.recall ?? 0);
  const deltaF1 = (after.f1 ?? 0) - (before.f1 ?? 0);
  if (deltaF1 < -EPSILON || (deltaPrecision < 0 && deltaRecall < 0)) return 'regression';
  if (deltaF1 > EPSILON) return 'improvement';
  return 'neutral';
}

async function main() {
  const beforePath = option('before');
  const afterPath = option('after');
  const outPath = option('out');
  if (!beforePath || !afterPath) {
    console.error('usage: node scripts/compare-real-world-scores.mjs --before <json> --after <json> [--out <json>]');
    process.exitCode = 2;
    return;
  }
  const before = JSON.parse(await fs.readFile(beforePath, 'utf8'));
  const after = JSON.parse(await fs.readFile(afterPath, 'utf8'));
  const names = Object.keys(after.dimensions || {});
  const rows = [];
  for (const name of names) {
    const b = before.dimensions?.[name] || {};
    const a = after.dimensions?.[name] || {};
    rows.push({
      dimension: name,
      before: b,
      after: a,
      delta: {
        precision: round4((a.precision ?? 0) - (b.precision ?? 0)),
        recall: round4((a.recall ?? 0) - (b.recall ?? 0)),
        f1: round4((a.f1 ?? 0) - (b.f1 ?? 0))
      },
      verdict: classify(b, a)
    });
  }
  const overall = rows.some(row => row.verdict === 'regression') ? 'regression'
    : rows.some(row => row.verdict === 'improvement') ? 'improvement' : 'neutral';

  console.log('P13 score comparison');
  console.log('before: ' + beforePath + ' (caseCount ' + (before.caseCount ?? '?') + ')');
  console.log('after:  ' + afterPath + ' (caseCount ' + (after.caseCount ?? '?') + ')');
  console.log('');
  const fmt = value => value === null || value === undefined ? '    n/a' : value.toFixed(4);
  console.log('dimension         | P before | P after | R before | R after | F1 before | F1 after | verdict');
  console.log('------------------|----------|---------|----------|---------|-----------|----------|----------');
  for (const row of rows) {
    console.log(row.dimension.padEnd(17) + ' |'
      + '  ' + fmt(row.before.precision) + ' | ' + fmt(row.after.precision)
      + ' |  ' + fmt(row.before.recall) + ' | ' + fmt(row.after.recall)
      + ' |    ' + fmt(row.before.f1) + ' |  ' + fmt(row.after.f1)
      + ' | ' + row.verdict);
  }
  console.log('');
  console.log('overall: ' + overall);

  if (outPath) {
    const target = path.resolve(outPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({
      generatedAt: new Date().toISOString(),
      before: beforePath,
      after: afterPath,
      overall,
      dimensions: rows
    }, null, 2) + '\n');
    console.log('wrote ' + target);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
