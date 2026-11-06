import { ProviderError } from '../core/errors.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class BaseProvider {
  constructor({apiKey='',baseUrl='',model='',timeoutMs=60000,maxRetries=2}={}){Object.assign(this,{apiKey,baseUrl,model,timeoutMs,maxRetries});}
  async requestJson({system,user,temperature=0}){
    let last;
    for(let attempt=0;attempt<=this.maxRetries;attempt++){
      const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try{
        const response=await this.call({system,user,temperature,signal:controller.signal});
        clearTimeout(timer);
        const text=typeof response==='string'?response:response.text;
        const parsed=parseJson(text);
        return {data:parsed,usage:response.usage||null,model:this.model};
      }catch(e){clearTimeout(timer);last=e;const retryable=e.retryable||e.name==='AbortError'||/fetch failed|network/i.test(e.message);if(!retryable||attempt===this.maxRetries)break;await sleep(300*2**attempt);}
    }
    throw last instanceof Error?last:new ProviderError(String(last));
  }
  async call(){throw new Error('Provider.call must be implemented');}
}
export function parseJson(text){let s=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<a)throw new ProviderError('Provider did not return a JSON object');try{return JSON.parse(s.slice(a,b+1));}catch(e){throw new ProviderError(`Invalid JSON from provider: ${e.message}`);}}
