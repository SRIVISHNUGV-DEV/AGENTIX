const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:Vishnu4577S#@agentix-prod.cqneccqkglt4.us-east-1.rds.amazonaws.com:5432/agentix',
  ssl: { rejectUnauthorized: false },
  max: 5
});

async function test() {
  try {
    const client = await pool.connect();
    console.log('✓ Database connected');

    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    console.log('✓ Tables:', tables.rows.map(r => r.table_name).join(', '));

    const orgs = await client.query('SELECT COUNT(*) FROM organizations');
    console.log('✓ Organizations:', orgs.rows[0].count);

    client.release();
    await pool.end();
    console.log('\n✓ All tests passed!');
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  }
}

test();
