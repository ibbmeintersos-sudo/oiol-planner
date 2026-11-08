import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePairedComparisons } from '../scripts/aggregate-paired-comparisons.mjs';
import { scenarios } from '../benchmarks/scenarios.mjs';

const make=(n,delta,reviewerComparable=true)=>({oiolRunId:'oi-'+n,baselineRunId:'base-'+n,comparisonKey:'same-model',budgetKey:'same-budget',averageScoreDelta:delta,reviewerComparable,scenarioResults:scenarios.map((scenario,index)=>({scenarioId:scenario.id,delta:delta-index}))});

test('paired aggregation reports median deltas across three repeated comparisons',()=>{
 const result=aggregatePairedComparisons([make(1,10),make(2,6),make(3,8)]);
 assert.equal(result.pairedRunCount,3);
 assert.equal(result.repeatGateMet,true);
 assert.equal(result.averageDelta.median,8);
 assert.equal(result.scenarioResults[0].median,4);
 assert.equal(result.completeSuiteCoverage,true);
 assert.equal(result.readyForHumanAdjudication,true);
});

test('paired aggregation blocks readiness when reviewer setups differ',()=>{
 const result=aggregatePairedComparisons([make(1,10,false),make(2,6),make(3,8)]);
 assert.equal(result.repeatGateMet,true);
 assert.equal(result.reviewerComparable,false);
 assert.equal(result.completeSuiteCoverage,true);
 assert.equal(result.readyForHumanAdjudication,false);
});

test('paired aggregation rejects mismatched model, budget, or scenario sets',()=>{
 assert.throws(()=>aggregatePairedComparisons([make(1,10),{...make(2,6),comparisonKey:'other'}]),/comparison key/);
 assert.throws(()=>aggregatePairedComparisons([make(1,10),{...make(2,6),budgetKey:'other'}]),/budget key/);
 assert.throws(()=>aggregatePairedComparisons([make(1,10),{...make(2,6),scenarioResults:[{scenarioId:'A',delta:4}]}]),/same scenario IDs/);
});

const makeExternal=(n,delta,overrides={})=>({
 ...make(n,delta),
 sourceMode:'external-local-checkout',
 repositorySnapshot:{allGitCommitsDetected:true,commitShas:['a'.repeat(40)]},
 taskDefinition:{id:'RW-REPEAT-001',version:'1.0.0',sha256:'b'.repeat(64)},
 runConfigFingerprints:{oiol:'oiol-config-fingerprint',baseline:'baseline-config-fingerprint'},
 ...overrides
});

test('external paired aggregation preserves one repository snapshot, task, and config across repeats',()=>{
 const result=aggregatePairedComparisons([makeExternal(1,8),makeExternal(2,7),makeExternal(3,9)]);
 assert.equal(result.sourceMode,'external-local-checkout');
 assert.deepEqual(result.repositorySnapshot.commitShas,['a'.repeat(40)]);
 assert.equal(result.taskDefinition.sha256,'b'.repeat(64));
 assert.equal(result.readyForHumanAdjudication,true);
});

test('external paired aggregation rejects a repository commit change between repeats',()=>{
 assert.throws(()=>aggregatePairedComparisons([
  makeExternal(1,8),makeExternal(2,7),
  makeExternal(3,9,{repositorySnapshot:{allGitCommitsDetected:true,commitShas:['c'.repeat(40)]}})
 ]),/same repository commit SHA set/);
});

test('external paired aggregation rejects task or model configuration drift',()=>{
 assert.throws(()=>aggregatePairedComparisons([
  makeExternal(1,8),makeExternal(2,7),
  makeExternal(3,9,{taskDefinition:{id:'RW-OTHER',version:'1.0.0',sha256:'d'.repeat(64)}})
 ]),/same versioned task definition/);
 assert.throws(()=>aggregatePairedComparisons([
  makeExternal(1,8),makeExternal(2,7),
  makeExternal(3,9,{runConfigFingerprints:{oiol:'different',baseline:'baseline-config-fingerprint'}})
 ]),/same OIOL and OpenCode run configuration fingerprints/);
});

test('external paired aggregation rejects mixed fixture and external sources',()=>{
 assert.throws(()=>aggregatePairedComparisons([
  makeExternal(1,8),make(2,7),makeExternal(3,9)
 ]),/same repository source mode/);
});
