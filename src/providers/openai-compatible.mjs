import { BaseProvider } from './base.mjs';
import { ProviderError } from '../core/errors.mjs';
export class OpenAICompatibleProvider extends BaseProvider {
 async call({system,user,temperature,signal}) {
  const url=this.baseUrl.replace(/\/$/,'')+'/chat/completions';
  const response=await this.fetchImpl(url,{method:'POST',signal,headers:{'content-type':'application/json',...(this.apiKey?{authorization:`Bearer ${this.apiKey}`}:{})},body:JSON.stringify({model:this.model,messages:[{role:'system',content:system},{role:'user',content:user}],temperature,response_format:{type:'json_object'}})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new ProviderError(body.error?.message||`Provider HTTP ${response.status}`,response.status,response.status===408||response.status===429||response.status>=500);
  const text=body.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim()) throw new ProviderError('OpenAI-compatible response is missing choices[0].message.content');
  return {text,usage:body.usage||null};
 }
}
