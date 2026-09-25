/**
 * Idempotent DB setup for Loss Amount settlement (Loss Amount → Settle).
 *
 * A settlement batch settles every unsettled junket_loss row (Loss and Recovery) whose program date
 * falls in DATE_FROM..DATE_TO, withdraws the net amount from junket_capital (TRANSACTION_ID = 2,
 * DESCRIPTION = 'Loss Amount') and tags the rows with LOSS_SETTLEMENT_ID so the dashboard's
 * Loss Amount figures drop by the settled amount. Mirrors ensureExpenseSettlementSchema.
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

async function ensureJunketLossSettlementSchema(pool) {
	await pool.execute(
		`CREATE TABLE IF NOT EXISTS junket_loss_settlement (
			IDNo INT NOT NULL AUTO_INCREMENT,
			DATE_FROM DATE NOT NULL,
			DATE_TO DATE NOT NULL,
			AMOUNT DECIMAL(20,2) NOT NULL DEFAULT 0 COMMENT 'Net settled = SUM(junket_loss.AMOUNT) (recoveries are negative)',
			CAPITAL_ID INT NULL DEFAULT NULL COMMENT 'junket_capital row (TRANSACTION_ID = 2)',
			ACTIVE INT NOT NULL DEFAULT 1,
			ENCODED_BY INT NULL DEFAULT NULL,
			ENCODED_DT DATETIME NULL DEFAULT NULL,
			PRIMARY KEY (IDNo),
			KEY idx_junket_loss_settlement_active (ACTIVE, DATE_FROM, DATE_TO)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
	);

	if (!(await columnExists(pool, 'junket_loss', 'LOSS_SETTLEMENT_ID'))) {
		await pool.execute(
			`ALTER TABLE junket_loss
			 ADD COLUMN LOSS_SETTLEMENT_ID INT NULL DEFAULT NULL COMMENT 'junket_loss_settlement batch'`
		);
		await pool.execute('ALTER TABLE junket_loss ADD KEY idx_junket_loss_settlement (LOSS_SETTLEMENT_ID)');
		console.log('[junket_loss] Added column LOSS_SETTLEMENT_ID');
	}

	return true;
}

module.exports = { ensureJunketLossSettlementSchema };
