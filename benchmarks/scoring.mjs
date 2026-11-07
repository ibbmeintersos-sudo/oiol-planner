import { validatePlan } from '../src/core/validator.mjs';

const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9\s_-]/g,' ').replace(/\s+/g,' ').trim();
const matchesGroup = (text, group) => group.some(term => normalize(text).includes(normalize(term)));

export function scoreScenario(scenario, result) {
  const plan=result?.plan||{};
  const text=normalize(JSON.stringify(plan));
  const signalResults=(scenario.expectedSignals||[]).map(group=>({group,matched:matchesGroup(text,group)}));
  const signalRate=signalResults.length?signalResults.filter(x=>x.matched).length/signalResults.length:1;
  const clarifications=Array.isArray(plan.clarifications)?plan.clarifications:[];
  const clarificationResults=(scenario.clarificationSignals||[]).map(group=>({group,matched:clarifications.some(q=>matchesGroup(JSON.stringify(q),group))}));
  const clarificationRate=clarificationResults.length?clarificationResults.filter(x=>x.matched).length/clarificationResults.length:1;
  const blockingClarification=clarifications.some(q=>q?.blocking===true&&q?.resolved!==true);
  const clarificationPass=scenario.mustClarify?blockingClarification:!blockingClarification;
  const validation=validatePlan(plan,scenario.project);
  const tasks=Array.isArray(plan.tasks)?plan.tasks:[];
  const criteria=tasks.reduce((n,t)=>n+(Array.isArray(t.acceptanceCriteria)?t.acceptanceCriteria.length:0),0);
  const tasksWithScope=tasks.filter(t=>Array.isArray(t.writeScope)&&t.writeScope.length>0).length;
  const scopeRate=tasks.length?tasksWithScope/tasks.length:0;
  const expectedClarificationErrors=scenario.mustClarify&&blockingClarification?validation.errors.filter(x=>x.startsWith('Unresolved blocking clarification:')):[];
  const unexpectedValidationErrors=validation.errors.filter(x=>!expectedClarificationErrors.includes(x));
  const dimensions={
    structuralValidity:unexpectedValidationErrors.length===0?1:0,
    requirementSignalCoverage:signalRate,
    clarificationDiscipline:clarificationPass?clarificationRate:0,
    acceptanceCriteria:tasks.length?Math.min(1,criteria/(tasks.length*2)):0,
    scopedTasks:scopeRate,
    reviewerConfigurationSeparation:plan.review?.configurationDistinct===true?1:0
  };
  const weights={structuralValidity:25,requirementSignalCoverage:25,clarificationDiscipline:20,acceptanceCriteria:15,scopedTasks:10,reviewerConfigurationSeparation:5};
  const score=Object.entries(weights).reduce((sum,[key,weight])=>sum+dimensions[key]*weight,0);
  const blockers=[];
  if(unexpectedValidationErrors.length) blockers.push(...unexpectedValidationErrors);
  if(!clarificationPass) blockers.push(scenario.mustClarify?'Expected a blocking unresolved clarification but none was produced':'Unexpected blocking clarification for an adequately specified scenario');
  if(scenario.mustClarify&&plan.status!=='blocked') blockers.push('Ambiguous scenario did not block planning pending clarification');
  if(!scenario.mustClarify&&plan.status==='blocked') blockers.push('Plan is blocked for a scenario not expected to require clarification');
  return {
    scenarioId:scenario.id,category:scenario.category,difficulty:scenario.difficulty,
    status:plan.status||'missing',score:Number(score.toFixed(2)),dimensions,weights,
    validation:{valid:validation.valid,structurallyValid:unexpectedValidationErrors.length===0,errors:validation.errors,expectedGateErrors:expectedClarificationErrors,warnings:validation.warnings},
    requirementSignals:signalResults,clarificationSignals:clarificationResults,
    clarificationPass,blockingClarification,taskCount:tasks.length,acceptanceCriteriaCount:criteria,
    tasksWithWriteScope:tasksWithScope,
    reviewerConfigurationDistinct:plan.review?.configurationDistinct===true,
    elapsedMs:result?.elapsedMs??null,blockers
  };
}

export function summarizeBenchmark(rows) {
  const values=rows.map(x=>x.score).sort((a,b)=>a-b);
  const avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
  const median=values.length?(values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2):0;
  const byCategory={};
  for(const row of rows){(byCategory[row.category]??=[]).push(row.score);}
  return {scenarioCount:rows.length,averageScore:Number(avg.toFixed(2)),medianScore:Number(median.toFixed(2)),minimumScore:values[0]??0,maximumScore:values.at(-1)??0,passCount:rows.filter(x=>x.score>=80&&x.blockers.length===0).length,byCategory:Object.fromEntries(Object.entries(byCategory).map(([k,v])=>[k,{count:v.length,average:Number((v.reduce((a,b)=>a+b,0)/v.length).toFixed(2))}]))};
}
