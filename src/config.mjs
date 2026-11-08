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
  'anthropic': { baseUrl: 'https://api.anthropic.com' },
  'gemini': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  'ollama': { baseUrl: 'http://127.0.0.1:11434' }
};

const CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:oiol:schemas:config:1.0.0',
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: {
    version: { type: 'integer', const: 1 },
    defaultProfile: { type: 'string', minLength: 1 },
    profiles: {
      type: 'object',
      additionalProperties: false,
      patternProperties: {
        '^.+$': {
          type: 'object',
          additionalProperties: false,
          required: ['provider', 'model'],
          properties: {
            provider: { type: 'string', enum: ['openai-compatible', 'anthropic', 'gemini', 'ollama'] },
            model: { type: 'string', minLength: 1 },
            baseUrl: { type: 'string', minLength: 1 },
            apiKeyEnv: { type: 'string', minLength: 1 },
            timeoutMs: { type: 'integer', minimum: 1000 },
            maxRetries: { type: 'integer', minimum: 0, maximum: 5 },
            reviewer: {
              type: 'object',
              additionalProperties: false,
              properties: {
                provider: { type: 'string', enum: ['openai-compatible', 'anthropic', 'gemini', 'ollama'] },
                model: { type: 'string', minLength: 1 },
                baseUrl: { type: 'string', minLength: 1 },
                apiKeyEnv: { type: 'string', minLength: 1 },
                timeoutMs: { type: 'integer', minimum: 1000 }
              },
              required: ['provider', 'model']
            }
          }
        }
      }
    },
    scan: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxFiles: { type: 'integer', minimum: 1 },
        maxFileBytes: { type: 'integer', minimum: 1 },
        maxPriorityFileBytes: { type: 'integer', minimum: 1 },
        maxContextChars: { type: 'integer', minimum: 1 },
        maxPriorityExcerptChars: { type: 'integer', minimum: 1 },
        maxDepth: { type: 'integer', minimum: 1 },
        maxSourceFiles: { type: 'integer', minimum: 1 },
        maxTestFiles: { type: 'integer', minimum: 1 },
        maxConfigFiles: { type: 'integer', minimum: 1 }
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

async function loadSchema() {
  const schemaPath = path.resolve(__dirname, '../../schemas/oiol-config.schema.json');
  try {
    const text = await fs.readFile(schemaPath, 'utf8');
    return JSON.parse(text);
  } catch {
    return CONFIG_SCHEMA;
  }
}

export async function loadConfig(configPath) {
  const searchPath = configPath || process.env.OIOL_CONFIG || path.resolve(process.cwd(), CONFIG_FILE);
  let raw;
  try {
    raw = await fs.readFile(searchPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error('Invalid JSON in config file: ' + err.message);
  }
  const schema = await loadSchema();
  const result = validateJsonSchema(parsed, schema);
  if (!result.valid) {
    throw new Error('Config validation failed: ' + result.errors.join('; '));
  }
  return parsed;
}

export function resolveProfile(config, explicitProfile) {
  if (explicitProfile) return explicitProfile;
  if (config?.defaultProfile) return config.defaultProfile;
  if (config?.profiles) return Object.keys(config.profiles)[0];
  return 'default';
}

export function getProfileConfig(config, profileName) {
  if (!config?.profiles) return null;
  return config.profiles[profileName] || null;
}

export function applyConfigToEnv(config, profileName) {
  if (!config?.profiles) return;
  const profile = config.profiles[profileName];
  if (!profile) return;

  const providerDefaults = PROVIDER_DEFAULTS[profile.provider] || {};
  const envMap = [
    ['OIOL_PROVIDER', profile.provider],
    ['OIOL_MODEL', profile.model],
    ['OIOL_BASE_URL', profile.baseUrl || providerDefaults.baseUrl || DEFAULTS.baseUrl],
    ['OIOL_API_KEY', profile.apiKeyEnv || DEFAULTS.apiKeyEnv],
    ['OIOL_TIMEOUT_MS', String(profile.timeoutMs ?? DEFAULTS.timeoutMs)],
    ['OIOL_MAX_RETRIES', String(profile.maxRetries ?? DEFAULTS.maxRetries)]
  ];

  for (const [key, value] of envMap) {
    if (value !== undefined && value !== '' && !Object.hasOwn(process.env, key)) {
      process.env[key] = value;
    }
  }

  if (profile.reviewer) {
    const r = profile.reviewer;
    const rDefaults = PROVIDER_DEFAULTS[r.provider] || {};
    const reviewMap = [
      ['OIOL_REVIEW_PROVIDER', r.provider],
      ['OIOL_REVIEW_MODEL', r.model],
      ['OIOL_REVIEW_BASE_URL', r.baseUrl || rDefaults.baseUrl || ''],
      ['OIOL_REVIEW_API_KEY', r.apiKeyEnv || ''],
      ['OIOL_REVIEW_TIMEOUT_MS', String(r.timeoutMs ?? 60000)]
    ];
    for (const [key, value] of reviewMap) {
      if (value !== undefined && value !== '' && !Object.hasOwn(process.env, key)) {
        process.env[key] = value;
      }
    }
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
