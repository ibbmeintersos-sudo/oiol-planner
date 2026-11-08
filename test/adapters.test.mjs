import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapPlanToGitHubIssues,
  publishGitHubIssues,
  mapPlanToLinearIssues,
  publishLinearIssues
} from '../src/adapters/index.mjs';

const plan = {
  id: 'plan_adapter_test',
  status: 'needs_revision',
  summary: 'Introduce a compatible customer pagination contract.',
  project: { name: 'Customer API', request: 'Add cursor pagination without changing existing response shapes.' },
  tasks: [{
    id: 'TASK-1',
    title: 'Define cursor pagination contract',
    description: 'Add a cursor input and response metadata.',
    priority: 'high',
    requirementIds: ['REQ-1'],
    componentIds: ['CMP-API'],
    dependencies: [],
    acceptanceCriteria: ['Existing clients retain the current response shape.','Invalid cursors return a documented error.'],
    writeScope: ['src/routes/customers.mjs','test/customers.test.mjs']
  },{
    id: 'TASK-2',
    title: 'Add cursor integration tests',
    description: 'Verify continuation and invalid cursor behavior.',
    priority: 'medium',
    requirementIds: ['REQ-1'],
    componentIds: ['CMP-API'],
    dependencies: ['TASK-1'],
    acceptanceCriteria: ['A continuation cursor returns the next page.'],
    writeScope: ['test/customers.test.mjs']
  }]
};

test('GitHub Issues adapter creates a local task preview with requirement, dependency and acceptance links',()=>{
  const result=mapPlanToGitHubIssues(plan,{owner:'example-owner',repo:'customer-api',labels:['planning']});
  assert.equal(result.previewOnly,true);
  assert.equal(result.issues.length,2);
  assert.equal(result.issues[0].payload.title,'[OIOL] Define cursor pagination contract');
  assert.match(result.issues[0].payload.body,/REQ-1/);
  assert.match(result.issues[0].payload.body,/Existing clients retain the current response shape/);
  assert.match(result.issues[1].payload.body,/TASK-1/);
  assert.match(result.issues[0].payload.body,/OIOL_PLAN:plan_adapter_test:TASK:TASK-1/);
  assert.deepEqual(result.issues[0].payload.labels,['planning']);
});

test('GitHub Issues preview and publish=false never call fetch',async()=>{
  let calls=0;
  const result=await publishGitHubIssues(plan,{owner:'example-owner',repo:'customer-api',fetchImpl:async()=>{calls++;throw new Error('unexpected network');}});
  assert.equal(result.previewOnly,true);
  assert.equal(calls,0);
});

test('GitHub Issues publishing requires an explicit flag and token',async()=>{
  await assert.rejects(
    ()=>publishGitHubIssues(plan,{owner:'example-owner',repo:'customer-api',publish:true}),
    /GitHub token is required/
  );
});

test('GitHub Issues publisher sends task payloads and returns created issue URLs',async()=>{
  const calls=[];
  const result=await publishGitHubIssues(plan,{
    owner:'example-owner',repo:'customer-api',token:'test-token',publish:true,
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      const n=calls.length;
      return {ok:true,status:201,json:async()=>({number:n,title:JSON.parse(options.body).title,html_url:'https://github.com/example-owner/customer-api/issues/'+n})};
    }
  });
  assert.equal(result.published,true);
  assert.equal(result.created.length,2);
  assert.match(calls[0].url,/repos\/example-owner\/customer-api\/issues$/);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
});

test('Linear adapter creates local issueCreate inputs with team and priority mapping',()=>{
  const result=mapPlanToLinearIssues(plan,{teamId:'team-uuid'});
  assert.equal(result.previewOnly,true);
  assert.equal(result.issues[0].payload.teamId,'team-uuid');
  assert.equal(result.issues[0].payload.priority,2);
  assert.match(result.issues[1].payload.description,/TASK-1/);
  assert.match(result.issues[0].payload.description,/OIOL_PLAN:plan_adapter_test:TASK:TASK-1/);
});

