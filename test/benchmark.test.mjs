import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreScenario, summarizeBenchmark } from '../benchmarks/scoring.mjs';

const project={kind:'greenfield',name:'test',request:'test'};
const scenario={id:'T-1',category:'ambiguous',difficulty:'hard',project,expectedSignals:[['identity provider','idp'],['saml','oidc']],mustClarify:true,clarificationSignals:[['identity provider','idp'],['protocol','saml','oidc']]};
const plan={
 status:'blocked',
 requirements:[{id:'r1',statement:'Configure identity provider and OIDC protocol'}],
 architecture:{components:[{id:'c1',name:'Identity integration'}]},
 tasks:[{id:'t1',title:'Prepare identity provider integration',requirementIds:['r1'],componentIds:['c1'],dependencies:[],acceptanceCriteria:['Provider configuration is documented','OIDC metadata validation is tested'],writeScope:['src/identity']}],
 dependencyGraph:{nodes:['t1'],edges:[]},
 clarifications:[{id:'q1',question:'Which identity provider and protocol should be used?',blocking:true,resolved:false}],
 review:{configurationDistinct:true}
};
test('benchmark rubric rewards correct blocking clarification and scenario coverage',()=>{
 const result=scoreScenario(scenario,{plan,elapsedMs:12});
 assert.equal(result.validation.valid,false);
 assert.equal(result.validation.structurallyValid,true);
 assert.equal(result.blockers.length,0);
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

test('benchmark scoring validates citations against the actual scanned project evidence, not stale scenario metadata', () => {
  const evidence = {
    id: 'REPO-0123456789ab', type: 'repository_file_excerpt',
    description: 'Redacted source excerpt', source: 'src/service.mjs',
    trustLevel: 'untrusted_repository_content',
    sourceSha256: 'a'.repeat(64), excerptSha256: 'b'.repeat(64)
  };
  const existingScenario = {
    ...scenario,
    project: { kind: 'existing', evidence: [{ id: 'OLD-SCENARIO-ID', type: 'repository_file_excerpt', source: 'old/path.mjs' }] },
    expectedSignals: [], clarificationSignals: [], mustClarify: false
  };
  const existingPlan = {
    status: 'ready_for_review',
    project: { kind: 'existing', evidence: [evidence] },
    evidence: [{ ...evidence }],
    requirements: [{ id: 'r1', statement: 'Expose the service' }],
    architecture: { components: [{ id: 'c1', name: 'Service' }], decisions: [] },
    tasks: [{ id: 't1', title: 'Define service', requirementIds: ['r1'], componentIds: ['c1'], dependencies: [], acceptanceCriteria: ['The service contract is documented'], writeScope: ['docs/service'] }],
    dependencyGraph: { nodes: ['t1'], edges: [] }, risks: [], clarifications: [],
    review: { configurationDistinct: true },
    validation: { schemaValidation: { valid: true, errors: [] } }
  };
  const result = scoreScenario(existingScenario, {
    plan: existingPlan,
    projectEvidence: { evidence: [evidence] }
  });
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.schemaValid, true);
  assert.equal(result.blockers.length, 0);
});

test('benchmark scoring includes schema failures as structural blockers', () => {
 const invalidPlan = {
  ...plan,
  validation: { schemaValidation: { valid: false, errors: ['$.status is required'] } }
 };
 const result = scoreScenario(scenario, { plan: invalidPlan });
 assert.equal(result.validation.schemaValid, false);
 assert.ok(result.blockers.some(error => error.includes('Schema: $.status is required')));
});

test('benchmark scoring remains safe when a task entry is malformed', () => {
 const malformed = { ...plan, tasks: [null] };
 assert.doesNotThrow(() => scoreScenario(scenario, { plan: malformed }));
 assert.equal(scoreScenario(scenario, { plan: malformed }).taskCount, 0);
});
