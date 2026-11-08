import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CONFIG_FILE, DEFAULTS, PROVIDER_DEFAULTS } from '../config.mjs';

const PROVIDERS = ['openai-compatible', 'anthropic', 'gemini', 'ollama'];
const SCHEMA_URL = 'https://raw.githubusercontent.com/ibbmeintersos-sudo/oiol-planner/main/schemas/oiol-config.schema.json';

function printHelp() {
  console.log(`Usage: oiol init [options]

Create oiol.config.json and a .env template. No secrets are written to the config file.

Options:
  --yes, -y                Accept defaults without prompting
  --force, -f              Overwrite existing files
  --provider <name>        openai-compatible | anthropic | gemini | ollama
  --model <name>           Model name
  --base-url <url>         Provider base URL
  --api-key-env <name>     Environment variable that holds the API key
  --review-provider <name> Reviewer provider
  --review-model <name>    Reviewer model
  --out <path>             Config output path (default: ./oiol.config.json)
  --env-out <path>         .env output path (default: ./.env)
  --help, -h               Show this help
`);
}

function ask(rl, label, fallback) {
  const suffix = fallback ? ' [' + fallback + ']' : '';
  return rl.question(label + suffix + ': ').then(answer => answer.trim() || fallback);
}

async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function initCommand(args, options = {}) {
  const flags = {
    yes: false,
    force: false,
    profile: options.profileName || 'default',
    provider: undefined,
    model: undefined,
    baseUrl: undefined,
    apiKeyEnv: undefined,
    reviewProvider: undefined,
    reviewModel: undefined,
    reviewBaseUrl: undefined,
    reviewApiKeyEnv: undefined,
    out: CONFIG_FILE,
    envOut: '.env'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { printHelp(); return 0; }
    if (arg === '--yes' || arg === '-y') { flags.yes = true; continue; }
    if (arg === '--force' || arg === '-f') { flags.force = true; continue; }
    if (arg === '--profile') { flags.profile = args[++i]; continue; }
    if (arg === '--provider') { flags.provider = args[++i]; continue; }
    if (arg === '--model') { flags.model = args[++i]; continue; }
    if (arg === '--base-url') { flags.baseUrl = args[++i]; continue; }
    if (arg === '--api-key-env') { flags.apiKeyEnv = args[++i]; continue; }
    if (arg === '--review-provider') { flags.reviewProvider = args[++i]; continue; }
    if (arg === '--review-model') { flags.reviewModel = args[++i]; continue; }
    if (arg === '--review-base-url') { flags.reviewBaseUrl = args[++i]; continue; }
    if (arg === '--review-api-key-env') { flags.reviewApiKeyEnv = args[++i]; continue; }
    if (arg === '--out') { flags.out = args[++i]; continue; }
    if (arg === '--env-out') { flags.envOut = args[++i]; continue; }
    console.error('Unknown option: ' + arg);
    return 1;
  }

  if (!flags.profile) { console.error('Profile name cannot be empty.'); return 1; }

  const configPath = path.resolve(flags.out);
  const envPath = path.resolve(flags.envOut);

  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch { /* no existing config */ }

  if (existing && !flags.force) {
    if (flags.yes || !stdin.isTTY) {
      console.error('Config file already exists: ' + configPath + '. Use --force to overwrite.');
      return 1;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question('Config file "' + configPath + '" exists. Overwrite? [y/N]: ');
    rl.close();
    if (!/^y/i.test(answer)) { console.log('Aborted.'); return 0; }
  }

  const profile = {};

  if (flags.yes || !stdin.isTTY) {
    profile.provider = flags.provider || existing?.profiles?.[flags.profile]?.provider || DEFAULTS.provider;
    if (!PROVIDERS.includes(profile.provider)) { console.error('Invalid provider: ' + profile.provider); return 1; }
    const providerDefaults = PROVIDER_DEFAULTS[profile.provider] || {};
    profile.model = flags.model || existing?.profiles?.[flags.profile]?.model || providerDefaults.model || DEFAULTS.model;
    profile.baseUrl = flags.baseUrl || existing?.profiles?.[flags.profile]?.baseUrl || providerDefaults.baseUrl || DEFAULTS.baseUrl;
    profile.apiKeyEnv = flags.apiKeyEnv || existing?.profiles?.[flags.profile]?.apiKeyEnv || DEFAULTS.apiKeyEnv;
    profile.timeoutMs = existing?.profiles?.[flags.profile]?.timeoutMs ?? DEFAULTS.timeoutMs;
    profile.maxRetries = existing?.profiles?.[flags.profile]?.maxRetries ?? DEFAULTS.maxRetries;
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log('--- OIOL configuration ---');
      console.log('Provider: ' + PROVIDERS.join(' | '));
      profile.provider = await ask(rl, 'Provider', flags.provider || existing?.profiles?.[flags.profile]?.provider || DEFAULTS.provider);
      if (!PROVIDERS.includes(profile.provider)) { console.error('Invalid provider: ' + profile.provider); return 1; }
      const providerDefaults = PROVIDER_DEFAULTS[profile.provider] || {};
      profile.model = await ask(rl, 'Model', flags.model || existing?.profiles?.[flags.profile]?.model || providerDefaults.model || DEFAULTS.model);
      profile.baseUrl = await ask(rl, 'Base URL', flags.baseUrl || existing?.profiles?.[flags.profile]?.baseUrl || providerDefaults.baseUrl || DEFAULTS.baseUrl);
      profile.apiKeyEnv = await ask(rl, 'API key environment variable', flags.apiKeyEnv || existing?.profiles?.[flags.profile]?.apiKeyEnv || DEFAULTS.apiKeyEnv);
      profile.timeoutMs = Number(await ask(rl, 'Timeout (ms)', String(existing?.profiles?.[flags.profile]?.timeoutMs ?? DEFAULTS.timeoutMs)));
      profile.maxRetries = Number(await ask(rl, 'Max retries (0-5)', String(existing?.profiles?.[flags.profile]?.maxRetries ?? DEFAULTS.maxRetries)));

      const reviewerAnswer = await ask(rl, 'Configure an independent reviewer? [y/N]', 'N');
      if (/^y/i.test(reviewerAnswer)) {
        profile.reviewer = {};
        profile.reviewer.provider = await ask(rl, 'Reviewer provider', flags.reviewProvider || existing?.profiles?.[flags.profile]?.reviewer?.provider || 'anthropic');
        if (!PROVIDERS.includes(profile.reviewer.provider)) { console.error('Invalid reviewer provider: ' + profile.reviewer.provider); return 1; }
        const reviewerDefaults = PROVIDER_DEFAULTS[profile.reviewer.provider] || {};
        profile.reviewer.model = await ask(rl, 'Reviewer model', flags.reviewModel || existing?.profiles?.[flags.profile]?.reviewer?.model || reviewerDefaults.model || '');
        profile.reviewer.baseUrl = await ask(rl, 'Reviewer base URL', flags.reviewBaseUrl || existing?.profiles?.[flags.profile]?.reviewer?.baseUrl || reviewerDefaults.baseUrl || '');
        profile.reviewer.apiKeyEnv = await ask(rl, 'Reviewer API key environment variable', flags.reviewApiKeyEnv || existing?.profiles?.[flags.profile]?.reviewer?.apiKeyEnv || 'OIOL_REVIEW_API_KEY');
        profile.reviewer.timeoutMs = Number(await ask(rl, 'Reviewer timeout (ms)', String(existing?.profiles?.[flags.profile]?.reviewer?.timeoutMs ?? 60000)));
      }
    } finally {
      rl.close();
    }
  }

  if (flags.reviewProvider || flags.reviewModel) {
    profile.reviewer = profile.reviewer || {};
    profile.reviewer.provider = flags.reviewProvider || profile.reviewer.provider || 'anthropic';
    if (!PROVIDERS.includes(profile.reviewer.provider)) { console.error('Invalid reviewer provider: ' + profile.reviewer.provider); return 1; }
    const reviewerDefaults = PROVIDER_DEFAULTS[profile.reviewer.provider] || {};
    profile.reviewer.model = flags.reviewModel || profile.reviewer.model || reviewerDefaults.model || '';
    if (!profile.reviewer.model) { console.error('Reviewer model is required when a reviewer is configured.'); return 1; }
    profile.reviewer.baseUrl = flags.reviewBaseUrl || profile.reviewer.baseUrl || reviewerDefaults.baseUrl || '';
    profile.reviewer.apiKeyEnv = flags.reviewApiKeyEnv || profile.reviewer.apiKeyEnv || 'OIOL_REVIEW_API_KEY';
    profile.reviewer.timeoutMs = profile.reviewer.timeoutMs ?? 60000;
  }

  if (Number.isInteger(profile.timeoutMs) && profile.timeoutMs < 1000) { console.error('Timeout must be at least 1000ms.'); return 1; }
  if (Number.isInteger(profile.maxRetries) && (profile.maxRetries < 0 || profile.maxRetries > 5)) { console.error('Max retries must be between 0 and 5.'); return 1; }

  const config = existing && existing.version === 1 ? existing : { version: 1, profiles: {} };
  config.$schema = SCHEMA_URL;
  config.version = 1;
  config.profiles = config.profiles && typeof config.profiles === 'object' ? config.profiles : {};
  config.profiles[flags.profile] = profile;
  if (!config.defaultProfile) config.defaultProfile = flags.profile;

  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log('Config written to ' + configPath);

  const envExists = await fileExists(envPath);
  if (envExists && !flags.force) {
    console.log('Keeping existing ' + envPath + ' (use --force to replace it).');
  } else {
    const keyName = profile.apiKeyEnv || 'OIOL_API_KEY';
    const lines = [
      '# Generated by oiol init. Do not commit this file.',
      '# Provider, model, and URL settings live in oiol.config.json.',
      '# Only secrets belong here.',
      keyName + '=',
      ''
    ];
    if (profile.reviewer) lines.push((profile.reviewer.apiKeyEnv || 'OIOL_REVIEW_API_KEY') + '=', '');
    await fs.writeFile(envPath, lines.join('\n'), 'utf8');
    console.log('.env template written to ' + envPath);
  }

  console.log('\nNext steps:');
  console.log('  1. Set ' + (profile.apiKeyEnv || 'OIOL_API_KEY') + ' in ' + envPath + ' or your environment.');
  console.log('  2. Run: oiol doctor');
  console.log('  3. Run: oiol plan --mode greenfield --request "Your request" --out plan.json');
  return 0;
}

export { initCommand };
