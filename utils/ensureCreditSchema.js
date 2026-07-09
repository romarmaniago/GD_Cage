/**
 * Idempotent DB setup for credit_transaction table.
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

async function ensureCreditSchema(pool) {
	const hasNew = await tableExists(pool, 'credit_transaction');
	const hasOld = await tableExists(pool, 'credit');

	if (!hasNew && hasOld) {
		await pool.execute('RENAME TABLE `credit` TO `credit_transaction`');
		console.log('[credit] Renamed table credit -> credit_transaction');
	}

	const exists = await tableExists(pool, 'credit_transaction');
	if (!exists) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS credit_transaction (
				IDNo INT NOT NULL AUTO_INCREMENT,
				ACCOUNT_ID INT NOT NULL,
				GUEST_ID INT NULL DEFAULT NULL,
				CREDIT_ACTION VARCHAR(32) NOT NULL COMMENT 'Transfer | Buy-in | Cash-in | Cash-out | Chips Return',
				CREDIT_SOURCE VARCHAR(16) NULL DEFAULT NULL COMMENT 'CREDIT | BUYIN',
				DIRECTION VARCHAR(16) NOT NULL COMMENT 'issue | return',
				AMOUNT DECIMAL(18,2) NOT NULL DEFAULT 0.00,
				BALANCE_AFTER DECIMAL(18,2) NULL DEFAULT NULL,
				LEDGER_ID INT NULL DEFAULT NULL COMMENT 'linked account_ledger.IDNo when mirrored',
				GAME_ID INT NULL DEFAULT NULL,
				PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'date only, no time',
				GUARANTOR VARCHAR(255) NULL DEFAULT NULL,
				REMARKS VARCHAR(500) NULL DEFAULT NULL,
				ACTIVE TINYINT(1) NOT NULL DEFAULT 1,
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NOT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				PRIMARY KEY (IDNo),
				KEY idx_credit_txn_account_dt (ACCOUNT_ID, ENCODED_DT),
				KEY idx_credit_txn_guest (GUEST_ID),
				KEY idx_credit_txn_action (CREDIT_ACTION),
				KEY idx_credit_txn_source (CREDIT_SOURCE),
				UNIQUE KEY uk_credit_txn_ledger (LEDGER_ID),
				KEY idx_credit_txn_program_date (PROGRAM_DATE),
				KEY idx_credit_txn_active (ACTIVE)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);
		console.log('[credit] Created table credit_transaction');
	}

	if (!(await columnExists(pool, 'credit_transaction', 'CREDIT_SOURCE'))) {
		await pool.execute(`
			ALTER TABLE credit_transaction
			ADD COLUMN CREDIT_SOURCE VARCHAR(16) NULL DEFAULT NULL COMMENT 'CREDIT | BUYIN' AFTER CREDIT_ACTION,
			ADD KEY idx_credit_txn_source (CREDIT_SOURCE)
		`);
		console.log('[credit] Added column CREDIT_SOURCE');
	}

	if (!(await columnExists(pool, 'credit_transaction', 'PROGRAM_DATE'))) {
		await pool.execute(`
			ALTER TABLE credit_transaction
			ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'date only, no time' AFTER GAME_ID,
			ADD KEY idx_credit_txn_program_date (PROGRAM_DATE)
		`);
		console.log('[credit] Added column PROGRAM_DATE');
	}

	if (!(await columnExists(pool, 'credit_transaction', 'GUARANTOR'))) {
		await pool.execute(`
			ALTER TABLE credit_transaction
			ADD COLUMN GUARANTOR VARCHAR(255) NULL DEFAULT NULL AFTER PROGRAM_DATE
		`);
		console.log('[credit] Added column GUARANTOR');
	}

	// Normalize legacy CREDIT_ACTION codes to UI labels.
	await pool.execute(`
		UPDATE credit_transaction
		SET CREDIT_ACTION = CASE
			WHEN CREDIT_ACTION IN ('return_deposit', 'Transfer') THEN 'Transfer'
			WHEN CREDIT_ACTION IN ('game_credit', 'Buy-in', 'Buy In', 'Buy-In') THEN 'Buy-in'
			WHEN CREDIT_ACTION IN ('return_cash', 'Cash-in', 'Cash In', 'Cash-In') THEN 'Cash-in'
			WHEN CREDIT_ACTION IN ('cash_credit', 'Cash-out', 'Cash Out', 'Cash-Out') THEN 'Cash-out'
			WHEN CREDIT_ACTION IN ('chips_return', 'Chips Return') THEN 'Chips Return'
			ELSE CREDIT_ACTION
		END
		WHERE CREDIT_ACTION IN (
			'return_deposit', 'game_credit', 'return_cash', 'cash_credit', 'chips_return',
			'Buy In', 'Buy-In', 'Cash In', 'Cash-In', 'Cash Out', 'Cash-Out'
		)
	`);

	// Backfill CREDIT_SOURCE for known actions.
	await pool.execute(`
		UPDATE credit_transaction
		SET CREDIT_SOURCE = CASE
			WHEN CREDIT_ACTION IN ('Buy-in', 'Chips Return') THEN 'BUYIN'
			WHEN CREDIT_ACTION = 'Cash-out' THEN 'CREDIT'
			WHEN CREDIT_ACTION IN ('Transfer', 'Cash-in') AND CREDIT_SOURCE IS NULL THEN 'CREDIT'
			ELSE CREDIT_SOURCE
		END
		WHERE CREDIT_SOURCE IS NULL
		  AND CREDIT_ACTION IN ('Buy-in', 'Cash-out', 'Transfer', 'Cash-in', 'Chips Return')
	`);

	// Remove duplicate LEDGER_ID rows (keep lowest IDNo) so unique key can be added.
	const [dedupeResult] = await pool.execute(`
		DELETE ct FROM credit_transaction ct
		JOIN (
			SELECT LEDGER_ID, MIN(IDNo) AS keep_id
			FROM credit_transaction
			WHERE LEDGER_ID IS NOT NULL
			GROUP BY LEDGER_ID
			HAVING COUNT(*) > 1
		) d ON d.LEDGER_ID = ct.LEDGER_ID AND ct.IDNo <> d.keep_id
	`);
	const deduped = Number(dedupeResult?.affectedRows || 0);
	if (deduped > 0) {
		console.log(`[credit] Removed ${deduped} duplicate LEDGER_ID row(s)`);
	}

	// Move "Guarantor: …" out of REMARKS into GUARANTOR (Buy-in / legacy rows).
	await pool.execute(`
		UPDATE credit_transaction
		SET GUARANTOR = TRIM(
			SUBSTRING_INDEX(
				SUBSTRING(REMARKS, LOCATE('Guarantor:', REMARKS) + LENGTH('Guarantor:')),
				'|',
				1
			)
		)
		WHERE (GUARANTOR IS NULL OR TRIM(GUARANTOR) = '')
		  AND REMARKS LIKE '%Guarantor:%'
	`);
	await pool.execute(`
		UPDATE credit_transaction
		SET REMARKS = NULL
		WHERE REMARKS REGEXP '^[[:space:]]*Guarantor:[[:space:]]*.+[[:space:]]*$'
	`);
	await pool.execute(`
		UPDATE credit_transaction
		SET REMARKS = NULLIF(
			TRIM(BOTH ' |' FROM TRIM(
				REPLACE(REMARKS, CONCAT('Guarantor: ', GUARANTOR), '')
			)),
			''
		)
		WHERE GUARANTOR IS NOT NULL
		  AND TRIM(GUARANTOR) <> ''
		  AND REMARKS LIKE CONCAT('%Guarantor: ', GUARANTOR, '%')
	`);

	if (!(await indexExists(pool, 'credit_transaction', 'uk_credit_txn_ledger'))) {
		try {
			await pool.execute(`
				ALTER TABLE credit_transaction
				ADD UNIQUE KEY uk_credit_txn_ledger (LEDGER_ID)
			`);
			console.log('[credit] Added unique key uk_credit_txn_ledger');
		} catch (err) {
			console.warn('[credit] Could not add unique LEDGER_ID key:', err.message || err);
		}
	}

	return false;
}

/**
 * One-time startup sync of legacy ledger credit rows.
 * Do NOT call this from insertCreditRecord — that caused double Buy-in amounts.
 */
