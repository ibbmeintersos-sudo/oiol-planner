import crypto from 'node:crypto';
import { id, isObject, redact } from '../core/utils.mjs';
import { validatePlan } from '../core/validator.mjs';
import { initialTaskStates, transitionTask, summarizeRun } from './state-machine.mjs';
export function fingerprintPlan(plan){return crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');}
export function createExecutionApproval(plan,{approvedBy,approvedAt=new Date().toISOString()}={}){
  if(typeof approvedBy!=='string'||!approvedBy.trim())throw new Error('approvedBy is required');
  if(!Number.isFinite(Date.parse(approvedAt)))throw new Error('approvedAt must be a valid timestamp');
  return {approved:true,approvedBy:approvedBy.trim(),approvedAt,planId:plan.id,planFingerprint:fingerprintPlan(plan)};
}
export class ExecutionEngine {
  constructor({runner,eventStore,maxConcurrency=2,maxRetries=0,failFast=false,retryOn=(error)=>error?.retryable===true,clock=()=>new Date().toISOString()}={}){
    if(!runner||typeof runner.execute!=='function'||typeof runner.verify!=='function')throw new Error('Runner must implement execute(task, context) and verify(task, result, context)');
    if(!Number.isInteger(maxConcurrency)||maxConcurrency<1||maxConcurrency>32)throw new Error('maxConcurrency must be an integer from 1 to 32');
    if(!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>5)throw new Error('maxRetries must be an integer from 0 to 5');
    if(maxRetries>0&&runner.idempotent!==true)throw new Error('Retries require a runner that explicitly guarantees idempotent execution');
    if(typeof retryOn!=='function')throw new Error('retryOn must be a function');
    if(!eventStore||typeof eventStore.append!=='function'||typeof eventStore.read!=='function')throw new Error('Event store must implement append(event) and read(runId)');
    Object.assign(this,{runner,eventStore,maxConcurrency,maxRetries,failFast,retryOn,clock});
  }
  async run(plan,{approval,runId=id('run'),signal}={}){
    this.#assertApproval(plan,approval);
    const validation=validatePlan(plan,plan.project||{});
    if(!validation.valid)throw new Error(`Plan failed execution validation: ${validation.errors.join('; ')}`);
    if(plan.status!=='ready_for_review')throw new Error(`Plan status must be ready_for_review; received ${plan.status}`);
    if(typeof runId!=='string'||!runId.trim())throw new Error('runId is required');
    if((await this.eventStore.read(runId)).length)throw new Error(`Run ID already exists: ${runId}`);
    const states=initialTaskStates(plan.tasks),results=new Map(),tasks=new Map(plan.tasks.map(task=>[task.id,task]));
    let sequence=0;
    const emit=async(type,payload={})=>this.eventStore.append({eventId:id('evt'),runId,sequence:++sequence,type,at:this.clock(),...payload});
    await emit('run.started',{planId:plan.id,planFingerprint:fingerprintPlan(plan),approvedBy:approval.approvedBy,approvedAt:approval.approvedAt,taskCount:plan.tasks.length});
    let stopped=false;
    const concurrency=this.runner.concurrentSafe===true?this.maxConcurrency:1;
    for(const wave of validation.graph.waves){
      if(stopped)break;
      if(signal?.aborted){stopped=true;break;}
      const runnable=[];
      for(const taskId of wave){
        const task=tasks.get(taskId),state=states.get(taskId);
        const unmet=(task.dependencies||[]).filter(dep=>states.get(dep)?.status!=='completed');
        if(unmet.length){
          const updated=transitionTask(states,taskId,'blocked',{error:`Dependencies did not complete: ${unmet.join(', ')}`,completedAt:this.clock()});
          await emit('task.blocked',{taskId,dependencies:unmet,status:updated.status});
        }else{
          const updated=transitionTask(states,taskId,'ready');await emit('task.ready',{taskId,status:updated.status});runnable.push(task);
        }
      }
      for(let offset=0;offset<runnable.length;offset+=concurrency){
        if(signal?.aborted){stopped=true;break;}
        const batch=runnable.slice(offset,offset+concurrency);
        await Promise.all(batch.map(task=>this.#runTask({task,plan,runId,states,results,emit,signal})));
        if(this.failFast&&batch.some(task=>states.get(task.id).status==='failed')){stopped=true;break;}
      }
      if(this.failFast&&[...states.values()].some(state=>state.status==='failed'))stopped=true;
    }
    for(const [taskId,state] of states){
      if(state.status==='pending'||state.status==='ready'){
        const reason=signal?.aborted?'Execution cancelled before task start':this.failFast?'Skipped because failFast stopped the run':'Task was not scheduled';
        const updated=transitionTask(states,taskId,'skipped',{error:reason,completedAt:this.clock()});
        await emit('task.skipped',{taskId,reason,status:updated.status,outcome:'not_started'});
      }
    }
    const summary=summarizeRun(states);
    if(signal?.aborted)summary.status=summary.counts.failed?'cancelled_with_errors':'cancelled';
    await emit('run.finished',{status:summary.status,counts:summary.counts,total:summary.total});
    return {runId,planId:plan.id,...summary,tasks:Object.fromEntries(states),results:Object.fromEntries(results)};
  }
  #assertApproval(plan,approval){
    if(!isObject(approval)||approval.approved!==true)throw new Error('Explicit human approval is required before execution');
    if(typeof approval.approvedBy!=='string'||!approval.approvedBy.trim())throw new Error('Approval must identify approvedBy');
    if(!Number.isFinite(Date.parse(approval.approvedAt)))throw new Error('Approval timestamp is missing or invalid');
    if(approval.planId!==plan?.id||approval.planFingerprint!==fingerprintPlan(plan))throw new Error('Approval does not match this exact plan revision');
  }
  async #runTask({task,plan,runId,states,results,emit,signal}){
    transitionTask(states,task.id,'running',{startedAt:this.clock(),error:null});
    const idempotencyKey=`${runId}:${task.id}`;
    for(let attempt=1;attempt<=this.maxRetries+1;attempt++){
      states.set(task.id,{...states.get(task.id),attempts:attempt});
      await emit('task.attempt.started',{taskId:task.id,attempt,idempotencyKey});
      let executionResult,verification;
      try{
        if(signal?.aborted)throw Object.assign(new Error('Execution aborted'),{name:'AbortError'});
        const dependencyResults=new Map((task.dependencies||[]).map(dependency=>[dependency,results.get(dependency)]));
        const context={runId,plan,signal,attempt,idempotencyKey,results:dependencyResults};
        executionResult=await this.runner.execute(task,context);
        if(!isObject(executionResult))throw new Error('Runner execute() must return an object');
        verification=await this.runner.verify(task,executionResult,context);
        if(verification!==true&&(!isObject(verification)||verification.passed!==true))throw new Error(isObject(verification)&&verification.message?verification.message:'Task verification did not pass');
      }catch(error){
        if(signal?.aborted||error?.name==='AbortError'){
          const reason='Execution cancelled; task outcome may be uncertain';
          const updated=transitionTask(states,task.id,'skipped',{error:reason,completedAt:this.clock()});
          await emit('task.skipped',{taskId:task.id,attempt,reason,status:updated.status,outcome:'uncertain'});return;
        }
        if(attempt<=this.maxRetries&&this.retryOn(error,task,{attempt,runId})){await emit('task.attempt.failed',{taskId:task.id,attempt,error:redact(error.message).slice(0,2000),retrying:true});continue;}
        const safeError=redact(error.message).slice(0,2000);
        const updated=transitionTask(states,task.id,'failed',{error:safeError,completedAt:this.clock()});
        await emit('task.failed',{taskId:task.id,attempt,error:safeError,status:updated.status});return;
      }
      const safeVerification=verification===true?{passed:true}:{passed:true,...(typeof verification.method==='string'?{method:verification.method.slice(0,100)}:{}),...(typeof verification.summary==='string'?{summary:redact(verification.summary).slice(0,500)}:{})};
      await emit('task.completed',{taskId:task.id,attempt,status:'completed',verification:safeVerification});
      transitionTask(states,task.id,'completed',{completedAt:this.clock(),verification:safeVerification,error:null});
      results.set(task.id,{result:executionResult,verification});return;
    }
  }
}
