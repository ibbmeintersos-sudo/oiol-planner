import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBaselinePrompt, parseBaselinePlan, runOpenCodeBaselineScenario } from '../benchmarks/opencode/baseline.mjs';

const scenario={id:'GF-API-001',project:{kind:'greenfield',name:'Test API',request:'Create an API'}};
const validPlan={contractVersion:'1.0',id:'p1',status:'needs_revision',project:scenario.project,requirements:[],architecture:{components:[],decisions:[]},tasks:[],dependencyGraph:{nodes:[],edges:[]},risks:[],evidence:[],clarifications:[],review:null};

function makeV2Mock({ assistantText = JSON.stringify(validPlan), diff = [] } = {}) {
 const calls=[];
 const client={
  async health(){calls.push(['health']);return {version:'2.2.5'};},
  async createSession(title,options){calls.push(['create',title,options]);return {id:'ses_test'};},
  async prompt(id,input){calls.push(['prompt',id]);assert.equal(typeof input[0].text,'string');assert.match(input[0].text,/Do not modify files/);return {id:'msg_user',type:'user'};},
  async waitSession(id){calls.push(['wait',id]);return null;},
  async getSessionMessages(id){calls.push(['messages',id]);return [
   {id:'msg_assistant',type:'assistant',model:{providerID:'test',id:'model'},tokens:{input:10,output:20},content:[{type:'text',text:assistantText}]},
   {id:'msg_user',type:'user',text:'benchmark prompt'}
  ];},
  async getSessionDiff(id){calls.push(['diff',id]);return diff;},
  async deleteSession(id){calls.push(['delete',id]);return null;}
 };
 return {client,calls};
}

test('baseline prompt explicitly prohibits implementation and embeds the identical project input',()=>{
 const prompt=buildBaselinePrompt(scenario.project);
 assert.match(prompt,/without the OIOL planning layer/);
 assert.match(prompt,/Do not modify files, execute commands/);
 assert.ok(prompt.includes(JSON.stringify(scenario.project,null,2)));
});

test('baseline parser accepts strict JSON and fenced JSON but rejects invalid output',()=>{
 assert.deepEqual(parseBaselinePlan(JSON.stringify(validPlan)),validPlan);
 assert.deepEqual(parseBaselinePlan('```json\n'+JSON.stringify(validPlan)+'\n```'),validPlan);
 assert.throws(()=>parseBaselinePlan('not JSON'),/valid JSON plan/);
});


test('OpenCode V2 baseline checks protocol, creates a read-only session, waits, reads messages, and cleans up',async()=>{
 const {client,calls}=makeV2Mock();
 const result=await runOpenCodeBaselineScenario({client,scenario,agent:'plan',model:{providerID:'test',modelID:'model'}});
 assert.equal(result.plan.id,'p1');
 assert.equal(result.sessionId,'ses_test');
 assert.equal(result.submittedMessageId,'msg_user');
 assert.equal(result.messageId,'msg_assistant');
 assert.equal(result.serverVersion,'2.2.5');
 assert.equal(calls[0][0],'health');
 assert.equal(calls.find(x=>x[0]==='create')[2].agent,'plan');
 assert.equal(calls.find(x=>x[0]==='create')[2].model.modelID,'model');
 assert.equal(calls.some(x=>x[0]==='wait'),true);
 assert.equal(calls.some(x=>x[0]==='messages'),true);
 assert.equal(calls.filter(x=>x[0]==='delete').length,1);
});

test('OpenCode V2 baseline rejects an incompatible server before creating a session',async()=>{
 let created=false;
 const client={health:async()=>{throw new Error('OpenCode HTTP 404');},createSession:async()=>{created=true;return {id:'ses_never'};}};
 await assert.rejects(()=>runOpenCodeBaselineScenario({client,scenario}),/HTTP 404/);
 assert.equal(created,false);
});

