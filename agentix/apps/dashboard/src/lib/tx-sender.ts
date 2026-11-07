import { postJSON } from "./api";

export interface PreparedTx {
  to: string;
  data: string;
  value: string;
  chainId: number;
  gasLimit?: string;
}

export interface SendResult {
  txHash: string;
  receipt: any;
  walletAddress?: string;
}

/**
 * Returns the injected wallet provider, or throws when there is none.
 * @returns `window.ethereum`.
 * @throws Error "No wallet detected — install MetaMask" when no injected provider exists.
 * Maps to: wallet — injected `window.ethereum` provider.
 */
function getEthereum(): any {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet detected — install MetaMask");
  return eth;
}

/**
 * Returns the first currently connected wallet account.
 * @returns The account address.
 * @throws When no wallet is injected, or when no account is connected (user must connect first).
 * Maps to: wallet — `eth_accounts` on the injected provider.
 */
async function getAccount(): Promise<string> {
  const eth = getEthereum();
  const accounts = await eth.request({ method: "eth_accounts" });
  if (!accounts[0]) throw new Error("No account connected — connect your wallet");
  return accounts[0];
}

/**
 * Switches the wallet to `chainId` before a transaction is sent.
 * @param chainId - Decimal chain id (converted to hex for the wallet request).
 * @returns void.
 * @throws Re-throws a user rejection unchanged; for unknown chain (code 4902) throws a friendly "switch manually" error instead of attempting `wallet_addEthereumChain`.
 * Maps to: wallet — `wallet_switchEthereumChain` on the injected provider.
 * Side effects: changes the wallet's active chain (user-confirmed in the wallet).
 */
async function switchChain(chainId: number): Promise<void> {
  const eth = getEthereum();
  const hexChainId = "0x" + chainId.toString(16);
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (e: any) {
    if (e.code === 4902) {
      throw new Error(`Please switch to chain ${chainId} in your wallet`);
    }
    throw e;
  }
}

/**
 * Sends one signed transaction via the wallet and waits for its receipt.
 * Polls `eth_getTransactionReceipt` up to 60 times at 2s intervals (~120s max) before giving up.
 * @param tx - PreparedTx; `value` defaults to "0x0" and gas defaults to 0x4C4B40 (5,000,000) when `gasLimit` is omitted.
 * @returns `{ txHash, receipt }` (`walletAddress` is undefined here — only the wallet-creation wrapper adds it).
 * @throws On no wallet/account, user rejection, receipt timeout ("Transaction timeout — check your wallet for status"), or an on-chain revert — a revert is re-simulated via the server to surface the exact reason when possible, otherwise reported as generic "Transaction reverted on-chain".
 * Maps to: wallet — `eth_sendTransaction` / `eth_getTransactionReceipt`; Maps to: REST POST /api/debug/simulate (revert-reason path only).
 * Side effects: on-chain transaction; moves value when `tx.value` is set.
 * Security: the user signs in their wallet; the calldata is server-prepared, so a compromised server could propose arbitrary calls — the wallet prompt is the last check.
 */
export async function sendTransaction(tx: PreparedTx): Promise<SendResult> {
  const eth = getEthereum();
  const from = await getAccount();

  await switchChain(tx.chainId);

  const txHash = await eth.request({
    method: "eth_sendTransaction",
    params: [{
      from,
      to: tx.to,
      data: tx.data,
      value: tx.value || "0x0",
      gas: tx.gasLimit || "0x4C4B40",
    }],
  });

  let receipt = null;
  for (let i = 0; i < 60; i++) {
    receipt = await eth.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });
    if (receipt) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!receipt) throw new Error("Transaction timeout — check your wallet for status");
  if (receipt.status === "0x0") {
    // The server simulates the call from the owner via RPC to capture the exact revert reason
    try {
      const { postJSON } = await import("./api");
      const debug = await postJSON<any>("/api/debug/simulate", {
        from,         // owner's address (who calls wallet.execute)
        to: tx.to,    // wallet address
        data: tx.data,
        value: tx.value || "0x0",
      });
      const reason = debug.reason || debug.error || "unknown";
      throw new Error(`Revert: ${reason}`);
    } catch (err: any) {
      if (err.message?.startsWith("Revert:")) throw err;
      throw new Error("Transaction reverted on-chain");
    }
  }

  return { txHash, receipt };
}

