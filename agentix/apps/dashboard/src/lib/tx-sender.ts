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

function getEthereum(): any {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet detected — install MetaMask");
  return eth;
}

async function getAccount(): Promise<string> {
  const eth = getEthereum();
  const accounts = await eth.request({ method: "eth_accounts" });
  if (!accounts[0]) throw new Error("No account connected — connect your wallet");
  return accounts[0];
}

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

export async function sendUpdateRoot(root: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  return postJSON<any>("/api/credentials/update-root", { root });
}

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
 *
 * Unlike lightweight sessions, there is NO owner signature step. The runtime
 * generates a real Groth16 proof that the agent holds a valid, un-revoked
 * credential within budget/expiry bounds, WITHOUT revealing the secret, org
 * policy, or which credential. The on-chain verifier + nullifier are the entire
 * trust basis. The owner only relays the wallet.execute transaction.
 *
 * @param walletAddress - The AgentWallet the session binds to
 * @param organizationId - The issuing organization
 * @param agentId - The agent's credential ID within the org
 * @param sessionKey - Address authorized to sign for this session (defaults to wallet)
 * @param options - expiry / maxValue overrides
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
 * The agent must have an active lightweight session with its key as sessionKey.
 *
 * @param walletAddress - The AgentWallet address
 * @param callData - The encoded execute() call (target, value, data)
 * @param sessionId - The ID of the active lightweight session
 * @param agentPrivateKey - The agent's session key private key (client-side only)
 * @param target - The target contract to call
 * @param value - ETH value to send
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
