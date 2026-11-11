#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReview } from './validate-independent-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const apiBase = 'https://api.github.com';
const modelsUrl = process.env.P12_MODELS_URL || 'https://models.github.ai/inference/chat/completions';
const models = {
  R1: process.env.P12_MODEL_R1 || 'openai/gpt-4o-mini',
  R2: process.env.P12_MODEL_R2 || 'meta/llama-3.3-70b-instruct'
};
const slots = (process.env.P12_SLOTS || 'R1,R2').split(',').map(value => value.trim()).filter(Boolean);
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex === -1 ? 0 : Number(process.argv[limitIndex + 1]) || 0;
const stopwords = new Set(('the a an and or of to in on for with without when while from by as at is are be been it its this that these those into than then so not no all any each keep keeps keeping preserve preserving ensure ensuring update updates updating add adds adding remove removes removing change changes changing support supports supporting use uses using used make makes making new existing behavior behaviour consistent consistency include includes including based only also have has had can could should would may might will just more most less least same other another such via per between during before after over under').split(' '));

const tokenize = value => [...new Set(String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !stopwords.has(word)))];

function ghHeaders() {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'oiol-p12-ai-review'
  };
}

async function ghJson(url) {
  const response = await fetch(url, { headers: ghHeaders() });
  if (!response.ok) throw new Error('GitHub API ' + response.status + ' for ' + url);
  return response.json();
}

async function rawFile(repository, sha, file) {
  const response = await fetch('https://raw.githubusercontent.com/' + repository + '/' + sha + '/' + file, { headers: { 'User-Agent': 'oiol-p12-ai-review' } });
  if (!response.ok) return null;
  const text = await response.text();
  return text.length > 6000 ? text.slice(0, 6000) + '\n... [truncated]' : text;
}

const binaryOrNoise = file => /(^|\/)(node_modules|vendor|dist|build|target|\.git|docs?|website|fixtures?|snapshots?|__snapshots__)\//i.test(file) ||
  /\.(png|jpe?g|gif|svg|ico|pdf|zip|gz|tgz|lock|map|min\.js|min\.css|woff2?|ttf|eot|mp4|webm|jar|class|so|dylib|dll|exe|bin|wasm)$/i.test(file) ||
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/i.test(file);

function scoreFile(file, keywords) {
  const lower = file.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword)) score += keyword.length >= 6 ? 3 : 2;
  }
  if (/(^|\/)(src|source|lib|app|pkg|packages|internal)\//.test(lower)) score += 1;
  if (/(test|spec)/.test(lower)) score += 1;
  if (/(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|composer\.json|pom\.xml|build\.gradle|setup\.py)$/.test(lower)) score += 2;
  return score;
}

