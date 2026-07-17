/**
 * 25-zk-session.test.ts — Verify the ZK-proof-gated (standard) session wiring.
 *
 * This is the privacy USP path: a credential proof authorizes the session with
 * NO owner signature. This test proves the encode layer produces calldata that
 * decodes EXACTLY into the on-chain SessionManager.createSession signature,
 * wrapped in AgentWallet.execute — i.e. the tx a wallet would actually relay.
 *
 * We do not run the multi-second Groth16 prover here (that's covered by the
 * prover/circuit tests). We assert the calldata contract: given a proof-shaped
 * {a,b,c,publicSignals}, the encoded tx is structurally what the deployed
 * contracts require. A structural mismatch here = an on-chain revert.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";
import { encodeStandardSession } from "../src/blockchain/adapter";
import { getAbiByName } from "../src/contracts";
import { loadConfig } from "../src/core/config";

describe("ZK Session: proof -> createSession -> wallet.execute", () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  const sessionKey = "0x2222222222222222222222222222222222222222";
  const maxValue = ethers.parseEther("0.1").toString();
  const expiry = Math.floor(Date.now() / 1000) + 86400;

  // A representative proof shape. Values are field-element decimal strings, as
  // snarkjs.formatCalldata emits. publicSignals MUST be length 7:
  // [activeRoot, revokedRoot, maxValue, sessionExpiry, wallet, credVersion, nullifier]
  const proof = {
    a: ["1", "2"] as [string, string],
    b: [["3", "4"], ["5", "6"]] as [[string, string], [string, string]],
    c: ["7", "8"] as [string, string],
    publicSignals: [
      "111",                             // activeRoot
      "222",                             // revokedRoot
      maxValue,                          // maxValue (must match arg)
      String(expiry),                    // sessionExpiry (must match arg)
      BigInt(wallet).toString(),         // wallet (must match arg)
      "1",                               // credentialVersion
      "999",                             // nullifier
    ],
  };

  let smIface: ethers.Interface;
  let walletIface: ethers.Interface;

  beforeAll(() => {
    smIface = new ethers.Interface(getAbiByName("SessionManager"));
    walletIface = new ethers.Interface(getAbiByName("AgentWallet"));
  });

  it("rejects a proof without exactly 7 public signals", () => {
    expect(() =>
      encodeStandardSession({
        walletAddress: wallet,
        sessionKey,
        maxValue,
        expiry,
        proof: { ...proof, publicSignals: proof.publicSignals.slice(0, 6) },
      })
    ).toThrow(/7 public signals/);
  });

  it("encodes a tx addressed to the wallet (contract requires msg.sender == wallet)", () => {
    const enc = encodeStandardSession({ walletAddress: wallet, sessionKey, maxValue, expiry, proof });
    expect(enc.to.toLowerCase()).toBe(wallet.toLowerCase());
    expect(enc.value).toBe("0x0");
    expect(enc.sessionId).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(enc.expiry).toBe(expiry);
  });

  it("outer calldata is AgentWallet.execute(sessionManager, 0, <createSession>)", () => {
    const config = loadConfig();
    const enc = encodeStandardSession({ walletAddress: wallet, sessionKey, maxValue, expiry, proof });

    const outer = walletIface.parseTransaction({ data: enc.data });
    expect(outer?.name).toBe("execute");
    expect((outer!.args[0] as string).toLowerCase()).toBe(config.contracts.sessionManager.toLowerCase());
    expect(outer!.args[1]).toBe(0n); // no ETH value moved to open the session
  });

  it("inner calldata decodes EXACTLY into createSession with the proof intact", () => {
    const enc = encodeStandardSession({ walletAddress: wallet, sessionKey, maxValue, expiry, proof });
    const outer = walletIface.parseTransaction({ data: enc.data })!;
    const innerData = outer.args[2] as string;

    const inner = smIface.parseTransaction({ data: innerData });
    expect(inner?.name).toBe("createSession");

    // createSession(sessionId, wallet, sessionKey, maxValue, expiry, a, b, c, publicSignals)
    expect(inner!.args[0]).toBe(enc.sessionId);
    expect((inner!.args[1] as string).toLowerCase()).toBe(wallet.toLowerCase());
    expect((inner!.args[2] as string).toLowerCase()).toBe(sessionKey.toLowerCase());
    expect(inner!.args[3]).toBe(BigInt(maxValue));
    expect(inner!.args[4]).toBe(BigInt(expiry));

    // Proof components survive encoding byte-for-byte.
    expect((inner!.args[5] as bigint[]).map(String)).toEqual(proof.a);
    const b = inner!.args[6] as bigint[][];
    expect(b.map((row) => row.map(String))).toEqual(proof.b);
    expect((inner!.args[7] as bigint[]).map(String)).toEqual(proof.c);

    const ps = inner!.args[8] as bigint[];
    expect(ps.length).toBe(7);
    expect(ps.map(String)).toEqual(proof.publicSignals);
  });

  it("public signals bind wallet/maxValue/expiry — the values the contract cross-checks", () => {
    // SessionManager.createSession reverts unless publicSignals[2]==maxValue,
    // [3]==expiry, [4]==wallet. Encoding must keep them consistent so a real
    // proof passes those require() checks.
    const enc = encodeStandardSession({ walletAddress: wallet, sessionKey, maxValue, expiry, proof });
    const inner = smIface.parseTransaction({
      data: walletIface.parseTransaction({ data: enc.data })!.args[2] as string,
    })!;
    const ps = (inner.args[8] as bigint[]).map(String);
    expect(ps[2]).toBe(maxValue);
    expect(ps[3]).toBe(String(expiry));
    expect(ps[4]).toBe(BigInt(wallet).toString());
  });
});
