export function buildTraceability(plan, execution={}){
 const rows=(plan.requirements||[]).map(r=>{const tasks=(plan.tasks||[]).filter(t=>(t.requirementIds||[]).includes(r.id));const verified=tasks.length>0&&tasks.every(t=>execution[t.id]?.status==='completed'&&execution[t.id]?.verification?.passed===true);return {requirementId:r.id,statement:r.statement,taskIds:tasks.map(t=>t.id),status:tasks.length?'planned':'unmapped',verified};});
 return {rows,mappingCoverage:rows.length?rows.filter(x=>x.taskIds.length).length/rows.length:1,verificationComplete:rows.every(x=>x.verified)};
}
