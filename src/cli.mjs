#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeProject } from './analyzer/project-analyzer.mjs';
import { createProvider } from './providers/index.mjs';
import { HybridPlanner } from './core/planner.mjs';
import { evaluatePlan } from './core/evaluate.mjs';
import { validatePlanSchema } from './core/schema-validator.mjs';
import { deriveTaskInterfaces } from './core/task-interface.mjs';
import { buildTraceability } from './core/traceability.mjs';
import { renderPlanMarkdown } from './core/report.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--help' || value === '-h') options.help = true;
    else if (value.startsWith('--')) options[value.slice(2)] = argv[++index];
  }
  return options;
}
const options = parseArgs(process.argv.slice(2));
const help = [
  'OIOL — Intelligent Engineering Planning System',
  '',
  'Usage:',
  '  node src/cli.mjs --mode greenfield --name "My App" --request "Build ..." --out plan.json',
  '  node src/cli.mjs --mode existing --repo ./repo --request "Improve ..." --format md --out plan.md',
  '  node src/cli.mjs --validate plan.json',
  '  node src/cli.mjs --validate plan.json --format md --out plan-review.md',
  '',
  'Options:',
  '  --mode greenfield|existing   Planning context',
  '  --name NAME                  Project name',
  '  --repo PATH                  Existing repository to analyze (read-only scan)',
  '  --request TEXT               Engineering request',
  '  --format json|md             Output format (default: json)',
  '  --out PATH                   Write the resulting artifact to a file',
  '  --validate PATH              Validate an existing plan without calling a provider',
  '  --repairs N                  Maximum planning repair rounds (0-5)',
  '',
  'Environment: OIOL_PROVIDER, OIOL_MODEL, OIOL_BASE_URL, OIOL_API_KEY,',
  '             OIOL_TIMEOUT_MS, OIOL_MAX_RETRIES, OIOL_REVIEW_PROVIDER',
  'Providers: openai-compatible, anthropic, gemini, ollama'
].join('\\n');
async function writeOutput(content, destination) {
  if (destination) {
    const resolved = path.resolve(destination);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content.endsWith('\n') ? content : content + '\n', 'utf8');
    console.log('Output written to ' + resolved);
  } else {
    process.stdout.write(content.endsWith('\n') ? content : content + '\n');
  }
}
async function main() {
  if (options.help) { console.log(help); return; }
  if (options.validate) {
    const source = JSON.parse(await fs.readFile(path.resolve(options.validate), 'utf8'));
    const evaluation = evaluatePlan(source, source.project || {});
    const schemaValidation = await validatePlanSchema(source);
    const validation = {
      ...evaluation.validation,
      valid: evaluation.validation.valid && schemaValidation.valid,
      errors: [...evaluation.validation.errors, ...schemaValidation.errors.map(error => 'Schema: ' + error)],
      schemaValidation
    };
    const plan = { ...source, validation, evaluation: { ...evaluation, validation, schemaValidation } };
    if (!validation.valid) { plan.status = 'blocked'; process.exitCode = 2; }
    const format = options.format || (options.out?.toLowerCase().endsWith('.md') ? 'md' : 'json');
    if (!['json', 'md'].includes(format)) throw new Error('--format must be json or md');
    await writeOutput(format === 'md' ? renderPlanMarkdown(plan) : JSON.stringify(plan, null, 2), options.out);
    return;
  }
  if (!options.mode || !['greenfield', 'existing'].includes(options.mode)) throw new Error('--mode must be greenfield or existing');
  if (!options.request) throw new Error('--request is required');
  if (options.env) {
    const { loadEnvFile } = await import('node:process');
    loadEnvFile(options.env);
  } else {
    try { process.loadEnvFile?.('.env'); } catch {}
  }
  const project = await analyzeProject({ mode: options.mode, name: options.name, request: options.request, repo: options.repo });
  const provider = createProvider({
    provider: process.env.OIOL_PROVIDER || 'openai-compatible',
    model: process.env.OIOL_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OIOL_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.OIOL_API_KEY,
    timeoutMs: Number(process.env.OIOL_TIMEOUT_MS || 60000),
    maxRetries: Number(process.env.OIOL_MAX_RETRIES || 2)
  });
  const reviewer = process.env.OIOL_REVIEW_PROVIDER ? createProvider({
    provider: process.env.OIOL_REVIEW_PROVIDER,
    model: process.env.OIOL_REVIEW_MODEL || process.env.OIOL_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OIOL_REVIEW_BASE_URL || process.env.OIOL_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.OIOL_REVIEW_API_KEY || process.env.OIOL_API_KEY,
    timeoutMs: Number(process.env.OIOL_REVIEW_TIMEOUT_MS || process.env.OIOL_TIMEOUT_MS || 60000),
    maxRetries: Number(process.env.OIOL_MAX_RETRIES || 2)
  }) : provider;
  const planner = new HybridPlanner({ provider, reviewer, maxRepairRounds: Number(options.repairs ?? 2) });
  const plan = await planner.createPlan(project);
  const evaluation = evaluatePlan(plan, project);
  const schemaValidation = await validatePlanSchema(plan);
  plan.validation = {
    ...evaluation.validation,
    valid: evaluation.validation.valid && schemaValidation.valid,
    errors: [...evaluation.validation.errors, ...schemaValidation.errors.map(error => 'Schema: ' + error)],
    schemaValidation
  };
  plan.evaluation = { ...evaluation, validation: plan.validation, schemaValidation };
  if (!schemaValidation.valid) plan.status = 'blocked';
  plan.taskInterfaces = deriveTaskInterfaces(plan);
  plan.traceability = buildTraceability(plan);
  const validation = plan.validation;
  const format = options.format || (options.out?.toLowerCase().endsWith('.md') ? 'md' : 'json');
  if (!['json', 'md'].includes(format)) throw new Error('--format must be json or md');
  await writeOutput(format === 'md' ? renderPlanMarkdown(plan) : JSON.stringify(plan, null, 2), options.out);
  if (plan.status === 'blocked' || !validation?.valid) process.exitCode = 2;
}
main().catch(error => {
  console.error('OIOL error: ' + error.message);
  process.exitCode = 1;
});
