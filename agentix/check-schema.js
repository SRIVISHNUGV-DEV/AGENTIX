const Database = require('better-sqlite3');
const db = new Database('C:/Users/Hp/.agentix/db/agentix.db');
const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credentials'").get();
console.log(sql.sql);
db.close();
