import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExecutionEngine, createExecutionApproval } from '../src/execution/engine.mjs';
import { InMemoryEventStore, JsonlEventStore } from '../src/execution/event-store.mjs';
import { canTransition, transitionTask } from '../src/execution/state-machine.mjs';
import { inspectExecutionRun } from '../src/execution/recovery-inspector.mjs';
function makePlan(){
  const tasks=[
    {id:'t1',title:'First task',description:'First',requirementIds:['r1'],componentIds:['c1'],dependencies:[],acceptanceCriteria:['First is done'],writeScope:['src/first']},
    {id:'t2',title:'Dependent task',description:'Second',requirementIds:['r1'],componentIds:['c1'],dependencies:['t1'],acceptanceCriteria:['Second is done'],writeScope:['src/second']},
    {id:'t3',title:'Independent task',description:'Third',requirementIds:['r1'],componentIds:['c1'],dependencies:[],acceptanceCriteria:['Third is done'],writeScope:['docs']}
  ];
  return {id:'plan_test',status:'ready_for_review',project:{kind:'greenfield'},requirements:[{id:'r1',statement:'Build feature'}],architecture:{components:[{id:'c1',name:'Core'}],decisions:[]},tasks,dependencyGraph:{nodes:['t1','t2','t3'],edges:[{from:'t1',to:'t2',type:'finish_to_start'}]},risks:[],clarifications:[]};
}
const approved=plan=>createExecutionApproval(plan,{approvedBy:'test-operator'});
const makeEngine=options=>new ExecutionEngine({eventStore:new InMemoryEventStore(),...options});
const successRunner={async execute(task){return {summary:`Executed ${task.id}`,outputs:{artifact:`${task.id}.txt`}};},async verify(){return {passed:true,method:'unit-test'};}};
test('execution requires explicit approval',async()=>{const plan=makePlan();const engine=makeEngine({runner:successRunner});await assert.rejects(()=>engine.run(plan),/Explicit human approval/);});
test('approval is bound to exact plan revision',async()=>{const plan=makePlan(),approval=approved(plan);plan.tasks[0].title='tampered';const engine=makeEngine({runner:successRunner});await assert.rejects(()=>engine.run(plan,{approval}),/does not match/);});
test('execution validates plan before starting',async()=>{const plan=makePlan();plan.dependencyGraph.nodes=[];const engine=makeEngine({runner:successRunner});await assert.rejects(()=>engine.run(plan,{approval:approved(plan)}),/failed execution validation/);});
test('tasks run in dependency order and event sequence is monotonic',async()=>{const plan=makePlan(),store=new InMemoryEventStore(),order=[];const runner={async execute(task){order.push(task.id);return {summary:task.id};},async verify(){return true;}};const result=await makeEngine({runner,eventStore:store,maxConcurrency:2}).run(plan,{approval:approved(plan),runId:'run-order'});assert.equal(result.status,'completed');assert.equal(result.counts.completed,3);assert.ok(order.indexOf('t1')<order.indexOf('t2'));const events=await store.read('run-order');assert.deepEqual(events.map(x=>x.sequence),events.map((_,i)=>i+1));assert.equal(events.at(-1).type,'run.finished');});
test('bounded concurrency is respected',async()=>{const plan=makePlan();let active=0,peak=0;const runner={concurrentSafe:true,async execute(){active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return {};},async verify(){return true;}};await makeEngine({runner,maxConcurrency:2}).run(plan,{approval:approved(plan)});assert.equal(peak,2);});
test('failed dependency blocks its dependents while independent tasks continue',async()=>{const plan=makePlan(),executed=[];const runner={async execute(task){executed.push(task.id);if(task.id==='t1')throw new Error('compile failed');return {};},async verify(){return true;}};const result=await makeEngine({runner,maxRetries:0}).run(plan,{approval:approved(plan)});assert.equal(result.tasks.t1.status,'failed');assert.equal(result.tasks.t2.status,'blocked');assert.equal(result.tasks.t3.status,'completed');assert.deepEqual(executed.sort(),['t1','t3']);});
test('transient task failure retries with a stable idempotency key',async()=>{const plan=makePlan(),keys=[];let attempts=0;const runner={idempotent:true,async execute(task,context){if(task.id==='t1'){keys.push(context.idempotencyKey);attempts++;if(attempts===1)throw Object.assign(new Error('temporary'),{retryable:true});}return {};},async verify(){return true;}};const result=await makeEngine({runner,maxRetries:1}).run(plan,{approval:approved(plan)});assert.equal(result.tasks.t1.status,'completed');assert.equal(result.tasks.t1.attempts,2);assert.equal(keys[0],keys[1]);});
test('verification failure fails the task and blocks dependents',async()=>{const plan=makePlan(),runner={async execute(){return {};},async verify(task){return {passed:task.id!=='t1',message:'acceptance failed'};}};const result=await makeEngine({runner,maxRetries:0}).run(plan,{approval:approved(plan)});assert.equal(result.tasks.t1.status,'failed');assert.equal(result.tasks.t2.status,'blocked');});
test('failFast skips work that has not started after a failure',async()=>{const plan=makePlan(),runner={async execute(task){if(task.id==='t1')throw new Error('failed');return {};},async verify(){return true;}};const result=await makeEngine({runner,maxRetries:0,maxConcurrency:1,failFast:true}).run(plan,{approval:approved(plan)});assert.equal(result.status,'failed');assert.equal(result.tasks.t3.status,'skipped');assert.equal(result.tasks.t2.status,'skipped');});
test('pre-aborted run records cancellation and skips pending tasks',async()=>{const plan=makePlan(),controller=new AbortController();controller.abort();const result=await makeEngine({runner:successRunner}).run(plan,{approval:approved(plan),signal:controller.signal});assert.equal(result.status,'cancelled');assert.equal(result.counts.skipped,3);});
test('run IDs cannot be reused',async()=>{const plan=makePlan(),store=new InMemoryEventStore(),engine=makeEngine({runner:successRunner,eventStore:store});await engine.run(plan,{approval:approved(plan),runId:'same'});await assert.rejects(()=>engine.run(plan,{approval:approved(plan),runId:'same'}),/already exists/);});
test('JSONL event store persists and reads ordered run events',async()=>{const directory=await mkdtemp(path.join(os.tmpdir(),'oiol-events-'));try{const file=path.join(directory,'events.jsonl'),store=new JsonlEventStore(file);await store.append({eventId:'e1',runId:'r1',sequence:1,type:'first',at:new Date().toISOString()});await store.append({eventId:'e2',runId:'r1',sequence:2,type:'second',at:new Date().toISOString()});await store.append({eventId:'e3',runId:'r2',sequence:1,type:'other',at:new Date().toISOString()});const events=await store.read('r1');assert.deepEqual(events.map(x=>x.type),['first','second']);assert.equal((await readFile(file,'utf8')).trim().split('\n').length,3);}finally{await rm(directory,{recursive:true,force:true});}});
test('state machine rejects illegal transitions',()=>{assert.equal(canTransition('pending','running'),false);const states=new Map([['t1',{taskId:'t1',status:'pending'}]]);assert.throws(()=>transitionTask(states,'t1','completed'),/Illegal task state transition/);});
test('engine requires a runner with both execute and verify',()=>assert.throws(()=>makeEngine({runner:{execute(){}}}),/execute.*verify/));
test('engine requires an explicit event store',()=>assert.throws(()=>new ExecutionEngine({runner:successRunner}),/Event store must implement/));

