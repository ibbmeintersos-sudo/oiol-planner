export function comparePlans(previous,next){
 const old=new Map((previous.tasks||[]).map(t=>[t.id,t])), now=new Map((next.tasks||[]).map(t=>[t.id,t]));
 const result={unchanged:[],modified:[],invalidated:[],new:[],reverificationRequired:[]};
 for(const [id,a] of old){const b=now.get(id);if(!b){result.invalidated.push(id);continue;}if(JSON.stringify(a)===JSON.stringify(b))result.unchanged.push(id);else{result.modified.push(id);result.reverificationRequired.push(id);}}
 for(const id of now.keys())if(!old.has(id))result.new.push(id);
 return result;
}
