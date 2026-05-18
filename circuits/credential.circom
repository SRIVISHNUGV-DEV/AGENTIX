pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/smt/smtverifier.circom";

/* ============================================================
   SIMPLE MERKLE PROOF (For both active and revoked trees)
   ============================================================ */

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
   CREDENTIAL CIRCUIT (Production Version)
   ============================================================ */

template CredentialCircuit(depth) {
    
    /* =========================================================
       PRIVATE INPUTS
       ========================================================= */
    
    signal input agentId;
    signal input orgId;
    signal input permissions;      // Max allowed value for agent
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
    
    signal input activeRoot;
    signal input revokedRoot;
    signal input maxValue;         // Max value for THIS session
    signal input sessionExpiry;    // When THIS session expires
    
    /* =========================================================
       OUTPUT
       ========================================================= */
    
    signal output nullifier;       // Unique session identifier
    
    /* =========================================================
       1. COMPUTE COMMITMENT (for active tree)
       ========================================================= */
    
    component commitmentHash = Poseidon(5);
    commitmentHash.inputs[0] <== agentId;
    commitmentHash.inputs[1] <== orgId;
    commitmentHash.inputs[2] <== permissions;
    commitmentHash.inputs[3] <== expiry;
    commitmentHash.inputs[4] <== secret;
    
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

    component revocationKeyTrunc = TruncateToNBits(depth);
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
    
    component permissionCheck = LessEqThan(64);
    permissionCheck.in[0] <== maxValue;
    permissionCheck.in[1] <== permissions;
    
    // maxValue must be <= permissions
    permissionCheck.out === 1;
    
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
    
    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== secret;
    nullifierHash.inputs[1] <== sessionNonce;
    
    nullifier <== nullifierHash.out;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

component main {public [activeRoot, revokedRoot, maxValue, sessionExpiry]} = CredentialCircuit(20);
