import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const validPlan = {
  schemaVersion: '1.0.0',
  contractVersion: '1.0',
  id: 'plan_cli_test',
  status: 'needs_revision',
  project: { kind: 'greenfield', name: 'CLI fixture', request: 'Plan a sample endpoint' },
  requirements: [{ id: 'r1', statement: 'Provide endpoint' }],
  architecture: { components: [{ id: 'c1', name: 'API' }], decisions: [] },
  tasks: [{ id: 't1', title: 'Define endpoint contract', requirementIds: ['r1'], componentIds: ['c1'], dependencies: [], acceptanceCriteria: ['Contract defines response'], writeScope: ['docs/api'] }],
  dependencyGraph: { nodes: ['t1'], edges: [] },
  risks: [],
  clarifications: []
};

test('CLI validates an existing plan without provider credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-cli-'));
  try {
    const file = path.join(root, 'plan.json');
    await writeFile(file, JSON.stringify(validPlan));
    const result = spawnSync(process.execPath, [cli, '--validate', file], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).validation.valid, true);
    assert.ok(JSON.parse(result.stdout).evaluation.qualityDiagnostics);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('CLI renders Markdown from an existing plan without provider credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-cli-md-'));
  try {
    const file = path.join(root, 'plan.json');
    await writeFile(file, JSON.stringify(validPlan));
    const result = spawnSync(process.execPath, [cli, '--validate', file, '--format', 'md'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# Engineering Plan/);
    assert.match(result.stdout, /Define endpoint contract/);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('CLI returns a validation failure for an invalid plan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-cli-invalid-'));
  try {
    const file = path.join(root, 'plan.json');
    const invalid = structuredClone(validPlan);
    invalid.tasks[0].acceptanceCriteria = [];
    await writeFile(file, JSON.stringify(invalid));
    const result = spawnSync(process.execPath, [cli, '--validate', file], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).validation.valid, false);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('CLI rejects a plan that violates the published schema even when semantic checks pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-cli-schema-'));
  try {
    const file = path.join(root, 'plan.json');
    const invalid = structuredClone(validPlan);
    delete invalid.status;
    await writeFile(file, JSON.stringify(invalid));
    const result = spawnSync(process.execPath, [cli, '--validate', file], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 2);
    const output = JSON.parse(result.stdout);
    assert.equal(output.validation.schemaValidation.valid, false);
    assert.equal(output.status, 'blocked');
    assert.ok(output.validation.errors.some(error => error.includes('status')));
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('CLI returns a structured validation failure for a null JSON document', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-cli-null-'));
  try {
    const file = path.join(root, 'plan.json');
    await writeFile(file, 'null');
    const result = spawnSync(process.execPath, [cli, '--validate', file], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 2);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, 'blocked');
    assert.equal(output.validation.valid, false);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});


test('CLI exports a GitHub Issues preview without credentials or network calls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-cli-github-preview-'));
  try {
    const file = path.join(root, 'plan.json');
    await writeFile(file, JSON.stringify(validPlan));
    const result = spawnSync(process.execPath, [cli, '--export', 'github-issues', '--input', file, '--owner', 'example-owner', '--repo', 'example-repo'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.adapter, 'github-issues');
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.issues.length, 1);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('CLI exports a Linear preview without credentials or network calls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-cli-linear-preview-'));
  try {
    const file = path.join(root, 'plan.json');
    await writeFile(file, JSON.stringify(validPlan));
    const result = spawnSync(process.execPath, [cli, '--export', 'linear', '--input', file, '--team-id', 'team-uuid'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.adapter, 'linear');
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.issues[0].payload.teamId, 'team-uuid');
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('CLI publishing is explicit and fails closed without external credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-cli-publish-optin-'));
  try {
    const file = path.join(root, 'plan.json');
    await writeFile(file, JSON.stringify(validPlan));
    const result = spawnSync(process.execPath, [cli, '--export', 'github-issues', '--input', file, '--owner', 'example-owner', '--repo', 'example-repo', '--publish'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GitHub token is required/);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
