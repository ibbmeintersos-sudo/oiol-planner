import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { redact } from '../core/utils.mjs';
import { analyzeRepositoryStructure } from './static-analysis.mjs';

const exec = promisify(execFile);
const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.venv', 'venv', 'vendor', 'target', '.cache']);
const SENSITIVE = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx|jks|keystore)|(?:credentials|secrets)\.(?:json|ya?ml)|\.npmrc|\.pypirc|\.netrc)$/i;
const MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json'];
const SUPPORTED_SOURCE_FILE = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|php|rb)$/i;
const SOURCE_FILE = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|php|rb|dart|swift|m|mm|h|hpp|c|cc|cpp|cs|scala|sql|sh|ex|exs|erl|hrl|clj|cljs|cljc|fs|fsx|hs|ml|mli|vue|svelte)$/i;
const TEST_FILE = /(^|\/)(?:__tests__|tests?|spec)(\/|$)|\.(?:test|spec)\.[^.]+$|(?:^|\/)[^/]+_test\.[^.]+$/i;
const CONFIG_FILE = /(^|\/)(?:config|configs|configuration)(\/|$)|(^|\/)(?:[^/]+\.)?(?:config|conf|settings|tsconfig)\.[^/]+$/i;
const PRIORITY_DIRS = new Map([
  ['src', -24], ['src-ui', -24], ['server', -22], ['web', -22], ['cmd', -22], ['internal', -22],
  ['pkg', -20], ['lib', -20], ['crates', -20], ['packages', -18], ['apps', -18], ['app', -18],
  ['routers', -16], ['routes', -16], ['services', -16], ['models', -16], ['controllers', -16],
  ['core', -16], ['engine', -16], ['backend', -16], ['frontend', -16], ['api', -16],
  ['client', -14], ['modules', -14], ['documents', -14], ['cli', -12],
  ['mobile', -5], ['native', -5], ['open-api', -3]
]);
const LOW_PRIORITY_DIRS = new Set([
  '.github','.gitlab','.changeset','.mise','docs','doc','documentation','demo','demos','examples','example',
  'playground','website','site','storybook','stories','assets','static','public','translations','locales',
  'images','screenshots','deployment','deploy','contrib','i18n','readme_i18n','machine-learning',
  'design','e2e','docker','native','fastlane','misc','.devcontainer','.vscode'
]);
function entryPriority(entry, depth) {
  const name = entry.name.toLowerCase();
  if (entry.isFile() && MANIFESTS.includes(name)) return depth === 0 ? -30 : -12;
  if (entry.isFile() && ['readme.md','license','license.md'].includes(name)) return depth === 0 ? -20 : 8;
  if (entry.isDirectory() && PRIORITY_DIRS.has(name)) return PRIORITY_DIRS.get(name);
  if (entry.isFile() && SUPPORTED_SOURCE_FILE.test(name)) return 0;
  if (entry.isFile() && SOURCE_FILE.test(name)) return 1;
  if (entry.isFile() && TEST_FILE.test(name)) return 3;
  if (entry.isDirectory() && LOW_PRIORITY_DIRS.has(name)) return 12;
  if (entry.isFile() && CONFIG_FILE.test(name)) return 6;
  if (entry.isFile() && /\.(?:md|mdx|rst|adoc)$/i.test(name)) return 10;
  return 5;
}

const sha256 = value => createHash('sha256').update(value).digest('hex');
const evidenceId = file => 'REPO-' + sha256(file).slice(0, 12);

async function walkBounded(root, { maxFiles, maxDepth }) {
  const files = [];
  const queue = [{ rel: '', depth: 0, rootPriority: -100, localPriority: -100 }];
  const skipped = { counts: { ignored: 0, sensitive: 0, symbolicLink: 0, depthLimit: 0, fileLimit: 0 }, paths: [], fileLimitReachedAt: null };
  const recordSkipped = (relative, reason) => {
    skipped.counts[reason]++;
    if (skipped.paths.length < 250) skipped.paths.push({ path: relative, reason });
  };
  let discovered = 0, truncated = false, depthTruncated = false;
  while (queue.length && !truncated) {
    queue.sort((a, b) =>
      a.rootPriority - b.rootPriority ||
      a.depth - b.depth ||
      a.localPriority - b.localPriority ||
      a.rel.localeCompare(b.rel)
    );
    const current = queue.shift();
    let entries;
    try { entries = await fs.readdir(path.join(root, current.rel), { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => entryPriority(a, current.depth) - entryPriority(b, current.depth) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) break;
      const relative = path.posix.join(current.rel.replaceAll('\\', '/'), entry.name);
      if (IGNORE.has(entry.name)) { recordSkipped(relative, 'ignored'); continue; }
      if (SENSITIVE.test(relative)) { recordSkipped(relative, 'sensitive'); continue; }
      if (entry.isSymbolicLink()) { recordSkipped(relative, 'symbolicLink'); continue; }
      if (entry.isDirectory()) {
        if (current.depth >= maxDepth) { depthTruncated = true; recordSkipped(relative, 'depthLimit'); }
        else {
          const localPriority = entryPriority(entry, current.depth);
          queue.push({
            rel: relative,
            depth: current.depth + 1,
            rootPriority: current.depth === 0 ? localPriority : current.rootPriority,
            localPriority
          });
        }
      } else if (entry.isFile()) {
        discovered++;
        if (files.length < maxFiles) files.push(relative);
        else { truncated = true; skipped.fileLimitReachedAt = relative; recordSkipped(relative, 'fileLimit'); }
      }
    }
  }
  return { files, discovered, truncated, depthTruncated, skipped };
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
    if (TEST_FILE.test(file)) tests.push(file);
    if (CONFIG_FILE.test(file)) configs.push(file);
    if (path.posix.basename(file) === 'package.json') {
      try {
        const json = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
        scripts.push(...Object.keys(json.scripts || {}).map(key => 'npm run ' + key));
      } catch {}
    }
  }

  const selected = [...new Set([
    ...manifests,
    ...files.filter(file => SUPPORTED_SOURCE_FILE.test(file)).slice(0, 100),
    ...tests.slice(0, 15),
    ...configs.slice(0, 15)
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
      if (context.length + content.length > maxContextChars) { contextTruncated = true; continue; }
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
    'Repository structure analysis (Tree-sitter AST where bundled grammars are available; bounded lexical fallback otherwise; evidence, not certainty):',
    'Languages: ' + (Object.entries(structure.languages).map(([name,count]) => name + ':' + count).join(', ') || 'not detected'),
    'Frameworks: ' + (structure.frameworks.join(', ') || 'not detected'),
    'Entry points: ' + (structure.entryPoints.join(', ') || 'not detected'),
    'AST-parsed source files: ' + structure.astFileCount,
    'Lexical fallback source files: ' + structure.lexicalFallbackFileCount,
    'Syntax-error files: ' + structure.syntaxErrorFileCount,
    'Bundled Tree-sitter grammars: ' + (structure.availableGrammarLanguages.slice(0, 24).join(', ') || 'not exposed'),
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
    skipped: scan.skipped,
    manifests,
    scripts: [...new Set(scripts)],
    tests,
    configs,
    context: boundedContext,
    structure: { ...structure, sourceEvidence: snippets.map(({id,path,sourceSha256,excerptSha256}) => ({id,path,sourceSha256,excerptSha256,trustLevel:'untrusted_repository_content'})) },
    snippets,
    contextTruncated,
    scanLimits: { maxFiles, maxFileBytes, maxContextChars, maxDepth }
  };
}
