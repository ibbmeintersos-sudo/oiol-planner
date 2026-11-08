#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { analyzeProject } from '../src/analyzer/project-analyzer.mjs';
import { SCANNER_VERSION, EXTERNAL_REPOSITORY_SCAN_OPTIONS } from '../src/scanner/repository.mjs';
import { assertExternalRepositorySnapshot, summarizeRepositoryEvidence } from './run-planner-benchmark.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Benchmark intake is an operator-directed tool, not the read-only core scanner.
// Git metadata is collected here so the scanner itself never invokes target-project commands.
async function collectGitMetadata(repositoryRoot) {
  const fallback = { isRepo: false, branch: null, commit: null, dirty: null, status: 'not_collected' };
  try {
    const [{ stdout: commitOut }, { stdout: branchOut }, { stdout: statusOut }] = await Promise.all([
      exec('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
      exec('git', ['branch', '--show-current'], { cwd: repositoryRoot }),
      exec('git', ['status', '--porcelain=v1', '-z'], { cwd: repositoryRoot })
    ]);
    const commit = String(commitOut || '').trim();
    if (!/^[a-f0-9]{40}$/i.test(commit)) return fallback;
    return {
      isRepo: true,
      branch: String(branchOut || '').trim() || null,
      commit,
      dirty: String(statusOut || '').length > 0,
      status: 'collected'
    };
  } catch {
    return fallback;
  }
}
export async function scanExternalRepository({ repositoryRoot, repositoryId = 'external-repository', scanOptions = EXTERNAL_REPOSITORY_SCAN_OPTIONS }) {
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
    request: 'Read-only repository intake scan for the OIOL P12 real-world planning benchmark.',
    scanOptions
  });
  project.repository.git = await collectGitMetadata(path.resolve(repositoryRoot));
  assertExternalRepositorySnapshot(project, { requireRequestedEvidence: false });
  const repository = project.repository;
  const scannerEvidence = summarizeRepositoryEvidence(project);
  return {
    protocolVersion: '1.0',
    scanRunnerVersion: '1.7.0',
    scannerVersion: repository.scannerVersion || SCANNER_VERSION,
    repositoryId,
    scannedAt: new Date().toISOString(),
    sourceMode: 'operator-supplied-local-checkout',
    root: 'external-repository',
    git: repository.git,
    fileCount: repository.fileCount,
    includedFileCount: repository.includedFileCount,
    includedPaths: repository.files.map(file => file.path),
    sourcePaths: repository.files.map(file => file.path).filter(file => /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|php|rb|dart|swift|m|mm|h|hpp|c|cc|cpp|cs|scala|sql|sh|ex|exs|erl|hrl|clj|cljs|cljc|fs|fsx|hs|ml|mli|vue|svelte)$/i.test(file)),
    fileCountIsLowerBound: repository.fileCountIsLowerBound,
    truncated: repository.truncated,
    depthTruncated: repository.depthTruncated,
    scanLimits: repository.scanLimits,
    skipped: repository.skipped,
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
      unsupportedLanguageFiles: repository.structure.unsupportedLanguageFiles,
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
    evidenceSelection: repository.evidenceSelection,
    evidence: project.evidence.map(item => ({
      id: item.id,
      type: item.type,
      source: item.type === 'repository_scan' ? 'external-repository' : item.source,
      sourceSha256: item.sourceSha256 || null,
      excerptSha256: item.excerptSha256 || null,
      trustLevel: item.trustLevel
    })),
    coverage: scannerEvidence.coverage
  };
}

export async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/run-external-corpus-scan.mjs --repo /path/to/clean/checkout --id RW-REPO-01 [--task-file task.json] [--out scan.json]');
    return 0;
  }
  const repositoryRoot = arg('repo');
  const repositoryId = arg('id', 'external-repository');
  const taskFilePath = arg('task-file');
  let priorityPaths = [], priorityRanges = [];
  if (taskFilePath) {
    const task = JSON.parse(await fs.readFile(path.resolve(taskFilePath), 'utf8'));
    if (!Array.isArray(task.evidencePaths) || !task.evidencePaths.length) throw new Error('--task-file must contain non-empty evidencePaths');
    priorityPaths = task.evidencePaths;
    priorityRanges = task.evidenceRanges || [];
  }
  const report = await scanExternalRepository({ repositoryRoot, repositoryId, scanOptions: { ...EXTERNAL_REPOSITORY_SCAN_OPTIONS, priorityPaths, priorityRanges } });
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
