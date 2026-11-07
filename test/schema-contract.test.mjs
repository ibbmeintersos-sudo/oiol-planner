import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION, SCHEMA_VERSION } from '../src/contracts/types.mjs';
import { SUPPORTED_SCHEMA_KEYWORDS, validateJsonSchema } from '../src/core/schema-validator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(await fs.readFile(path.join(ROOT, 'schemas/plan.schema.json'), 'utf8'));
const versionedSchema = JSON.parse(await fs.readFile(path.join(ROOT, 'schemas/plan-' + SCHEMA_VERSION + '.schema.json'), 'utf8'));
const previousSchema = JSON.parse(await fs.readFile(path.join(ROOT, 'schemas/plan-1.0.0.schema.json'), 'utf8'));
const example = JSON.parse(await fs.readFile(path.join(ROOT, 'examples/plan.v1.json'), 'utf8'));

function collectKeywords(node, found = new Set()) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return found;
  for (const [key, value] of Object.entries(node)) {
    found.add(key);
    if (['properties', '$defs'].includes(key)) {
      for (const child of Object.values(value)) collectKeywords(child, found);
    } else if (['items', 'not', 'additionalProperties'].includes(key) && value && typeof value === 'object') {
      collectKeywords(value, found);
    } else if (['oneOf', 'anyOf'].includes(key)) {
      for (const child of value) collectKeywords(child, found);
    }
  }
  return found;
}

test('published schema and contract constants declare matching versions', () => {
  assert.equal(schema.properties.schemaVersion.const, SCHEMA_VERSION);
  assert.equal(schema.properties.contractVersion.const, CONTRACT_VERSION);
  assert.equal(schema.$id, 'urn:oiol:schemas:plan:' + SCHEMA_VERSION);
  assert.equal(example.schemaVersion, SCHEMA_VERSION);
  assert.equal(example.contractVersion, CONTRACT_VERSION);
});

test('published schema uses only explicitly supported built-in keywords', () => {
  const used = collectKeywords(schema);
  for (const keyword of used) {
    assert.ok(SUPPORTED_SCHEMA_KEYWORDS.includes(keyword), 'Unsupported keyword used by published schema: ' + keyword);
  }
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.includes('$ref'));
  assert.ok(SUPPORTED_SCHEMA_KEYWORDS.includes('oneOf'));
});

test('published plan example satisfies the built-in schema contract', () => {
  const result = validateJsonSchema(example, schema);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('unsupported schema versions fail the published contract', () => {
  const invalid = structuredClone(example);
  invalid.schemaVersion = '99.0.0';
  const result = validateJsonSchema(invalid, schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('schemaVersion')));
});

test('unsupported JSON Schema keywords are rejected instead of silently ignored', () => {
  assert.throws(
    () => validateJsonSchema('not-an-email', { type: 'string', format: 'email' }),
    /Unsupported JSON Schema keyword "format"/
  );
});

test('malformed schema declarations fail closed during schema inspection', () => {
  assert.throws(() => validateJsonSchema('x', { type: ['string', 'unknown'] }), /supported JSON Schema type/);
  assert.throws(() => validateJsonSchema({}, { type: 'object', required: 'id' }), /required must be an array/);
  assert.throws(() => validateJsonSchema([], { type: 'array', items: true }), /items must be a schema object/);
});

test('current schema snapshot matches the current contract and preserves the frozen 1.0.0 schema', () => {
  assert.deepEqual(versionedSchema, schema);
  assert.equal(versionedSchema.properties.schemaVersion.const, SCHEMA_VERSION);
  assert.equal(previousSchema.properties.schemaVersion.const, '1.0.0');
  assert.equal(previousSchema.properties.contractVersion.const, '1.0');
});

test('1.0.0 plans continue to validate against their immutable schema snapshot', async () => {
  const legacy = structuredClone(example);
  legacy.schemaVersion = '1.0.0';
  legacy.contractVersion = '1.0';
  const currentOnlyFields = ['testStrategy','rollbackPlan','unknownsReviewed'];
  for (const key of currentOnlyFields) delete legacy[key];
  legacy.requirements = legacy.requirements.filter(item => item.id !== 'REQ-NFR-1');
  delete legacy.assumptions;
  delete legacy.unknowns;
  legacy.risks = legacy.risks.map(({likelihood,impact,confidence,...risk}) => risk);
  const result = await validateJsonSchema(legacy, previousSchema);
  assert.equal(result.valid, true, result.errors.join('\n'));
});
