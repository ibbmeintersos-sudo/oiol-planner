import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateJsonSchema } from './core/schema-validator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFIG_FILE = 'oiol.config.json';

export const DEFAULTS = {
  provider: 'openai-compatible',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OIOL_API_KEY',
  timeoutMs: 60000,
  maxRetries: 2
};

export const PROVIDER_DEFAULTS = {
  'openai-compatible': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  'anthropic': { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' },
  'gemini': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  'ollama': { baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1' }
};

const PROFILE_PROPERTIES = {
  provider: { type: 'string', enum: ['openai-compatible', 'anthropic', 'gemini', 'ollama'] },
  model: { type: 'string', minLength: 1 },
  baseUrl: { type: 'string', minLength: 1 },
  apiKeyEnv: { type: 'string', minLength: 1 },
  timeoutMs: { type: 'integer' },
  maxRetries: { type: 'integer' },
  reviewer: {
    type: 'object',
    additionalProperties: false,
    required: ['provider', 'model'],
    properties: {
      provider: { type: 'string', enum: ['openai-compatible', 'anthropic', 'gemini', 'ollama'] },
      model: { type: 'string', minLength: 1 },
      baseUrl: { type: 'string', minLength: 1 },
      apiKeyEnv: { type: 'string', minLength: 1 },
      timeoutMs: { type: 'integer' }
    }
  }
};

const FALLBACK_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:oiol:schemas:config:1.0.0',
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: {
    $schema: { type: 'string' },
    version: { type: 'integer', const: 1 },
    defaultProfile: { type: 'string', minLength: 1 },
    profiles: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['provider', 'model'],
        properties: PROFILE_PROPERTIES
      }
    },
    scan: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxFiles: { type: 'integer' },
        maxFileBytes: { type: 'integer' },
        maxPriorityFileBytes: { type: 'integer' },
        maxContextChars: { type: 'integer' },
        maxPriorityExcerptChars: { type: 'integer' },
        maxDepth: { type: 'integer' },
        maxSourceFiles: { type: 'integer' },
        maxTestFiles: { type: 'integer' },
        maxConfigFiles: { type: 'integer' }
      }
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        format: { type: 'string', enum: ['json', 'md'] },
        directory: { type: 'string', minLength: 1 }
      }
    }
  }
};

let schemaPromise;

async function loadSchema() {
  if (!schemaPromise) {
    const schemaPath = path.resolve(__dirname, '..', 'schemas', 'oiol-config.schema.json');
    schemaPromise = fs.readFile(schemaPath, 'utf8')
      .then(text => JSON.parse(text))
      .catch(() => FALLBACK_SCHEMA);
  }
  return schemaPromise;
}

export async function validateConfig(value) {
  const schema = await loadSchema();
  const result = validateJsonSchema(value, schema);
  const errors = [...result.errors];

  const profiles = value?.profiles;
  if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
    if (Object.keys(profiles).length === 0) errors.push('$.profiles must contain at least one profile');
    for (const [name, profile] of Object.entries(profiles)) {
      if (!profile || typeof profile !== 'object') continue;
      if (Number.isInteger(profile.timeoutMs) && profile.timeoutMs < 1000) errors.push(`$.profiles.${name}.timeoutMs must be at least 1000`);
      if (Number.isInteger(profile.maxRetries) && (profile.maxRetries < 0 || profile.maxRetries > 5)) errors.push(`$.profiles.${name}.maxRetries must be between 0 and 5`);
      if (Number.isInteger(profile.reviewer?.timeoutMs) && profile.reviewer.timeoutMs < 1000) errors.push(`$.profiles.${name}.reviewer.timeoutMs must be at least 1000`);
    }
    if (value.defaultProfile && !Object.hasOwn(profiles, value.defaultProfile)) {
      errors.push(`$.defaultProfile references unknown profile "${value.defaultProfile}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function loadConfig(configPath) {
  const searchPath = configPath || process.env.OIOL_CONFIG || path.resolve(process.cwd(), CONFIG_FILE);
  let raw;
  try {
    raw = await fs.readFile(searchPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error('Invalid JSON in ' + searchPath + ': ' + error.message);
  }
  const result = await validateConfig(parsed);
  if (!result.valid) {
    throw new Error('Config validation failed for ' + searchPath + ': ' + result.errors.join('; '));
  }
  return parsed;
}

export function resolveProfile(config, explicitProfile) {
  if (explicitProfile) return explicitProfile;
  if (config?.defaultProfile) return config.defaultProfile;
  if (config?.profiles) {
    const names = Object.keys(config.profiles);
    if (names.length > 0) return names[0];
  }
  return 'default';
}

export function getProfileConfig(config, profileName) {
  if (!config?.profiles) return null;
  return config.profiles[profileName] || null;
}

function mirrorSecret(env, sourceName, targetName) {
  if (!sourceName || sourceName === targetName) return;
  if (env[targetName] === undefined && env[sourceName] !== undefined) env[targetName] = env[sourceName];
}

export function applyConfigToEnv(config, profileName, env = process.env) {
  if (!config?.profiles) return;
  const profile = config.profiles[profileName];
  if (!profile) return;

  const providerDefaults = PROVIDER_DEFAULTS[profile.provider] || {};
  const values = {
    OIOL_PROVIDER: profile.provider,
    OIOL_MODEL: profile.model,
    OIOL_BASE_URL: profile.baseUrl || providerDefaults.baseUrl || DEFAULTS.baseUrl,
    OIOL_TIMEOUT_MS: String(profile.timeoutMs ?? DEFAULTS.timeoutMs),
    OIOL_MAX_RETRIES: String(profile.maxRetries ?? DEFAULTS.maxRetries)
  };

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '' && env[key] === undefined) env[key] = value;
  }
  mirrorSecret(env, profile.apiKeyEnv || DEFAULTS.apiKeyEnv, 'OIOL_API_KEY');

  if (profile.reviewer) {
    const reviewer = profile.reviewer;
    const reviewerDefaults = PROVIDER_DEFAULTS[reviewer.provider] || {};
    const reviewerValues = {
      OIOL_REVIEW_PROVIDER: reviewer.provider,
      OIOL_REVIEW_MODEL: reviewer.model,
      OIOL_REVIEW_BASE_URL: reviewer.baseUrl || reviewerDefaults.baseUrl || '',
      OIOL_REVIEW_TIMEOUT_MS: String(reviewer.timeoutMs ?? 60000)
    };
    for (const [key, value] of Object.entries(reviewerValues)) {
      if (value !== undefined && value !== '' && env[key] === undefined) env[key] = value;
    }
    mirrorSecret(env, reviewer.apiKeyEnv, 'OIOL_REVIEW_API_KEY');
  }
}

export function mergeConfigWithDefaults(config, profileName) {
  const profile = getProfileConfig(config, profileName);
  if (!profile) return { ...DEFAULTS };
  const providerDefaults = PROVIDER_DEFAULTS[profile.provider] || {};
  return {
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl || providerDefaults.baseUrl || DEFAULTS.baseUrl,
    apiKeyEnv: profile.apiKeyEnv || DEFAULTS.apiKeyEnv,
    timeoutMs: profile.timeoutMs ?? DEFAULTS.timeoutMs,
    maxRetries: profile.maxRetries ?? DEFAULTS.maxRetries
  };
}
