import { ProviderError } from '../core/errors.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class BaseProvider {
  constructor({apiKey='',baseUrl='',model='',timeoutMs=60000,maxRetries=2}={}) {
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new Error('timeoutMs must be positive');
    if(!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>5) throw new Error('maxRetries must be an integer from 0 to 5');
    Object.assign(this,{apiKey,baseUrl,model,timeoutMs,maxRetries});
  }
  async requestJson({system,user,temperature=0}) {
    let lastError;
    for(let attempt=0;attempt<=this.maxRetries;attempt++) {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try {
        const response=await this.call({system,user,temperature,signal:controller.signal});
        const text=typeof response==='string'?response:response?.text;
        return {data:parseJson(text),usage:response?.usage||null,model:this.model};
      } catch(error) {
        lastError=error;
        const retryable=error?.retryable===true||error?.name==='AbortError'||/fetch failed|network|timed out/i.test(error?.message||'');
        if(!retryable||attempt===this.maxRetries) break;
        await sleep(Math.min(250*2**attempt,2000));
      } finally { clearTimeout(timer); }
    }
    throw lastError instanceof Error?lastError:new ProviderError(String(lastError));
  }
  async call(){throw new Error('Provider.call must be implemented');}
}
export function parseJson(text) {
  if(typeof text!=='string'||!text.trim()) throw new ProviderError('Provider returned an empty response');
  const source=text.trim().replace(/^\uFEFF/,'');
  const fence=String.fromCharCode(96).repeat(3);
  const fenced=source.match(new RegExp('^'+fence+'(?:json)?\\s*([\\s\\S]*?)\\s*'+fence+'$','i'));
  const candidate=fenced?fenced[1]:source;
  let value;
  try { value=JSON.parse(candidate); } catch(error) { throw new ProviderError(`Provider response is not strict JSON: ${error.message}`); }
  if(value===null||Array.isArray(value)||typeof value!=='object') throw new ProviderError('Provider response must be a JSON object');
  return value;
}
