/**
 * Idempotent DB setup for Add Charge settlement (Add Charge → Settle).
 *
 * A settlement batch settles every unsettled game_services row (in an active service category) whose
 * program date falls in DATE_FROM..DATE_TO and moves the signed net into junket_capital: a net cost
 * is withdrawn (TRANSACTION_ID = 2), a net gain deposited (TRANSACTION_ID = 1), DESCRIPTION = 'Add Charge'.
 * Rows are tagged with SERVICE_SETTLEMENT_ID so the dashboard's Add Charge figures drop them.
 * See utils/serviceSettlement.js.
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

async function ensureServiceSettlementSchema(pool) {
	await pool.execute(
		`CREATE TABLE IF NOT EXISTS service_settlement (
			IDNo INT NOT NULL AUTO_INCREMENT,
			DATE_FROM DATE NOT NULL,
			DATE_TO DATE NOT NULL,
			AMOUNT DECIMAL(20,2) NOT NULL DEFAULT 0 COMMENT 'Signed net Add Charge settled (negative = cost)',
			CAPITAL_ID INT NULL DEFAULT NULL COMMENT 'junket_capital row (TRANSACTION_ID 2 cost / 1 gain)',
			ACTIVE INT NOT NULL DEFAULT 1,
			ENCODED_BY INT NULL DEFAULT NULL,
			ENCODED_DT DATETIME NULL DEFAULT NULL,
			PRIMARY KEY (IDNo),
			KEY idx_service_settlement_active (ACTIVE, DATE_FROM, DATE_TO)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
	);

	// Set when only one service category was settled (dashboard F&B / Hotel / … modal).
	if (!(await columnExists(pool, 'service_settlement', 'CATEGORY'))) {
		await pool.execute(
			`ALTER TABLE service_settlement
			 ADD COLUMN CATEGORY VARCHAR(100) NULL DEFAULT NULL COMMENT 'Single service category settled (NULL = all)' AFTER DATE_TO`
		);
		console.log('[service_settlement] Added column CATEGORY');
	}

	if (!(await columnExists(pool, 'game_services', 'SERVICE_SETTLEMENT_ID'))) {
		await pool.execute(
			`ALTER TABLE game_services
			 ADD COLUMN SERVICE_SETTLEMENT_ID INT NULL DEFAULT NULL COMMENT 'service_settlement batch'`
		);
		await pool.execute('ALTER TABLE game_services ADD KEY idx_game_services_settlement (SERVICE_SETTLEMENT_ID)');
		console.log('[game_services] Added column SERVICE_SETTLEMENT_ID');
	}

	return true;
}

module.exports = { ensureServiceSettlementSchema };
