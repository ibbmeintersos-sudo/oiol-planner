#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { analyzeProject } from '../src/analyzer/project-analyzer.mjs';
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

export async function resolveScenarioProject(scenario) {
  const fixturePath=scenario.project?.fixturePath;
  if(!fixturePath) return scenario.project;
  const repoPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..',fixturePath);
  const project=await analyzeProject({mode:'existing',repo:repoPath,name:scenario.project.name,request:scenario.project.request});
  project.repository.root=fixturePath.replaceAll('\\\\','/');
  return project;
}

export function aggregateUsage(records) {
  const totals={promptTokens:0,completionTokens:0,totalTokens:0,reportedCalls:0,unreportedCalls:0};
  for(const record of records) for(const role of ['planner','reviewer']) {
    for(const call of record.plan?.providerUsage?.[role]?.calls||[]) {
      const usage=call.usage;
      if(!usage||typeof usage!=='object') { totals.unreportedCalls++; continue; }
      totals.reportedCalls++;
      totals.promptTokens+=Number(usage.prompt_tokens??usage.input_tokens??0)||0;
      totals.completionTokens+=Number(usage.completion_tokens??usage.output_tokens??0)||0;
      totals.totalTokens+=Number(usage.total_tokens??((Number(usage.prompt_tokens??usage.input_tokens??0)||0)+(Number(usage.completion_tokens??usage.output_tokens??0)||0)))||0;
    }
  }
  return {...totals,available:totals.reportedCalls>0,cost:null,costNote:'Provider pricing is not applied; token usage is reported only when the provider returns usage metadata.'};
}

export async function main() {
  const selected=arg('scenarios','all');
  const chosen=selectScenarios(selected);
  if(process.argv.includes('--list')) {
    for(const s of scenarios) console.log(s.id+' ['+s.category+'/'+s.difficulty+']'+(s.mustClarify?' blocking clarification required':''));
    return 0;
  }
  const planningConfig=providerConfig('OIOL_');
  const reviewConfig=process.env.OIOL_REVIEW_PROVIDER?providerConfig('OIOL_REVIEW_'):null;
  const configSummary={planner:publicConfig(planningConfig),reviewer:reviewConfig?publicConfig(reviewConfig):{mode:'same-provider critique; not independent'}};
  if(process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({dryRun:true,selected:chosen.map(x=>x.id),config:configSummary,liveCalls:false},null,2));
    return 0;
  }
  if(process.env.OIOL_BENCHMARK_ALLOW_LIVE!=='1') throw new Error('Set OIOL_BENCHMARK_ALLOW_LIVE=1 to confirm that this run may call configured LLM providers.');
  if(!planningConfig.apiKey && planningConfig.provider!=='ollama') throw new Error('OIOL_API_KEY is required for the configured remote planning provider.');
  if(reviewConfig&&!reviewConfig.apiKey&&reviewConfig.provider!=='ollama') throw new Error('OIOL_REVIEW_API_KEY is required when a separate remote reviewer is configured.');
  const provider=createProvider(planningConfig);
  const reviewer=reviewConfig?createProvider(reviewConfig):provider;
  const records=[];
  for(const scenario of chosen){
    const started=Date.now();
    try{
      const project=await resolveScenarioProject(scenario);
      const plan=await new HybridPlanner({provider,reviewer,maxRepairRounds:Number(process.env.OIOL_MAX_REPAIR_ROUNDS||2)}).createPlan(project);
      records.push({scenarioId:scenario.id,elapsedMs:Date.now()-started,projectEvidence:project.repository?{root:project.repository.root,fileCount:project.repository.fileCount,manifests:project.repository.manifests,tests:project.repository.tests,git:project.repository.git}:null,plan});
      console.log('['+scenario.id+'] '+plan.status+' in '+(Date.now()-started)+'ms');
    }catch(error){
      records.push({scenarioId:scenario.id,elapsedMs:Date.now()-started,error:{name:error.name,message:error.message}});
      console.error('['+scenario.id+'] ERROR: '+error.message);
    }
  }
  const scores=records.map(record=>{const scenario=chosen.find(x=>x.id===record.scenarioId);return record.error?{scenarioId:record.scenarioId,category:scenario.category,difficulty:scenario.difficulty,score:0,blockers:[record.error.message]}:scoreScenario(scenario,record);});
  const summary=summarizeBenchmark(scores);
  const comparisonKey=process.env.OIOL_BENCHMARK_COMPARISON_KEY||null,budgetKey=process.env.OIOL_BENCHMARK_BUDGET_KEY||null;
  const output={protocolVersion:'1.1',runnerVersion:'1.1.0',executionMode:'oiol',comparisonKey,budgetKey,runId:createHash('sha256').update(Date.now()+'|'+process.pid+'|'+chosen.map(x=>x.id).join(',')).digest('hex').slice(0,16),createdAt:new Date().toISOString(),configFingerprint:benchmarkConfigFingerprint({protocolVersion:'1.1',executionMode:'oiol',comparisonKey,budgetKey,planner:publicConfig(planningConfig),reviewer:reviewConfig?publicConfig(reviewConfig):'same-provider',scenarioIds:chosen.map(x=>x.id).sort()}),provider:publicConfig(planningConfig),reviewer:reviewConfig?publicConfig(reviewConfig):{mode:'same-provider critique; not independent'},usageAccounting:aggregateUsage(records),summary,scores,records,limitations:['Token usage is reported only when provider metadata is returned; monetary cost is not estimated.','Existing-project scenarios use synthetic repository evidence fixtures.','Automated concept matching is a screening heuristic; human review remains required.']};
  const out=path.resolve(arg('out','benchmarks/results/run-'+Date.now()+'.json'));
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out,JSON.stringify(output,null,2)+'\n');
  const csv=['scenario_id,category,technical_correctness_1_5,requirement_understanding_1_5,task_decomposition_1_5,acceptance_criteria_1_5,scope_and_safety_1_5,clarification_quality_1_5,overall_1_5,reviewer_id,evidence_notes'];
  for(const row of scores) csv.push([row.scenarioId,row.category,'','','','','','','','',''].join(','));
  const humanPath=out.replace(/\.json$/,'-human-review.csv');
  await fs.writeFile(humanPath,csv.join('\n')+'\n');
  console.log(JSON.stringify({summary,resultFile:out,humanReviewFile:humanPath},null,2));
  return summary.passCount===summary.scenarioCount?0:2;
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode=await main(); }
  catch(error){console.error('Benchmark error: '+error.message);process.exitCode=1;}
}
