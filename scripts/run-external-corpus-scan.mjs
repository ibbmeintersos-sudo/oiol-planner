#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeProject } from '../src/analyzer/project-analyzer.mjs';
import { assertExternalRepositorySnapshot } from './run-planner-benchmark.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export async function scanExternalRepository({ repositoryRoot, repositoryId = 'external-repository' }) {
  if (typeof repositoryRoot !== 'string' || !repositoryRoot.trim()) {
    throw new Error('--repo must point to a local repository checkout');
  }
  if (typeof repositoryId !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(repositoryId)) {
    throw new Error('--id must be a 2-64 character identifier using letters, numbers, dot, underscore, or hyphen');
  }
  const project = await analyzeProject({
    mode: 'existing',
    repo: path.resolve(repositoryRoot),
    name: repositoryId,
    request: 'Read-only repository intake scan for the OIOL P12 real-world planning benchmark.'
  });
  assertExternalRepositorySnapshot(project);
  const repository = project.repository;
  return {
    protocolVersion: '1.0',
    scanRunnerVersion: '1.0.0',
    repositoryId,
    scannedAt: new Date().toISOString(),
    sourceMode: 'operator-supplied-local-checkout',
    root: 'external-repository',
    git: repository.git,
    fileCount: repository.fileCount,
    includedFileCount: repository.includedFileCount,
    fileCountIsLowerBound: repository.fileCountIsLowerBound,
    truncated: repository.truncated,
    depthTruncated: repository.depthTruncated,
    scanLimits: repository.scanLimits,
    manifests: repository.manifests,
    scriptsDiscovered: repository.scripts,
    testsDiscovered: repository.tests,
    configsDiscovered: repository.configs,
    structure: {
      method: repository.structure.method,
      languages: repository.structure.languages,
      sourceFileCount: repository.structure.sourceFileCount,
      analyzedSourceFileCount: repository.structure.analyzedSourceFileCount,
      astFileCount: repository.structure.astFileCount,
      lexicalFallbackFileCount: repository.structure.lexicalFallbackFileCount,
      unsupportedLanguageFileCount: repository.structure.unsupportedLanguageFileCount,
      parseFailureFileCount: repository.structure.parseFailureFileCount,
      syntaxErrorFileCount: repository.structure.syntaxErrorFileCount,
      nodeLimitFileCount: repository.structure.nodeLimitFileCount,
      depthLimitFileCount: repository.structure.depthLimitFileCount,
      frameworks: repository.structure.frameworks,
      entryPoints: repository.structure.entryPoints,
      dependencyGraph: {
        nodeCount: repository.structure.dependencyGraph.nodes.length,
        edgeCount: repository.structure.dependencyGraph.edgeCount
      },
      unresolvedLocalImportCount: repository.structure.unresolvedLocalImportCount,
      diagnostics: repository.structure.diagnostics,
      parserDiagnostics: repository.structure.parserDiagnostics,
      limitations: repository.structure.limitations
    },
    evidence: project.evidence.map(item => ({
      id: item.id,
      type: item.type,
      source: item.type === 'repository_scan' ? 'external-repository' : item.source,
      sourceSha256: item.sourceSha256 || null,
      excerptSha256: item.excerptSha256 || null,
      trustLevel: item.trustLevel
    }))
  };
}

export async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/run-external-corpus-scan.mjs --repo /path/to/clean/checkout --id RW-REPO-01 [--out scan.json]');
    return 0;
  }
  const repositoryRoot = arg('repo');
  const repositoryId = arg('id', 'external-repository');
  const report = await scanExternalRepository({ repositoryRoot, repositoryId });
  const output = arg('out');
  if (output) {
    const destination = path.resolve(output);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ repositoryId, commit: report.git.commit, output: destination }, null, 2));
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    console.error('External repository scan error: ' + error.message);
    process.exitCode = 1;
  }
}
