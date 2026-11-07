function normalizeOutput(output) {
  if (typeof output === 'string' && output.trim()) return { name: output.trim() };
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const name = typeof output.name === 'string' ? output.name.trim() : '';
    return name ? { ...output, name } : null;
  }
  return null;
}

export function deriveTaskInterfaces(plan = {}) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const byId = new Map(tasks.map(task => [task.id, task]));
  const normalizedOutputs = new Map(tasks.map(task => [
    task.id,
    (Array.isArray(task.outputs) ? task.outputs : []).map(normalizeOutput).filter(Boolean)
  ]));
  return tasks.map(task => {
    const inputs = (Array.isArray(task.dependencies) ? task.dependencies : []).map(dependencyId => {
      const producer = byId.get(dependencyId);
      const outputs = normalizedOutputs.get(dependencyId) || [];
      return {
        fromTaskId: dependencyId,
        outputs,
        resolved: outputs.length > 0,
        ...(producer ? {} : { error: 'unknown_dependency' })
      };
    });
    return {
      taskId: task.id,
      title: task.title,
      inputs,
      outputs: normalizedOutputs.get(task.id) || [],
      acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [],
      consumers: tasks.filter(candidate =>
        Array.isArray(candidate.dependencies) && candidate.dependencies.includes(task.id)
      ).map(candidate => candidate.id)
    };
  });
}
