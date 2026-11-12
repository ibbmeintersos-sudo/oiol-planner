#!/usr/bin/env node
// P13 instrumentation: per-case, item-level breakdowns of scanner precision
// losses against the frozen P12 corpora. Read-only with respect to the corpus;
// writes diagnostics under benchmarks/real-world/evaluation-diagnostics/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanRepository } from '../src/scanner/repository.mjs';
import { analyzeChangeImpact } from '../src/analyzer/change-impact.mjs';
import { scoreRealWorldCase } from './run-real-world-benchmark.mjs';

const option = (name, fallback = null) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};

const round4 = value => Math.round(value * 10000) / 10000;
const norm = value => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/\.\//g, '/');
const countBy = (items, keyOf) => {
  const out = new Map();
  for (const item of items) {
    const key = String(keyOf(item) ?? 'unknown');
    out.set(key, (out.get(key) || 0) + 1);
  }
  return Object.fromEntries([...out.entries()].sort((a, b) => b[1] - a[1]));
};

function symbolKey(item) {
  return norm(item.file) + '::' + (item.kind || 'unknown') + '::' + item.name;
}

function edgeKey(item) {
  return norm(item.from) + ' -> ' + norm(item.to);
}

function breakdownFor(item, repository, impact, scored) {
  const truth = item.groundTruth || {};
  const structure = repository.structure || {};
  const walked = new Set((repository.files || []).map(entry => norm(entry.path)));
  const symbols = structure.symbols || [];
  const edges = structure.dependencyGraph?.edges || [];
  const expectedSymbolKeys = new Set((truth.scannerSymbols || []).map(symbolKey));
  const expectedEdgeKeys = new Set((truth.dependencyEdges || []).map(edgeKey));

  const symbolFalsePositives = symbols.filter(item2 => !expectedSymbolKeys.has(symbolKey(item2)));
  const emittedKinds = new Set(symbols.map(item2 => item2.kind).filter(Boolean));
  const gtStructurallyUnmatchable = (truth.scannerSymbols || [])
    .filter(item2 => item2.kind !== 'unknown' && !emittedKinds.has(item2.kind))
    .map(symbolKey);
  const symbolsBreakdown = {
    actualCount: symbols.length,
    fpByKind: countBy(symbolFalsePositives, item2 => item2.kind),
    fpBySource: countBy(symbolFalsePositives, item2 => item2.source),
    fpTopNames: Object.entries(countBy(symbolFalsePositives, item2 => (item2.kind || '?') + ':' + item2.name)).slice(0, 15).map(([key, value]) => key + ' x' + value),
    tp: scored.dimensions.scannerSymbols.tp,
    fp: scored.dimensions.scannerSymbols.fp,
    fn: scored.dimensions.scannerSymbols.fn,
    emittedKinds: [...emittedKinds].sort(),
    gtStructurallyUnmatchableCount: gtStructurallyUnmatchable.length,
    gtStructurallyUnmatchableSample: gtStructurallyUnmatchable.slice(0, 20)
  };

  const edgeFalsePositives = edges.filter(item2 => !expectedEdgeKeys.has(edgeKey(item2)));
  const unresolved = structure.pathAliases?.unresolvedImports
    || (structure.imports || []).filter(item2 => !item2.resolved)
    || [];
  const jsSpecifierTsSiblings = [];
  for (const entry of unresolved) {
    const specifier = entry.specifier || entry.request || entry.import || '';
    const from = norm(entry.from || entry.file || '');
    if (!/\.(js|mjs|cjs)$/.test(specifier)) continue;
    const base = specifier.replace(/\.(js|mjs|cjs)$/, '');
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const stem = norm(dir ? dir + '/' + base : base).replace(/^\.\//, '').replace(/^(\.\.\/)+/, '');
    const hit = walked.has(stem + '.ts') || walked.has(stem + '.tsx')
      || walked.has(stem + '/index.ts') || walked.has(stem + '/index.tsx');
    if (hit) jsSpecifierTsSiblings.push({ from, specifier, tsCandidate: stem + '.ts' });
  }
  const gtEdges = truth.dependencyEdges || [];
  const edgesBreakdown = {
    actualCount: edges.length,
    fpByResolutionKind: countBy(edgeFalsePositives, item2 => item2.resolutionKind),
    fpByResolution: countBy(edgeFalsePositives, item2 => item2.resolution),
    tp: scored.dimensions.dependencyEdges.tp,
    fp: scored.dimensions.dependencyEdges.fp,
    fn: scored.dimensions.dependencyEdges.fn,
    jsSpecifierTsSiblingCount: jsSpecifierTsSiblings.length,
    jsSpecifierTsSiblingSample: jsSpecifierTsSiblings.slice(0, 20),
    gtEndpointCoverage: {
      fromMissingInWalk: gtEdges.filter(item2 => !walked.has(norm(item2.from))).length,
      toMissingInWalk: gtEdges.filter(item2 => !walked.has(norm(item2.to))).length,
      expectedEdgeCount: gtEdges.length
    }
  };

  const direct = impact.directMatches || [];
  const expectedDirect = new Set((truth.directFiles || []).map(norm));
  const gtHitTermCounts = direct.filter(item2 => expectedDirect.has(norm(item2.path))).map(item2 => item2.matchedTerms?.length || 0);
  const directBreakdown = {
    matchCount: direct.length,
    termCountHistogram: countBy(direct, item2 => Math.min(4, item2.matchedTerms?.length || 0)),
    signalsHistogram: countBy(direct, item2 => (item2.signals || []).join('+')),
    gtCoverage: {
      expectedCount: (truth.directFiles || []).length,
      presentInWalkedFiles: (truth.directFiles || []).filter(item2 => walked.has(norm(item2))).length
    },
    gtHitMatchedTermCounts: gtHitTermCounts,
    tp: scored.dimensions.directFiles.tp,
    fp: scored.dimensions.directFiles.fp,
    fn: scored.dimensions.directFiles.fn,
    sample: direct.slice(0, 10).map(item2 => ({ path: item2.path, score: item2.score, terms: item2.matchedTerms, signals: item2.signals }))
  };

  const affected = impact.potentiallyAffectedFiles || [];
  const expectedAffected = new Set((truth.affectedFiles || []).map(norm));
  const affectedBreakdown = {
    matchCount: affected.length,
    truncated: Boolean(impact.affectedFilesTruncated),
    depthHistogram: countBy(affected, item2 => item2.depth ?? -1),
    propagationHistogram: countBy(affected, item2 => item2.propagation),
    gtHitDepth: affected.filter(item2 => expectedAffected.has(norm(item2.path))).map(item2 => item2.depth ?? -1),
    tp: scored.dimensions.affectedFiles.tp,
    fp: scored.dimensions.affectedFiles.fp,
    fn: scored.dimensions.affectedFiles.fn
  };

  const tests = impact.affectedTests || [];
  const testsBreakdown = {
    matchCount: tests.length,
    byAssociation: countBy(tests, item2 => item2.association || item2.reason || item2.propagation),
    byConfidence: countBy(tests, item2 => item2.confidence),
    overlapTermHistogram: countBy(
      tests.filter(item2 => /test_path_name_overlap/.test(item2.association || item2.reason || '')),
      item2 => Math.min(4, item2.matchedTerms?.length || 0)
    ),
    tp: scored.dimensions.tests.tp,
    fp: scored.dimensions.tests.fp,
    fn: scored.dimensions.tests.fn,
    sample: tests.slice(0, 10).map(item2 => ({ path: item2.path, confidence: item2.confidence, association: item2.association || item2.reason || item2.propagation, terms: item2.matchedTerms }))
  };

  return {
    repository: item.repository || item.source?.repository || null,
    scan: {
      fileCount: repository.fileCount,
      truncated: repository.truncated,
      depthTruncated: repository.depthTruncated,
      languages: structure.languages || {}
    },
    symbols: symbolsBreakdown,
    edges: edgesBreakdown,
    directFiles: directBreakdown,
    affectedFiles: affectedBreakdown,
    tests: testsBreakdown
  };
}

function dimensionAverages(rows) {
  const names = Object.keys(rows[0]?.dimensions || {});
  const out = {};
  for (const name of names) {
    const values = rows.map(row => row.dimensions[name]);
    out[name] = {
      precision: round4(values.reduce((sum, item) => sum + item.precision, 0) / values.length),
      recall: round4(values.reduce((sum, item) => sum + item.recall, 0) / values.length),
      f1: round4(values.reduce((sum, item) => sum + item.f1, 0) / values.length)
    };
  }
  return out;
}

function compareDimensions(baseline, measured) {
  const rows = [];
  for (const name of Object.keys(measured)) {
    const b = baseline[name] || {};
    const a = measured[name];
    const deltaPrecision = round4(a.precision - (b.precision ?? 0));
    const deltaRecall = round4(a.recall - (b.recall ?? 0));
    const deltaF1 = round4(a.f1 - (b.f1 ?? 0));
    const verdict = deltaF1 < -0.005 || (deltaPrecision < 0 && deltaRecall < 0) ? 'regression'
      : deltaF1 > 0.005 ? 'improvement' : 'neutral';
    rows.push({ dimension: name, baseline: b, measured: a, delta: { precision: deltaPrecision, recall: deltaRecall, f1: deltaF1 }, verdict });
  }
  return {
    generatedAt: new Date().toISOString(),
    gate0: rows.every(row => row.verdict === 'neutral') ? 'PASS' : 'DRIFT',
    note: 'Gate-0 passes only when every dimension stays within +-0.005 F1 of the frozen P12 baseline.',
    dimensions: rows
  };
}

function offenderRanking(rows) {
  const names = Object.keys(rows[0]?.dimensions || {});
  const dimensions = {};
  for (const name of names) {
    const sortedByFp = [...rows].sort((a, b) => b.dimensions[name].fp - a.dimensions[name].fp);
    const sortedByFn = [...rows].sort((a, b) => b.dimensions[name].fn - a.dimensions[name].fn);
    dimensions[name] = {
      topFalsePositives: sortedByFp.slice(0, 5).map(row => ({ caseId: row.caseId, fp: row.dimensions[name].fp })),
      topFalseNegatives: sortedByFn.slice(0, 5).map(row => ({ caseId: row.caseId, fn: row.dimensions[name].fn }))
    };
  }
  return { generatedAt: new Date().toISOString(), dimensions };
}

async function main() {
  const corpusRoot = path.resolve(option('corpus-root', '.p12-corpus'));
  const baselinePath = path.resolve(option('baseline', 'benchmarks/real-world/adjudication/real-world-benchmark.json'));
  const outRoot = path.resolve(option('out', 'benchmarks/real-world/evaluation-diagnostics'));
  const maxFiles = Number(option('max-files', 250));
  const maxDepth = Number(option('max-depth', 12));
  const maxSourceFiles = Number(option('max-source-files', 100));
  const analysisMode = option('analysis-mode', 'auto');

  const manifest = JSON.parse(await fs.readFile(path.join(corpusRoot, 'manifest.json'), 'utf8'));
  const rows = [];
  for (const record of manifest.cases) {
    const item = JSON.parse(await fs.readFile(path.resolve(corpusRoot, record.caseFile), 'utf8'));
    const snapshotPath = path.resolve(corpusRoot, item.snapshot.relativePath);
    const repository = await scanRepository(snapshotPath, { maxFiles, maxDepth, maxSourceFiles, analysisMode });
    const impact = analyzeChangeImpact({ request: item.change.request, repository });
    const scored = scoreRealWorldCase(item, repository, impact);
    rows.push({
      caseId: item.caseId,
      dimensions: scored.dimensions,
      breakdown: breakdownFor(item, repository, impact, scored)
    });
    console.log('DIAGNOSED ' + item.caseId);
  }

  const measured = dimensionAverages(rows);
  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  const comparison = compareDimensions(baseline.dimensions || {}, measured);
  const ranking = offenderRanking(rows);

  await fs.mkdir(path.join(outRoot, 'case-diagnostics'), { recursive: true });
  for (const row of rows) {
    await fs.writeFile(
      path.join(outRoot, 'case-diagnostics', row.caseId + '.json'),
      JSON.stringify({ caseId: row.caseId, dimensions: row.dimensions, breakdown: row.breakdown }, null, 2) + '\n'
    );
  }
  await fs.writeFile(path.join(outRoot, 'offender-rank.json'), JSON.stringify(ranking, null, 2) + '\n');
  await fs.writeFile(path.join(outRoot, 'baseline-comparison.json'), JSON.stringify(comparison, null, 2) + '\n');
  console.log('DONE cases=' + rows.length + ' gate0=' + comparison.gate0 + ' out=' + outRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
