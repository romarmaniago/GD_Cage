/**
 * Drop game_list.MULTI_SETTLED (added, then never used — the cross-account Multiple
 * Settle flow was reverted to preview-only, and the same-account cutoff-pair combined
 * settle flow was removed too, so nothing ever sends txtCutoffLinkedGameIds to
 * /add_settlement anymore and this column can never be set).
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

async function dropGameListMultiSettledSchema(pool) {
	if (await columnExists(pool, 'game_list', 'MULTI_SETTLED')) {
		await pool.execute('ALTER TABLE `game_list` DROP COLUMN `MULTI_SETTLED`');
		console.log('[game_list] Dropped column MULTI_SETTLED');
	}
}

module.exports = { dropGameListMultiSettledSchema };
