import { BaseProvider } from './base.mjs';
import { ProviderError } from '../core/errors.mjs';
export class AnthropicProvider extends BaseProvider {
 async call({system,user,signal}){
  const r=await fetch(`${this.baseUrl||'https://api.anthropic.com'}/v1/messages`,{method:'POST',signal,headers:{'content-type':'application/json','x-api-key':this.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:this.model,max_tokens:8192,system,messages:[{role:'user',content:user}]})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new ProviderError(j.error?.message||`Anthropic HTTP ${r.status}`,r.status,r.status===429||r.status>=500);
  return {text:(j.content||[]).map(x=>x.text||'').join('\n'),usage:j.usage||null};
 }
}
