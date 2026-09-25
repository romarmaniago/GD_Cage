/**
 * Idempotent DB setup for Additional Commission settlement (Additional → Settle).
 *
 * A settlement batch settles every unsettled additional_commission row whose program date falls
 * in DATE_FROM..DATE_TO, withdraws the total from junket_capital (TRANSACTION_ID = 2,
 * DESCRIPTION = 'Additional') and tags the rows with ADDITIONAL_SETTLEMENT_ID so the dashboard's
 * Additional figures drop by the settled amount. Mirrors ensureJunketLossSettlementSchema.
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

async function ensureAdditionalCommissionSettlementSchema(pool) {
	await pool.execute(
		`CREATE TABLE IF NOT EXISTS additional_commission_settlement (
			IDNo INT NOT NULL AUTO_INCREMENT,
			DATE_FROM DATE NOT NULL,
			DATE_TO DATE NOT NULL,
			AMOUNT DECIMAL(20,2) NOT NULL DEFAULT 0 COMMENT 'SUM(additional_commission.AMOUNT) settled',
			CAPITAL_ID INT NULL DEFAULT NULL COMMENT 'junket_capital row (TRANSACTION_ID = 2)',
			ACTIVE INT NOT NULL DEFAULT 1,
			ENCODED_BY INT NULL DEFAULT NULL,
			ENCODED_DT DATETIME NULL DEFAULT NULL,
			PRIMARY KEY (IDNo),
			KEY idx_additional_commission_settlement_active (ACTIVE, DATE_FROM, DATE_TO)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
	);

	if (!(await columnExists(pool, 'additional_commission', 'ADDITIONAL_SETTLEMENT_ID'))) {
		await pool.execute(
			`ALTER TABLE additional_commission
			 ADD COLUMN ADDITIONAL_SETTLEMENT_ID INT NULL DEFAULT NULL COMMENT 'additional_commission_settlement batch'`
		);
		await pool.execute(
			'ALTER TABLE additional_commission ADD KEY idx_additional_commission_settlement (ADDITIONAL_SETTLEMENT_ID)'
		);
		console.log('[additional_commission] Added column ADDITIONAL_SETTLEMENT_ID');
	}

	return true;
}

module.exports = { ensureAdditionalCommissionSettlementSchema };