/**
 * Deploys an AgentWallet through the factory and confirms it with the server; returns the new wallet address.
 * Parses the WalletCreated log from the receipt (4 topics: sig + wallet + owner + salt); if no such log matches, a looser pass accepts any factory log with >= 2 topics and reads topics[1] as the wallet.
 * @param ownerAddress - EOA that will own the new wallet.
 * @param harnessId - Optional harness id to bind the wallet 1:1 to a harness.
 * @returns SendResult plus `walletAddress` (checksummed from the log topic).
 * @throws When tx preparation fails, the tx reverts/times out, or no wallet address can be extracted from the receipt logs. Note the loose fallback pass can misread a non-WalletCreated factory log, so treat the address as unconfirmed until `/api/wallets/confirm` succeeds.
 * Maps to: REST POST /api/wallets/create-tx and POST /api/wallets/confirm; Maps to: contract AgentWalletFactory.createWallet (WalletCreated event).
 * Side effects: on-chain wallet deployment (owner pays gas); server-side wallet record.
 */
export async function sendAndWaitForWalletCreation(
  ownerAddress: string,
  harnessId?: string
): Promise<SendResult & { walletAddress: string }> {
  const txData = await postJSON<any>("/api/wallets/create-tx", { ownerAddress });
  if (!txData.success) throw new Error(txData.error || "Failed to prepare wallet transaction");

  const factoryAddress = txData.to || txData.factoryAddress;
  const calldata = txData.data || txData.calldata;

  const result = await sendTransaction({
    to: factoryAddress,
    data: calldata,
    value: "0x0",
    chainId: txData.chainId,
  });

  let walletAddress = "";
  // Parse WalletCreated event from receipt logs
  if (result.receipt.logs) {
    for (const log of result.receipt.logs) {
      // WalletCreated has 4 topics (sig + 3 indexed): [sig, wallet, owner, salt]
      // Non-indexed entryPoint is in data
      if (log.address?.toLowerCase() === factoryAddress.toLowerCase() && log.topics?.length >= 4) {
        walletAddress = "0x" + log.topics[1].slice(26);
        break;
      }
    }
  }

  if (!walletAddress && result.receipt.logs) {
    for (const log of result.receipt.logs) {
      if (
        log.address?.toLowerCase() === factoryAddress.toLowerCase() &&
        log.topics?.length >= 2
      ) {
        walletAddress = "0x" + log.topics[1].slice(26);
        break;
      }
    }
  }

  if (!walletAddress) throw new Error("Could not extract wallet address from receipt");

  await postJSON<any>("/api/wallets/confirm", {
    walletAddress,
    ownerAddress,
    txHash: result.txHash,
    harnessId,
    actualToAddress: factoryAddress,
  });

  return { ...result, walletAddress };
}

/**
 * Executes a call from an AgentWallet: prepares `wallet.execute(to, value, data)` server-side, then sends it via the owner's wallet.
 * The outer transaction itself carries value "0x0" — the ETH in `value` is spent by the wallet contract, not by the owner transaction.
 * @param walletAddress - The AgentWallet proxy to execute from.
 * @param to - Target contract address of the inner call.
 * @param value - ETH value for the inner call, as a wei string.
 * @param data - Inner calldata; defaults to "0x" (plain value transfer).
 * @returns The SendResult of the outer transaction.
 * @throws When preparation fails or the outer transaction reverts/times out.
 * Maps to: REST POST /api/wallets/execute-tx; Maps to: contract AgentWallet.execute.
 * Side effects: on-chain execution from the wallet; moves value when `value` is set.
 * Security: `to`/`value`/`data` are caller-supplied — the wallet's session/policy checks are the only guard; never call with an untrusted target.
 */
export async function sendWalletExec(
  walletAddress: string,
  to: string,
  value: string,
  data: string = "0x"
): Promise<SendResult> {
  const txData = await postJSON<any>("/api/wallets/execute-tx", {
    walletAddress,
    to,
    value,
    data,
  });
  if (!txData.success) throw new Error(txData.error || "Failed to prepare execution");

  return sendTransaction({
    to: walletAddress,
    data: txData.data,
    value: "0x0",
    chainId: txData.chainId,
  });
}

