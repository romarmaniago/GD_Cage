/**
 * Idempotent DB setup for junket_return_money.RESET.
 * Mirrors junket_house_expense.RESET so return money participates in the
 * same legacy "reset main cage balance" cycle used by the dashboard's
 * RESET-scoped expense figures (routes.js / views/dashboard/_calculations.ejs).
 */

async function columnExists(pool, tableName, columnName) {
	const [rows] = await pool.execute(
		`SELECT COUNT(*) AS cnt
		 FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = ?
		   AND COLUMN_NAME = ?`,
		[tableName, columnName]
	);
	return Number(rows[0]?.cnt || 0) > 0;
}

async function ensureReturnMoneyResetSchema(pool) {
	if (!(await columnExists(pool, 'junket_return_money', 'RESET'))) {
		await pool.execute(
			`ALTER TABLE junket_return_money
			 ADD COLUMN RESET INT NULL DEFAULT 1 AFTER ACTIVE`
		);
		console.log('[junket_return_money] Added column RESET');
	}

	return true;
}

module.exports = { ensureReturnMoneyResetSchema };
