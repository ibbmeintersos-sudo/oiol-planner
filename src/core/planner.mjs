import { emptyPlan } from '../contracts/types.mjs';
import { PLANNER_SYSTEM_PROMPT, plannerUserPrompt, repairUserPrompt, reviewUserPrompt, REVIEW_SYSTEM_PROMPT } from './prompts.mjs';
import { validatePlan } from './validator.mjs';
import { validatePlanSchema } from './schema-validator.mjs';
import { dependencyEdgesFromTasks } from './graph.mjs';
import { isObject } from './utils.mjs';

function providerConfiguration(provider) {
  return {
    providerType: provider?.constructor?.name || 'unknown',
    model: provider?.model || null,
    endpoint: provider?.baseUrl || null
  };
}
function compareReviewerConfiguration(planner, reviewer) {
  const planning = providerConfiguration(planner);
  const reviewing = providerConfiguration(reviewer);
  const differences = [];
  for (const key of ['providerType', 'model', 'endpoint']) {
    if (planning[key] !== reviewing[key]) differences.push(key);
  }
  return { distinct: Boolean(reviewer && reviewer !== planner && differences.length), differences, planner: planning, reviewer: reviewing };
}

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
    let plan=normalize(first.data,project),validation=await validateContract(plan,project);
    for(let round=0;round<this.maxRepairRounds&&!validation.valid;round++) {
      const repaired=await request('planner',this.provider,{system:PLANNER_SYSTEM_PROMPT+'\nRepair the supplied plan. Fix every validation error. Return the complete JSON plan.',user:repairUserPrompt(project,plan,validation,'structural_validation'),temperature:0});
      plan=normalize(repaired.data,project); validation=await validateContract(plan,project);
    }
    let review=null,reviewError=null;
    if(validation.valid&&this.reviewer) {
      try { review=validateReview((await request('reviewer',this.reviewer,{system:REVIEW_SYSTEM_PROMPT,user:reviewUserPrompt(project,plan,validation),temperature:0})).data,plan); }
      catch(error) { reviewError=error; }
      for(let round=0;round<this.maxRepairRounds&&review&&hasHighFindings(review);round++) {
        const fixed=await request('planner',this.provider,{system:PLANNER_SYSTEM_PROMPT+'\nResolve every high and critical review finding. Return the complete plan JSON.',user:repairUserPrompt(project,plan,{findings:review.findings},'review_findings'),temperature:0});
        plan=normalize(fixed.data,project); validation=await validateContract(plan,project);
        if(!validation.valid) break;
        try { review=validateReview((await request('reviewer',this.reviewer,{system:REVIEW_SYSTEM_PROMPT,user:reviewUserPrompt(project,plan,validation),temperature:0})).data,plan); }
        catch(error) { review=null; reviewError=error; break; }
      }
    }
    const reviewerConfiguration=compareReviewerConfiguration(this.provider,this.reviewer);
    const gate=evaluateReviewGate({validation,review,reviewerConfiguration});
    plan.review={
      ...(review||{status:'needs_revision',summary:reviewError?'Review unavailable: '+reviewError.message:'No reviewer configured',findings:[]}),
      configurationDistinct:reviewerConfiguration.distinct,
      configurationDifference:reviewerConfiguration.differences,
      configuration:reviewerConfiguration,
      gate
    };
    plan.validation=validation;
    plan.providerUsage=usage;
    plan.status=gate.status==='blocked'?'blocked':gate.status==='passed'?'ready_for_review':'needs_revision';
    return plan;
  }
}
async function validateContract(plan, project) {
  const semantic = validatePlan(plan, project);
  const schemaValidation = await validatePlanSchema(plan);
  return {
    ...semantic,
    valid: semantic.valid && schemaValidation.valid,
    errors: [...semantic.errors, ...schemaValidation.errors.map(error => 'Schema: ' + error)],
    schemaValidation
  };
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
function validateReview(review, plan) {
  if(!isObject(review)||!['approved','needs_revision','blocked'].includes(review.status)||!Array.isArray(review.findings)) throw new Error('Reviewer returned an invalid review contract');
  const taskIds=new Set((Array.isArray(plan?.tasks)?plan.tasks:[]).map(task=>task?.id).filter(id=>typeof id==='string'));
  for(const finding of review.findings) {
    if(!isObject(finding)||!['low','medium','high','critical'].includes(finding.severity)||typeof finding.message!=='string'||!finding.message.trim()) throw new Error('Reviewer returned an invalid finding');
    if(finding.taskId!==undefined&&finding.taskId!==null&&(typeof finding.taskId!=='string'||!taskIds.has(finding.taskId))) throw new Error('Reviewer finding references an unknown task: '+String(finding.taskId));
  }
  return {...review,summary:typeof review.summary==='string'?review.summary:''};
}
function hasHighFindings(review){return review.findings.some(x=>x.severity==='high'||x.severity==='critical');}

export function evaluateReviewGate({validation,review,reviewerConfiguration}={}) {
  const findings=Array.isArray(review?.findings)?review.findings:[];
  const critical=findings.filter(item=>item?.severity==='critical');
  const high=findings.filter(item=>item?.severity==='high');
  const reasons=[];
  if(validation?.valid!==true) reasons.push('plan_contract_invalid');
  if(!review) reasons.push('review_unavailable');
  else if(review.status!=='approved') reasons.push('review_not_approved');
  if(critical.length) reasons.push('unresolved_critical_findings');
  if(high.length) reasons.push('unresolved_high_findings');
  if(reviewerConfiguration?.distinct!==true) reasons.push('reviewer_configuration_not_distinct');
  const blocked=validation?.valid!==true||review?.status==='blocked'||critical.length>0;
  const passed=!blocked&&review?.status==='approved'&&high.length===0&&reviewerConfiguration?.distinct===true;
  return {
    status:blocked?'blocked':passed?'passed':'needs_revision',
    passed,
    reasons,
    unresolvedCriticalCount:critical.length,
    unresolvedHighCount:high.length
  };
}
