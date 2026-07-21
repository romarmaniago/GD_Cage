/**
 * Idempotent DB setup for cage_manual_cash table (USD / GCASH manual entries).
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

async function ensureCageManualCashSchema(pool) {
	const tableName = 'cage_manual_cash';
	let changed = false;

	await pool.execute(`
		CREATE TABLE IF NOT EXISTS cage_manual_cash (
			IDNo INT NOT NULL AUTO_INCREMENT,
			CURRENCY VARCHAR(10) NOT NULL,
			REPORT_DATE DATE NOT NULL,
			AMOUNT DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
			REMARKS VARCHAR(500) NULL DEFAULT NULL,
			ENCODED_BY INT NULL DEFAULT NULL,
			ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			EDITED_BY INT NULL DEFAULT NULL,
			EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
			ACTIVE TINYINT NOT NULL DEFAULT 1,
			PRIMARY KEY (IDNo),
			KEY idx_cage_manual_cash_currency_active (CURRENCY, ACTIVE),
			KEY idx_cage_manual_cash_report_date (REPORT_DATE, ACTIVE)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);

	if (!(await tableExists(pool, tableName))) {
		console.log('[cage_manual_cash] Created table cage_manual_cash');
		changed = true;
	}

	if (!(await columnExists(pool, tableName, 'REMARKS'))) {
		await pool.execute(
			'ALTER TABLE cage_manual_cash ADD COLUMN REMARKS VARCHAR(500) NULL DEFAULT NULL AFTER AMOUNT'
		);
		console.log('[cage_manual_cash] Added REMARKS column');
		changed = true;
	} else {
		const [[remarksCol]] = await pool.execute(
			`SELECT CHARACTER_MAXIMUM_LENGTH AS max_len
			 FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = DATABASE()
			   AND TABLE_NAME = ?
			   AND COLUMN_NAME = 'REMARKS'
			 LIMIT 1`,
			[tableName]
		);
		if (remarksCol && Number(remarksCol.max_len) < 500) {
			await pool.execute('ALTER TABLE cage_manual_cash MODIFY COLUMN REMARKS VARCHAR(500) NULL');
			changed = true;
		}
	}

	return changed;
}

module.exports = {
	ensureCageManualCashSchema
};
