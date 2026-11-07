pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/smt/smtverifier.circom";

/* ============================================================
   SIMPLE MERKLE PROOF (For both active and revoked trees)
   ============================================================ */

/*
 * WHAT: Recomputes a Merkle root from a leaf and its authentication path (Poseidon(2) at each level).
 * WHY: Both the active-membership check and (indirectly, via SMTVerifier) the revocation check need it; one shared template keeps the hash choice consistent. Used with depth = 20 by CredentialCircuit.
 * @param levels Tree depth (number of path elements); the path arrays must have exactly this length.
 * @param leaf The leaf hash to prove (a commitment for the active tree).
 * @param pathElements[levels] Sibling hash at each level, bottom-up. @param pathIndices[levels] 0 = leaf is the left child at that level, 1 = right child; each index is constrained to 0/1 (`x*(1-x) === 0`), so an out-of-range index fails the proof.
 * @returns root The recomputed root; the caller constrains it equal to the public root (`root === activeRoot`). A wrong leaf/path/indices yields a different root and the proof fails.
 * Failure modes: proof generation fails (no satisfying witness) when any pathIndex is not 0/1; verification fails when the recomputed root differs from the claimed root.
 * Maps to: circuit CredentialCircuit active-membership step; contract CredentialRegistry activeRoot (the root it must equal)
 * Side effects / invariants: pure constraint template — no state. The left/right selection is arithmetic (`hash + (sibling - hash) * index`), so the constraint count is fixed per level.
 */
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;
    component hashers[levels];
    signal hashes[levels + 1];

    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== hashes[i] + (pathElements[i] - hashes[i]) * pathIndices[i];
        hashers[i].inputs[1] <== pathElements[i] + (hashes[i] - pathElements[i]) * pathIndices[i];

        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[levels];
}

/*
 * WHAT: Returns the low `bits` bits of a field element — i.e. `in mod 2^bits`.
 * WHY: The revoked sparse tree is keyed by a 64-bit revocation key, but the secret hash is a full ~254-bit field element; truncating to the low 64 bits makes the key fit the sparse tree's key space. Collision note: two secrets whose hashes share the low 64 bits map to the same revocation key — the tree treats them as the same credential for revocation purposes, so revoking one revokes the other (fail-closed direction for the revoked party, but a real collision risk if the key space is ever attacked).
 * @param bits Number of low bits to keep (64 at the call site). @param in Field element to truncate; decomposed with Num2Bits(254), which requires the input to fit in 254 bits (true for any bn254 field element).
 * @returns out The truncated value, `in mod 2^bits`.
 * Failure modes: proof generation fails when `in` cannot be represented in 254 bits (unreachable for field elements).
 * Maps to: circuit CredentialCircuit revocation-key step (TruncateToNBits(64) on the secret hash); contract CredentialRegistry revokedSecretRoot (the tree the key is looked up in)
 * Side effects / invariants: pure constraint template — no state. The accumulator rebuilds the value bit-by-bit, so the output is exactly the low `bits` bits of the input, never a hash of it.
 */
template TruncateToNBits(bits) {
    signal input in;
    signal output out;

    component toBits = Num2Bits(254);
    toBits.in <== in;

    signal acc[bits + 1];
    acc[0] <== 0;

    var coefficient = 1;
    for (var i = 0; i < bits; i++) {
        acc[i + 1] <== acc[i] + toBits.out[i] * coefficient;
        coefficient = coefficient * 2;
    }

    out <== acc[bits];
}

/* ============================================================
   CREDENTIAL CIRCUIT (testnet-only, unaudited — not a production version)
   ============================================================ */

