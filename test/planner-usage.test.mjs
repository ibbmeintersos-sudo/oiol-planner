import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridPlanner } from '../src/core/planner.mjs';

const project={kind:'greenfield',name:'Usage test',request:'Create a small service'};
const plan={
 requirements:[{id:'r1',statement:'Provide service endpoint',priority:'high'}],
 architecture:{components:[{id:'c1',name:'API'}],decisions:[]},
 tasks:[{id:'t1',title:'Implement endpoint',requirementIds:['r1'],componentIds:['c1'],dependencies:[],acceptanceCriteria:['Returns expected response','Rejects invalid input'],writeScope:['src/api']}],
 dependencyGraph:{nodes:['t1'],edges:[]},risks:[],clarifications:[]
};
class PlannerProvider {
 constructor(){this.model='planner-model';this.baseUrl='https://planner.invalid';this.calls=0;}
 async requestJson(){this.calls++;return {data:plan,model:this.model,usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140}};}
}
class ReviewerProvider {
 constructor(){this.model='review-model';this.baseUrl='https://reviewer.invalid';this.calls=0;}
 async requestJson(){this.calls++;return {data:{status:'approved',summary:'Accepted',findings:[]},model:this.model,usage:{input_tokens:60,output_tokens:10}};}
}

test('planner preserves per-role usage metadata for planning and distinct reviewer configuration',async()=>{
 const provider=new PlannerProvider(),reviewer=new ReviewerProvider();
 const result=await new HybridPlanner({provider,reviewer,maxRepairRounds:0}).createPlan(project);
 assert.equal(result.status,'ready_for_review');
 assert.equal(result.providerUsage.planner.requests,1);
 assert.equal(result.providerUsage.reviewer.requests,1);
 assert.equal(result.providerUsage.planner.calls[0].usage.total_tokens,140);
 assert.equal(result.providerUsage.reviewer.calls[0].usage.input_tokens,60);
 assert.equal(result.review.configurationDistinct,true);
 assert.equal(result.validation.schemaValidation.valid,true);
});

test('planner usage records absent provider usage without fabricating token counts',async()=>{
 const provider={model:'p',baseUrl:'same',requestJson:async()=>({data:plan,usage:null})};
 const reviewer={model:'r',baseUrl:'different',requestJson:async()=>({data:{status:'approved',findings:[]},usage:null})};
 const result=await new HybridPlanner({provider,reviewer,maxRepairRounds:0}).createPlan(project);
 assert.equal(result.providerUsage.planner.calls[0].usage,null);
 assert.equal(result.providerUsage.reviewer.calls[0].usage,null);
});

test('planner blocks review when a plan violates the published JSON Schema', async () => {
 const invalidPlan = { ...plan, risks: [{}] };
 const provider = { model: 'planner', baseUrl: 'https://planner.invalid', requestJson: async () => ({ data: invalidPlan }) };
 let reviewerCalls = 0;
 const reviewer = { model: 'reviewer', baseUrl: 'https://reviewer.invalid', requestJson: async () => {
   reviewerCalls++;
   return { data: { status: 'approved', findings: [] } };
 } };
 const result = await new HybridPlanner({ provider, reviewer, maxRepairRounds: 0 }).createPlan(project);
 assert.equal(result.status, 'blocked');
 assert.equal(result.validation.schemaValidation.valid, false);
 assert.equal(reviewerCalls, 0);
});