test('Linear preview never calls fetch and does not require credentials',async()=>{
  let calls=0;
  const result=await publishLinearIssues(plan,{teamId:'team-uuid',fetchImpl:async()=>{calls++;throw new Error('unexpected network');}});
  assert.equal(result.previewOnly,true);
  assert.equal(calls,0);
});

test('Linear publisher sends GraphQL mutation and checks GraphQL success',async()=>{
  let request;
  const result=await publishLinearIssues(plan,{
    teamId:'team-uuid',token:'linear-test-key',publish:true,
    fetchImpl:async(url,options)=>{
      request={url,options};
      const input=JSON.parse(options.body).variables.input;
      return {ok:true,status:200,json:async()=>({data:{issueCreate:{success:true,issue:{id:'issue-uuid',identifier:'ENG-1',title:input.title,url:'https://linear.app/acme/issue/ENG-1'}}}})};
    }
  });
  assert.equal(result.published,true);
  assert.equal(result.created[0].identifier,'ENG-1');
  assert.equal(request.url,'https://api.linear.app/graphql');
  assert.equal(request.options.headers.Authorization,'linear-test-key');
  assert.match(JSON.parse(request.options.body).query,/issueCreate/);
});

test('Linear GraphQL errors are rejected even when the HTTP response is successful',async()=>{
  await assert.rejects(
    ()=>publishLinearIssues(plan,{teamId:'team-uuid',token:'key',publish:true,fetchImpl:async()=>({ok:true,status:200,json:async()=>({errors:[{message:'Team not found'}]})})}),
    /Team not found/
  );
});

test('adapters reject execution-state data instead of exporting execution records',()=>{
  const invalid={...plan,tasks:[{...plan.tasks[0],status:'done'}]};
  assert.throws(()=>mapPlanToGitHubIssues(invalid,{owner:'o',repo:'r'}),/execution-state field/);
  assert.throws(()=>mapPlanToLinearIssues(invalid,{teamId:'t'}),/execution-state field/);
});


test('GitHub adapter reports already-created issues if a later issue request fails',async()=>{
  let calls=0;
  await assert.rejects(
    ()=>publishGitHubIssues(plan,{owner:'example-owner',repo:'customer-api',token:'test-token',publish:true,fetchImpl:async()=>{
      calls++;
      if(calls===1) return {ok:true,status:201,json:async()=>({number:1,title:'First',html_url:'https://github.com/example-owner/customer-api/issues/1'})};
      return {ok:false,status:422,json:async()=>({message:'Validation failed'})};
    }}),
    error=>error.partialPublish===true&&error.publishedIssues.length===1&&error.publishedIssues[0].number===1
  );
});

test('Linear adapter reports already-created issues if a later mutation fails',async()=>{
  let calls=0;
  await assert.rejects(
    ()=>publishLinearIssues(plan,{teamId:'team-uuid',token:'linear-test-key',publish:true,fetchImpl:async(url,options)=>{
      calls++;
      if(calls===1) {
        const input=JSON.parse(options.body).variables.input;
        return {ok:true,status:200,json:async()=>({data:{issueCreate:{success:true,issue:{id:'first-id',identifier:'ENG-1',title:input.title,url:'https://linear.app/acme/issue/ENG-1'}}}})};
      }
      return {ok:true,status:200,json:async()=>({errors:[{message:'Second issue rejected'}]})};
    }}),
    error=>error.partialPublish===true&&error.publishedIssues.length===1&&error.publishedIssues[0].identifier==='ENG-1'
  );
});

test('blocked plans and plans with failed validation cannot be exported',()=>{
  assert.throws(()=>mapPlanToGitHubIssues({...plan,status:'blocked'},{owner:'o',repo:'r'}),/Blocked plans/);
  assert.throws(()=>mapPlanToLinearIssues({...plan,validation:{valid:false}},{teamId:'t'}),/failed validation/);
});
