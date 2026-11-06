import { BaseProvider } from './base.mjs';
import { ProviderError } from '../core/errors.mjs';
export class OllamaProvider extends BaseProvider {
 async call({system,user,signal}){
  const r=await fetch(`${(this.baseUrl||'http://127.0.0.1:11434').replace(/\/$/,'')}/api/chat`,{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({model:this.model,messages:[{role:'system',content:system},{role:'user',content:user}],stream:false,format:'json',options:{temperature:0}})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new ProviderError(j.error||`Ollama HTTP ${r.status}`,r.status,r.status>=500);
  return {text:j.message?.content||'',usage:{prompt_tokens:j.prompt_eval_count,completion_tokens:j.eval_count}};
 }
}
