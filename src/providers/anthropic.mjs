import { BaseProvider } from './base.mjs';
import { ProviderError } from '../core/errors.mjs';
export class AnthropicProvider extends BaseProvider {
 async call({system,user,signal}) {
  const base=this.baseUrl||'https://api.anthropic.com';
  const response=await this.fetchImpl(base.replace(/\/$/,'')+'/v1/messages',{method:'POST',signal,headers:{'content-type':'application/json','x-api-key':this.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:this.model,max_tokens:8192,system,messages:[{role:'user',content:user}]})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new ProviderError(body.error?.message||`Anthropic HTTP ${response.status}`,response.status,response.status===408||response.status===429||response.status>=500);
  const text=(body.content||[]).filter(x=>x.type==='text').map(x=>x.text||'').join('\n');
  if(!text.trim()) throw new ProviderError('Anthropic response contains no text block');
  return {text,usage:body.usage||null};
 }
}
