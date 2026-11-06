import fs from 'node:fs/promises';
import path from 'node:path';
export class InMemoryEventStore {
  constructor(){this.events=[];}
  async append(event){this.events.push(structuredClone(event));return event;}
  async read(runId){return this.events.filter(event=>event.runId===runId).map(event=>structuredClone(event));}
}
export class JsonlEventStore {
  constructor(filePath){if(typeof filePath!=='string'||!filePath.trim())throw new Error('Event store filePath is required');this.filePath=path.resolve(filePath);this.queue=Promise.resolve();}
  async append(event){
    const operation=async()=>{
      await fs.mkdir(path.dirname(this.filePath),{recursive:true});
      const handle=await fs.open(this.filePath,'a');
      try{await handle.writeFile(JSON.stringify(event)+'\n','utf8');await handle.sync();}finally{await handle.close();}
      return event;
    };
    const pending=this.queue.then(operation,operation);this.queue=pending.catch(()=>{});return pending;
  }
  async read(runId){
    await this.queue;
    let content;try{content=await fs.readFile(this.filePath,'utf8');}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const events=[];
    for(const [index,line] of content.split('\n').entries()){
      if(!line.trim())continue;
      let event;try{event=JSON.parse(line);}catch(error){throw new Error(`Corrupt event log at line ${index+1}: ${error.message}`);}
      if(!event||typeof event!=='object'||typeof event.runId!=='string'||typeof event.type!=='string'||!Number.isInteger(event.sequence))throw new Error(`Invalid event record at line ${index+1}`);
      if(event.runId===runId)events.push(event);
    }
    return events.sort((a,b)=>a.sequence-b.sequence);
  }
}
