#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { loadConfig, applyConfigToEnv, resolveProfile } from './config.mjs';
import { initCommand } from './commands/init.mjs';
import { doctorCommand } from './commands/doctor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = resolve(__dirname, 'cli.mjs');

const SUBCOMMANDS = new Set(['init', 'doctor', 'plan', 'validate']);

function stripGlobalFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' || arg === '--profile') {
      i++; // skip value
    } else {
      out.push(arg);
    }
  }
  return out;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    printHelp();
    return 0;
  }
  const sub = rawArgs[0];
  const subArgs = rawArgs.slice(1);

  // Load config early to apply env for subcommands that need it
  let config;
  let profileName;
  if (sub === 'init') {
    // init handles its own config writing
    return initCommand(subArgs);
  }
  if (sub === 'doctor') {
    config = await loadConfig();
    profileName = resolveProfile(config, process.env.OIOL_PROFILE);
    applyConfigToEnv(config, profileName);
    return doctorCommand(subArgs);
  }

  // For plan/validate and legacy/unknown: apply config then delegate to cli.mjs
  config = await loadConfig();
  profileName = resolveProfile(config, process.env.OIOL_PROFILE);
  applyConfigToEnv(config, profileName);

  if (SUBCOMMANDS.has(sub)) {
    const delegatedArgs = stripGlobalFlags(subArgs);
    const result = spawnSync(process.execPath, [cliPath, sub, ...delegatedArgs], {
      stdio: 'inherit',
      env: process.env
    });
    if (result.signal) process.kill(process.pid, result.signal);
    return result.status ?? 1;
  }

  // Unknown/legacy invocation: delegate entire argv to cli.mjs
  const legacyArgs = stripGlobalFlags(rawArgs);
  const result = spawnSync(process.execPath, [cliPath, ...legacyArgs], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.signal) process.kill(process.pid, result.signal);
  return result.status ?? 1;
}

function printHelp() {
  console.log(`Usage: oiol <command> [options]

Commands:
  init           Create oiol.config.json and .env template
  doctor         Diagnose environment, config, and provider connectivity
  plan           Generate an engineering plan (delegates to cli.mjs)
  validate       Validate an existing plan JSON (delegates to cli.mjs)

Global options:
  --config <path>    Path to config file (default: ./oiol.config.json)
  --profile <name>   Config profile to use

Run 'oiol <command> --help' for command-specific options.
`);
}

main().then(code => process.exit(code)).catch(err => {
  console.error('OIOL error:', err.message);
  process.exit(1);
});
