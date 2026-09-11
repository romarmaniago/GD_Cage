/**
 * Idempotent DB setup for junket_return_money.PROGRAM_DATE.
 * Program date is user-selected (date only); ENCODED_DT stays wall-clock encode time.
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

async function ensureReturnMoneyProgramDateSchema(pool) {
	if (!(await columnExists(pool, 'junket_return_money', 'PROGRAM_DATE'))) {
		await pool.execute(
			`ALTER TABLE junket_return_money
			 ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected program date (date only)' AFTER ENCODED_DT`
		);
		await pool.execute(
			'ALTER TABLE junket_return_money ADD KEY idx_junket_return_money_program_date (ACTIVE, PROGRAM_DATE)'
		);
		console.log('[junket_return_money] Added column PROGRAM_DATE');
	}

	return true;
}

module.exports = { ensureReturnMoneyProgramDateSchema };
