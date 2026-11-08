import path from 'node:path';

function unwrap(value) {
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')
    ? value.data
    : value;
}

export function isSupportedOpenCodeV2(version) {
  if (typeof version !== 'string') return false;
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major === 2 && (minor > 2 || (minor === 2 && patch >= 5));
}

export class OpenCodeClient {
  constructor({baseUrl='http://127.0.0.1:4096',username='opencode',password='',directory,timeoutMs=30000,fetchImpl=globalThis.fetch}={}) {
    const parsed=new URL(baseUrl);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash) throw new Error('OpenCode baseUrl must be a clean HTTP or HTTPS URL');
    if(username!=='opencode') throw new Error('OpenCode V2 requires the fixed HTTP Basic username "opencode"');
    if(directory!==undefined&&(typeof directory!=='string'||!path.isAbsolute(directory))) throw new Error('OpenCode directory must be an absolute path');
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new Error('timeoutMs must be positive');
    if(typeof fetchImpl!=='function') throw new Error('fetchImpl must be a function');
    this.baseUrl=baseUrl.replace(/\/$/,'');
    this.username='opencode';
    this.password=password;
    this.directory=directory===undefined?undefined:path.resolve(directory);
    this.timeoutMs=timeoutMs;
    this.fetchImpl=fetchImpl;
  }

  async request(route,options={}) {
    if(typeof route!=='string'||!route.startsWith('/api/')||route.startsWith('//')) throw new Error('OpenCode V2 route must start with /api/');
    const headers={
      accept:'application/json',
      ...(options.body!==undefined?{'content-type':'application/json'}:{}),
      ...(this.password?{authorization:'Basic '+Buffer.from('opencode:'+this.password).toString('base64')}:{})
    };
    const {signal:externalSignal,timeoutMs=this.timeoutMs,...requestOptions}=options;
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new Error('timeoutMs must be positive');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    const abort=()=>controller.abort();
    if(externalSignal?.aborted) controller.abort(); else externalSignal?.addEventListener('abort',abort,{once:true});
    try {
      const response=await this.fetchImpl(this.baseUrl+route,{...requestOptions,signal:controller.signal,headers:{...headers,...requestOptions.headers}});
      const body=await response.text();
      if(!response.ok) throw new Error('OpenCode V2 HTTP '+response.status+': '+body.slice(0,2000));
      if(response.status===204||!body.trim()) return null;
      try{return JSON.parse(body);}catch(error){throw new Error('OpenCode V2 returned invalid JSON ('+response.status+'): '+error.message);}
    } catch(error) {
      if(error?.name==='AbortError') throw new Error(externalSignal?.aborted?'OpenCode request cancelled':'OpenCode request timed out after '+timeoutMs+'ms');
      throw error;
    } finally {clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);}
  }

  async health() {
    const info=unwrap(await this.request('/api/info'));
    if(!info||typeof info.version!=='string') throw new Error('OpenCode V2 /api/info did not return a server version');
    return info;
  }

  async createSession(title,{agent='plan',model=null,signal}={}) {
    if(typeof title!=='string'||!title.trim()) throw new Error('Session title is required');
    if(typeof agent!=='string'||!agent.trim()) throw new Error('OpenCode V2 planning agent is required');
    if(!this.directory) throw new Error('OpenCode V2 session creation requires an explicit isolated workspace directory');
    const body={
      title:title.trim(),
      agent,
      location:{directory:this.directory},
      ...(model?{model:{providerID:model.providerID,id:model.modelID||model.id,...(model.variant?{variant:model.variant}:{})}}:{})
    };
    const session=unwrap(await this.request('/api/session',{method:'POST',body:JSON.stringify(body),signal}));
    if(!session||typeof session.id!=='string'||!session.id) throw new Error('OpenCode V2 did not return a valid session ID');
    return session;
  }

  prompt(sessionId,text,{signal,timeoutMs}={}) {
    if(typeof text!=='string'||!text.trim()) throw new Error('OpenCode V2 prompt text is required');
    return this.request('/api/session/'+encodeURIComponent(sessionId)+'/prompt',{
      method:'POST',
      body:JSON.stringify({text,resume:true}),
      signal,
      timeoutMs
    });
  }

  waitSession(sessionId,{signal,timeoutMs}={}) {
    return this.request('/api/experimental/session/'+encodeURIComponent(sessionId)+'/wait',{
      method:'POST',
      signal,
      timeoutMs
    });
  }

  async getSessionMessages(sessionId,{signal,timeoutMs}={}) {
    const messages=[];
    let cursor=null;
    for(let page=0;page<100;page++) {
      const query=new URLSearchParams({limit:'100',order:'asc'});
      if(cursor) query.set('cursor',cursor);
      const response=await this.request('/api/session/'+encodeURIComponent(sessionId)+'/message?'+query.toString(),{signal,timeoutMs});
      const data=Array.isArray(response?.data)?response.data:(Array.isArray(response)?response:null);
      if(!data) throw new Error('OpenCode V2 returned an invalid session messages response');
      messages.push(...data);
      const next=response?.cursor?.next;
      if(typeof next!=='string'||!next) return messages;
      cursor=next;
    }
    throw new Error('OpenCode V2 session message pagination exceeded 100 pages');
  }

  async getSessionDiff(sessionId,{signal,timeoutMs}={}) {
    const response=await this.request('/api/session/'+encodeURIComponent(sessionId)+'/diff',{signal,timeoutMs});
    const diff=unwrap(response);
    if(!Array.isArray(diff)) throw new Error('OpenCode V2 returned an invalid session diff response');
    return diff;
  }

  deleteSession(sessionId,{signal,timeoutMs}={}) {
    return this.request('/api/session/'+encodeURIComponent(sessionId),{method:'DELETE',signal,timeoutMs});
  }
}