test('runner receives outputs only from declared dependencies',async()=>{const plan=makePlan(),seen={};const runner={async execute(task,context){seen[task.id]=[...context.results.keys()];return {outputs:{id:task.id}};},async verify(){return true;}};await makeEngine({runner}).run(plan,{approval:approved(plan)});assert.deepEqual(seen.t1,[]);assert.deepEqual(seen.t3,[]);assert.deepEqual(seen.t2,['t1']);});
test('durable failure events redact common credential patterns',async()=>{const plan=makePlan(),store=new InMemoryEventStore(),runner={async execute(){throw new Error('api_key=super-secret-value');},async verify(){return true;}};await makeEngine({runner,eventStore:store,maxRetries:0}).run(plan,{approval:approved(plan),runId:'redact-run'});const failed=(await store.read('redact-run')).find(event=>event.type==='task.failed');assert.ok(failed);assert.doesNotMatch(failed.error,/super-secret-value/);assert.match(failed.error,/REDACTED/);});

test('JSONL event store rejects duplicate sequence numbers',async()=>{const directory=await mkdtemp(path.join(os.tmpdir(),'oiol-events-'));try{const store=new JsonlEventStore(path.join(directory,'events.jsonl'));await store.append({eventId:'e1',runId:'dup',sequence:1,type:'first',at:new Date().toISOString()});await assert.rejects(()=>store.append({eventId:'e2',runId:'dup',sequence:1,type:'duplicate',at:new Date().toISOString()}),/Non-monotonic event sequence/);}finally{await rm(directory,{recursive:true,force:true});}});

