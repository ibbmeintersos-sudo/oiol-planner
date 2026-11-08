import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBenchmarkModes } from '../scripts/compare-benchmark-modes.mjs';

const oi={benchmarkMode:'oiol',runId:'oi-1',comparisonKey:'qwen-test',budgetKey:'budget-1',reviewer:{provider:'openai-compatible',model:'model-a',baseUrl:'https://api.example/v1'},summary:{averageScore:90,passCount:2},scores:[
 {scenarioId:'GF-API-001',score:95,blockers:[]},{scenarioId:'AMB-AUTH-005',score:85,blockers:[]}
]};
const base={benchmarkMode:'opencode-baseline',runId:'base-1',comparisonKey:'qwen-test',budgetKey:'budget-1',reviewer:{provider:'openai-compatible',model:'model-a',baseUrl:'https://api.example/v1'},summary:{averageScore:80,passCount:1},scores:[
 {scenarioId:'GF-API-001',score:80,blockers:['missing criterion']},{scenarioId:'AMB-AUTH-005',score:80,blockers:[]}
]};

test('paired comparison computes per-scenario and aggregate score deltas',()=>{
 const result=compareBenchmarkModes(oi,base);
 assert.equal(result.averageScoreDelta,10);
 assert.equal(result.medianScoreDelta,10);
 assert.deepEqual(result.scenarioResults.map(x=>x.delta),[5,15]);
 assert.equal(result.reviewerComparable,true);
 assert.equal(compareBenchmarkModes(oi,{...base,reviewer:{provider:'anthropic',model:'other',baseUrl:'https://different.example'}}).reviewerComparable,false);
});

test('paired comparison rejects mismatched model or resource attestation keys',()=>{
 assert.throws(()=>compareBenchmarkModes({...oi,comparisonKey:'other'},base),/COMPARISON_KEY/);
 assert.throws(()=>compareBenchmarkModes({...oi,budgetKey:'other'},base),/BUDGET_KEY/);
});

test('paired comparison rejects different scenario sets and wrong benchmark modes',()=>{
 assert.throws(()=>compareBenchmarkModes(oi,{...base,scores:base.scores.slice(0,1)}),/exactly the same scenario IDs/);
 assert.throws(()=>compareBenchmarkModes(base,oi),/First input must be an OIOL/);
});

test('external paired comparison rejects different repository commits',()=>{
 const externalO={...oi,sourceMode:'external-local-checkout',repositorySnapshot:{allGitCommitsDetected:true,commitShas:['a'.repeat(40)]}};
 const externalB={...base,sourceMode:'external-local-checkout',repositorySnapshot:{allGitCommitsDetected:true,commitShas:['b'.repeat(40)]}};
 assert.throws(()=>compareBenchmarkModes(externalO,externalB),/exact same repository commit SHA set/);
});

test('external paired comparison accepts the same clean pinned commit',()=>{
 const snapshot={allGitCommitsDetected:true,commitShas:['c'.repeat(40)]};
 const result=compareBenchmarkModes(
  {...oi,sourceMode:'external-local-checkout',repositorySnapshot:snapshot},
  {...base,sourceMode:'external-local-checkout',repositorySnapshot:snapshot}
 );
 assert.equal(result.sourceMode,'external-local-checkout');
 assert.deepEqual(result.repositorySnapshot,snapshot);
});

test('paired comparison rejects mixing fixture and external repository modes',()=>{
 assert.throws(()=>compareBenchmarkModes(
  {...oi,sourceMode:'checked-in-fixtures'},
  {...base,sourceMode:'external-local-checkout',repositorySnapshot:{allGitCommitsDetected:true,commitShas:['d'.repeat(40)]}}
 ),/same repository source mode/);
});
