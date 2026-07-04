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
