/**
 * 29-bundler-revert-decode.test.ts — proves the bundler decodes real UserOp
 * outcomes instead of reporting every mined handleOps tx as success.
 *
 * EntryPoint catches inner-call reverts and STILL mines the handleOps tx,
 * emitting UserOperationEvent{success:false} + UserOperationRevertReason. The
 * bundler must surface that revert reason, not a false success.
 */
import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { decodeRevertReason } from "../src/runtime/bundler";

describe("bundler revert-reason decoding", () => {
  it("decodes a standard Error(string) revert payload", () => {
    // abi.encodeWithSelector(Error.selector, "LimitExceeded")
    const encoded = "0x08c379a0" + ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["LimitExceeded"]).slice(2);
    expect(decodeRevertReason(encoded)).toBe("LimitExceeded");
  });

  it("decodes a SessionExpired reason", () => {
    const encoded = "0x08c379a0" + ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["SessionExpired"]).slice(2);
    expect(decodeRevertReason(encoded)).toBe("SessionExpired");
  });

  it("returns 'no reason' for empty payloads", () => {
    expect(decodeRevertReason("0x")).toBe("no reason");
    expect(decodeRevertReason("")).toBe("no reason");
  });

  it("falls back to raw hex for custom-error selectors (not Error(string))", () => {
    // A 4-byte custom error selector with no string payload, e.g. LimitExceeded()
    const custom = "0xdeadbeef";
    expect(decodeRevertReason(custom)).toBe(custom);
  });
});
