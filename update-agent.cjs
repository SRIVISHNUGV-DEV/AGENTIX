const postgres = require('postgres');

async function main() {
  try {
    const sql = postgres('postgresql://agentix:agentix-secret@localhost:5432/agentix');

    await sql`UPDATE external_agents SET endpoint = 'http://localhost:3002', status = 'connected' WHERE id = 1`;

    const result = await sql`SELECT id, agent_name, endpoint, status FROM external_agents WHERE id = 1`;
    console.log('Updated:', JSON.stringify(result, null, 2));

    await sql.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
