import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { scenarios } from '../benchmarks/scenarios.mjs';
import { scanExternalRepository } from '../scripts/run-external-corpus-scan.mjs';
import { selectScenarios, benchmarkConfigFingerprint, aggregateUsage, main, resolveScenarioProject, summarizeRepositoryEvidence, providerConfig, assertExternalRepositorySnapshot, applyScenarioTaskFile } from '../scripts/run-planner-benchmark.mjs';

test('benchmark catalog has six unique versioned scenarios across required categories',()=>{
  assert.equal(scenarios.length,10);
  assert.equal(new Set(scenarios.map(x=>x.id)).size,scenarios.length);
  assert.deepEqual([...new Set(scenarios.map(x=>x.category))].sort(),['ambiguous','existing','greenfield']);
  assert.equal(scenarios.filter(x=>x.category==='greenfield').length,4);
  assert.equal(scenarios.filter(x=>x.category==='existing').length,3);
  assert.equal(scenarios.filter(x=>x.category==='ambiguous').length,3);
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
    {plan:{providerUsage:{planner:{calls:[{usage:null},{usage:{promptTokenCount:20,candidatesTokenCount:5,totalTokenCount:25}}]},reviewer:{calls:[]}}}}
  ]);
  assert.equal(result.available,true);
  assert.equal(result.promptTokens,170);
  assert.equal(result.completionTokens,40);
  assert.equal(result.totalTokens,210);
  assert.equal(result.reportedCalls,3);
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

test('external repository input uses the actual scanner and does not leak the operator absolute path', async () => {
  const scenario = scenarios.find(item => item.id === 'EX-API-003');
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../benchmarks/fixtures/customer-api');
  const project = await resolveScenarioProject(scenario, { repositoryRoot });
  assert.equal(project.kind, 'existing');
  assert.equal(project.repository.root, 'external-repository');
  const scannerSummary = summarizeRepositoryEvidence(project);
  assert.equal(scannerSummary.scannerVersion, '1.6.0');
  assert.equal(scannerSummary.scanLimits.maxFiles, 5000);
  assert.equal(scannerSummary.scanLimits.maxSourceFiles, 500);
  assert.equal(scannerSummary.scanLimits.maxTestFiles, 25);
  assert.equal(scannerSummary.scanLimits.maxConfigFiles, 25);
  assert.ok(scannerSummary.skipped.counts);
  assert.ok(scannerSummary.coverage.sourceAnalysisRatio > 0);
  assert.equal(scannerSummary.coverage.includedFileCount, scannerSummary.includedFileCount);
  assert.ok(scannerSummary.structure.astFileCount + scannerSummary.structure.lexicalFallbackFileCount > 0);
  assert.ok(scannerSummary.includedPaths.includes('src/routes/customers.mjs'));
  assert.ok(project.repository.files.some(file => file.path === 'src/routes/customers.mjs'));
  assert.ok(project.repository.snippets.some(file => file.path === 'package.json'));
  assert.ok(project.evidence.some(item => item.type === 'repository_scan'));
  assert.equal(JSON.stringify(project).includes(repositoryRoot), false);
});

test('external repository input is rejected for greenfield scenarios', async () => {
  const scenario = scenarios.find(item => item.id === 'GF-API-001');
  await assert.rejects(
    () => resolveScenarioProject(scenario, { repositoryRoot: process.cwd() }),
    /only be used with Existing Project scenarios/
  );
});

test('external repository benchmark requires a clean pinned Git commit', () => {
  assert.deepEqual(assertExternalRepositorySnapshot({repository:{fileCount:2,snippets:[{path:'README.md'},{path:'src/index.mjs'}],git:{isRepo:true,commit:'a'.repeat(40),branch:'main',dirty:false}}}), {
    commit:'a'.repeat(40),branch:'main',dirty:false
  });
  assert.throws(()=>assertExternalRepositorySnapshot({repository:{fileCount:1,snippets:[{path:'README.md'}],git:{isRepo:false,commit:null,dirty:null}}}),/Git checkout/);
  assert.throws(()=>assertExternalRepositorySnapshot({repository:{fileCount:1,snippets:[{path:'README.md'}],git:{isRepo:true,commit:'b'.repeat(40),dirty:true}}}),/clean working tree/);
  assert.throws(()=>assertExternalRepositorySnapshot({repository:{fileCount:1,snippets:[{path:'README.md'}],git:{isRepo:true,commit:'short',dirty:false}}}),/commit SHA/);
  assert.throws(()=>assertExternalRepositorySnapshot({repository:{fileCount:1,snippets:[{path:'README.md'}],git:{isRepo:true,commit:'c'.repeat(40),dirty:false}}}),/no implementation source evidence/);
  assert.deepEqual(assertExternalRepositorySnapshot({repository:{fileCount:2,snippets:[{path:'README.md'}],structure:{analyzedSourceFileCount:1},git:{isRepo:true,commit:'d'.repeat(40),dirty:false}}}),{commit:'d'.repeat(40),branch:null,dirty:false});
  assert.throws(()=>assertExternalRepositorySnapshot({repository:{fileCount:0,snippets:[],git:{isRepo:true,commit:'a'.repeat(40),dirty:false}}}),/no usable file evidence/);
});

