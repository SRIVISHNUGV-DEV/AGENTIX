const fs = require("fs");
const { buildPoseidon, newMemEmptyTrie } = require("circomlibjs");

// Generates input.json for circuits/credential_V1.circom (CredentialCircuit(20)).
// Field layout (must match the circuit exactly — the previous version of this
// file was stale: Poseidon(5) with a `permissions` field the circuit lacks,
// a 20-bit revocation key, and no wallet/credentialVersion/budgetLimit):
//   commitment   = Poseidon(7)[agentId, orgId, budgetLimit, wallet, expiry,
//                              credentialVersion, secret]
//   secretHash   = Poseidon(2)[secret, 0]
//   revocationKey = secretHash truncated to 64 bits (TruncateToNBits(64))
//   nullifier    = Poseidon(3)[orgId, secret, sessionNonce]
// Constraints the witness must satisfy (asserted below, no circom needed):
//   maxValue <= budgetLimit, sessionExpiry <= expiry.
async function main() {

  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const agentId = 1n;
  const orgId = 1n;
  const budgetLimit = 100n;
  const wallet = 0x1111111111111111111111111111111111111111n;
  const expiry = 2000000000n;
  const credentialVersion = 1n;
  const secret = 123456n;

  const sessionNonce = 999n;
  const maxValue = 7n;
  const sessionExpiry = 1500000000n;

  if (!(maxValue <= budgetLimit)) throw new Error("maxValue exceeds budgetLimit");
  if (!(sessionExpiry <= expiry)) throw new Error("sessionExpiry exceeds credential expiry");

  const depth = 20;

  // commitment = Poseidon(7)[agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret]
  const commitment = BigInt(F.toString(poseidon([agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret])));

  const secretHash = BigInt(F.toString(poseidon([secret, 0n])));
  const revocationKey = secretHash % (1n << 64n);

  // Build simple tree with zero siblings
  let current = commitment;

  const pathElements = [];
  const pathIndices = [];

  for (let i = 0; i < depth; i++) {

    const sibling = 0n;

    pathElements.push("0");
    pathIndices.push(0);

    current = BigInt(F.toString(poseidon([current, sibling])));
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
    budgetLimit: "100",
    wallet: wallet.toString(),
    expiry: "2000000000",
    credentialVersion: "1",
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
  console.log("Revocation key (64-bit):", revocationKey.toString());
}

main();
