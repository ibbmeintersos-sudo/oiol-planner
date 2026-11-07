/**
 * Build planning traceability only.
 * This module deliberately does not accept execution state or claim that
 * planned work has been implemented or verified.
 */
export function buildTraceability(plan = {}) {
  const requirements = Array.isArray(plan.requirements) ? plan.requirements : [];
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const rows = requirements.map(requirement => {
    const linkedTasks = tasks.filter(task =>
      Array.isArray(task.requirementIds) && task.requirementIds.includes(requirement.id)
    );
    const acceptanceCriteria = linkedTasks.flatMap(task =>
      (Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : []).map(criteria => ({
        taskId: task.id,
        statement: criteria
      }))
    );
    return {
      requirementId: requirement.id,
      statement: requirement.statement || '',
      taskIds: linkedTasks.map(task => task.id),
      acceptanceCriteria,
      status: linkedTasks.length ? 'mapped' : 'unmapped'
    };
  });
  const mapped = rows.filter(row => row.taskIds.length > 0).length;
  return {
    rows,
    mappingCoverage: rows.length ? mapped / rows.length : 1,
    unmappedRequirementIds: rows.filter(row => row.status === 'unmapped').map(row => row.requirementId)
  };
}