/**
 * Deposits ETH into an AgentWallet (funds the wallet itself, not the EntryPoint).
 * @param walletAddress - The AgentWallet proxy receiving the deposit.
 * @param amountEth - Amount in ETH, as the server expects it for deposit-tx preparation.
 * @returns The SendResult of the deposit transaction.
 * @throws When preparation fails or the transaction reverts/times out.
 * Maps to: REST POST /api/wallets/deposit-tx; Maps to: contract AgentWallet (payable receive).
 * Side effects: on-chain value transfer of `amountEth` to the wallet.
 */
export async function sendDeposit(
  walletAddress: string,
  amountEth: string
): Promise<SendResult> {
  const txData = await postJSON<any>("/api/wallets/deposit-tx", {
    walletAddress,
    amountEth,
  });
  if (!txData.success) throw new Error(txData.error || "Failed to prepare deposit");

  return sendTransaction({
    to: walletAddress,
    data: txData.data,
    value: txData.value,
    chainId: txData.chainId,
  });
}

// Posts to /api/credentials/update-root, which now PROPOSES the root:
// the root changes only after the 2-day timelock + accept-root. Callers
// must not present this as "root updated".
/**
 * Proposes a new credential Merkle root. This only PROPOSES — the root activates only after the 2-day timelock plus accept-root, so callers must not present this as "root updated".
 * @param root - The new Merkle root (hex).
 * @returns `{ success, txHash?, error? }` — failure is reported in-band, not thrown, so check `success`.
 * @throws Only on transport failure (fetch error); a rejected proposal comes back as `success: false`.
 * Maps to: REST POST /api/credentials/update-root; Maps to: contract CredentialRegistry.proposeActiveRoot.
 * Side effects: none on-chain by itself beyond the proposal transaction the server relays.
 */
export async function sendProposeRoot(root: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  return postJSON<any>("/api/credentials/update-root", { root });
}

/**
 * Accepts the pending credential Merkle root after the timelock has elapsed.
 * @returns `{ success, txHash?, error? }` — failure is reported in-band, not thrown, so check `success` (e.g. calling before the timelock expires fails here).
 * @throws Only on transport failure.
 * Maps to: REST POST /api/credentials/accept-root; Maps to: contract CredentialRegistry.acceptActiveRoot.
 * Side effects: activates the pending root on-chain (via the server-relayed transaction).
 */
export async function sendAcceptRoot(): Promise<{ success: boolean; txHash?: string; error?: string }> {
  return postJSON<any>("/api/credentials/accept-root", {});
}

/**
 * Deposits ETH to the ERC-4337 EntryPoint on behalf of a wallet, so the bundler can sponsor its gas.
 * @param walletAddress - The AgentWallet the deposit is credited to.
 * @param amountEth - Amount in ETH, as the server expects it for entrypoint-deposit-tx preparation.
 * @returns The SendResult of the deposit transaction.
 * @throws When preparation fails or the transaction reverts/times out.
 * Maps to: REST POST /api/wallets/entrypoint-deposit-tx; Maps to: contract EntryPoint.depositTo.
 * Side effects: on-chain value transfer to the EntryPoint.
 */
export async function sendEntryPointDeposit(
  walletAddress: string,
  amountEth: string
): Promise<SendResult> {
  const txData = await postJSON<any>("/api/wallets/entrypoint-deposit-tx", {
    walletAddress,
    amountEth,
  });
  if (!txData.success) throw new Error(txData.error || "Failed to prepare EntryPoint deposit");
  return sendTransaction({
    to: txData.to,
    data: txData.data,
    value: txData.value,
    chainId: txData.chainId,
  });
}

/**
 * Creates an owner-signed ("lightweight") session: server prepares the exact messageHash, the owner signs it via personal_sign, the create transaction is sent, and the session is mirrored into the local session index.
 * @param walletAddress - The AgentWallet the session binds to.
 * @param ownerAddress - The wallet owner who signs the authorization.
 * @param options - expiryDays (default 30), dailySpendLimitEth (default "0.1"), dailyTxLimit (default 10), allowedTargets (default [] — empty means any target), sessionKey (optional session-key address; defaults to the owner).
 * @returns SendResult plus `sessionId`, the `sessionKeyAddress` the server committed to in the messageHash, and `runtimeCanSign`.
 * @throws When preparation/creation fails, or the user rejects the signature or the transaction. The encode step must use the server-returned sessionKeyAddress exactly, or the signature will not verify on-chain.
 * Maps to: REST POST /api/sessions/prepare-lightweight, POST /api/sessions/create-lightweight-tx, POST /api/sessions; Maps to: contract SessionManager.createLightweightSession.
 * Side effects: on-chain session creation; owner signature via personal_sign (EIP-191).
 * Security: the owner signs over exact limits — review the wallet prompt; a session key that can sign is as powerful as its limits allow.
 */