test('OpenCode V2 baseline deletes a session when the assistant returns invalid JSON',async()=>{
 const {client,calls}=makeV2Mock({assistantText:'not JSON'});
 await assert.rejects(()=>runOpenCodeBaselineScenario({client,scenario}),/valid JSON plan/);
 assert.equal(calls.filter(x=>x[0]==='delete').length,1);
});

test('OpenCode V2 baseline rejects changes to the disposable read-only workspace',async()=>{
 const {client,calls}=makeV2Mock({diff:[{file:'src/unauthorized.mjs'}]});
 await assert.rejects(()=>runOpenCodeBaselineScenario({client,scenario}),/violated its read-only contract/);
 assert.equal(calls.filter(x=>x[0]==='delete').length,1);
});

test('OpenCode V2 client uses V2 endpoints, envelopes, model references, and workspace location',async()=>{
 const calls=[];
 const fetchImpl=async(url,init={})=>{
  const parsed=new URL(String(url));
  const body=init.body?JSON.parse(init.body):null;
  calls.push({path:parsed.pathname+parsed.search,method:init.method||'GET',body});
  if(parsed.pathname==='/api/info')return new Response(JSON.stringify({version:'2.2.5',pid:123}),{status:200});
  if(parsed.pathname==='/api/session'&&init.method==='POST')return new Response(JSON.stringify({data:{id:'ses_test'}}),{status:200});
  if(parsed.pathname==='/api/session/ses_test/prompt')return new Response(JSON.stringify({data:{id:'msg_user',type:'user'}}),{status:200});
  if(parsed.pathname==='/api/session/ses_test/message')return new Response(JSON.stringify({data:[],cursor:{}}),{status:200});
  if(parsed.pathname==='/api/session/ses_test/diff')return new Response(JSON.stringify({data:[]}),{status:200});
  if(parsed.pathname.endsWith('/wait')||(parsed.pathname==='/api/session/ses_test'&&init.method==='DELETE'))return new Response(null,{status:204});
  return new Response('not found',{status:404});
 };
 const directory=path.resolve(process.cwd());
 const client=new OpenCodeClient({baseUrl:'http://127.0.0.1:4096',username:'opencode',password:'test-password',directory,fetchImpl});
 assert.equal((await client.health()).version,'2.2.5');
 assert.equal((await client.createSession('pilot',{agent:'plan',model:{providerID:'test-provider',modelID:'test-model'}})).id,'ses_test');
 assert.equal((await client.prompt('ses_test',[{type:'text',text:'Plan only'}])).id,'msg_user');
 await client.waitSession('ses_test');
 assert.deepEqual(await client.getSessionMessages('ses_test'),[]);
 assert.deepEqual(await client.getSessionDiff('ses_test'),[]);
 await client.deleteSession('ses_test');
 assert.deepEqual(calls.map(x=>[x.method,x.path]),[
  ['GET','/api/info'],
  ['POST','/api/session'],
  ['POST','/api/session/ses_test/prompt'],
  ['POST','/api/experimental/session/ses_test/wait'],
  ['GET','/api/session/ses_test/message?order=desc&limit=200'],
  ['GET','/api/session/ses_test/diff'],
  ['DELETE','/api/session/ses_test']
 ]);
 assert.deepEqual(calls[1].body.location,{directory});
 assert.equal(calls[1].body.agent,'plan');
 assert.deepEqual(calls[1].body.model,{providerID:'test-provider',id:'test-model'});
 assert.deepEqual(calls[2].body,{text:'Plan only'});
});

import { main as baselineMain, createBaselineWorkspace } from '../scripts/run-opencode-baseline.mjs';
import { resolveScenarioProject } from '../scripts/run-planner-benchmark.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

