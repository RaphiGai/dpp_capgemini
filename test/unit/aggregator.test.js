'use strict';

const { _internals } = require('../../srv/lib/aggregator');
const {
  weightedSum, weightedAverage, unionStrings, rollupFibres, parseFibres, toFraction,
} = _internals;

describe('aggregator helpers', () => {
  test('toFraction converts percent to fraction, keeps other units literal', () => {
    expect(toFraction(95, '%')).toBeCloseTo(0.95);
    expect(toFraction(5, '%')).toBeCloseTo(0.05);
    expect(toFraction(2, 'kg')).toBe(2);
    expect(toFraction(null, '%')).toBe(1);
  });

  test('weightedSum combines a self value with weighted child contributions', () => {
    const result = weightedSum(null, [
      { value: 3.0, weight: 0.95 },
      { value: 8.0, weight: 0.05 },
    ]);
    expect(result).toBeCloseTo(3.25, 5);
  });

  test('weightedSum returns null when no self and no children contribute', () => {
    expect(weightedSum(null, [])).toBeNull();
    expect(weightedSum(null, [{ value: null, weight: 1 }])).toBeNull();
  });

  test('weightedAverage divides by total weight including the self entry', () => {
    const result = weightedAverage(null, [
      { value: 20, weight: 0.95 },
      { value: 0,  weight: 0.05 },
    ]);
    expect(result).toBeCloseTo(19, 5);
  });

  test('unionStrings deduplicates and sorts CSV-style entries', () => {
    const result = unionStrings('PFAS; lead', [
      { value: 'Lead, cadmium', weight: 1 },
      { value: 'PFAS', weight: 1 },
    ]);
    expect(result.split('; ')).toEqual(['Lead', 'PFAS', 'cadmium', 'lead']);
  });

  test('parseFibres extracts material percentages', () => {
    expect(parseFibres('60% Cotton, 40% Polyester')).toEqual({
      Cotton: 60, Polyester: 40,
    });
  });

  test('rollupFibres weights child fibre compositions and rounds to 1 decimal', () => {
    const result = rollupFibres(null, [
      { value: '100% Organic Cotton', weight: 0.95 },
      { value: '100% Elastane',       weight: 0.05 },
    ]);
    expect(result).toContain('95.0% Organic Cotton');
    expect(result).toContain('5.0% Elastane');
  });
});
