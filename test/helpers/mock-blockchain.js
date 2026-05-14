'use strict';

/**
 * Deterministic in-memory replacement for srv/lib/blockchain.js. Tests inject
 * it via jest.mock so the outbox worker can run end-to-end without hitting an
 * RPC node.
 */
let counter = 0;
const txs = [];
let failTimes = 0;

function reset() {
  counter = 0;
  txs.length = 0;
  failTimes = 0;
}

function failNext(n) {
  failTimes = n;
}

const client = {
  contractAddress: '0x0000000000000000000000000000000000000099',
  async anchorDPP(dppId, dataHashHex) {
    if (failTimes > 0) {
      failTimes -= 1;
      throw new Error('mock transient failure');
    }
    counter += 1;
    const tx = {
      txHash: '0x' + 'a'.repeat(63) + counter.toString(16),
      blockNumber: 1000 + counter,
      version: counter,
      contractAddress: client.contractAddress,
      dppId,
      dataHashHex
    };
    txs.push(tx);
    return tx;
  },
  async addDocumentHash(dppId, docHashHex) {
    counter += 1;
    return {
      txHash: '0x' + 'b'.repeat(63) + counter.toString(16),
      blockNumber: 2000 + counter,
      contractAddress: client.contractAddress,
      dppId,
      docHashHex
    };
  }
};

module.exports = {
  __esModule: true,
  BlockchainClient: class {},
  isEnabled: () => true,
  getClient: () => client,
  reset,
  failNext,
  __txs: txs
};
