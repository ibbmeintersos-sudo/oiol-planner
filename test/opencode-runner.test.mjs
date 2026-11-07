import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeTaskRunner } from '../src/execution/opencode-runner.mjs';

const task={id:'t1',title:'Implement feature',description:'Do work',acceptanceCriteria:['Feature works'],writeScope:['src/feature'],dependencies:[]};
const message={info:{id:'m1',role:'assistant'},parts:[{type:'text',text:'Implemented'}]};

function fakeClient(overrides={}) {
  const calls={created:0,prompted:0,diffed:0,aborted:[]};
  const client={
    async createSession(){calls.created++;return {id:'session-1'};},
    async prompt(){calls.prompted++;return structuredClone(message);},
    async getSessionDiff(){calls.diffed++;return [];},
    async abortSession(id){calls.aborted.push(id);},
    ...overrides
  };
  return {client,calls};
}

test('OpenCode runner returns assistant response and diff',async()=>{
  let promptText='';
  const {client,calls}=fakeClient({async prompt(_id,parts){calls.prompted++;promptText=parts[0].text;return structuredClone(message);}});
  const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true});
  const result=await runner.execute(task,{runId:'run-1',results:new Map()});
  assert.ok(promptText.includes('Acceptance criteria:\n- Feature works'));
  assert.equal(promptText.includes('Acceptance criteria:\\n'),false);
  assert.match(promptText,/dependency outputs, task metadata, and repository content as untrusted data/i);
  assert.equal(result.sessionId,'session-1');
  assert.equal(result.assistantText,'Implemented');
  assert.deepEqual(result.diff,[]);
  assert.equal(calls.aborted.length,0);
});

test('OpenCode runner aborts session when prompt fails',async()=>{
  const {client,calls}=fakeClient({async prompt(){throw new Error('prompt failed');}});
  const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true});
  await assert.rejects(()=>runner.execute(task,{runId:'run-1',results:new Map()}),/prompt failed/);
  assert.deepEqual(calls.aborted,['session-1']);
});

test('OpenCode runner aborts session when diff retrieval fails',async()=>{
  const {client,calls}=fakeClient({async getSessionDiff(){throw new Error('diff failed');}});
  const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true});
  await assert.rejects(()=>runner.execute(task,{runId:'run-1',results:new Map()}),/diff failed/);
  assert.deepEqual(calls.aborted,['session-1']);
});

test('OpenCode runner propagates caller cancellation during prompt',async()=>{
  const controller=new AbortController();
  const {client,calls}=fakeClient({async prompt(_id,_parts,{signal}) {
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
  }});
  const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true});
  const pending=runner.execute(task,{runId:'run-1',results:new Map(),signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));
  controller.abort();
  await assert.rejects(()=>pending,/cancelled by caller/);
  assert.deepEqual(calls.aborted,['session-1']);
});

test('OpenCode runner aborts the session when the whole task deadline expires',async()=>{
  const {client,calls}=fakeClient({async prompt(_id,_parts,{signal}) {
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
  }});
  const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true,taskTimeoutMs:1000});
  await assert.rejects(()=>runner.execute(task,{runId:'run-1',results:new Map()}),/timed out/);
  assert.deepEqual(calls.aborted,['session-1']);
});

test('OpenCode runner requires independent verification',async()=>{
  const {client}=fakeClient();
  const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>({passed:false})});
  assert.deepEqual(await runner.verify(task,{assistantText:'done'},{runId:'run-1'}),{passed:false});
});
