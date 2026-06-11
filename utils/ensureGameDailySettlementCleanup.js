/**
 * Drop legacy game daily-settlement schema (replaced by game_list.PROGRAM_DATE).
 * Keeps expense_daily_settlement* and junket_* .DAILY_SETTLEMENT columns intact.
 */

async function tableExists(pool, tableName) {
	const [rows] = await pool.execute(
		`SELECT COUNT(*) AS cnt
		 FROM information_schema.TABLES
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
		[tableName]
	);
	return Number(rows[0]?.cnt || 0) > 0;
}

async function columnExists(pool, tableName, columnName) {
	const [rows] = await pool.execute(
		`SELECT COUNT(*) AS cnt
		 FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
		[tableName, columnName]
	);
	return Number(rows[0]?.cnt || 0) > 0;
}

async function dropGameDailySettlementSchema(pool) {
	if (!(await tableExists(pool, 'game_list'))) {
		return false;
	}

	if (await tableExists(pool, 'daily_settlement_games')) {
		await pool.execute('DROP TABLE IF EXISTS `daily_settlement_games`');
		console.log('[game daily settlement] Dropped table daily_settlement_games');
	}

	if (await tableExists(pool, 'daily_settlement')) {
		await pool.execute('DROP TABLE IF EXISTS `daily_settlement`');
		console.log('[game daily settlement] Dropped table daily_settlement');
	}

	if (await columnExists(pool, 'game_list', 'DAILY_SETTLEMENT')) {
		await pool.execute('ALTER TABLE `game_list` DROP COLUMN `DAILY_SETTLEMENT`');
		console.log('[game daily settlement] Dropped game_list.DAILY_SETTLEMENT');
	}

	return true;
}

module.exports = { dropGameDailySettlementSchema };
