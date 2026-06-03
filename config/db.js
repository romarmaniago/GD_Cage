const mysql = require('mysql2/promise');
require('dotenv').config(); // Load .env variables
const { ensureExpenseCategorySchema } = require('../utils/ensureExpenseCategorySchema');
const { ensureHouseExpenseApprovalSchema } = require('../utils/ensureHouseExpenseApprovalSchema');
const { ensureHouseExpenseVehicleSchema } = require('../utils/ensureHouseExpenseVehicleSchema');

const pool = mysql.createPool({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
	port: process.env.DB_PORT,
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0
});

// log connection success + idempotent expense_category schema/seed on startup
(async () => {
	try {
		const connection = await pool.getConnection();
		console.log(`✅ Connected to MySQL at ${process.env.DB_HOST}:${process.env.DB_PORT} - DB: ${process.env.DB_NAME}`);
		connection.release();
		await ensureExpenseCategorySchema(pool);
		await ensureHouseExpenseApprovalSchema(pool);
		await ensureHouseExpenseVehicleSchema(pool);
	} catch (err) {
		console.error('❌ MySQL connection failed:', err.message);
	}
})();

module.exports = pool;