export async function sendCreateLightweightSession(
  walletAddress: string,
  ownerAddress: string,
  options?: { expiryDays?: number; dailySpendLimitEth?: string; dailyTxLimit?: number; allowedTargets?: string[]; sessionKey?: string }
): Promise<SendResult & { sessionId: string; sessionKeyAddress?: string; runtimeCanSign?: boolean }> {
  const eth = getEthereum();

  // Step 1: Get the exact messageHash from the server. If no external sessionKey
  // is supplied, the server MINTS a dedicated per-session key and computes the
  // hash over ITS address — so the owner signs over the real session key, and the
  // agent (not the owner) signs UserOps with the matching private key.
  const prep = await postJSON<any>("/api/sessions/prepare-lightweight", {
    walletAddress,
    sessionKey: options?.sessionKey || undefined,
    expiryDays: options?.expiryDays || 30,
    dailySpendLimitEth: options?.dailySpendLimitEth || "0.1",
    dailyTxLimit: options?.dailyTxLimit || 10,
    allowedTargets: options?.allowedTargets || [],
  });
  if (!prep.success) throw new Error(prep.error || "Failed to prepare session");

  // The session key the server actually committed to in the messageHash. The
  // encode step below MUST use this exact address or the signature won't verify.
  const sessionKey = prep.sessionKeyAddress;

  // Step 2: Sign the exact messageHash via personal_sign
  // MetaMask wraps it as "\x19Ethereum Signed Message:\n32" + messageHash — exactly what the contract checks
  const ownerSignature = await eth.request({
    method: "personal_sign",
    params: [prep.messageHash, ownerAddress],
  });

  // Step 3: Create the encoded session calldata with the correct signature
  const txData = await postJSON<any>("/api/sessions/create-lightweight-tx", {
    walletAddress,
    sessionKey,
    sessionId: prep.sessionId,
    expiry: prep.expiry,
    ownerSignature,
    expiryDays: options?.expiryDays || 30,
    dailySpendLimitEth: options?.dailySpendLimitEth || "0.1",
    dailyTxLimit: options?.dailyTxLimit || 10,
    allowedTargets: options?.allowedTargets || [],
  });
  if (!txData.success) throw new Error(txData.error || "Failed to prepare session");

  const result = await sendTransaction({
    to: walletAddress,
    data: txData.data,
    value: "0x0",
    chainId: txData.chainId,
  });

  await postJSON<any>("/api/sessions", {
    walletAddress,
    sessionKey,
    dailySpendLimit: options?.dailySpendLimitEth || "0.1",
    dailyTxLimit: options?.dailyTxLimit || 10,
    expiry: prep.expiry,
  });

  return { ...result, sessionId: prep.sessionId, sessionKeyAddress: sessionKey, runtimeCanSign: prep.runtimeCanSign };
}

/**
 * Creates a ZK-proof-gated "standard" session — the privacy USP path.
 * Unlike lightweight sessions there is NO owner signature step: the runtime generates a real Groth16 proof that the agent holds a valid, un-revoked credential within budget/expiry bounds, WITHOUT revealing the secret, org policy, or which credential. The on-chain verifier + nullifier are the entire trust basis; the owner only relays the wallet.execute transaction.
 * @param walletAddress - The AgentWallet the session binds to.
 * @param organizationId - The issuing organization.
 * @param agentId - The agent's credential ID within the org.
 * @param externalSessionKey - Optional external session-key ADDRESS (self-custody agent). Omit to let the runtime mint a dedicated per-session keypair and hold the key encrypted.
 * @param options - expiryDays (default 30), maxValue (spend cap; undefined means no explicit cap), sessionNonce overrides.
 * @returns SendResult plus `sessionId`, `nullifier`, `proofHash`, `sessionKeyAddress`, and `runtimeCanSign`.
 * @throws When ZK preparation fails or the relay transaction reverts/times out. The mirror POST to /api/sessions is best-effort (errors swallowed) — a failed mirror leaves the session on-chain but missing from the dashboard list.
 * Maps to: REST POST /api/sessions/create-standard-tx and POST /api/sessions; Maps to: contract SessionManager.createSession (Groth16 verifier + nullifier).
 * Side effects: on-chain session creation; server-side Groth16 proving.
 * Security: the proof hides the secret and policy, but the nullifier is public and single-use per credential — reuse is rejected on-chain.
 */
