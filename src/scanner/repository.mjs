import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redact } from '../core/utils.mjs';
import { analyzeRepositoryStructure } from './static-analysis.mjs';

<<<<<<< HEAD
const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.venv', 'venv', 'vendor', 'target', '.cache']);
const SENSITIVE = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|credentials\.json)$/i;
const MANIFESTS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'composer.json', 'pnpm-workspace.yaml', 'lerna.json',
  'nx.json', 'turbo.json', 'tsconfig.json', 'jsconfig.json', 'angular.json'
];
const SOURCE_EXTENSIONS = /\.(mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|php|rb|sql|prisma)$/i;
=======
const exec = promisify(execFile);
export const SCANNER_VERSION = '1.7.0';
export const EXTERNAL_REPOSITORY_SCAN_OPTIONS = Object.freeze({ maxFiles: 5000, maxFileBytes: 32000, maxPriorityFileBytes: 256000, maxContextChars: 150000, maxPriorityExcerptChars: 10000, maxDepth: 16, maxSourceFiles: 500, maxTestFiles: 25, maxConfigFiles: 25 });
const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.venv', 'venv', 'vendor', 'target', '.cache']);
const SENSITIVE = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx|jks|keystore)|(?:credentials|secrets)\.(?:json|ya?ml)|\.npmrc|\.pypirc|\.netrc)$/i;
const MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json'];
const SUPPORTED_SOURCE_FILE = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|php|rb|dart|swift)$/i;
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

>>>>>>> origin/main
const sha256 = value => createHash('sha256').update(value).digest('hex');
const evidenceId = file => 'REPO-' + sha256(file).slice(0, 12);

function interleaveGroups(groups) {
  const output = [];
  const maxLength = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < maxLength; index++) {
    for (const group of groups) if (index < group.length) output.push(group[index]);
  }
  return output;
}

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
<<<<<<< HEAD
        if (depth >= maxDepth) depthTruncated = true;
        else await visit(relative, depth + 1);
=======
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
>>>>>>> origin/main
      } else if (entry.isFile()) {
        discovered++;
        if (files.length < maxFiles) files.push(relative);
        else { truncated = true; skipped.fileLimitReachedAt = relative; recordSkipped(relative, 'fileLimit'); }
      }
    }
  }
  return { files, discovered, truncated, depthTruncated, skipped };
}

