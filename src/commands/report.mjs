import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluatePlan } from '../core/evaluate.mjs';
import { validatePlanSchema } from '../core/schema-validator.mjs';
import { renderPlanMarkdown } from '../core/report.mjs';
import { renderPlanHtml } from '../core/report-html.mjs';

const HELP = [
  'OIOL review report',
  '',
  'Usage:',
  '  oiol report <plan.json> [options]',
  '',
  'Options:',
  '  --format html|md|json   Output format (default: html, or inferred from --out)',
  '  --out <path>            Write to a file instead of stdout',
  '  --title <text>          Override the HTML document title',
  '  -h, --help              Show this help',
  '',
  'Runs deterministic validation and rendering only. No provider calls are made.',
  'Exit code 2 means the plan is invalid; the report is still produced so findings can be reviewed.'
].join('\n');

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--format') options.format = argv[++index];
    else if (value === '--out') options.out = argv[++index];
    else if (value === '--title') options.title = argv[++index];
    else if (value.startsWith('--format=')) options.format = value.slice('--format='.length);
    else if (value.startsWith('--out=')) options.out = value.slice('--out='.length);
    else if (value.startsWith('--title=')) options.title = value.slice('--title='.length);
    else if (value.startsWith('--')) throw new Error('Unknown option: ' + value);
    else options._.push(value);
  }
  return options;
}

function inferFormat(out, fallback) {
  if (!out) return fallback;
  const extension = path.extname(out).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.md') return 'md';
  if (extension === '.json') return 'json';
  return fallback;
}

function normalizePlan(source) {
  return source && typeof source === 'object' && !Array.isArray(source) ? source : {};
}

export async function reportCommand(args) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error('OIOL error: ' + error.message);
    return 1;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  const file = options._[0];
  if (!file) {
    console.error('Usage: oiol report <plan.json> [--format html|md|json] [--out <path>] [--title <text>]');
    return 1;
  }

  let source;
  try {
    source = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
  } catch (error) {
    console.error('OIOL error: ' + error.message);
    return 1;
  }

  const plan = normalizePlan(source);
  const project = plan.project && typeof plan.project === 'object' && !Array.isArray(plan.project) ? plan.project : {};
  const evaluation = evaluatePlan(plan, project);
  const schemaValidation = await validatePlanSchema(plan);
  const validation = {
    ...evaluation.validation,
    valid: evaluation.validation.valid && schemaValidation.valid,
    errors: [...evaluation.validation.errors, ...schemaValidation.errors.map(function (error) { return 'Schema: ' + error; })],
    schemaValidation
  };
  plan.validation = validation;
  plan.evaluation = { ...evaluation, validation, schemaValidation };
  if (!validation.valid) plan.status = 'blocked';

  const format = options.format || inferFormat(options.out, 'html');
  if (['html', 'md', 'json'].indexOf(format) === -1) {
    console.error('OIOL error: --format must be html, md, or json');
    return 1;
  }

  let output;
  if (format === 'md') output = renderPlanMarkdown(plan);
  else if (format === 'json') output = JSON.stringify(plan, null, 2);
  else output = renderPlanHtml(plan, { title: options.title });

  const terminated = output.endsWith('\n') ? output : output + '\n';
  if (options.out) {
    try {
      const destination = path.resolve(options.out);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, terminated, 'utf8');
      console.log('Report written to ' + destination);
    } catch (error) {
      console.error('OIOL error: ' + error.message);
      return 1;
    }
  } else {
    process.stdout.write(terminated);
  }
  return validation.valid ? 0 : 2;
}
