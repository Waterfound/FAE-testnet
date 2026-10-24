import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function assertJsonValue(value, path = '$') {
  if (value === null) return;
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(path + ' contains a non-finite number');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, path + '[' + index + ']'));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new TypeError(path + ' contains forbidden key ' + key);
      }
      assertJsonValue(item, path + '.' + key);
    }
    return;
  }
  throw new TypeError(path + ' is not a JSON value');
}

export function canonicalize(value) {
  assertJsonValue(value);
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function digestJson(value) {
  return sha256Text(canonicalize(value));
}

export function withDigest(value, digestField) {
  const copy = structuredClone(value);
  delete copy[digestField];
  copy[digestField] = digestJson(copy);
  return copy;
}

export function verifyDigest(value, digestField) {
  if (!value || typeof value[digestField] !== 'string') return false;
  const expected = value[digestField];
  const copy = structuredClone(value);
  delete copy[digestField];
  return expected === digestJson(copy);
}

export async function readJson(path) {
  const text = await readFile(path, 'utf8');
  try {
    const value = JSON.parse(text);
    assertJsonValue(value);
    return value;
  } catch (error) {
    throw new Error('Invalid JSON at ' + path + ': ' + error.message, { cause: error });
  }
}

export function stableClone(value) {
  return JSON.parse(canonicalize(value));
}
