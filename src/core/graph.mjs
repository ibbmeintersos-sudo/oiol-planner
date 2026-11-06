export function dependencyEdgesFromTasks(tasks=[]) {
  return tasks.flatMap(task => (task.dependencies || []).map(from => ({from, to: task.id, type:'finish_to_start'})));
}
export function canonicalEdgeKey(edge) { return String(edge.from)+'->'+String(edge.to)+':'+(edge.type || 'finish_to_start'); }
export function overlaps(a=[],b=[]) { return a.some(x => b.some(y => x===y || x.startsWith(y+'/') || y.startsWith(x+'/'))); }
export function topologicalWaves(tasks, edges=[]) {
  const ids=tasks.map(t=>t.id);
  if(new Set(ids).size!==ids.length) return {waves:[],cycle:false,remaining:[],error:'duplicate_task_ids'};
  const known=new Set(ids), deps=new Map(ids.map(x=>[x,new Set()]));
  for(const edge of edges) {
    if(!known.has(edge.from)||!known.has(edge.to)) return {waves:[],cycle:false,remaining:[],error:'unknown_task_reference'};
    if(edge.from===edge.to) return {waves:[],cycle:true,remaining:[edge.from]};
    deps.get(edge.to).add(edge.from);
  }
  const byId=new Map(tasks.map(t=>[t.id,t])), remaining=new Set(ids), waves=[];
  while(remaining.size) {
    const ready=[...remaining].filter(x=>[...deps.get(x)].every(d=>!remaining.has(d)));
    if(!ready.length) return {waves,cycle:true,remaining:[...remaining]};
    const wave=[];
    for(const candidate of ready) {
      const scope=byId.get(candidate)?.writeScope||[];
      if(!wave.some(id=>overlaps(scope,byId.get(id)?.writeScope||[]))) wave.push(candidate);
    }
    if(!wave.length) return {waves,cycle:false,remaining:[...remaining],error:'scheduler_no_progress'};
    waves.push(wave); for(const item of wave) remaining.delete(item);
  }
  return {waves,cycle:false,remaining:[]};
}
