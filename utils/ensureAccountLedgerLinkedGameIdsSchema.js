/**
 * Idempotent DB setup: persist which games were settled together in one
 * Multiple/Merge Settlement transaction.
 *
 * /add_settlement inserts one account_ledger row per settlement, tagged with
 * GAME_ID = the primary game only. When several games are settled together
 * (txtCutoffLinkedGameIds), the other games' ids were never written anywhere
 * that survives the request — there was no way to look back and see which
 * games were grouped into one payment. LINKED_GAME_IDS stores that full list
 * (primary + linked, comma-separated) so a history view can reconstruct it.
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

async function ensureAccountLedgerLinkedGameIdsSchema(pool) {
	const hasColumn = await columnExists(pool, 'account_ledger', 'LINKED_GAME_IDS');
	if (!hasColumn) {
		await pool.execute(
			`ALTER TABLE account_ledger
			 ADD COLUMN LINKED_GAME_IDS VARCHAR(255) NULL DEFAULT NULL
			 COMMENT 'Comma-separated game_list ids settled together in this transaction (primary + linked), NULL for a plain single-game settle'`
		);
		console.log('[account_ledger] Added column LINKED_GAME_IDS');
	}

	return !hasColumn;
}

module.exports = { ensureAccountLedgerLinkedGameIdsSchema };
