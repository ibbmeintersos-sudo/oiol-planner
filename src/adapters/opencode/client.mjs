export class OpenCodeClient {
 constructor({baseUrl='http://127.0.0.1:4096',password='',directory}={}){this.baseUrl=baseUrl.replace(/\/$/,'');this.password=password;this.directory=directory;}
 async request(path,options={}){const headers={accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...(this.password?{authorization:`Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`}:{})};const r=await fetch(`${this.baseUrl}${path}`,{...options,headers:{...headers,...options.headers}});if(!r.ok)throw new Error(`OpenCode HTTP ${r.status}: ${await r.text()}`);return r.status===204?null:r.json();}
 health(){return this.request('/global/health');}
 createSession(title){return this.request('/session',{method:'POST',body:JSON.stringify({title,directory:this.directory})});}
 getSession(id){return this.request(`/session/${encodeURIComponent(id)}`);}
 prompt(sessionId,parts){return this.request(`/session/${encodeURIComponent(sessionId)}/message`,{method:'POST',body:JSON.stringify({parts})});}
}
