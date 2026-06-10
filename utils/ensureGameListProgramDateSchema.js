/**
 * Idempotent DB setup for game_list.PROGRAM_DATE (New Game modal date, date only).
 */

async function tableExists(pool, tableName) {
	const [rows] = await pool.execute(
		`SELECT COUNT(*) AS cnt
		 FROM information_schema.TABLES
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = ?`,
		[tableName]
	);
	return Number(rows[0]?.cnt || 0) > 0;
}

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

async function ensureGameListProgramDateSchema(pool) {
	if (!(await tableExists(pool, 'game_list'))) return false;

	if (!(await columnExists(pool, 'game_list', 'PROGRAM_DATE'))) {
		await pool.execute(
			`ALTER TABLE game_list
			 ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected game date from New Game modal (date only)' AFTER ENCODED_DT`
		);
		console.log('[game_list] Added column PROGRAM_DATE');
	}

	return true;
}

module.exports = { ensureGameListProgramDateSchema };
