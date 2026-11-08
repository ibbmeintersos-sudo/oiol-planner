import crypto from 'node:crypto';

export const id = (prefix = 'id') => prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
export const uniq = xs => [...new Set(xs)];
export const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const stableStringify = x => JSON.stringify(x, Object.keys(x ?? {}).sort(), 2);

const QUOTED_DOUBLE_KEY = /(["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|secret[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|authorization|database[_-]?url|connection[_-]?string|dsn|credential(?:s)?)["']\s*:\s*)"(?:\\.|[^"\\])*"/gi;
const QUOTED_SINGLE_KEY = /(["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|secret[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|authorization|database[_-]?url|connection[_-]?string|dsn|credential(?:s)?)["']\s*:\s*)'(?:\\.|[^'\\])*'/gi;
const UNQUOTED_KEY_DOUBLE_VALUE = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|secret[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|authorization|database[_-]?url|connection[_-]?string|dsn|credential(?:s)?)\s*[=:]\s*)"(?:\\.|[^"\\])*"/gi;
const UNQUOTED_KEY_SINGLE_VALUE = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|secret[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|authorization|database[_-]?url|connection[_-]?string|dsn|credential(?:s)?)\s*[=:]\s*)'(?:\\.|[^'\\])*'/gi;
const SIMPLE_ASSIGNMENT = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|secret[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|authorization|database[_-]?url|connection[_-]?string|dsn|credential(?:s)?)\s*[=:]\s*)(["']?)[^\s,;}]+\2/gi;
const DATABASE_CREDENTIAL_URL = /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)[^@\s]+(@)/gi;
const BASIC_AUTHORIZATION = /(authorization\s*[:=]\s*basic\s+)[A-Za-z0-9+/=]+/gi;
const JWT = /\b(eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.)[A-Za-z0-9_-]{5,}\b/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;
const PGP_PRIVATE_KEY_BLOCK = /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g;

export function redact(value = '') {
  return String(value)
    .replace(DATABASE_CREDENTIAL_URL, '$1[REDACTED]$2')
    .replace(BASIC_AUTHORIZATION, '$1[REDACTED]')
    .replace(JWT, '$1[REDACTED_JWT]')
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED_PRIVATE_KEY]')
    .replace(PGP_PRIVATE_KEY_BLOCK, '[REDACTED_PRIVATE_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(QUOTED_DOUBLE_KEY, '$1"[REDACTED]"')
    .replace(QUOTED_SINGLE_KEY, "$1'[REDACTED]'")
    .replace(UNQUOTED_KEY_DOUBLE_VALUE, '$1"[REDACTED]"')
    .replace(UNQUOTED_KEY_SINGLE_VALUE, "$1'[REDACTED]'")
    .replace(SIMPLE_ASSIGNMENT, '$1[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
}

export function safePath(input = '') {
  if (typeof input !== 'string') return false;
  const value = input.trim().replaceAll('\\', '/');
  if (!value || value.includes('\0') || /[\x00-\x1f\x7f]/.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split('/');
  return !parts.some(part => !part || part === '.' || part === '..');
}
