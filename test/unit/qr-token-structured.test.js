'use strict';

// Structured QR token: readable business codes + nonce, HMAC-signed, unique,
// tamper-evident, and backward-compatible with legacy UUID tokens.

const tokens = require('../../srv/lib/token');

const CTX = {
  gtin: '12345678',
  sku: 'TSH-RED-M',
  batch_number: '2026-05-A',
  serial: 'SN-TSH-0001',
  date: '2026-06-15T10:00:00Z'
};

describe('structured QR token', () => {
  test('builds a readable, verifiable, decodable token from business codes', () => {
    const t = tokens.generate(CTX);
    expect(t.startsWith('dpp~')).toBe(true);
    expect(t).toContain('12345678');
    expect(t).toContain('2026-05-A');
    expect(t).toContain('SN-TSH-0001');
    expect(t).toContain('20260615');
    expect(tokens.verify(t)).toBeTruthy();

    expect(tokens.decode(t)).toMatchObject({
      gtin: '12345678',
      sku: 'TSH-RED-M',
      batch_number: '2026-05-A',
      serial: 'SN-TSH-0001',
      date: '20260615'
    });
  });

  test('is unique per call via the nonce (same context → different tokens)', () => {
    expect(tokens.generate(CTX)).not.toBe(tokens.generate(CTX));
  });

  test('tampering with any character invalidates the signature', () => {
    const t = tokens.generate(CTX);
    const flipped = t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A');
    expect(tokens.verify(flipped)).toBeNull();
    // mutating the payload (e.g. a different serial) also fails — cannot forge.
    const forged = t.replace('SN-TSH-0001', 'SN-TSH-9999');
    expect(tokens.verify(forged)).toBeNull();
  });

  test('sanitizes URL-unsafe characters in segments (no spaces/slashes/dots)', () => {
    const t = tokens.generate({ batch_number: 'A/B 01', serial: 'x~y.z' });
    const payload = t.slice(0, t.lastIndexOf('.'));
    expect(payload).not.toMatch(/[ /]/);
    const parts = payload.split('~');
    expect(parts[3]).toBe('A-B-01'); // batch_number sanitized
    expect(parts[4]).toBe('x-y-z'); // serial sanitized
  });

  test('no context → legacy UUID token, still valid, decode returns null', () => {
    const t = tokens.generate();
    expect(t.startsWith('dpp~')).toBe(false);
    expect(tokens.verify(t)).toBeTruthy();
    expect(tokens.decode(t)).toBeNull();
  });

  test('a structured token with only some fields still works', () => {
    const t = tokens.generate({ serial: 'SN-1', date: '2026-01-02' });
    expect(tokens.verify(t)).toBeTruthy();
    expect(tokens.decode(t)).toMatchObject({ gtin: null, serial: 'SN-1', date: '20260102' });
  });
});
