import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { AGENTIX_HOME } from "../core/config";
import { getActiveTree } from "../trees/active-tree";
import { getRevokedTree } from "../trees/revoked-tree";
import { runExecute, runSingle } from "../core/database";
import { logger } from "../core/logger";

export interface TreeResult {
  success: boolean;
  organizationId?: string;
  activeRoot?: string;
  activeEpoch?: number;
  activeLeafCount?: number;
  revokedRoot?: string;
  revokedEpoch?: number;
  revokedNullifierCount?: number;
  error?: string;
  details?: any;
}

/**
 * Status of an org's active + revoked Merkle trees: roots, epochs, leaf counts.
 * Read-only snapshot for display — the revoked "count" is NOT a count: it is -1
 * when revocation key 0 happens to be revoked, else 0, a sentinel, not a size.
 * @param organizationId - Org whose trees to inspect.
 * @returns TreeResult with active/revoked roots, epochs and activeLeafCount; success:false + error when a tree cannot be loaded.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: MCP tool agentix_tree_status.
 * Side effects: loads both trees (may read from DB/disk); no writes.
 */
export async function getTreeStatus(organizationId: string): Promise<TreeResult> {
  try {
    const activeTree = await getActiveTree(organizationId);
    const revokedTree = await getRevokedTree(organizationId);

    return {
      success: true,
      organizationId,
      activeRoot: activeTree.getRoot(),
      activeEpoch: activeTree.getEpoch(),
      activeLeafCount: activeTree.getLeafCount(),
      revokedRoot: revokedTree.getRoot(),
      revokedEpoch: revokedTree.getEpoch(),
      revokedNullifierCount: revokedTree.isRevoked(BigInt(0)) ? -1 : 0,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Rebuild both trees for an org from the DB (active from credentials, revoked from revocations).
 * The repair path when a tree is stale or its in-memory state diverged — e.g.
 * after a restore — since the DB is the source of truth and the trees are derived.
 * @param organizationId - Org whose trees to rebuild.
 * @returns TreeResult with the new roots, epochs and active leaf count; success:false + error when a tree cannot be loaded or rebuilt.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: CLI 'agentix tree rebuild <orgId>'.
 * Side effects: rebuilds both in-memory trees and persists the rebuilt state.
 */
export async function rebuildTree(organizationId: string): Promise<TreeResult> {
  try {
    logger.info("tree", `Rebuilding trees for org ${organizationId}`);

    const activeTree = await getActiveTree(organizationId);
    activeTree.rebuild();

    const revokedTree = await getRevokedTree(organizationId);
    revokedTree.rebuild();

    return {
      success: true,
      organizationId,
      activeRoot: activeTree.getRoot(),
      activeEpoch: activeTree.getEpoch(),
      activeLeafCount: activeTree.getLeafCount(),
      revokedRoot: revokedTree.getRoot(),
      revokedEpoch: revokedTree.getEpoch(),
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Export both trees of an org to a JSON file.
 * The export is a plain JSON dump (active + revoked + export timestamp) — it
 * carries the full tree contents, so handle the file like any other credential
 * material.
 * @param organizationId - Org whose trees to export; @param outputPath - Destination file; defaults to ~/.agentix/trees/export-<org>-<ts>.json.
 * @returns TreeResult with details.filePath; success:false + error when a tree cannot be loaded or the file cannot be written.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: CLI 'agentix tree export <orgId>'.
 * Side effects: writes the export file (creates ~/.agentix/trees if needed).
 */
export async function exportTree(organizationId: string, outputPath?: string): Promise<TreeResult> {
  try {
    const activeTree = await getActiveTree(organizationId);
    const revokedTree = await getRevokedTree(organizationId);

    const activeData = await activeTree.exportTree();
    const revokedData = await revokedTree.exportTree();

    const exportData = {
      organizationId,
      active: JSON.parse(activeData),
      revoked: JSON.parse(revokedData),
      exportedAt: Date.now(),
    };

    const filePath = outputPath || join(AGENTIX_HOME, "trees", `export-${organizationId}-${Date.now()}.json`);
    const dir = join(AGENTIX_HOME, "trees");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(filePath, JSON.stringify(exportData, null, 2));

    logger.info("tree", `Trees exported to ${filePath}`);

    return {
      success: true,
      organizationId,
      details: { filePath },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Replace an org's trees from a previously exported JSON file.
 * The file's contents are trusted wholesale — a crafted export can replace the
 * local trees with attacker-chosen roots, and proofs generated afterwards will
 * follow the imported trees, not the DB.
 * @param organizationId - Org whose trees to replace; @param inputPath - Path to an exportTree JSON file; missing file is success:false.
 * @returns TreeResult with the imported roots/epochs; success:false + error on missing/invalid file or import failure.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: CLI 'agentix tree import <orgId> --file <path>'.
 * Side effects: overwrites both in-memory trees and their persisted state.
 * Security: only import exports from a trusted machine — the file is not authenticated.
 */
export async function importTree(organizationId: string, inputPath: string): Promise<TreeResult> {
  try {
    if (!existsSync(inputPath)) return { success: false, error: `File not found: ${inputPath}` };

    const data = JSON.parse(readFileSync(inputPath, "utf-8"));

    const activeTree = await getActiveTree(organizationId);
    await activeTree.importTree(JSON.stringify(data.active));

    const revokedTree = await getRevokedTree(organizationId);
    await revokedTree.importTree(JSON.stringify(data.revoked));

    logger.info("tree", `Trees imported for org ${organizationId}`);

    return {
      success: true,
      organizationId,
      activeRoot: activeTree.getRoot(),
      activeEpoch: activeTree.getEpoch(),
      revokedRoot: revokedTree.getRoot(),
      revokedEpoch: revokedTree.getEpoch(),
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Persist a snapshot of both trees (epoch, root, serialized data) into the merkle_snapshots table.
 * Snapshots are the rollback record for tree state — restoreTree is supposed to
 * consume them, so snapshot before any operation you may need to undo.
 * @param organizationId - Org whose trees to snapshot.
 * @returns TreeResult with the snapshotted roots/epochs; success:false + error when a tree cannot be loaded or the insert fails.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: CLI 'agentix tree snapshot <orgId>'.
 * Side effects: two DB inserts into merkle_snapshots.
 */
export async function snapshotTree(organizationId: string): Promise<TreeResult> {
  try {
    const activeTree = await getActiveTree(organizationId);
    const revokedTree = await getRevokedTree(organizationId);

    const activeSnapshot = activeTree.snapshot();
    const revokedSnapshot = revokedTree.snapshot();

    runExecute(
      "INSERT INTO merkle_snapshots (organization_id, tree_type, epoch, root, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      organizationId,
      "active",
      activeTree.getEpoch(),
      activeTree.getRoot(),
      activeSnapshot,
      Math.floor(Date.now() / 1000)
    );

    runExecute(
      "INSERT INTO merkle_snapshots (organization_id, tree_type, epoch, root, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      organizationId,
      "revoked",
      revokedTree.getEpoch(),
      revokedTree.getRoot(),
      revokedSnapshot,
      Math.floor(Date.now() / 1000)
    );

    return {
      success: true,
      organizationId,
      activeRoot: activeTree.getRoot(),
      activeEpoch: activeTree.getEpoch(),
      revokedRoot: revokedTree.getRoot(),
      revokedEpoch: revokedTree.getEpoch(),
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Restore an org's trees — currently by rebuilding them from the DB, ignoring snapshotId.
 * Despite the name and the parameter, no snapshot is loaded: the trees are
 * rebuilt from current DB rows, so this recovers from tree corruption but does
 * NOT roll back to a snapshot's earlier state.
 * @param organizationId - Org whose trees to restore; @param snapshotId - Ignored (accepted for the CLI signature; no snapshot lookup is performed).
 * @returns TreeResult with the rebuilt roots/epochs; success:false + error when a tree cannot be loaded or rebuilt.
 * @throws Never throws: failures are returned as success:false.
 * Maps to: CLI 'agentix tree restore <orgId>' (snapshot semantics not implemented).
 * Side effects: rebuilds both in-memory trees and persists the rebuilt state.
 */
export async function restoreTree(organizationId: string, snapshotId?: number): Promise<TreeResult> {
  try {
    const activeTree = await getActiveTree(organizationId);
    const revokedTree = await getRevokedTree(organizationId);

    activeTree.rebuild();
    revokedTree.rebuild();

    return {
      success: true,
      organizationId,
      activeRoot: activeTree.getRoot(),
      activeEpoch: activeTree.getEpoch(),
      revokedRoot: revokedTree.getRoot(),
      revokedEpoch: revokedTree.getEpoch(),
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
