/**
 * Idempotent DB setup for junket_total_chips.PROGRAM_DATE (Total Chips modal).
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

async function ensureJunketTotalChipsProgramDateSchema(pool) {
	if (!(await columnExists(pool, 'junket_total_chips', 'PROGRAM_DATE'))) {
		await pool.execute(
			`ALTER TABLE junket_total_chips
			 ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected program date (date only)' AFTER ENCODED_DT`
		);
		await pool.execute(
			'ALTER TABLE junket_total_chips ADD KEY idx_junket_total_chips_program_date (ACTIVE, PROGRAM_DATE)'
		);
		console.log('[junket_total_chips] Added column PROGRAM_DATE');
	}

	// Legacy rows stored program date inside ENCODED_DT
	await pool.execute(
		`UPDATE junket_total_chips
		 SET PROGRAM_DATE = DATE(ENCODED_DT)
		 WHERE PROGRAM_DATE IS NULL
		   AND ENCODED_DT IS NOT NULL`
	);

	return true;
}

module.exports = { ensureJunketTotalChipsProgramDateSchema };
