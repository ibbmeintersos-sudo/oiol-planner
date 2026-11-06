import crypto from 'node:crypto';
export const id = (prefix='id') => `${prefix}_${crypto.randomUUID().replaceAll('-','').slice(0,10)}`;
export const uniq = xs => [...new Set(xs)];
export const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const stableStringify = x => JSON.stringify(x, Object.keys(x ?? {}).sort(), 2);
export function redact(value='') {
  return String(value)
    .replace(/(api[_-]?key|token|password|secret|authorization)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_KEY]');
}
export function safePath(p='') {
  const s = String(p).replaceAll('\\','/');
  return !s.startsWith('/') && !/^[A-Za-z]:/.test(s) && !s.split('/').includes('..');
}
