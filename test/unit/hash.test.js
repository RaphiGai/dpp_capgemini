'use strict';

const { sha256Hex, hashDPPSnapshot, projectForHash } = require('../../srv/lib/hash');

describe('hash', () => {
  test('sha256Hex of empty string matches known value', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  test('hashDPPSnapshot is stable under irrelevant field permutations', () => {
    const dpp = {
      ID: 'dpp-001',
      granularity_level: 'model',
      verification_status: 'documented',
      visibility: 'public',
      gtin: '0401234567',
      product_ID: 'prod-1',
      issuing_organization_ID: 'org-1',
      manufacturing_country_iso2: 'PT'
    };
    const dppWithExtras = {
      ...dpp,
      modifiedAt: new Date().toISOString(),
      qr_token: 'abc.def',
      data_hash: 'old'
    };
    const children = { materials: [{ fiber_name: 'Cotton', percentage: 100, material_class: 'natural_plant' }] };
    expect(hashDPPSnapshot(dpp, children)).toBe(hashDPPSnapshot(dppWithExtras, children));
  });

  test('hashDPPSnapshot changes when a material percentage changes', () => {
    const dpp = { ID: 'dpp-002', granularity_level: 'batch' };
    const a = hashDPPSnapshot(dpp, { materials: [{ fiber_name: 'Cotton', percentage: 100, material_class: 'natural_plant' }] });
    const b = hashDPPSnapshot(dpp, { materials: [{ fiber_name: 'Cotton', percentage: 99, material_class: 'natural_plant' }] });
    expect(a).not.toBe(b);
  });

  test('material order does not influence the hash', () => {
    const dpp = { ID: 'dpp-003' };
    const m1 = { fiber_name: 'Cotton', percentage: 60, material_class: 'natural_plant' };
    const m2 = { fiber_name: 'Polyester', percentage: 40, material_class: 'synthetic' };
    expect(hashDPPSnapshot(dpp, { materials: [m1, m2] })).toBe(
      hashDPPSnapshot(dpp, { materials: [m2, m1] })
    );
  });

  test('projectForHash strips operational fields', () => {
    const p = projectForHash(
      { ID: 'x', modifiedAt: 'now', qr_token: 'tok', data_hash: 'h' },
      {}
    );
    expect(p).not.toHaveProperty('modifiedAt');
    expect(p).not.toHaveProperty('qr_token');
    expect(p).not.toHaveProperty('data_hash');
  });
});
