#!/bin/bash
# PostgreSQL backup script for AgentIX
# Usage: ./backup-db.sh [output_dir]
set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${OUTPUT_DIR}/agentix_${TIMESTAMP}.sql.gz"

mkdir -p "$OUTPUT_DIR"

echo "[backup] Starting PostgreSQL backup..."
pg_dump "${DATABASE_URL:-postgresql://agentix:agentix_secret_2024@localhost:5432/agentix}" | gzip > "$BACKUP_FILE"

# Keep only last 7 backups
ls -t "$OUTPUT_DIR"/agentix_*.sql.gz 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null || true

echo "[backup] Backup saved to $BACKUP_FILE"
echo "[backup] Size: $(du -h "$BACKUP_FILE" | cut -f1)"
