import { describe, it, expect, beforeAll } from "bun:test"
import { Wallet, verifyMessage } from "ethers"

describe("ActionAuth", () => {
  let wallet: Wallet
  let address: string

  beforeAll(() => {
    wallet = Wallet.createRandom()
    address = wallet.address
  })

  it("should build a valid signed action message", () => {
    const { buildSignedActionMessage } = require("../src/services/actionAuth")
    const message = buildSignedActionMessage({
      action: "CREATE_ORG",
      orgId: 1,
      target: "org:new",
      walletAddress: "0x1234567890123456789012345678901234567890",
      nonce: "test-nonce",
      requestedAt: 1700000000,
    })
    expect(message).toContain("Agentix Authorization")
    expect(message).toContain("CREATE_ORG")
    expect(message).toContain("test-nonce")
    expect(message).toContain("0x1234567890123456789012345678901234567890")
    expect(message).toContain("ChainId: 11155111")
  })

  it("should roundtrip sign and verify", async () => {
    const { buildSignedActionMessage } = require("../src/services/actionAuth")
    const nonce = crypto.randomUUID()
    const requestedAt = Date.now()

    const message = buildSignedActionMessage({
      action: "CREATE_ORG",
      orgId: 1,
      target: "org:new",
      walletAddress: address,
      nonce,
      requestedAt,
    })

    const signature = await wallet.signMessage(message)
    const recovered = verifyMessage(message, signature).toLowerCase()
    expect(recovered).toBe(address.toLowerCase())
  })

  it("should reject signature from wrong wallet", async () => {
    const { buildSignedActionMessage } = require("../src/services/actionAuth")
    const wallet2 = Wallet.createRandom()
    const message = buildSignedActionMessage({
      action: "CREATE_ORG",
      orgId: 1,
      target: "org:new",
      walletAddress: address,
      nonce: crypto.randomUUID(),
      requestedAt: Date.now(),
    })

    const signature = await wallet2.signMessage(message)
    const recovered = verifyMessage(message, signature).toLowerCase()
    expect(recovered).not.toBe(address.toLowerCase())
  })

  it("should include chain ID in message", () => {
    const { buildSignedActionMessage } = require("../src/services/actionAuth")
    const message = buildSignedActionMessage({
      action: "GRANT_CAPABILITY",
      orgId: 5,
      target: "agent:42",
      walletAddress: address,
      nonce: "n",
      requestedAt: 0,
    })
    expect(message).toContain("GRANT_CAPABILITY")
    expect(message).toContain("ChainId: 11155111")
  })
})

describe("Validation Utils", () => {
  it("should validate requireString", () => {
    const { requireString } = require("../src/utils/validation")
    expect(requireString("hello", "test")).toBe("hello")
    expect(() => requireString("", "test")).toThrow()
    expect(() => requireString(undefined, "test")).toThrow()
  })

  it("should validate requireInteger", () => {
    const { requireInteger } = require("../src/utils/validation")
    expect(requireInteger("42", "test")).toBe(42)
    expect(requireInteger(42, "test")).toBe(42)
    expect(() => requireInteger("abc", "test")).toThrow()
    expect(() => requireInteger(-1, "test", 0)).toThrow()
  })

  it("should validate requireEmail", () => {
    const { requireEmail } = require("../src/utils/validation")
    expect(requireEmail("test@example.com", "test")).toBe("test@example.com")
    expect(() => requireEmail("invalid", "test")).toThrow()
  })

  it("should validate requireAddress", () => {
    const { requireAddress } = require("../src/utils/validation")
    expect(requireAddress("0x1234567890123456789012345678901234567890", "test")).toBe("0x1234567890123456789012345678901234567890")
    expect(() => requireAddress("invalid", "test")).toThrow()
    expect(() => requireAddress("0x123", "test")).toThrow()
  })
})

describe("AppError", () => {
  it("should create error with status code", () => {
    const { AppError } = require("../src/utils/errors")
    const error = new AppError(404, "Not found")
    expect(error.statusCode).toBe(404)
    expect(error.message).toBe("Not found")
    expect(error.expose).toBe(true)
  })

  it("should create internal error without exposing message", () => {
    const { AppError } = require("../src/utils/errors")
    const error = new AppError(500, "Internal details", false)
    expect(error.expose).toBe(false)
  })
})

describe("Logger", () => {
  it("should create log entries with correct structure", () => {
    const { logger } = require("../src/utils/logger")
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe("function")
    expect(typeof logger.error).toBe("function")
    expect(typeof logger.warn).toBe("function")
  })
})
