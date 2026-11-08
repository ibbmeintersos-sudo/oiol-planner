#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyzer/project-analyzer.mjs';
import { SCANNER_VERSION, EXTERNAL_REPOSITORY_SCAN_OPTIONS } from '../src/scanner/repository.mjs';
import { createProvider } from '../src/providers/index.mjs';
import { HybridPlanner } from '../src/core/planner.mjs';
import { scenarios } from '../benchmarks/scenarios.mjs';
import { scoreScenario, summarizeBenchmark } from '../benchmarks/scoring.mjs';

export function selectScenarios(selection='all', catalog=scenarios) {
  if (selection === 'all') return [...catalog];
  const ids = selection.split(',').map(x => x.trim()).filter(Boolean);
  if (!ids.length) throw new Error('--scenarios must contain at least one scenario ID or all');
  if (new Set(ids).size !== ids.length) throw new Error('--scenarios contains duplicate IDs');
  const known = new Set(catalog.map(x => x.id));
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) throw new Error('Unknown benchmark scenario ID(s): ' + unknown.join(', '));
  return ids.map(id => catalog.find(x => x.id === id));
}

function arg(name,fallback){const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:fallback;}
export function providerConfig(prefix='OIOL_') {
  const provider=process.env[prefix+'PROVIDER']||(prefix==='OIOL_'?'openai-compatible':undefined);
  const defaults={'openai-compatible':'https://api.openai.com/v1',anthropic:'https://api.anthropic.com',gemini:'https://generativelanguage.googleapis.com/v1beta',ollama:'http://127.0.0.1:11434'};
  const defaultModel=provider==='ollama'?'qwen2.5:7b':provider==='anthropic'?'claude-3-5-sonnet-latest':provider==='gemini'?'gemini-2.0-flash':'gpt-4o-mini';
  return {provider,model:process.env[prefix+'MODEL']||defaultModel,baseUrl:process.env[prefix+'BASE_URL']||defaults[provider],apiKey:process.env[prefix+'API_KEY'],timeoutMs:Number(process.env[prefix+'TIMEOUT_MS']||60000),maxRetries:Number(process.env.OIOL_MAX_RETRIES||2)};
}
function publicConfig(config) {
  return {provider:config.provider,model:config.model,baseUrl:config.baseUrl,timeoutMs:config.timeoutMs,maxRetries:config.maxRetries,credentialConfigured:Boolean(config.apiKey)};
}
export function benchmarkConfigFingerprint(config) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export async function applyScenarioTaskFile(chosen, taskFilePath = null) {
  if (!taskFilePath) return { scenarios: chosen, taskDefinition: null };
  if (chosen.length !== 1) throw new Error('--task-file requires exactly one selected scenario');
  const raw = await fs.readFile(path.resolve(taskFilePath), 'utf8');
  const task = JSON.parse(raw);
  const base = chosen[0];
  if (task?.scenarioId !== base.id) throw new Error('--task-file scenarioId must match the selected scenario');
  if (typeof task.taskId !== 'string' || !task.taskId.trim()) throw new Error('--task-file requires a non-empty taskId');
  if (typeof task.taskVersion !== 'string' || !task.taskVersion.trim()) throw new Error('--task-file requires a non-empty taskVersion');
  if (typeof task.projectName !== 'string' || !task.projectName.trim()) throw new Error('--task-file requires a non-empty projectName');
  if (typeof task.request !== 'string' || !task.request.trim()) throw new Error('--task-file requires a non-empty request');
  if (!Array.isArray(task.constraints) || task.constraints.some(value => typeof value !== 'string')) throw new Error('--task-file constraints must be an array of strings');
  if (!Array.isArray(task.expectedSignals) || !task.expectedSignals.length || task.expectedSignals.some(group => !Array.isArray(group) || !group.length || group.some(value => typeof value !== 'string'))) {
    throw new Error('--task-file expectedSignals must be a non-empty array of non-empty string groups');
  }
  if (!Array.isArray(task.evidencePaths) || !task.evidencePaths.length || task.evidencePaths.some(value => typeof value !== 'string' || !value.trim() || value.startsWith('/') || value.includes('..') || value.includes('\\\\'))) throw new Error('--task-file requires non-empty safe relative evidencePaths');
  if (typeof task.mustClarify !== 'boolean') throw new Error('--task-file mustClarify must be a boolean');
  if (task.mustClarify && (!Array.isArray(task.clarificationSignals) || !task.clarificationSignals.length || task.clarificationSignals.some(group => !Array.isArray(group) || !group.length || group.some(value => typeof value !== 'string')))) {
    throw new Error('--task-file requires clarificationSignals for blocking-clarification tasks');
  }
  const scenario = {
    ...base,
    project: { ...base.project, name: task.projectName, request: task.request, constraints: [...task.constraints] },
    expectedSignals: task.expectedSignals,
    mustClarify: task.mustClarify,
    clarificationSignals: task.clarificationSignals || []
  };
  return {
    scenarios: [scenario],
    taskDefinition: {
      id: task.taskId,
      version: task.taskVersion,
      sha256: createHash('sha256').update(raw).digest('hex'),
      evidencePaths: [...task.evidencePaths]
    }
  };
}

