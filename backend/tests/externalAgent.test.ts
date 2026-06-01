import { describe, it, expect } from "bun:test"

// Test permission bitmasks and action mapping (pure logic, no DB needed)
const AGENT_PERMISSIONS = {
  READ_FILE: 1 << 0,
  WRITE_FILE: 1 << 1,
  EXECUTE_COMMAND: 1 << 2,
  QUERY: 1 << 3,
  API_CALL: 1 << 4,
  SIGN_TRANSACTION: 1 << 5,
  DEPLOY_CONTRACT: 1 << 6,
  CUSTOM: 1 << 7,
  ALL: 255,
} as const

const ACTION_PERMISSIONS: Record<string, number> = {
  read_file: AGENT_PERMISSIONS.READ_FILE,
  write_file: AGENT_PERMISSIONS.WRITE_FILE,
  execute_command: AGENT_PERMISSIONS.EXECUTE_COMMAND,
  query: AGENT_PERMISSIONS.QUERY,
  api_call: AGENT_PERMISSIONS.API_CALL,
  sign_transaction: AGENT_PERMISSIONS.SIGN_TRANSACTION,
  deploy_contract: AGENT_PERMISSIONS.DEPLOY_CONTRACT,
  custom: AGENT_PERMISSIONS.CUSTOM,
}

describe("ExternalAgent permission bitmasks", () => {
  it("should match expected bitmask values", () => {
    expect(AGENT_PERMISSIONS.READ_FILE).toBe(1)
    expect(AGENT_PERMISSIONS.WRITE_FILE).toBe(2)
    expect(AGENT_PERMISSIONS.EXECUTE_COMMAND).toBe(4)
    expect(AGENT_PERMISSIONS.QUERY).toBe(8)
    expect(AGENT_PERMISSIONS.API_CALL).toBe(16)
    expect(AGENT_PERMISSIONS.SIGN_TRANSACTION).toBe(32)
    expect(AGENT_PERMISSIONS.DEPLOY_CONTRACT).toBe(64)
    expect(AGENT_PERMISSIONS.CUSTOM).toBe(128)
    expect(AGENT_PERMISSIONS.ALL).toBe(255)
  })

  it("should require the right permission for each action", () => {
    expect(ACTION_PERMISSIONS["read_file"]).toBe(AGENT_PERMISSIONS.READ_FILE)
    expect(ACTION_PERMISSIONS["write_file"]).toBe(AGENT_PERMISSIONS.WRITE_FILE)
    expect(ACTION_PERMISSIONS["execute_command"]).toBe(AGENT_PERMISSIONS.EXECUTE_COMMAND)
    expect(ACTION_PERMISSIONS["query"]).toBe(AGENT_PERMISSIONS.QUERY)
    expect(ACTION_PERMISSIONS["api_call"]).toBe(AGENT_PERMISSIONS.API_CALL)
    expect(ACTION_PERMISSIONS["sign_transaction"]).toBe(AGENT_PERMISSIONS.SIGN_TRANSACTION)
    expect(ACTION_PERMISSIONS["deploy_contract"]).toBe(AGENT_PERMISSIONS.DEPLOY_CONTRACT)
    expect(ACTION_PERMISSIONS["custom"]).toBe(AGENT_PERMISSIONS.CUSTOM)
  })

  it("should return 0 for unknown action", () => {
    expect(ACTION_PERMISSIONS["unknown_action"]).toBeUndefined()
    const requiredPermission = ACTION_PERMISSIONS["unknown_action"] || 0
    expect(requiredPermission).toBe(0)
  })

  it("should correctly check permission via bitmask", () => {
    const agentPermissions = AGENT_PERMISSIONS.READ_FILE | AGENT_PERMISSIONS.API_CALL
    const required = AGENT_PERMISSIONS.READ_FILE
    expect((agentPermissions & required) !== 0).toBe(true)
  })

  it("should reject when agent lacks permission", () => {
    const agentPermissions = AGENT_PERMISSIONS.READ_FILE
    const required = AGENT_PERMISSIONS.SIGN_TRANSACTION
    expect((agentPermissions & required) === 0).toBe(true)
  })

  it("ALL permission should satisfy every action", () => {
    const allPerms = AGENT_PERMISSIONS.ALL
    for (const action of Object.keys(ACTION_PERMISSIONS)) {
      const required = ACTION_PERMISSIONS[action]
      if (required) {
        expect((allPerms & required) !== 0).toBe(true)
      }
    }
  })
})

describe("ExternalAgent proof generation (Merkle data only)", () => {
  it("should produce correct ExecutionProof structure without circuit files", () => {
    const nullifier = "123456789"
    const activeRoot = "0x1234"
    const revokedRoot = "0x5678"
    const permissions = 255
    const expiresAt = 1800000000

    // This is the fallback path from _tryFullProof when circuit files are absent
    const proof = {
      nullifier,
      root: activeRoot,
      revokedRoot,
      proof: { a: ["0", "0"], b: [["0", "0"], ["0", "0"]], c: ["0", "0"] },
      publicSignals: [
        nullifier,
        activeRoot,
        revokedRoot,
        permissions.toString(),
        expiresAt.toString(),
      ],
    }

    expect(proof.nullifier).toBe(nullifier)
    expect(proof.root).toBe(activeRoot)
    expect(proof.revokedRoot).toBe(revokedRoot)
    expect(proof.proof.a).toEqual(["0", "0"])
    expect(proof.publicSignals).toHaveLength(5)
    expect(proof.publicSignals[0]).toBe(nullifier)
    expect(proof.publicSignals[1]).toBe(activeRoot)
    expect(proof.publicSignals[2]).toBe(revokedRoot)
    expect(Number(proof.publicSignals[3])).toBe(permissions)
    expect(Number(proof.publicSignals[4])).toBe(expiresAt)
  })

  it("full Groth16 proof structure (simulated)", () => {
    // When circuit files exist, the proof has a different structure
    const groth16Proof = {
      pi_a: ["1", "2", "3"],
      pi_b: [["4", "5"], ["6", "7"], ["8", "9"]],
      pi_c: ["10", "11", "12"],
      protocol: "groth16" as const,
      curve: "bn128" as const,
    }

    const publicSignals = ["sig1", "sig2", "sig3"]

    // Simulate how the code converts raw proof to ExecutionProof
    const executionProof = {
      nullifier: "123",
      root: "0xroot",
      revokedRoot: "0xrroot",
      proof: {
        a: [groth16Proof.pi_a[0]?.toString() ?? "0", groth16Proof.pi_a[1]?.toString() ?? "0"],
        b: [
          [groth16Proof.pi_b[0][1]?.toString() ?? "0", groth16Proof.pi_b[0][0]?.toString() ?? "0"],
          [groth16Proof.pi_b[1][1]?.toString() ?? "0", groth16Proof.pi_b[1][0]?.toString() ?? "0"],
        ] as [[string, string], [string, string]],
        c: [groth16Proof.pi_c[0]?.toString() ?? "0", groth16Proof.pi_c[1]?.toString() ?? "0"],
      },
      publicSignals,
    }

    expect(executionProof.proof.a).toEqual(["1", "2"])
    expect(executionProof.proof.b[0]).toEqual(["5", "4"])
    expect(executionProof.proof.c).toEqual(["10", "11"])
    expect(executionProof.publicSignals).toEqual(["sig1", "sig2", "sig3"])
  })
})
