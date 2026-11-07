#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const median=values=>{const a=[...values].sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return Number((a.length%2?a[m]:(a[m-1]+a[m])/2).toFixed(2));};
const stats=values=>({count:values.length,median:median(values),min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,spread:values.length?Number((Math.max(...values)-Math.min(...values)).toFixed(2)):null});
export function aggregatePairedComparisons(reports){
 if(!Array.isArray(reports)||reports.length===0)throw new Error('At least one paired comparison report is required');
 const ids=reports.map(x=>x.oiolRunId+'|'+x.baselineRunId);
 if(ids.some(x=>x.startsWith('undefined')||x.endsWith('undefined'))||new Set(ids).size!==ids.length)throw new Error('Every paired report must contain unique OIOL and baseline run IDs');
 const comparisonKeys=new Set(reports.map(x=>x.comparisonKey)),budgetKeys=new Set(reports.map(x=>x.budgetKey));
 if(comparisonKeys.size!==1||!reports[0].comparisonKey)throw new Error('Paired reports must share a non-empty comparison key');
 if(budgetKeys.size!==1||!reports[0].budgetKey)throw new Error('Paired reports must share a non-empty budget key');
 const expected=[...(reports[0].scenarioResults||[])].map(x=>x.scenarioId).sort();
 if(!expected.length)throw new Error('Paired reports must contain scenario results');
 for(const report of reports){
  const current=(report.scenarioResults||[]).map(x=>x.scenarioId).sort();
  if(current.length!==expected.length||current.some((x,i)=>x!==expected[i]))throw new Error('All paired reports must cover the same scenario IDs');
 }
 const scenarioResults=expected.map(id=>{
  const rows=reports.map(report=>report.scenarioResults.find(x=>x.scenarioId===id));
  const deltas=rows.map(x=>x.delta);
  return {scenarioId:id,...stats(deltas),runs:rows.map((x,i)=>({oiolRunId:reports[i].oiolRunId,baselineRunId:reports[i].baselineRunId,delta:x.delta}))};
 });
 const runDeltas=reports.map(x=>x.averageScoreDelta).filter(Number.isFinite);
 const reviewerComparable=reports.every(x=>x.reviewerComparable===true);
 return {protocolVersion:'1.0',aggregatorVersion:'1.0.0',aggregatedAt:new Date().toISOString(),comparisonKey:reports[0].comparisonKey,budgetKey:reports[0].budgetKey,pairedRunCount:reports.length,minimumPairedRuns:3,repeatGateMet:reports.length>=3,reviewerComparable,averageDelta:stats(runDeltas),scenarioCount:expected.length,scenarioResults,positiveMedianScenarios:scenarioResults.filter(x=>x.median>0).length,negativeMedianScenarios:scenarioResults.filter(x=>x.median<0).length,zeroMedianScenarios:scenarioResults.filter(x=>x.median===0).length,readyForHumanAdjudication:reports.length>=3&&reviewerComparable,limitations:['The comparison and budget keys are operator attestations.','A repeated automated score difference is not a statistical proof of superiority.','Blinded human review and inspection of failure cases remain mandatory.']};
}
export async function main(){
 const index=process.argv.indexOf('--inputs');
 if(index<0||!process.argv[index+1])throw new Error('Usage: node scripts/aggregate-paired-comparisons.mjs --inputs pair-1.json,pair-2.json,pair-3.json [--out report.json]');
 const files=process.argv[index+1].split(',').map(x=>x.trim()).filter(Boolean);
 const reports=await Promise.all(files.map(async file=>JSON.parse(await fs.readFile(path.resolve(file),'utf8'))));
 const result=aggregatePairedComparisons(reports);
 const oi=process.argv.indexOf('--out'),out=path.resolve(oi>=0&&process.argv[oi+1]?process.argv[oi+1]:'benchmarks/results/paired-repeat-aggregate.json');
 await fs.mkdir(path.dirname(out),{recursive:true});
 await fs.writeFile(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({pairedRunCount:result.pairedRunCount,repeatGateMet:result.repeatGateMet,reviewerComparable:result.reviewerComparable,readyForHumanAdjudication:result.readyForHumanAdjudication,output:out},null,2));
 return result.readyForHumanAdjudication?0:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{process.exitCode=await main();}catch(error){console.error('Paired aggregation error: '+error.message);process.exitCode=1;}}
