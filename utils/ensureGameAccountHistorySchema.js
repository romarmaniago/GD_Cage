/**
 * Idempotent DB setup: audit trail for "change account" on a game
 * (PUT /game_list/:id/account). One row per change — who moved the game from
 * which account / guest to which, when, and why (REMARKS).
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

async function ensureGameAccountHistorySchema(pool) {
	if (await tableExists(pool, 'game_account_history')) return;

	await pool.execute(`
		CREATE TABLE IF NOT EXISTS game_account_history (
			IDNo INT NOT NULL AUTO_INCREMENT,
			GAME_ID INT NOT NULL COMMENT 'game_list.IDNo',
			PREV_ACCOUNT_ID INT NOT NULL COMMENT 'account.IDNo before the change',
			NEW_ACCOUNT_ID INT NOT NULL COMMENT 'account.IDNo after the change',
			PREV_GUEST_ID INT NULL DEFAULT NULL COMMENT 'guest.IDNo before the change',
			NEW_GUEST_ID INT NULL DEFAULT NULL COMMENT 'guest.IDNo after the change',
			REMARKS VARCHAR(500) NULL DEFAULT NULL,
			ENCODED_BY INT NOT NULL,
			ENCODED_DT DATETIME NOT NULL,
			PRIMARY KEY (IDNo),
			KEY idx_game_account_history_game (GAME_ID)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);
	console.log('[game_account_history] Created table game_account_history');
}

module.exports = { ensureGameAccountHistorySchema };
