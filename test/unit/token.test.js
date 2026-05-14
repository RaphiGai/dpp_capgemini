'use strict';

const tokens = require('../../srv/lib/token');

describe('token', () => {
  test('generate produces UUID.signature pair that verifies', () => {
    const tok = tokens.generate();
    expect(tok).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    const uuid = tokens.verify(tok);
    expect(uuid).toBe(tok.split('.')[0]);
  });

  test('verify rejects tampered signature', () => {
    const tok = tokens.generate();
    const [uuid, sig] = tok.split('.');
    const tampered = `${uuid}.${sig.replace(/.$/, sig.slice(-1) === 'A' ? 'B' : 'A')}`;
    expect(tokens.verify(tampered)).toBeNull();
  });

  test('verify rejects malformed input', () => {
    expect(tokens.verify('no-dot-here')).toBeNull();
    expect(tokens.verify('')).toBeNull();
    expect(tokens.verify(null)).toBeNull();
    expect(tokens.verify(undefined)).toBeNull();
  });

  test('verify rejects wrong-secret signature', () => {
    const tok = tokens.generate();
    const secret = process.env.QR_TOKEN_HMAC_SECRET;
    process.env.QR_TOKEN_HMAC_SECRET = 'a-different-secret-of-sufficient-length';
    expect(tokens.verify(tok)).toBeNull();
    process.env.QR_TOKEN_HMAC_SECRET = secret;
  });
});