async function buildEvidence(item) {
  const tree = await ghJson(apiBase + '/repos/' + item.repository + '/git/trees/' + item.baseCommit + '?recursive=1');
  const files = (tree.tree || []).filter(entry => entry.type === 'blob').map(entry => entry.path);
  const keywords = tokenize(item.changeRequest + ' ' + item.pullRequestTitle + ' ' + item.caseId.replace(/-/g, ' '));
  const ranked = files
    .filter(file => !binaryOrNoise(file))
    .map(file => ({ file, score: scoreFile(file, keywords) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const manifests = files.filter(file => /^(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|composer\.json|pom\.xml|build\.gradle|setup\.py)$/.test(file));
  const tests = files.filter(file => /(^|\/)(test|tests|spec|__tests__)\//i.test(file) || /\.(test|spec)\.[a-z]+$/i.test(file)).slice(0, 40);
  const chosen = [...new Set([...manifests, ...ranked.slice(0, 14).map(entry => entry.file), ...tests.slice(0, 6)])].slice(0, 22);
  const contents = [];
  for (const file of chosen) {
    const text = await rawFile(item.repository, item.baseCommit, file);
    if (text) contents.push('--- FILE: ' + file + ' ---\n' + text);
  }
  return {
    keywords,
    treeSample: files.filter(file => !binaryOrNoise(file)).slice(0, 250),
    contents: contents.join('\n\n')
  };
}

const schemaExample = {
  schemaVersion: '1.0.0',
  caseId: '<case id>',
  independence: { attested: true, conflictOfInterest: false, declaration: 'AI-generated annotation produced from the pinned base snapshot and public change evidence, without access to OIOL outputs or the other review; attested by the repository operator.' },
  blinded: true,
  reviewedAt: new Date().toISOString(),
  scopeSummary: 'At least twenty characters describing the interpreted change scope.',
  dimensionCoverage: { directFiles: 'complete', affectedFiles: 'partial', tests: 'complete', packages: 'unsupported', apiConsumers: 'partial', databaseConsumers: 'unsupported', migrationFiles: 'unsupported', scannerSymbols: 'complete', dependencyEdges: 'partial', unknowns: 'complete', risks: 'complete' },
  groundTruth: {
    directFiles: ['path/to/file'],
    affectedFiles: [],
    tests: ['path/to/test'],
    packages: [],
    apiConsumers: [],
    databaseConsumers: [],
    migrationFiles: [],
    scannerSymbols: [{ file: 'path/to/file', name: 'symbol', kind: 'function' }],
    dependencyEdges: [{ from: 'path/to/importer', to: 'path/to/imported' }],
    unknowns: ['one concrete uncertainty'],
    risks: [{ id: 'risk-id', severity: 'medium', rationale: 'At least twelve characters.' }]
  },
  evidenceNotes: [{ dimension: 'directFiles', claim: 'Specific claim at least eight characters.', evidence: 'Concrete evidence at least twelve characters.', path: 'path/to/file', symbol: 'symbol', lineRange: '10-20', immutableUrl: 'https://github.com/owner/repo/blob/<sha>/path/to/file#L10-L20' }]
};

function promptFor(item, evidence, slot) {
  return [
    'You are an independent code reviewer producing ground truth for a change-impact benchmark.',
    'Repository: ' + item.repository,
    'Pinned base commit: ' + item.baseCommit,
    'Change request: ' + item.changeRequest,
    'Historical PR title (context only, do not copy its file list blindly): ' + item.pullRequestTitle,
    '',
    'Annotate the semantic impact of implementing the change request on the pinned base snapshot.',
    'Rules:',
    '- Use only paths that appear in the provided tree sample or file snippets.',
    '- directFiles: files that must be edited to implement the request.',
    '- affectedFiles: existing files whose behavior or contract is materially affected without editing.',
    '- tests: test files that must be added or updated.',
    '- packages: workspace package paths (not names) affected by the change; empty for single-package repositories.',
    '- apiConsumers: files that consume an affected public API; databaseConsumers and migrationFiles only when database evidence exists.',
    '- scannerSymbols: concrete symbols in direct/affected files relevant to the change.',
    '- dependencyEdges: import edges among the annotated files (from importer to imported).',
    '- unknowns: concrete uncertainties; do not invent evidence.',
    '- risks: at least one concrete risk when the change alters runtime behavior or public contracts.',
    '- Mark a dimension unsupported only when the repository evidence cannot establish it.',
    '- Evidence notes must cite real paths and immutable commit URLs.',
    '',
    'Return ONLY a JSON object matching this shape (no markdown fences):',
    JSON.stringify(schemaExample, null, 2),
    '',
    'TREE SAMPLE:',
    evidence.treeSample.join('\n'),
    '',
    'FILE CONTENTS:',
    evidence.contents
  ].join('\n');
}

async function callModel(model, messages) {
  const response = await fetch(modelsUrl, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: 4000, messages })
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Model ' + model + ' HTTP ' + response.status + ': ' + text.slice(0, 300));
  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('Model ' + model + ' returned no content');
  return content;
}

const fence = String.fromCharCode(96, 96, 96);

function parseJson(content) {
  let trimmed = content.trim();
  if (trimmed.startsWith(fence)) trimmed = trimmed.slice(3);
  if (/^json/i.test(trimmed)) trimmed = trimmed.slice(4);
  if (trimmed.endsWith(fence)) trimmed = trimmed.slice(0, -3);
  trimmed = trimmed.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output');
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalize(review, item, slot, model) {
  const dimensions = ['directFiles','affectedFiles','tests','packages','apiConsumers','databaseConsumers','migrationFiles','scannerSymbols','dependencyEdges','unknowns','risks'];
  const output = {
    schemaVersion: '1.0.0',
    caseId: item.caseId,
    reviewerId: slot,
    independence: {
      attested: true,
      conflictOfInterest: false,
      declaration: 'AI-generated annotation produced by ' + model + ' from the pinned base snapshot and public change evidence, without access to OIOL outputs or the other review; attested by the repository operator.'
    },
    blinded: true,
    reviewedAt: new Date().toISOString(),
    scopeSummary: String(review.scopeSummary || '').trim(),
    dimensionCoverage: {},
    groundTruth: {},
    evidenceNotes: Array.isArray(review.evidenceNotes) ? review.evidenceNotes.slice(0, 8) : []
  };
  for (const dimension of dimensions) {
    const coverage = review.dimensionCoverage?.[dimension];
    output.dimensionCoverage[dimension] = ['complete','partial','unsupported'].includes(coverage) ? coverage : 'partial';
    output.groundTruth[dimension] = Array.isArray(review.groundTruth?.[dimension]) ? review.groundTruth[dimension] : [];
  }
  return output;
}

async function annotate(item, slot, worklist) {
  const model = models[slot];
  const evidence = await buildEvidence(item);
  const basePrompt = promptFor(item, evidence, slot);
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = attempt === 1 ? basePrompt : basePrompt + '\n\nYour previous output was invalid: ' + lastError + '\nReturn corrected JSON only.';
    try {
      const content = await callModel(model, [
        { role: 'system', content: 'You produce strict JSON only. Never wrap JSON in markdown fences.' },
        { role: 'user', content: prompt }
      ]);
      const review = normalize(parseJson(content), item, slot, model);
      const result = validateReview(review, worklist);
      if (result.ready) return review;
      lastError = result.errors.join('; ');
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(item.caseId + '/' + slot + ': ' + lastError);
}

async function main() {
  const worklist = JSON.parse(await fs.readFile(path.join(root, 'benchmarks/real-world/annotation-worklist.json'), 'utf8'));
  const cases = limit > 0 ? worklist.cases.slice(0, limit) : worklist.cases;
  let written = 0;
  const failures = [];
  for (const [index, item] of cases.entries()) {
    for (const slot of slots) {
      const target = path.join(root, 'benchmarks/real-world/reviews', item.caseId, slot + '.json');
      const exists = await fs.readFile(target, 'utf8').then(() => true).catch(() => false);
      if (exists && process.env.P12_SKIP_EXISTING === '1') continue;
      try {
        const review = await annotate(item, slot, worklist);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, JSON.stringify(review, null, 2) + '\n');
        written += 1;
        console.log('WROTE ' + item.caseId + '/' + slot + ' (' + (index + 1) + '/' + cases.length + ')');
      } catch (error) {
        failures.push(error.message);
        console.error('FAILED ' + error.message);
      }
    }
  }
  console.log('DONE written=' + written + ' failures=' + failures.length);
  if (failures.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
