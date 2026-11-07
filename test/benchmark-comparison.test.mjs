import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBenchmarkModes } from '../scripts/compare-benchmark-modes.mjs';

const oi={executionMode:'oiol',runId:'oi-1',comparisonKey:'qwen-test',budgetKey:'budget-1',reviewer:{mode:'same'},summary:{averageScore:90,passCount:2},scores:[
 {scenarioId:'GF-API-001',score:95,blockers:[]},{scenarioId:'AMB-AUTH-005',score:85,blockers:[]}
]};
const base={executionMode:'opencode-baseline',runId:'base-1',comparisonKey:'qwen-test',budgetKey:'budget-1',reviewer:{mode:'same'},summary:{averageScore:80,passCount:1},scores:[
 {scenarioId:'GF-API-001',score:80,blockers:['missing criterion']},{scenarioId:'AMB-AUTH-005',score:80,blockers:[]}
]};

test('paired comparison computes per-scenario and aggregate score deltas',()=>{
 const result=compareBenchmarkModes(oi,base);
 assert.equal(result.averageScoreDelta,10);
 assert.equal(result.medianScoreDelta,10);
 assert.deepEqual(result.scenarioResults.map(x=>x.delta),[15,5]);
 assert.equal(result.reviewerComparable,true);
});

test('paired comparison rejects mismatched model or resource attestation keys',()=>{
 assert.throws(()=>compareBenchmarkModes({...oi,comparisonKey:'other'},base),/COMPARISON_KEY/);
 assert.throws(()=>compareBenchmarkModes({...oi,budgetKey:'other'},base),/BUDGET_KEY/);
});

test('paired comparison rejects different scenario sets and wrong execution modes',()=>{
 assert.throws(()=>compareBenchmarkModes(oi,{...base,scores:base.scores.slice(0,1)}),/exactly the same scenario IDs/);
 assert.throws(()=>compareBenchmarkModes(base,oi),/First input must be an OIOL/);
});
