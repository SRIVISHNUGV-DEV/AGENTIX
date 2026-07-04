# Recovery Instructions

## Scenario: Database Corruption

```bash
# Check for corruption
agentix diagnostics

# Restore from backup
agentix backup list
agentix backup restore --id <backup-id>

# If no backup exists, rebuild from on-chain state
agentix tree rebuild --org <orgId>
```

## Scenario: Lost Configuration

```bash
# Reset to defaults
agentix config reset

# Reconfigure
agentix config set rpcUrl https://sepolia.base.org
agentix config set chainId 84532
```

## Scenario: Corrupted Merkle Trees

```bash
# Check tree integrity
agentix tree status --org <orgId>

# Rebuild from credential records
agentix tree rebuild --org <orgId>

# If rebuild fails, restore snapshot
agentix tree restore --org <orgId>
```

## Scenario: Accidental Backup

```bash
# List all backups
agentix backup list

# Restore specific backup
agentix backup restore --id <backup-id>

# Verify restoration
agentix doctor
```

## Scenario: Complete Data Loss

1. Reinstall AgentIX: `npm install -g agentix`
2. Initialize: `agentix init`
3. Configure RPC: `agentix config set rpcUrl https://sepolia.base.org`
4. Import backup if available: `agentix backup import --file backup.json`
5. If no backup, re-request organization approval through authority
6. Re-issue credentials (on-chain state is preserved)

## Backup Strategy

Create regular backups:

```bash
# Automated daily backup
agentix backup create --description "daily-$(date +%Y-%m-%d)"

# Export critical backup off-machine
agentix backup export --id <id> --file ~/secure-backup.json
```

## Emergency Contacts

- Contract addresses: `agentix contracts`
- On-chain verification: https://sepolia.basescan.org
- Protocol documentation: `agentix protocol`