test('task retries are disabled by default to avoid duplicate side effects',async()=>{const plan=makePlan();let calls=0;const runner={async execute(task){if(task.id==='t1'){calls++;throw new Error('not idempotent');}return {};},async verify(){return true;}};const result=await makeEngine({runner}).run(plan,{approval:approved(plan)});assert.equal(calls,1);assert.equal(result.tasks.t1.attempts,1);});
test('execution rejects plans that are not ready for review',async()=>{const plan=makePlan();plan.status='blocked';const engine=makeEngine({runner:successRunner});await assert.rejects(()=>engine.run(plan,{approval:approved(plan)}),/status must be ready_for_review/);});
test('approval helper rejects invalid timestamps',()=>assert.throws(()=>createExecutionApproval(makePlan(),{approvedBy:'operator',approvedAt:'not-a-date'}),/valid timestamp/));

test('engine serializes runners unless they explicitly declare concurrency safety',async()=>{const plan=makePlan();let active=0,peak=0;const runner={async execute(){active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {};},async verify(){return true;}};await makeEngine({runner,maxConcurrency:3}).run(plan,{approval:approved(plan)});assert.equal(peak,1);});

test('retries require explicit idempotency and retryable errors',async()=>{
  const plan=makePlan();let calls=0;
  const unsafeRunner={async execute(){calls++;throw Object.assign(new Error('temporary'),{retryable:true});},async verify(){return true;}};
  assert.throws(()=>makeEngine({runner:unsafeRunner,maxRetries:1}),/idempotent execution/);
  const runner={idempotent:true,async execute(){calls++;throw new Error('permanent');},async verify(){return true;}};
  const result=await makeEngine({runner,maxRetries:3}).run(plan,{approval:approved(plan)});
  assert.equal(calls,2);
  assert.equal(result.tasks.t1.attempts,1);
  assert.equal(result.tasks.t1.status,'failed');
});

test('event stores reject malformed and non-monotonic events',async()=>{
  const store=new InMemoryEventStore();
  await assert.rejects(()=>store.append({runId:'r',sequence:1,type:'started'}),/eventId is required/);
  await store.append({eventId:'e1',runId:'r',sequence:1,type:'run.started',at:new Date().toISOString()});
  await assert.rejects(()=>store.append({eventId:'e2',runId:'r',sequence:3,type:'run.finished',at:new Date().toISOString()}),/Non-monotonic event sequence/);
});

test('retry policy exceptions fail closed without retrying',async()=>{
  const plan=makePlan();let calls=0;
  const runner={idempotent:true,async execute(){calls++;throw Object.assign(new Error('temporary'),{retryable:true});},async verify(){return true;}};
  const result=await makeEngine({runner,maxRetries:2,retryOn(){throw new Error('policy failure');}}).run(plan,{approval:approved(plan)});
  assert.equal(result.tasks.t1.status,'failed');
  assert.equal(result.tasks.t1.attempts,1);
  assert.equal(calls,2);
});

