const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('FashionDPPRegistry', function () {
  let registry;
  let deployer;
  let other;

  beforeEach(async () => {
    [deployer, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('FashionDPPRegistry');
    registry = await Factory.deploy();
    await registry.waitForDeployment();
  });

  it('appends anchors and assigns sequential versions', async () => {
    const dppId = 'dpp-001';
    const h1 = ethers.id('hash-v1');
    const h2 = ethers.id('hash-v2');

    await expect(registry.anchorDPP(dppId, h1))
      .to.emit(registry, 'DPPAnchored')
      .withArgs(ethers.keccak256(ethers.toUtf8Bytes(dppId)), dppId, h1, 1, deployer.address, (n) => n > 0n);

    await registry.anchorDPP(dppId, h2);
    const latest = await registry.getLatestAnchor(dppId);
    expect(latest.dataHash).to.equal(h2);
    expect(latest.version).to.equal(2);
    expect(await registry.getDPPVersionCount(dppId)).to.equal(2);
  });

  it('rejects zero data hash', async () => {
    await expect(registry.anchorDPP('dpp-x', ethers.ZeroHash)).to.be.revertedWith('dataHash required');
  });

  it('records document hashes as an unordered set', async () => {
    const dppId = 'dpp-002';
    const d1 = ethers.id('doc-1');
    const d2 = ethers.id('doc-2');
    await registry.addDocumentHash(dppId, d1);
    await registry.connect(other).addDocumentHash(dppId, d2);

    expect(await registry.getDocumentHashCount(dppId)).to.equal(2);
    expect(await registry.getDocumentHash(dppId, 0)).to.equal(d1);
    expect(await registry.getDocumentHash(dppId, 1)).to.equal(d2);
  });

  it('reverts when reading anchors for an unknown DPP', async () => {
    await expect(registry.getLatestAnchor('unknown')).to.be.revertedWith('not anchored');
    await expect(registry.getDPPAnchor('unknown', 1)).to.be.revertedWith('no such version');
  });
});
