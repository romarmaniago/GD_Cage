/**
 * Idempotent DB setup: keep system-generated ledger text separate from the
 * user's own remarks.
 *
 * Buy-in, cashout, settlement, transfer and cut off rows used to write their
 * auto-generated text (e.g. "Buy In - #123", "Cut Off - In #45 (1st)") into
 * REMARKS, overwriting whatever the user typed. AUTO_REMARKS now holds that
 * generated text, and REMARKS holds only the user's input.
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

async function ensureAccountLedgerAutoRemarksSchema(pool) {
	const hasColumn = await columnExists(pool, 'account_ledger', 'AUTO_REMARKS');
	if (!hasColumn) {
		await pool.execute(
			`ALTER TABLE account_ledger
			 ADD COLUMN AUTO_REMARKS VARCHAR(255) NULL DEFAULT NULL
			 COMMENT 'System-generated description (Buy In / Settlement / Transfer / Cut Off); REMARKS holds user input only'`
		);
		console.log('[account_ledger] Added column AUTO_REMARKS');
	}

	return !hasColumn;
}

module.exports = { ensureAccountLedgerAutoRemarksSchema };
