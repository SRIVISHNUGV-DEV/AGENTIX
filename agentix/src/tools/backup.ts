import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, copyFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { randomBytes } from "crypto";
import { AGENTIX_HOME, loadConfig } from "../core/config";
import { getDatabase, runQuery, runExecute, runSingle } from "../core/database";
import { logger } from "../core/logger";

export interface BackupResult {
  success: boolean;
  backupId?: string;
  filename?: string;
  size?: number;
  checksum?: string;
  error?: string;
  details?: any;
}

function checksumFile(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export async function createBackup(description?: string): Promise<BackupResult> {
  try {
    const backupId = `backup-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const backupDir = join(AGENTIX_HOME, "backups", backupId);
    mkdirSync(backupDir, { recursive: true });

    logger.info("backup", `Creating backup: ${backupId}`);

    const dbPath = loadConfig().database.path;
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, join(backupDir, "agentix.db"));
    }

    const configPath = join(AGENTIX_HOME, "config", "agentix.config.json");
    if (existsSync(configPath)) {
      copyFileSync(configPath, join(backupDir, "agentix.config.json"));
    }

    const treeDir = join(AGENTIX_HOME, "trees");
    if (existsSync(treeDir)) {
      const treeFiles = readdirSync(treeDir);
      for (const f of treeFiles) {
        copyFileSync(join(treeDir, f), join(backupDir, `tree-${f}`));
      }
    }

    const manifest = {
      backupId,
      description: description || "Manual backup",
      createdAt: Date.now(),
      files: readdirSync(backupDir),
    };
    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    let totalSize = 0;
    for (const f of readdirSync(backupDir)) {
      totalSize += statSync(join(backupDir, f)).size;
    }

    const checksum = checksumFile(join(backupDir, "manifest.json"));

    runExecute(
      `INSERT INTO backups (backup_id, filename, size, checksum, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      backupId,
      `${backupId}.tar.gz`,
      totalSize,
      checksum,
      Math.floor(Date.now() / 1000),
      JSON.stringify({ description, fileCount: manifest.files.length })
    );

    logger.info("backup", `Backup created: ${backupId} (${totalSize} bytes)`);

    return {
      success: true,
      backupId,
      filename: `${backupId}/`,
      size: totalSize,
      checksum,
    };
  } catch (e: any) {
    logger.error("backup", `Failed to create backup: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export async function listBackups(): Promise<BackupResult[]> {
  try {
    const rows = runQuery<any>(
      "SELECT * FROM backups ORDER BY created_at DESC"
    );

    return rows.map((r) => ({
      success: true,
      backupId: r.backup_id,
      filename: r.filename,
      size: r.size,
      checksum: r.checksum,
      details: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  } catch (e: any) {
    return [{ success: false, error: e.message }];
  }
}

export async function restoreBackup(backupId: string): Promise<BackupResult> {
  try {
    const backupDir = join(AGENTIX_HOME, "backups", backupId);
    if (!existsSync(backupDir)) return { success: false, error: `Backup not found: ${backupId}` };

    logger.info("backup", `Restoring backup: ${backupId}`);

    const dbFile = join(backupDir, "agentix.db");
    if (existsSync(dbFile)) {
      const targetDb = loadConfig().database.path;
      const targetDir = join(targetDb, "..");
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      copyFileSync(dbFile, targetDb);
    }

    const configFile = join(backupDir, "agentix.config.json");
    if (existsSync(configFile)) {
      const targetConfig = join(AGENTIX_HOME, "config", "agentix.config.json");
      copyFileSync(configFile, targetConfig);
    }

    const treeDir = join(AGENTIX_HOME, "trees");
    if (!existsSync(treeDir)) mkdirSync(treeDir, { recursive: true });

    for (const f of readdirSync(backupDir)) {
      if (f.startsWith("tree-")) {
        copyFileSync(join(backupDir, f), join(treeDir, f.replace("tree-", "")));
      }
    }

    logger.info("backup", `Backup restored: ${backupId}`);

    return {
      success: true,
      backupId,
      details: { restored: true },
    };
  } catch (e: any) {
    logger.error("backup", `Failed to restore backup: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export async function exportBackup(backupId: string, outputPath: string): Promise<BackupResult> {
  try {
    const backupDir = join(AGENTIX_HOME, "backups", backupId);
    if (!existsSync(backupDir)) return { success: false, error: `Backup not found: ${backupId}` };

    const data = readFileSync(join(backupDir, "manifest.json"));
    writeFileSync(outputPath, data);

    return {
      success: true,
      backupId,
      details: { outputPath },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function importBackup(inputPath: string): Promise<BackupResult> {
  try {
    if (!existsSync(inputPath)) return { success: false, error: `File not found: ${inputPath}` };

    const data = JSON.parse(readFileSync(inputPath, "utf-8"));
    const backupId = data.backupId || `imported-${Date.now()}`;

    const backupDir = join(AGENTIX_HOME, "backups", backupId);
    mkdirSync(backupDir, { recursive: true });

    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(data, null, 2));

    return {
      success: true,
      backupId,
      details: { imported: true },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
