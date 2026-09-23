/**
 * Idempotent DB setup for game_list.SHARE_PERCENTAGE / ROLLING_PERCENTAGE
 * (Share + Rolling game type, COMMISSION_TYPE = 3).
 *
 * Commission for type 3 = (Win/Loss × SHARE_PERCENTAGE%) + (|Rolling| × COMMISSION_PERCENTAGE% × ROLLING_PERCENTAGE%).
 * Defaults (Share 0 / Rolling 100) make legacy "Loosing Game" rows compute exactly like before.
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

async function ensureGameListShareRollingSchema(pool) {
	if (!(await tableExists(pool, 'game_list'))) return false;

	if (!(await columnExists(pool, 'game_list', 'SHARE_PERCENTAGE'))) {
		await pool.execute(
			`ALTER TABLE game_list
			 ADD COLUMN SHARE_PERCENTAGE DECIMAL(5, 2) NOT NULL DEFAULT 0 COMMENT 'Share + Rolling (type 3): % of Win/Loss' AFTER COMMISSION_PERCENTAGE`
		);
		console.log('[game_list] Added column SHARE_PERCENTAGE');
	}

	if (!(await columnExists(pool, 'game_list', 'ROLLING_PERCENTAGE'))) {
		await pool.execute(
			`ALTER TABLE game_list
			 ADD COLUMN ROLLING_PERCENTAGE DECIMAL(5, 2) NOT NULL DEFAULT 100 COMMENT 'Share + Rolling (type 3): % of the rolling rate applied' AFTER SHARE_PERCENTAGE`
		);
		console.log('[game_list] Added column ROLLING_PERCENTAGE');
	}

	return true;
}

module.exports = { ensureGameListShareRollingSchema };
