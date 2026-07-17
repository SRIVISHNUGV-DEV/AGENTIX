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
 * Register a new identity on-chain for a wallet address.
 * This creates a new AgentIdentity NFT linked to the wallet.
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
 * Get identity information for a wallet address.
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
 * Get identity information by identity ID.
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
 * Update identity metadata root.
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
