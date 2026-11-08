import { topologicalWaves } from './graph.mjs';
import { deriveTaskInterfaces } from './task-interface.mjs';
import { buildTraceability } from './traceability.mjs';

const text = value => String(value && typeof value === 'object' ? (value.statement || value.description || value.question || JSON.stringify(value)) : value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
const list = values => Array.isArray(values) && values.length ? values.map(value => '- ' + text(value)).join('\n') : '- None recorded';

function testImpactSection(analysis) {
  if (!analysis || typeof analysis !== 'object') return [];
  const inventory = analysis.inventory || {};
  const tests = Array.isArray(analysis.selectedTests) ? analysis.selectedTests : [];
  const levels = Array.isArray(analysis.recommendedTestLevels) ? analysis.recommendedTestLevels : [];
  const gates = Array.isArray(analysis.verificationGates) ? analysis.verificationGates : [];
  return [
    '### Test impact and verification plan (not executed)',
    '',
    '- **Analysis status:** ' + text(analysis.status || 'Not recorded'),
    '- **Confidence:** ' + text(analysis.confidence || 'Not recorded'),
    '- **Discovered test files:** ' + (inventory.discoveredTestFileCount ?? 'Not recorded'),
    '- **Linked test candidates:** ' + (inventory.linkedTestFileCount ?? tests.length),
    '- **Requirement acceptance-criteria coverage:** ' + text(analysis.coverageAssessment?.requirementAcceptanceCriteria || 'Not assessed'),
    '- **Code coverage:** ' + text(analysis.coverageAssessment?.codeCoverage || 'Not available'),
    ...(tests.length ? tests.map(item => '- **' + text(item.path) + '** — ' + text(item.association) + '; confidence: ' + text(item.confidence) + '; execution: NOT EXECUTED') : ['- No existing test file was linked to the current impact evidence.']),
    '',
    '#### Recommended test levels',
    '',
    ...(levels.length ? levels.map(item => '- **' + text(item.level) + '** — ' + text((item.rationale || []).join(' ')) + (item.evidence?.length ? '; evidence candidates: ' + text(item.evidence.join(', ')) : '')) : ['- No test level recommendation recorded.']),
    '',
    '#### Verification prerequisites',
    '',
    list(analysis.prerequisites),
    '',
    '#### Verification gates (proposed)',
    '',
    ...(gates.length ? gates.map(item => '- **' + text(item.id) + '** — ' + text(item.description) + '; status: ' + text(item.status) + (item.evidenceStatus ? '; evidence: ' + text(item.evidenceStatus) : '')) : ['- No verification gates recorded.']),
    '',
    '#### Verification gaps',
    '',
    list(analysis.gaps),
    '',
    ...(Array.isArray(analysis.limitations) ? analysis.limitations.map(item => '- Caveat: ' + text(item)) : []),
    '',
    '*These are recommendations for a separate implementation/verification workflow. OIOL does not execute tests, builds, scripts, migrations, or target-project commands, and does not claim checks have passed.*',
    ''
  ];
}

function changeImpactSection(impact) {
  if (!impact || typeof impact !== 'object' || impact.status === 'not_applicable') return [];
  const direct = Array.isArray(impact.directMatches) ? impact.directMatches : [];
  const files = Array.isArray(impact.potentiallyAffectedFiles) ? impact.potentiallyAffectedFiles : [];
  const tests = Array.isArray(impact.affectedTests) ? impact.affectedTests : [];
  const packages = Array.isArray(impact.affectedPackages) ? impact.affectedPackages : [];
  const confidence = impact.confidence || {};
  return [
    '## Existing-repository change-impact estimate',
    '',
    text(impact.summary || 'No change-impact summary recorded.'),
    '',
    '- **Analysis status:** ' + text(impact.status || 'Not recorded'),
    '- **Estimated scope:** ' + text(impact.scope || 'Not classified'),
    '- **Confidence:** ' + text(confidence.level || 'Not recorded') + ' (' + (Number.isFinite(confidence.score) ? (confidence.score * 100).toFixed(1) + '%' : 'not scored') + ')',
    '- **Method:** ' + text(impact.method || 'Not recorded'),
    '- **Request-term coverage:** ' + (Number.isFinite(impact.matchingDiagnostics?.matchedRequestTermCount) ? impact.matchingDiagnostics.matchedRequestTermCount + '/' + (impact.matchingDiagnostics.requestTermCount || 0) : 'Not recorded'),
    '- **Direct-match candidates before cap:** ' + (Number.isFinite(impact.matchingDiagnostics?.directMatchCountBeforeLimit) ? impact.matchingDiagnostics.directMatchCountBeforeLimit : 'Not recorded'),
    '- **Unmatched request terms:** ' + text((impact.matchingDiagnostics?.unmatchedRequestTerms || []).join(', ') || 'None recorded'),
    '- **Depth limit reached:** ' + (impact.graph?.traversalLimits?.depthLimitReached === true ? 'Yes' : impact.graph?.traversalLimits?.depthLimitReached === false ? 'No' : 'Not recorded'),
    '- **Unseen file dependents beyond depth cap:** ' + (Number.isFinite(impact.graph?.traversalLimits?.fileDepthFrontierCount) ? impact.graph.traversalLimits.fileDepthFrontierCount : 'Not recorded'),
    '- **Unseen package consumers beyond depth cap:** ' + (Number.isFinite(impact.graph?.traversalLimits?.packageDepthFrontierCount) ? impact.graph.traversalLimits.packageDepthFrontierCount : 'Not recorded'),
    '- **Node/output cap reached:** ' + (impact.graph?.traversalLimits ? (impact.graph.traversalLimits.nodeLimitReached || impact.graph.traversalLimits.affectedFilesOutputLimitReached || impact.graph.traversalLimits.affectedPackagesOutputLimitReached ? 'Yes' : 'No') : 'Not recorded'),
    '',
    '### API and contract impact (static estimate)',
    '',
    '- **Contract analysis status:** ' + text(impact.apiContractImpact?.status || 'Not requested'),
    '- **Exported contract symbols matched:** ' + (Number.isFinite(impact.apiContractImpact?.diagnostics?.matchedContractSymbolCount) ? impact.apiContractImpact.diagnostics.matchedContractSymbolCount : 'Not recorded'),
    '- **Export-metadata files:** ' + (Number.isFinite(impact.apiContractImpact?.diagnostics?.exportMetadataFileCount) ? impact.apiContractImpact.diagnostics.exportMetadataFileCount : 'Not recorded'),
    '- **Consumer graph depth limit reached:** ' + (impact.apiContractImpact?.diagnostics?.depthLimitReached === true ? 'Yes' : impact.apiContractImpact?.diagnostics?.depthLimitReached === false ? 'No' : 'Not recorded'),
    '- **Unseen consumer frontier:** ' + (Number.isFinite(impact.apiContractImpact?.diagnostics?.depthFrontierCount) ? impact.apiContractImpact.diagnostics.depthFrontierCount : 'Not recorded'),
    '- **Consumer graph node/result cap reached:** ' + (impact.apiContractImpact?.diagnostics ? (impact.apiContractImpact.diagnostics.nodeLimitReached || impact.apiContractImpact.diagnostics.consumerResultLimitReached ? 'Yes' : 'No') : 'Not recorded'),
    ...(Array.isArray(impact.apiContractImpact?.contractSymbols) && impact.apiContractImpact.contractSymbols.length
      ? impact.apiContractImpact.contractSymbols.map(item => '- **' + text(item.name) + '** (' + text(item.kind) + ') — ' + text(item.file) + (item.line ? ':' + text(item.line) : '') + '; matched: ' + text((item.matchedTerms || []).join(', ')) + (item.evidenceId ? '; evidence: ' + text(item.evidenceId) : ''))
      : ['- No AST-backed exported contract symbol was matched.']),
    ...(Array.isArray(impact.apiContractImpact?.potentiallyAffectedConsumers) && impact.apiContractImpact.potentiallyAffectedConsumers.length
      ? impact.apiContractImpact.potentiallyAffectedConsumers.map(item => '- **' + text(item.path) + '** — imports candidate contract file ' + text(item.contractFile) + '; depth ' + text(item.depth) + '; confidence: ' + text(item.confidence) + ' (file-level only)')
      : ['- No consumer file could be linked to a matched contract candidate.']),
    ...(Array.isArray(impact.apiContractImpact?.limitations) ? impact.apiContractImpact.limitations.map(item => '- Caveat: ' + text(item)) : []),
    '',
    '### Database schema impact (static estimate)',
    '',
    '- **Schema analysis status:** ' + text(impact.databaseSchemaImpact?.status || 'Not requested'),
    '- **Schema objects matched:** ' + (Number.isFinite(impact.databaseSchemaImpact?.diagnostics?.matchedTableCount) ? impact.databaseSchemaImpact.diagnostics.matchedTableCount : 'Not recorded'),
    '- **DDL changes matched:** ' + (Number.isFinite(impact.databaseSchemaImpact?.diagnostics?.matchedChangeCount) ? impact.databaseSchemaImpact.diagnostics.matchedChangeCount : 'Not recorded'),
    '- **Potential consumers:** ' + (Number.isFinite(impact.databaseSchemaImpact?.diagnostics?.consumerCandidateCount) ? impact.databaseSchemaImpact.diagnostics.consumerCandidateCount : 'Not recorded'),
    '- **Migration files detected:** ' + (Number.isFinite(impact.databaseSchemaImpact?.diagnostics?.migrationFileCount) ? impact.databaseSchemaImpact.diagnostics.migrationFileCount : 'Not recorded'),
    '- **Result limits reached:** ' + (impact.databaseSchemaImpact?.diagnostics ? (impact.databaseSchemaImpact.diagnostics.tableResultLimitReached || impact.databaseSchemaImpact.diagnostics.changeResultLimitReached || impact.databaseSchemaImpact.diagnostics.consumerResultLimitReached ? 'Yes' : 'No') : 'Not recorded'),
    ...(Array.isArray(impact.databaseSchemaImpact?.matchedTables) && impact.databaseSchemaImpact.matchedTables.length
      ? impact.databaseSchemaImpact.matchedTables.map(item => '- **Table: ' + text(item.table) + '** — ' + text(item.path) + (item.line ? ':' + text(item.line) : '') + '; matched: ' + text((item.matchedTerms || []).join(', ')) + (item.evidenceId ? '; evidence: ' + text(item.evidenceId) : ''))
      : ['- No schema object matched the request terms.']),
    ...(Array.isArray(impact.databaseSchemaImpact?.schemaChanges) && impact.databaseSchemaImpact.schemaChanges.length
      ? impact.databaseSchemaImpact.schemaChanges.map(item => '- **' + text(item.severity) + ' — ' + text(item.operation) + '** on ' + text(item.table || 'unknown table') + (item.column ? '.' + text(item.column) : '') + ' — ' + text(item.path) + (item.line ? ':' + text(item.line) : '') + '; risks: ' + text((item.riskSignals || []).join(', ')))
      : ['- No matching DDL change was identified.']),
    ...(Array.isArray(impact.databaseSchemaImpact?.potentiallyAffectedConsumers) && impact.databaseSchemaImpact.potentiallyAffectedConsumers.length
      ? impact.databaseSchemaImpact.potentiallyAffectedConsumers.map(item => '- **' + text(item.path) + '** — textual reference to table ' + text(item.table) + '; confidence: ' + text(item.confidence) + '; proof: ' + text(item.proofLevel))
      : ['- No consumer file could be linked to a matched schema object.']),
    ...(Array.isArray(impact.databaseSchemaImpact?.riskSignals) ? impact.databaseSchemaImpact.riskSignals.map(item => '- Risk signal: ' + text(item)) : []),
    ...(Array.isArray(impact.databaseSchemaImpact?.limitations) ? impact.databaseSchemaImpact.limitations.map(item => '- Caveat: ' + text(item)) : []),
    '',
    '#### Migration ordering and rollout compatibility (static estimate)',
    '- **Sequencing status:** ' + text(impact.databaseSchemaImpact?.migrationCompatibility?.status || 'Not available'),
    '- **Ordered migration candidates:** ' + (impact.databaseSchemaImpact?.migrationCompatibility?.diagnostics?.orderedMigrationCount ?? 'Not recorded'),
    '- **Unordered/ambiguous migrations:** ' + (impact.databaseSchemaImpact?.migrationCompatibility?.diagnostics?.unorderedMigrationCount ?? 'Not recorded'),
    '- **Potential expand/contract pairs:** ' + (impact.databaseSchemaImpact?.migrationCompatibility?.diagnostics?.expandContractPairCount ?? 0),
    ...(Array.isArray(impact.databaseSchemaImpact?.migrationCompatibility?.orderedMigrations)
      ? impact.databaseSchemaImpact.migrationCompatibility.orderedMigrations.map(item => '- **' + text(item.phase) + '** — ' + text(item.path) + '; order key: ' + text(item.orderKey || 'unknown') + '; operations: ' + text((item.operations || []).map(op => op.operation + (op.table ? ' ' + op.table : '') + (op.column ? '.' + op.column : '')).join(', ')))
      : []),
    ...(Array.isArray(impact.databaseSchemaImpact?.migrationCompatibility?.sequenceRisks)
      ? impact.databaseSchemaImpact.migrationCompatibility.sequenceRisks.map(item => '- **Sequence risk: ' + text(item.kind) + '** — ' + text(item.message))
      : []),
    ...(Array.isArray(impact.databaseSchemaImpact?.migrationCompatibility?.possibleExpandContractPairs)
      ? impact.databaseSchemaImpact.migrationCompatibility.possibleExpandContractPairs.map(item => '- **Possible expand/contract:** ' + text(item.table) + ' — add ' + text(item.addedColumn) + ' in ' + text(item.earlierMigration) + ', remove ' + text(item.removedColumn) + ' in ' + text(item.laterMigration) + '; backfill/compatibility not proven.')
      : []),
    ...(Array.isArray(impact.databaseSchemaImpact?.migrationCompatibility?.compatibilityFindings)
      ? impact.databaseSchemaImpact.migrationCompatibility.compatibilityFindings.map(item => '- **Compatibility: ' + text(item.operation) + ' ' + text(item.table || '') + '** — old app/new schema: ' + text(item.compatibility?.oldApplicationWithNewSchema) + '; new app/old schema: ' + text(item.compatibility?.newApplicationWithOldSchema) + '; guidance: ' + text(item.compatibility?.rolloutGuidance))
      : []),
    ...(Array.isArray(impact.databaseSchemaImpact?.migrationCompatibility?.rolloutSequence)
      ? impact.databaseSchemaImpact.migrationCompatibility.rolloutSequence.map(item => '- **' + text(item.stage) + '** — ' + text(item.purpose) + ' Gates: ' + text((item.gates || []).join(' ')))
      : []),
    ...(Array.isArray(impact.databaseSchemaImpact?.migrationCompatibility?.limitations)
      ? impact.databaseSchemaImpact.migrationCompatibility.limitations.map(item => '- Migration caveat: ' + text(item))
      : []),
    '',
    ...testImpactSection(impact.testImpactAnalysis),
    '### Direct candidate files',
    '',
    ...(direct.length ? direct.slice(0, 30).map(item => '- **' + text(item.path) + '** — score ' + text(item.score) + '; matched: ' + text((item.matchedTerms || []).join(', ')) + (item.evidenceId ? '; evidence: ' + text(item.evidenceId) : '')) : ['- No direct candidate file was identified.']),
    '',
    '### Potentially affected files',
    '',
    ...(files.length ? files.slice(0, 100).map(item => '- **' + text(item.path) + '** — depth ' + text(item.depth) + '; ' + text(item.propagation || 'relationship not recorded') + (item.dependsOn ? '; depends on: ' + text(item.dependsOn) : '')) : ['- No dependent source files were identified.']),
    '',
    '### Potentially affected tests (not executed)',
    '',
    ...(tests.length ? tests.map(item => '- **' + text(item.path) + '** — ' + text(item.association) + '; confidence: ' + text(item.confidence)) : ['- No test file could be linked to the available impact evidence.']),
    '',
    '### Affected workspace packages',
    '',
    ...(packages.length ? packages.map(item => '- **' + text(item.name || item.path) + '** — ' + text(item.propagation) + '; depth ' + text(item.depth)) : ['- No workspace package impact was identified.']),
    '',
    '### Impact-analysis caveats',
    '',
    list([...(Array.isArray(impact.risks) ? impact.risks : []), ...(Array.isArray(impact.limitations) ? impact.limitations : [])]),
    '',
    '*This is a bounded static planning estimate. It does not prove runtime impact, and OIOL does not run or verify any test, build, script, or implementation task.*',
    ''
  ];
}

export function renderPlanMarkdown(plan = {}) {
  plan = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : {};
  const validation = plan.validation || {};
  const evaluation = plan.evaluation?.metrics || {};
  const quality = plan.evaluation?.qualityDiagnostics || {};
  const planQuality = plan.evaluation?.planQuality || plan.evaluation?.metrics?.planQuality || {};
  const testStrategy = plan.testStrategy && typeof plan.testStrategy === 'object' ? plan.testStrategy : {};
  const rollbackPlan = plan.rollbackPlan && typeof plan.rollbackPlan === 'object' ? plan.rollbackPlan : {};
  const signal = value => Array.isArray(value) && value.length ? value.map(text).join(', ') : 'None recorded';
  const tasks = Array.isArray(plan.tasks) ? plan.tasks.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const graph = plan.dependencyGraph || { nodes: [], edges: [] };
  const schedule = topologicalWaves(tasks, Array.isArray(graph.edges) ? graph.edges : []);
  const risks = Array.isArray(plan.risks) ? plan.risks.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const clarifications = Array.isArray(plan.clarifications) ? plan.clarifications.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const requirements = Array.isArray(plan.requirements) ? plan.requirements.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const traceability = (Array.isArray(plan.traceability?.rows) ? plan.traceability.rows : buildTraceability(plan).rows).filter(item => item && typeof item === 'object' && !Array.isArray(item));
  const taskInterfaces = Array.isArray(plan.taskInterfaces) ? plan.taskInterfaces.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : deriveTaskInterfaces(plan);
  const assumptions = Array.isArray(plan.assumptions) ? plan.assumptions : [];
  const unknowns = Array.isArray(plan.unknowns) ? plan.unknowns : [];
  const lines = [
    '# Engineering Plan', '',
    '- **Plan:** ' + text(plan.id || 'unspecified'),
    '- **Project:** ' + text(plan.project?.name || plan.project?.kind || 'Unspecified'),
    '- **Status:** ' + text(plan.status || 'unspecified'),
    '- **Schema:** ' + text(plan.schemaVersion || 'legacy / unspecified'),
    '- **Created:** ' + text(plan.metadata?.createdAt || 'unspecified'), '',
    '## Executive summary', '',
    text(plan.summary || plan.project?.request || 'No executive summary was supplied.'), '',
    '## Planning quality checks', '',
    '- **Deterministic validation:** ' + (validation.valid === true ? 'Valid' : validation.valid === false ? 'Invalid' : 'Not recorded'),
    '- **Requirement coverage:** ' + (Number.isFinite(evaluation.requirementCoverage) ? (evaluation.requirementCoverage * 100).toFixed(1) + '%' : Number.isFinite(validation.requirementCoverage) ? (validation.requirementCoverage * 100).toFixed(1) + '%' : 'Not recorded'),
    '- **Acceptance criteria:** ' + (Number.isFinite(evaluation.acceptanceCriteriaCount) ? evaluation.acceptanceCriteriaCount : tasks.reduce((n, task) => n + (task.acceptanceCriteria?.length || 0), 0)),
    '- **Dependency graph:** ' + (schedule.cycle ? 'Cycle detected' : schedule.error ? 'Invalid graph' : 'Acyclic'), '',
    '## Plan quality evidence', '',
    '- **Measurable NFRs:** ' + (planQuality.nfr ? planQuality.nfr.measurableCount + '/' + planQuality.nfr.requirementCount + ' (' + (planQuality.nfr.measurableRate * 100).toFixed(1) + '%)' : 'Not evaluated'),
    '- **Test strategy completeness:** ' + (planQuality.testStrategy ? planQuality.testStrategy.completedFields + '/' + planQuality.testStrategy.totalFields + ' fields' : 'Not evaluated'),
    '- **Rollback plan:** ' + (planQuality.rollback ? planQuality.rollback.applicability + ' (' + (planQuality.rollback.completeness * 100).toFixed(1) + '% complete)' : 'Not evaluated'),
    '- **Unknowns reviewed:** ' + (planQuality.unknowns ? (planQuality.unknowns.reviewed ? 'Yes' : 'No') + '; ' + planQuality.unknowns.count + ' recorded; ' + planQuality.unknowns.withResolutionCount + ' with resolution approach' : 'Not evaluated'),
    '- **Assumptions with validation approach:** ' + (planQuality.assumptions ? planQuality.assumptions.validatedCount + '/' + planQuality.assumptions.count : 'Not evaluated'),
    '- **Risk estimates / confidence / assessment basis:** ' + (planQuality.risks ? planQuality.risks.estimatedCount + '/' + planQuality.risks.count + ' / ' + planQuality.risks.confidenceRatedCount + '/' + planQuality.risks.count + ' / ' + planQuality.risks.assessmentBasisCount + '/' + planQuality.risks.count : 'Not evaluated'),
    '- **Mean estimated risk exposure:** ' + (Number.isFinite(planQuality.risks?.meanExposure) ? planQuality.risks.meanExposure : 'Not recorded'),
    '- **High/critical estimated risks:** ' + (planQuality.risks?.highOrCriticalCount ?? 'Not recorded'), '',
    '*These metrics measure the completeness of planning evidence; they do not prove that implementation or verification has occurred.*', '',
    ...changeImpactSection(plan.project?.changeImpact),
    '',
    '## Non-blocking quality review signals',
    '',
    '- **Requirements without requirement-level acceptance criteria:** ' + signal(quality.requirementsWithoutAcceptanceCriteria),
    '- **Tasks without descriptions:** ' + signal(quality.tasksWithoutDescription),
    '- **Tasks without acceptance criteria:** ' + signal(quality.tasksWithoutAcceptanceCriteria),
    '- **Tasks without a declared write scope:** ' + signal(quality.tasksWithoutWriteScope),
    '- **Components without responsibilities:** ' + signal(quality.componentsWithoutResponsibilities),
    '- **Architecture decisions without alternatives:** ' + signal(quality.decisionsWithoutAlternatives),
    '- **Risks without mitigation:** ' + signal(quality.risksWithoutMitigation),
    '- **Clarifications without a question:** ' + signal(quality.clarificationsWithoutQuestion),
    '- **Unresolved blocking clarifications:** ' + signal(quality.unresolvedBlockingClarifications),
    '',
    '*These are review prompts, not automatic proof of a defective plan. Some may be intentional for the project context.*',
    '',
    '## Requirements',
    requirements.length ? requirements.map(req => '- **' + text(req.id) + '** — ' + text(req.statement) + (req.priority ? ' (priority: ' + text(req.priority) + ')' : '')).join('\n') : '- No requirements recorded.',
    '', '## Architecture', '',
    ...(Array.isArray(plan.architecture?.components) && plan.architecture.components.some(item => item && typeof item === 'object' && !Array.isArray(item))
      ? plan.architecture.components.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(component => '### ' + text(component.name || component.id) + '\n\n' + list(component.responsibilities))
      : ['No architecture components recorded.']),
    ...(Array.isArray(plan.architecture?.dataFlows) && plan.architecture.dataFlows.some(item => item && typeof item === 'object' && !Array.isArray(item))
      ? ['', '### Key data flows', '', ...plan.architecture.dataFlows.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(flow => '- **' + text(flow.from || flow.source) + ' → ' + text(flow.to || flow.target) + ':** ' + text(flow.description || flow.purpose))]
      : []),
    '', '### Architecture decisions', '',
    ...(Array.isArray(plan.architecture?.decisions) && plan.architecture.decisions.some(item => item && typeof item === 'object' && !Array.isArray(item))
      ? plan.architecture.decisions.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(decision => '- **' + text(decision.decision || decision.title) + '** — ' + text(decision.reason || decision.rationale))
      : ['- No explicit decisions recorded.']),
    '', '## Test strategy', '',
    '- **Approach:** ' + text(testStrategy.approach || 'Not recorded'),
    '- **Levels:** ' + text((Array.isArray(testStrategy.levels) ? testStrategy.levels : []).join(', ') || 'Not recorded'),
    '- **Coverage:** ' + text((Array.isArray(testStrategy.coverage) ? testStrategy.coverage : []).join(', ') || 'Not recorded'),
    '- **Entry criteria:**', list(testStrategy.entryCriteria),
    '- **Exit criteria:**', list(testStrategy.exitCriteria),
    '- **Test data:** ' + text(testStrategy.testData || 'Not recorded'),
    '', '## Rollback plan', '',
    '- **Applicability:** ' + text(rollbackPlan.applicability || 'Not recorded'),
    '- **Rationale:** ' + text(rollbackPlan.rationale || 'Not recorded'),
    '- **Strategy:** ' + text(rollbackPlan.strategy || 'Not recorded'),
    '- **Trigger conditions:**', list(rollbackPlan.triggerConditions),
    '- **Steps:**', list(rollbackPlan.steps),
    '- **Verification:**', list(rollbackPlan.verification),
    '- **Data compatibility:** ' + text(rollbackPlan.dataCompatibility || 'Not recorded'),
    '', '## Task breakdown', '',
    '| ID | Task | Dependencies | Requirements | Acceptance criteria | Write scope |',
    '|---|---|---|---|---|---|',
    ...(tasks.length ? tasks.map(task => '| ' + text(task.id) + ' | ' + text(task.title) + ' | ' + text((Array.isArray(task.dependencies) ? task.dependencies : []).join(', ') || '—') + ' | ' + text((Array.isArray(task.requirementIds) ? task.requirementIds : []).join(', ') || '—') + ' | ' + text((Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : []).join('; ') || 'Missing') + ' | ' + text((Array.isArray(task.writeScope) ? task.writeScope : []).join(', ') || 'Not specified') + ' |') : ['| — | No tasks | — | — | — | — |']),
    '', '## Task handoff interfaces', '',
    '| Task | Inputs from dependencies | Declared outputs | Consumers |',
    '|---|---|---|---|',
    ...(taskInterfaces.length ? taskInterfaces.map(item => '| ' + text(item.taskId) + ' | ' + text((Array.isArray(item.inputs) ? item.inputs : []).map(input => input.resolved ? input.fromTaskId + ': ' + (Array.isArray(input.outputs) ? input.outputs : []).map(output => output.name).join(', ') : 'MISSING OUTPUT from ' + input.fromTaskId).join('; ') || 'None') + ' | ' + text((Array.isArray(item.outputs) ? item.outputs : []).map(output => output.name).join(', ') || 'None declared') + ' | ' + text((Array.isArray(item.consumers) ? item.consumers : []).join(', ') || 'None') + ' |') : ['| — | No task interfaces | — | — |']),
    '', '## Suggested planning waves', '',
    ...(schedule.waves.length ? schedule.waves.map((wave, index) => '- **Wave ' + (index + 1) + ':** ' + wave.map(text).join(', ')) : ['- No waves could be derived from the supplied task graph.']),
    '', '## Risks', '',
    ...(risks.length ? risks.map(risk => '- **' + text(risk.severity || 'unspecified') + ' — ' + text(risk.id || 'risk') + ':** ' + text(risk.description) + '\n  - Likelihood × impact: ' + text(risk.likelihood ?? 'Not estimated') + ' × ' + text(risk.impact ?? 'Not estimated') + '\n  - Derived exposure: ' + text(Number.isInteger(risk.likelihood) && Number.isInteger(risk.impact) ? risk.likelihood * risk.impact : 'Not estimated') + '\n  - Mitigation: ' + text(risk.mitigation || 'Not specified')) : ['- No risks recorded.']),
    '', '## Assumptions', '',
    list(assumptions),
    '',
    '## Unknowns requiring investigation',
    '',
    list(unknowns),
    ...unknowns.filter(item => item && typeof item === 'object').map(item => '  - Impact: ' + text(item.impact || 'Not recorded') + '; resolution: ' + text(item.resolutionApproach || 'Not recorded') + '; blocking: ' + text(item.blocking ?? 'Not recorded')),
    '', '## Open questions and clarifications', '',
    ...(clarifications.length ? clarifications.map(item => '- **' + (item.blocking ? 'Blocking' : 'Non-blocking') + ':** ' + text(item.question || item.statement || item.id) + (item.resolved ? ' (resolved)' : '')) : ['- No open questions recorded.']),
    '', '## Requirement traceability', '',
    '| Requirement | Mapped tasks | Acceptance evidence in plan |',
    '|---|---|---|',
    ...(traceability.length ? traceability.map(row => '| ' + text(row.requirementId) + ' | ' + text((row.taskIds || []).join(', ') || 'Unmapped') + ' | ' + text((row.acceptanceCriteria || []).map(item => item.statement).join('; ') || 'Not specified') + ' |') : ['| — | Traceability not supplied | — |']),
    '', '## Validation findings', '', list(validation.errors),
    '', '## Validation warnings', '', list(validation.warnings),
    '', '---', '',
    '*This document describes intended engineering work. It is a planning artifact, not evidence that implementation, tests, or deployment have occurred.*', ''
  ];
  return lines.join('\n');
}
