import { validatePlan } from './validator.mjs';
import { overlaps } from './graph.mjs';
import { deriveTaskInterfaces } from './task-interface.mjs';

const objects = value => Array.isArray(value)
  ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
  : [];
const label = (item, index, prefix) => item.id || item.name || item.title || prefix + '-' + (index + 1);
const hasItems = value => Array.isArray(value) && value.some(item => typeof item === 'string' ? item.trim() : item && typeof item === 'object');

export function evaluatePlan(plan, project = {}) {
  const validation = validatePlan(plan, project);
  const tasks = objects(plan?.tasks);
  const requirements = objects(plan?.requirements);
  const components = objects(plan?.architecture?.components);
  const decisions = objects(plan?.architecture?.decisions);
  const risks = objects(plan?.risks);
  const clarifications = objects(plan?.clarifications);
  const acceptance = tasks.reduce((count, task) =>
    count + (Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.length : 0), 0);
  const conflicts = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      if (overlaps(tasks[i].writeScope || [], tasks[j].writeScope || [])) conflicts.push([tasks[i].id, tasks[j].id]);
    }
  }
  const interfaces = deriveTaskInterfaces(plan);
  const unresolvedTaskInputs = interfaces.flatMap(item =>
    item.inputs.filter(input => !input.resolved).map(input => ({
      taskId: item.taskId,
      fromTaskId: input.fromTaskId,
      outputName: input.outputName,
      error: input.error
    }))
  );
  const qualityDiagnostics = {
    requirementsWithoutAcceptanceCriteria: requirements
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !hasItems(item.acceptanceCriteria))
      .map(({ item, index }) => label(item, index, 'requirement')),
    tasksWithoutDescription: tasks
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => typeof item.description !== 'string' || !item.description.trim())
      .map(({ item, index }) => label(item, index, 'task')),
    tasksWithoutAcceptanceCriteria: tasks
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !hasItems(item.acceptanceCriteria))
      .map(({ item, index }) => label(item, index, 'task')),
    tasksWithoutWriteScope: tasks
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !hasItems(item.writeScope))
      .map(({ item, index }) => label(item, index, 'task')),
    componentsWithoutResponsibilities: components
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !hasItems(item.responsibilities))
      .map(({ item, index }) => label(item, index, 'component')),
    decisionsWithoutAlternatives: decisions
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !hasItems(item.alternatives))
      .map(({ item, index }) => label(item, index, 'decision')),
    risksWithoutMitigation: risks
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => typeof item.mitigation !== 'string' || !item.mitigation.trim())
      .map(({ item, index }) => label(item, index, 'risk')),
    clarificationsWithoutQuestion: clarifications
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => typeof item.question !== 'string' || !item.question.trim())
      .map(({ item, index }) => label(item, index, 'clarification')),
    unresolvedBlockingClarifications: clarifications
      .filter(item => item.blocking === true && item.resolved !== true)
      .map((item, index) => label(item, index, 'clarification'))
  };
  const errors = validation.errors.join('\n');
  return {
    validation,
    metrics: {
      requirementCoverage: validation.requirementCoverage,
      acceptanceCriteriaCount: acceptance,
      dependencyValidity: !(/dependenc|graph|cycle/i.test(errors)),
      repositorySafety: !(/unsafe|destructive/i.test(errors)),
      writeScopeOverlapPairs: conflicts,
      unresolvedTaskInputs
    },
    qualityDiagnostics
  };
}
