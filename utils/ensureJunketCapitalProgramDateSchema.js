/**
 * Idempotent DB setup for junket_capital.PROGRAM_DATE (Authorized Master Account).
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

async function ensureJunketCapitalProgramDateSchema(pool) {
	if (!(await columnExists(pool, 'junket_capital', 'PROGRAM_DATE'))) {
		await pool.execute(
			`ALTER TABLE junket_capital
			 ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected program date (date only)' AFTER ENCODED_DT`
		);
		await pool.execute(
			'ALTER TABLE junket_capital ADD KEY idx_junket_capital_program_date (ACTIVE, PROGRAM_DATE)'
		);
		console.log('[junket_capital] Added column PROGRAM_DATE');
	}

	// Backfill legacy rows that stored program date inside ENCODED_DT
	await pool.execute(
		`UPDATE junket_capital
		 SET PROGRAM_DATE = DATE(ENCODED_DT)
		 WHERE PROGRAM_DATE IS NULL
		   AND ENCODED_DT IS NOT NULL`
	);

	return true;
}

module.exports = { ensureJunketCapitalProgramDateSchema };
