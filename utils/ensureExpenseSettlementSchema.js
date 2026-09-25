/**
 * Idempotent DB setup for house-expense settlement (Junket Expenses → Settle).
 *
 * A settlement batch settles every unsettled (RESET = 1) expense / return money row whose
 * program date falls in DATE_FROM..DATE_TO, withdraws the net amount from junket_capital
 * (TRANSACTION_ID = 2, DESCRIPTION = 'Expenses') and tags the rows with EXPENSE_SETTLEMENT_ID
 * (RESET = 0) so the dashboard's RESET-scoped Expenses figure drops by the settled amount.
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

async function ensureExpenseSettlementSchema(pool) {
	await pool.execute(
		`CREATE TABLE IF NOT EXISTS junket_expense_settlement (
			IDNo INT NOT NULL AUTO_INCREMENT,
			DATE_FROM DATE NOT NULL,
			DATE_TO DATE NOT NULL,
			EXPENSE_TOTAL DECIMAL(20,2) NOT NULL DEFAULT 0,
			RETURN_MONEY_TOTAL DECIMAL(20,2) NOT NULL DEFAULT 0,
			AMOUNT DECIMAL(20,2) NOT NULL DEFAULT 0 COMMENT 'Net settled = EXPENSE_TOTAL - RETURN_MONEY_TOTAL',
			CAPITAL_ID INT NULL DEFAULT NULL COMMENT 'junket_capital row (TRANSACTION_ID = 2)',
			ACTIVE INT NOT NULL DEFAULT 1,
			ENCODED_BY INT NULL DEFAULT NULL,
			ENCODED_DT DATETIME NULL DEFAULT NULL,
			PRIMARY KEY (IDNo),
			KEY idx_junket_expense_settlement_active (ACTIVE, DATE_FROM, DATE_TO)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
	);

	for (const table of ['junket_house_expense', 'junket_return_money']) {
		if (!(await columnExists(pool, table, 'EXPENSE_SETTLEMENT_ID'))) {
			await pool.execute(
				`ALTER TABLE ${table}
				 ADD COLUMN EXPENSE_SETTLEMENT_ID INT NULL DEFAULT NULL COMMENT 'junket_expense_settlement batch' AFTER RESET`
			);
			await pool.execute(
				`ALTER TABLE ${table} ADD KEY idx_${table}_expense_settlement (EXPENSE_SETTLEMENT_ID)`
			);
			console.log(`[${table}] Added column EXPENSE_SETTLEMENT_ID`);
		}
	}

	return true;
}

module.exports = { ensureExpenseSettlementSchema };
