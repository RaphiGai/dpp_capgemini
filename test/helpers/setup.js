// Jest global setup. Mutes blockchain in tests by default; individual tests can opt-in.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.CDS_ENV = process.env.CDS_ENV || 'development';
process.env.BLOCKCHAIN_ENABLED = process.env.BLOCKCHAIN_ENABLED || 'false';
process.env.QR_TOKEN_HMAC_SECRET =
  process.env.QR_TOKEN_HMAC_SECRET || 'test-secret-please-do-not-use-in-production';
