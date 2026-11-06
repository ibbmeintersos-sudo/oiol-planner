import { BaseProvider } from './base.mjs';
import { ProviderError } from '../core/errors.mjs';
export class OllamaProvider extends BaseProvider {
 async call({system,user,signal,temperature=0}) {
  const base=(this.baseUrl||'http://127.0.0.1:11434').replace(/\/$/,'');
  const response=await this.fetchImpl(base+'/api/chat',{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({model:this.model,messages:[{role:'system',content:system},{role:'user',content:user}],stream:false,format:'json',options:{temperature}})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new ProviderError(body.error||`Ollama HTTP ${response.status}`,response.status,response.status===408||response.status===429||response.status>=500);
  const text=body.message?.content;
  if(typeof text!=='string'||!text.trim()) throw new ProviderError('Ollama response is missing message.content');
  return {text,usage:{prompt_tokens:body.prompt_eval_count,completion_tokens:body.eval_count}};
 }
}
