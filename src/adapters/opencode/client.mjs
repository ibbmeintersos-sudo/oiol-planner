export class OpenCodeClient {
  constructor({baseUrl='http://127.0.0.1:4096',username='opencode',password='',timeoutMs=30000,fetchImpl=globalThis.fetch}={}) {
    const parsed=new URL(baseUrl);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash) throw new Error('OpenCode baseUrl must be a clean HTTP or HTTPS URL');
    if(typeof username!=='string'||!username.trim()) throw new Error('OpenCode username is required');
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new Error('timeoutMs must be positive');
    if(typeof fetchImpl!=='function') throw new Error('fetchImpl must be a function');
    this.baseUrl=baseUrl.replace(/\/$/,'');this.username=username;this.password=password;this.timeoutMs=timeoutMs;this.fetchImpl=fetchImpl;
  }
  async request(route,options={}) {
    if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')) throw new Error('OpenCode route must be an absolute path on the configured server');
    const headers={accept:'application/json',...(options.body!==undefined?{'content-type':'application/json'}:{}),...(this.password?{authorization:`Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`}:{})};
    const {signal:externalSignal,timeoutMs=this.timeoutMs,...requestOptions}=options;
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new Error('timeoutMs must be positive');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    const abort=()=>controller.abort();
    if(externalSignal?.aborted) controller.abort(); else externalSignal?.addEventListener('abort',abort,{once:true});
    try {
      const response=await this.fetchImpl(this.baseUrl+route,{...requestOptions,signal:controller.signal,headers:{...headers,...requestOptions.headers}});
      const body=await response.text();
      if(!response.ok) throw new Error(`OpenCode HTTP ${response.status}: ${body.slice(0,2000)}`);
      if(response.status===204||!body.trim()) return null;
      try{return JSON.parse(body);}catch(error){throw new Error(`OpenCode returned invalid JSON (${response.status}): ${error.message}`);}
    } catch(error) {
      if(error?.name==='AbortError') throw new Error(externalSignal?.aborted?'OpenCode request cancelled':`OpenCode request timed out after ${timeoutMs}ms`);
      throw error;
    } finally {clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);}
  }
  health(){return this.request('/global/health');}
  listSessions(){return this.request('/session');}
  createSession(title,{signal}={}){if(typeof title!=='string'||!title.trim())throw new Error('Session title is required');return this.request('/session',{method:'POST',body:JSON.stringify({title:title.trim()}),signal});}
  getSession(sessionId){return this.request(`/session/${encodeURIComponent(sessionId)}`);}
  getSessionMessages(sessionId){return this.request(`/session/${encodeURIComponent(sessionId)}/message`);}
  abortSession(sessionId,{signal,timeoutMs}={}){return this.request(`/session/${encodeURIComponent(sessionId)}/abort`,{method:'POST',body:JSON.stringify({}),signal,timeoutMs});}
  getSessionDiff(sessionId,{signal,timeoutMs}={}){return this.request(`/session/${encodeURIComponent(sessionId)}/diff`,{signal,timeoutMs});}
  prompt(sessionId,parts,{agent,model,signal,timeoutMs}={}){
    if(!Array.isArray(parts)||parts.length===0||parts.some(part=>!part||typeof part!=='object'||typeof part.type!=='string'))throw new Error('OpenCode prompt parts must be a non-empty array of typed parts');
    return this.request(`/session/${encodeURIComponent(sessionId)}/message`,{method:'POST',body:JSON.stringify({parts,...(agent?{agent}:{}),...(model?{model}:{})}),signal,timeoutMs});
  }
}
