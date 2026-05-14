'use strict';

const { ethers } = require('ethers');
const abiArtifact = require('../abi/FashionDPPRegistry.json');

/**
 * Thin wrapper around ethers.js v6 that exposes only the operations the
 * outbox worker needs. Keeping this file dependency-light makes it easy to
 * mock with `jest.mock('../srv/lib/blockchain')` in tests.
 *
 * Configuration is read from environment variables (see .env.example):
 *   BLOCKCHAIN_ENABLED          (boolean, defaults false)
 *   BLOCKCHAIN_RPC_URL          (Polygon Amoy by default)
 *   BLOCKCHAIN_PRIVATE_KEY      (service wallet)
 *   BLOCKCHAIN_CONTRACT_ADDRESS (deployed FashionDPPRegistry)
 *
 * `getClient()` returns `null` when the feature flag is off so callers can
 * branch cleanly: `const chain = getClient(); if (chain) { ... }`.
 */
class BlockchainClient {
  constructor({ rpcUrl, privateKey, contractAddress }) {
    if (!rpcUrl) throw new Error('BLOCKCHAIN_RPC_URL not set');
    if (!privateKey) throw new Error('BLOCKCHAIN_PRIVATE_KEY not set');
    if (!contractAddress) throw new Error('BLOCKCHAIN_CONTRACT_ADDRESS not set');

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(contractAddress, abiArtifact.abi, this.wallet);
    this.contractAddress = contractAddress;
  }

  /** Convert "deadbeef..." (with or without 0x) into a bytes32 string. */
  static toBytes32Hex(hex) {
    const stripped = String(hex).replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
      throw new Error(`expected 32-byte hex; got '${hex}'`);
    }
    return '0x' + stripped;
  }

  async anchorDPP(dppId, dataHashHex) {
    const dataHashBytes32 = BlockchainClient.toBytes32Hex(dataHashHex);
    const tx = await this.contract.anchorDPP(dppId, dataHashBytes32);
    const receipt = await tx.wait();

    let version = null;
    for (const log of receipt.logs) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name === 'DPPAnchored') {
          version = Number(parsed.args.version);
          break;
        }
      } catch (_e) {
        // not a log we know — skip
      }
    }

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber !== null && receipt.blockNumber !== undefined
        ? Number(receipt.blockNumber)
        : null,
      version,
      contractAddress: this.contractAddress
    };
  }

  async addDocumentHash(dppId, docHashHex) {
    const docBytes32 = BlockchainClient.toBytes32Hex(docHashHex);
    const tx = await this.contract.addDocumentHash(dppId, docBytes32);
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      contractAddress: this.contractAddress
    };
  }

  async getLatestAnchor(dppId) {
    const a = await this.contract.getLatestAnchor(dppId);
    return {
      dataHash: a.dataHash,
      version: Number(a.version),
      blockTimestamp: Number(a.blockTimestamp),
      submitter: a.submitter
    };
  }
}

let cachedClient = null;
let cacheKey = '';

function isEnabled() {
  return process.env.BLOCKCHAIN_ENABLED === 'true';
}

function getClient() {
  if (!isEnabled()) return null;

  const key = [
    process.env.BLOCKCHAIN_RPC_URL,
    process.env.BLOCKCHAIN_PRIVATE_KEY,
    process.env.BLOCKCHAIN_CONTRACT_ADDRESS
  ].join('|');

  if (cachedClient && cacheKey === key) return cachedClient;

  cachedClient = new BlockchainClient({
    rpcUrl: process.env.BLOCKCHAIN_RPC_URL,
    privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY,
    contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS
  });
  cacheKey = key;
  return cachedClient;
}

function reset() {
  cachedClient = null;
  cacheKey = '';
}

module.exports = { BlockchainClient, getClient, isEnabled, reset };
