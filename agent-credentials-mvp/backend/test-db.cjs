require('dotenv').config();
const { initDB } = require('./dist/db.js');

async function test() {
    console.log('Testing database connection...');
    console.log('DATABASE_URL:', process.env.DATABASE_URL ? '***set***' : '***NOT SET***');

    try {
        const db = await initDB();
        console.log('✓ Database connected successfully');

        const tables = await db.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
        `);
        console.log('✓ Tables:', tables.map(r => r.table_name).join(', '));

        const orgs = await db.query('SELECT COUNT(*) as count FROM organizations');
        console.log('✓ Organizations:', orgs[0].count);

        const agents = await db.query('SELECT COUNT(*) as count FROM agents');
        console.log('✓ Agents:', agents[0].count);

        const creds = await db.query('SELECT COUNT(*) as count FROM credentials');
        console.log('✓ Credentials:', creds[0].count);

        console.log('\n✅ All database tests passed!');
        process.exit(0);
    } catch (err) {
        console.error('✗ Error:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

test();
