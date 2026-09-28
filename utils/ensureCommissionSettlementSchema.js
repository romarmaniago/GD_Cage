/**
 * Idempotent DB setup for Commission settlement (Commission → Settle).
 *
 * A settlement batch settles every settled game (game_list.SETTLED = 1) whose program date falls in
 * DATE_FROM..DATE_TO: the commission (plus the game's "Settle"-paid Add Charge) moves into junket_capital
 * as 'Settlement'. Games get game_list.COMMISSION_SETTLEMENT_ID (locked in Gamebook); their Add Charge
 * rows get game_services.COMMISSION_SETTLEMENT_ID so the dashboard's Add Charge drops them too.
 * See utils/commissionSettlement.js.
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

async function ensureCommissionSettlementSchema(pool) {
	await pool.execute(
		`CREATE TABLE IF NOT EXISTS commission_settlement (
			IDNo INT NOT NULL AUTO_INCREMENT,
			DATE_FROM DATE NOT NULL,
			DATE_TO DATE NOT NULL,
			AMOUNT DECIMAL(20,2) NOT NULL DEFAULT 0 COMMENT 'Signed slip total (negative = paid out)',
			CAPITAL_ID INT NULL DEFAULT NULL COMMENT 'junket_capital row (TRANSACTION_ID 2 payout / 1 gain)',
			ACTIVE INT NOT NULL DEFAULT 1,
			ENCODED_BY INT NULL DEFAULT NULL,
			ENCODED_DT DATETIME NULL DEFAULT NULL,
			PRIMARY KEY (IDNo),
			KEY idx_commission_settlement_active (ACTIVE, DATE_FROM, DATE_TO)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
	);

	for (const table of ['game_list', 'game_services']) {
		if (!(await columnExists(pool, table, 'COMMISSION_SETTLEMENT_ID'))) {
			await pool.execute(
				`ALTER TABLE ${table}
				 ADD COLUMN COMMISSION_SETTLEMENT_ID INT NULL DEFAULT NULL COMMENT 'commission_settlement batch'`
			);
			await pool.execute(`ALTER TABLE ${table} ADD KEY idx_${table}_commission_settlement (COMMISSION_SETTLEMENT_ID)`);
			console.log(`[${table}] Added column COMMISSION_SETTLEMENT_ID`);
		}
	}

	return true;
}

module.exports = { ensureCommissionSettlementSchema };
