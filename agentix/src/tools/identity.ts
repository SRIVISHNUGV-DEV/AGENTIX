import { ethers } from "ethers";
import { getContract, getReadonlyContract } from "../contracts";
import { runExecute, runSingle } from "../core/database";
import { logger } from "../core/logger";
import { getEventBus } from "../../packages/core/eventbus";

export interface IdentityResult {
  success: boolean;
  identityId?: string;
  wallet?: string;
  txHash?: string;
  error?: string;
  details?: any;
}

/**
 * Register a new AgentIdentity NFT for a wallet address.
 * One identity per wallet: if the wallet already has one, this returns
 * success:false with the existing id instead of sending a second transaction.
 * @param walletAddress - Wallet to bind the identity to; @param metadataRoot - Optional 32-byte metadata root, zero hash when omitted.
 * @returns IdentityResult with identityId, wallet and txHash; success:false + error when the wallet already has an identity or the tx fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract AgentIdentity.registerIdentity; event IdentityRegistered.
 * Side effects: on-chain transaction (gas) + local DB insert + event-bus emit + events-table insert.
 * Security: the runtime signer pays; the identity is a public on-chain binding of wallet to id.
 */
export async function registerIdentity(
  walletAddress: string,
  metadataRoot?: string
): Promise<IdentityResult> {
  try {
    const identity = getContract("AgentIdentity", true);
    
    // Check if identity already exists
    const existingId = await identity.identityOf(walletAddress);
    if (existingId !== 0n) {
      return { 
        success: false, 
        error: `Wallet already has identity ${existingId.toString()}`,
        identityId: existingId.toString(),
        wallet: walletAddress,
      };
    }

    const metaRoot = metadataRoot || "0x0000000000000000000000000000000000000000000000000000000000000000";
    
    logger.info("identity", `Registering identity for wallet ${walletAddress.slice(0, 10)}...`);
    
    const tx = await identity.registerIdentity(walletAddress, metaRoot);
    const receipt = await tx.wait();

    // Get the newly created identity ID
    const identityId = await identity.identityOf(walletAddress);

    // Store in local DB
    runExecute(
      `INSERT OR IGNORE INTO identities (identity_id, wallet_address, active, created_at) VALUES (?, ?, 1, ?)`,
      identityId.toString(),
      walletAddress,
      Math.floor(Date.now() / 1000)
    );

    // Emit event
    try {
      const bus = getEventBus();
      bus.emit({ type: "IdentityRegistered", data: { identityId: identityId.toString(), walletAddress } });
      runExecute(
        "INSERT INTO events (event_type, data, tx_hash, created_at) VALUES (?, ?, ?, ?)",
        "IdentityRegistered",
        JSON.stringify({ identityId: identityId.toString(), walletAddress }),
        receipt.hash,
        Math.floor(Date.now() / 1000)
      );
    } catch {}

    logger.info("identity", `Identity registered: ${identityId.toString()} for wallet ${walletAddress}`);

    return {
      success: true,
      identityId: identityId.toString(),
      wallet: walletAddress,
      txHash: receipt.hash,
    };
  } catch (e: any) {
    logger.error("identity", `Failed to register identity: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Identity info for a wallet address, read on-chain.
 * A wallet with no identity is not an error — it returns success:true with
 * identityId undefined, so callers must check identityId, not just success.
 * @param walletAddress - Wallet to look up.
 * @returns IdentityResult with identityId, wallet and details {active, metadataRoot, createdAt, updatedAt}; success:false + error only on a contract/RPC failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_identity_get / agentix_wallet_get_identity.
 * Side effects: read-only contract calls (identityOf + 4 parallel view calls).
 */
export async function getIdentity(walletAddress: string): Promise<IdentityResult> {
  try {
    const identity = getReadonlyContract("AgentIdentity");
    
    const identityId = await identity.identityOf(walletAddress);
    if (identityId === 0n) {
      return { success: true, identityId: undefined, wallet: walletAddress };
    }

    const [wallet, active, metadata, timestamps] = await Promise.all([
      identity.walletOf(identityId),
      identity.isActive(identityId),
      identity.metadataOf(identityId),
      identity.timestampsOf(identityId),
    ]);

    return {
      success: true,
      identityId: identityId.toString(),
      wallet: wallet,
      details: {
        active,
        metadataRoot: metadata,
        createdAt: Number(timestamps[0]),
        updatedAt: Number(timestamps[1]),
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message, wallet: walletAddress };
  }
}

/**
 * Identity info by numeric identity id, read on-chain.
 * @param identityId - Numeric id from registerIdentity; an id that was never minted makes the contract calls revert, surfaced as success:false.
 * @returns IdentityResult with wallet and details {active, metadataRoot, createdAt, updatedAt}; success:false + error on failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_identity_get_by_id.
 * Side effects: read-only contract calls (4 parallel view calls).
 */
export async function getIdentityById(identityId: number): Promise<IdentityResult> {
  try {
    const identity = getReadonlyContract("AgentIdentity");
    
    const [wallet, active, metadata, timestamps] = await Promise.all([
      identity.walletOf(identityId),
      identity.isActive(identityId),
      identity.metadataOf(identityId),
      identity.timestampsOf(identityId),
    ]);

    return {
      success: true,
      identityId: identityId.toString(),
      wallet: wallet,
      details: {
        active,
        metadataRoot: metadata,
        createdAt: Number(timestamps[0]),
        updatedAt: Number(timestamps[1]),
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Update an identity's metadata root on-chain.
 * Only the metadata pointer changes — the identity id and wallet binding are
 * untouched — and the new root takes effect as soon as the tx confirms.
 * @param identityId - Numeric id to update; @param metadataRoot - New 32-byte metadata root (typically a content hash).
 * @returns IdentityResult with identityId and txHash; success:false + error on revert or RPC failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: contract AgentIdentity.updateMetadata; event MetadataUpdated.
 * Side effects: on-chain transaction (gas) + event-bus emit.
 * Security: the runtime signer must be authorized to update this identity; a wrong root silently points the identity at the wrong metadata.
 */
export async function updateMetadata(
  identityId: number,
  metadataRoot: string
): Promise<IdentityResult> {
  try {
    const identity = getContract("AgentIdentity", true);
    
    logger.info("identity", `Updating metadata for identity ${identityId}`);
    
    const tx = await identity.updateMetadata(identityId, metadataRoot);
    const receipt = await tx.wait();

    // Emit event
    try {
      const bus = getEventBus();
      bus.emit({ type: "MetadataUpdated", data: { identityId, metadataRoot } });
    } catch {}

    logger.info("identity", `Metadata updated for identity ${identityId}`);

    return {
      success: true,
      identityId: identityId.toString(),
      txHash: receipt.hash,
    };
  } catch (e: any) {
    logger.error("identity", `Failed to update metadata: ${e.message}`);
    return { success: false, error: e.message };
  }
}