test('repository-specific task files override request and rubric with a stable content fingerprint', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oiol-task-test-'));
  const taskPath = path.join(directory, 'task.json');
  const task = {
    scenarioId: 'EX-API-003',
    taskId: 'RW-TEST-CHANGE-001',
    taskVersion: '1.0.0',
    projectName: 'External Test Repository',
    request: 'Plan a safe change grounded in the scanned repository architecture.',
    constraints: ['Preserve public interfaces', 'Do not invent repository behavior'],
    expectedSignals: [['architecture', 'module boundaries'], ['acceptance criteria', 'verification']],
    evidencePaths: ['src/service.ts'], mustClarify: false
  };
  try {
    await fs.writeFile(taskPath, JSON.stringify(task), 'utf8');
    const selected = selectScenarios('EX-API-003');
    const result = await applyScenarioTaskFile(selected, taskPath);
    assert.equal(result.scenarios.length, 1);
    assert.equal(result.scenarios[0].project.request, task.request);
    assert.deepEqual(result.scenarios[0].expectedSignals, task.expectedSignals);
    assert.equal(result.taskDefinition.id, task.taskId);
    assert.equal(result.taskDefinition.version, task.taskVersion);
    assert.match(result.taskDefinition.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('task files reject scenario mismatches and invalid scoring rubrics', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oiol-task-invalid-'));
  const taskPath = path.join(directory, 'task.json');
  const task = {
    scenarioId: 'GF-API-001', taskId: 'RW-TEST-001', taskVersion: '1.0.0',
    projectName: 'Example', request: 'Plan a change', constraints: [],
    expectedSignals: [['signal']], evidencePaths: ['src/service.ts'], mustClarify: false
  };
  try {
    await fs.writeFile(taskPath, JSON.stringify(task), 'utf8');
    await assert.rejects(() => applyScenarioTaskFile(selectScenarios('EX-API-003'), taskPath), /scenarioId must match/);
    task.scenarioId = 'EX-API-003';
    task.expectedSignals = [];
    await fs.writeFile(taskPath, JSON.stringify(task), 'utf8');
    await assert.rejects(() => applyScenarioTaskFile(selectScenarios('EX-API-003'), taskPath), /expectedSignals/);
    await assert.rejects(() => applyScenarioTaskFile(selectScenarios('EX-API-003,EX-SEC-009'), taskPath), /exactly one selected scenario/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('external benchmark dry-run requires and fingerprints the repository-specific task file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oiol-external-dry-run-'));
  const taskPath = path.join(directory, 'task.json');
  const task = {
    scenarioId: 'EX-API-003', taskId: 'RW-DRY-RUN-001', taskVersion: '1.0.0',
    projectName: 'Dry Run Repository', request: 'Assess a bounded architectural change.',
    constraints: ['Preserve existing behavior'],
    expectedSignals: [['architecture'], ['acceptance criteria']],
    evidencePaths: ['src/service.ts'], mustClarify: false
  };
  const previousArgv = process.argv;
  const previousOptIn = process.env.OIOL_BENCHMARK_ALLOW_LIVE;
  const previousLog = console.log;
  const lines = [];
  try {
    delete process.env.OIOL_BENCHMARK_ALLOW_LIVE;
    process.argv = ['node', 'run-planner-benchmark.mjs', '--repo', '/unused/checkout', '--scenarios', 'EX-API-003'];
    await assert.rejects(() => main(), /require --task-file/);
    await fs.writeFile(taskPath, JSON.stringify(task), 'utf8');
    process.argv = ['node', 'run-planner-benchmark.mjs', '--repo', '/unused/checkout', '--task-file', taskPath, '--scenarios', 'EX-API-003', '--dry-run'];
    console.log = value => lines.push(String(value));
    assert.equal(await main(), 0);
    const output = JSON.parse(lines.at(-1));
    assert.equal(output.sourceMode, 'external-local-checkout');
    assert.equal(output.taskDefinition.id, task.taskId);
    assert.match(output.taskDefinition.sha256, /^[a-f0-9]{64}$/);
    assert.equal(output.liveCalls, false);
  } finally {
    process.argv = previousArgv;
    if (previousOptIn === undefined) delete process.env.OIOL_BENCHMARK_ALLOW_LIVE; else process.env.OIOL_BENCHMARK_ALLOW_LIVE = previousOptIn;
    console.log = previousLog;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('external corpus scan report uses the existing read-only scanner and redacts local paths', async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../benchmarks/fixtures/customer-api');
  const report = await scanExternalRepository({ repositoryRoot, repositoryId: 'RW-TEST-SCAN' });
  assert.equal(report.repositoryId, 'RW-TEST-SCAN');
  assert.match(report.git.commit, /^[a-f0-9]{40}$/i);
  assert.equal(report.git.dirty, false);
  assert.ok(report.fileCount > 0);
  assert.ok(report.structure.astFileCount + report.structure.lexicalFallbackFileCount > 0);
  assert.ok(report.evidence.length > 0);
  assert.equal(JSON.stringify(report).includes(repositoryRoot), false);
  assert.equal(report.root, 'external-repository');
  assert.equal(report.scannerVersion, '1.6.0');
  assert.ok(report.skipped.counts);
  assert.ok(report.coverage.sourceAnalysisRatio > 0);
  assert.equal(report.coverage.includedFileCount, report.includedFileCount);
  assert.equal(report.scanLimits.maxFiles, 5000);
  assert.equal(report.scanLimits.maxSourceFiles, 500);
  assert.equal(report.scanLimits.maxTestFiles, 25);
  assert.equal(report.scanLimits.maxConfigFiles, 25);
  assert.ok(report.evidenceSelection);
  const missingEvidenceReport = await scanExternalRepository({
    repositoryRoot,
    repositoryId: 'RW-TEST-MISSING-EVIDENCE',
    scanOptions: { maxFiles: 5000, maxFileBytes: 32000, maxContextChars: 150000, maxDepth: 16, maxSourceFiles: 500, maxTestFiles: 25, maxConfigFiles: 25, priorityPaths: ['src/does-not-exist.ts'] }
  });
  assert.deepEqual(missingEvidenceReport.evidenceSelection.missingPaths, ['src/does-not-exist.ts']);
});

test('external live planning requires explicit consent before sending repository excerpts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oiol-external-consent-'));
  const taskPath = path.join(directory, 'task.json');
  const task = {
    scenarioId: 'EX-API-003', taskId: 'RW-CONSENT-001', taskVersion: '1.0.0',
    projectName: 'Consent Test', request: 'Plan a repository change.', evidencePaths: ['src/app.js'],
    constraints: ['Do not invent project facts'],
    expectedSignals: [['architecture']], mustClarify: false
  };
  const previousArgv = process.argv;
  const previousLive = process.env.OIOL_BENCHMARK_ALLOW_LIVE;
  const previousSource = process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE;
  try {
    await fs.writeFile(taskPath, JSON.stringify(task), 'utf8');
    process.env.OIOL_BENCHMARK_ALLOW_LIVE = '1';
    delete process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE;
    process.argv = ['node', 'run-planner-benchmark.mjs', '--repo', '/unused/checkout', '--task-file', taskPath, '--scenarios', 'EX-API-003'];
    await assert.rejects(() => main(), /ALLOW_EXTERNAL_SOURCE=1/);
  } finally {
    process.argv = previousArgv;
    if (previousLive === undefined) delete process.env.OIOL_BENCHMARK_ALLOW_LIVE; else process.env.OIOL_BENCHMARK_ALLOW_LIVE = previousLive;
    if (previousSource === undefined) delete process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE; else process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE = previousSource;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('all ten P12 external task drafts satisfy the runner contract and remain explicitly unapproved', async () => {
  const draftDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../benchmarks/external-tasks/drafts');
  const files = (await fs.readdir(draftDirectory)).filter(file => file.endsWith('.json')).sort();
  assert.equal(files.length, 10, 'expected two draft tasks for each of five pinned repositories');
  const taskIds = new Set();
  const repositoryPrefixes = new Set();
  for (const file of files) {
    const raw = await fs.readFile(path.join(draftDirectory, file), 'utf8');
    const task = JSON.parse(raw);
    assert.ok(task.taskId && !taskIds.has(task.taskId), 'taskId must be present and unique: ' + file);
    taskIds.add(task.taskId);
    repositoryPrefixes.add(task.taskId.split('-').slice(0, 2).join('-'));
    assert.match(task.taskVersion, /^0\.4\.0-draft$/, file);
    assert.ok(task.constraints.some(value => /engineering plan only/i.test(value)), file);
    assert.ok(task.constraints.some(value => /do not modify|do not execute/i.test(value)), file);
    assert.ok(task.constraints.some(value => /pinned repository snapshot/i.test(value)), file);
    const selected = selectScenarios(task.scenarioId);
    const applied = await applyScenarioTaskFile(selected, path.join(draftDirectory, file));
    assert.equal(applied.scenarios.length, 1, file);
    assert.equal(applied.scenarios[0].mustClarify, task.mustClarify, file);
    assert.match(applied.taskDefinition.sha256, /^[a-f0-9]{64}$/, file);
    assert.deepEqual(applied.taskDefinition.evidencePaths, task.evidencePaths, file);
    if (task.mustClarify) assert.ok(applied.scenarios[0].clarificationSignals.length > 0, file);
  }
  assert.equal(repositoryPrefixes.size, 5);
});

test('all P12 task drafts support credential-free external dry-run manifests', async () => {
  const draftDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../benchmarks/external-tasks/drafts');
  const files = (await fs.readdir(draftDirectory)).filter(file => file.endsWith('.json')).sort();
  const previousArgv = process.argv;
  const previousLog = console.log;
  const previousLive = process.env.OIOL_BENCHMARK_ALLOW_LIVE;
  const previousSource = process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE;
  const previousKey = process.env.OIOL_API_KEY;
  try {
    delete process.env.OIOL_BENCHMARK_ALLOW_LIVE;
    delete process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE;
    delete process.env.OIOL_API_KEY;
    for (const file of files) {
      const taskPath = path.join(draftDirectory, file);
      const task = JSON.parse(await fs.readFile(taskPath, 'utf8'));
      const lines = [];
      console.log = value => lines.push(String(value));
      process.argv = ['node', 'run-planner-benchmark.mjs', '--repo', '/unused/checkout', '--task-file', taskPath, '--scenarios', task.scenarioId, '--dry-run'];
      assert.equal(await main(), 0, file);
      const report = JSON.parse(lines.at(-1));
      assert.equal(report.dryRun, true, file);
      assert.equal(report.sourceMode, 'external-local-checkout', file);
      assert.equal(report.taskDefinition.id, task.taskId, file);
      assert.deepEqual(report.taskDefinition.evidencePaths, task.evidencePaths, file);
      assert.equal(report.liveCalls, false, file);
    }
  } finally {
    process.argv = previousArgv;
    console.log = previousLog;
    if (previousLive === undefined) delete process.env.OIOL_BENCHMARK_ALLOW_LIVE; else process.env.OIOL_BENCHMARK_ALLOW_LIVE = previousLive;
    if (previousSource === undefined) delete process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE; else process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE = previousSource;
    if (previousKey === undefined) delete process.env.OIOL_API_KEY; else process.env.OIOL_API_KEY = previousKey;
  }
});


test('external benchmark rejects missing task-specific source excerpts', () => {
  const project = {
    repository: {
      fileCount: 2,
      snippets: [{ path: 'src/critical.ts' }],
      git: { isRepo: true, commit: 'a'.repeat(40), dirty: false },
      structure: { analyzedSourceFileCount: 1 },
      evidenceSelection: {
        requestedPaths: ['src/critical.ts', 'src/missing.ts'],
        matchedPaths: ['src/critical.ts'],
        excerptedPaths: ['src/critical.ts'],
        missingPaths: ['src/missing.ts'],
        unexcerptedPaths: []
      }
    }
  };
  assert.throws(() => assertExternalRepositorySnapshot(project), /Required task evidence paths were not supplied as excerpts/);
});
