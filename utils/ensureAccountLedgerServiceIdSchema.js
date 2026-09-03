/**
 * Idempotent DB setup: link account_ledger rows back to the game_services
 * record that created them (F&B / Hotel service deposits).
 *
 * Before this, delete/edit of a service guessed the matching ledger row by
 * amount + "latest" — fragile when two charges share an amount, and it missed
 * JUNKET rows entirely (signed vs absolute amount). With SERVICE_ID the
 * delete/edit paths can target the exact row.
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

async function indexExists(pool, tableName, indexName) {
	const [rows] = await pool.execute(
		`SELECT COUNT(*) AS cnt
		 FROM information_schema.STATISTICS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = ?
		   AND INDEX_NAME = ?`,
		[tableName, indexName]
	);
	return Number(rows[0]?.cnt || 0) > 0;
}

async function ensureAccountLedgerServiceIdSchema(pool) {
	const hasColumn = await columnExists(pool, 'account_ledger', 'SERVICE_ID');
	if (!hasColumn) {
		await pool.execute(
			`ALTER TABLE account_ledger
			 ADD COLUMN SERVICE_ID INT NULL DEFAULT NULL
			 COMMENT 'game_services.IDNo for service-originated ledger rows'`
		);
		console.log('[account_ledger] Added column SERVICE_ID');
	}

	if (!(await indexExists(pool, 'account_ledger', 'idx_account_ledger_service_id'))) {
		try {
			await pool.execute(
				'ALTER TABLE account_ledger ADD KEY idx_account_ledger_service_id (SERVICE_ID)'
			);
			console.log('[account_ledger] Added index idx_account_ledger_service_id');
		} catch (err) {
			console.warn('[account_ledger] Could not add SERVICE_ID index:', err.message || err);
		}
	}

	// Backfill historical SERVICES deposit ledger rows — only unambiguous matches
	// (exactly one candidate game_services row within a 3-minute encode window).
	try {
		const [backfill] = await pool.execute(`
			UPDATE account_ledger al
			JOIN (
				SELECT m.ledger_id, MIN(m.service_id) AS service_id
				FROM (
					SELECT al2.IDNo AS ledger_id, gs.IDNo AS service_id
					FROM account_ledger al2
					JOIN account a ON a.IDNo = al2.ACCOUNT_ID
					JOIN game_services gs
						ON gs.AGENT_ID = a.AGENT_ID
						AND gs.TRANSACTION_ID = 2
						AND gs.GAME_ID IS NULL
						AND gs.ACTIVE = 1
						AND ABS(gs.AMOUNT) = al2.AMOUNT
						AND ABS(TIMESTAMPDIFF(SECOND, gs.ENCODED_DT, al2.ENCODED_DT)) <= 180
					WHERE al2.SERVICE_ID IS NULL
						AND al2.ACTIVE = 1
						AND al2.GAME_ID IS NULL
						AND al2.TRANSACTION_ID = 2
						AND al2.TRANSACTION_TYPE = 2
						AND al2.TRANSACTION_DESC = 'SERVICES'
				) m
				GROUP BY m.ledger_id
				HAVING COUNT(*) = 1
			) x ON x.ledger_id = al.IDNo
			SET al.SERVICE_ID = x.service_id
			WHERE al.SERVICE_ID IS NULL
		`);
		const linked = Number(backfill?.affectedRows || 0);
		if (linked > 0) {
			console.log(`[account_ledger] Backfilled SERVICE_ID on ${linked} ledger row(s)`);
		}

		// Safety: if a backfill mapped one service to multiple active ledger rows,
		// the guess was wrong — clear it so the amount-match fallback handles them.
		const [cleared] = await pool.execute(`
			UPDATE account_ledger al
			JOIN (
				SELECT SERVICE_ID
				FROM account_ledger
				WHERE SERVICE_ID IS NOT NULL AND ACTIVE = 1
				GROUP BY SERVICE_ID
				HAVING COUNT(*) > 1
			) dup ON dup.SERVICE_ID = al.SERVICE_ID
			SET al.SERVICE_ID = NULL
		`);
		const clearedCount = Number(cleared?.affectedRows || 0);
		if (clearedCount > 0) {
			console.log(`[account_ledger] Cleared ${clearedCount} ambiguous SERVICE_ID link(s)`);
		}
	} catch (err) {
		console.warn('[account_ledger] SERVICE_ID backfill skipped:', err.message || err);
	}

	return !hasColumn;
}

module.exports = { ensureAccountLedgerServiceIdSchema };
