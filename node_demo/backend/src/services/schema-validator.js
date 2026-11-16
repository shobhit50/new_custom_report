import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('../../resources/config.schema.json', import.meta.url));
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}

function check(value, rule, path = '$') {
  if (typeof rule === 'boolean') return rule ? [] : [`${path}: value is not allowed`];
  if (!rule || typeof rule !== 'object') return [];
  const errors = [];
  const fail = (message) => errors.push(`${path}: ${message}`);
  if (rule.type && !(Array.isArray(rule.type) ? rule.type : [rule.type]).some((type) => matchesType(value, type))) {
    fail(`expected ${JSON.stringify(rule.type)}`);
    return errors;
  }
  if ('const' in rule && !same(value, rule.const)) fail(`must equal ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.some((item) => same(item, value))) fail('value is not in enum');
  if (typeof value === 'string') {
    if (rule.minLength !== undefined && [...value].length < rule.minLength) fail('string is too short');
    if (rule.maxLength !== undefined && [...value].length > rule.maxLength) fail('string is too long');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail('string does not match pattern');
  }
  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) fail('number is too small');
    if (rule.maximum !== undefined && value > rule.maximum) fail('number is too large');
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) fail('array has too few items');
    if (rule.maxItems !== undefined && value.length > rule.maxItems) fail('array has too many items');
    if (rule.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) fail('array has duplicate items');
    if (rule.items) value.forEach((item, index) => errors.push(...check(item, rule.items, `${path}[${index}]`)));
  }
  if (matchesType(value, 'object')) {
    for (const key of rule.required || []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (key in (rule.properties || {})) errors.push(...check(item, rule.properties[key], `${path}.${key}`));
      else if (rule.additionalProperties !== undefined) errors.push(...check(item, rule.additionalProperties, `${path}.${key}`));
    }
  }
  if (rule.allOf) for (const child of rule.allOf) errors.push(...check(value, child, path));
  if (rule.anyOf && !rule.anyOf.some((child) => check(value, child, path).length === 0)) fail('does not match any allowed variant');
  if (rule.not && check(value, rule.not, path).length === 0) fail('matches a forbidden variant');
  if (rule.if && check(value, rule.if, path).length === 0 && rule.then) errors.push(...check(value, rule.then, path));
  if (rule.if && check(value, rule.if, path).length !== 0 && rule.else) errors.push(...check(value, rule.else, path));
  return errors;
}

export function validateConfig(config) {
  const errors = check(config, schema);
  if (errors.length) throw new Error(`Schema error: ${errors[0]}`);
  return config;
}
