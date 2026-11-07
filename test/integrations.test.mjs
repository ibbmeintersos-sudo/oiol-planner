import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.mjs';
import { AnthropicProvider } from '../src/providers/anthropic.mjs';
import { GeminiProvider } from '../src/providers/gemini.mjs';
import { OllamaProvider } from '../src/providers/ollama.mjs';
import { OpenCodeClient } from '../src/adapters/opencode/client.mjs';
import { OpenCodeTaskRunner } from '../src/execution/opencode-runner.mjs';
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('OpenAI-compatible provider sends JSON mode and parses the model response',async()=>{let call;const provider=new OpenAICompatibleProvider({baseUrl:'https://llm.example/v1',apiKey:'test-key',model:'test-model',fetchImpl:async(url,options)=>{call={url,options};return response({choices:[{message:{content:'{"ok":true}'}}],usage:{total_tokens:4}});}});const result=await provider.requestJson({system:'system',user:'user'});assert.equal(result.data.ok,true);assert.equal(call.url,'https://llm.example/v1/chat/completions');assert.equal(call.options.headers.authorization,'Bearer test-key');assert.deepEqual(JSON.parse(call.options.body).response_format,{type:'json_object'});});
test('Anthropic provider extracts text blocks and sets required headers',async()=>{let call;const provider=new AnthropicProvider({apiKey:'key',model:'claude-test',fetchImpl:async(url,options)=>{call={url,options};return response({content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'{"ok":true}'}]});}});const result=await provider.requestJson({system:'s',user:'u'});assert.equal(result.data.ok,true);assert.equal(call.options.headers['anthropic-version'],'2023-06-01');assert.equal(call.options.headers['x-api-key'],'key');});
test('Gemini provider encodes model and API key and parses JSON',async()=>{let url='';const provider=new GeminiProvider({apiKey:'key with space',model:'gemini test',fetchImpl:async(u)=>{url=u;return response({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]});}});const result=await provider.requestJson({system:'s',user:'u'});assert.equal(result.data.ok,true);assert.match(url,/gemini%20test:generateContent/);assert.match(url,/key%20with%20space/);});
test('Ollama provider uses non-streaming JSON mode',async()=>{let body;const provider=new OllamaProvider({model:'qwen-local',fetchImpl:async(url,options)=>{body=JSON.parse(options.body);return response({message:{content:'{"ok":true}'},prompt_eval_count:3,eval_count:2});}});const result=await provider.requestJson({system:'s',user:'u'});assert.equal(result.data.ok,true);assert.equal(body.stream,false);assert.equal(body.format,'json');});
test('provider retries transient server failures but not authentication failures',async()=>{let transientCalls=0;const retrying=new OpenAICompatibleProvider({baseUrl:'https://llm.example',model:'m',maxRetries:1,fetchImpl:async()=>{transientCalls++;return transientCalls===1?response({error:{message:'temporary'}},503):response({choices:[{message:{content:'{"ok":true}'}}]});}});assert.equal((await retrying.requestJson({system:'s',user:'u'})).data.ok,true);assert.equal(transientCalls,2);let authCalls=0;const denied=new OpenAICompatibleProvider({baseUrl:'https://llm.example',model:'m',maxRetries:3,fetchImpl:async()=>{authCalls++;return response({error:{message:'unauthorized'}},401);}});await assert.rejects(()=>denied.requestJson({system:'s',user:'u'}),/unauthorized/);assert.equal(authCalls,1);});
test('provider rejects successful HTTP responses without model text',async()=>{const provider=new OpenAICompatibleProvider({baseUrl:'https://llm.example',model:'m',fetchImpl:async()=>response({choices:[]})});await assert.rejects(()=>provider.requestJson({system:'s',user:'u'}),/missing choices/);});
test('OpenCode adapter applies auth, encodes session IDs and parses JSON',async()=>{const calls=[];const client=new OpenCodeClient({baseUrl:'http://127.0.0.1:4096',password:'secret',directory:'/workspace',fetchImpl:async(url,options)=>{calls.push({url,options});return new Response('{"id":"session"}',{status:200});}});const result=await client.getSession('a/b');assert.equal(result.id,'session');assert.equal(calls[0].url,'http://127.0.0.1:4096/session/a%2Fb');assert.equal(calls[0].options.headers.authorization,'Basic '+Buffer.from('opencode:secret').toString('base64'));});
test('OpenCode adapter rejects unsafe routes and malformed JSON',async()=>{const client=new OpenCodeClient({fetchImpl:async()=>new Response('not-json',{status:200})});await assert.rejects(()=>client.request('//evil.example'),/configured server/);await assert.rejects(()=>client.health(),/invalid JSON/);});
test('OpenCode adapter reports request timeouts',async()=>{const client=new OpenCodeClient({timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))});await assert.rejects(()=>client.health(),/timed out after 5ms/);});
test('OpenCode adapter accepts empty 204 responses',async()=>{const client=new OpenCodeClient({fetchImpl:async()=>new Response(null,{status:204})});assert.equal(await client.request('/session',{method:'DELETE'}),null);});