/*
 * WHAT: Proves, in zero knowledge, that the prover holds a credential (agent/org/budget/expiry/version/secret) that is in the active tree, is NOT in the revoked tree, and permits the requested session (maxValue + expiry) — and outputs a session nullifier.
 * WHY: This is the credential check behind standard sessions: the SessionManager never sees the secret, only the proof and 7 public signals. The 7-step structure is the whole trust story — commitment (step 1), revocation key (2), active membership (3), non-revocation (4), budget bound (5), expiry bound (6), nullifier (7).
 * @param depth Tree depth for both Merkle proofs (20 at the call site). Private inputs: agentId, orgId, budgetLimit (max session value the credential allows), expiry (credential expiry), secret (never revealed), sessionNonce (fresh per session), activePathElements/Indices, revokedSiblings/OldKey/OldValue/IsOld0 (sparse-tree non-inclusion witness). Public inputs: wallet, activeRoot, revokedRoot, maxValue, sessionExpiry, credentialVersion.
 * @returns nullifier Poseidon(orgId, secret, sessionNonce) — unique per (credential, session); the registry burns it so the same proof cannot create a second session. NOTE: reusing a sessionNonce with the same secret/org reproduces the same nullifier, so nonces must be fresh per session or the second session creation reverts as a replay.
 * Failure modes: proof generation fails (no witness) when the commitment is not in the active tree, the revocation key IS in the revoked tree, maxValue > budgetLimit, sessionExpiry > expiry, or any bit-bound is violated (values must fit 128/64/160/16 bits as constrained). On-chain, `SessionManager.createSession` additionally reverts when the public signals disagree with the call arguments or the registry roots.
 * Maps to: contract Groth16Verifier.verifyProof (verifies this circuit's proofs); contract SessionManager.createSession (publicSignals[0..6] = activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credentialVersion, nullifier); TS `core/zk-prover.ts` (proof generation); TS SDK credential.ts createCredential
 * Side effects / invariants: pure constraint template — no state. Public signals on-chain are the 6 declared public inputs (in main-component order) PLUS the nullifier output = 7 signals total; the verifier's 7-signal array depends on this exact order. Bit bounds are load-bearing: budget/maxValue are 128-bit, expiries and nonce 64-bit, wallet 160-bit, version 16-bit, agent/org ids 128-bit. Revocation uses fnc=1 with value 0, i.e. a non-inclusion proof for the truncated key.
 * Security note: the secret never leaves the prover (it is a private input, hashed into the commitment and the nullifier). The nullifier is deterministic per (orgId, secret, sessionNonce) — it does not reveal the secret, but the same credential used with the same nonce twice is linkable by identical nullifier; use fresh random nonces.
 */
