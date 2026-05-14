const hre = require('hardhat');

async function main() {
  const Factory = await hre.ethers.getContractFactory('FashionDPPRegistry');
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('FashionDPPRegistry deployed to:', addr);
  console.log('Network:', hre.network.name, 'chainId:', (await hre.ethers.provider.getNetwork()).chainId.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
