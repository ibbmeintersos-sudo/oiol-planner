import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBaselinePrompt, parseBaselinePlan, runOpenCodeBaselineScenario } from '../src/benchmark/opencode-baseline.mjs';

const scenario={id:'GF-API-001',project:{kind:'greenfield',name:'Test API',request:'Create an API'}};
const validPlan={contractVersion:'1.0',id:'p1',status:'needs_revision',project:scenario.project,requirements:[],architecture:{components:[],decisions:[]},tasks:[],dependencyGraph:{nodes:[],edges:[]},risks:[],evidence:[],clarifications:[],review:null};

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

test('OpenCode baseline creates a read-only planning session and always cleans it up',async()=>{
 const calls=[];
 const client={
  async createSession(title){calls.push(['create',title]);return {id:'session-1'};},
  async prompt(id,parts,options){calls.push(['prompt',id,options.agent,options.model]);assert.match(parts[0].text,/Do not modify files/);return {info:{role:'assistant',id:'message-1'},parts:[{type:'text',text:JSON.stringify(validPlan)}]};},
  async deleteSession(id){calls.push(['delete',id]);}
 };
 const result=await runOpenCodeBaselineScenario({client,scenario,agent:'plan',model:{providerID:'test',modelID:'model'}});
 assert.equal(result.plan.id,'p1');
 assert.equal(result.sessionId,'session-1');
 assert.equal(calls.filter(x=>x[0]==='delete').length,1);
 assert.equal(calls[1][2],'plan');
});

test('OpenCode baseline deletes a session even when the model returns invalid JSON',async()=>{
 let deleted=false;
 const client={
  async createSession(){return {id:'session-2'};},
  async prompt(){return {info:{role:'assistant'},parts:[{type:'text',text:'not JSON'}]};},
  async deleteSession(){deleted=true;}
 };
 await assert.rejects(()=>runOpenCodeBaselineScenario({client,scenario}),/valid JSON plan/);
 assert.equal(deleted,true);
});
