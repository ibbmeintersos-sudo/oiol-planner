import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveProfile, getProfileConfig } from '../config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
  console.log(`Usage: oiol doctor [options]

Diagnose environment, config, and provider connectivity.

Options:
  --json        Output JSON instead of human-readable format
  --network     Probe provider endpoint connectivity (requires API key)
  --timeout <ms>  Network probe timeout (default: 5000)
  --help, -h    Show this help
`);
}

async function checkNodeVersion() {
  const [major] = process.version.slice(1).split('.').map(Number);
  return { ok: major >= 22, version: process.version, required: '>=22' };
}

async function checkConfig(configPath) {
  try {
    const config = await loadConfig(configPath);
    if (!config) return { ok: false, error: 'Config file not found', path: configPath };
    return { ok: true, config, path: configPath };
  } catch (err) {
    return { ok: false, error: err.message, path: configPath };
  }
}

async function checkProfile(config, profileName) {
  const resolved = resolveProfile(config, profileName);
  const profile = getProfileConfig(config, resolved);
  if (!profile) return { ok: false, error: `Profile "${resolved}" not found`, profile: resolved };
  return { ok: true, profile: resolved, config: profile };
}

function checkApiKeyEnv(profile) {
  const key = profile.apiKeyEnv;
  const present = Object.hasOwn(process.env, key) && process.env[key]?.length > 0;
  return { ok: present, envVar: key, configured: present };
}

async function checkDependencyResolvability() {
  try {
    await import('@xberg-io/tree-sitter-language-pack-wasm');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function probeNetwork(profile, timeoutMs) {
  if (!profile.baseUrl) return { ok: false, error: 'No baseUrl configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = profile.baseUrl.replace(/\/$/, '') + '/models';
    const response = await fetch(url, { signal: controller.signal, method: 'GET' });
    clearTimeout(timer);
    return { ok: response.ok || response.status === 401 || response.status === 403, status: response.status };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { ok: false, error: 'Timeout' };
    return { ok: false, error: err.message };
  }
}

async function doctorCommand(args) {
  const flags = { json: false, network: false, timeout: 5000, configPath: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { printHelp(); return 0; }
    if (arg === '--json') { flags.json = true; continue; }
    if (arg === '--network') { flags.network = true; continue; }
    if (arg === '--timeout') { flags.timeout = parseInt(args[++i], 10); continue; }
    if (arg === '--config') { flags.configPath = args[++i]; continue; }
    console.error('Unknown option:', arg);
    return 1;
  }

  const results = {
    node: await checkNodeVersion(),
    config: await checkConfig(flags.configPath),
    dependency: await checkDependencyResolvability(),
    profile: null,
    apiKey: null,
    network: null
  };

  if (results.config.ok) {
    results.profile = await checkProfile(results.config.config, process.env.OIOL_PROFILE);
    if (results.profile.ok) {
      results.apiKey = checkApiKeyEnv(results.profile.config);
      if (flags.network) {
        results.network = await probeNetwork(results.profile.config, flags.timeout);
      }
    }
  }

  const allOk = results.node.ok && results.config.ok && results.profile?.ok && results.dependency.ok && results.apiKey.ok;

  if (flags.json) {
    console.log(JSON.stringify({ ok: allOk, checks: results }, null, 2));
  } else {
    console.log('=== OIOL Doctor ===');
    console.log(`Node.js: ${results.node.ok ? '✓' : '✗'} ${results.node.version} (required ${results.node.required})`);
    console.log(`Config: ${results.config.ok ? '✓' : '✗'} ${results.config.path}${results.config.error ? ' - ' + results.config.error : ''}`);
    if (results.profile) {
      console.log(`Profile: ${results.profile.ok ? '✓' : '✗'} ${results.profile.profile}${results.profile.error ? ' - ' + results.profile.error : ''}`);
    }
    console.log(`Dependency: ${results.dependency.ok ? '✓' : '✗'}${results.dependency.error ? ' - ' + results.dependency.error : ''}`);
    if (results.apiKey) {
      console.log(`API Key (${results.apiKey.envVar}): ${results.apiKey.ok ? '✓ configured' : '✗ not set'}`);
    }
    if (flags.network && results.network) {
      console.log(`Network probe: ${results.network.ok ? '✓' : '✗'} ${results.network.status ? 'HTTP ' + results.network.status : results.network.error}`);
    }
    console.log(`\nOverall: ${allOk ? '✓ All checks passed' : '✗ Some checks failed'}`);
  }

  return allOk ? 0 : 1;
}

export { doctorCommand };