export function assertExternalRepositorySnapshot(project) {
  if (!Number.isInteger(project?.repository?.fileCount) || project.repository.fileCount < 1 || !Array.isArray(project.repository.snippets) || project.repository.snippets.length < 1) {
    throw new Error('External benchmark repository scan produced no usable file evidence');
  }
  const evidenceSelection = project?.repository?.evidenceSelection;
  if (Array.isArray(evidenceSelection?.requestedPaths) && evidenceSelection.requestedPaths.length) {
    const missing = [...(evidenceSelection.missingPaths || []), ...(evidenceSelection.unexcerptedPaths || [])];
    if (missing.length) throw new Error('Required task evidence paths were not supplied as excerpts: ' + [...new Set(missing)].join(', '));
  }
  const git = project?.repository?.git;
  if (!git?.isRepo || !/^[a-f0-9]{40}$/i.test(git.commit || '')) {
    throw new Error('External benchmark repository must be a Git checkout with a resolvable 40-character commit SHA');
  }
  if (git.dirty !== false) {
    throw new Error('External benchmark repository must have a clean working tree; commit or discard local changes before benchmarking');
  }
  const sourceEvidence = project.repository.snippets.some(snippet =>
    /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|php|rb|dart|swift)$/i.test(snippet.path || '')
  );
  const analyzedSourceCount = project.repository.structure?.analyzedSourceFileCount || 0;
  if (!sourceEvidence && analyzedSourceCount < 1) {
    throw new Error('External benchmark repository scan produced no implementation source evidence; README or manifest evidence alone is insufficient');
  }
  return { commit: git.commit, branch: git.branch || null, dirty: false };
}

