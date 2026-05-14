'use strict';

/**
 * Deterministic JSON serialiser (RFC 8785-light).
 *
 *  - Object keys are sorted lexicographically.
 *  - `undefined` keys are dropped (matches JSON.stringify, but explicit).
 *  - No whitespace.
 *  - Numbers are emitted as JSON.stringify renders them.
 *  - Strings are escaped via JSON.stringify so it inherits proper UTF-8 handling.
 *
 * This is the exact byte sequence we hash before anchoring on-chain, so any
 * change to this function MUST be considered a hash-version bump.
 */
function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v === undefined ? null : v)).join(',') + ']';
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return (
    '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
  );
}

module.exports = { canonicalize };
