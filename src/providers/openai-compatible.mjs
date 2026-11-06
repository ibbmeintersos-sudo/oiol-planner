import { BaseProvider } from './base.mjs';
import { ProviderError } from '../core/errors.mjs';
export class OpenAICompatibleProvider extends BaseProvider {
 async call({system,user,temperature,signal}){
  const r=await fetch(`${this.baseUrl.replace(/\/$/,'')}/chat/completions`,{method:'POST',signal,headers:{'content-type':'application/json',...(this.apiKey?{authorization:`Bearer ${this.apiKey}`}:{})},body:JSON.stringify({model:this.model,messages:[{role:'system',content:system},{role:'user',content:user}],temperature,response_format:{type:'json_object'}})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new ProviderError(j.error?.message||`Provider HTTP ${r.status}`,r.status,r.status===429||r.status>=500);
  return {text:j.choices?.[0]?.message?.content||'',usage:j.usage||null};
 }
}
