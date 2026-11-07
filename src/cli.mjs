#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeProject } from './analyzer/project-analyzer.mjs';
import { createProvider } from './providers/index.mjs';
import { HybridPlanner } from './core/planner.mjs';
import { evaluatePlan } from './core/evaluate.mjs';
import { deriveTaskInterfaces } from './core/task-interface.mjs';
import { buildTraceability } from './core/traceability.mjs';
function args(argv){const o={};for(let i=0;i<argv.length;i++){const x=argv[i];if(x==='--help'||x==='-h')o.help=true;else if(x.startsWith('--'))o[x.slice(2)]=argv[++i];}return o;}
const a=args(process.argv.slice(2));
if(a.help){console.log(`OIOL Planner v0.3.0\n\nUsage:\n  node src/cli.mjs --mode greenfield --name "My App" --request "Build ..." --out plan.json\n  node src/cli.mjs --mode existing --repo ./repo --request "Improve ..." --out plan.json\n\nEnvironment: OIOL_PROVIDER, OIOL_MODEL, OIOL_BASE_URL, OIOL_API_KEY, OIOL_TIMEOUT_MS, OIOL_MAX_RETRIES\nProviders: openai-compatible, anthropic, gemini, ollama`);process.exit(0);}
try{
 if(!a.mode||!['greenfield','existing'].includes(a.mode))throw new Error('--mode must be greenfield or existing');
 if(!a.request)throw new Error('--request is required');
 if(a.env){const {loadEnvFile}=await import('node:process');loadEnvFile(a.env);}else{try{process.loadEnvFile?.('.env');}catch{}}
 const project=await analyzeProject({mode:a.mode,name:a.name,request:a.request,repo:a.repo});
 const provider=createProvider({provider:process.env.OIOL_PROVIDER||'openai-compatible',model:process.env.OIOL_MODEL||'gpt-4o-mini',baseUrl:process.env.OIOL_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.OIOL_API_KEY,timeoutMs:Number(process.env.OIOL_TIMEOUT_MS||60000),maxRetries:Number(process.env.OIOL_MAX_RETRIES||2)});
 const reviewer=process.env.OIOL_REVIEW_PROVIDER?createProvider({provider:process.env.OIOL_REVIEW_PROVIDER,model:process.env.OIOL_REVIEW_MODEL||process.env.OIOL_MODEL||'gpt-4o-mini',baseUrl:process.env.OIOL_REVIEW_BASE_URL||process.env.OIOL_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.OIOL_REVIEW_API_KEY||process.env.OIOL_API_KEY,timeoutMs:Number(process.env.OIOL_REVIEW_TIMEOUT_MS||process.env.OIOL_TIMEOUT_MS||60000),maxRetries:Number(process.env.OIOL_MAX_RETRIES||2)}):provider;
 const planner=new HybridPlanner({provider,reviewer,maxRepairRounds:Number(a.repairs||2)});
 const plan=await planner.createPlan(project);plan.evaluation=evaluatePlan(plan,project);plan.taskInterfaces=deriveTaskInterfaces(plan);plan.traceability=buildTraceability(plan);
 const output=JSON.stringify(plan,null,2);if(a.out){await fs.mkdir(path.dirname(path.resolve(a.out)),{recursive:true});await fs.writeFile(a.out,output+'\n');console.log(`Plan written to ${path.resolve(a.out)} (status: ${plan.status})`);}else console.log(output);
 if(plan.status==='blocked')process.exitCode=2;
}catch(e){console.error(`OIOL error: ${e.message}`);process.exitCode=1;}
