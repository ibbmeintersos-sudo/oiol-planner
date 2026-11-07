import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../src/core/validator.mjs';
import { HybridPlanner } from '../src/core/planner.mjs';

function fixture(overrides={}) {
  const task={id:'task_auth',title:'Implement authentication',description:'Implement the requested login flow using the existing auth module and preserve current API behavior.',requirementIds:['req_login'],componentIds:['cmp_auth'],dependencies:[],acceptanceCriteria:['A valid user can authenticate','Invalid credentials are rejected'],writeScope:['src/auth'],verification:{type:'test',command:'npm test'}};
  return {
    requirements:[{id:'req_login',statement:'Users can securely sign in',priority:'high',acceptanceCriteria:['Valid credentials are accepted','Invalid credentials are rejected']}],
    architecture:{components:[{id:'cmp_auth',name:'Authentication',responsibilities:['Validate credentials','Create user session']}],decisions:[]},
    tasks:[task],
    dependencyGraph:{nodes:['task_auth'],edges:[]},
    risks:[],
    clarifications:[],
    ...overrides
  };
}

test('quality gate accepts a fully traceable, actionable plan',()=>{
  const result=validatePlan(fixture(),{kind:'greenfield'});
  assert.equal(result.valid,true,result.errors.join('; '));
  assert.equal(result.requirementCoverage,1);
});

test('quality gate blocks unresolved blocking clarifications',()=>{
  const plan=fixture({clarifications:[{id:'clarify_auth_provider',question:'Which identity provider must be used?',blocking:true,resolved:false}]});
  const result=validatePlan(plan);
  assert.equal(result.valid,false);
  assert.match(result.errors.join(' '),/Unresolved blocking clarification/);
});

test('quality gate allows unresolved non-blocking clarifications but keeps a warning-free validation contract',()=>{
  const plan=fixture({clarifications:[{id:'clarify_copy',question:'What wording should the sign-in button use?',blocking:false,resolved:false}]});
  assert.equal(validatePlan(plan).valid,true);
});

test('quality gate rejects malformed clarification collections and entries',()=>{
  assert.equal(validatePlan(fixture({clarifications:{}})).valid,false);
  assert.equal(validatePlan(fixture({clarifications:[null]})).valid,false);
});

test('quality gate rejects tasks without actionable descriptions',()=>{
  const plan=fixture();
  delete plan.tasks[0].description;
  const result=validatePlan(plan);
  assert.equal(result.valid,false);
  assert.match(result.errors.join(' '),/actionable description/);
});

test('planner cannot mark a plan ready when a blocking clarification remains unresolved',async()=>{
  const provider={async requestJson({system}) {
    if(system.includes('Review this software plan')) return {data:{status:'approved',summary:'Approved',findings:[]}};
    return {data:fixture({clarifications:[{id:'missing_scope',question:'Which payment gateway?',blocking:true,resolved:false}]})};
  }};
  const planner=new HybridPlanner({provider,maxRepairRounds:0});
  const result=await planner.createPlan({kind:'greenfield',request:'Build a checkout flow'});
  assert.equal(result.validation.valid,false);
  assert.equal(result.status,'blocked');
});
