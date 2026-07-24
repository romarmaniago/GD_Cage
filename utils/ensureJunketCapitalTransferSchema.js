/**
 * Idempotent DB setup for junket_capital transfer-to-account columns.
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

async function ensureJunketCapitalTransferSchema(pool) {
	if (!(await columnExists(pool, 'junket_capital', 'ACCOUNT_ID'))) {
		await pool.execute(
			`ALTER TABLE junket_capital
			 ADD COLUMN ACCOUNT_ID INT NULL DEFAULT NULL COMMENT 'Linked account for Transfer type' AFTER PROGRAM_DATE`
		);
		console.log('[junket_capital] Added column ACCOUNT_ID');
	}

	if (!(await columnExists(pool, 'junket_capital', 'ACCOUNT_LEDGER_ID'))) {
		await pool.execute(
			`ALTER TABLE junket_capital
			 ADD COLUMN ACCOUNT_LEDGER_ID INT NULL DEFAULT NULL COMMENT 'Linked account_ledger row for Transfer type' AFTER ACCOUNT_ID`
		);
		console.log('[junket_capital] Added column ACCOUNT_LEDGER_ID');
	}

	return true;
}

module.exports = { ensureJunketCapitalTransferSchema };
