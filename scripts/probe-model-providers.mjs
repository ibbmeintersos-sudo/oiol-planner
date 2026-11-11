#!/usr/bin/env node
// Diagnostic: verify that each P12 reviewer slot can reach its configured provider.
// Never prints key material; only statuses, lengths and booleans are reported.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultEndpoints = {
  R1: 'https://integrate.api.nvidia.com/v1/chat/completions',
  R2: 'https://openrouter.ai/api/v1/chat/completions'
};
const defaultModels = { R1: 'meta/llama-3.3-70b-instruct', R2: 'nvidia/nemotron-3.5-super-vl:free' };

const value = (names, fallback = null) => {
  for (const name of names) {
    const current = process.env[name];
    if (current !== undefined && current !== '') return current;
  }
  return fallback;
};

function bearer(slot) {
  return value(['P12_API_KEY_' + slot, 'P12_API_KEY', 'OIOL_API_KEY'], '');
}

async function probeSlot(slot) {
  const endpoint = value(['P12_MODELS_URL_' + slot, 'P12_MODELS_URL'], defaultEndpoints[slot]);
  const model = value(['P12_MODEL_' + slot], defaultModels[slot]);
  const key = bearer(slot);
  const record = { slot, provider: new URL(endpoint).host, model, keyPresent: Boolean(key), keyLength: key.length };
  if (!key) { record.error = 'no api key configured for this slot'; return record; }
  const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  if (record.provider.includes('openrouter.ai')) {
    headers['http-referer'] = 'https://github.com/ibbmeintersos-sudo/oiol-planner';
    headers['x-title'] = 'OIOL P12 probe';
  }
  const body = { model, temperature: 0, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the single word: OK' }] };
  try {
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const text = await response.text();
    record.httpStatus = response.status;
    let payload = null;
    try { payload = JSON.parse(text); } catch { record.nonJsonBodyPrefix = text.slice(0, 120); }
    const choice = payload?.choices?.[0];
    record.contentLength = (choice?.message?.content || '').length;
    record.finishReason = choice?.finish_reason || null;
    record.ok = response.status < 400 && record.contentLength > 0;
    if (!record.ok) record.errorBodyPrefix = (payload?.error?.message || payload?.detail || text || '').slice(0, 200);
  } catch (error) {
    record.error = String(error?.name || 'ProbeError') + ': ' + String(error?.message || error).slice(0, 160);
  }
  if (record.provider.includes('openrouter.ai')) {
    try {
      const quotaResponse = await fetch('https://openrouter.ai/api/v1/key', { headers, signal: AbortSignal.timeout(30000) });
      const quota = await quotaResponse.json().catch(() => null);
      record.quota = {
        httpStatus: quotaResponse.status,
        label: quota?.label || null,
        isFreeTier: quota?.is_free_tier ?? null,
        usage: quota?.usage ?? null,
        limitRemaining: quota?.limit_remaining ?? null
      };
    } catch (error) {
      record.quota = { error: String(error?.message || error).slice(0, 120) };
    }
  }
  return record;
}

async function listModels(slot) {
  const key = bearer(slot);
  const base = value(['P12_MODELS_BASE_' + slot], null);
  if (!key || !base) return { skipped: true, reason: base ? 'no key' : 'no P12_MODELS_BASE_' + slot };
  try {
    const response = await fetch(base.replace(/\/$/, '') + '/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => null);
    const ids = Array.isArray(payload?.data) ? payload.data.map(item => item.id) : Array.isArray(payload?.models) ? payload.models.map(item => item.id || item) : Array.isArray(payload) ? payload.map(item => item.id || item) : [];
    const needle = (value('P12_MODEL_FILTER', 'llama,qwen,deepseek,nemotron,phi,gpt-oss,gemini,mistral').split(',').filter(Boolean));
    return {
      httpStatus: response.status,
      modelCount: ids.length,
      candidates: ids.filter(id => needle.some(term => String(id).toLowerCase().includes(term))).slice(0, 60)
    };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 160) };
  }
}

export async function main() {
  const report = { schemaVersion: '1.0.0', createdAt: new Date().toISOString(), slots: [], models: {} };
  for (const slot of ['R1', 'R2']) {
    report.slots.push(await probeSlot(slot));
    report.models[slot] = await listModels(slot);
  }
  const target = path.join(root, 'benchmarks/real-world/reviews/.p12-provider-probe.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.slots.every(slot => slot.ok || slot.error === 'no api key configured for this slot') ? 0 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error('Provider probe error: ' + error.message); process.exitCode = 1; }
}