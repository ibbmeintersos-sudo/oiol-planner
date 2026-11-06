import fs from 'node:fs/promises';
import path from 'node:path';

function validateEvent(event) {
  if(!event||typeof event!=='object'||Array.isArray(event)) throw new Error('Event must be an object');
  if(typeof event.eventId!=='string'||!event.eventId.trim()) throw new Error('Event eventId is required');
  if(typeof event.runId!=='string'||!event.runId.trim()) throw new Error('Event runId is required');
  if(typeof event.type!=='string'||!event.type.trim()) throw new Error('Event type is required');
  if(!Number.isInteger(event.sequence)||event.sequence<1) throw new Error('Event sequence must be a positive integer');
  if(typeof event.at!=='string'||!Number.isFinite(Date.parse(event.at))) throw new Error('Event timestamp must be valid');
}

export class InMemoryEventStore {
  constructor(){this.events=[];this.lastSequence=new Map();}
  async append(event){
    validateEvent(event);
    const previous=this.lastSequence.get(event.runId)||0;
    if(event.sequence!==previous+1) throw new Error(`Non-monotonic event sequence for run ${event.runId}: expected ${previous+1}, received ${event.sequence}`);
    this.events.push(structuredClone(event));
    this.lastSequence.set(event.runId,event.sequence);
    return event;
  }
  async read(runId){return this.events.filter(event=>event.runId===runId).map(event=>structuredClone(event));}
}

export class JsonlEventStore {
  constructor(filePath){
    if(typeof filePath!=='string'||!filePath.trim()) throw new Error('Event store filePath is required');
    this.filePath=path.resolve(filePath);
    this.queue=Promise.resolve();
    this.lastSequence=new Map();
    this.initialized=false;
  }
  async #initialize(){
    if(this.initialized) return;
    let content;
    try{content=await fs.readFile(this.filePath,'utf8');}
    catch(error){if(error.code==='ENOENT'){this.initialized=true;return;}throw error;}
    for(const [index,line] of content.split('\\n').entries()){
      if(!line.trim()) continue;
      let event;
      try{event=JSON.parse(line);}catch(error){throw new Error(`Corrupt event log at line ${index+1}: ${error.message}`);}
      try{validateEvent(event);}catch(error){throw new Error(`Invalid event record at line ${index+1}: ${error.message}`);}
      const previous=this.lastSequence.get(event.runId)||0;
      if(event.sequence!==previous+1) throw new Error(`Non-monotonic event sequence at line ${index+1} for run ${event.runId}`);
      this.lastSequence.set(event.runId,event.sequence);
    }
    this.initialized=true;
  }
  async append(event){
    const operation=async()=>{
      validateEvent(event);
      await this.#initialize();
      const previous=this.lastSequence.get(event.runId)||0;
      if(event.sequence!==previous+1) throw new Error(`Non-monotonic event sequence for run ${event.runId}: expected ${previous+1}, received ${event.sequence}`);
      await fs.mkdir(path.dirname(this.filePath),{recursive:true});
      const handle=await fs.open(this.filePath,'a',0o600);
      try{await handle.chmod(0o600);await handle.writeFile(JSON.stringify(event)+'\\n','utf8');await handle.sync();}
      finally{await handle.close();}
      this.lastSequence.set(event.runId,event.sequence);
      return event;
    };
    const pending=this.queue.then(operation,operation);
    this.queue=pending.catch(()=>{});
    return pending;
  }
  async read(runId){
    await this.queue;
    await this.#initialize();
    let content;
    try{content=await fs.readFile(this.filePath,'utf8');}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
    const events=[];
    const lastSeen=new Map();
    for(const [index,line] of content.split('\\n').entries()){
      if(!line.trim()) continue;
      let event;
      try{event=JSON.parse(line);}catch(error){throw new Error(`Corrupt event log at line ${index+1}: ${error.message}`);}
      try{validateEvent(event);}catch(error){throw new Error(`Invalid event record at line ${index+1}: ${error.message}`);}
      const previous=lastSeen.get(event.runId)||0;
      if(event.sequence!==previous+1) throw new Error(`Non-monotonic event sequence at line ${index+1} for run ${event.runId}`);
      lastSeen.set(event.runId,event.sequence);
      if(event.runId===runId) events.push(event);
    }
    return events;
  }
}