test('OpenCode baseline runner dry-run validates config without contacting OpenCode',async()=>{
 const previousArgv=process.argv,previousOptIn=process.env.OIOL_BENCHMARK_ALLOW_LIVE;
 const lines=[],previousLog=console.log;
 try{
  process.argv=['node','run-opencode-baseline.mjs','--scenarios','GF-API-001','--dry-run'];
  delete process.env.OIOL_BENCHMARK_ALLOW_LIVE;
  console.log=value=>lines.push(String(value));
  assert.equal(await baselineMain(),0);
  const result=JSON.parse(lines.at(-1));
  assert.equal(result.dryRun,true);
  assert.equal(result.benchmarkMode,'opencode-baseline');
  assert.deepEqual(result.selected,['GF-API-001']);
  assert.equal(result.liveCalls,false);
 }finally{
  process.argv=previousArgv;
  if(previousOptIn===undefined)delete process.env.OIOL_BENCHMARK_ALLOW_LIVE;else process.env.OIOL_BENCHMARK_ALLOW_LIVE=previousOptIn;
  console.log=previousLog;
 }
});

test('baseline workspace copies fixtures into a disposable directory and cleans it up',async()=>{
 const fixtureScenario={id:'EX-API-003',project:{fixturePath:'benchmarks/fixtures/customer-api'}};
 const workspace=await createBaselineWorkspace(fixtureScenario);
 try {
  assert.notEqual(workspace.projectDirectory,fixtureScenario.project.fixturePath);
  await fs.access(workspace.projectDirectory+'/package.json');
  await fs.access(workspace.projectDirectory+'/src/routes/customers.mjs');
 } finally { await workspace.cleanup(); }
 await assert.rejects(()=>fs.access(workspace.projectDirectory));
});

test('greenfield baseline receives an isolated empty workspace',async()=>{
 const workspace=await createBaselineWorkspace({id:'GF-API-001',project:{kind:'greenfield'}});
 try {
  assert.deepEqual(await fs.readdir(workspace.projectDirectory),[]);
 } finally { await workspace.cleanup(); }
});

test('external baseline workspace contains only bounded redacted scanner excerpts', async () => {
 const scenario={id:'EX-API-003',project:{kind:'existing',name:'External Customer API',request:'Review this project'}};
 const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../benchmarks/fixtures/customer-api');
 const project=await resolveScenarioProject(scenario,{repositoryRoot});
 const workspace=await createBaselineWorkspace(scenario,{repositoryRoot,project});
 try {
  assert.ok((await fs.readdir(workspace.projectDirectory)).length>0);
  await fs.access(path.join(workspace.projectDirectory,'src/routes/customers.mjs'));
  await assert.rejects(()=>fs.access(path.join(workspace.projectDirectory,'.git')));
  const source=await fs.readFile(path.join(workspace.projectDirectory,'src/routes/customers.mjs'),'utf8');
  assert.ok(source.length<=5000);
 } finally { await workspace.cleanup(); }
});

test('external OpenCode baseline requires explicit consent before sending repository excerpts', async () => {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'oiol-baseline-consent-'));
 const taskPath=path.join(directory,'task.json');
 const task={
  scenarioId:'EX-API-003',taskId:'RW-BASELINE-CONSENT-001',taskVersion:'1.0.0',
  projectName:'Consent Test',request:'Plan a repository change.',
  constraints:['Do not invent project facts'],
  expectedSignals:[['architecture']],evidencePaths:['src/service.ts'],mustClarify:false
 };
 const previousArgv=process.argv;
 const previousLive=process.env.OIOL_BENCHMARK_ALLOW_LIVE;
 const previousSource=process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE;
 try {
  await fs.writeFile(taskPath,JSON.stringify(task),'utf8');
  process.env.OIOL_BENCHMARK_ALLOW_LIVE='1';
  delete process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE;
  process.argv=['node','run-opencode-baseline.mjs','--repo','/unused/checkout','--task-file',taskPath,'--scenarios','EX-API-003'];
  await assert.rejects(()=>baselineMain(),/ALLOW_EXTERNAL_SOURCE=1/);
 } finally {
  process.argv=previousArgv;
  if(previousLive===undefined)delete process.env.OIOL_BENCHMARK_ALLOW_LIVE;else process.env.OIOL_BENCHMARK_ALLOW_LIVE=previousLive;
  if(previousSource===undefined)delete process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE;else process.env.OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE=previousSource;
  await fs.rm(directory,{recursive:true,force:true});
 }
});
