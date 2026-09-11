/**
 * Idempotent DB setup for the per-category Junket Monthly Settlement feature.
 * Independent of the legacy month_settle / RESET mechanism — does not touch
 * any existing RESET column on junket_house_expense / junket_return_money.
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

const SOURCE_TABLES_WITH_MONTHLY_SETTLE_ID = [
	'junket_house_expense',
	'junket_return_money',
	'junket_loss',
	'additional_commission',
	'game_services'
];

async function ensureJunketMonthlySettlementSchema(pool) {
	if (!(await tableExists(pool, 'junket_monthly_settlement'))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS junket_monthly_settlement (
				IDNo INT NOT NULL AUTO_INCREMENT,
				CATEGORY VARCHAR(30) NOT NULL COMMENT 'expense|loss|additional_commission|fnb|hotel|incidental',
				PERIOD_START DATE NOT NULL,
				PERIOD_END DATE NOT NULL,
				PERIOD_LABEL VARCHAR(100) NOT NULL,
				AMOUNT DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				UNIQUE KEY uq_junket_monthly_settlement (CATEGORY, PERIOD_START, PERIOD_END),
				KEY idx_junket_monthly_settlement_category_active (CATEGORY, ACTIVE, PERIOD_END)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[junket_monthly_settlement] Created table junket_monthly_settlement');
	}

	for (const tableName of SOURCE_TABLES_WITH_MONTHLY_SETTLE_ID) {
		if (!(await tableExists(pool, tableName))) continue;
		if (!(await columnExists(pool, tableName, 'MONTHLY_SETTLE_ID'))) {
			await pool.execute(
				`ALTER TABLE ${tableName} ADD COLUMN MONTHLY_SETTLE_ID INT NULL DEFAULT NULL`
			);
			console.log(`[${tableName}] Added column MONTHLY_SETTLE_ID`);
		}
	}

	return true;
}

module.exports = { ensureJunketMonthlySettlementSchema };
