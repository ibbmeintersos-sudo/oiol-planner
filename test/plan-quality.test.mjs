import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePlan, evaluatePlanQuality } from '../src/core/evaluate.mjs';
import { scoreScenario } from '../benchmarks/scoring.mjs';

const completeQuality = {
  requirements: [{
    id:'nfr-1',category:'non_functional',qualityAttribute:'performance',
    statement:'The service meets an agreed p95 latency target.',
    measurement:{metric:'p95 latency',target:'250',unit:'ms at 100 RPS',measurementMethod:'Representative load profile.'},
    acceptanceCriteria:['p95 latency is at most 250 ms at the reference load.']
  }],
  testStrategy:{
    approach:'Risk-based testing.',
    levels:['unit','integration','contract'],
    coverage:['nfr-1'],
    entryCriteria:['API contract reviewed.'],
    exitCriteria:['All required checks pass.'],
    testData:'Synthetic tenant records.'
  },
  rollbackPlan:{
    applicability:'applicable',
    strategy:'Revert traffic to the previous compatible version.',
    triggerConditions:['Error rate breaches the release threshold.'],
    steps:['Stop rollout.','Restore the previous routing configuration.'],
    verification:['Check service health and data consistency.'],
    dataCompatibility:'The new writes remain readable by the previous version during the rollback window.'
  },
  unknownsReviewed:true,
  assumptions:[{id:'a1',statement:'The DB supports additive migrations.',confidence:'medium',validationApproach:'Check the deployed DB version.'}],
  unknowns:[{id:'u1',description:'Production p95 baseline is unknown.',impact:'The target could be miscalibrated.',resolutionApproach:'Measure before release.',blocking:false}],
  risks:[{id:'r1',description:'Load may exceed available capacity.',likelihood:3,impact:4,mitigation:'Load-test and apply admission control.'}]
};

test('plan quality metrics quantify NFR measurement, test strategy, rollback, unknowns, assumptions, and risk exposure',()=>{
  const quality=evaluatePlanQuality(completeQuality);
  assert.equal(quality.nfr.measurableRate,1);
  assert.equal(quality.testStrategy.completeness,1);
  assert.equal(quality.rollback.completeness,1);
  assert.equal(quality.unknowns.transparency,1);
  assert.equal(quality.assumptions.validationRate,1);
  assert.equal(quality.risks.estimatedRate,1);
  assert.equal(quality.risks.mitigationRate,1);
  assert.equal(quality.risks.exposure[0].score,12);
  assert.equal(quality.risks.exposure[0].band,'high');
});

test('explicitly not-applicable rollback and reviewed empty unknowns are measurable, not omissions',()=>{
  const quality=evaluatePlanQuality({
    rollbackPlan:{applicability:'not_applicable',rationale:'The plan only changes local documentation and has no deployed state.'},
    unknownsReviewed:true,unknowns:[]
  });
  assert.equal(quality.rollback.completeness,1);
  assert.equal(quality.rollback.notApplicable,true);
  assert.equal(quality.unknowns.transparency,1);
});

test('missing quality sections are exposed as diagnostics without turning them into invented facts',()=>{
  const result=evaluatePlan({
    requirements:[{id:'nfr-1',category:'non_functional',statement:'The system is fast.'}],
    architecture:{components:[],decisions:[]},tasks:[],dependencyGraph:{nodes:[],edges:[]},
    risks:[{id:'r1',description:'Availability risk'}],unknownsReviewed:false
  });
  assert.deepEqual(result.planQuality.nfr.unmeasuredRequirementIds,['nfr-1']);
  assert.ok(result.qualityDiagnostics.testStrategyMissingFields.length>0);
  assert.ok(result.qualityDiagnostics.rollbackPlanMissingFields.length>0);
  assert.equal(result.qualityDiagnostics.unknownsNotReviewed,true);
  assert.deepEqual(result.qualityDiagnostics.risksWithoutEstimates,['r1']);
});

test('benchmark score contains the five P2 plan-quality dimensions',()=>{
  const scenario={id:'P2-QUALITY',category:'greenfield',difficulty:'medium',project:{kind:'greenfield',name:'Quality fixture',request:'Quality evaluation'},expectedSignals:[],mustClarify:false};
  const plan={
    ...completeQuality,
    status:'ready_for_review',
    requirements:[{id:'r1',statement:'Define a service'}],
    architecture:{components:[{id:'c1',name:'API'}],decisions:[]},
    tasks:[{id:'t1',title:'Define API',requirementIds:['r1'],componentIds:['c1'],dependencies:[],acceptanceCriteria:['Contract defined','Contract reviewed'],writeScope:['docs/api']}],
    dependencyGraph:{nodes:['t1'],edges:[]},
    clarifications:[],
    review:{configurationDistinct:true}
  };
  const row=scoreScenario(scenario,{plan});
  for(const dimension of ['nfrMeasurement','testStrategy','rollbackStrategy','unknownsTransparency','riskEstimation']) {
    assert.ok(Number.isFinite(row.dimensions[dimension]));
    assert.ok(row.dimensions[dimension]>=0&&row.dimensions[dimension]<=1);
  }
  assert.equal(Object.values(row.weights).reduce((sum,value)=>sum+value,0),100);
  assert.equal(row.planQuality.risks.estimatedCount,1);
});

test('risk quality reports confidence coverage and the basis used for an estimate',()=>{
  const quality=evaluatePlanQuality({risks:[
    {id:'r1',description:'Availability loss',likelihood:3,impact:4,confidence:'medium',assessmentBasis:'Single regional dependency.',mitigation:'Define recovery.'},
    {id:'r2',description:'Documentation issue',likelihood:1,impact:1,mitigation:'Review docs.'}
  ]});
  assert.equal(quality.risks.estimatedCount,2);
  assert.equal(quality.risks.confidenceRatedCount,1);
  assert.equal(quality.risks.confidenceRate,0.5);
  assert.equal(quality.risks.exposure[0].assessmentBasis,'Single regional dependency.');
});

test('blocking unknowns are counted as decision blockers',()=>{
  const quality=evaluatePlanQuality({
    unknownsReviewed:true,
    unknowns:[{id:'u1',description:'Provider undecided',impact:'Trust model unknown',resolutionApproach:'Confirm with owner.',blocking:true}]
  });
  assert.equal(quality.unknowns.unresolvedBlockingCount,1);
  assert.equal(quality.unknowns.transparency,1);
});
