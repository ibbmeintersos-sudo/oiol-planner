import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, aggregateHumanReviews } from '../scripts/aggregate-human-reviews.mjs';
import { scenarios } from '../benchmarks/scenarios.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const header='scenario_id,category,technical_correctness_1_5,requirement_understanding_1_5,task_decomposition_1_5,acceptance_criteria_1_5,scope_and_safety_1_5,clarification_quality_1_5,overall_1_5,reviewer_id,highest_finding_severity,evidence_notes,adjudicated_overall_1_5,adjudication_notes';
const row=(reviewer,overall,critical='none',adjudicated='',notes='')=>['T-1','greenfield',4,4,4,4,4,4,overall,reviewer,critical,'"Plan evidence: task boundaries and acceptance criteria are clear"',adjudicated,notes].join(',');

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
  const report=aggregateHumanReviews(parseCsv(header+'\n'+row('R1',5,'critical')+'\n'+row('R2',5)),['T-1']);
  assert.deepEqual(report.criticalScenarios,['T-1']);
  assert.equal(report.certificationReady,false);
});

test('large reviewer disagreement requires documented adjudication',()=>{
  const report=aggregateHumanReviews(parseCsv(header+'\n'+row('R1',1)+'\n'+row('R2',5)),['T-1']);
  assert.deepEqual(report.unresolvedDisagreements,['T-1']);
  assert.equal(report.certificationReady,false);
});

test('adjudication resolves a large disagreement with explicit rationale',()=>{
  const report=aggregateHumanReviews(parseCsv(header+'\n'+row('R1',1)+'\n'+row('R2',5,'none',4,'"Adjudicator reviewed the evidence and documented the consensus"')),['T-1']);
  assert.deepEqual(report.unresolvedDisagreements,[]);
  assert.equal(report.overallMedian,4);
  assert.equal(report.certificationReady,true);
});

test('duplicate reviewer entries and missing evidence are rejected',()=>{
  assert.throws(()=>aggregateHumanReviews(parseCsv(header+'\n'+row('R1',4)+'\n'+row('R1',5)),['T-1']),/Duplicate review/);
  const missing=row('R2',4).replace('Plan evidence: task boundaries and acceptance criteria are clear','');
  assert.throws(()=>aggregateHumanReviews(parseCsv(header+'\n'+row('R1',4)+'\n'+missing),['T-1']),/Evidence notes are required/);
});

test('high severity human finding also blocks certification',()=>{
  const report=aggregateHumanReviews(parseCsv(header+'\n'+row('R1',5,'high')+'\n'+row('R2',5)),['T-1']);
  assert.deepEqual(report.highSeverityScenarios,['T-1']);
  assert.equal(report.certificationReady,false);
});

test('human review CLI aggregates the complete benchmark suite from reviewer CSVs',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'oiol-human-review-cli-'));
  try{
    const csvFile=path.join(root,'reviews.csv');
    const output=path.join(root,'aggregate.json');
    const headerLine=header;
    const lines=[headerLine];
    for(const scenario of scenarios){
      for(const reviewer of ['Reviewer A','Reviewer B']){
        lines.push([scenario.id,scenario.category,4,4,4,4,4,4,4,reviewer,'none','Plan evidence: requirements and task acceptance criteria are explicitly mapped','',''].join(','));
      }
    }
    await writeFile(csvFile,lines.join('\n')+'\n');
    const script=fileURLToPath(new URL('../scripts/aggregate-human-reviews.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[script,'--inputs',csvFile,'--out',output],{encoding:'utf8',env:{PATH:process.env.PATH}});
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(await readFile(output,'utf8'));
    assert.equal(report.reviewCount,scenarios.length*2);
    assert.equal(report.completeReviewerCoverage,true);
    assert.equal(report.certificationReady,true);
  }finally{await rm(root,{recursive:true,force:true});}
});
