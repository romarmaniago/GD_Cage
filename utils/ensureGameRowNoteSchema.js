/**
 * Idempotent DB setup for per-game row notes on the Game Book list:
 *   - game_list.ROW_NOTE       : short free-text note (icon after the group badge)
 *   - game_list.ROW_BG_COLOR   : row background color (hex, e.g. #fff3cd)
 *   - game_list.ROW_TEXT_COLOR : row text color (hex)
 * NULL / empty means "no note" / "use the default color".
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

async function ensureGameRowNoteSchema(pool) {
	const columns = [
		['ROW_NOTE', 'VARCHAR(255) NULL DEFAULT NULL'],
		['ROW_BG_COLOR', 'VARCHAR(20) NULL DEFAULT NULL'],
		['ROW_TEXT_COLOR', 'VARCHAR(20) NULL DEFAULT NULL']
	];
	for (const [name, def] of columns) {
		if (await columnExists(pool, 'game_list', name)) continue;
		await pool.execute(`ALTER TABLE game_list ADD COLUMN ${name} ${def}`);
		console.log(`[game_list] Added column ${name}`);
	}
}

module.exports = { ensureGameRowNoteSchema };
