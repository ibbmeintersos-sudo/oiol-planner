import { emptyPlan } from '../contracts/types.mjs';
import { PLANNER_SYSTEM_PROMPT, plannerUserPrompt, REVIEW_SYSTEM_PROMPT } from './prompts.mjs';
import { validatePlan } from './validator.mjs';
import { id } from './utils.mjs';
export class HybridPlanner {
 constructor({provider,reviewer=provider,maxRepairRounds=2}={}){if(!provider)throw new Error('A planning provider is required');Object.assign(this,{provider,reviewer,maxRepairRounds});}
 async createPlan(project){
  const first=await this.provider.requestJson({system:PLANNER_SYSTEM_PROMPT,user:plannerUserPrompt(project),temperature:0});
  let plan=normalize(first.data,project), validation=validatePlan(plan,project);
  for(let i=0;i<this.maxRepairRounds&&!validation.valid;i++){
   const repaired=await this.provider.requestJson({system:PLANNER_SYSTEM_PROMPT+'\nRepair the supplied plan. Fix every validation error. Return the complete JSON plan.',user:JSON.stringify({project,plan,validation},null,2),temperature:0});
   plan=normalize(repaired.data,project);validation=validatePlan(plan,project);
  }
  let review=null;
  try{
   const result=await this.reviewer.requestJson({system:REVIEW_SYSTEM_PROMPT,user:JSON.stringify({project,plan,validation},null,2),temperature:0});
   review=result.data;
   const critical=(review.findings||[]).some(x=>['high','critical'].includes(x.severity));
   if(critical&&this.provider!==this.reviewer){
    const fixed=await this.provider.requestJson({system:PLANNER_SYSTEM_PROMPT+'\nRevise the plan to resolve the review findings. Return the full plan JSON.',user:JSON.stringify({project,plan,findings:review.findings},null,2),temperature:0});
    plan=normalize(fixed.data,project);validation=validatePlan(plan,project);
    const again=await this.reviewer.requestJson({system:REVIEW_SYSTEM_PROMPT,user:JSON.stringify({project,plan,validation},null,2),temperature:0});review=again.data;
   }
  }catch(e){review={status:'needs_revision',summary:`Review unavailable: ${e.message}`,findings:[]};}
  plan.review=review;plan.validation=validation;
  plan.status=!validation.valid?'blocked':review?.status==='approved'?'ready_for_review':'needs_revision';
  return plan;
 }
}
function normalize(raw,project){
 const p={...emptyPlan(project),...raw};p.project=project;p.requirements=Array.isArray(p.requirements)?p.requirements:[];p.architecture=p.architecture||{components:[],decisions:[]};p.architecture.components=p.architecture.components||[];p.tasks=p.tasks||[];p.dependencyGraph=p.dependencyGraph||{nodes:p.tasks.map(t=>t.id),edges:[]};p.dependencyGraph.nodes=p.dependencyGraph.nodes||p.tasks.map(t=>t.id);p.dependencyGraph.edges=p.dependencyGraph.edges||[];p.risks=p.risks||[];p.clarifications=p.clarifications||[];
 for(const r of p.requirements)r.id ||=id('req');for(const c of p.architecture.components)c.id ||=id('cmp');for(const t of p.tasks){t.id ||=id('task');t.requirementIds||=[];t.componentIds||=[];t.dependencies||=[];t.acceptanceCriteria||=[];t.writeScope||=[];}
 if(!p.dependencyGraph.edges.length)p.dependencyGraph.edges=p.tasks.flatMap(t=>(t.dependencies||[]).map(from=>({from,to:t.id,type:'finish_to_start'})));
 return p;
}