export function summarizeRepositoryEvidence(project) {
  const repository = project?.repository;
  if (!repository) return null;
  const structure = repository.structure || {};
  return {
    root: repository.root,
    scannerVersion: repository.scannerVersion || SCANNER_VERSION,
    git: repository.git,
    fileCount: repository.fileCount,
    includedFileCount: repository.includedFileCount,
    fileCountIsLowerBound: repository.fileCountIsLowerBound,
    truncated: repository.truncated,
    depthTruncated: repository.depthTruncated,
    skipped: repository.skipped,
    scanLimits: repository.scanLimits,
    manifests: repository.manifests,
    scripts: repository.scripts,
    tests: repository.tests,
    configs: repository.configs,
    includedPaths: (repository.files || []).map(file => file.path),
    contextTruncated: repository.contextTruncated,
    evidenceSelection: repository.evidenceSelection || null,
    snippetCount: (repository.snippets || []).length,
    snippetPaths: (repository.snippets || []).map(snippet => snippet.path),
    structure: {
      method: structure.method,
      languages: structure.languages,
      sourceFileCount: structure.sourceFileCount,
      analyzedSourceFileCount: structure.analyzedSourceFileCount,
      astFileCount: structure.astFileCount,
      lexicalFallbackFileCount: structure.lexicalFallbackFileCount,
      unsupportedLanguageFileCount: structure.unsupportedLanguageFileCount,
      unsupportedLanguageFiles: structure.unsupportedLanguageFiles,
      parseFailureFileCount: structure.parseFailureFileCount,
      syntaxErrorFileCount: structure.syntaxErrorFileCount,
      nodeLimitFileCount: structure.nodeLimitFileCount,
      depthLimitFileCount: structure.depthLimitFileCount,
      frameworks: structure.frameworks,
      entryPoints: structure.entryPoints,
      dependencyGraph: { nodeCount: structure.dependencyGraph?.nodes?.length || 0, edgeCount: structure.dependencyGraph?.edgeCount || 0 },
      unresolvedLocalImportCount: structure.unresolvedLocalImportCount,
      diagnostics: structure.diagnostics,
      parserDiagnostics: structure.parserDiagnostics,
      limitations: structure.limitations
    },
    evidence: project.evidence,
    coverage: {
      discoveredFileCount: repository.fileCount,
      includedFileCount: repository.includedFileCount,
      fileCountIsLowerBound: repository.fileCountIsLowerBound,
      fileTruncated: repository.truncated,
      depthTruncated: repository.depthTruncated,
      sourceFileCount: structure.sourceFileCount || 0,
      analyzedSourceFileCount: structure.analyzedSourceFileCount || 0,
      sourceAnalysisRatio: structure.sourceFileCount ? (structure.analyzedSourceFileCount || 0) / structure.sourceFileCount : null,
      astFileCount: structure.astFileCount || 0,
      lexicalFallbackFileCount: structure.lexicalFallbackFileCount || 0,
      unsupportedLanguageFileCount: structure.unsupportedLanguageFileCount || 0,
      unsupportedLanguageRatio: structure.sourceFileCount ? (structure.unsupportedLanguageFileCount || 0) / structure.sourceFileCount : null,
      syntaxErrorFileCount: structure.syntaxErrorFileCount || 0,
      parseFailureFileCount: structure.parseFailureFileCount || 0,
      manifestCount: (repository.manifests || []).length,
      testFileCount: (repository.tests || []).length,
      configFileCount: (repository.configs || []).length,
      snippetCount: (repository.snippets || []).length,
      contextTruncated: repository.contextTruncated,
      skippedCounts: repository.skipped?.counts || {}
    }
  };
}

export async function resolveScenarioProject(scenario, { repositoryRoot = null, scanOptions = null } = {}) {
  if (repositoryRoot) {
    if (scenario.project?.kind !== 'existing') {
      throw new Error('An external repository can only be used with Existing Project scenarios');
    }
    const project = await analyzeProject({
      mode: 'existing',
      repo: path.resolve(repositoryRoot),
      name: scenario.project.name,
      request: scenario.project.request,
      scanOptions: { ...EXTERNAL_REPOSITORY_SCAN_OPTIONS, ...(scanOptions || {}) }
    });
    // Do not expose the operator's absolute local path in plans or benchmark artifacts.
    project.repository.root = 'external-repository';
    project.evidence = project.evidence.map(item => item.type === 'repository_scan' ? { ...item, source: 'external-repository' } : item);
    return project;
  }
  const fixturePath=scenario.project?.fixturePath;
  if(!fixturePath) return scenario.project;
  const repoPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..',fixturePath);
  const project=await analyzeProject({mode:'existing',repo:repoPath,name:scenario.project.name,request:scenario.project.request});
  project.repository.root=fixturePath;
  return project;
}

