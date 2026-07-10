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

async function ensureGameServicesProgramDateSchema(pool) {
	const exists = await columnExists(pool, 'game_services', 'PROGRAM_DATE');
	if (exists) return false;

	await pool.execute(
		`ALTER TABLE game_services
		 ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected program date (date only)' AFTER ENCODED_DT`
	);
	await pool.execute(
		'ALTER TABLE game_services ADD KEY idx_game_services_program_date (ACTIVE, PROGRAM_DATE)'
	);
	console.log('[game_services] Added column PROGRAM_DATE');
	return true;
}

module.exports = { ensureGameServicesProgramDateSchema };
