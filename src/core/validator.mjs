import { safePath } from './utils.mjs';
import { topologicalWaves } from './graph.mjs';
export function validatePlan(plan, project={}) {
  const errors=[],warnings=[]; const reqs=plan.requirements||[], tasks=plan.tasks||[], comps=plan.architecture?.components||[];
  const unique=(items,label)=>{const seen=new Set();for(const x of items){if(!x.id)errors.push(`${label} is missing id`);else if(seen.has(x.id))errors.push(`Duplicate ${label} id: ${x.id}`);else seen.add(x.id);}};
  unique(reqs,'requirement'); unique(tasks,'task'); unique(comps,'component');
  const reqIds=new Set(reqs.map(x=>x.id)),taskIds=new Set(tasks.map(x=>x.id)),compIds=new Set(comps.map(x=>x.id));
  const covered=new Set();
  for(const t of tasks){
    if(!t.title)errors.push(`Task ${t.id} has no title`);
    if(!Array.isArray(t.acceptanceCriteria)||!t.acceptanceCriteria.length)errors.push(`Task ${t.id} has no acceptance criteria`);
    for(const r of t.requirementIds||[]){if(!reqIds.has(r))errors.push(`Task ${t.id} references unknown requirement ${r}`);else covered.add(r);}
    for(const c of t.componentIds||[])if(!compIds.has(c))errors.push(`Task ${t.id} references unknown component ${c}`);
    for(const p of t.writeScope||[])if(!safePath(p))errors.push(`Unsafe write scope in ${t.id}: ${p}`);
    if(t.verification?.command && /\b(rm\s+-rf|format\s+c:|del\s+\/s|DROP\s+DATABASE)\b/i.test(t.verification.command)) warnings.push(`Potentially destructive verification command in ${t.id}`);
  }
  for(const r of reqs)if(!covered.has(r.id))warnings.push(`Requirement ${r.id} is not covered by any task`);
  const edges=plan.dependencyGraph?.edges||[];
  for(const e of edges)if(!taskIds.has(e.from)||!taskIds.has(e.to))errors.push(`Dependency edge references unknown task: ${e.from} -> ${e.to}`);
  const graph=topologicalWaves(tasks,edges); if(graph.cycle)errors.push(`Dependency graph contains a cycle: ${graph.remaining.join(', ')}`);
  for(const t of tasks)if(!(t.dependencies||[]).every(d=>taskIds.has(d)))errors.push(`Task ${t.id} has unknown dependency`);
  if((plan.clarifications||[]).some(x=>x.blocking && !x.resolved)) warnings.push('Unresolved blocking clarifications remain');
  if(project.repository?.git?.dirty) warnings.push('Repository has pre-existing uncommitted changes; execution must preserve them');
  if(!tasks.length)warnings.push('Plan contains no tasks');
  return {valid:errors.length===0,errors,warnings,requirementCoverage:reqs.length?covered.size/reqs.length:1,taskCount:tasks.length,graph};
}