export function aggregateUsage(records) {
  const totals={promptTokens:0,completionTokens:0,totalTokens:0,reportedCalls:0,unreportedCalls:0};
  for(const record of records) for(const role of ['planner','reviewer']) {
    for(const call of record.plan?.providerUsage?.[role]?.calls||[]) {
      const usage=call.usage;
      if(!usage||typeof usage!=='object') { totals.unreportedCalls++; continue; }
      totals.reportedCalls++;
      const prompt=Number(usage.prompt_tokens??usage.input_tokens??usage.promptTokenCount??0)||0;
      const completion=Number(usage.completion_tokens??usage.output_tokens??usage.candidatesTokenCount??usage.completionTokenCount??0)||0;
      totals.promptTokens+=prompt;
      totals.completionTokens+=completion;
      totals.totalTokens+=Number(usage.total_tokens??usage.totalTokenCount??(prompt+completion))||0;
    }
  }
  return {...totals,available:totals.reportedCalls>0,cost:null,costNote:'Provider pricing is not applied; token usage is reported only when the provider returns usage metadata.'};
}

export async function main() {
  const selected=arg('scenarios','all');
  const selectedScenarios=selectScenarios(selected);
  const taskFilePath=arg('task-file',null);
  const taskApplication=await applyScenarioTaskFile(selectedScenarios,taskFilePath);
  const chosen=taskApplication.scenarios;
  const taskDefinition=taskApplication.taskDefinition;
  const repositoryRoot=arg('repo',process.env.OIOL_BENCHMARK_REPOSITORY||null);
  if(repositoryRoot && chosen.some(scenario=>scenario.project?.kind!=='existing')) throw new Error('--repo can only be used with Existing Project scenarios');
  if(repositoryRoot && !taskDefinition) throw new Error('External repository benchmarks require --task-file with a repository-specific task and scoring rubric');
  if(process.argv.includes('--list')) {
    for(const s of scenarios) console.log(s.id+' ['+s.category+'/'+s.difficulty+']'+(s.mustClarify?' blocking clarification required':''));
    return 0;
  }
  const planningConfig=providerConfig('OIOL_');
  const reviewConfig=process.env.OIOL_REVIEW_PROVIDER?providerConfig('OIOL_REVIEW_'):null;
  const configSummary={planner:publicConfig(planningConfig),reviewer:reviewConfig?publicConfig(reviewConfig):{mode:'same-provider critique; not independent'}};
  if(process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({dryRun:true,selected:chosen.map(x=>x.id),sourceMode:repositoryRoot?'external-local-checkout':'checked-in-fixtures',taskDefinition,config:configSummary,liveCalls:false},null,2));
    return 0;
  }
  if(process.env.OIOL_BENCHMARK_ALLOW_LIVE!=='1') throw new Error('Set OIOL_BENCHMARK_ALLOW_LIVE=1 to confirm that this run may call configured LLM providers.');
  if(repositoryRoot && process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE!=='1') throw new Error('Set OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE=1 to confirm that bounded, redacted external repository excerpts may be sent to the configured model provider.');
  if(!planningConfig.apiKey && planningConfig.provider!=='ollama') throw new Error('OIOL_API_KEY is required for the configured remote planning provider.');
  if(reviewConfig&&!reviewConfig.apiKey&&reviewConfig.provider!=='ollama') throw new Error('OIOL_REVIEW_API_KEY is required when a separate remote reviewer is configured.');
  const provider=createProvider(planningConfig);
  const reviewer=reviewConfig?createProvider(reviewConfig):provider;
  const records=[];
  for(const scenario of chosen){
    const started=Date.now();
    try{
      const project=await resolveScenarioProject(scenario,{repositoryRoot,scanOptions:taskDefinition?.evidencePaths?{priorityPaths:taskDefinition.evidencePaths}:null});
      if(repositoryRoot) assertExternalRepositorySnapshot(project);
      const plan=await new HybridPlanner({provider,reviewer,maxRepairRounds:Number(process.env.OIOL_MAX_REPAIR_ROUNDS||2)}).createPlan(project);
      records.push({scenarioId:scenario.id,elapsedMs:Date.now()-started,projectEvidence:summarizeRepositoryEvidence(project),plan});
      console.log('['+scenario.id+'] '+plan.status+' in '+(Date.now()-started)+'ms');
    }catch(error){
      records.push({scenarioId:scenario.id,elapsedMs:Date.now()-started,error:{name:error.name,message:error.message}});
      console.error('['+scenario.id+'] ERROR: '+error.message);
    }
  }
  const scores=records.map(record=>{const scenario=chosen.find(x=>x.id===record.scenarioId);return record.error?{scenarioId:record.scenarioId,category:scenario.category,difficulty:scenario.difficulty,score:0,blockers:[record.error.message]}:scoreScenario(scenario,record);});
  const summary=summarizeBenchmark(scores);
  const repositoryCommitShas=repositoryRoot?[...new Set(records.map(x=>x.projectEvidence?.git?.commit).filter(Boolean))].sort():[];
  const scannerConfigurations=[...new Set(records.map(x=>x.projectEvidence?.scanLimits?JSON.stringify(x.projectEvidence.scanLimits):null).filter(Boolean))].sort();
  const comparisonKey=process.env.OIOL_BENCHMARK_COMPARISON_KEY||null,budgetKey=process.env.OIOL_BENCHMARK_BUDGET_KEY||null;
  const output={protocolVersion:'1.1',runnerVersion:'1.5.0',benchmarkMode:'oiol',sourceMode:repositoryRoot?'external-local-checkout':'checked-in-fixtures',taskDefinition,repositorySnapshot:repositoryRoot?{source:'operator-supplied local checkout',commitShas:[...new Set(records.map(x=>x.projectEvidence?.git?.commit).filter(Boolean))],allGitCommitsDetected:records.every(x=>Boolean(x.projectEvidence?.git?.commit))}:null,comparisonKey,budgetKey,runId:createHash('sha256').update(Date.now()+'|'+process.pid+'|'+chosen.map(x=>x.id).join(',')).digest('hex').slice(0,16),createdAt:new Date().toISOString(),configFingerprint:benchmarkConfigFingerprint({protocolVersion:'1.1',benchmarkMode:'oiol',runnerVersion:'1.5.0',scannerVersion:SCANNER_VERSION,scannerConfigurations,sourceMode:repositoryRoot?'external-local-checkout':'checked-in-fixtures',repositoryCommitShas,taskDefinition,comparisonKey,budgetKey,planner:publicConfig(planningConfig),reviewer:reviewConfig?publicConfig(reviewConfig):'same-provider',scenarioIds:chosen.map(x=>x.id).sort()}),provider:publicConfig(planningConfig),reviewer:reviewConfig?publicConfig(reviewConfig):{mode:'same-provider critique; not independent'},usageAccounting:aggregateUsage(records),summary,scores,records,limitations:['Token usage is reported only when provider metadata is returned; monetary cost is not estimated.','External repository mode reads an operator-supplied local checkout; OIOL does not clone, install, build, test, or modify it.','A benchmark run is not reproducible unless its repository commit SHA is recorded.','Automated concept matching is a screening heuristic; human review remains required.']};
  const out=path.resolve(arg('out','benchmarks/results/run-'+Date.now()+'.json'));
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out,JSON.stringify(output,null,2)+'\n');
  const csv=['scenario_id,category,technical_correctness_1_5,requirement_understanding_1_5,task_decomposition_1_5,acceptance_criteria_1_5,scope_and_safety_1_5,clarification_quality_1_5,overall_1_5,reviewer_id,highest_finding_severity,evidence_notes,adjudicated_overall_1_5,adjudication_notes'];
  for(const row of scores) csv.push([row.scenarioId,row.category,...Array(12).fill('')].join(','));
  const humanPath=out.replace(/\.json$/,'-human-review.csv');
  await fs.writeFile(humanPath,csv.join('\n')+'\n');
  console.log(JSON.stringify({summary,resultFile:out,humanReviewFile:humanPath},null,2));
  return summary.passCount===summary.scenarioCount?0:2;
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode=await main(); }
  catch(error){console.error('Benchmark error: '+error.message);process.exitCode=1;}
}
