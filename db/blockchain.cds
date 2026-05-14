using { managed } from '@sap/cds/common';
using { dpp.identified } from './common';
using { dpp.DPPs, dpp.Documents } from './dpp';
using { dpp.Sha256Hex, dpp.TxHash, dpp.AnchorStatus } from './common';

namespace dpp;

entity BlockchainAnchors : identified, managed {
  dpp              : Association to DPPs       not null;
  document         : Association to Documents;
  data_hash        : Sha256Hex                  not null;
  tx_hash          : TxHash;
  network          : String(30) not null default 'polygon-amoy';
  chain_id         : Integer    not null default 80002;
  contract_address : String(42);
  block_number     : Integer64;
  status           : AnchorStatus not null default 'pending';
  error_message    : String(500);
  attempts         : Integer not null default 0;
  next_attempt_at  : Timestamp;
  anchored_at      : Timestamp;
  version          : Integer not null default 1;
}

annotate BlockchainAnchors with @assert.unique : { txHash : [tx_hash] };
