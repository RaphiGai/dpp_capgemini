'use strict';

const { canonicalize } = require('../../srv/lib/canonical-json');

describe('canonical-json', () => {
  test('sorts object keys deterministically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ c: { z: 1, y: 2 }, a: 1 })).toBe('{"a":1,"c":{"y":2,"z":1}}');
  });

  test('preserves array order but normalises nested objects', () => {
    expect(canonicalize([{ b: 1, a: 2 }, { d: 3, c: 4 }])).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
  });

  test('drops undefined keys', () => {
    expect(canonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  test('emits null for nulls and undefined array entries', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize([1, undefined, 3])).toBe('[1,null,3]');
  });

  test('two equivalent objects produce identical bytes', () => {
    const a = canonicalize({ name: 'tee', mats: [{ pct: 100, fiber: 'cotton' }] });
    const b = canonicalize({ mats: [{ fiber: 'cotton', pct: 100 }], name: 'tee' });
    expect(a).toBe(b);
  });
});
