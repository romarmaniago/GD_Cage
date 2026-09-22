/**
 * Idempotent DB setup: flag game_list rows that were settled as part of a
 * Multiple Settlement (several games settled together in one payment), so
 * the Game Book list can show a distinct color for them (vs. a plain
 * single-game settle) without re-deriving it from account_ledger.
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

async function ensureGameListMultiSettledSchema(pool) {
	const hasColumn = await columnExists(pool, 'game_list', 'MULTI_SETTLED');
	if (!hasColumn) {
		await pool.execute(
			`ALTER TABLE game_list
			 ADD COLUMN MULTI_SETTLED TINYINT(1) NOT NULL DEFAULT 0
			 COMMENT 'Set to 1 when this game was settled as part of a Multiple Settlement batch'`
		);
		console.log('[game_list] Added column MULTI_SETTLED');
	}

	return !hasColumn;
}

module.exports = { ensureGameListMultiSettledSchema };
