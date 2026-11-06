export function topologicalWaves(tasks, edges=[]) {
  const ids=tasks.map(t=>t.id), deps=new Map(ids.map(x=>[x,new Set()]));
  for(const e of edges){ if(deps.has(e.to)&&deps.has(e.from)) deps.get(e.to).add(e.from); }
  const remaining=new Set(ids), waves=[];
  while(remaining.size){
    const ready=[...remaining].filter(x=>[...deps.get(x)].every(d=>!remaining.has(d)));
    if(!ready.length) return {waves,cycle:true,remaining:[...remaining]};
    const wave=[];
    for(const candidate of ready){
      const t=tasks.find(x=>x.id===candidate); const conflict=wave.some(id=>overlap(t?.writeScope||[],tasks.find(x=>x.id===id)?.writeScope||[]));
      if(!conflict) wave.push(candidate);
    }
    if(!wave.length) wave.push(ready[0]);
    waves.push(wave); wave.forEach(x=>remaining.delete(x));
  }
  return {waves,cycle:false,remaining:[]};
}
function overlap(a,b){return a.some(x=>b.some(y=>x===y||x.startsWith(y+'/')||y.startsWith(x+'/')));}
