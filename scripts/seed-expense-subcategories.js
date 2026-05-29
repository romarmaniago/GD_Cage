/**
 * Manual run (optional — same logic runs automatically on server start via config/db.js).
 * Run: node scripts/seed-expense-subcategories.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { ensureExpenseCategorySchema } = require('../utils/ensureExpenseCategorySchema');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    });

    try {
        await ensureExpenseCategorySchema(pool);
        console.log('Done.');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
