'use strict';

const { applyFieldVisibility, resolve } = require('../../srv/lib/field-visibility');

describe('field-visibility — catalogue defaults', () => {
  test('internal-default fields are dropped, public-default kept (no stored map)', () => {
    const out = applyFieldVisibility({ color: 'Blue', sku: 'X', gtin: 'Y' }, 'variant', null);
    expect(out.color).toBe('Blue');
    expect(out).not.toHaveProperty('sku');
    expect(out).not.toHaveProperty('gtin');
  });
});

describe('field-visibility — stored overrides', () => {
  test('a public field set internal is removed; an internal field set public is kept', () => {
    const map = JSON.stringify({ color: 'internal', sku: 'public' });
    const out = applyFieldVisibility({ color: 'Blue', size: 'M', sku: 'X' }, 'variant', map);
    expect(out).not.toHaveProperty('color');
    expect(out.size).toBe('M');
    expect(out.sku).toBe('X');
  });
});

describe('field-visibility — regulatory lock', () => {
  test('locked fields are never hidden, even when the map says internal', () => {
    const map = JSON.stringify({ name: 'internal', country_of_origin: 'internal', model: 'internal' });
    const out = applyFieldVisibility(
      { name: 'Tee', country_of_origin: 'PT', model: 'M1' },
      'product',
      map
    );
    expect(out.name).toBe('Tee');
    expect(out.country_of_origin).toBe('PT');
    expect(out).not.toHaveProperty('model'); // not locked → honoured
  });

  test('resolve() forces locked fields to public', () => {
    expect(resolve('product', 'fibre_composition', { fibre_composition: 'internal' })).toBe('public');
    expect(resolve('batch', 'country_of_origin', { country_of_origin: 'internal' })).toBe('public');
  });
});

describe('field-visibility — robustness', () => {
  test('unknown fields are never silently hidden', () => {
    const out = applyFieldVisibility({ weird: 1 }, 'product', JSON.stringify({ weird: 'internal' }));
    expect(out.weird).toBe(1);
  });

  test('malformed stored JSON falls back to catalogue defaults', () => {
    const out = applyFieldVisibility({ batch_number: 'B1', co2_footprint_kg: 1 }, 'batch', '{not json');
    expect(out).not.toHaveProperty('batch_number'); // default internal
    expect(out.co2_footprint_kg).toBe(1); // default public
  });

  test('null section is returned unchanged', () => {
    expect(applyFieldVisibility(null, 'product', null)).toBeNull();
  });
});
