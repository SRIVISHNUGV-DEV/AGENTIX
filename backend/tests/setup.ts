import { initDB } from "../src/db"

let dbInitialized = false

export async function getTestDB() {
  if (!dbInitialized) {
    // Use test-specific env or defaults
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://agentix:agentix_secret_2024@localhost:5432/agentix_test"
    dbInitialized = true
  }
  return initDB()
}
