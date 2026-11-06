import { validatePlan } from './validator.mjs';
export function evaluatePlan(plan,project={}){
 const validation=validatePlan(plan,project);const req=plan.requirements||[],tasks=plan.tasks||[];
 const acceptance=tasks.reduce((n,t)=>n+(t.acceptanceCriteria?.length||0),0);
 const scopePairs=[];for(let i=0;i<tasks.length;i++)for(let j=i+1;j<tasks.length;j++)if((tasks[i].writeScope||[]).some(a=>(tasks[j].writeScope||[]).some(b=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/'))))scopePairs.push([tasks[i].id,tasks[j].id]);
 return {validation,metrics:{requirementCoverage:validation.requirementCoverage,acceptanceCriteriaCount:acceptance,dependencyValidity:!validation.errors.some(x=>x.includes('Dependency')),repositorySafety:!validation.errors.some(x=>x.includes('Unsafe')),concurrentWriteConflictPairs:scopePairs}};
}
