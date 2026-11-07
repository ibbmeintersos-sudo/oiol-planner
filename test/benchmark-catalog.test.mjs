import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../benchmarks/scenarios.mjs';
import { selectScenarios, benchmarkConfigFingerprint, aggregateUsage, main, resolveScenarioProject, providerConfig } from '../scripts/run-planner-benchmark.mjs';

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

test('usage aggregation normalizes common provider token field names and never invents cost',()=>{
  const result=aggregateUsage([
    {plan:{providerUsage:{planner:{calls:[{usage:{prompt_tokens:100,completion_tokens:25,total_tokens:125}}]},reviewer:{calls:[{usage:{input_tokens:50,output_tokens:10}}]}}}},
    {plan:{providerUsage:{planner:{calls:[{usage:null}]},reviewer:{calls:[]}}}}
  ]);
  assert.equal(result.available,true);
  assert.equal(result.promptTokens,150);
  assert.equal(result.completionTokens,35);
  assert.equal(result.totalTokens,185);
  assert.equal(result.reportedCalls,2);
  assert.equal(result.unreportedCalls,1);
  assert.equal(result.cost,null);
});

test('benchmark dry-run works without credentials and makes no provider calls',async()=>{
  const previousArgv=process.argv,previousKey=process.env.OIOL_API_KEY,previousOptIn=process.env.OIOL_BENCHMARK_ALLOW_LIVE;
  const lines=[];
  const previousLog=console.log;
  try {
    process.argv=['node','run-planner-benchmark.mjs','--scenarios','GF-API-001','--dry-run'];
    delete process.env.OIOL_API_KEY;
    delete process.env.OIOL_BENCHMARK_ALLOW_LIVE;
    console.log=(value)=>lines.push(String(value));
    assert.equal(await main(),0);
    const report=JSON.parse(lines.at(-1));
    assert.equal(report.dryRun,true);
    assert.deepEqual(report.selected,['GF-API-001']);
    assert.equal(report.liveCalls,false);
    assert.equal(report.config.planner.credentialConfigured,false);
  } finally {
    process.argv=previousArgv;
    if(previousKey===undefined) delete process.env.OIOL_API_KEY; else process.env.OIOL_API_KEY=previousKey;
    if(previousOptIn===undefined) delete process.env.OIOL_BENCHMARK_ALLOW_LIVE; else process.env.OIOL_BENCHMARK_ALLOW_LIVE=previousOptIn;
    console.log=previousLog;
  }
});

test('Existing Project benchmark scenarios are analyzed from real fixture repositories',async()=>{
  for(const scenario of scenarios.filter(x=>x.category==='existing')) {
    const project=await resolveScenarioProject(scenario);
    assert.equal(project.kind,'existing');
    assert.ok(project.repository.fileCount>=5,scenario.id);
    assert.ok(project.repository.manifests.some(x=>x.endsWith('package.json')),scenario.id);
    assert.ok(project.repository.tests.length>0,scenario.id);
    assert.ok(project.repository.snippets.some(x=>x.path.endsWith('.mjs')),scenario.id);
    assert.ok(project.repository.context.length>0,scenario.id);
    assert.equal(Object.hasOwn(project,'fixturePath'),false);
  }
});

test('provider defaults use the selected provider endpoint rather than OpenAI for every backend',()=>{
 const previousProvider=process.env.OIOL_PROVIDER,previousBase=process.env.OIOL_BASE_URL,previousModel=process.env.OIOL_MODEL;
 try {
  process.env.OIOL_PROVIDER='ollama';
  delete process.env.OIOL_BASE_URL;
  delete process.env.OIOL_MODEL;
  const config=providerConfig();
  assert.equal(config.baseUrl,'http://127.0.0.1:11434');
  assert.equal(config.model,'qwen2.5:7b');
  process.env.OIOL_PROVIDER='anthropic';
  const anthropic=providerConfig();
  assert.equal(anthropic.baseUrl,'https://api.anthropic.com');
 } finally {
  if(previousProvider===undefined) delete process.env.OIOL_PROVIDER; else process.env.OIOL_PROVIDER=previousProvider;
  if(previousBase===undefined) delete process.env.OIOL_BASE_URL; else process.env.OIOL_BASE_URL=previousBase;
  if(previousModel===undefined) delete process.env.OIOL_MODEL; else process.env.OIOL_MODEL=previousModel;
 }
});
