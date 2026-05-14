// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FashionDPPRegistry
 * @notice Append-only registry that anchors hashes of off-chain Digital
 *         Product Passports (DPPs) and their evidence documents.
 *
 * Design choices
 * --------------
 * - dppId is a string (e.g. "dpp-001") so the same ID space used by the
 *   off-chain CAP database survives on-chain. We store keccak256(dppId) as
 *   the storage key to avoid bloating storage with long strings while still
 *   exposing the original id through events and call inputs.
 * - Every anchor call appends a new version. There is no overwrite; the
 *   contract is intentionally write-only-append.
 * - Documents are tracked separately so individual certificate PDFs can be
 *   anchored without rewriting the DPP-level hash.
 * - msg.sender is recorded as `submitter` so auditors can reconstruct which
 *   backend wallet vouched for the hash.
 */
contract FashionDPPRegistry {
    struct Anchor {
        bytes32 dataHash;
        uint64  blockTimestamp;
        uint32  version;
        address submitter;
    }

    mapping(bytes32 => Anchor[])  private _dppAnchors;
    mapping(bytes32 => bytes32[]) private _documentHashes;

    event DPPAnchored(
        bytes32 indexed dppIdHash,
        string  dppId,
        bytes32 dataHash,
        uint32  version,
        address indexed submitter,
        uint64  blockTimestamp
    );

    event DocumentHashAdded(
        bytes32 indexed dppIdHash,
        string  dppId,
        bytes32 indexed docHash,
        address indexed submitter
    );

    /// Appends a new anchor for `dppId`. Returns the assigned 1-based version.
    function anchorDPP(string calldata dppId, bytes32 dataHash) external returns (uint32 version) {
        require(dataHash != bytes32(0), "dataHash required");
        bytes32 idHash = keccak256(bytes(dppId));
        version = uint32(_dppAnchors[idHash].length + 1);
        _dppAnchors[idHash].push(Anchor({
            dataHash: dataHash,
            blockTimestamp: uint64(block.timestamp),
            version: version,
            submitter: msg.sender
        }));
        emit DPPAnchored(idHash, dppId, dataHash, version, msg.sender, uint64(block.timestamp));
    }

    /// Records a document fingerprint against a DPP. No versioning — documents
    /// are an unordered set.
    function addDocumentHash(string calldata dppId, bytes32 docHash) external {
        require(docHash != bytes32(0), "docHash required");
        bytes32 idHash = keccak256(bytes(dppId));
        _documentHashes[idHash].push(docHash);
        emit DocumentHashAdded(idHash, dppId, docHash, msg.sender);
    }

    function getDPPAnchor(string calldata dppId, uint32 version) external view returns (Anchor memory) {
        bytes32 idHash = keccak256(bytes(dppId));
        require(version > 0 && version <= _dppAnchors[idHash].length, "no such version");
        return _dppAnchors[idHash][version - 1];
    }

    function getLatestAnchor(string calldata dppId) external view returns (Anchor memory) {
        bytes32 idHash = keccak256(bytes(dppId));
        require(_dppAnchors[idHash].length > 0, "not anchored");
        return _dppAnchors[idHash][_dppAnchors[idHash].length - 1];
    }

    function getDPPVersionCount(string calldata dppId) external view returns (uint256) {
        return _dppAnchors[keccak256(bytes(dppId))].length;
    }

    function getDocumentHashCount(string calldata dppId) external view returns (uint256) {
        return _documentHashes[keccak256(bytes(dppId))].length;
    }

    function getDocumentHash(string calldata dppId, uint256 index) external view returns (bytes32) {
        bytes32[] storage arr = _documentHashes[keccak256(bytes(dppId))];
        require(index < arr.length, "index out of range");
        return arr[index];
    }
}
