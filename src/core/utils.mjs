import crypto from 'node:crypto';
export const id = (prefix='id') => `${prefix}_${crypto.randomUUID().replaceAll('-','').slice(0,10)}`;
export const uniq = xs => [...new Set(xs)];
export const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const stableStringify = x => JSON.stringify(x, Object.keys(x ?? {}).sort(), 2);
export function redact(value='') {
  return String(value)
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|authorization)\s*[=:]\s*)(["']?)[^\s,;}"']+\2/gi, '$1[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_KEY]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
}
export function safePath(input='') {
  if(typeof input!=='string') return false;
  const value=input.trim().replaceAll('\\','/');
  if(!value || value.includes('\0') || /[\x00-\x1f\x7f]/.test(value)) return false;
  if(value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:/.test(value)) return false;
  const parts=value.split('/');
  return !parts.some(part=>!part || part==='.' || part==='..');
}
