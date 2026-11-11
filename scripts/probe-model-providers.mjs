#!/usr/bin/env node
// Diagnostic: verify that each P12 reviewer slot can reach its configured provider.
// Never prints key material; only statuses, lengths and booleans are reported.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function probeSlot(slot) {
  const endpoint = value(['P12_MODELS_URL_' + slot, 'P12_MODELS_URL'], defaultEndpoints[slot]);
  const model = value(['P12_MODEL_' + slot], defaultModels[slot]);
  const key = value(['P12_API_KEY_' + slot, 'P12_API_KEY', 'OIOL_API_KEY'], '');
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
    if (!record.ok) record.errorBodyPrefix = (payload?.error?.message || text || '').slice(0, 200);
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
        limitRemaining: quota?.limit_remaining ?? null,
        canReadFreeModels: Array.isArray(quota?.models) ? quota.models.length : null
      };
    } catch (error) {
      record.quota = { error: String(error?.message || error).slice(0, 120) };
    }
  }
  return record;
}

async function listNvidiaModels() {
  const key = value(['P12_API_KEY_R1', 'NVIDIA_API_KEY'], '');
  if (!key) return { error: 'no key' };
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => null);
    const ids = Array.isArray(payload?.data) ? payload.data.map(item => item.id) : [];
    const wanted = ['meta/llama-3.3-70b-instruct', 'qwen/qwen3-next-80b-a3b-instruct', 'microsoft/phi-4-mini-instruct', 'deepseek-ai/deepseek-r1'];
    return { httpStatus: response.status, modelCount: ids.length, wantedAvailable: wanted.filter(id => ids.includes(id)) };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 160) };
  }
}

const report = { schemaVersion: '1.0.0', createdAt: new Date().toISOString(), slots: [], nvidiaModels: null };
report.slots.push(await probeSlot('R1'));
report.slots.push(await probeSlot('R2'));
report.nvidiaModels = await listNvidiaModels();
const target = path.join(root, 'benchmarks/real-world/reviews/.p12-provider-probe.json');
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