test('JSONL event store resumes sequence validation after reopening',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'oiol-events-reopen-'));
  try{
    const file=path.join(directory,'events.jsonl');
    const first=new JsonlEventStore(file);
    await first.append({eventId:'e1',runId:'restart',sequence:1,type:'run.started',at:new Date().toISOString()});
    const reopened=new JsonlEventStore(file);
    await reopened.append({eventId:'e2',runId:'restart',sequence:2,type:'run.finished',at:new Date().toISOString()});
    assert.deepEqual((await reopened.read('restart')).map(event=>event.sequence),[1,2]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('JSONL event store rejects corrupt durable logs',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'oiol-events-corrupt-'));
  try{
    const file=path.join(directory,'events.jsonl');
    await writeFile(file,'{"eventId":"e1","runId":"r","sequence":1,"type":"run.started","at":"bad-date"}\n','utf8');
    const store=new JsonlEventStore(file);
    await assert.rejects(()=>store.read('r'),/Event timestamp must be valid/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('JSONL event store serializes concurrent appends in call order',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'oiol-events-concurrent-'));
  try{
    const store=new JsonlEventStore(path.join(directory,'events.jsonl'));
    await Promise.all([1,2,3].map(sequence=>store.append({eventId:`e${sequence}`,runId:'concurrent',sequence,type:`event.${sequence}`,at:new Date().toISOString()})));
    assert.deepEqual((await store.read('concurrent')).map(event=>event.sequence),[1,2,3]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('recovery inspector identifies uncertain and not-started tasks without resuming',()=>{
  const at=new Date().toISOString();
  const events=[
    {eventId:'e1',runId:'interrupted',sequence:1,type:'run.started',at,planId:'p1',planFingerprint:'fp1',taskCount:2},
    {eventId:'e2',runId:'interrupted',sequence:2,type:'task.ready',at,taskId:'t1'},
    {eventId:'e3',runId:'interrupted',sequence:3,type:'task.attempt.started',at,taskId:'t1',attempt:1},
    {eventId:'e4',runId:'interrupted',sequence:4,type:'task.attempt.failed',at,taskId:'t1',attempt:1,retrying:true},
    {eventId:'e5',runId:'interrupted',sequence:5,type:'task.ready',at,taskId:'t2'}
  ];
  const result=inspectExecutionRun(events,{expectedPlanId:'p1',expectedPlanFingerprint:'fp1'});
  assert.equal(result.status,'interrupted');
  assert.deepEqual(result.uncertainTaskIds,['t1']);
  assert.deepEqual(result.notStartedTaskIds,['t2']);
  assert.equal(result.unobservedTaskCount,0);
  assert.equal(result.recoveryAllowed,false);
});

test('recovery inspector validates finished run ledger and rejects trailing events',()=>{
  const at=new Date().toISOString();
  const events=[
    {eventId:'e1',runId:'finished',sequence:1,type:'run.started',at,planId:'p1',planFingerprint:'fp1',taskCount:1},
    {eventId:'e2',runId:'finished',sequence:2,type:'task.ready',at,taskId:'t1'},
    {eventId:'e3',runId:'finished',sequence:3,type:'task.attempt.started',at,taskId:'t1',attempt:1},
    {eventId:'e4',runId:'finished',sequence:4,type:'task.completed',at,taskId:'t1',attempt:1},
    {eventId:'e5',runId:'finished',sequence:5,type:'run.finished',at,status:'completed',counts:{completed:1}}
  ];
  assert.equal(inspectExecutionRun(events).finished,true);
  assert.throws(()=>inspectExecutionRun([...events,{eventId:'e6',runId:'finished',sequence:6,type:'task.ready',at,taskId:'t2'}]),/after run.finished/);
});

test('recovery inspector rejects sequence gaps and plan fingerprint mismatch',()=>{
  const at=new Date().toISOString();
  const events=[{eventId:'e1',runId:'r',sequence:1,type:'run.started',at,planId:'p1',planFingerprint:'fp1',taskCount:0}];
  assert.throws(()=>inspectExecutionRun(events,{expectedPlanFingerprint:'different'}),/fingerprint/);
  assert.throws(()=>inspectExecutionRun([...events,{eventId:'e2',runId:'r',sequence:3,type:'run.finished',at,status:'completed',counts:{}}]),/sequence/);
});

test('execution engine exposes read-only run inspection',async()=>{
  const store=new InMemoryEventStore();
  const engine=makeEngine({runner:successRunner,eventStore:store});
  const at=new Date().toISOString();
  await store.append({eventId:'e1',runId:'inspect',sequence:1,type:'run.started',at,planId:'p1',planFingerprint:'fp1',taskCount:1});
  await store.append({eventId:'e2',runId:'inspect',sequence:2,type:'task.ready',at,taskId:'t1'});
  await store.append({eventId:'e3',runId:'inspect',sequence:3,type:'task.attempt.started',at,taskId:'t1',attempt:1});
  const result=await engine.inspectRun('inspect',{expectedPlanId:'p1'});
  assert.deepEqual(result.uncertainTaskIds,['t1']);
  assert.equal(result.recoveryAllowed,false);
  await assert.rejects(()=>engine.inspectRun('missing'),/No execution events found/);
});

test('event stores reject duplicate event identifiers',async()=>{
  const at=new Date().toISOString();
  const store=new InMemoryEventStore();
  await store.append({eventId:'same',runId:'r1',sequence:1,type:'run.started',at});
  await assert.rejects(()=>store.append({eventId:'same',runId:'r2',sequence:1,type:'run.started',at}),/Duplicate eventId/);
});


test('run ledger records exact task IDs and recovery rejects unknown tasks',()=>{
  const at=new Date().toISOString();
  const events=[
    {eventId:'e1',runId:'ledger',sequence:1,type:'run.started',at,planId:'p1',planFingerprint:'fp1',taskCount:1,taskIds:['t1']},
    {eventId:'e2',runId:'ledger',sequence:2,type:'task.ready',at,taskId:'rogue'}
  ];
  assert.throws(()=>inspectExecutionRun(events),/unknown taskId/);
});

test('recovery inspector rejects duplicate event IDs within a run',()=>{
  const at=new Date().toISOString();
  const events=[
    {eventId:'same',runId:'dup-events',sequence:1,type:'run.started',at,planId:'p1',planFingerprint:'fp1',taskCount:1},
    {eventId:'same',runId:'dup-events',sequence:2,type:'task.ready',at,taskId:'t1'}
  ];
  assert.throws(()=>inspectExecutionRun(events),/Duplicate eventId/);
});

test('run start ledger rejects duplicate or incomplete task IDs',()=>{
  const at=new Date().toISOString();
  const events=[{eventId:'e1',runId:'bad-ledger',sequence:1,type:'run.started',at,planId:'p1',planFingerprint:'fp1',taskCount:2,taskIds:['t1','t1']}];
  assert.throws(()=>inspectExecutionRun(events),/invalid taskIds ledger/);
});


test('engine writes the exact planned task IDs into the run-start event',async()=>{
  const plan=makePlan(),store=new InMemoryEventStore();
  await makeEngine({runner:successRunner,eventStore:store}).run(plan,{approval:approved(plan),runId:'task-ledger'});
  const started=(await store.read('task-ledger'))[0];
  assert.deepEqual(started.taskIds,['t1','t2','t3']);
  assert.equal(started.taskCount,started.taskIds.length);
});


test('JSONL event store discards only a torn final record and remains appendable',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'oiol-events-torn-'));
  try{
    const file=path.join(directory,'events.jsonl');
    const first={eventId:'e1',runId:'torn',sequence:1,type:'run.started',at:new Date().toISOString()};
    await writeFile(file,JSON.stringify(first)+'\\n'+ '{"eventId":"e2","runId":"torn","sequence":2,"type":"task.started"', 'utf8');
    const store=new JsonlEventStore(file);
    assert.deepEqual((await store.read('torn')).map(event=>event.eventId),['e1']);
    await store.append({eventId:'e2-recovered',runId:'torn',sequence:2,type:'task.started',at:new Date().toISOString()});
    assert.deepEqual((await store.read('torn')).map(event=>event.sequence),[1,2]);
    assert.ok((await readFile(file,'utf8')).endsWith('\\n'));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('JSONL event store still rejects a malformed complete record',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'oiol-events-malformed-'));
  try{
    const file=path.join(directory,'events.jsonl');
    await writeFile(file,'{not-json}\\n','utf8');
    const store=new JsonlEventStore(file);
    await assert.rejects(()=>store.read('bad'),/Corrupt event log at line 1/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
