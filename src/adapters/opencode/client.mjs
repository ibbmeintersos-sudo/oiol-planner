export class OpenCodeClient {
  constructor({baseUrl='http://127.0.0.1:4096',password='',directory,timeoutMs=30000,fetchImpl=globalThis.fetch}={}) {
    const parsed=new URL(baseUrl);
    if(!['http:','https:'].includes(parsed.protocol)) throw new Error('OpenCode baseUrl must use HTTP or HTTPS');
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new Error('timeoutMs must be positive');
    if(typeof fetchImpl!=='function') throw new Error('fetchImpl must be a function');
    this.baseUrl=baseUrl.replace(/\/$/,'');this.password=password;this.directory=directory;this.timeoutMs=timeoutMs;this.fetchImpl=fetchImpl;
  }
  async request(route,options={}) {
    if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')) throw new Error('OpenCode route must be an absolute path on the configured server');
    const headers={accept:'application/json',...(options.body!==undefined?{'content-type':'application/json'}:{}),...(this.password?{authorization:`Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`}:{})};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try {
      const response=await this.fetchImpl(this.baseUrl+route,{...options,signal:controller.signal,headers:{...headers,...options.headers}});
      const body=await response.text();
      if(!response.ok) throw new Error(`OpenCode HTTP ${response.status}: ${body.slice(0,2000)}`);
      if(response.status===204||!body.trim()) return null;
      try{return JSON.parse(body);}catch(error){throw new Error(`OpenCode returned invalid JSON (${response.status}): ${error.message}`);}
    } catch(error) {
      if(error?.name==='AbortError') throw new Error(`OpenCode request timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally {clearTimeout(timer);}
  }
  health(){return this.request('/global/health');}
  createSession(title){return this.request('/session',{method:'POST',body:JSON.stringify({title,directory:this.directory})});}
  getSession(sessionId){return this.request(`/session/${encodeURIComponent(sessionId)}`);}
  prompt(sessionId,parts){if(!Array.isArray(parts))throw new Error('OpenCode prompt parts must be an array');return this.request(`/session/${encodeURIComponent(sessionId)}/message`,{method:'POST',body:JSON.stringify({parts})});}
}
