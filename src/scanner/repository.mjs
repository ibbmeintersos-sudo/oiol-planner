import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redact } from '../core/utils.mjs';
import { analyzeRepositoryStructure } from './static-analysis.mjs';

const exec = promisify(execFile);
const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.venv', 'venv', 'vendor', 'target', '.cache']);
const SENSITIVE = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|credentials\.json)$/i;
const MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const evidenceId = file => 'REPO-' + sha256(file).slice(0, 12);

async function walkBounded(root, { maxFiles, maxDepth }) {
  const files = [];
  let discovered = 0, truncated = false, depthTruncated = false;
  async function visit(rel = '', depth = 0) {
    if (truncated || depth > maxDepth) return;
    let entries;
    try { entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) break;
      const relative = path.posix.join(rel.replaceAll('\\', '/'), entry.name);
      if (IGNORE.has(entry.name) || SENSITIVE.test(relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth >= maxDepth) depthTruncated = true;
        else await visit(relative, depth + 1);
      }
      else if (entry.isFile()) {
        discovered++;
        if (files.length < maxFiles) files.push(relative);
        else truncated = true;
      }
    }
  }
  await visit();
  return { files, discovered, truncated, depthTruncated };
}

export async function scanRepository(repoPath, { maxFiles = 250, maxFileBytes = 16000, maxContextChars = 50000, maxDepth = 12 } = {}) {
  for (const [name, value] of Object.entries({ maxFiles, maxFileBytes, maxContextChars, maxDepth })) {
    if (!Number.isInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
  }
  const root = await fs.realpath(path.resolve(repoPath));
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('Repository path is not a directory');

  let git = { isRepo: false, branch: null, commit: null, dirty: null };
  try {
    const [branch, commit, status] = await Promise.all([
      exec('git', ['branch', '--show-current'], { cwd: root }),
      exec('git', ['rev-parse', 'HEAD'], { cwd: root }),
      exec('git', ['status', '--porcelain=v1', '-z'], { cwd: root })
    ]);
    git = { isRepo: true, branch: branch.stdout.trim(), commit: commit.stdout.trim(), dirty: status.stdout.length > 0 };
  } catch {}

  const scan = await walkBounded(root, { maxFiles, maxDepth });
  const files = scan.files;
  const manifests = files.filter(file => MANIFESTS.includes(path.posix.basename(file)));
  const scripts = [], tests = [], configs = [];
  for (const file of files) {
    if (/test|spec|__tests__/i.test(file)) tests.push(file);
    if (/config|\.config\./i.test(file)) configs.push(file);
    if (path.posix.basename(file) === 'package.json') {
      try {
        const json = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
        scripts.push(...Object.keys(json.scripts || {}).map(key => 'npm run ' + key));
      } catch {}
    }
  }

  const selected = [...new Set([
    ...manifests,
    ...tests.slice(0, 20),
    ...configs.slice(0, 20),
    ...files.filter(file => /\.(mjs|cjs|js|ts|tsx|py|go|rs|java|md)$/i.test(file)).slice(0, 50)
  ])];
  let context = '', contextTruncated = false;
  const snippets = [];
  const sourceContents = Object.create(null);
  for (const file of selected) {
    try {
      const buffer = await fs.readFile(path.join(root, file));
      if (buffer.length > maxFileBytes || buffer.includes(0)) continue;
      const sourceText = buffer.toString('utf8');
      sourceContents[file] = sourceText;
      const redactedText = redact(sourceText);
      const content = redactedText.slice(0, 5000);
      const id = evidenceId(file);
      if (context.length + content.length > maxContextChars) { contextTruncated = true; break; }
      context += '\n\n--- [EVIDENCE: ' + id + '] ' + file + ' ---\n' + content;
      const sourceSha256 = sha256(buffer);
      snippets.push({
        id,
        path: file,
        sha256: sourceSha256,
        sourceSha256,
        excerptSha256: sha256(content),
        sourceBytes: buffer.length,
        excerptBytes: Buffer.byteLength(content, 'utf8'),
        excerptTruncated: redactedText.length > content.length,
        trustLevel: 'untrusted_repository_content',
        redactionPassApplied: true,
        redactionChangedContent: redactedText !== sourceText,
        content
      });
    } catch {}
  }

  const structure = analyzeRepositoryStructure({ files, contents: sourceContents, manifests });
  const structureSummary = [
    'Repository structure analysis (bounded static heuristics; evidence, not certainty):',
    'Languages: ' + (Object.entries(structure.languages).map(([name,count]) => name + ':' + count).join(', ') || 'not detected'),
    'Frameworks: ' + (structure.frameworks.join(', ') || 'not detected'),
    'Entry points: ' + (structure.entryPoints.join(', ') || 'not detected'),
    'Local import edges: ' + structure.dependencyGraph.edgeCount,
    'Unresolved relative imports: ' + structure.unresolvedLocalImportCount,
    'Route-like files: ' + structure.routeFiles.length,
    'Test-like files: ' + structure.testFiles.length
  ].join('\\n');
  const boundedContext = context.length + structureSummary.length <= maxContextChars ? context + '\\n\\n' + structureSummary : context;
  return {
    kind: 'existing',
    root,
    git,
    files: files.map(file => ({ path: file })),
    fileCount: scan.discovered,
    includedFileCount: files.length,
    fileCountIsLowerBound: scan.truncated || scan.depthTruncated,
    truncated: scan.truncated,
    depthTruncated: scan.depthTruncated,
    manifests,
    scripts: [...new Set(scripts)],
    tests,
    configs,
    context: boundedContext,
    structure,
    snippets,
    contextTruncated,
    scanLimits: { maxFiles, maxFileBytes, maxContextChars, maxDepth }
  };
}
