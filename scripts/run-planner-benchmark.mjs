#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createProvider } from '../src/providers/index.mjs';
import { HybridPlanner } from '../src/core/planner.mjs';
import { scenarios } from '../benchmarks/scenarios.mjs';
import { scoreScenario, summarizeBenchmark } from '../benchmarks/scoring.mjs';

function arg(name,fallback){const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:fallback;}
try {
  if(process.env.OIOL_BENCHMARK_ALLOW_LIVE!=='1') throw new Error('Set OIOL_BENCHMARK_ALLOW_LIVE=1 to confirm that this run may call configured LLM providers.');
  if(!process.env.OIOL_API_KEY && (process.env.OIOL_PROVIDER||'openai-compatible')!=='ollama') throw new Error('OIOL_API_KEY is required for the configured remote planning provider.');
  const provider=createProvider({provider:process.env.OIOL_PROVIDER||'openai-compatible',model:process.env.OIOL_MODEL||'gpt-4o-mini',baseUrl:process.env.OIOL_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.OIOL_API_KEY,timeoutMs:Number(process.env.OIOL_TIMEOUT_MS||60000),maxRetries:Number(process.env.OIOL_MAX_RETRIES||2)});
  const reviewer=process.env.OIOL_REVIEW_PROVIDER?createProvider({provider:process.env.OIOL_REVIEW_PROVIDER,model:process.env.OIOL_REVIEW_MODEL||'gpt-4o-mini',baseUrl:process.env.OIOL_REVIEW_BASE_URL||process.env.OIOL_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.OIOL_REVIEW_API_KEY||process.env.OIOL_API_KEY,timeoutMs:Number(process.env.OIOL_REVIEW_TIMEOUT_MS||60000),maxRetries:Number(process.env.OIOL_MAX_RETRIES||2)}):provider;
  const selected=arg('scenarios','all');
  const chosen=selected==='all'?scenarios:scenarios.filter(x=>selected.split(',').includes(x.id));
  if(!chosen.length) throw new Error('No benchmark scenarios matched --scenarios');
  const records=[];
  for(const scenario of chosen){
    const started=Date.now();
    try{
      const plan=await new HybridPlanner({provider,reviewer,maxRepairRounds:Number(process.env.OIOL_MAX_REPAIR_ROUNDS||2)}).createPlan(scenario.project);
      records.push({scenarioId:scenario.id,elapsedMs:Date.now()-started,plan});
      console.log(`[${scenario.id}] ${plan.status} in ${Date.now()-started}ms`);
    }catch(error){
      records.push({scenarioId:scenario.id,elapsedMs:Date.now()-started,error:{name:error.name,message:error.message}});
      console.error(`[${scenario.id}] ERROR: ${error.message}`);
    }
  }
  const scores=records.map(record=>{const scenario=chosen.find(x=>x.id===record.scenarioId);return record.error?{scenarioId:record.scenarioId,category:scenario.category,difficulty:scenario.difficulty,score:0,blockers:[record.error.message]}:scoreScenario(scenario,record);});
  const summary=summarizeBenchmark(scores);
  const output={protocolVersion:'1.0',createdAt:new Date().toISOString(),provider:{name:process.env.OIOL_PROVIDER||'openai-compatible',model:process.env.OIOL_MODEL||'gpt-4o-mini'},reviewer:{name:process.env.OIOL_REVIEW_PROVIDER||process.env.OIOL_PROVIDER||'same-as-planner',model:process.env.OIOL_REVIEW_MODEL||process.env.OIOL_MODEL||'gpt-4o-mini'},summary,scores,records};
  const out=path.resolve(arg('out',`benchmarks/results/run-${Date.now()}.json`));
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out,JSON.stringify(output,null,2)+'\\n');
  const csv=['scenario_id,category,technical_correctness_1_5,requirement_understanding_1_5,task_decomposition_1_5,acceptance_criteria_1_5,scope_and_safety_1_5,clarification_quality_1_5,overall_1_5,reviewer_id,evidence_notes'];
  for(const row of scores) csv.push([row.scenarioId,row.category,'','','','','','','','',''].join(','));
  const humanPath=out.replace(/\\.json$/,'-human-review.csv');
  await fs.writeFile(humanPath,csv.join('\\n')+'\\n');
  console.log(JSON.stringify({summary,resultFile:out,humanReviewFile:humanPath},null,2));
  if(summary.passCount!==summary.scenarioCount) process.exitCode=2;
}catch(error){console.error(`Benchmark error: ${error.message}`);process.exitCode=1;}
