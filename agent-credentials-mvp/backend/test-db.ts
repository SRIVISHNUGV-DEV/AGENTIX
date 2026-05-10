import { initDB } from "./src/db"

async function testDB() {
    console.log("Testing database connection...")
    console.log("DATABASE_URL:", process.env.DATABASE_URL ? "***set***" : "***NOT SET***")

    try {
        const db = await initDB()
        console.log("✓ Database connected successfully")

        // Test basic query
        const tables = await db.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
        `)
        console.log("✓ Tables:", tables.map((r: any) => r.table_name).join(", "))

        // Test orgs count
        const orgs = await db.query("SELECT COUNT(*) as count FROM organizations")
        console.log("✓ Organizations:", orgs[0].count)

        // Test agents count
        const agents = await db.query("SELECT COUNT(*) as count FROM agents")
        console.log("✓ Agents:", agents[0].count)

        console.log("\n✅ All database tests passed!")
        process.exit(0)
    } catch (err) {
        console.error("✗ Database test failed:", err instanceof Error ? err.message : err)
        process.exit(1)
    }
}

testDB()
