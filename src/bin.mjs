#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig, applyConfigToEnv, resolveProfile, CONFIG_FILE } from './config.mjs';
import { initCommand } from './commands/init.mjs';
import { doctorCommand } from './commands/doctor.mjs';
import { reportCommand } from './commands/report.mjs';

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), 'cli.mjs');

function printHelp() {
  console.log(`Usage: oiol <command> [options]

Commands:
  init       Create oiol.config.json and a .env template
  doctor     Check Node.js, config, API key, and dependencies
  plan       Generate an engineering plan (planning only)
  report     Render an HTML, Markdown, or JSON review report
  validate   Validate an existing plan JSON

Global options:
  --config <path>    Config file path (default: ./oiol.config.json or OIOL_CONFIG)
  --profile <name>   Profile name from the config file
  -h, --help         Show this help

Examples:
  oiol init
  oiol doctor
  oiol plan --mode greenfield --name "Inventory Service" --request "..." --out plan.json
  oiol validate plan.json --format md
  oiol report plan.json --out plan.html

The legacy form "oiol --validate plan.json" and "node src/cli.mjs ..." remain supported.
`);
}

function parseGlobalFlags(args) {
  const rest = [];
  let configPath;
  let profileName;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config') { configPath = args[++i]; continue; }
    if (arg.startsWith('--config=')) { configPath = arg.slice('--config='.length); continue; }
    if (arg === '--profile') { profileName = args[++i]; continue; }
    if (arg.startsWith('--profile=')) { profileName = arg.slice('--profile='.length); continue; }
    rest.push(arg);
  }
  return { rest, configPath, profileName };
}

async function prepareEnv(configPath, profileName) {
  try { process.loadEnvFile?.(); } catch { /* .env is optional */ }
  const explicitConfig = Boolean(configPath || process.env.OIOL_CONFIG);
  const config = await loadConfig(configPath || process.env.OIOL_CONFIG || CONFIG_FILE);
  if (!config) {
    if (explicitConfig) throw new Error('Config file not found: ' + (configPath || process.env.OIOL_CONFIG));
    if (profileName) throw new Error('Profile "' + profileName + '" requested but ' + CONFIG_FILE + ' was not found.');
    return;
  }
  const resolved = resolveProfile(config, profileName);
  if (!config.profiles || !config.profiles[resolved]) {
    const available = Object.keys(config.profiles || {}).join(', ') || 'none';
    throw new Error('Unknown profile "' + resolved + '". Available profiles: ' + available);
  }
  applyConfigToEnv(config, resolved);
}

function delegate(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: 'inherit', env: process.env });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        resolvePromise(1);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

async function main() {
  const { rest, configPath, profileName } = parseGlobalFlags(process.argv.slice(2));
  const command = rest[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return 0;
  }

  if (command === 'init') return initCommand(rest.slice(1), { profileName });

  if (command === 'doctor') {
    await prepareEnv(configPath, profileName);
    return doctorCommand(rest.slice(1));
  }

  if (command === 'report') return reportCommand(rest.slice(1));

  if (command === 'plan') {
    await prepareEnv(configPath, profileName);
    return delegate(rest.slice(1));
  }

  if (command === 'validate') {
    const file = rest[1];
    if (!file || file.startsWith('-')) {
      console.error('Usage: oiol validate <plan.json> [--format json|md] [--out <path>]');
      return 1;
    }
    return delegate(['--validate', file, ...rest.slice(2)]);
  }

  // Backward compatibility: flags and positional arguments are passed to cli.mjs unchanged.
  // Validation does not need provider configuration, so do not fail on a missing or invalid profile.
  if (!rest.includes('--validate')) await prepareEnv(configPath, profileName);
  return delegate(rest);
}

main()
  .then(code => { process.exitCode = code; })
  .catch(error => {
    console.error('OIOL error: ' + error.message);
    process.exitCode = 1;
  });
