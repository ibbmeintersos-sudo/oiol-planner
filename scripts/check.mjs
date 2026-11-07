import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'scripts'];
const files = [];

async function collect(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(absolute);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(absolute);
  }
}

for (const root of roots) await collect(root);
files.sort();

if (files.length === 0) {
  console.error('No .mjs files found under src/ or scripts/.');
  process.exit(1);
}

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not check ${file}: ${result.error.message}`);
    failed = true;
  } else if (result.status !== 0) {
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Syntax check passed for ${files.length} JavaScript module(s).`);