async function backfillCreditFromLedger(pool) {
	if (!(await tableExists(pool, 'credit_transaction'))) return 0;

	const [backfillResult] = await pool.execute(`
		INSERT INTO credit_transaction
			(ACCOUNT_ID, GUEST_ID, CREDIT_ACTION, CREDIT_SOURCE, DIRECTION, AMOUNT, BALANCE_AFTER, LEDGER_ID, GAME_ID, REMARKS, ACTIVE, ENCODED_BY, ENCODED_DT, EDITED_BY, EDITED_DT)
		SELECT
			al.ACCOUNT_ID,
			NULL,
			CASE
				WHEN al.TRANSACTION_ID = 3 AND al.TRANSACTION_TYPE = 3 THEN 'Cash-out'
				WHEN al.TRANSACTION_ID = 10 AND al.TRANSACTION_TYPE = 3 THEN 'Buy-in'
				WHEN al.TRANSACTION_ID = 11 THEN 'Cash-in'
				WHEN al.TRANSACTION_ID = 12 THEN 'Transfer'
				WHEN al.TRANSACTION_ID = 1 AND al.TRANSACTION_TYPE = 4 THEN 'Chips Return'
				ELSE 'Cash-out'
			END AS CREDIT_ACTION,
			CASE
				WHEN al.TRANSACTION_ID = 10 AND al.TRANSACTION_TYPE = 3 THEN 'BUYIN'
				WHEN al.TRANSACTION_ID = 1 AND al.TRANSACTION_TYPE = 4 THEN 'BUYIN'
				WHEN al.TRANSACTION_ID IN (11, 12) AND UPPER(TRIM(COALESCE(al.TRANSACTION_DESC, ''))) = 'RETURN_SOURCE:BUYIN' THEN 'BUYIN'
				WHEN al.TRANSACTION_ID IN (11, 12) AND (al.TRANSACTION_DESC IS NULL OR TRIM(al.TRANSACTION_DESC) = '') THEN 'BUYIN'
				ELSE 'CREDIT'
			END AS CREDIT_SOURCE,
			CASE
				WHEN al.TRANSACTION_ID IN (3, 10) AND al.TRANSACTION_TYPE = 3 THEN 'issue'
				ELSE 'return'
			END AS DIRECTION,
			al.AMOUNT,
			NULL,
			al.IDNo,
			al.GAME_ID,
			al.REMARKS,
			al.ACTIVE,
			al.ENCODED_BY,
			al.ENCODED_DT,
			al.EDITED_BY,
			al.EDITED_DT
		FROM account_ledger al
		WHERE al.ACTIVE = 1
		  AND (
			(al.TRANSACTION_ID IN (3, 10) AND al.TRANSACTION_TYPE = 3)
			OR al.TRANSACTION_ID IN (11, 12)
			OR (al.TRANSACTION_ID = 1 AND al.TRANSACTION_TYPE = 4)
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM credit_transaction ct WHERE ct.LEDGER_ID = al.IDNo
		  )
	`);
	const inserted = Number(backfillResult?.affectedRows || 0);
	if (inserted > 0) {
		console.log(`[credit] Backfilled ${inserted} row(s) from account_ledger`);
	}
	return inserted;
}

module.exports = {
	ensureCreditSchema,
	backfillCreditFromLedger
};
