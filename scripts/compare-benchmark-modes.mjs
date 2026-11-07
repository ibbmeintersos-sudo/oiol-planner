#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const median=values=>{const a=[...values].sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return Number((a.length%2?a[m]:(a[m-1]+a[m])/2).toFixed(2));};
function indexScores(run){
 const map=new Map();
 for(const row of run.scores||[]){if(map.has(row.scenarioId))throw new Error('Duplicate scenario score in run: '+row.scenarioId);map.set(row.scenarioId,row);}
 return map;
}
export function compareBenchmarkModes(oiol,baseline){
 if(oiol?.executionMode!=='oiol')throw new Error('First input must be an OIOL planner run');
 if(baseline?.executionMode!=='opencode-baseline')throw new Error('Second input must be an OpenCode baseline run');
 if(!oiol.comparisonKey||oiol.comparisonKey!==baseline.comparisonKey)throw new Error('Runs must have the same non-empty OIOL_BENCHMARK_COMPARISON_KEY');
 if(!oiol.budgetKey||oiol.budgetKey!==baseline.budgetKey)throw new Error('Runs must have the same non-empty OIOL_BENCHMARK_BUDGET_KEY');
 const a=indexScores(oiol),b=indexScores(baseline);
 const ids=[...a.keys()].sort(),other=[...b.keys()].sort();
 if(ids.length!==other.length||ids.some((id,i)=>id!==other[i]))throw new Error('OIOL and OpenCode runs must contain exactly the same scenario IDs');
 const rows=ids.map(id=>{
  const x=a.get(id),y=b.get(id);
  return {scenarioId:id,oiolScore:x.score,baselineScore:y.score,delta:Number((x.score-y.score).toFixed(2)),oiolBlockers:x.blockers||[],baselineBlockers:y.blockers||[]};
 });
 const deltas=rows.map(x=>x.delta);
 const avg=values=>values.length?Number((values.reduce((s,x)=>s+x,0)/values.length).toFixed(2)):0;
 const reviewerComparable=JSON.stringify(oiol.reviewer??null)===JSON.stringify(baseline.reviewer??null);
 return {
  protocolVersion:'1.0',comparedAt:new Date().toISOString(),oiolRunId:oiol.runId,baselineRunId:baseline.runId,
  comparisonKey:oiol.comparisonKey,budgetKey:oiol.budgetKey,scenarioCount:rows.length,
  oiOLAverageScore:oiol.summary?.averageScore??avg(rows.map(x=>x.oiolScore)),
  baselineAverageScore:baseline.summary?.averageScore??avg(rows.map(x=>x.baselineScore)),
  averageScoreDelta:avg(deltas),medianScoreDelta:median(deltas),
  oiOLPassCount:oiol.summary?.passCount??null,baselinePassCount:baseline.summary?.passCount??null,
  reviewerComparable,scenarioResults:rows,
  interpretation:'Positive delta means OIOL scored higher on this automated rubric. This is not evidence of superiority without repeated paired runs and blinded human review.',
  limitations:['comparisonKey and budgetKey are operator attestations, not independently verified hardware/model-budget measurements.','Reviewer configurations differ; this comparison is not fully apples-to-apples until reviewer settings are aligned.','Automated lexical scoring can reward keyword inclusion and cannot establish technical correctness.','Use at least three paired runs and human review before drawing conclusions.']
 };
}
export async function main(){
 const oi=process.argv.indexOf('--oiol'),bi=process.argv.indexOf('--baseline');
 if(oi<0||bi<0||!process.argv[oi+1]||!process.argv[bi+1])throw new Error('Usage: node scripts/compare-benchmark-modes.mjs --oiol oiol-run.json --baseline opencode-run.json [--out report.json]');
 const [a,b]=await Promise.all([fs.readFile(path.resolve(process.argv[oi+1]),'utf8'),fs.readFile(path.resolve(process.argv[bi+1]),'utf8')]);
 const report=compareBenchmarkModes(JSON.parse(a),JSON.parse(b));
 const oiOut=process.argv.indexOf('--out'),out=path.resolve(oiOut>=0&&process.argv[oiOut+1]?process.argv[oiOut+1]:'benchmarks/results/paired-comparison.json');
 await fs.mkdir(path.dirname(out),{recursive:true});
 await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({scenarioCount:report.scenarioCount,averageScoreDelta:report.averageScoreDelta,medianScoreDelta:report.medianScoreDelta,reviewerComparable:report.reviewerComparable,output:out},null,2));
 return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{process.exitCode=await main();}catch(error){console.error('Comparison error: '+error.message);process.exitCode=1;}}
