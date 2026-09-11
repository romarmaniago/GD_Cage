/**
 * Idempotent DB setup for junket_return_money.IN_CHARGE.
 * Kept separate from DESCRIPTION (free-text notes) so the item table can show
 * both an "In Charge" value and a "Description" value for a return-money row.
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

async function ensureReturnMoneyInChargeSchema(pool) {
	if (!(await columnExists(pool, 'junket_return_money', 'IN_CHARGE'))) {
		await pool.execute(
			`ALTER TABLE junket_return_money
			 ADD COLUMN IN_CHARGE VARCHAR(255) NULL DEFAULT NULL AFTER DESCRIPTION`
		);
		console.log('[junket_return_money] Added column IN_CHARGE');
	}

	return true;
}

module.exports = { ensureReturnMoneyInChargeSchema };
