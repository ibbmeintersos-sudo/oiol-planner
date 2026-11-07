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
  constructor(){this.events=[];this.lastSequence=new Map();this.eventIds=new Set();}
  async append(event){
    validateEvent(event);
    if(this.eventIds.has(event.eventId)) throw new Error(`Duplicate eventId: ${event.eventId}`);
    const previous=this.lastSequence.get(event.runId)||0;
    if(event.sequence!==previous+1) throw new Error(`Non-monotonic event sequence for run ${event.runId}: expected ${previous+1}, received ${event.sequence}`);
    this.events.push(structuredClone(event));
    this.lastSequence.set(event.runId,event.sequence);
    this.eventIds.add(event.eventId);
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
    this.eventIds=new Set();
    this.initialized=false;
  }
  async #discardTornTail(content){
    if(!content||content.endsWith('\n')) return content;
    const lastNewline=content.lastIndexOf('\n');
    const completePrefix=lastNewline>=0?content.slice(0,lastNewline+1):'';
    const tail=content.slice(lastNewline+1);
    let tailIsJson=false;
    try{JSON.parse(tail);tailIsJson=true;}catch{}
    const handle=await fs.open(this.filePath,'r+');
    try{
      if(tailIsJson){
        await handle.write('\n',Buffer.byteLength(content,'utf8'),'utf8');
        await handle.sync();
        return content+'\n';
      }
      await handle.truncate(Buffer.byteLength(completePrefix,'utf8'));
      await handle.sync();
      return completePrefix;
    }finally{await handle.close();}
  }
  async #initialize(){
    if(this.initialized) return;
    let content;
    try{content=await fs.readFile(this.filePath,'utf8');}
    catch(error){if(error.code==='ENOENT'){this.initialized=true;return;}throw error;}
    content=await this.#discardTornTail(content);
    for(const [index,line] of content.split('\n').entries()){
      if(!line.trim()) continue;
      let event;
      try{event=JSON.parse(line);}catch(error){throw new Error(`Corrupt event log at line ${index+1}: ${error.message}`);}
      try{validateEvent(event);}catch(error){throw new Error(`Invalid event record at line ${index+1}: ${error.message}`);}
      if(this.eventIds.has(event.eventId)) throw new Error(`Duplicate eventId at line ${index+1}: ${event.eventId}`);
      const previous=this.lastSequence.get(event.runId)||0;
      if(event.sequence!==previous+1) throw new Error(`Non-monotonic event sequence at line ${index+1} for run ${event.runId}`);
      this.lastSequence.set(event.runId,event.sequence);
      this.eventIds.add(event.eventId);
    }
    this.initialized=true;
  }
  async append(event){
    const operation=async()=>{
      validateEvent(event);
      await this.#initialize();
      if(this.eventIds.has(event.eventId)) throw new Error(`Duplicate eventId: ${event.eventId}`);
      const previous=this.lastSequence.get(event.runId)||0;
      if(event.sequence!==previous+1) throw new Error(`Non-monotonic event sequence for run ${event.runId}: expected ${previous+1}, received ${event.sequence}`);
      await fs.mkdir(path.dirname(this.filePath),{recursive:true});
      const handle=await fs.open(this.filePath,'a',0o600);
      try{await handle.chmod(0o600);await handle.writeFile(JSON.stringify(event)+'\n','utf8');await handle.sync();}
      finally{await handle.close();}
      this.lastSequence.set(event.runId,event.sequence);
      this.eventIds.add(event.eventId);
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
    const seenEventIds=new Set();
    for(const [index,line] of content.split('\n').entries()){
      if(!line.trim()) continue;
      let event;
      try{event=JSON.parse(line);}catch(error){throw new Error(`Corrupt event log at line ${index+1}: ${error.message}`);}
      try{validateEvent(event);}catch(error){throw new Error(`Invalid event record at line ${index+1}: ${error.message}`);}
      if(seenEventIds.has(event.eventId)) throw new Error(`Duplicate eventId at line ${index+1}: ${event.eventId}`);
      seenEventIds.add(event.eventId);
      const previous=lastSeen.get(event.runId)||0;
      if(event.sequence!==previous+1) throw new Error(`Non-monotonic event sequence at line ${index+1} for run ${event.runId}`);
      lastSeen.set(event.runId,event.sequence);
      if(event.runId===runId) events.push(event);
    }
    return events;
  }
}
