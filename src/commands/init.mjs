import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CONFIG_FILE, DEFAULTS, PROVIDER_DEFAULTS } from '../config.mjs';

const PROVIDERS = ['openai-compatible', 'anthropic', 'gemini', 'ollama'];

function printHelp() {
  console.log(`Usage: oiol init [options]

Create oiol.config.json and .env template interactively or via flags.

Options:
  --yes, -y           Accept all defaults, non-interactive
  --force, -f         Overwrite existing files without prompting
  --profile <name>    Profile name to create/update (default: "default")
  --provider <name>   Provider: openai-compatible | anthropic | gemini | ollama
  --model <name>      Model name
  --base-url <url>    Provider base URL
  --api-key-env <name>  Environment variable name for API key (default: OIOL_API_KEY)
  --review-provider <name>  Reviewer provider
  --review-model <name>     Reviewer model
  --out <path>        Output config file path (default: ./oiol.config.json)
  --env-out <path>    Output .env template path (default: ./.env)
  --help, -h          Show this help
`);
}

async function prompt(rl, question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  return answer || defaultValue;
}

async function initCommand(args) {
  const flags = {
    yes: false,
    force: false,
    profile: 'default',
    provider: undefined,
    model: undefined,
    baseUrl: undefined,
    apiKeyEnv: undefined,
    reviewProvider: undefined,
    reviewModel: undefined,
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
    if (arg === '--out') { flags.out = args[++i]; continue; }
    if (arg === '--env-out') { flags.envOut = args[++i]; continue; }
    console.error('Unknown option:', arg);
    return 1;
  }

  const configPath = path.resolve(flags.out);
  const envPath = path.resolve(flags.envOut);

  // Check existing files
  let existingConfig = null;
  try {
    existingConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {}

  if (existingConfig && !flags.force && !flags.yes) {
    const rl = createInterface({ input: stdin, output: stdout });
    const ans = await rl.question(`Config file "${configPath}" exists. Overwrite? [y/N]: `);
    rl.close();
    if (!/^y/i.test(ans)) { console.log('Aborted.'); return 0; }
  }

  let profileConfig = { provider: DEFAULTS.provider, model: DEFAULTS.model, apiKeyEnv: DEFAULTS.apiKeyEnv };

  if (!flags.yes) {
    const rl = createInterface({ input: stdin, output: stdout });
    console.log('--- OIOL Configuration ---');
    profileConfig.provider = await prompt(rl, 'Provider', flags.provider || (existingConfig?.profiles?.[flags.profile]?.provider) || DEFAULTS.provider);
    if (!PROVIDERS.includes(profileConfig.provider)) {
      console.error('Invalid provider:', profileConfig.provider);
      rl.close();
      return 1;
    }
    const providerDefaults = PROVIDER_DEFAULTS[profileConfig.provider] || {};
    profileConfig.model = await prompt(rl, 'Model', flags.model || (existingConfig?.profiles?.[flags.profile]?.model) || DEFAULTS.model);
    profileConfig.baseUrl = await prompt(rl, 'Base URL', flags.baseUrl || (existingConfig?.profiles?.[flags.profile]?.baseUrl) || providerDefaults.baseUrl || DEFAULTS.baseUrl);
    profileConfig.apiKeyEnv = await prompt(rl, 'API key env var name', flags.apiKeyEnv || (existingConfig?.profiles?.[flags.profile]?.apiKeyEnv) || DEFAULTS.apiKeyEnv);
    const timeout = await prompt(rl, 'Timeout (ms)', String((existingConfig?.profiles?.[flags.profile]?.timeoutMs) || DEFAULTS.timeoutMs));
    profileConfig.timeoutMs = parseInt(timeout, 10);
    const retries = await prompt(rl, 'Max retries (0-5)', String((existingConfig?.profiles?.[flags.profile]?.maxRetries) || DEFAULTS.maxRetries));
    profileConfig.maxRetries = parseInt(retries, 10);

    const wantsReviewer = await prompt(rl, 'Configure independent reviewer? [y/N]', 'N');
    if (/^y/i.test(wantsReviewer)) {
      profileConfig.reviewer = {};
      profileConfig.reviewer.provider = await prompt(rl, 'Reviewer provider', flags.reviewProvider || (existingConfig?.profiles?.[flags.profile]?.reviewer?.provider) || profileConfig.provider);
      if (!PROVIDERS.includes(profileConfig.reviewer.provider)) {
        console.error('Invalid reviewer provider:', profileConfig.reviewer.provider);
        rl.close();
        return 1;
      }
      const rDefaults = PROVIDER_DEFAULTS[profileConfig.reviewer.provider] || {};
      profileConfig.reviewer.model = await prompt(rl, 'Reviewer model', flags.reviewModel || (existingConfig?.profiles?.[flags.profile]?.reviewer?.model) || '');
      profileConfig.reviewer.baseUrl = await prompt(rl, 'Reviewer base URL', (existingConfig?.profiles?.[flags.profile]?.reviewer?.baseUrl) || rDefaults.baseUrl || '');
      profileConfig.reviewer.apiKeyEnv = await prompt(rl, 'Reviewer API key env var', (existingConfig?.profiles?.[flags.profile]?.reviewer?.apiKeyEnv) || '');
      const rTimeout = await prompt(rl, 'Reviewer timeout (ms)', String((existingConfig?.profiles?.[flags.profile]?.reviewer?.timeoutMs) || 60000));
      profileConfig.reviewer.timeoutMs = parseInt(rTimeout, 10);
    }
    rl.close();
  } else {
    // Non-interactive: use flags or defaults
    profileConfig.provider = flags.provider || DEFAULTS.provider;
    if (!PROVIDERS.includes(profileConfig.provider)) { console.error('Invalid provider:', profileConfig.provider); return 1; }
    const providerDefaults = PROVIDER_DEFAULTS[profileConfig.provider] || {};
    profileConfig.model = flags.model || DEFAULTS.model;
    profileConfig.baseUrl = flags.baseUrl || providerDefaults.baseUrl || DEFAULTS.baseUrl;
    profileConfig.apiKeyEnv = flags.apiKeyEnv || DEFAULTS.apiKeyEnv;
    profileConfig.timeoutMs = DEFAULTS.timeoutMs;
    profileConfig.maxRetries = DEFAULTS.maxRetries;
    if (flags.reviewProvider && flags.reviewModel) {
      if (!PROVIDERS.includes(flags.reviewProvider)) { console.error('Invalid reviewer provider:', flags.reviewProvider); return 1; }
      profileConfig.reviewer = {
        provider: flags.reviewProvider,
        model: flags.reviewModel,
        baseUrl: PROVIDER_DEFAULTS[flags.reviewProvider]?.baseUrl || '',
        apiKeyEnv: '',
        timeoutMs: 60000
      };
    }
  }

  // Build config object
  const config = existingConfig || { version: 1, profiles: {} };
  config.version = 1;
  config.defaultProfile = config.defaultProfile || flags.profile;
  config.profiles[flags.profile] = profileConfig;

  // Write config
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`Config written to ${configPath}`);

  // Write .env template
  let envContent = `# OIOL Configuration
# Generated by 'oiol init' on ${new Date().toISOString()}

# Planning model
OIOL_PROVIDER=${profileConfig.provider}
OIOL_MODEL=${profileConfig.model}
OIOL_BASE_URL=${profileConfig.baseUrl}
OIOL_API_KEY=  # Set this in your environment, do not commit
OIOL_TIMEOUT_MS=${profileConfig.timeoutMs}
OIOL_MAX_RETRIES=${profileConfig.maxRetries}

`;
  if (profileConfig.reviewer) {
    envContent += `# Independent reviewer (optional)
OIOL_REVIEW_PROVIDER=${profileConfig.reviewer.provider}
OIOL_REVIEW_MODEL=${profileConfig.reviewer.model}
OIOL_REVIEW_BASE_URL=${profileConfig.reviewer.baseUrl}
OIOL_REVIEW_API_KEY=  # Set this in your environment
OIOL_REVIEW_TIMEOUT_MS=${profileConfig.reviewer.timeoutMs}

`;
  }
  envContent += `# OpenCode baseline (optional)
# OIOL_OPENCODE_URL=http://127.0.0.1:4096
# OIOL_OPENCODE_USERNAME=opencode
# OIOL_OPENCODE_PASSWORD=
# OIOL_OPENCODE_AGENT=plan
# OIOL_OPENCODE_MODEL=
# OIOL_OPENCODE_TIMEOUT_MS=600000

# Benchmark safeguards (optional)
# OIOL_BENCHMARK_ALLOW_LIVE=
# OIOL_BENCHMARK_ALLOW_EXTERNAL_SOURCE=
# OIOL_BENCHMARK_COMPARISON_KEY=
# OIOL_BENCHMARK_BUDGET_KEY=
`;

  if (!flags.force) {
    try { await fs.access(envPath); const rl = createInterface({ input: stdin, output: stdout }); const ans = await rl.question(`.env template "${envPath}" exists. Overwrite? [y/N]: `); rl.close(); if (!/^y/i.test(ans)) { console.log('Skipped .env template.'); return 0; } } catch {}
  }
  await fs.writeFile(envPath, envContent);
  console.log(`.env template written to ${envPath}`);
  console.log('\nNext steps:');
  console.log('  1. Set your API key: export ' + profileConfig.apiKeyEnv + '="your-key"');
  console.log('  2. Run: oiol doctor');
  console.log('  3. Generate a plan: oiol plan --mode greenfield --request "Your request"');
  return 0;
}

export { initCommand };