test('OpenCode session creation sends only documented session fields',async()=>{let body;const client=new OpenCodeClient({fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return new Response('{"id":"s1"}',{status:200});}});await client.createSession('Task session');assert.deepEqual(body,{title:'Task session'});});
test('OpenCode prompt requires typed parts and sends model/agent options',async()=>{let body;const client=new OpenCodeClient({fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return new Response('{"info":{"id":"m1"},"parts":[]}',{status:200});}});await client.prompt('s1',[{type:'text',text:'Do work'}],{agent:'build',model:{providerID:'openai',modelID:'test'}});assert.equal(body.parts[0].type,'text');assert.equal(body.agent,'build');assert.equal(body.model.modelID,'test');assert.throws(()=>client.prompt('s1',['plain text']),/typed parts/);});
test('OpenCode client supports configured basic-auth username',async()=>{let auth;const client=new OpenCodeClient({username:'custom-user',password:'pw',fetchImpl:async(_url,options)=>{auth=options.headers.authorization;return new Response('{"healthy":true}',{status:200});}});await client.health();assert.equal(auth,'Basic '+Buffer.from('custom-user:pw').toString('base64'));});
test('OpenCode task runner creates a session, prompts, collects diff and delegates verification',async()=>{const calls=[],client={async createSession(title){calls.push(['create',title]);return {id:'session-1'};},async prompt(id,parts,options){calls.push(['prompt',id,parts[0].text,options]);return {info:{id:'message-1',role:'assistant'},parts:[{type:'text',text:'Implemented task'}]};},async getSessionDiff(id){calls.push(['diff',id]);return [{file:'src/api/endpoint.mjs',patch:'@@'}];}};let verified=false;const runner=new OpenCodeTaskRunner({client,agent:'build',verifyTask:async(task,result)=>{verified=true;return {passed:result.diff.length===1,method:'diff-check'};}});const task={id:'t2',title:'Implement endpoint',description:'Add endpoint',acceptanceCriteria:['Endpoint returns JSON'],writeScope:['src/api']};const context={runId:'run-1',results:new Map([['t1',{result:{outputs:{contract:'v1'}}}]])};const result=await runner.execute(task,context);const verdict=await runner.verify(task,result,context);assert.equal(result.sessionId,'session-1');assert.equal(result.messageId,'message-1');assert.ok(calls[1][3].timeoutMs>0&&calls[1][3].timeoutMs<=600000,'prompt timeout must be the remaining task deadline');assert.match(result.assistantText,/Implemented task/);assert.match(calls[1][2],/contract/);assert.equal(verdict.passed,true);assert.equal(verified,true);assert.equal(runner.concurrentSafe,false);});
test('OpenCode task runner requires independent verification',()=>{const client={createSession(){},prompt(){},getSessionDiff(){}};assert.throws(()=>new OpenCodeTaskRunner({client}),/verifyTask callback/);});
test('OpenCode task runner aborts its session when prompt is cancelled',async()=>{const controller=new AbortController();let aborted=false;const client={async createSession(){return {id:'session-2'};},async prompt(){controller.abort();throw new Error('cancelled');},async getSessionDiff(){return [];},async abortSession(){aborted=true;}};const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true});await assert.rejects(()=>runner.execute({id:'t',title:'T',acceptanceCriteria:[],writeScope:[]},{runId:'r',results:new Map(),signal:controller.signal}),/cancelled/);assert.equal(aborted,true);});

test('OpenCode client supports per-request timeout overrides',async()=>{const client=new OpenCodeClient({timeoutMs:1000,fetchImpl:(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))});await assert.rejects(()=>client.request('/slow',{timeoutMs:5}),/timed out after 5ms/);});
test('OpenCode task runner rejects non-assistant responses',async()=>{const client={async createSession(){return {id:'s'};},async prompt(){return {info:{role:'user'},parts:[]};},async getSessionDiff(){return [];}};const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true});await assert.rejects(()=>runner.execute({id:'t',title:'T',acceptanceCriteria:[],writeScope:[]},{runId:'r',results:new Map()}),/invalid assistant message/);});


test('OpenCode task runner rejects changes outside the declared write scope',async()=>{
  const client={
    async createSession(){return {id:'scope-session'};},
    async prompt(){return {info:{id:'scope-message',role:'assistant'},parts:[{type:'text',text:'Done'}]};},
    async getSessionDiff(){return [{file:'src/private/secrets.txt',patch:'@@'}];},
    async abortSession(){}
  };
  const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true});
  await assert.rejects(()=>runner.execute(
    {id:'scope-task',title:'Scoped change',acceptanceCriteria:['works'],writeScope:['src/api']},
    {runId:'scope-run',results:new Map()}
  ),/outside the task write scope/);
});

test('OpenCode task runner rejects traversal and absolute paths in diffs',async()=>{
  for(const file of ['../outside.txt','/etc/passwd','src/api/../../outside.txt']) {
    const client={
      async createSession(){return {id:'scope-session'};},
      async prompt(){return {info:{id:'scope-message',role:'assistant'},parts:[]};},
      async getSessionDiff(){return [{file,patch:'@@'}];},
      async abortSession(){}
    };
    const runner=new OpenCodeTaskRunner({client,verifyTask:async()=>true});
    await assert.rejects(()=>runner.execute(
      {id:'scope-task',title:'Scoped change',acceptanceCriteria:['works'],writeScope:['src/api']},
      {runId:'scope-run',results:new Map()}
    ),/outside the task write scope/);
  }
});
