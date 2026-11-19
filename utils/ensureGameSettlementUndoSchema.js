/**
 * Idempotent DB setup: audit trail for "Undo Settlement" on a game
 * (POST /game_list/:id/undo_settlement). One row per undo — the settlement figures
 * that were reverted, who undid it and when (REMARKS is no longer filled).
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

async function ensureGameSettlementUndoSchema(pool) {
	if (await tableExists(pool, 'game_settlement_undo')) {
		// Remarks were dropped from the Undo dialog: allow NULL on tables created before that
		const [cols] = await pool.execute(
			`SELECT IS_NULLABLE FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_settlement_undo' AND COLUMN_NAME = 'REMARKS'`
		);
		if (cols.length && cols[0].IS_NULLABLE === 'NO') {
			await pool.execute('ALTER TABLE game_settlement_undo MODIFY REMARKS VARCHAR(500) NULL DEFAULT NULL');
		}
		return;
	}

	await pool.execute(`
		CREATE TABLE IF NOT EXISTS game_settlement_undo (
			IDNo INT NOT NULL AUTO_INCREMENT,
			GAME_ID INT NOT NULL COMMENT 'game_list.IDNo of the primary (settled) game',
			LINKED_GAME_IDS VARCHAR(255) NULL DEFAULT NULL COMMENT 'every game un-settled together (cut-off / multiple settle)',
			SETTLE_TYPE VARCHAR(20) NOT NULL COMMENT 'deposit | cash | loss',
			PAYMENT DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'game_list.PAYMENT before the undo',
			FNB DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'game_list.FNB (Add Charge) before the undo',
			ALLOCATIONS TEXT NULL DEFAULT NULL COMMENT 'JSON [{account_id, amount, ledger_id}] of the reverted COMMISSION ledger rows',
			SETTLED_DT DATETIME NULL DEFAULT NULL COMMENT 'when the reverted settlement was saved',
			REMARKS VARCHAR(500) NULL DEFAULT NULL,
			ENCODED_BY INT NOT NULL,
			ENCODED_DT DATETIME NOT NULL,
			PRIMARY KEY (IDNo),
			KEY idx_game_settlement_undo_game (GAME_ID)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);
	console.log('[game_settlement_undo] Created table game_settlement_undo');
}

module.exports = { ensureGameSettlementUndoSchema };
