#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const mid=Math.floor(sorted.length/2);
  return Number((sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2).toFixed(2));
};
const stats=values=>({count:values.length,median:median(values),min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,spread:values.length?Number((Math.max(...values)-Math.min(...values)).toFixed(2)):null});

export function aggregateRuns(runs) {
  if(!Array.isArray(runs)||runs.length===0)throw new Error('At least one benchmark result is required');
  const ids=runs.map(x=>x.runId);
  if(ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)throw new Error('Every input must have a unique non-empty runId');
  const fingerprints=new Set(runs.map(x=>x.configFingerprint));
  if(fingerprints.size!==1)throw new Error('Cannot aggregate runs with different configuration fingerprints');
  const scenarioMap=new Map();
  for(const run of runs) {
    if(!Array.isArray(run.scores))throw new Error('Each run must contain a scores array');
    for(const row of run.scores) {
      if(typeof row.scenarioId!=='string'||!Number.isFinite(row.score))throw new Error('Invalid scenario score row');
      const list=scenarioMap.get(row.scenarioId)||[];
      list.push({runId:run.runId,score:row.score,status:row.status||'unknown',blockers:Array.isArray(row.blockers)?row.blockers:[]});
      scenarioMap.set(row.scenarioId,list);
    }
  }
  const scenarios=[...scenarioMap.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([scenarioId,rows])=>{
    const values=rows.map(x=>x.score);
    return {scenarioId,...stats(values),runs:rows,failedRuns:rows.filter(x=>x.blockers.length>0||x.score<80).length};
  });
  const scores=runs.map(x=>Number(x.summary?.averageScore)).filter(Number.isFinite);
  const failures=runs.reduce((n,x)=>n+(x.scores||[]).filter(s=>s.blockers?.length||s.score<80).length,0);
  const total=runs.reduce((n,x)=>n+(x.scores||[]).length,0);
  return {
    protocolVersion:'1.0',aggregatorVersion:'1.0.0',aggregatedAt:new Date().toISOString(),
    configurationFingerprint:[...fingerprints][0],runCount:runs.length,
    repeatedRunGate:{minimumRuns:3,met:runs.length>=3},
    runAverageScore:stats(scores),
    scenarioCount:scenarios.length,scenarioResults:scenarios,
    failedScenarioObservations:failures,totalScenarioObservations:total,
    failureRate:total?Number((failures/total).toFixed(4)):null,
    certificationReadyForHumanReview:runs.length>=3&&scenarios.every(x=>x.count===runs.length)&&failures===0,
    limitations:['This aggregation does not replace blinded human review.','Runs must use the same configuration fingerprint; repository snapshots and budgets must also be held constant by the operator.','The automated pass threshold is a screening gate, not proof of quality.']
  };
}

function readArg(name) {const index=process.argv.indexOf('--'+name);return index>=0?process.argv[index+1]:null;}
export async function main() {
  const inputs=readArg('inputs');
  if(!inputs)throw new Error('Provide --inputs file1.json,file2.json,file3.json');
  const files=inputs.split(',').map(x=>x.trim()).filter(Boolean);
  if(!files.length)throw new Error('No input result files supplied');
  const runs=await Promise.all(files.map(async file=>JSON.parse(await fs.readFile(path.resolve(file),'utf8'))));
  const report=aggregateRuns(runs);
  const output=path.resolve(readArg('out')||'benchmarks/results/repeat-aggregate.json');
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(report,null,2)+'\\n');
  console.log(JSON.stringify({runCount:report.runCount,scenarioCount:report.scenarioCount,failureRate:report.failureRate,certificationReadyForHumanReview:report.certificationReadyForHumanReview,output},null,2));
  return report.certificationReadyForHumanReview?0:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{process.exitCode=await main();}catch(error){console.error('Aggregation error: '+error.message);process.exitCode=1;}
}
