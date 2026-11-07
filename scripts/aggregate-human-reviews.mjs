#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scenarios } from '../benchmarks/scenarios.mjs';

const DIMENSIONS = [
  'technical_correctness_1_5',
  'requirement_understanding_1_5',
  'task_decomposition_1_5',
  'acceptance_criteria_1_5',
  'scope_and_safety_1_5',
  'clarification_quality_1_5',
  'overall_1_5'
];

export function parseCsv(source) {
  const rows=[];
  let row=[],field='',quoted=false;
  for(let index=0;index<source.length;index++){
    const char=source[index];
    if(quoted){
      if(char==='"'&&source[index+1]==='"'){field+='"';index++;}
      else if(char==='"')quoted=false;
      else field+=char;
    }else if(char==='"'&&field.length===0)quoted=true;
    else if(char===','){row.push(field);field='';}
    else if(char==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=char;
  }
  if(quoted)throw new Error('CSV contains an unterminated quoted field');
  if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  if(!rows.length)return [];
  const headers=rows.shift().map(value=>value.trim());
  if(new Set(headers).size!==headers.length)throw new Error('CSV contains duplicate column names');
  return rows.filter(values=>values.some(value=>String(value).trim()!=='')).map(values=>{
    const record={};
    headers.forEach((header,index)=>record[header]=values[index]??'');
    return record;
  });
}

const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const middle=Math.floor(sorted.length/2);
  return Number((sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2).toFixed(2));
};
function parseScore(value,label,optional=false){
  if(optional&&String(value??'').trim()==='')return null;
  const score=Number(value);
  if(!Number.isInteger(score)||score<1||score>5)throw new Error(label+' must be an integer from 1 to 5');
  return score;
}
function parseBoolean(value,label){
  const normalized=String(value??'').trim().toLowerCase();
  if(['yes','true','1'].includes(normalized))return true;
  if(['no','false','0'].includes(normalized))return false;
  throw new Error(label+' must be yes or no');
}

export function aggregateHumanReviews(rows,expectedScenarioIds=scenarios.map(item=>item.id)){
  if(!Array.isArray(rows))throw new Error('Human review rows must be an array');
  const grouped=new Map();
  const unique=new Set();
  for(const [index,row] of rows.entries()){
    const scenarioId=String(row.scenario_id||'').trim();
    const reviewerId=String(row.reviewer_id||'').trim();
    if(!scenarioId||!reviewerId)throw new Error('Review row '+(index+1)+' requires scenario_id and reviewer_id');
    if(!expectedScenarioIds.includes(scenarioId))throw new Error('Unknown scenario_id in review row: '+scenarioId);
    const key=scenarioId+'::'+reviewerId;
    if(unique.has(key))throw new Error('Duplicate review for scenario '+scenarioId+' by reviewer '+reviewerId);
    unique.add(key);
    const scores={};
    for(const dimension of DIMENSIONS)scores[dimension]=parseScore(row[dimension],dimension);
    const criticalFinding=parseBoolean(row.critical_finding_yes_no,'critical_finding_yes_no');
    const evidenceNotes=String(row.evidence_notes||'').trim();
    if(!evidenceNotes)throw new Error('Evidence notes are required for '+scenarioId+' / '+reviewerId);
    const adjudicated=parseScore(row.adjudicated_overall_1_5,'adjudicated_overall_1_5',true);
    const adjudicationNotes=String(row.adjudication_notes||'').trim();
    if(adjudicated!==null&&!adjudicationNotes)throw new Error('Adjudication notes are required when an adjudicated score is supplied');
    const entry={scenarioId,reviewerId,scores,criticalFinding,evidenceNotes,adjudicated,adjudicationNotes};
    const list=grouped.get(scenarioId)||[];
    list.push(entry);grouped.set(scenarioId,list);
  }
  const scenarioResults=expectedScenarioIds.map(scenarioId=>{
    const reviews=grouped.get(scenarioId)||[];
    const dimensionMedians=Object.fromEntries(DIMENSIONS.map(dimension=>[dimension,median(reviews.map(review=>review.scores[dimension]))]));
    const overallScores=reviews.map(review=>review.scores.overall_1_5);
    const spread=overallScores.length?Math.max(...overallScores)-Math.min(...overallScores):null;
    const adjudication=reviews.find(review=>review.adjudicated!==null);
    const disagreementUnresolved=spread!==null&&spread>=2&&!adjudication;
    const overall=adjudication?.adjudicated??dimensionMedians.overall_1_5;
    return {
      scenarioId,
      reviewerCount:new Set(reviews.map(review=>review.reviewerId)).size,
      reviewers:reviews.map(review=>review.reviewerId),
      dimensionMedians,
      overallMedian:overall,
      rawOverallSpread:spread,
      criticalFinding:reviews.some(review=>review.criticalFinding),
      disagreementUnresolved,
      adjudication:adjudication?{score:adjudication.adjudicated,notes:adjudication.adjudicationNotes}:null
    };
  });
  const covered=scenarioResults.filter(item=>item.reviewerCount>=2).length;
  const unresolvedDisagreements=scenarioResults.filter(item=>item.disagreementUnresolved).map(item=>item.scenarioId);
  const criticalScenarios=scenarioResults.filter(item=>item.criticalFinding).map(item=>item.scenarioId);
  const overallScores=scenarioResults.map(item=>item.overallMedian).filter(Number.isFinite);
  const minimumScenarioScore=overallScores.length?Math.min(...overallScores):null;
  const overallMedian=median(overallScores);
  const allCovered=scenarioResults.length===expectedScenarioIds.length&&covered===expectedScenarioIds.length;
  const certificationReady=allCovered&&unresolvedDisagreements.length===0&&criticalScenarios.length===0&&overallMedian!==null&&overallMedian>=4&&minimumScenarioScore>=3;
  return {
    protocolVersion:'1.0',
    reviewCount:rows.length,
    expectedScenarioCount:expectedScenarioIds.length,
    scenariosWithAtLeastTwoReviewers:covered,
    completeReviewerCoverage:allCovered,
    overallMedian,
    minimumScenarioScore,
    unresolvedDisagreements,
    criticalScenarios,
    scenarioResults,
    certificationReady,
    decision:certificationReady?'human_review_gate_passed':'human_review_gate_not_met',
    limitations:['Scores are human-entered and depend on reviewer calibration.','A critical finding blocks certification regardless of average score.','Disagreements with an overall score spread of 2 or more require a documented adjudicated score.']
  };
}

function readArg(name){const index=process.argv.indexOf('--'+name);return index>=0?process.argv[index+1]:null;}
export async function main(){
  const inputs=readArg('inputs');
  if(!inputs)throw new Error('Provide --inputs reviewer-a.csv,reviewer-b.csv');
  const files=inputs.split(',').map(value=>value.trim()).filter(Boolean);
  const rows=[];
  for(const file of files)rows.push(...parseCsv(await fs.readFile(path.resolve(file),'utf8')));
  const report=aggregateHumanReviews(rows);
  const output=path.resolve(readArg('out')||'benchmarks/results/human-review-aggregate.json');
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({reviewCount:report.reviewCount,scenariosWithAtLeastTwoReviewers:report.scenariosWithAtLeastTwoReviewers,overallMedian:report.overallMedian,certificationReady:report.certificationReady,output},null,2));
  return report.certificationReady?0:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{process.exitCode=await main();}catch(error){console.error('Human review aggregation error: '+error.message);process.exitCode=1;}
}
