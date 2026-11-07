#!/usr/bin/env node
import { OpenCodeClient } from '../src/adapters/opencode/client.mjs';

const directory=process.env.OIOL_OPENCODE_DIRECTORY;
if(!directory) {
  console.error('OIOL_OPENCODE_DIRECTORY must point to the absolute path of a disposable or intended test repository.');
  process.exit(2);
}

const client=new OpenCodeClient({
  baseUrl:process.env.OIOL_OPENCODE_URL||'http://127.0.0.1:4096',
  username:process.env.OIOL_OPENCODE_USERNAME||'opencode',
  password:process.env.OIOL_OPENCODE_PASSWORD||'',
  directory
});

let sessionId=null;
let outcome=null;
try {
  const health=await client.health();
  if(health?.healthy!==true) throw new Error('OpenCode health endpoint did not report healthy=true');
  const session=await client.createSession(`[OIOL smoke] ${new Date().toISOString()}`);
  if(typeof session?.id!=='string'||!session.id) throw new Error('OpenCode did not return a session ID');
  sessionId=session.id;
  const fetched=await client.getSession(sessionId);
  if(fetched?.id!==sessionId) throw new Error('OpenCode session read-back did not match the created session');
  outcome={healthy:true,version:health.version||null,projectDirectory:client.directory,sessionCreateRead:true};
} catch(error) {
  console.error(`OpenCode smoke test failed: ${error.message}`);
  process.exitCode=1;
} finally {
  if(sessionId) {
    try {
      const deleted=await client.deleteSession(sessionId);
      if(deleted!==true) throw new Error('OpenCode did not confirm session deletion');
      if(outcome) outcome.sessionDeleted=true;
    } catch(error) {
      console.error(`Could not clean up smoke-test session ${sessionId}: ${error.message}`);
      process.exitCode=1;
    }
  }
}

if(outcome&&process.exitCode!==1) console.log(JSON.stringify(outcome,null,2));
