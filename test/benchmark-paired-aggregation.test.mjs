import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePairedComparisons } from '../scripts/aggregate-paired-comparisons.mjs';

const make=(n,delta,reviewerComparable=true)=>({oiolRunId:'oi-'+n,baselineRunId:'base-'+n,comparisonKey:'same-model',budgetKey:'same-budget',averageScoreDelta:delta,reviewerComparable,scenarioResults:[{scenarioId:'A',delta},{scenarioId:'B',delta:delta-2}]});

test('paired aggregation reports median deltas across three repeated comparisons',()=>{
 const result=aggregatePairedComparisons([make(1,10),make(2,6),make(3,8)]);
 assert.equal(result.pairedRunCount,3);
 assert.equal(result.repeatGateMet,true);
 assert.equal(result.averageDelta.median,8);
 assert.equal(result.scenarioResults[0].median,8);
 assert.equal(result.readyForHumanAdjudication,true);
});

test('paired aggregation blocks readiness when reviewer setups differ',()=>{
 const result=aggregatePairedComparisons([make(1,10,false),make(2,6),make(3,8)]);
 assert.equal(result.repeatGateMet,true);
 assert.equal(result.reviewerComparable,false);
 assert.equal(result.readyForHumanAdjudication,false);
});

test('paired aggregation rejects mismatched model, budget, or scenario sets',()=>{
 assert.throws(()=>aggregatePairedComparisons([make(1,10),{...make(2,6),comparisonKey:'other'}]),/comparison key/);
 assert.throws(()=>aggregatePairedComparisons([make(1,10),{...make(2,6),budgetKey:'other'}]),/budget key/);
 assert.throws(()=>aggregatePairedComparisons([make(1,10),{...make(2,6),scenarioResults:[{scenarioId:'A',delta:4}]}]),/same scenario IDs/);
});
