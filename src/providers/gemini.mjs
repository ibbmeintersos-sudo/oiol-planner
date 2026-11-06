import { BaseProvider } from './base.mjs';
import { ProviderError } from '../core/errors.mjs';
export class GeminiProvider extends BaseProvider {
 async call({system,user,signal}){
  const url=`${this.baseUrl||'https://generativelanguage.googleapis.com/v1beta'}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
  const r=await fetch(url,{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{responseMimeType:'application/json',temperature:0}})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new ProviderError(j.error?.message||`Gemini HTTP ${r.status}`,r.status,r.status===429||r.status>=500);
  return {text:j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'',usage:j.usageMetadata||null};
 }
}
