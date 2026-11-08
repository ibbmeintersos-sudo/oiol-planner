#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONTRACT_VERSION, SCHEMA_VERSION } from '../src/contracts/types.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function checkRelease(root = ROOT) {
  const errors = [];
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const changelog = await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  const currentSchema = JSON.parse(await fs.readFile(path.join(root, 'schemas/plan.schema.json'), 'utf8'));
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'schemas/plan-' + SCHEMA_VERSION + '.schema.json'), 'utf8'));
  const oldSnapshotPath = path.join(root, 'schemas/plan-1.0.0.schema.json');

  if (!/^\d+\.\d+\.\d+$/.test(packageJson.version || '')) errors.push('package.json version must be a stable x.y.z version');
  if (lock.version !== packageJson.version) errors.push('package-lock.json version does not match package.json');
  if (!/^## \[Unreleased\]/m.test(changelog)) errors.push('CHANGELOG.md must contain an [Unreleased] section');
  const stableVersions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map(match => match[1]);
  if (stableVersions[0] !== packageJson.version) {
    errors.push('Newest stable CHANGELOG.md entry (' + (stableVersions[0] || 'missing') + ') must match package version ' + packageJson.version);
  }
  if (currentSchema.$id !== 'urn:oiol:schemas:plan:' + SCHEMA_VERSION) errors.push('Current schema $id does not match SCHEMA_VERSION');
  if (currentSchema.properties?.schemaVersion?.const !== SCHEMA_VERSION) errors.push('Current schema schemaVersion does not match SCHEMA_VERSION');
  if (currentSchema.properties?.contractVersion?.const !== CONTRACT_VERSION) errors.push('Current schema contractVersion does not match CONTRACT_VERSION');
  if (JSON.stringify(currentSchema) !== JSON.stringify(snapshot)) errors.push('Current plan.schema.json differs from its immutable versioned snapshot');
  try {
    const oldSnapshot = JSON.parse(await fs.readFile(oldSnapshotPath, 'utf8'));
    if (oldSnapshot.properties?.schemaVersion?.const !== '1.0.0') errors.push('Frozen 1.0.0 schema snapshot has an unexpected version');
  } catch {
    errors.push('Frozen schemas/plan-1.0.0.schema.json snapshot is missing or invalid');
  }
  return errors;
}

export async function main() {
  const errors = await checkRelease();
  if (errors.length) {
    console.error(JSON.stringify({ releaseReady: false, errors }, null, 2));
    return 1;
  }
  console.log(JSON.stringify({ releaseReady: true, packageVersion: '0.5.0', schemaVersion: SCHEMA_VERSION, contractVersion: CONTRACT_VERSION }, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Release check error: ' + error.message); process.exitCode = 1; }
}
