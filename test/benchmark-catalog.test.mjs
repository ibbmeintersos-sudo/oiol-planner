import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../benchmarks/scenarios.mjs';
import { selectScenarios, benchmarkConfigFingerprint } from '../scripts/run-planner-benchmark.mjs';

test('benchmark catalog has six unique versioned scenarios across required categories',()=>{
  assert.equal(scenarios.length,6);
  assert.equal(new Set(scenarios.map(x=>x.id)).size,scenarios.length);
  assert.deepEqual([...new Set(scenarios.map(x=>x.category))].sort(),['ambiguous','existing','greenfield']);
  assert.equal(scenarios.filter(x=>x.category==='greenfield').length,2);
  assert.equal(scenarios.filter(x=>x.category==='existing').length,2);
  assert.equal(scenarios.filter(x=>x.category==='ambiguous').length,2);
});

test('ambiguous cases require explicit blocking clarification signals',()=>{
  for(const scenario of scenarios.filter(x=>x.category==='ambiguous')) {
    assert.equal(scenario.mustClarify,true,scenario.id);
    assert.ok(Array.isArray(scenario.clarificationSignals)&&scenario.clarificationSignals.length>=2,scenario.id);
    assert.ok(scenario.project.constraints.some(x=>/clarif|do not invent|do not assume/i.test(x)),scenario.id);
  }
});

test('existing-project fixtures contain source, manifest, and test evidence',()=>{
  for(const scenario of scenarios.filter(x=>x.category==='existing')) {
    const repo=scenario.project.repository;
    assert.ok(repo&&repo.fileCount>0,scenario.id);
    assert.ok(repo.files.some(x=>x.kind==='source'),scenario.id);
    assert.ok(repo.files.some(x=>x.kind==='manifest'),scenario.id);
    assert.ok(repo.files.some(x=>x.kind==='test'),scenario.id);
    assert.ok(repo.manifests.length>0,scenario.id);
    assert.ok(repo.tests.length>0,scenario.id);
  }
});

test('scenario selection is strict, ordered, and rejects unknown or duplicate IDs',()=>{
  assert.deepEqual(selectScenarios('EX-API-003,GF-API-001').map(x=>x.id),['EX-API-003','GF-API-001']);
  assert.throws(()=>selectScenarios('EX-API-003,DOES-NOT-EXIST'),/Unknown benchmark scenario/);
  assert.throws(()=>selectScenarios('GF-API-001,GF-API-001'),/duplicate/);
  assert.throws(()=>selectScenarios(' , '),/at least one/);
});

test('benchmark configuration fingerprint is stable and changes with configuration',()=>{
  const a={provider:'ollama',model:'qwen2.5:7b',baseUrl:'http://localhost:11434'};
  assert.equal(benchmarkConfigFingerprint(a),benchmarkConfigFingerprint({...a}));
  assert.notEqual(benchmarkConfigFingerprint(a),benchmarkConfigFingerprint({...a,model:'qwen2.5:14b'}));
});
