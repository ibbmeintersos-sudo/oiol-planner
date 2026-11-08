import fs from 'node:fs/promises';
import path from 'node:path';
import { renderPlanMarkdown } from '../src/core/report.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/oiol-pr-summary.mjs --plan FILE [options]

Options:
  --plan FILE          Plan JSON produced by the OIOL CLI (required)
  --report-out FILE    Write the full Markdown report
  --comment-out FILE   Write the short pull-request comment
  --summary-out FILE   Append the short summary (for GITHUB_STEP_SUMMARY)
  --run-url URL        Link to the workflow run
  --artifact-name NAME Artifact name shown in the summary
  --help               Show this help`);
}

function countAcceptanceCriteria(plan) {
  if (!Array.isArray(plan?.tasks)) return 0;
  return plan.tasks.reduce((total, task) => total + (Array.isArray(task?.acceptanceCriteria) ? task.acceptanceCriteria.length : 0), 0);
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function safeStatus(value) {
  const status = typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_-]/g, '') : '';
  return status || 'unknown';
}

function buildComment(plan, options) {
  const status = safeStatus(plan?.status);
  const validation = plan?.validation;
  const valid = validation && typeof validation.valid === 'boolean' ? validation.valid : null;
  const requirements = safeCount(Array.isArray(plan?.requirements) ? plan.requirements.length : 0);
  const tasks = safeCount(Array.isArray(plan?.tasks) ? plan.tasks.length : 0);
  const criteria = safeCount(countAcceptanceCriteria(plan));
  const risks = safeCount(Array.isArray(plan?.risks) ? plan.risks.length : 0);
  const questions = safeCount(Array.isArray(plan?.clarifications) ? plan.clarifications.length : 0);
  const overlaps = safeCount(plan?.evaluation?.metrics?.writeScopeOverlapPairs ?? 0);

  const lines = [
    '## OIOL planning review',
    '',
    `- **Status:** \`${status}\``,
    `- **Contract validation:** ${valid === null ? 'not available' : valid ? 'valid' : 'invalid'}`,
    `- **Requirements:** ${requirements}`,
    `- **Tasks:** ${tasks}`,
    `- **Acceptance criteria:** ${criteria}`,
    `- **Risks:** ${risks}`,
    `- **Clarifications:** ${questions}`,
    `- **Write-scope overlap pairs:** ${overlaps}`
  ];

  if (status === 'blocked' || valid === false) {
    lines.push('', '> This plan is blocked or invalid. Read the report artifact before acting on it.');
  }

  if (options.runUrl && /^https?:\/\//.test(options.runUrl)) {
    lines.push('', `[Open the workflow run](${options.runUrl})`);
  }
  lines.push('', `Plan and full Markdown report are attached as the \`${options.artifactName || 'oiol-plan'}\` artifact.`);
  lines.push('', '<sub>Planning-only review. OIOL did not execute project tasks, tests, or builds.</sub>');
  return `${lines.join('\n')}\n`;
}

async function writeFile(file, content) {
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  if (!options.plan) {
    printHelp();
    throw new Error('--plan is required');
  }

  const planPath = path.resolve(options.plan);
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error(`${planPath} does not contain a plan object`);

  const comment = buildComment(plan, {
    runUrl: options['run-url'],
    artifactName: options['artifact-name']
  });

  if (options['report-out']) await writeFile(options['report-out'], `${renderPlanMarkdown(plan).trimEnd()}\n`);
  if (options['comment-out']) await writeFile(options['comment-out'], comment);
  if (options['summary-out']) await fs.appendFile(path.resolve(options['summary-out']), comment, 'utf8');

  console.log(`OIOL summary written for status ${safeStatus(plan.status)}`);
  return 0;
}

main().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(`OIOL summary error: ${error.message}`);
  process.exitCode = 1;
});
