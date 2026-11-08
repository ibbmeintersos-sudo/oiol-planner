import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, renderPlanHtml } from '../src/core/report-html.mjs';

const bin = fileURLToPath(new URL('../src/bin.mjs', import.meta.url));
const examplePath = fileURLToPath(new URL('../examples/plan.v1.json', import.meta.url));
const example = JSON.parse(await readFile(examplePath, 'utf8'));

test('escapeHtml escapes text and attribute metacharacters', () => {
  assert.equal(escapeHtml('<script>alert("x")</script> & \'y\''), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
});

test('renders a plan as a standalone HTML document', () => {
  const html = renderPlanHtml(example);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Sample Inventory API/);
  assert.match(html, /TASK-001/);
  assert.match(html, /Define inventory API contracts/);
  assert.match(html, /Planning artifact only/);
  assert.match(html, /REQ-001/);
  assert.match(html, /RISK-001/);
  assert.equal(/<script[\s>]/i.test(html), false);
});

test('escapes hostile plan content in HTML and title contexts', () => {
  const hostile = structuredClone(example);
  hostile.project.name = '<script>alert("project")</script>';
  hostile.summary = '<img src=x onerror="alert(1)">';
  hostile.tasks[0].title = '</td><script>alert("task")</script>';
  hostile.risks[0].description = '<svg onload=alert(1)>';
  const html = renderPlanHtml(hostile);
  assert.equal(html.includes('<script>alert("project")</script>'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('</td><script>'), false);
  assert.equal(html.includes('<svg onload='), false);
  assert.match(html, /&lt;script&gt;alert\(&quot;project&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test('renders malformed or empty plans without throwing', () => {
  for (const value of [null, undefined, [], { tasks: [null, 1, {}], requirements: 'bad' }]) {
    const html = renderPlanHtml(value);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /Planning artifact only/);
  }
});

test('oiol report writes an HTML file from an existing plan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-report-'));
  try {
    const input = path.join(root, 'plan.json');
    const output = path.join(root, 'plan.html');
    await writeFile(input, JSON.stringify(example));
    const result = spawnSync(process.execPath, [bin, 'report', input, '--out', output], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(output, 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /Define inventory API contracts/);
    assert.match(result.stdout, /Report written to/);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('oiol report renders Markdown to stdout', () => {
  const result = spawnSync(process.execPath, [bin, 'report', examplePath, '--format', 'md'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Engineering Plan/);
});

test('oiol report returns exit code 2 for an invalid plan but still writes the report', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-report-invalid-'));
  try {
    const input = path.join(root, 'plan.json');
    const output = path.join(root, 'report.json');
    const invalid = structuredClone(example);
    invalid.tasks[0].acceptanceCriteria = [];
    await writeFile(input, JSON.stringify(invalid));
    const result = spawnSync(process.execPath, [bin, 'report', input, '--format', 'json', '--out', output], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 2);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.validation.valid, false);
    assert.equal(report.status, 'blocked');
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