export async function sendCreateStandardSession(
  walletAddress: string,
  organizationId: string,
  agentId: number,
  /** Optional external session-key ADDRESS (self-custody agent). Omit to let the
   *  runtime generate a dedicated per-session keypair and hold the key encrypted. */
  externalSessionKey?: string,
  options?: { expiryDays?: number; maxValue?: string; sessionNonce?: string }
): Promise<SendResult & { sessionId: string; nullifier?: string; proofHash?: string; sessionKeyAddress?: string; runtimeCanSign?: boolean }> {
  // Single call: server generates the Groth16 proof and returns the encoded
  // wallet.execute(sessionManager, 0, createSession(...proof...)) transaction.
  // When externalSessionKey is omitted the server mints a dedicated session key.
  const txData = await postJSON<any>("/api/sessions/create-standard-tx", {
    walletAddress,
    organizationId,
    agentId,
    sessionKey: externalSessionKey || undefined,
    expiryDays: options?.expiryDays || 30,
    maxValue: options?.maxValue,
    sessionNonce: options?.sessionNonce,
  });
  if (!txData.success) throw new Error(txData.error || "Failed to prepare ZK session");

  const result = await sendTransaction({
    to: txData.to,
    data: txData.data,
    value: "0x0",
    chainId: txData.chainId,
  });

  // Mirror into the local session index for dashboard listing. Record the
  // dedicated session-key address the runtime generated (falls back to any
  // externally supplied key), never the wallet/owner address.
  await postJSON<any>("/api/sessions", {
    walletAddress,
    sessionKey: txData.sessionKeyAddress || externalSessionKey,
    organizationId,
    dailySpendLimit: txData.maxValue,
    expiry: txData.expiry,
  }).catch(() => {});

  return {
    ...result,
    sessionId: txData.sessionId,
    nullifier: txData.nullifier,
    proofHash: txData.proofHash,
    sessionKeyAddress: txData.sessionKeyAddress,
    runtimeCanSign: txData.runtimeCanSign,
  };
}

/**
 * Submits a UserOperation through the local ERC-4337 bundler.
 * The agent must have an active lightweight session with its key as sessionKey; the server does all ethers encoding, so no ethers import is needed client-side.
 * @param walletAddress - The AgentWallet address (the UserOp sender).
 * @param target - The target contract to call.
 * @param value - ETH value to send, as a wei string.
 * @param data - Inner calldata (defaults to "0x" at the call site when empty).
 * @param sessionId - The ID of the active lightweight session.
 * @param agentPrivateKey - The agent's session-key private key, sent to the local server for transient relay signing (client-side only; the server does not store caller-supplied keys).
 * @returns `{ success, txHash?, error? }` — failure is reported in-band, so check `success`.
 * @throws Only on transport failure; a bundler/session failure comes back as `success: false`.
 * Maps to: REST POST /api/bundler/send; Maps to: contract EntryPoint.handleOps (via the local bundler).
 * Side effects: on-chain execution via a UserOperation; moves value when `value` is set.
 * Security: the private key leaves the browser to the local API server — never log it, never paste it into a shared field, and prefer the server-stored-key relay when the runtime already holds the session key.
 */
export async function bundleAgentExecute(
  walletAddress: string,
  target: string,
  value: string,
  data: string,
  sessionId: string,
  agentPrivateKey: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  // Server-side handles all ethers encoding — no ethers import needed client-side
  const { postJSON } = await import("./api");
  return postJSON<any>("/api/bundler/send", {
    userOp: { sender: walletAddress, target, value, calldata: data || "0x", sessionId },
    agentPrivateKey,
  });
}

export { getAccount };
