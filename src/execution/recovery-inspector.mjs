const TERMINAL_TASK_STATES=new Set(['completed','failed','blocked','skipped']);

export function inspectExecutionRun(events,{expectedPlanId,expectedPlanFingerprint}={}) {
  if(!Array.isArray(events)||events.length===0) throw new Error('A non-empty event sequence is required');
  const runId=events[0]?.runId;
  if(typeof runId!=='string'||!runId) throw new Error('Run event stream has no valid runId');
  const states=new Map();
  const attempts=new Map();
  let planId=null,planFingerprint=null,taskCount=null,finished=false,runStatus=null;

  for(let index=0;index<events.length;index++) {
    const event=events[index];
    if(!event||typeof event!=='object'||event.runId!==runId) throw new Error(`Invalid run event at position ${index+1}: runId mismatch`);
    if(event.sequence!==index+1) throw new Error(`Invalid run event sequence at position ${index+1}: expected ${index+1}`);
    if(typeof event.eventId!=='string'||!event.eventId||typeof event.type!=='string'||typeof event.at!=='string'||!Number.isFinite(Date.parse(event.at))) throw new Error(`Invalid run event metadata at sequence ${event.sequence}`);
    if(finished) throw new Error('Run event stream contains events after run.finished');

    if(index===0) {
      if(event.type!=='run.started'||typeof event.planId!=='string'||typeof event.planFingerprint!=='string'||!Number.isInteger(event.taskCount)||event.taskCount<0) {
        throw new Error('Run event stream must begin with a valid run.started event');
      }
      planId=event.planId;
      planFingerprint=event.planFingerprint;
      taskCount=event.taskCount;
      if(expectedPlanId!==undefined&&expectedPlanId!==planId) throw new Error('Run event planId does not match the expected plan');
      if(expectedPlanFingerprint!==undefined&&expectedPlanFingerprint!==planFingerprint) throw new Error('Run event fingerprint does not match the expected plan revision');
      continue;
    }

    if(event.type==='run.finished') {
      if(typeof event.status!=='string'||!event.counts||typeof event.counts!=='object') throw new Error('Invalid run.finished event');
      for(const [taskId,state] of states) if(!TERMINAL_TASK_STATES.has(state.status)) throw new Error(`Run finished with non-terminal task state: ${taskId}`);
      if(states.size!==taskCount) throw new Error(`Run finished with incomplete task ledger: expected ${taskCount}, observed ${states.size}`);
      finished=true;
      runStatus=event.status;
      continue;
    }

    const taskId=event.taskId;
    if(typeof taskId!=='string'||!taskId) throw new Error(`Task event at sequence ${event.sequence} has no taskId`);
    const current=states.get(taskId)?.status;
    if(event.type==='task.ready') {
      if(current!==undefined) throw new Error(`Task ${taskId} received task.ready more than once`);
      states.set(taskId,{status:'ready',attempts:0,outcome:null});
    } else if(event.type==='task.blocked') {
      if(current!==undefined&&current!=='ready') throw new Error(`Task ${taskId} cannot become blocked from ${current}`);
      states.set(taskId,{status:'blocked',attempts:0,outcome:'not_started'});
    } else if(event.type==='task.attempt.started') {
      if(current!=='ready'&&current!=='running') throw new Error(`Task ${taskId} attempt started from invalid state ${current}`);
      const previous=attempts.get(taskId)||0;
      if(event.attempt!==previous+1) throw new Error(`Task ${taskId} has a non-monotonic attempt number`);
      attempts.set(taskId,event.attempt);
      states.set(taskId,{status:'running',attempts:event.attempt,outcome:'uncertain'});
    } else if(event.type==='task.attempt.failed') {
      if(current!=='running'||event.attempt!==attempts.get(taskId)||event.retrying!==true) throw new Error(`Task ${taskId} has an invalid retry failure event`);
      states.set(taskId,{status:'running',attempts:event.attempt,outcome:'uncertain'});
    } else if(event.type==='task.completed'||event.type==='task.failed') {
      if(current!=='running'||event.attempt!==attempts.get(taskId)) throw new Error(`Task ${taskId} terminal event does not match its active attempt`);
      states.set(taskId,{status:event.type==='task.completed'?'completed':'failed',attempts:event.attempt,outcome:'known'});
    } else if(event.type==='task.skipped') {
      if(current!==undefined&&current!=='ready'&&current!=='running') throw new Error(`Task ${taskId} cannot be skipped from ${current}`);
      const outcome=event.outcome==='uncertain'||current==='running'?'uncertain':'not_started';
      states.set(taskId,{status:'skipped',attempts:attempts.get(taskId)||0,outcome});
    } else {
      throw new Error(`Unsupported execution event type: ${event.type}`);
    }
  }

  const tasks=Object.fromEntries(states);
  const uncertainTaskIds=[...states].filter(([,state])=>state.outcome==='uncertain').map(([taskId])=>taskId);
  const notStartedTaskIds=[...states].filter(([,state])=>state.outcome==='not_started'||state.status==='ready').map(([taskId])=>taskId);
  return {
    runId,planId,planFingerprint,finished,status:finished?runStatus:'interrupted',
    taskCount,observedTaskCount:states.size,unobservedTaskCount:Math.max(0,taskCount-states.size),
    tasks,uncertainTaskIds,notStartedTaskIds,
    recoveryAllowed:false,
    recoveryNote:'Inspection only. Reconcile uncertain side effects with the runner before any manual retry; automatic resume is not implemented.'
  };
}
