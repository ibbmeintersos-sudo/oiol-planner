import { safePath, isObject } from './utils.mjs';
import { dependencyEdgesFromTasks, canonicalEdgeKey, topologicalWaves } from './graph.mjs';
export function validatePlan(plan, project={}) {
  const errors=[], warnings=[];
  if(!isObject(plan)) return result(['Plan must be a JSON object'],warnings,0,0,null);
  if(!Array.isArray(plan.requirements)) errors.push('Plan requirements must be an array');
  if(!isObject(plan.architecture)||!Array.isArray(plan.architecture.components)) errors.push('Plan architecture.components must be an array');
  if(!Array.isArray(plan.tasks)) errors.push('Plan tasks must be an array');
  if(!isObject(plan.dependencyGraph)||!Array.isArray(plan.dependencyGraph.nodes)||!Array.isArray(plan.dependencyGraph.edges)) errors.push('Plan dependencyGraph.nodes and edges must be arrays');
  if(errors.length) return result(errors,warnings,0,Array.isArray(plan.tasks)?plan.tasks.length:0,null);
  const reqs=plan.requirements,tasks=plan.tasks,comps=plan.architecture.components;
  const unique=(items,label)=>{const seen=new Set();for(const item of items){if(!isObject(item)||typeof item.id!=='string'||!item.id.trim())errors.push(`${label} is missing a valid id`);else if(seen.has(item.id))errors.push(`Duplicate ${label} id: ${item.id}`);else seen.add(item.id);}};
  unique(reqs,'requirement'); unique(tasks,'task'); unique(comps,'component');
  const reqIds=new Set(reqs.map(x=>x?.id)),taskIds=new Set(tasks.map(x=>x?.id)),compIds=new Set(comps.map(x=>x?.id)),covered=new Set();
  for(const task of tasks) {
    if(!isObject(task)){errors.push('Task entry must be an object');continue;}
    if(typeof task.title!=='string'||!task.title.trim()) errors.push(`Task ${task.id} has no title`);
    for(const field of ['requirementIds','componentIds','dependencies','acceptanceCriteria','writeScope']) if(!Array.isArray(task[field])) errors.push(`Task ${task.id}.${field} must be an array`);
    if(!Array.isArray(task.acceptanceCriteria)||!task.acceptanceCriteria.length||task.acceptanceCriteria.some(x=>typeof x!=='string'||!x.trim())) errors.push(`Task ${task.id} must have non-empty string acceptance criteria`);
    for(const req of Array.isArray(task.requirementIds)?task.requirementIds:[]) {if(!reqIds.has(req))errors.push(`Task ${task.id} references unknown requirement ${req}`);else covered.add(req);}
    for(const comp of Array.isArray(task.componentIds)?task.componentIds:[]) if(!compIds.has(comp)) errors.push(`Task ${task.id} references unknown component ${comp}`);
    for(const dep of Array.isArray(task.dependencies)?task.dependencies:[]) if(!taskIds.has(dep)) errors.push(`Task ${task.id} has unknown dependency ${dep}`);
    for(const scope of Array.isArray(task.writeScope)?task.writeScope:[]) if(!safePath(scope)) errors.push(`Unsafe or invalid write scope in ${task.id}: ${scope}`);
    if(task.verification?.command&&/\b(rm\s+-rf|format\s+c:|del\s+\/s|DROP\s+DATABASE)\b/i.test(task.verification.command)) errors.push(`Destructive verification command in ${task.id}`);
  }
  for(const req of reqs) if(req?.id&&!covered.has(req.id)) errors.push(`Requirement ${req.id} is not covered by any task`);
  const graph=plan.dependencyGraph,expected=dependencyEdgesFromTasks(tasks),edgeKeys=graph.edges.map(e=>canonicalEdgeKey(e||{})),expectedKeys=expected.map(canonicalEdgeKey);
  if(new Set(edgeKeys).size!==edgeKeys.length) errors.push('Dependency graph contains duplicate edges');
  if(edgeKeys.slice().sort().join('|')!==expectedKeys.slice().sort().join('|')) errors.push('Dependency graph edges do not exactly match task.dependencies');
  const expectedNodes=[...taskIds].sort(),actualNodes=graph.nodes.slice().sort();
  if(actualNodes.length!==expectedNodes.length||actualNodes.some((x,i)=>x!==expectedNodes[i])) errors.push('Dependency graph nodes do not exactly match task IDs');
  for(const edge of graph.edges) {
    if(!isObject(edge)||!taskIds.has(edge.from)||!taskIds.has(edge.to)) errors.push(`Dependency edge references unknown task: ${edge?.from} -> ${edge?.to}`);
    else if(edge.type&&edge.type!=='finish_to_start') errors.push(`Unsupported dependency edge type: ${edge.type}`);
  }
  const schedule=topologicalWaves(tasks,expected);
  if(schedule.cycle) errors.push(`Dependency graph contains a cycle: ${schedule.remaining.join(', ')}`);
  if(schedule.error) errors.push(`Dependency scheduler error: ${schedule.error}`);
  for(const clarification of (Array.isArray(plan.clarifications)?plan.clarifications:[])) {
    if(!isObject(clarification)) { errors.push('Clarification entry must be an object'); continue; }
    if(clarification.blocking===true && clarification.resolved!==true) errors.push(`Unresolved blocking clarification: ${String(clarification.question||clarification.id||'unspecified')}`);
  }
  if(project.repository?.git?.dirty) warnings.push('Repository has pre-existing uncommitted changes; the plan must explicitly account for them and avoid unrelated overwrites');
  if(!tasks.length) errors.push('Plan contains no tasks');
  return result(errors,warnings,reqs.length?covered.size/reqs.length:1,tasks.length,schedule);
}
function result(errors,warnings,requirementCoverage,taskCount,graph){return {valid:errors.length===0,errors,warnings,requirementCoverage,taskCount,graph};}
