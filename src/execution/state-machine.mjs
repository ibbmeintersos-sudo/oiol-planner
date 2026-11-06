const TRANSITIONS={
  pending:new Set(['ready','blocked','skipped']),
  ready:new Set(['running','blocked','skipped']),
  running:new Set(['completed','failed','skipped']),
  completed:new Set(),failed:new Set(),blocked:new Set(),skipped:new Set()
};
export function canTransition(from,to){return TRANSITIONS[from]?.has(to)===true;}
export function transitionTask(state,taskId,next,details={}) {
  const current=state.get(taskId);
  if(!current) throw new Error(`Unknown task state: ${taskId}`);
  if(!canTransition(current.status,next)) throw new Error(`Illegal task state transition for ${taskId}: ${current.status} -> ${next}`);
  const updated={...current,...details,status:next};state.set(taskId,updated);return updated;
}
export function initialTaskStates(tasks){return new Map(tasks.map(task=>[task.id,{taskId:task.id,status:'pending',attempts:0,startedAt:null,completedAt:null,error:null,verification:null}]));}
export function summarizeRun(states){
  const counts={pending:0,ready:0,running:0,completed:0,failed:0,blocked:0,skipped:0};
  for(const value of states.values()) counts[value.status]=(counts[value.status]||0)+1;
  const status=counts.failed?'failed':counts.blocked||counts.skipped?'completed_with_errors':'completed';
  return {status,counts,total:states.size};
}
