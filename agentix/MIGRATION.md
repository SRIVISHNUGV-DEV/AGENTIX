# Machine Migration Guide

## Backup Current Data

```bash
node dist/src/index.js backup create --description "pre-migration"
node dist/src/index.js backup export --id <backup-id> --file ~/agentix-backup.json
```

## Copy to New Machine

```bash
# On old machine
scp ~/agentix-backup.json user@newmachine:~/

# On new machine
npm install -g agentix
agentix init
agentix backup import --file ~/agentix-backup.json
```

## What Gets Migrated

- All organizations, credentials, wallets, sessions
- Merkle tree state (active and revoked roots)
- Proof history
- Configuration
- Agent action logs
- Capability and delegation records

## What Does NOT Migrate

- On-chain state (always verifiable from blockchain)
- RPC connection (must reconfigure)
- Private keys (must re-add securely)

## Verify Migration

```bash
agentix doctor
agentix diagnostics
agentix org list
agentix cred list
```

## Full Directory Copy (Alternative)

```bash
# Stop all AgentIX processes, then:
scp -r ~/.agentix/ user@newmachine:~/.agentix/
```

This preserves everything including the SQLite database directly.
