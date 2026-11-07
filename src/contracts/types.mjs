export const CONTRACT_VERSION = '1.0';
export const SCHEMA_VERSION = '1.0.0';
export const PLAN_STATUSES = ['ready_for_review','needs_revision','blocked'];

export function emptyPlan(project) {
  return {
    schemaVersion: SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    id: 'plan_' + Date.now(),
    status: 'needs_revision',
    project,
    requirements: [],
    architecture: { components: [], decisions: [] },
    tasks: [],
    dependencyGraph: { nodes: [], edges: [] },
    risks: [],
    evidence: [],
    clarifications: [],
    review: null,
    metadata: { createdAt: new Date().toISOString() }
  };
}
