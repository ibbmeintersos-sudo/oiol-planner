#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scenarios } from '../benchmarks/scenarios.mjs';

const DIMENSIONS = [
  'technical_correctness_1_5',
  'requirement_understanding_1_5',
  'task_decomposition_1_5',
  'acceptance_criteria_1_5',
  'scope_and_safety_1_5',
  'clarification_quality_1_5',
  'nfr_coverage_1_5',
  'test_strategy_1_5',
  'rollback_strategy_1_5',
  'unknowns_transparency_1_5',
  'risk_estimation_1_5',
  'overall_1_5'
];

export function parseCsv(source) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim());
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column names');
  return rows.filter(values => values.some(value => String(value).trim() !== '')).map(values => {
    const record = {};
    headers.forEach((header, index) => record[header] = values[index] ?? '');
    return record;
  });
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return Number((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
};
function parseScore(value, label, optional = false) {
  if (optional && String(value ?? '').trim() === '') return null;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(label + ' must be an integer from 1 to 5');
  return score;
}
function parseSeverity(value, label) {
  const severity = String(value ?? '').trim().toLowerCase();
  if (['none', 'low', 'medium', 'high', 'critical'].includes(severity)) return severity;
  throw new Error(label + ' must be none, low, medium, high, or critical');
}
const severityRank = value => ['none', 'low', 'medium', 'high', 'critical'].indexOf(value);
const QUALITY_DIMENSIONS = ['nfr_coverage_1_5','test_strategy_1_5','rollback_strategy_1_5','unknowns_transparency_1_5','risk_estimation_1_5'];

export function aggregateHumanReviews(rows, expectedScenarioIds = scenarios.map(item => item.id)) {
  if (!Array.isArray(rows)) throw new Error('Human review rows must be an array');
  const runIds = [...new Set(rows.map(row => String(row.run_id || '').trim() || 'single-run'))].sort();
  if (!runIds.length) runIds.push('single-run');
  const grouped = new Map();
  const unique = new Set();
  let submittedReviewCount = 0;

  for (const [index, row] of rows.entries()) {
    const scenarioId = String(row.scenario_id || '').trim();
    const runId = String(row.run_id || '').trim() || 'single-run';
    const reviewerId = String(row.reviewer_id || '').trim();
    if (!scenarioId) throw new Error('Review row ' + (index + 1) + ' requires scenario_id');
    if (!expectedScenarioIds.includes(scenarioId)) throw new Error('Unknown scenario_id in review row: ' + scenarioId);
    const hasReviewInput = DIMENSIONS.some(dimension => String(row[dimension] ?? '').trim() !== '') ||
      String(row.highest_finding_severity ?? '').trim() !== '' || String(row.evidence_notes ?? '').trim() !== '';
    if (!reviewerId && !hasReviewInput) continue;
    if (!reviewerId) throw new Error('Review row ' + (index + 1) + ' has review data but no reviewer_id');
    const key = scenarioId + '::' + runId + '::' + reviewerId;
    if (unique.has(key)) throw new Error('Duplicate review for scenario ' + scenarioId + ' / run ' + runId + ' by reviewer ' + reviewerId);
    unique.add(key);

    const scores = {};
    for (const dimension of DIMENSIONS) scores[dimension] = parseScore(row[dimension], dimension);
    const highestFindingSeverity = parseSeverity(row.highest_finding_severity, 'highest_finding_severity');
    const evidenceNotes = String(row.evidence_notes || '').trim();
    if (!evidenceNotes) throw new Error('Evidence notes are required for ' + scenarioId + ' / ' + reviewerId);
    const adjudicated = parseScore(row.adjudicated_overall_1_5, 'adjudicated_overall_1_5', true);
    const adjudicationNotes = String(row.adjudication_notes || '').trim();
    if (adjudicated !== null && !adjudicationNotes) throw new Error('Adjudication notes are required when an adjudicated score is supplied');
    submittedReviewCount++;
    const entry = { scenarioId, runId, reviewerId, scores, highestFindingSeverity, evidenceNotes, adjudicated, adjudicationNotes };
    const list = grouped.get(scenarioId + '::' + runId) || [];
    list.push(entry);
    grouped.set(scenarioId + '::' + runId, list);
  }

  const scenarioRunResults = expectedScenarioIds.flatMap(scenarioId => runIds.map(runId => {
    const reviews = grouped.get(scenarioId + '::' + runId) || [];
    const dimensionMedians = Object.fromEntries(DIMENSIONS.map(dimension => [
      dimension, median(reviews.map(review => review.scores[dimension]))
    ]));
    const overallScores = reviews.map(review => review.scores.overall_1_5);
    const spread = overallScores.length ? Math.max(...overallScores) - Math.min(...overallScores) : null;
    const adjudication = reviews.find(review => review.adjudicated !== null);
    const disagreementUnresolved = spread !== null && spread >= 2 && !adjudication;
    const highestFindingSeverity = reviews.reduce((highest, review) =>
      severityRank(review.highestFindingSeverity) > severityRank(highest) ? review.highestFindingSeverity : highest, 'none');
    return {
      scenarioId, runId,
      reviewerCount: new Set(reviews.map(review => review.reviewerId)).size,
      reviewers: reviews.map(review => review.reviewerId),
      dimensionMedians,
      overallMedian: adjudication?.adjudicated ?? dimensionMedians.overall_1_5,
      rawOverallSpread: spread,
      highestFindingSeverity,
      disagreementUnresolved,
      adjudication: adjudication ? { score: adjudication.adjudicated, notes: adjudication.adjudicationNotes } : null
    };
  }));

  const scenarioResults = expectedScenarioIds.map(scenarioId => {
    const runs = scenarioRunResults.filter(item => item.scenarioId === scenarioId);
    const reviews = runs.flatMap(item => grouped.get(scenarioId + '::' + item.runId) || []);
    const dimensionMedians = Object.fromEntries(DIMENSIONS.map(dimension => [
      dimension, median(reviews.map(review => review.scores[dimension]))
    ]));
    const validRunScores = runs.map(item => item.overallMedian).filter(Number.isFinite);
    const highestFindingSeverity = runs.reduce((highest, item) =>
      severityRank(item.highestFindingSeverity) > severityRank(highest) ? item.highestFindingSeverity : highest, 'none');
    return {
      scenarioId,
      runCount: runs.length,
      reviewerCount: runs.length ? Math.min(...runs.map(item => item.reviewerCount)) : 0,
      reviewers: [...new Set(reviews.map(review => review.reviewerId))],
      dimensionMedians,
      overallMedian: median(validRunScores),
      rawOverallSpread: validRunScores.length ? Number((Math.max(...validRunScores) - Math.min(...validRunScores)).toFixed(2)) : null,
      highestFindingSeverity,
      disagreementUnresolved: runs.some(item => item.disagreementUnresolved),
      runs
    };
  });

  const covered = scenarioRunResults.filter(item => item.reviewerCount >= 2).length;
  const expectedCells = expectedScenarioIds.length * runIds.length;
  const unresolvedDisagreements = scenarioRunResults.filter(item => item.disagreementUnresolved)
    .map(item => runIds.length === 1 ? item.scenarioId : item.scenarioId + '::' + item.runId);
  const qualityDimensionFailures = scenarioRunResults.flatMap(item =>
    QUALITY_DIMENSIONS.filter(dimension => Number.isFinite(item.dimensionMedians[dimension]) && item.dimensionMedians[dimension] < 3)
      .map(dimension => ({ scenarioId: item.scenarioId, runId: item.runId, dimension, median: item.dimensionMedians[dimension] }))
  );
  const criticalScenarios = scenarioResults.filter(item => item.highestFindingSeverity === 'critical').map(item => item.scenarioId);
  const highSeverityScenarios = scenarioResults.filter(item => item.highestFindingSeverity === 'high').map(item => item.scenarioId);
  const blockingFindingScenarios = scenarioResults.filter(item => ['high', 'critical'].includes(item.highestFindingSeverity)).map(item => item.scenarioId);
  const overallScores = scenarioResults.map(item => item.overallMedian).filter(Number.isFinite);
  const minimumScenarioScore = overallScores.length ? Math.min(...overallScores) : null;
  const overallMedian = median(overallScores);
  const completeReviewerCoverage = scenarioRunResults.length === expectedCells && covered === expectedCells;
  const certificationReady = completeReviewerCoverage && unresolvedDisagreements.length === 0 && qualityDimensionFailures.length === 0 &&
    blockingFindingScenarios.length === 0 && overallMedian !== null && overallMedian >= 4 && minimumScenarioScore >= 3;

  return {
    protocolVersion: '1.2',
    reviewCount: submittedReviewCount,
    reviewTemplateRowCount: rows.length,
    runCount: runIds.length,
    expectedRunIds: runIds,
    expectedScenarioCount: expectedScenarioIds.length,
    expectedScenarioRunReviewCells: expectedCells,
    scenarioRunsWithAtLeastTwoReviewers: covered,
    completeReviewerCoverage,
    overallMedian,
    minimumScenarioScore,
    unresolvedDisagreements,
    qualityDimensionFailures,
    criticalScenarios,
    highSeverityScenarios,
    blockingFindingScenarios,
    scenarioResults,
    scenarioRunResults,
    certificationReady,
    decision: certificationReady ? 'human_review_gate_passed' : 'human_review_gate_not_met',
    limitations: [
      'Scores are human-entered and depend on reviewer calibration.',
      'For multi-run series, every scenario/run plan requires two distinct blind reviewers; reviewers must use plan_file and plan_scenario_selector.',
      'A high or critical finding blocks certification regardless of average score.',
      'Each P2 quality dimension (NFR, test strategy, rollback, unknowns, and risk estimation) must have a median score of at least 3 for every scenario/run.',
      'Disagreements with an overall score spread of 2 or more require a documented adjudicated score.'
    ]
  };
}

function readArg(name) { const index = process.argv.indexOf('--' + name); return index >= 0 ? process.argv[index + 1] : null; }
export async function main() {
  const inputs = readArg('inputs');
  if (!inputs) throw new Error('Provide --inputs reviewer-a.csv,reviewer-b.csv or a consolidated multi-run CSV');
  const files = inputs.split(',').map(value => value.trim()).filter(Boolean);
  const rows = [];
  for (const file of files) rows.push(...parseCsv(await fs.readFile(path.resolve(file), 'utf8')));
  const report = aggregateHumanReviews(rows);
  const output = path.resolve(readArg('out') || 'benchmarks/results/human-review-aggregate.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    reviewCount: report.reviewCount, runCount: report.runCount,
    scenarioRunsWithAtLeastTwoReviewers: report.scenarioRunsWithAtLeastTwoReviewers,
    overallMedian: report.overallMedian, certificationReady: report.certificationReady, output
  }, null, 2));
  return report.certificationReady ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Human review aggregation error: ' + error.message); process.exitCode = 1; }
}
