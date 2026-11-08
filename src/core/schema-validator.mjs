import fs from 'node:fs/promises';
import { isObject } from './utils.mjs';
import { SCHEMA_VERSION, PLAN_SCHEMA_CONTRACTS } from '../contracts/types.mjs';

export const SUPPORTED_SCHEMA_KEYWORDS = Object.freeze([
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'required', 'properties', 'items', 'additionalProperties',
  'const', 'enum', 'minLength', 'minItems', 'uniqueItems',
  'oneOf', 'anyOf', 'not'
]);
const SUPPORTED = new Set(SUPPORTED_SCHEMA_KEYWORDS);
let schemaPromise;

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isObject(left) || isObject(right)) {
    if (!isObject(left) || !isObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
  }
  return false;
}

function resolveReference(root, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) {
    throw new Error('Only local JSON Schema references are supported: ' + reference);
  }
  return reference.slice(2).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, key) => value?.[key], root);
}

function typeMatches(value, type) {
  switch (type) {
    case 'null': return value === null;
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    default: throw new Error('Unsupported JSON Schema type: ' + type);
  }
}

function inspectSchema(schema, path = '$schema') {
  if (!isObject(schema)) throw new Error('Schema node must be an object at ' + path);
  const validTypes = new Set(['null', 'object', 'array', 'string', 'boolean', 'integer', 'number']);
  for (const [keyword, value] of Object.entries(schema)) {
    if (!SUPPORTED.has(keyword)) throw new Error('Unsupported JSON Schema keyword "' + keyword + '" at ' + path);
    if (keyword === 'type') {
      const types = Array.isArray(value) ? value : [value];
      if (!types.length || types.some(type => !validTypes.has(type))) throw new Error('type must be a supported JSON Schema type or non-empty array at ' + path);
    } else if (keyword === 'required') {
      if (!Array.isArray(value) || value.some(name => typeof name !== 'string')) throw new Error('required must be an array of strings at ' + path);
    } else if (keyword === 'enum' || keyword === 'oneOf' || keyword === 'anyOf') {
      if (!Array.isArray(value) || value.length === 0) throw new Error(keyword + ' must be a non-empty array at ' + path);
      if (keyword !== 'enum') value.forEach((child, index) => inspectSchema(child, path + '/' + keyword + '/' + index));
    } else if (keyword === 'minLength' || keyword === 'minItems') {
      if (!Number.isInteger(value) || value < 0) throw new Error(keyword + ' must be a non-negative integer at ' + path);
    } else if (keyword === 'uniqueItems') {
      if (typeof value !== 'boolean') throw new Error('uniqueItems must be a boolean at ' + path);
    } else if (keyword === 'properties' || keyword === '$defs') {
      if (!isObject(value)) throw new Error(keyword + ' must be an object at ' + path);
      for (const [name, child] of Object.entries(value)) inspectSchema(child, path + '/' + keyword + '/' + name);
    } else if (keyword === 'items' || keyword === 'not') {
      if (!isObject(value)) throw new Error(keyword + ' must be a schema object at ' + path);
      inspectSchema(value, path + '/' + keyword);
    } else if (keyword === 'additionalProperties') {
      if (typeof value !== 'boolean' && !isObject(value)) throw new Error('additionalProperties must be a boolean or schema object at ' + path);
      if (isObject(value)) inspectSchema(value, path + '/additionalProperties');
    } else if (keyword === '$ref') {
      if (typeof value !== 'string' || !value.startsWith('#/')) throw new Error('Only local JSON Schema pointer references are supported at ' + path);
    }
  }
}

function validateNode(value, schema, root, path, errors) {
  if (schema.$ref) {
    const target = resolveReference(root, schema.$ref);
    if (!target) throw new Error('Unresolved JSON Schema reference: ' + schema.$ref);
    validateNode(value, target, root, path, errors);
  }

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some(type => typeMatches(value, type))) {
      errors.push(path + ' must be ' + allowed.join(' or '));
      return;
    }
  }
  if (Object.hasOwn(schema, 'const') && !deepEqual(value, schema.const)) errors.push(path + ' must equal the declared constant');
  if (Array.isArray(schema.enum) && !schema.enum.some(item => deepEqual(value, item))) errors.push(path + ' must match one of the allowed values');

  if (typeof value === 'string' && Number.isInteger(schema.minLength) && [...value].length < schema.minLength) {
    errors.push(path + ' must contain at least ' + schema.minLength + ' character(s)');
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(path + ' must contain at least ' + schema.minItems + ' item(s)');
    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index++) {
        if (value.slice(index + 1).some(item => deepEqual(value[index], item))) {
          errors.push(path + ' must contain unique items');
          break;
        }
      }
    }
    if (isObject(schema.items)) value.forEach((item, index) => validateNode(item, schema.items, root, path + '[' + index + ']', errors));
  }
  if (isObject(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(path + ' is missing required property "' + key + '"');
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validateNode(value[key], childSchema, root, path + '.' + key, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) errors.push(path + ' contains unsupported property "' + key + '"');
      }
    } else if (isObject(schema.additionalProperties)) {
      for (const [key, child] of Object.entries(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) validateNode(child, schema.additionalProperties, root, path + '.' + key, errors);
      }
    }
  }
  for (const keyword of ['anyOf', 'oneOf']) {
    if (!Array.isArray(schema[keyword])) continue;
    const matches = schema[keyword].filter(candidate => {
      const candidateErrors = [];
      validateNode(value, candidate, root, path, candidateErrors);
      return candidateErrors.length === 0;
    }).length;
    if (keyword === 'anyOf' && matches === 0) errors.push(path + ' must match at least one anyOf schema');
    if (keyword === 'oneOf' && matches !== 1) errors.push(path + ' must match exactly one oneOf schema');
  }
  if (isObject(schema.not)) {
    const notErrors = [];
    validateNode(value, schema.not, root, path, notErrors);
    if (notErrors.length === 0) errors.push(path + ' matches a forbidden schema');
  }
}

export function validateJsonSchema(value, schema) {
  inspectSchema(schema);
  const errors = [];
  validateNode(value, schema, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}

const schemaPromises = new Map();
async function loadPublishedSchema(version = SCHEMA_VERSION) {
  if (!Object.hasOwn(PLAN_SCHEMA_CONTRACTS, version)) {
    throw new Error('Unsupported plan schemaVersion: ' + version);
  }
  if (!schemaPromises.has(version)) {
    const promise = fs.readFile(new URL('../../schemas/plan-' + version + '.schema.json', import.meta.url), 'utf8')
      .then(JSON.parse)
      .catch(error => { schemaPromises.delete(version); throw error; });
    schemaPromises.set(version, promise);
  }
  return schemaPromises.get(version);
}

export async function validatePlanSchema(plan) {
  const version = typeof plan?.schemaVersion === 'string' ? plan.schemaVersion : SCHEMA_VERSION;
  try {
    return validateJsonSchema(plan, await loadPublishedSchema(version));
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
}
