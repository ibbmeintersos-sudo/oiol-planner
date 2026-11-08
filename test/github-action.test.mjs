import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const actionPath = path.join(root, '.github', 'actions', 'oiol-review', 'action.yml');
const workflowsDir = path.join(root, '.github', 'workflows');

test('the composite action is planning-only', async () => {
  const text = await readFile(actionPath, 'utf8');
  assert.match(text, /using:\s*composite/);
  assert.match(text, /src\/bin\.mjs/);
  assert.match(text, /--mode/);
  assert.doesNotMatch(text, /npm test/);
  assert.doesNotMatch(text, /npm run build/);
  assert.doesNotMatch(text, /pull_request_target/);
});

test('the composite action runs from its own checkout', async () => {
  const text = await readFile(actionPath, 'utf8');
  assert.match(text, /working-directory:\s*\$\{\{ github\.action_path \}\}\/\.\.\/\.\.\/\.\./);
  assert.match(text, /npm ci/);
});

test('the composite action requires an API key and uploads artifacts', async () => {
  const text = await readFile(actionPath, 'utf8');
  assert.match(text, /api-key:[\s\S]*?required:\s*true/);
  assert.match(text, /actions\/upload-artifact@v4/);
  assert.match(text, /if-no-files-found:\s*warn/);
  assert.match(text, /plan-path:/);
  assert.match(text, /report-path:/);
});

test('the example workflow uses pull_request and a secret expression', async () => {
  const text = await readFile(path.join(root, 'examples', 'github-actions', 'oiol-review.yml'), 'utf8');
  assert.match(text, /pull_request:/);
  assert.doesNotMatch(text, /pull_request_target/);
  assert.match(text, /secrets\.OIOL_API_KEY/);
  assert.match(text, /comment:\s*true/);
});

test('the manual self-review workflow does not run on pull requests', async () => {
  const text = await readFile(path.join(workflowsDir, 'oiol-self-review.yml'), 'utf8');
  assert.match(text, /workflow_dispatch:/);
  assert.doesNotMatch(text, /^\s*pull_request:/m);
  assert.doesNotMatch(text, /pull_request_target/);
});

test('no workflow uses pull_request_target', async () => {
  const entries = await readdir(workflowsDir, { withFileTypes: true });
  for (const entry of entries.filter(item => item.isFile() && /\.ya?ml$/.test(item.name))) {
    const text = await readFile(path.join(workflowsDir, entry.name), 'utf8');
    assert.doesNotMatch(text, /pull_request_target/, `${entry.name} must not use pull_request_target`);
  }
});

test('the action documentation states the planning-only boundary', async () => {
  const text = await readFile(path.join(root, 'docs', 'GITHUB_ACTION.md'), 'utf8');
  assert.match(text, /never implements changes/);
  assert.match(text, /never.*executes|does not run/i);
  assert.match(text, /pull_request_target/);
});
