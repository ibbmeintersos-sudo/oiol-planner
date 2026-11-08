import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateJsonSchema } from '../src/core/schema-validator.mjs';
import { loadConfig, applyConfigToEnv, resolveProfile, getProfileConfig, validateConfig } from '../src/config.mjs';

const bin = fileURLToPath(new URL('../src/bin.mjs', import.meta.url));
const schemaPath = fileURLToPath(new URL('../schemas/oiol-config.schema.json', import.meta.url));
const CONFIG_SCHEMA = JSON.parse(await readFile(schemaPath, 'utf8'));

const validConfig = {
  version: 1,
  defaultProfile: 'default',
  profiles: {
    default: { provider: 'openai-compatible', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OIOL_API_KEY', timeoutMs: 60000, maxRetries: 2 },
    alt: { provider: 'anthropic', model: 'claude-3-haiku', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'OIOL_API_KEY', timeoutMs: 60000, maxRetries: 2 }
  }
};

test('config schema accepts a valid config', () => {
  const result = validateJsonSchema(validConfig, CONFIG_SCHEMA);
  assert.equal(result.valid, true, result.errors.join('; '));
});

test('config schema rejects an invalid provider', () => {
  const invalid = structuredClone(validConfig);
  invalid.profiles.default.provider = 'invalid-provider';
  const result = validateJsonSchema(invalid, CONFIG_SCHEMA);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('provider')));
});

test('config schema rejects missing required fields', () => {
  const invalid = { version: 1, defaultProfile: 'default', profiles: { default: { provider: 'openai-compatible' } } };
  const result = validateJsonSchema(invalid, CONFIG_SCHEMA);
  assert.equal(result.valid, false);
});

test('config schema rejects unknown properties', () => {
  const invalid = structuredClone(validConfig);
  invalid.profiles.default.unknownField = 'x';
  const result = validateJsonSchema(invalid, CONFIG_SCHEMA);
  assert.equal(result.valid, false);
});

test('validateConfig rejects an unknown defaultProfile', async () => {
  const invalid = structuredClone(validConfig);
  invalid.defaultProfile = 'missing';
  const result = await validateConfig(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('defaultProfile')));
});

test('loadConfig reads and validates a config file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-config-'));
  try {
    const file = path.join(root, 'oiol.config.json');
    await writeFile(file, JSON.stringify(validConfig));
    const config = await loadConfig(file);
    assert.ok(config);
    assert.equal(config.version, 1);
    assert.equal(config.defaultProfile, 'default');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('loadConfig rejects an invalid config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-config-bad-'));
  try {
    const file = path.join(root, 'oiol.config.json');
    await writeFile(file, JSON.stringify({ version: 1, defaultProfile: 'default', profiles: { default: { provider: 'bad' } } }));
    await assert.rejects(loadConfig(file), /Config validation failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('resolveProfile prefers explicit, then defaultProfile, then the first key', () => {
  assert.equal(resolveProfile(validConfig, 'explicit'), 'explicit');
  assert.equal(resolveProfile(validConfig, undefined), 'default');
  const noDefault = { version: 1, profiles: { first: {}, second: {} } };
  assert.equal(resolveProfile(noDefault, undefined), 'first');
});

test('getProfileConfig returns the profile or null', () => {
  assert.ok(getProfileConfig(validConfig, 'default'));
  assert.equal(getProfileConfig(validConfig, 'missing'), null);
});

test('applyConfigToEnv does not override existing env vars', () => {
  const saved = { provider: process.env.OIOL_PROVIDER, model: process.env.OIOL_MODEL };
  try {
    process.env.OIOL_PROVIDER = 'existing';
    process.env.OIOL_MODEL = 'existing-model';
    const config = { version: 1, defaultProfile: 'default', profiles: { default: { provider: 'anthropic', model: 'claude', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'OIOL_API_KEY', timeoutMs: 60000, maxRetries: 2 } } };
    applyConfigToEnv(config, 'default');
    assert.equal(process.env.OIOL_PROVIDER, 'existing');
    assert.equal(process.env.OIOL_MODEL, 'existing-model');
  } finally {
    if (saved.provider === undefined) delete process.env.OIOL_PROVIDER; else process.env.OIOL_PROVIDER = saved.provider;
    if (saved.model === undefined) delete process.env.OIOL_MODEL; else process.env.OIOL_MODEL = saved.model;
  }
});

test('applyConfigToEnv sets unset env vars from the profile', () => {
  const saved = { provider: process.env.OIOL_PROVIDER, model: process.env.OIOL_MODEL };
  try {
    delete process.env.OIOL_PROVIDER;
    delete process.env.OIOL_MODEL;
    const config = { version: 1, defaultProfile: 'default', profiles: { default: { provider: 'anthropic', model: 'claude-3', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'OIOL_API_KEY', timeoutMs: 60000, maxRetries: 2 } } };
    applyConfigToEnv(config, 'default');
    assert.equal(process.env.OIOL_PROVIDER, 'anthropic');
    assert.equal(process.env.OIOL_MODEL, 'claude-3');
  } finally {
    if (saved.provider === undefined) delete process.env.OIOL_PROVIDER; else process.env.OIOL_PROVIDER = saved.provider;
    if (saved.model === undefined) delete process.env.OIOL_MODEL; else process.env.OIOL_MODEL = saved.model;
  }
});

test('bin delegates --validate to cli.mjs (back-compat)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-bin-validate-'));
  try {
    const file = path.join(root, 'plan.json');
    const plan = { schemaVersion: '1.0.0', contractVersion: '1.0', id: 'test', status: 'needs_revision', project: { kind: 'greenfield', name: 'Test', request: 'test' }, requirements: [{ id: 'r1', statement: 'req' }], architecture: { components: [{ id: 'c1', name: 'C' }], decisions: [] }, tasks: [{ id: 't1', title: 'Task', requirementIds: ['r1'], componentIds: ['c1'], dependencies: [], acceptanceCriteria: ['ok'], writeScope: ['docs'] }], dependencyGraph: { nodes: ['t1'], edges: [] }, risks: [], clarifications: [] };
    await writeFile(file, JSON.stringify(plan));
    const result = spawnSync(process.execPath, [bin, '--validate', file], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.validation.valid, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('init --yes --force creates config and .env in a temp dir', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-init-'));
  try {
    const configOut = path.join(root, 'oiol.config.json');
    const envOut = path.join(root, '.env');
    const result = spawnSync(process.execPath, [bin, 'init', '--yes', '--force', '--out', configOut, '--env-out', envOut], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await readFile(configOut, 'utf8'));
    assert.equal(config.version, 1);
    assert.ok(config.profiles.default);
    assert.ok(config.profiles.default.provider);
    const envText = await readFile(envOut, 'utf8');
    assert.match(envText, /OIOL_API_KEY=/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('doctor --json returns structured checks without a config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-doctor-'));
  try {
    const result = spawnSync(process.execPath, [bin, 'doctor', '--json'], { encoding: 'utf8', cwd: root, env: { PATH: process.env.PATH } });
    const report = JSON.parse(result.stdout);
    assert.equal(typeof report.ok, 'boolean');
    assert.ok(Array.isArray(report.checks));
    assert.ok(report.checks.some(check => check.id === 'node'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
