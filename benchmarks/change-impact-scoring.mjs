import { analyzeChangeImpact } from '../src/analyzer/change-impact.mjs';
import { changeImpactCases } from './change-impact-cases.mjs';

function setMetrics(expectedValues, actualValues) {
  const expected = new Set(expectedValues);
  const actual = new Set(actualValues);
  const truePositive = [...actual].filter(value => expected.has(value)).length;
  const falsePositive = [...actual].filter(value => !expected.has(value)).length;
  const falseNegative = [...expected].filter(value => !actual.has(value)).length;
  const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : expected.size === 0 ? 1 : 0;
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : expected.size === 0 ? 1 : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return { truePositive, falsePositive, falseNegative, precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)), f1: Number(f1.toFixed(4)), expectedCount: expected.size, actualCount: actual.size };
}

const paths = values => [...new Set((values || []).map(item => typeof item === 'string' ? item : item.path))].sort();
const average = values => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : 0;

export function scoreChangeImpactCase(scenario, result) {
  const expected = scenario.expected;
  const actualDirect = paths(result.directMatches);
  const actualAffected = paths(result.potentiallyAffectedFiles);
  const actualTests = paths(result.affectedTests);
  const actualPackages = paths(result.affectedPackages);
  const dimensions = {
    directFiles: setMetrics(expected.directFiles, actualDirect),
    affectedFiles: setMetrics(expected.affectedFiles, actualAffected),
    affectedTests: setMetrics(expected.testFiles, actualTests),
    affectedPackages: setMetrics(expected.packagePaths, actualPackages)
  };
  if (expected.apiStatus) dimensions.apiStatus = { expected: expected.apiStatus, actual: result.apiContractImpact?.status || 'missing', pass: result.apiContractImpact?.status === expected.apiStatus };
  if (expected.apiConsumerFiles) dimensions.apiConsumers = setMetrics(expected.apiConsumerFiles, paths(result.apiContractImpact?.potentiallyAffectedConsumers));
  const exactStatus = result.status === expected.status;
  const macroF1 = average(Object.values(dimensions).filter(item => typeof item.f1 === 'number').map(item => item.f1));
  return {
    scenarioId: scenario.id,
    category: scenario.category,
    status: result.status,
    expectedStatus: expected.status,
    statusPass: exactStatus,
    dimensions,
    macroF1,
    confidence: result.confidence?.level || 'unknown',
    diagnostics: {
      directMatchCount: actualDirect.length,
      affectedFileCount: actualAffected.length,
      affectedTestCount: actualTests.length,
      affectedPackageCount: actualPackages.length,
      risks: result.risks || [],
      traversalLimits: result.graph?.traversalLimits || null
    },
    pass: exactStatus && Object.values(dimensions).every(item => item.pass === true || (item.f1 ?? 1) >= 0.8)
  };
}

export function runChangeImpactBenchmark(cases = changeImpactCases) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('At least one change-impact benchmark case is required');
  const ids = cases.map(item => item.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Benchmark case IDs must be unique non-empty strings');
  const rows = cases.map(scenario => {
    const result = analyzeChangeImpact({ request: scenario.request, repository: scenario.repository });
    return { ...scoreChangeImpactCase(scenario, result), result };
  });
  const dimensions = ['directFiles','affectedFiles','affectedTests','affectedPackages'];
  const categoryScores = {};
  for (const row of rows) (categoryScores[row.category] ||= []).push(row.macroF1);
  const summary = {
    caseCount: rows.length,
    passCount: rows.filter(row => row.pass).length,
    passRate: Number((rows.filter(row => row.pass).length / rows.length).toFixed(4)),
    macroF1: average(rows.map(row => row.macroF1)),
    byCategory: Object.fromEntries(Object.entries(categoryScores).map(([key, values]) => [key, { caseCount: values.length, macroF1: average(values) }])),
    dimensions: Object.fromEntries(dimensions.map(key => [key, {
      precision: average(rows.map(row => row.dimensions[key].precision)),
      recall: average(rows.map(row => row.dimensions[key].recall)),
      f1: average(rows.map(row => row.dimensions[key].f1))
    }])),
    limitations: [
      'Goldens are small, manually curated synthetic dependency graphs; they are not statistically representative of production repositories.',
      'This benchmark evaluates deterministic Change Impact Analysis separately from LLM plan quality.',
      'A path match or graph edge is evaluated against the authored expected set and does not prove runtime impact.',
      'Passing this benchmark is a regression signal, not certification of semantic completeness or safe implementation.'
    ]
  };
  return { protocolVersion: '1.0.0', benchmark: 'change_impact_analysis', createdAt: new Date().toISOString(), summary, results: rows };
}
