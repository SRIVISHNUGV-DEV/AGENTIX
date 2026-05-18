const fs = require("fs");
const { buildPoseidon } = require("circomlibjs");
const { newMemEmptyTrie } = require("circomlibjs");

async function main() {

  const poseidon = await buildPoseidon();

  const agentId = 1n;
  const orgId = 1n;
  const permissions = 7n;
  const expiry = 2000000000n;
  const secret = 123456n;

  const sessionNonce = 999n;

  const depth = 20;

  // commitment = Poseidon(agentId, orgId, permissions, expiry, secret)
  const commitment = BigInt(
    poseidon([agentId, orgId, permissions, expiry, secret]).toString()
  );

  const secretHash = BigInt(
    poseidon([secret, 0n]).toString()
  );
  const revocationKey = secretHash % (1n << BigInt(depth));

  // Build simple tree with zero siblings
  let current = commitment;

  const pathElements = [];
  const pathIndices = [];

  for (let i = 0; i < depth; i++) {

    const sibling = 0n;

    pathElements.push("0");
    pathIndices.push(0);

    current = BigInt(poseidon([current, sibling]).toString());
  }

  const root = current;

  const revokedTree = await newMemEmptyTrie();
  const revokedResult = await revokedTree.find(revocationKey);
  const revokedSiblings = revokedResult.siblings.map((sibling) =>
    revokedTree.F.toString(sibling)
  );

  while (revokedSiblings.length < depth) {
    revokedSiblings.push("0");
  }

  const input = {
    agentId: "1",
    orgId: "1",
    permissions: "7",
    expiry: "2000000000",
    secret: "123456",
    sessionNonce: "999",

    activePathElements: pathElements,
    activePathIndices: pathIndices,
    revokedSiblings,
    revokedOldKey: revokedResult.isOld0 ? "0" : revokedTree.F.toString(revokedResult.notFoundKey),
    revokedOldValue: revokedResult.isOld0 ? "0" : revokedTree.F.toString(revokedResult.notFoundValue),
    revokedIsOld0: revokedResult.isOld0 ? 1 : 0,

    activeRoot: root.toString(),
    revokedRoot: revokedTree.F.toString(revokedTree.root),

    maxValue: "7",
    sessionExpiry: "1500000000"
  };

  fs.writeFileSync("input.json", JSON.stringify(input, null, 2));

  console.log("Generated input.json");
  console.log("Commitment:", commitment.toString());
  console.log("Merkle Root:", root.toString());
}

main();
