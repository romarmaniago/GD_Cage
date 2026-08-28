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

async function backfillGameLinkedProgramDates(pool) {
	// Game-sourced charges (added from the gamebook) historically had no PROGRAM_DATE.
	// Inherit it from the parent game so they land on the correct program day.
	const [result] = await pool.execute(
		`UPDATE game_services gs
		 JOIN game_list gl ON gl.IDNo = gs.GAME_ID
		 SET gs.PROGRAM_DATE = DATE(gl.PROGRAM_DATE)
		 WHERE gs.PROGRAM_DATE IS NULL
		   AND gs.GAME_ID IS NOT NULL
		   AND gl.PROGRAM_DATE IS NOT NULL`
	);
	if (result && result.affectedRows) {
		console.log(`[game_services] Backfilled PROGRAM_DATE for ${result.affectedRows} game-linked row(s)`);
	}
}

async function ensureGameServicesProgramDateSchema(pool) {
	const exists = await columnExists(pool, 'game_services', 'PROGRAM_DATE');
	if (!exists) {
		await pool.execute(
			`ALTER TABLE game_services
			 ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected program date (date only)' AFTER ENCODED_DT`
		);
		await pool.execute(
			'ALTER TABLE game_services ADD KEY idx_game_services_program_date (ACTIVE, PROGRAM_DATE)'
		);
		console.log('[game_services] Added column PROGRAM_DATE');
	}

	await backfillGameLinkedProgramDates(pool);
	return !exists;
}

module.exports = { ensureGameServicesProgramDateSchema };
