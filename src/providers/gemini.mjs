import { BaseProvider } from './base.mjs';
import { ProviderError } from '../core/errors.mjs';
export class GeminiProvider extends BaseProvider {
 async call({system,user,signal,temperature=0}) {
  const base=this.baseUrl||'https://generativelanguage.googleapis.com/v1beta';
  const url=base.replace(/\/$/,'')+'/models/'+encodeURIComponent(this.model)+':generateContent?key='+encodeURIComponent(this.apiKey);
  const response=await this.fetchImpl(url,{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{responseMimeType:'application/json',temperature}})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new ProviderError(body.error?.message||`Gemini HTTP ${response.status}`,response.status,response.status===408||response.status===429||response.status>=500);
  const text=body.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';
  if(!text.trim()) throw new ProviderError('Gemini response contains no candidate text');
  return {text,usage:body.usageMetadata||null};
 }
}
