import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreScenario, summarizeBenchmark } from '../benchmarks/scoring.mjs';

const project={kind:'greenfield',name:'test',request:'test'};
const scenario={id:'T-1',category:'ambiguous',difficulty:'hard',project,expectedSignals:[['identity provider','idp'],['saml','oidc']],mustClarify:true,clarificationSignals:[['identity provider','idp'],['protocol','saml','oidc']]};
const plan={
 requirements:[{id:'r1',statement:'Configure identity provider and OIDC protocol'}],
 architecture:{components:[{id:'c1',name:'Identity integration'}]},
 tasks:[{id:'t1',title:'Prepare identity provider integration',requirementIds:['r1'],componentIds:['c1'],dependencies:[],acceptanceCriteria:['Provider configuration is documented','OIDC metadata validation is tested'],writeScope:['src/identity']}],
 dependencyGraph:{nodes:['t1'],edges:[]},
 clarifications:[{id:'q1',question:'Which identity provider and protocol should be used?',blocking:true,resolved:false}],
 review:{independent:true}
};
test('benchmark rubric rewards correct blocking clarification and scenario coverage',()=>{
 const result=scoreScenario(scenario,{plan,elapsedMs:12});
 assert.equal(result.validation.valid,false);
 assert.equal(result.clarificationPass,true);
 assert.equal(result.dimensions.requirementSignalCoverage,1);
 assert.equal(result.dimensions.clarificationDiscipline,1);
 assert.ok(result.score>50);
});
test('benchmark rubric flags missing required clarification',()=>{
 const result=scoreScenario(scenario,{plan:{...plan,clarifications:[]}});
 assert.equal(result.clarificationPass,false);
 assert.equal(result.dimensions.clarificationDiscipline,0);
 assert.ok(result.blockers.some(x=>x.includes('blocking unresolved clarification')));
});
test('benchmark summary reports median and category averages',()=>{
 const result=summarizeBenchmark([{score:60,category:'greenfield',blockers:[]},{score:80,category:'greenfield',blockers:[]}]);
 assert.equal(result.scenarioCount,2);
 assert.equal(result.medianScore,70);
 assert.equal(result.byCategory.greenfield.average,70);
});
