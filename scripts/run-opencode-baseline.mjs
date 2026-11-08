#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { OpenCodeClient } from '../benchmarks/opencode/client.mjs';
import { runOpenCodeBaselineScenario } from '../benchmarks/opencode/baseline.mjs';
import { REVIEW_SYSTEM_PROMPT } from '../src/core/prompts.mjs';
import { createProvider } from '../src/providers/index.mjs';
import { validatePlan } from '../src/core/validator.mjs';
import { validatePlanSchema } from '../src/core/schema-validator.mjs';
import { scenarios } from '../benchmarks/scenarios.mjs';
import { scoreScenario, summarizeBenchmark } from '../benchmarks/scoring.mjs';
import { selectScenarios, applyScenarioTaskFile, resolveScenarioProject, assertExternalRepositorySnapshot, summarizeRepositoryEvidence, providerConfig, benchmarkConfigFingerprint, aggregateUsage } from './run-planner-benchmark.mjs';

function arg(name,fallback){const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:fallback;}

export async function createBaselineWorkspace(scenario, { repositoryRoot = null, project = null } = {}) {
 const tempRoot=await fs.mkdtemp(path.join(os.tmpdir(),'oiol-opencode-baseline-'));
 const projectDirectory=path.join(tempRoot,'project');
 try {
  if(repositoryRoot) {
   if(scenario?.project?.kind!=='existing'||project?.repository?.root!=='external-repository') {
    throw new Error('External baseline workspace requires a scanned Existing Project repository');
   }
   await fs.mkdir(projectDirectory,{recursive:true});
   // Materialize only bounded, redacted scanner excerpts; never copy the operator's raw checkout.
   for(const snippet of project.repository.snippets||[]) {
    if(typeof snippet.path!=='string'||typeof snippet.content!=='string') continue;
    const relative=snippet.path.replaceAll('\\','/');
    if(relative.startsWith('/')||relative.split('/').some(part=>part==='..'||part==='.')) continue;
    const destination=path.resolve(projectDirectory,...relative.split('/'));
    if(!destination.startsWith(projectDirectory+path.sep)) continue;
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,snippet.content,'utf8');
   }
  } else if(scenario?.project?.fixturePath) {
   const fixtureSource=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..',scenario.project.fixturePath);
   await fs.cp(fixtureSource,projectDirectory,{recursive:true});
  } else await fs.mkdir(projectDirectory,{recursive:true});
  return {tempRoot,projectDirectory,cleanup:()=>fs.rm(tempRoot,{recursive:true,force:true})};
 } catch(error) {
  await fs.rm(tempRoot,{recursive:true,force:true}).catch(()=>{});
  throw error;
 }
}
function parseModelRef(value){
 if(!value)return null;
 const index=value.indexOf('/');
 if(index<=0||index===value.length-1)throw new Error('OIOL_OPENCODE_MODEL must use providerID/modelID format');
 return {providerID:value.slice(0,index),modelID:value.slice(index+1)};
}
function validateReview(review){
 if(!review||!['approved','needs_revision','blocked'].includes(review.status)||!Array.isArray(review.findings))throw new Error('Reviewer returned an invalid review contract');
 for(const finding of review.findings)if(!finding||!['low','medium','high','critical'].includes(finding.severity)||typeof finding.message!=='string')throw new Error('Reviewer returned an invalid finding');
 return {...review,summary:typeof review.summary==='string'?review.summary:''};
}
async function attachReviewer(plan,project,reviewer,reviewConfig,modelRef,usage){
 const semantic=validatePlan(plan,project);
 const schemaValidation=await validatePlanSchema(plan);
 const validation={
  ...semantic,
  valid:semantic.valid&&schemaValidation.valid,
  errors:[...semantic.errors,...schemaValidation.errors.map(error=>'Schema: '+error)],
  schemaValidation
 };
 plan.validation=validation;
 if(!validation.valid){
  plan.status='blocked';
  plan.review={status:'needs_revision',summary:'Reviewer skipped because the baseline plan failed contract validation',findings:[],configurationDistinct:false,configurationDifference:[]};
  return;
 }
 if(!reviewer){
  plan.review={status:'needs_revision',summary:'No distinct reviewer configuration supplied for the OpenCode baseline',findings:[],configurationDistinct:false,configurationDifference:[]};
  plan.status='needs_revision';
  return;
 }
 try{
  const result=await reviewer.requestJson({system:REVIEW_SYSTEM_PROMPT,user:JSON.stringify({project,plan,validation},null,2),temperature:0});
  usage.reviewer.requests++;
  usage.reviewer.calls.push({model:result.model||reviewer.model||null,usage:result.usage||null});
  const review=validateReview(result.data);
  const differences=[];
  if(reviewConfig.provider!==modelRef.providerID)differences.push('provider');
  if(reviewConfig.model!==modelRef.modelID)differences.push('model');
  const configurationDistinct=differences.length>0;
  plan.review={...review,configurationDistinct,configurationDifference:differences};
  if(review.status==='blocked'||review.findings.some(x=>x.severity==='critical'))plan.status='blocked';
  else if(review.status!=='approved'||review.findings.some(x=>x.severity==='high')||!configurationDistinct)plan.status='needs_revision';
  else plan.status='ready_for_review';
 }catch(error){
  plan.review={status:'needs_revision',summary:'Reviewer request failed: '+error.message,findings:[],configurationDistinct:false,configurationDifference:[]};
  plan.status='needs_revision';
 }
}

