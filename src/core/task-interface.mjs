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
    const inputs = (Array.isArray(task.inputs) ? task.inputs : []).map(input => {
      const producer = byId.get(input?.fromTaskId);
      const outputs = normalizedOutputs.get(input?.fromTaskId) || [];
      const matched = outputs.find(output => output.name === input?.outputName) || null;
      return {
        fromTaskId: input?.fromTaskId || null,
        outputName: input?.outputName || null,
        outputs: matched ? [matched] : [],
        resolved: Boolean(producer && matched),
        ...(!producer ? { error: 'unknown_producer_task' } : !matched ? { error: 'unknown_producer_output' } : {})
      };
    });
    return {
      taskId: task.id,
      title: task.title,
      inputs,
      outputs: normalizedOutputs.get(task.id) || [],
      acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [],
      consumers: tasks.filter(candidate =>
        Array.isArray(candidate.inputs) && candidate.inputs.some(input => input?.fromTaskId === task.id)
      ).map(candidate => candidate.id),
      dependents: tasks.filter(candidate =>
        Array.isArray(candidate.dependencies) && candidate.dependencies.includes(task.id)
      ).map(candidate => candidate.id)
    };
  });
}
