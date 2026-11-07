import { emptyPlan } from '../contracts/types.mjs';
import { PLANNER_SYSTEM_PROMPT, plannerUserPrompt, REVIEW_SYSTEM_PROMPT } from './prompts.mjs';
import { validatePlan } from './validator.mjs';
import { dependencyEdgesFromTasks } from './graph.mjs';
import { isObject } from './utils.mjs';
export class HybridPlanner {
  constructor({provider,reviewer=provider,maxRepairRounds=2}={}) {
    if(!provider) throw new Error('A planning provider is required');
    if(!Number.isInteger(maxRepairRounds)||maxRepairRounds<0||maxRepairRounds>5) throw new Error('maxRepairRounds must be an integer from 0 to 5');
    Object.assign(this,{provider,reviewer,maxRepairRounds});
  }
  async createPlan(project) {
    const usage={planner:{requests:0,calls:[]},reviewer:{requests:0,calls:[]}};
    const request=async(role,provider,payload)=>{
      const result=await provider.requestJson(payload);
      const bucket=usage[role];
      bucket.requests++;
      bucket.calls.push({model:result?.model||provider.model||null,usage:result?.usage||null});
      return result;
    };
    const first=await request('planner',this.provider,{system:PLANNER_SYSTEM_PROMPT,user:plannerUserPrompt(project),temperature:0});
    let plan=normalize(first.data,project),validation=validatePlan(plan,project);
    for(let round=0;round<this.maxRepairRounds&&!validation.valid;round++) {
      const repaired=await request('planner',this.provider,{system:PLANNER_SYSTEM_PROMPT+'\nRepair the supplied plan. Fix every validation error. Return the complete JSON plan.',user:JSON.stringify({project,plan,validation},null,2),temperature:0});
      plan=normalize(repaired.data,project); validation=validatePlan(plan,project);
    }
    let review=null,reviewError=null;
    if(validation.valid&&this.reviewer) {
      try { review=validateReview((await request('reviewer',this.reviewer,{system:REVIEW_SYSTEM_PROMPT,user:JSON.stringify({project,plan,validation},null,2),temperature:0})).data); }
      catch(error) { reviewError=error; }
      for(let round=0;round<this.maxRepairRounds&&review&&hasHighFindings(review);round++) {
        const fixed=await request('planner',this.provider,{system:PLANNER_SYSTEM_PROMPT+'\nResolve every high and critical review finding. Return the complete plan JSON.',user:JSON.stringify({project,plan,findings:review.findings},null,2),temperature:0});
        plan=normalize(fixed.data,project); validation=validatePlan(plan,project);
        if(!validation.valid) break;
        try { review=validateReview((await request('reviewer',this.reviewer,{system:REVIEW_SYSTEM_PROMPT,user:JSON.stringify({project,plan,validation},null,2),temperature:0})).data); }
        catch(error) { review=null; reviewError=error; break; }
      }
    }
    const independentReview=Boolean(this.reviewer&&this.reviewer!==this.provider&&(this.reviewer.constructor!==this.provider.constructor||this.reviewer.model!==this.provider.model||this.reviewer.baseUrl!==this.provider.baseUrl));
    plan.review={...(review||{status:'needs_revision',summary:reviewError?`Review unavailable: ${reviewError.message}`:'No reviewer configured',findings:[]}),independent:independentReview};
    plan.validation=validation;
    plan.providerUsage=usage;
    const critical=review?.findings?.some(x=>x.severity==='critical')||false;
    const high=review?.findings?.some(x=>x.severity==='high')||false;
    plan.status=!validation.valid||critical||review?.status==='blocked'?'blocked':!review||review.status!=='approved'||high||!independentReview?'needs_revision':'ready_for_review';
    return plan;
  }
}
function normalize(raw,project) {
  if(!isObject(raw)) throw new Error('Planner response must be a JSON object');
  const plan={...emptyPlan(project),...raw,project};
  if(!Array.isArray(plan.requirements)||!isObject(plan.architecture)||!Array.isArray(plan.architecture.components)||!Array.isArray(plan.tasks)) throw new Error('Planner response does not match the required plan structure');
  if(!Array.isArray(plan.architecture.decisions)) plan.architecture.decisions=[];
  if(!isObject(plan.dependencyGraph)) plan.dependencyGraph={nodes:plan.tasks.map(t=>t?.id).filter(Boolean),edges:dependencyEdgesFromTasks(plan.tasks)};
  if(!Array.isArray(plan.risks)) plan.risks=[];
  if(!Array.isArray(plan.clarifications)) plan.clarifications=[];
  return plan;
}
function validateReview(review) {
  if(!isObject(review)||!['approved','needs_revision','blocked'].includes(review.status)||!Array.isArray(review.findings)) throw new Error('Reviewer returned an invalid review contract');
  for(const finding of review.findings) if(!isObject(finding)||!['low','medium','high','critical'].includes(finding.severity)||typeof finding.message!=='string') throw new Error('Reviewer returned an invalid finding');
  return {...review,summary:typeof review.summary==='string'?review.summary:''};
}
function hasHighFindings(review){return review.findings.some(x=>x.severity==='high'||x.severity==='critical');}
