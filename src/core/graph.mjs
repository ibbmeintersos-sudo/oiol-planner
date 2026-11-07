export function dependencyEdgesFromTasks(tasks = []) {
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap(task =>
    Array.isArray(task?.dependencies)
      ? task.dependencies.map(from => ({ from, to: task.id, type: 'finish_to_start' }))
      : []
  );
}

export function canonicalEdgeKey(edge) {
  return String(edge?.from) + '->' + String(edge?.to) + ':' + (edge?.type || 'finish_to_start');
}

export function overlaps(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.some(x => typeof x === 'string' && b.some(y =>
    typeof y === 'string' && (x === y || x.startsWith(y + '/') || y.startsWith(x + '/'))
  ));
}

export function topologicalWaves(tasks, edges = []) {
  if (!Array.isArray(tasks)) return { waves: [], cycle: false, remaining: [], error: 'invalid_tasks' };
  if (!Array.isArray(edges)) return { waves: [], cycle: false, remaining: [], error: 'invalid_edges' };
  if (tasks.some(task => !task || typeof task !== 'object' || Array.isArray(task) || typeof task.id !== 'string' || !task.id.trim())) {
    return { waves: [], cycle: false, remaining: [], error: 'invalid_task_id' };
  }
  if (edges.some(edge => !edge || typeof edge !== 'object' || Array.isArray(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string')) {
    return { waves: [], cycle: false, remaining: [], error: 'invalid_edge' };
  }
  const ids = tasks.map(task => task.id);
  if (new Set(ids).size !== ids.length) return { waves: [], cycle: false, remaining: [], error: 'duplicate_task_ids' };
  const known = new Set(ids), deps = new Map(ids.map(id => [id, new Set()]));
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) return { waves: [], cycle: false, remaining: [], error: 'unknown_task_reference' };
    if (edge.from === edge.to) return { waves: [], cycle: true, remaining: [edge.from] };
    deps.get(edge.to).add(edge.from);
  }
  const byId = new Map(tasks.map(task => [task.id, task]));
  const remaining = new Set(ids), waves = [];
  while (remaining.size) {
    const ready = [...remaining].filter(id => [...deps.get(id)].every(dependency => !remaining.has(dependency)));
    if (!ready.length) return { waves, cycle: true, remaining: [...remaining] };
    const wave = [];
    for (const candidate of ready) {
      const scope = Array.isArray(byId.get(candidate)?.writeScope) ? byId.get(candidate).writeScope : [];
      if (!wave.some(id => overlaps(scope, Array.isArray(byId.get(id)?.writeScope) ? byId.get(id).writeScope : []))) wave.push(candidate);
    }
    if (!wave.length) return { waves, cycle: false, remaining: [...remaining], error: 'scheduler_no_progress' };
    waves.push(wave);
    for (const item of wave) remaining.delete(item);
  }
  return { waves, cycle: false, remaining: [] };
}
