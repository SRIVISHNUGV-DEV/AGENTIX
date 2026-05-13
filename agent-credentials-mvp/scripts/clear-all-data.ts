import * as dotenv from "dotenv"
import { resolve } from "path"
import { Pool } from "pg"
import * as fs from "fs"

// Load environment from backend .env FIRST
const envPath = resolve(__dirname, "../backend/.env")
dotenv.config({ path: envPath })

// Set DATABASE_URL if not set (fallback for Windows path issues)
if (!process.env.DATABASE_URL) {
  // Read from .env file directly
  const envContent = fs.readFileSync(envPath, "utf-8")
  const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/)
  if (dbUrlMatch) {
    process.env.DATABASE_URL = dbUrlMatch[1].trim()
  }
}

console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "NOT SET")

async function clearAllData() {
  console.log("Clearing ALL data from database (no test org)...")

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  const client = await pool.connect()

  // Helper function to safely delete from a table (no transaction)
  const safeDelete = async (table: string) => {
    try {
      const result = await client.query(`DELETE FROM ${table}`)
      console.log(`Deleted ${result.rowCount} rows from ${table}`)
      return true
    } catch (error: any) {
      if (error.code === "42P01") {
        console.log(`Table ${table} does not exist, skipping...`)
        return true
      } else {
        console.error(`Error deleting from ${table}:`, error.message)
        return false
      }
    }
  }

  try {
    // Delete in correct order (respecting foreign key constraints)
    await safeDelete("sessions")
    await safeDelete("credentials")
    await safeDelete("wallets")
    await safeDelete("agents")
    await safeDelete("external_agent_credentials")
    await safeDelete("funding_accounts")
    await safeDelete("whitelisted_contracts")
    await safeDelete("external_agents")
    await safeDelete("organization_contracts")
    await safeDelete("contract_events")
    await safeDelete("action_authorizations")
    await safeDelete("merkle_tree")
    await safeDelete("revoked_merkle_tree")
    await safeDelete("revoked_secrets")
    await safeDelete("users")
    await safeDelete("organizations")
    await safeDelete("shared_contracts")  // Clear shared contracts (has bad addresses)

    // Reset all sequences to start from 1
    console.log("Resetting sequences...")
    await client.query(`ALTER SEQUENCE IF EXISTS organizations_id_seq RESTART WITH 1`)
    await client.query(`ALTER SEQUENCE IF EXISTS agents_id_seq RESTART WITH 1`)
    await client.query(`ALTER SEQUENCE IF EXISTS credentials_id_seq RESTART WITH 1`)
    await client.query(`ALTER SEQUENCE IF EXISTS sessions_id_seq RESTART WITH 1`)
    await client.query(`ALTER SEQUENCE IF EXISTS wallets_id_seq RESTART WITH 1`)
    await client.query(`ALTER SEQUENCE IF EXISTS users_id_seq RESTART WITH 1`)
    await client.query(`ALTER SEQUENCE IF EXISTS external_agents_id_seq RESTART WITH 1`)
    console.log("Sequences reset to start from 1")

    console.log("Database cleared successfully - no organizations exist!")
  } catch (error) {
    console.error("Error clearing database:", error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

clearAllData().catch((error) => {
  console.error("Failed to clear database:", error)
  process.exit(1)
})
