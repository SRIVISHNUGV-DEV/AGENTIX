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

async function clearDatabase() {
  console.log("Clearing all data from database...")

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
    // No transaction - each delete is independent
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

    // Insert Test Organisation
    console.log("Creating Test Organisation...")
    const result = await client.query(`
      INSERT INTO organizations (name, owner_wallet_address, created_at)
      VALUES ('Test Organisation', '0x0000000000000000000000000000000000000000', EXTRACT(EPOCH FROM NOW())::INTEGER)
      RETURNING id, name, owner_wallet_address
    `)
    console.log("Created organisation:", result.rows[0])

    console.log("Database reset successfully!")
  } catch (error) {
    console.error("Error clearing database:", error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

clearDatabase().catch((error) => {
  console.error("Failed to clear database:", error)
  process.exit(1)
})
