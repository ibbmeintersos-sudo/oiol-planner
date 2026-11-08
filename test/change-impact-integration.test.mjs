import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeProject } from '../src/analyzer/project-analyzer.mjs';

async function put(root, file, content) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

test('existing-project analyzer exposes Change Impact Analysis as untrusted planning evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oiol-impact-project-'));
  try {
    await put(root, 'package.json', JSON.stringify({ name: 'impact-fixture', private: true }));
    await put(root, 'src/auth/session-manager.js', 'export function verifySession(user) { return Boolean(user); }\n');
    await put(root, 'src/api/profile-route.js', [
      "import { verifySession } from '../auth/session-manager.js';",
      'export function profileRoute(user) { return verifySession(user); }',
      ''
    ].join('\n'));
    await put(root, 'test/auth/session.test.js', [
      "import { verifySession } from '../../src/auth/session-manager.js';",
      "export function authSessionTest() { return verifySession({ id: 1 }); }",
      ''
    ].join('\n'));

    const project = await analyzeProject({
      mode: 'existing',
      repo: root,
      request: 'Update authentication'
    });

    assert.equal(project.kind, 'existing');
    assert.equal(project.changeImpact.status, 'analyzed');
    assert.ok(project.changeImpact.directMatches.some(item => item.path === 'src/auth/session-manager.js'));
    assert.ok(project.changeImpact.affectedTests.some(item => item.path === 'test/auth/session.test.js'));
    const impactEvidence = project.evidence.find(item => item.type === 'change_impact_analysis');
    assert.ok(impactEvidence);
    assert.equal(impactEvidence.trustLevel, 'untrusted_repository_analysis');
    assert.equal(impactEvidence.requestSha256, project.changeImpact.requestSha256);
    assert.equal(impactEvidence.id, project.changeImpact.evidenceId);
    assert.ok(project.constraints.some(item => item.includes('does not execute or verify them')));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