<<<<<<< HEAD
export async function scanRepository(repoPath, {
  maxFiles = 250,
  maxFileBytes = 16000,
  maxContextChars = 50000,
  maxDepth = 12,
  maxSourceFiles = 100,
  analysisMode = 'auto'
} = {}) {
  if (!['auto', 'lexical'].includes(analysisMode)) throw new Error('analysisMode must be auto or lexical');
  for (const [name, value] of Object.entries({ maxFiles, maxFileBytes, maxContextChars, maxDepth, maxSourceFiles })) {
=======
export async function scanRepository(repoPath, { maxFiles = 250, maxFileBytes = 16000, maxPriorityFileBytes = 128000, maxContextChars = 50000, maxPriorityExcerptChars = 10000, maxDepth = 12, maxSourceFiles = 100, maxTestFiles = 15, maxConfigFiles = 15, priorityPaths = [], priorityRanges = [] } = {}) {
  for (const [name, value] of Object.entries({ maxFiles, maxFileBytes, maxPriorityFileBytes, maxContextChars, maxPriorityExcerptChars, maxDepth, maxSourceFiles, maxTestFiles, maxConfigFiles })) {
>>>>>>> origin/main
    if (!Number.isInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
  }
  if (!Array.isArray(priorityPaths) || priorityPaths.some(value => typeof value !== 'string' || !value.trim())) throw new Error('priorityPaths must be an array of non-empty relative paths');
  const normalizedPriorityPaths = [...new Set(priorityPaths.map(value => value.replaceAll('\\', '/')))];
  for (const relative of normalizedPriorityPaths) {
    const normalized = path.posix.normalize(relative);
    if (relative.startsWith('/') || /^[a-z]:/i.test(relative) || normalized !== relative || normalized === '.' || normalized.split('/').includes('..')) {
      throw new Error('Unsafe priority evidence path: ' + relative);
    }
    if (SENSITIVE.test(relative)) throw new Error('Sensitive priority evidence path is not allowed: ' + relative);
  }
  if (!Array.isArray(priorityRanges) || priorityRanges.some(range => !range || typeof range.path !== 'string' || !range.path.trim() || !Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine || range.endLine - range.startLine > 200)) throw new Error('priorityRanges must contain safe paths and 1-based line ranges of at most 201 lines');
  const normalizedPriorityRanges = priorityRanges.map(range => ({ path: range.path.replaceAll('\\', '/'), startLine: range.startLine, endLine: range.endLine }));
  for (const range of normalizedPriorityRanges) {
    const normalized = path.posix.normalize(range.path);
    if (range.path.startsWith('/') || /^[a-z]:/i.test(range.path) || normalized !== range.path || normalized.split('/').includes('..')) throw new Error('Unsafe priority evidence range path: ' + range.path);
    if (SENSITIVE.test(range.path)) throw new Error('Sensitive priority evidence range path is not allowed: ' + range.path);
    if (!normalizedPriorityPaths.includes(range.path)) throw new Error('Priority evidence range path must also appear in priorityPaths: ' + range.path);
  }
  const priorityRangesByPath = new Map();
  for (const range of normalizedPriorityRanges) priorityRangesByPath.set(range.path, [...(priorityRangesByPath.get(range.path) || []), range]);
  const root = await fs.realpath(path.resolve(repoPath));
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('Repository path is not a directory');

  // Scanner is filesystem-read-only: repository metadata is supplied by trusted caller context.
  // Never invoke Git or any other target-project command during repository analysis.
  const git = { isRepo: false, branch: null, commit: null, dirty: null, status: 'not_collected' };

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

<<<<<<< HEAD
  const sourceCandidates = files.filter(file => SOURCE_EXTENSIONS.test(file));
  const selectedSources = sourceCandidates.slice(0, maxSourceFiles);
  const readmes = files.filter(file => /^readme(?:\.[^.]+)?$/i.test(path.posix.basename(file))).slice(0, 5);
  const selected = [...new Set([
    ...manifests,
    ...tests.slice(0, 20),
    ...configs.slice(0, 20),
    ...selectedSources,
    ...readmes
=======
  const matchedPriorityPaths = normalizedPriorityPaths.filter(file => files.includes(file));
  const prioritySourceFiles = matchedPriorityPaths.filter(file => SUPPORTED_SOURCE_FILE.test(file));
  const sourceFiles = [...new Set([...prioritySourceFiles, ...files.filter(file => SUPPORTED_SOURCE_FILE.test(file)).slice(0, maxSourceFiles)])];
  const selected = [...new Set([
    ...matchedPriorityPaths,
    ...interleaveGroups([
      manifests,
      sourceFiles,
      tests.slice(0, maxTestFiles),
      configs.slice(0, maxConfigFiles)
    ])
>>>>>>> origin/main
  ])];

  let context = '', contextTruncated = false;
  let contextIncludedExcerptCount = 0, contextOmittedExcerptCount = 0;
  let readFailureCount = 0, oversizedFileCount = 0, binaryFileCount = 0;
  const snippets = [];
  const sourceContents = Object.create(null);
  const excerptedRangeKeys = new Set();
  const rangeKey = range => range.path + ':' + range.startLine + '-' + range.endLine;
  for (const file of selected) {
    try {
      const buffer = await fs.readFile(path.join(root, file));
<<<<<<< HEAD
      if (buffer.length > maxFileBytes) { oversizedFileCount++; continue; }
      if (buffer.includes(0)) { binaryFileCount++; continue; }
=======
      const fileRanges = priorityRangesByPath.get(file) || [];
      const allowedBytes = fileRanges.length ? maxPriorityFileBytes : maxFileBytes;
      if (buffer.length > allowedBytes || buffer.includes(0)) continue;
>>>>>>> origin/main
      const sourceText = buffer.toString('utf8');
      sourceContents[file] = sourceText;
      const redactedText = redact(sourceText);
      let content;
      const fileExcerptedRangeKeys = [];
      if (fileRanges.length) {
        const lines = redactedText.split(/\r?\n/);
        const segments = [];
        let remainingChars = maxPriorityExcerptChars;
        for (const range of fileRanges) {
          if (range.startLine > lines.length || range.endLine > lines.length) continue;
          const endLine = range.endLine;
          const segment = '[EVIDENCE RANGE: ' + file + ':' + range.startLine + '-' + endLine + ']\n' + lines.slice(range.startLine - 1, endLine).join('\n');
          const separator = segments.length ? '\n\n' : '';
          if (segment.length + separator.length > remainingChars) continue;
          segments.push(segment);
          remainingChars -= segment.length + separator.length;
          fileExcerptedRangeKeys.push(rangeKey(range));
        }
        content = segments.join('\n\n');
      } else content = redactedText.slice(0, 5000);
      const id = evidenceId(file);
<<<<<<< HEAD
      const sourceSha256 = sha256(buffer);
      const snippet = {
=======
      if (context.length + content.length > maxContextChars) { contextTruncated = true; continue; }
      context += '\n\n--- [EVIDENCE: ' + id + '] ' + file + ' ---\n' + content;
      const sourceSha256 = sha256(buffer);
      for (const key of fileExcerptedRangeKeys) excerptedRangeKeys.add(key);
      snippets.push({
>>>>>>> origin/main
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
        contextIncluded: false,
        content
      };
      snippets.push(snippet);

      const contextBlock = '\n\n--- [EVIDENCE: ' + id + '] ' + file + ' ---\n' + content;
      if (context.length + contextBlock.length <= maxContextChars) {
        context += contextBlock;
        snippet.contextIncluded = true;
        contextIncludedExcerptCount++;
      } else {
        contextTruncated = true;
        contextOmittedExcerptCount++;
      }
    } catch {
      readFailureCount++;
    }
  }

<<<<<<< HEAD
  // Context-only selections (for example test/config excerpts) must not expand the source-analysis cap.
  const analysisContents = Object.assign(Object.create(null), sourceContents);
  const selectedSourceSet = new Set(selectedSources);
  for (const file of sourceCandidates) if (!selectedSourceSet.has(file)) delete analysisContents[file];

  const sourceEvidence = snippets.map(({ id, path, sourceSha256, excerptSha256 }) => ({
    id, path, sourceSha256, excerptSha256, trustLevel: 'untrusted_repository_content'
  }));
  const structure = analyzeRepositoryStructure({
    files, contents: analysisContents, manifests, sourceEvidence, maxFileBytes, analysisMode
  });
=======
  const structure = analyzeRepositoryStructure({ files, contents: sourceContents, manifests, maxFileBytes });
  const excerptedPriorityPaths = matchedPriorityPaths.filter(file => snippets.some(snippet => snippet.path === file));
  const excerptedRanges = normalizedPriorityRanges.filter(range => excerptedRangeKeys.has(rangeKey(range)));
  const evidenceSelection = {
    requestedPaths: normalizedPriorityPaths,
    matchedPaths: matchedPriorityPaths,
    excerptedPaths: excerptedPriorityPaths,
    missingPaths: normalizedPriorityPaths.filter(file => !files.includes(file)),
    unexcerptedPaths: matchedPriorityPaths.filter(file => !excerptedPriorityPaths.includes(file)),
    requestedRanges: normalizedPriorityRanges,
    excerptedRanges,
    missingRanges: normalizedPriorityRanges.filter(range => !files.includes(range.path)),
    unexcerptedRanges: normalizedPriorityRanges.filter(range => files.includes(range.path) && !excerptedRangeKeys.has(rangeKey(range)))
  };
>>>>>>> origin/main
  const structureSummary = [
    'Repository structure analysis (bounded static evidence; not proof of runtime behavior):',
    'Languages: ' + (Object.entries(structure.languages).map(([name, count]) => name + ':' + count).join(', ') || 'not detected'),
    'Frameworks: ' + (structure.frameworks.join(', ') || 'not detected'),
    'Package manager: ' + (structure.workspaceGraph.packageManager || 'not detected'),
    'Declared monorepo: ' + structure.workspaceGraph.isMonorepo,
    'Workspace packages: ' + structure.workspaceGraph.packages.length,
    'Workspace dependency edges: ' + structure.workspaceGraph.dependencies.length,
    'Entry points: ' + (structure.entryPoints.join(', ') || 'not detected'),
    'Scanner analysis mode: ' + structure.analysisMode,
    'AST runtime available: ' + structure.astRuntimeAvailable,
    'AST-parsed source files: ' + structure.astFileCount,
    'Lexical fallback source files: ' + structure.lexicalFallbackFileCount,
    'Syntax-error files: ' + structure.syntaxErrorFileCount,
    'Path-alias imports resolved: ' + structure.pathAliases.resolvedImportCount,
    'Local import edges: ' + structure.dependencyGraph.edgeCount,
    'Database schema objects: ' + (structure.databaseSchema?.tables?.length || 0),
    'Database DDL change candidates: ' + (structure.databaseSchema?.changes?.length || 0),
    'Database schema consumer candidates: ' + (structure.databaseSchema?.consumers?.length || 0),
    'Unresolved local imports: ' + structure.unresolvedLocalImportCount,
    'Fingerprint coverage of structural findings: ' + structure.evidenceCoverage.fingerprintedFindingRate
  ].join('\n');
  const summaryBlock = '\n\n' + structureSummary;
  const boundedContext = context.length + summaryBlock.length <= maxContextChars
    ? context + summaryBlock
    : context;

  return {
    kind: 'existing',
    scannerVersion: SCANNER_VERSION,
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
    structure: {
      ...structure,
      sourceEvidence: sourceEvidence
    },
    snippets,
<<<<<<< HEAD
    contextTruncated: contextTruncated || context.length + summaryBlock.length > maxContextChars,
    coverage: {
      discoveredFiles: scan.discovered,
      includedFiles: files.length,
      fileSelectionTruncated: scan.truncated,
      depthTruncated: scan.depthTruncated,
      sourceCandidates: sourceCandidates.length,
      selectedSourceFiles: selectedSources.length,
      sourceFilesOmittedBySelectionLimit: Math.max(0, sourceCandidates.length - selectedSources.length),
      selectedFiles: selected.length,
      filesRead: Object.keys(sourceContents).length,
      readFailureCount,
      oversizedFileCount,
      binaryFileCount,
      contextIncludedExcerptCount,
      contextOmittedExcerptCount,
      contextBudgetIndependentOfStructuralAnalysis: true
    },
    scanLimits: { maxFiles, maxFileBytes, maxContextChars, maxDepth, maxSourceFiles, analysisMode }
=======
    evidenceSelection,
    contextTruncated,
    scanLimits: { maxFiles, maxFileBytes, maxPriorityFileBytes, maxContextChars, maxPriorityExcerptChars, maxDepth, maxSourceFiles, maxTestFiles, maxConfigFiles }
>>>>>>> origin/main
  };
}
