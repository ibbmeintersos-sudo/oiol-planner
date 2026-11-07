import { validatePlan } from './validator.mjs';
import { overlaps } from './graph.mjs';
import { deriveTaskInterfaces } from './task-interface.mjs';

export function evaluatePlan(plan, project = {}) {
  const validation = validatePlan(plan, project);
  const tasks = Array.isArray(plan?.tasks)
    ? plan.tasks.filter(task => task && typeof task === 'object' && !Array.isArray(task))
    : [];
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
    }
  };
}
