import { loadConfig, resolveProfile, getProfileConfig, DEFAULTS } from '../config.mjs';

function printHelp() {
  console.log(`Usage: oiol doctor [options]

Check the local OIOL setup without calling a planning model.

Options:
  --json          Output machine-readable JSON
  --network       Probe the configured provider endpoint (off by default)
  --timeout <ms>  Network probe timeout (default: 5000)
  --help, -h      Show this help
`);
}

function check(id, status, message, details) {
  return { id, status, message, ...(details ? { details } : {}) };
}

async function probeNetwork(profile, apiKey, timeoutMs) {
  const base = (profile.baseUrl || '').replace(/\/$/, '');
  if (!base) return check('network', 'warn', 'No base URL configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  let url;
  if (profile.provider === 'ollama') {
    url = base + '/api/tags';
  } else if (profile.provider === 'anthropic') {
    url = base + '/v1/models';
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (profile.provider === 'gemini') {
    url = base + '/models' + (apiKey ? '?key=' + encodeURIComponent(apiKey) : '');
  } else {
    url = base + '/models';
    if (apiKey) headers.authorization = 'Bearer ' + apiKey;
  }
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (response.ok) return check('network', 'pass', 'Provider endpoint reachable (HTTP ' + response.status + ').');
    if (response.status === 401 || response.status === 403) {
      return check('network', 'warn', 'Endpoint reachable but credentials were rejected (HTTP ' + response.status + ').');
    }
    return check('network', 'warn', 'Endpoint returned HTTP ' + response.status + '.');
  } catch (error) {
    if (error.name === 'AbortError') return check('network', 'fail', 'Endpoint probe timed out after ' + timeoutMs + 'ms.');
    return check('network', 'warn', 'Endpoint probe failed: ' + error.message);
  } finally {
    clearTimeout(timer);
  }
}

async function doctorCommand(args) {
  const flags = { json: false, network: false, timeout: 5000 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { printHelp(); return 0; }
    if (arg === '--json') { flags.json = true; continue; }
    if (arg === '--network') { flags.network = true; continue; }
    if (arg === '--timeout') { flags.timeout = Number(args[++i]); continue; }
    console.error('Unknown option: ' + arg);
    return 1;
  }

  try { process.loadEnvFile?.(); } catch { /* .env is optional */ }

  const checks = [];

  const major = Number(process.versions.node.split('.')[0]);
  checks.push(major >= 22
    ? check('node', 'pass', 'Node.js ' + process.version + ' satisfies >=22.')
    : check('node', 'fail', 'Node.js ' + process.version + ' is too old; >=22 is required.'));

  let config = null;
  try {
    config = await loadConfig();
    checks.push(config
      ? check('config', 'pass', 'Loaded oiol.config.json.')
      : check('config', 'warn', 'No oiol.config.json found; environment variables and defaults will be used.'));
  } catch (error) {
    checks.push(check('config', 'fail', error.message));
  }

  let profile;
  if (config) {
    const name = resolveProfile(config, process.env.OIOL_PROFILE);
    profile = getProfileConfig(config, name);
    checks.push(profile
      ? check('profile', 'pass', 'Using profile "' + name + '".')
      : check('profile', 'fail', 'Profile "' + name + '" was not found.'));
  } else {
    profile = {
      provider: process.env.OIOL_PROVIDER || DEFAULTS.provider,
      model: process.env.OIOL_MODEL || DEFAULTS.model,
      baseUrl: process.env.OIOL_BASE_URL || DEFAULTS.baseUrl,
      apiKeyEnv: DEFAULTS.apiKeyEnv
    };
    checks.push(check('profile', 'warn', 'Using environment/default profile: ' + profile.provider + ' / ' + profile.model + '.'));
  }

  if (profile) {
    const apiKeyEnv = profile.apiKeyEnv || 'OIOL_API_KEY';
    const hasKey = typeof process.env[apiKeyEnv] === 'string' && process.env[apiKeyEnv].length > 0;
    if (profile.provider === 'ollama') {
      checks.push(check('apiKey', 'pass', 'Ollama does not require an API key.'));
    } else if (hasKey) {
      checks.push(check('apiKey', 'pass', 'API key environment variable ' + apiKeyEnv + ' is set.'));
    } else {
      checks.push(check('apiKey', 'warn', 'API key environment variable ' + apiKeyEnv + ' is not set.'));
    }

    if (profile.reviewer) {
      const same = profile.reviewer.provider === profile.provider &&
        profile.reviewer.model === profile.model &&
        (profile.reviewer.baseUrl || '') === (profile.baseUrl || '');
      checks.push(same
        ? check('reviewer', 'warn', 'Reviewer uses the same configuration as the planner; a review gate cannot pass.')
        : check('reviewer', 'pass', 'Reviewer configuration differs from the planner.'));
    }

    if (flags.network) {
      const keyName = profile.apiKeyEnv || 'OIOL_API_KEY';
      checks.push(await probeNetwork(profile, process.env[keyName], flags.timeout));
    }
  }

  try {
    await import('@xberg-io/tree-sitter-language-pack-wasm');
    checks.push(check('dependency', 'pass', 'Tree-sitter language pack is available.'));
  } catch {
    checks.push(check('dependency', 'warn', 'Tree-sitter language pack is not installed; scanning may fall back.'));
  }

  const ok = !checks.some(item => item.status === 'fail');
  if (flags.json) {
    console.log(JSON.stringify({ ok, checks }, null, 2));
  } else {
    console.log('=== OIOL Doctor ===');
    for (const item of checks) {
      const icon = item.status === 'pass' ? '[ok]' : item.status === 'warn' ? '[warn]' : '[fail]';
      console.log(icon + ' ' + item.id + ': ' + item.message);
    }
    console.log('\nOverall: ' + (ok ? 'ready' : 'blocked by failed checks'));
  }
  return ok ? 0 : 1;
}

export { doctorCommand };
