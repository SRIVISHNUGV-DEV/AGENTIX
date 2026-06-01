import { describe, it, expect, beforeEach } from "bun:test"
import {
  getProverBackend,
  resetProverBackend,
  SnarkjsProver,
  RapidsnarkProver,
} from "../src/services/fastProver"

describe("SnarkjsProver", () => {
  it("should detect circuit files and be available", () => {
    const prover = new SnarkjsProver()
    expect(prover.available()).toBe(true)
  })

  it("should have correct name", () => {
    expect(new SnarkjsProver().name).toBe("snarkjs")
  })
})

describe("RapidsnarkProver", () => {
  it("should not be available without @iden3/rapidsnark", () => {
    const prover = new RapidsnarkProver()
    expect(prover.available()).toBe(false)
  })

  it("should have correct name", () => {
    expect(new RapidsnarkProver().name).toBe("rapidsnark")
  })
})

describe("getProverBackend", () => {
  it("should return SnarkjsProver in auto mode", () => {
    resetProverBackend()
    delete process.env.PROVER_MODE
    const backend = getProverBackend()
    expect(backend.name).toBe("snarkjs")
  })

  it("should return snarkjs in explicit snarkjs mode", () => {
    resetProverBackend()
    process.env.PROVER_MODE = "snarkjs"
    const backend = getProverBackend()
    expect(backend.name).toBe("snarkjs")
    delete process.env.PROVER_MODE
  })

  it("should fall back to snarkjs when rapidsnark unavailable", () => {
    resetProverBackend()
    process.env.PROVER_MODE = "rapidsnark"
    const backend = getProverBackend()
    expect(backend.name).toBe("snarkjs")
    delete process.env.PROVER_MODE
  })

  it("should cache backend between calls", () => {
    resetProverBackend()
    const backend1 = getProverBackend()
    const backend2 = getProverBackend()
    expect(backend1).toBe(backend2)
  })

  it("should create new backend after reset", () => {
    resetProverBackend()
    const backend = getProverBackend()
    expect(backend.name).toBe("snarkjs")
  })
})

describe("SnarkjsProver.prove", () => {
  it("should throw on minimal circuit input", async () => {
    resetProverBackend()
    const prover = new SnarkjsProver()
    await expect(
      prover.prove({
        agentId: "1",
        orgId: "1",
        permissions: "255",
        expiry: "1800000000",
        secret: "12345",
        sessionNonce: "9999",
        activePathElements: ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
        activePathIndices: ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
        revokedSiblings: ["0"],
        revokedOldKey: "0",
        revokedOldValue: "0",
        revokedIsOld0: 1,
        activeRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
        revokedRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
        maxValue: "255",
        sessionExpiry: "1800000000",
      })
    ).rejects.toThrow()
  })
})
