import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, aggregateHumanReviews } from '../scripts/aggregate-human-reviews.mjs';

const header='scenario_id,category,technical_correctness_1_5,requirement_understanding_1_5,task_decomposition_1_5,acceptance_criteria_1_5,scope_and_safety_1_5,clarification_quality_1_5,overall_1_5,reviewer_id,critical_finding_yes_no,evidence_notes,adjudicated_overall_1_5,adjudication_notes';
const row=(reviewer,overall,critical='no',adjudicated='',notes='')=>['T-1','greenfield',4,4,4,4,4,4,overall,reviewer,critical,'"Plan evidence: task boundaries and acceptance criteria are clear"',adjudicated,notes].join(',');

test('CSV parser supports quoted commas and escaped quotes',()=>{
  const rows=parseCsv('scenario_id,reviewer_id,evidence_notes\nT-1,R1,"Evidence includes, commas and ""quoted text"""\n');
  assert.equal(rows[0].evidence_notes,'Evidence includes, commas and "quoted text"');
});

test('human review gate requires two reviewers and sufficient scores',()=>{
  const report=aggregateHumanReviews(parseCsv(header+'\n'+row('R1',4)+'\n'+row('R2',5)),['T-1']);
  assert.equal(report.completeReviewerCoverage,true);
  assert.equal(report.overallMedian,4.5);
  assert.equal(report.certificationReady,true);
});

test('critical human finding blocks certification regardless of scores',()=>{
  const report=aggregateHumanReviews(parseCsv(header+'\n'+row('R1',5,'yes')+'\n'+row('R2',5)),['T-1']);
  assert.deepEqual(report.criticalScenarios,['T-1']);
  assert.equal(report.certificationReady,false);
});

test('large reviewer disagreement requires documented adjudication',()=>{
  const report=aggregateHumanReviews(parseCsv(header+'\n'+row('R1',1)+'\n'+row('R2',5)),['T-1']);
  assert.deepEqual(report.unresolvedDisagreements,['T-1']);
  assert.equal(report.certificationReady,false);
});

test('adjudication resolves a large disagreement with explicit rationale',()=>{
  const report=aggregateHumanReviews(parseCsv(header+'\n'+row('R1',1)+'\n'+row('R2',5,'no',4,'"Adjudicator reviewed the evidence and documented the consensus"')),['T-1']);
  assert.deepEqual(report.unresolvedDisagreements,[]);
  assert.equal(report.overallMedian,4);
  assert.equal(report.certificationReady,true);
});

test('duplicate reviewer entries and missing evidence are rejected',()=>{
  assert.throws(()=>aggregateHumanReviews(parseCsv(header+'\n'+row('R1',4)+'\n'+row('R1',5)),['T-1']),/Duplicate review/);
  const missing=row('R2',4).replace('Plan evidence: task boundaries and acceptance criteria are clear','');
  assert.throws(()=>aggregateHumanReviews(parseCsv(header+'\n'+row('R1',4)+'\n'+missing),['T-1']),/Evidence notes are required/);
});
