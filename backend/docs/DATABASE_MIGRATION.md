# Database Migration Guide: SQLite to PostgreSQL

This guide explains how to migrate your AGENTIX backend from SQLite to PostgreSQL for production deployment.

## Overview

The backend now supports dual database mode:
- **SQLite** (default): For local development and testing
- **PostgreSQL**: For production deployments requiring concurrency and scalability

## Prerequisites

- PostgreSQL 14+ installed locally, or
- Access to a managed PostgreSQL service (Railway, Supabase, AWS RDS, etc.)
- Node.js and npm installed

## Quick Start

### 1. Install PostgreSQL (if local)

```bash
# macOS
brew install postgresql
brew services start postgresql

# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql

# Windows
# Download from https://www.postgresql.org/download/windows/
```

### 2. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE agentix;
CREATE USER agentixuser WITH ENCRYPTED PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE agentix TO agentixuser;

# Exit
\q
```

### 3. Configure Environment

Edit `backend/.env`:

```bash
# Change from SQLite to PostgreSQL
DB_TYPE=postgres

# Add your PostgreSQL connection string
DATABASE_URL=postgresql://agentixuser:yourpassword@localhost:5432/agentix

# SQLite config (kept for fallback)
# DB_TYPE=sqlite
# DB_PATH=./db/database.sqlite
```

### 4. Run Migration Script

```bash
cd backend

# Dry run first (preview without writing)
DRY_RUN=true npx tsx scripts/migrate-to-postgres.ts

# Perform actual migration
DATABASE_URL=postgresql://agentixuser:yourpassword@localhost:5432/agentix npx tsx scripts/migrate-to-postgres.ts
```

### 5. Start Backend

```bash
# The backend will automatically use PostgreSQL based on DB_TYPE
npm run dev
```

## Cloud Database Options

### Railway
```bash
# Create PostgreSQL instance on Railway dashboard
# Copy connection string
DATABASE_URL=postgresql://${{Postgres.USERNAME}}:${{Postgres.PASSWORD}}@${{Postgres.HOST}}:${{Postgres.PORT}}/${{Postgres.DATABASE}}
```

### Supabase
```bash
# Create project on Supabase
# Use connection string from Settings > Database
DATABASE_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
```

### AWS RDS
```bash
# Create PostgreSQL instance in AWS RDS
# Download certificate if using SSL
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
```

## Schema Compatibility

The dual-mode database layer maintains compatibility between SQLite and PostgreSQL:

| Feature | SQLite | PostgreSQL |
|---------|--------|------------|
| Auto-increment | `AUTOINCREMENT` | `SERIAL` |
| Timestamps | `strftime('%s','now')` | `EXTRACT(EPOCH FROM NOW())` |
| Foreign keys | `PRAGMA foreign_keys` | Native `REFERENCES` |
| JSON | Text columns | `JSONB` (can be added) |

## Migration Script Features

- **Batch inserts** (100 rows at a time) for efficiency
- **Transaction safety** - rolls back on error
- **Dry run mode** - preview changes before executing
- **Preserves IDs** - maintains referential integrity
- **Foreign key handling** - temporarily disables FK checks for speed

## Tables Migrated

1. `organizations` - Organization data
2. `users` - User accounts
3. `auth_sessions` - Session tokens
4. `agents` - Agent definitions
5. `credentials` - Credential commitments
6. `sessions` - ZK sessions
7. `wallets` - Agent wallets
8. `merkle_tree` - Merkle tree data
9. `revoked_secrets` - Revocation status
10. `events` - Blockchain events
11. `organization_contracts` - Per-org contract addresses
12. `shared_contracts` - Global contract addresses
13. `external_agents` - External agent integrations
14. `agent_vault_credentials` - Vault-stored credentials
15. `agent_funding_accounts` - Funding wallets
16. `agent_whitelisted_contracts` - Contract whitelists

## Troubleshooting

### Connection refused
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list | grep postgresql  # macOS
```

### Authentication failed
```bash
# Update pg_hba.conf for local connections
sudo nano /etc/postgresql/14/main/pg_hba.conf
# Change: local all all peer -> local all all md5
sudo systemctl restart postgresql
```

### Migration fails mid-way
```bash
# Clear target database and retry
psql -U postgres -c "DROP DATABASE agentix; CREATE DATABASE agentix;"
```

## Performance

| Operation | SQLite | PostgreSQL |
|-----------|--------|------------|
| Concurrent writes | Limited | Excellent |
| Read performance | Fast | Fast |
| Connection pooling | None | Yes (built-in) |
| Query caching | OS level | Built-in |
| Backup | File copy | `pg_dump` |

## Security Considerations

1. **Never commit DATABASE_URL** - Store in environment only
2. **Use connection pooling** - Automatic with `pg` driver
3. **Enable SSL** - For cloud providers: `?sslmode=require`
4. **Restrict user permissions** - Grant only necessary privileges
5. **Regular backups** - Set up automated `pg_dump` schedules

## Reverting to SQLite

Simply change the environment variable:

```bash
DB_TYPE=sqlite
DB_PATH=./db/database.sqlite
```

The application will automatically switch back to SQLite mode.
