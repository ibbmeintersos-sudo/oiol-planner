import { isDeepStrictEqual } from 'node:util';
export function comparePlans(previous,next) {
  const oldTasks=Array.isArray(previous?.tasks)?previous.tasks:[],newTasks=Array.isArray(next?.tasks)?next.tasks:[];
  const old=new Map(oldTasks.map(task=>[task.id,task])),now=new Map(newTasks.map(task=>[task.id,task]));
  const result={unchanged:[],modified:[],invalidated:[],new:[],replanningRequired:[]};
  for(const [taskId,oldTask] of old) {
    const newTask=now.get(taskId);
    if(!newTask){result.invalidated.push(taskId);continue;}
    if(isDeepStrictEqual(oldTask,newTask)) result.unchanged.push(taskId);
    else {result.modified.push(taskId);result.replanningRequired.push(taskId);}
  }
  for(const taskId of now.keys()) if(!old.has(taskId)) result.new.push(taskId);
  const affected=new Set([...result.modified,...result.invalidated]);
  let changed=true;
  while(changed) {
    changed=false;
    for(const task of newTasks) {
      if(!old.has(task.id)||affected.has(task.id)) continue;
      if((task.dependencies||[]).some(dependency=>affected.has(dependency))) {
        affected.add(task.id);result.replanningRequired.push(task.id);changed=true;
      }
    }
  }
  result.replanningRequired=[...new Set(result.replanningRequired)];
  return result;
}
