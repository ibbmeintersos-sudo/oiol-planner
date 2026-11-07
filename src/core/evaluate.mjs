import { validatePlan } from './validator.mjs';
import { overlaps } from './graph.mjs';
import { deriveTaskInterfaces } from './task-interface.mjs';

const objects = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const label = (item, index, prefix) => item.id || item.name || item.title || prefix + '-' + (index + 1);
const hasItems = value => Array.isArray(value) && value.some(item => typeof item === 'string' ? item.trim() : item && typeof item === 'object');
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const hasTextArray = value => Array.isArray(value) && value.length > 0 && value.every(hasText);
const QUALITY_ATTRIBUTES = new Set(['performance','reliability','security','privacy','accessibility','maintainability','observability','scalability','operability','compatibility']);

export function evaluatePlanQuality(plan = {}) {
  const source = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : {};
  const requirements = objects(source.requirements);
  const nfrRequirements = requirements.filter(item => ['non_functional','quality_attribute'].includes(item.category) || QUALITY_ATTRIBUTES.has(item.qualityAttribute));
  const measurableNfr = nfrRequirements.filter(item => {
    const m = item.measurement;
    return QUALITY_ATTRIBUTES.has(item.qualityAttribute) && hasText(m?.metric) && m?.target !== undefined && m?.target !== null &&
      hasText(m?.unit) && hasText(m?.measurementMethod) && hasItems(item.acceptanceCriteria);
  });
  const strategy = source.testStrategy && typeof source.testStrategy === 'object' && !Array.isArray(source.testStrategy) ? source.testStrategy : {};
  const testFields = [hasText(strategy.approach),hasTextArray(strategy.levels),hasTextArray(strategy.coverage),hasTextArray(strategy.entryCriteria),hasTextArray(strategy.exitCriteria),hasText(strategy.testData)];
  const rollback = source.rollbackPlan && typeof source.rollbackPlan === 'object' && !Array.isArray(source.rollbackPlan) ? source.rollbackPlan : {};
  const notApplicable = rollback.applicability === 'not_applicable';
  const rollbackFields = notApplicable ? [hasText(rollback.rationale)] : [
    rollback.applicability === 'applicable',hasText(rollback.strategy),hasTextArray(rollback.triggerConditions),
    hasTextArray(rollback.steps),hasTextArray(rollback.verification),hasText(rollback.dataCompatibility)
  ];
  const unknowns = objects(source.unknowns);
  const unknownsReviewed = source.unknownsReviewed === true;
  const resolvedUnknowns = unknowns.filter(item => hasText(item.description || item.question) && hasText(item.impact) && hasText(item.resolutionApproach) && typeof item.blocking === 'boolean');
  const risks = objects(source.risks);
  const estimatedRisks = risks.filter(item => Number.isInteger(item.likelihood) && item.likelihood >= 1 && item.likelihood <= 5 && Number.isInteger(item.impact) && item.impact >= 1 && item.impact <= 5);
  const risksWithConfidence = risks.filter(item => ['low','medium','high'].includes(item.confidence));
  const risksWithBasis = risks.filter(item => hasText(item.assessmentBasis));
  const riskExposure = estimatedRisks.map(item => {
    const score = item.likelihood * item.impact;
    return { id: item.id || item.description, likelihood: item.likelihood, impact: item.impact, confidence: item.confidence || 'not_recorded', assessmentBasis: item.assessmentBasis || null, score,
      band: score >= 15 ? 'critical' : score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low' };
  });
  const assumptions = objects(source.assumptions);
  const validatedAssumptions = assumptions.filter(item => hasText(item.statement || item.description) && hasText(item.validationApproach) && ['low','medium','high'].includes(item.confidence));
  return {
    nfr: { requirementCount:nfrRequirements.length, measurableCount:measurableNfr.length, measurableRate:nfrRequirements.length?measurableNfr.length/nfrRequirements.length:0, unmeasuredRequirementIds:nfrRequirements.filter(x=>!measurableNfr.includes(x)).map(x=>x.id||x.statement) },
    testStrategy: { completeness:testFields.filter(Boolean).length/testFields.length, completedFields:testFields.filter(Boolean).length, totalFields:testFields.length, missingFields:['approach','levels','coverage','entryCriteria','exitCriteria','testData'].filter((_,i)=>!testFields[i]) },
    rollback: { applicability:rollback.applicability||'not_recorded', notApplicable, completeness:rollbackFields.filter(Boolean).length/rollbackFields.length, completedFields:rollbackFields.filter(Boolean).length, totalFields:rollbackFields.length,
      missingFields:notApplicable?(hasText(rollback.rationale)?[]:['rationale']):['applicability','strategy','triggerConditions','steps','verification','dataCompatibility'].filter((_,i)=>!rollbackFields[i]) },
    unknowns: { reviewed:unknownsReviewed, count:unknowns.length, withResolutionCount:resolvedUnknowns.length, transparency:unknownsReviewed?(unknowns.length?resolvedUnknowns.length/unknowns.length:1):0, unresolvedBlockingCount:unknowns.filter(x=>x.blocking===true).length },
    risks: { count:risks.length, estimatedCount:estimatedRisks.length, estimatedRate:risks.length?estimatedRisks.length/risks.length:0, confidenceRatedCount:risksWithConfidence.length, confidenceRate:risks.length?risksWithConfidence.length/risks.length:0, assessmentBasisCount:risksWithBasis.length, assessmentBasisRate:risks.length?risksWithBasis.length/risks.length:0, mitigatedEstimatedCount:estimatedRisks.filter(x=>hasText(x.mitigation)).length, mitigationRate:risks.length?estimatedRisks.filter(x=>hasText(x.mitigation)).length/risks.length:0,
      exposure:riskExposure, meanExposure:riskExposure.length?Number((riskExposure.reduce((s,x)=>s+x.score,0)/riskExposure.length).toFixed(2)):null, highOrCriticalCount:riskExposure.filter(x=>['high','critical'].includes(x.band)).length },
    assumptions: { count:assumptions.length, validatedCount:validatedAssumptions.length, validationRate:assumptions.length?validatedAssumptions.length/assumptions.length:0 }
  };
}

export function evaluatePlan(plan, project = {}) {
  const source = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : {};
  const validation = validatePlan(plan, project), tasks = objects(source.tasks), requirements = objects(source.requirements);
  const components = objects(source.architecture?.components), decisions = objects(source.architecture?.decisions);
  const risks = objects(source.risks), clarifications = objects(source.clarifications);
  const acceptance = tasks.reduce((n,t)=>n+(Array.isArray(t.acceptanceCriteria)?t.acceptanceCriteria.length:0),0);
  const conflicts=[];
  for(let i=0;i<tasks.length;i++) for(let j=i+1;j<tasks.length;j++) if(overlaps(tasks[i].writeScope||[],tasks[j].writeScope||[])) conflicts.push([tasks[i].id,tasks[j].id]);
  const interfaces=deriveTaskInterfaces(source);
  const unresolvedTaskInputs=interfaces.flatMap(item=>item.inputs.filter(input=>!input.resolved).map(input=>({taskId:item.taskId,fromTaskId:input.fromTaskId,outputName:input.outputName,error:input.error})));
  const planQuality=evaluatePlanQuality(source);
  const qualityDiagnostics={
    requirementsWithoutAcceptanceCriteria:requirements.filter(x=>!hasItems(x.acceptanceCriteria)).map((x,i)=>label(x,i,'requirement')),
    tasksWithoutDescription:tasks.filter(x=>!hasText(x.description)).map((x,i)=>label(x,i,'task')),
    tasksWithoutAcceptanceCriteria:tasks.filter(x=>!hasItems(x.acceptanceCriteria)).map((x,i)=>label(x,i,'task')),
    tasksWithoutWriteScope:tasks.filter(x=>!hasItems(x.writeScope)).map((x,i)=>label(x,i,'task')),
    componentsWithoutResponsibilities:components.filter(x=>!hasItems(x.responsibilities)).map((x,i)=>label(x,i,'component')),
    decisionsWithoutAlternatives:decisions.filter(x=>!hasItems(x.alternatives)).map((x,i)=>label(x,i,'decision')),
    risksWithoutMitigation:risks.filter(x=>!hasText(x.mitigation)).map((x,i)=>label(x,i,'risk')),
    clarificationsWithoutQuestion:clarifications.filter(x=>!hasText(x.question)).map((x,i)=>label(x,i,'clarification')),
    unresolvedBlockingClarifications:clarifications.filter(x=>x.blocking===true&&x.resolved!==true).map((x,i)=>label(x,i,'clarification')),
    nfrWithoutMeasurement:planQuality.nfr.unmeasuredRequirementIds,
    testStrategyMissingFields:planQuality.testStrategy.missingFields,
    rollbackPlanMissingFields:planQuality.rollback.missingFields,
    unknownsNotReviewed:!planQuality.unknowns.reviewed,
    unknownsWithoutResolution:planQuality.unknowns.count-planQuality.unknowns.withResolutionCount,
    risksWithoutEstimates:risks.filter(x=>!planQuality.risks.exposure.some(y=>y.id===(x.id||x.description))).map((x,i)=>label(x,i,'risk')),
    risksWithoutConfidenceOrBasis:risks.filter(x=>!['low','medium','high'].includes(x.confidence)||!hasText(x.assessmentBasis)).map((x,i)=>label(x,i,'risk')),
    assumptionsWithoutValidation:objects(source.assumptions).filter(x=>!hasText(x.statement||x.description)||!hasText(x.validationApproach)||!['low','medium','high'].includes(x.confidence)).map((x,i)=>label(x,i,'assumption'))
  };
  const errors=validation.errors.join('\n');
  return { validation, metrics:{ requirementCoverage:validation.requirementCoverage, acceptanceCriteriaCount:acceptance, dependencyValidity:!(/dependenc|graph|cycle/i.test(errors)), repositorySafety:!(/unsafe|destructive/i.test(errors)), writeScopeOverlapPairs:conflicts, unresolvedTaskInputs, planQuality }, planQuality, qualityDiagnostics };
}
