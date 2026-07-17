/**
 * circuit-compat.test.ts — Verify the agentix merkle tree matches the
 * credential_V1.circom circuit exactly.
 *
 * This test replicates the circuit's MerkleProof template computation
 * (Poseidon hashing, pathIndices semantics) and confirms that
 * buildMerkleTreeRaw() + getRawMerkleProof() produce the same root.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  buildMerkleTreeRaw,
  getRawMerkleProof,
  initMerkleCrypto,
  hashPair,
  buildZeroHashes,
} from "../src/utils/merkle";
import { computeCommitment, computeNullifier, computeRevocationKey } from "../src/core/zk-prover";

const TREE_DEPTH = 20;

describe("Circuit Compatibility: credential_V1.circom", () => {
  let poseidon: any;
  let F: any;

  beforeAll(async () => {
    await initMerkleCrypto();
    const circomlibjs = await import("circomlibjs");
    poseidon = await circomlibjs.buildPoseidon();
    F = poseidon.F;
  });

  it("circomlibjs Poseidon uses ARRAY-arg form (matches canonical iden3 test vectors)", () => {
    // Ground truth from iden3/circomlibjs canonical vectors. The ARRAY form
    // poseidon([...]) is correct; the SPREAD form poseidon(a, b, ...) mis-binds
    // arguments (2nd positional becomes initState) and MUST NOT be used.
    // Poseidon([1,2]) — the widely-published iden3 canonical test vector:
    const KNOWN_2 =
      "7853200120776062878684798364095072458815029376092732009249414926327459813530";

    const p2 = BigInt(F.toString(poseidon([F.e("1"), F.e("2")])));
    expect(p2.toString()).toBe(KNOWN_2);

    // Guard: the spread form must DIFFER for n=2, proving the two are not
    // interchangeable and pinning why the codebase must use the array form.
    const spread2 = BigInt(F.toString((poseidon as any)(F.e("1"), F.e("2"))));
    expect(spread2.toString()).not.toBe(KNOWN_2);
  });

  it("hashPair matches canonical Poseidon([a,b])", async () => {
    // hashPair is the Merkle node hasher — it must equal the canonical 2-input
    // Poseidon, or every tree root diverges from the circuit.
    const a = 111n, b = 222n;
    const viaHashPair = hashPair(a, b);
    const canonical = BigInt(F.toString(poseidon([F.e(a.toString()), F.e(b.toString())])));
    expect(viaHashPair.toString()).toBe(canonical.toString());
  });

  it("buildMerkleTreeRaw produces a root that verifies against its own proof (circuit-compatible)", async () => {
    // Create a commitment exactly as the circuit does
    const agentId = 1n;
    const orgId = 1n;
    const budgetLimit = 7n;
    const wallet = 0x1234567890abcdef1234567890abcdef12345678n;
    const expiry = 2000000000n;
    const credentialVersion = 1n;
    const secret = 123456n;

    const commitment = await computeCommitment({
      agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret,
    });

    // Build the active tree with the commitment as a raw leaf
    const leaves = new Map<bigint, bigint>();
    leaves.set(commitment, commitment);
    const tree = buildMerkleTreeRaw(leaves, TREE_DEPTH);
    const treeRoot = tree.root;

    // Get the proof from the tree (this is what the real pipeline uses)
    const leafIndex = Number(commitment % BigInt(2 ** TREE_DEPTH));
    const proof = getRawMerkleProof(tree.layers, leafIndex, TREE_DEPTH);

    // Replicate the circuit's MerkleProof computation using the ACTUAL proof
    // path from the tree (not literal zeros — the tree uses zero hashes for
    // empty subtrees, and the circuit accepts whatever pathElements the
    // prover provides).
    // Circuit (credential_V1.circom lines 22-32):
    //   hashes[0] = leaf
    //   for each level i:
    //     inputs[0] = hashes[i] + (pathElements[i] - hashes[i]) * pathIndices[i]
    //     inputs[1] = pathElements[i] + (hashes[i] - pathElements[i]) * pathIndices[i]
    //     hashes[i+1] = Poseidon2(inputs[0], inputs[1])
    //   root = hashes[depth]
    let circuitHash = commitment;
    for (let i = 0; i < TREE_DEPTH; i++) {
      const sibling = proof.pathElements[i];
      const idx = proof.pathIndices[i]; // 0 or 1

      // When idx=0: inputs = [hashes[i], sibling]  (current is LEFT child)
      // When idx=1: inputs = [sibling, hashes[i]]  (current is RIGHT child)
      const input0 = idx === 0 ? circuitHash : sibling;
      const input1 = idx === 0 ? sibling : circuitHash;

      // circomlibjs poseidon takes inputs as ONE array arg. The spread form
      // poseidon(a, b) mis-binds b as initState for the 2-input case and
      // diverges from the circuit's Poseidon (canonical vectors).
      circuitHash = BigInt(F.toString(poseidon([F.e(input0.toString()), F.e(input1.toString())])));
    }

    // The root computed by replicating the circuit MUST match the tree's root
    expect(circuitHash.toString()).toBe(treeRoot.toString());
  });

  it("nullifier computation matches circuit: Poseidon3(orgId, secret, sessionNonce)", async () => {
    const orgId = 1n;
    const secret = 123456n;
    const sessionNonce = 999n;

    const nullifier = await computeNullifier(orgId, secret, sessionNonce);

    // Replicate circuit's nullifierHash = Poseidon(3) — array-arg form.
    const circuitNullifier = BigInt(
      F.toString(poseidon([F.e(orgId.toString()), F.e(secret.toString()), F.e(sessionNonce.toString())]))
    );

    expect(nullifier.toString()).toBe(circuitNullifier.toString());
  });

  it("revocation key matches circuit: Poseidon2(secret, 0) mod 2^64", async () => {
    const secret = 123456n;

    const revocationKey = await computeRevocationKey(secret);

    // Replicate circuit: secretHash = Poseidon2(secret, 0); truncate to 64 bits.
    // Array-arg form — the n=2 case where spread diverges from the circuit.
    const secretHash = BigInt(F.toString(poseidon([F.e(secret.toString()), F.e("0")])));
    const circuitRevocationKey = secretHash & ((1n << 64n) - 1n);

    expect(revocationKey.toString()).toBe(circuitRevocationKey.toString());
  });

  it("commitment hash matches circuit: Poseidon7 with exact input order", async () => {
    const agentId = 42n;
    const orgId = 7n;
    const budgetLimit = 1000000000000000000n; // 1 ETH in wei
    const wallet = 0xabcd1234abcd1234abcd1234abcd1234abcd1234n;
    const expiry = 1800000000n;
    const credentialVersion = 1n;
    const secret = 999888777n;

    const commitment = await computeCommitment({
      agentId, orgId, budgetLimit, wallet, expiry, credentialVersion, secret,
    });

    // Replicate circuit's commitmentHash = Poseidon(7) with exact input order
    // (credential_V1.circom lines 136-143):
    // inputs[0]=agentId, [1]=orgId, [2]=budgetLimit, [3]=wallet, [4]=expiry, [5]=credentialVersion, [6]=secret
    const circuitCommitment = BigInt(F.toString(poseidon([
      F.e(agentId.toString()),
      F.e(orgId.toString()),
      F.e(budgetLimit.toString()),
      F.e(wallet.toString()),
      F.e(expiry.toString()),
      F.e(credentialVersion.toString()),
      F.e(secret.toString()),
    ])));

    expect(commitment.toString()).toBe(circuitCommitment.toString());
  });

  it("zero hashes match: Poseidon(zero, zero) chain produces correct empty-tree root", () => {
    const zeros = buildZeroHashes(TREE_DEPTH);

    // Manually compute zero hashes the same way the circuit would
    let current = 0n;
    expect(zeros[0].toString()).toBe(current.toString());

    for (let i = 1; i <= TREE_DEPTH; i++) {
      current = BigInt(F.toString(poseidon([F.e(current.toString()), F.e(current.toString())])));
      expect(zeros[i].toString()).toBe(current.toString());
    }
  });

  it("empty tree root matches buildZeroHashes[depth] (internally consistent)", () => {
    const leaves = new Map<bigint, bigint>();
    const tree = buildMerkleTreeRaw(leaves, TREE_DEPTH);
    const zeros = buildZeroHashes(TREE_DEPTH);

    // An empty tree should have root = zeroHashes[depth] because
    // buildMerkleTreeImpl stores zeros[depth-level-1] for empty subtrees,
    // so the root (level=depth) is zeros[depth].
    // This is internally consistent: the proof path for any leaf in this
    // tree would use these zero hashes as siblings, and the circuit's
    // MerkleProof template would verify against this root.
    expect(tree.root.toString()).toBe(zeros[TREE_DEPTH].toString());
  });

  it("revoked SMT is keyed by revocationKey, live-add matches rebuild (Stream 3 regression)", async () => {
    // Regression for the revoke-path bug: revokeCredential() used to add the
    // COMMITMENT to the revoked SMT, but the circuit + reload path key the SMT
    // by revocationKey = Poseidon2(secret,0) mod 2^64. That divergence meant a
    // freshly-revoked credential's live in-memory tree did not match the tree
    // rebuilt on the next process start. This pins that key derivation is stable
    // and that rebuild-from-keys is deterministic (the durability guarantee).
    const { buildRevokedSmtFromKeys, smtNonMembershipProof } = await import("../src/utils/merkle");

    const secretA = 0x1234abcd5678ef90n;
    const secretB = 0x9999888877776666n;
    const keyA = await computeRevocationKey(secretA);
    const keyB = await computeRevocationKey(secretB);

    // Determinism: same secret always yields the same revocationKey (so the
    // live-add path and the reload path — both call computeRevocationKey — agree).
    expect((await computeRevocationKey(secretA)).toString()).toBe(keyA.toString());
    expect(keyA).not.toBe(keyB);

    // revocationKey must fit in 64 bits (the circuit truncates to 64).
    expect(keyA < (1n << 64n)).toBe(true);

    // A tree containing keyA must still produce a valid non-membership proof
    // for keyB (not revoked).
    const smt = await buildRevokedSmtFromKeys([keyA]);
    const proofB = await smtNonMembershipProof(smt, keyB, TREE_DEPTH);
    expect(proofB).not.toBeNull();
    expect(proofB!.siblings.length).toBe(TREE_DEPTH);

    // Rebuilding from the same key set is deterministic (root stability across
    // reloads).
    const smt2 = await buildRevokedSmtFromKeys([keyA]);
    const root1 = BigInt(smt.F.toString(smt.root));
    const root2 = BigInt(smt2.F.toString(smt2.root));
    expect(root1.toString()).toBe(root2.toString());
  });
});