template CredentialCircuit(depth) {
    
    /* =========================================================
       PRIVATE INPUTS
       ========================================================= */
    
    signal input agentId;
    signal input orgId;
    signal input budgetLimit;      // Max allowed value for agent
    signal input expiry;           // Credential expiry timestamp
    signal input secret;           // Agent's secret
    
    signal input sessionNonce;     // Unique nonce for this session
    
    // Active tree proof (commitment-based)
    signal input activePathElements[depth];
    signal input activePathIndices[depth];
    
    // Revoked sparse tree proof (keyed by truncated secretHash)
    signal input revokedSiblings[depth];
    signal input revokedOldKey;
    signal input revokedOldValue;
    signal input revokedIsOld0;
    
    /* =========================================================
       PUBLIC INPUTS
       ========================================================= */
       
    signal input wallet;
    signal input activeRoot;
    signal input revokedRoot;
    signal input maxValue;         // Max value for THIS session
    signal input sessionExpiry;    // When THIS session expires
    signal input credentialVersion;
    
    /* =========================================================
        BIT BOUNDS
       ========================================================= */

    component budgetBits = Num2Bits(128);
    budgetBits.in <== budgetLimit;

    component maxValueBits = Num2Bits(128);
    maxValueBits.in <== maxValue;

    component expiryBits = Num2Bits(64);
    expiryBits.in <== expiry;

    component sessionExpiryBits = Num2Bits(64);
    sessionExpiryBits.in <== sessionExpiry;

    component sessionNonceBits = Num2Bits(64);
    sessionNonceBits.in <== sessionNonce;

    component walletBits = Num2Bits(160);
    walletBits.in <== wallet;

    component credentialVersionBits = Num2Bits(16);
    credentialVersionBits.in <== credentialVersion;

    component agentIdBits = Num2Bits(128);
    agentIdBits.in <== agentId;

    component orgIdBits = Num2Bits(128);
    orgIdBits.in <== orgId;



    /* =========================================================
       OUTPUT
       ========================================================= */
    
    signal output nullifier;       // Unique session identifier
    
    /* =========================================================
       1. COMPUTE COMMITMENT (for active tree)
       ========================================================= */
    
    component commitmentHash = Poseidon(7);
    commitmentHash.inputs[0] <== agentId;
    commitmentHash.inputs[1] <== orgId;
    commitmentHash.inputs[2] <== budgetLimit;
    commitmentHash.inputs[3] <== wallet;
    commitmentHash.inputs[4] <== expiry;
    commitmentHash.inputs[5] <== credentialVersion;
    commitmentHash.inputs[6] <== secret;
    
    signal commitment;
    commitment <== commitmentHash.out;
    
    /* =========================================================
       2. COMPUTE SECRET HASH (for revoked tree)
       ========================================================= */
    
    component secretHashComp = Poseidon(2);
    secretHashComp.inputs[0] <== secret;
    secretHashComp.inputs[1] <== 0;
    
    signal secretHash;
    secretHash <== secretHashComp.out;
    
    /* =========================================================
       3. VERIFY ACTIVE MEMBERSHIP
       Prove: commitment IS in active tree
       ========================================================= */
    
    component activeMerkle = MerkleProof(depth);
    activeMerkle.leaf <== commitment;
    
    for (var i = 0; i < depth; i++) {
        activeMerkle.pathElements[i] <== activePathElements[i];
        activeMerkle.pathIndices[i] <== activePathIndices[i];
    }
    
    // Computed root must equal public activeRoot
    activeMerkle.root === activeRoot;
    
    /* =========================================================
       4. VERIFY NON-REVOCATION
       Prove: revocationKey is NOT in revoked sparse tree
       ========================================================= */

    component revocationKeyTrunc = TruncateToNBits(64);
    revocationKeyTrunc.in <== secretHash;

    signal revocationKey;
    revocationKey <== revocationKeyTrunc.out;

    component revokedVerifier = SMTVerifier(depth);
    revokedVerifier.enabled <== 1;
    revokedVerifier.root <== revokedRoot;
    revokedVerifier.oldKey <== revokedOldKey;
    revokedVerifier.oldValue <== revokedOldValue;
    revokedVerifier.isOld0 <== revokedIsOld0;
    revokedVerifier.key <== revocationKey;
    revokedVerifier.value <== 0;
    revokedVerifier.fnc <== 1;

    for (var i = 0; i < depth; i++) {
        revokedVerifier.siblings[i] <== revokedSiblings[i];
    }
    
    /* =========================================================
       5. ENFORCE PERMISSION LIMITS
       Session maxValue must not exceed credential permissions
       ========================================================= */
    
    component budgetLimitCheck = LessEqThan(128);
    budgetLimitCheck.in[0] <== maxValue;
    budgetLimitCheck.in[1] <== budgetLimit;
    
    // maxValue must be <= permissions
    budgetLimitCheck.out === 1;
    
    /* =========================================================
       6. ENFORCE SESSION EXPIRY
       Session must expire before or at credential expiry
       ========================================================= */
    
    component expiryCheck = LessEqThan(64);
    expiryCheck.in[0] <== sessionExpiry;
    expiryCheck.in[1] <== expiry;
    
    // sessionExpiry must be <= expiry
    expiryCheck.out === 1;
    
    /* =========================================================
       7. GENERATE NULLIFIER
       Unique identifier for this session (prevents replay)
       ========================================================= */
    
    component nullifierHash = Poseidon(3);
    nullifierHash.inputs[0] <== orgId;
    nullifierHash.inputs[1] <== secret;
    nullifierHash.inputs[2] <== sessionNonce;
    
    nullifier <== nullifierHash.out;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

component main { public 
      [activeRoot,
       revokedRoot,
       maxValue,
       sessionExpiry,
       wallet,
       credentialVersion] } = CredentialCircuit(20);