export async function main(){
 const selectedScenarios=selectScenarios(arg('scenarios','all'));
 const taskApplication=await applyScenarioTaskFile(selectedScenarios,arg('task-file',null));
 const chosen=taskApplication.scenarios;
 const taskDefinition=taskApplication.taskDefinition;
 const repositoryRoot=arg('repo',process.env.OIOL_BENCHMARK_REPOSITORY||null);
 if(repositoryRoot && chosen.some(scenario=>scenario.project?.kind!=='existing')) throw new Error('--repo can only be used with Existing Project scenarios');
 if(repositoryRoot && !taskDefinition) throw new Error('External repository benchmarks require --task-file with a repository-specific task and scoring rubric');
 if(process.argv.includes('--list')){for(const s of scenarios)console.log(s.id+' ['+s.category+'/'+s.difficulty+']');return 0;}
 const baseConfig={baseUrl:process.env.OIOL_OPENCODE_URL||'http://127.0.0.1:4096',username:process.env.OIOL_OPENCODE_USERNAME||'opencode',password:process.env.OIOL_OPENCODE_PASSWORD||'',agent:process.env.OIOL_OPENCODE_AGENT||'plan',modelRef:parseModelRef(process.env.OIOL_OPENCODE_MODEL),timeoutMs:Number(process.env.OIOL_OPENCODE_TIMEOUT_MS||600000)};
 const reviewConfig=process.env.OIOL_REVIEW_PROVIDER?providerConfig('OIOL_REVIEW_'):null;
 const configView={baseUrl:baseConfig.baseUrl,username:baseConfig.username,agent:baseConfig.agent,model:baseConfig.modelRef,timeoutMs:baseConfig.timeoutMs,credentialConfigured:Boolean(baseConfig.password),reviewer:reviewConfig?{provider:reviewConfig.provider,model:reviewConfig.model,baseUrl:reviewConfig.baseUrl,credentialConfigured:Boolean(reviewConfig.apiKey)}:null};
 if(process.argv.includes('--dry-run')){console.log(JSON.stringify({dryRun:true,benchmarkMode:'opencode-baseline',selected:chosen.map(x=>x.id),sourceMode:repositoryRoot?'external-local-checkout':'checked-in-fixtures',taskDefinition,config:configView,liveCalls:false},null,2));return 0;}
 if(process.env.OIOL_BENCHMARK_ALLOW_LIVE!=='1')throw new Error('Set OIOL_BENCHMARK_ALLOW_LIVE=1 to confirm OpenCode baseline calls.');
 if(repositoryRoot && process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE!=='1')throw new Error('Set OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE=1 to confirm that bounded, redacted external repository excerpts may be sent to the configured model provider.');
 if(!baseConfig.modelRef)throw new Error('Set OIOL_OPENCODE_MODEL=providerID/modelID so the baseline model is explicit and auditable.');
 if(reviewConfig&&!reviewConfig.apiKey&&reviewConfig.provider!=='ollama')throw new Error('OIOL_REVIEW_API_KEY is required for the configured remote reviewer.');
 const reviewer=reviewConfig?createProvider(reviewConfig):null;
 const records=[];
 for(const scenario of chosen){
  const started=Date.now();
  let project=null,workspace=null,record=null,workspaceCleanupWarning=null;
  try{
   project=await resolveScenarioProject(scenario,{repositoryRoot});
   if(repositoryRoot) assertExternalRepositorySnapshot(project);
   workspace=await createBaselineWorkspace(scenario,{repositoryRoot,project});
   const client=new OpenCodeClient({baseUrl:baseConfig.baseUrl,username:baseConfig.username,password:baseConfig.password,directory:workspace.projectDirectory,timeoutMs:baseConfig.timeoutMs});
   const baseline=await runOpenCodeBaselineScenario({client,scenario,project,agent:baseConfig.agent,model:baseConfig.modelRef});
   const plan=baseline.plan;
   const usage={planner:{requests:0,calls:[]},reviewer:{requests:0,calls:[]}};
   usage.planner.requests=1;
   usage.planner.calls.push({model:baseline.messageInfo?.model||baseConfig.modelRef?.modelID||null,usage:baseline.usage||null});
   await attachReviewer(plan,project,reviewer,reviewConfig,baseConfig.modelRef,usage);
   plan.providerUsage=usage;
   record={scenarioId:scenario.id,elapsedMs:Date.now()-started,projectEvidence:summarizeRepositoryEvidence(project),plan,cleanupWarning:baseline.cleanupWarning,diffCount:baseline.diffCount};
  }catch(error){
   record={scenarioId:scenario.id,elapsedMs:Date.now()-started,error:{name:error.name,message:error.message,cleanupWarning:error.cleanupWarning||null}};
  }finally{
   if(workspace){try{await workspace.cleanup();}catch(error){workspaceCleanupWarning=error.message;}}
  }
  if(workspaceCleanupWarning)record.workspaceCleanupWarning=workspaceCleanupWarning;
  records.push(record);
  if(record.error)console.error('['+scenario.id+'] ERROR: '+record.error.message);
  else console.log('['+scenario.id+'] '+record.plan.status+' in '+record.elapsedMs+'ms');
 }
 const scores=records.map(record=>{const scenario=chosen.find(x=>x.id===record.scenarioId);return record.error?{scenarioId:record.scenarioId,category:scenario.category,difficulty:scenario.difficulty,score:0,blockers:[record.error.message]}:scoreScenario(scenario,record);});
 const summary=summarizeBenchmark(scores);
 const repositoryCommitShas=repositoryRoot?[...new Set(records.map(x=>x.projectEvidence?.git?.commit).filter(Boolean))].sort():[];
 const publicReview=reviewConfig?{provider:reviewConfig.provider,model:reviewConfig.model,baseUrl:reviewConfig.baseUrl,timeoutMs:reviewConfig.timeoutMs,maxRetries:reviewConfig.maxRetries,credentialConfigured:Boolean(reviewConfig.apiKey)}:{mode:'no distinct reviewer configuration supplied'};
 const comparisonKey=process.env.OIOL_BENCHMARK_COMPARISON_KEY||null,budgetKey=process.env.OIOL_BENCHMARK_BUDGET_KEY||null;
 const output={protocolVersion:'1.1',runnerVersion:'1.1.0',benchmarkMode:'opencode-baseline',sourceMode:repositoryRoot?'external-local-checkout':'checked-in-fixtures',taskDefinition,repositorySnapshot:repositoryRoot?{source:'operator-supplied local checkout',commitShas:[...new Set(records.map(x=>x.projectEvidence?.git?.commit).filter(Boolean))],allGitCommitsDetected:records.every(x=>Boolean(x.projectEvidence?.git?.commit)),workspaceProjection:'bounded redacted scanner excerpts'}:null,comparisonKey,budgetKey,runId:createHash('sha256').update(Date.now()+'|'+process.pid+'|baseline|'+chosen.map(x=>x.id).join(',')).digest('hex').slice(0,16),createdAt:new Date().toISOString(),configFingerprint:benchmarkConfigFingerprint({protocolVersion:'1.1',benchmarkMode:'opencode-baseline',sourceMode:repositoryRoot?'external-local-checkout':'checked-in-fixtures',repositoryCommitShas,taskDefinition,comparisonKey,budgetKey,openCode:{baseUrl:baseConfig.baseUrl,agent:baseConfig.agent,model:baseConfig.modelRef},reviewer:publicReview,scenarioIds:chosen.map(x=>x.id).sort()}),provider:{name:'OpenCode',baseUrl:baseConfig.baseUrl,agent:baseConfig.agent,model:baseConfig.modelRef},reviewer:publicReview,usageAccounting:aggregateUsage(records),summary,scores,records,limitations:['OpenCode baseline requires an explicitly selected read-only plan agent.','OpenCode token usage is included only if the message response exposes compatible usage metadata.','External repository mode materializes only bounded redacted scanner excerpts in the disposable baseline workspace; it does not copy the raw checkout.','For a fair paired comparison, use the same scenario selection, repository fixtures, model, reviewer, and resource budget in both modes.','OpenCode model and agent configuration must be recorded; a default server model cannot be assumed equivalent to the OIOL provider model.']};
 const out=path.resolve(arg('out','benchmarks/results/opencode-baseline-'+Date.now()+'.json'));
 await fs.mkdir(path.dirname(out),{recursive:true});
 await fs.writeFile(out,JSON.stringify(output,null,2)+'\n');
 const humanPath=out.replace(/\.json$/,'-human-review.csv');
 const csv=['scenario_id,category,technical_correctness_1_5,requirement_understanding_1_5,task_decomposition_1_5,acceptance_criteria_1_5,scope_and_safety_1_5,clarification_quality_1_5,overall_1_5,reviewer_id,evidence_notes',...scores.map(x=>[x.scenarioId,x.category,'','','','','','','','',''].join(','))];
 await fs.writeFile(humanPath,csv.join('\n')+'\n');
 console.log(JSON.stringify({summary,resultFile:out,humanReviewFile:humanPath},null,2));
 return summary.passCount===summary.scenarioCount?0:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{process.exitCode=await main();}catch(error){console.error('OpenCode baseline error: '+error.message);process.exitCode=1;}}
