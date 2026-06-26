/**
 * Idempotent DB setup for additional_commission table.
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

async function addColumnIfMissing(pool, tableName, columnName, ddl) {
	if (await columnExists(pool, tableName, columnName)) return false;

	await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
	console.log(`[${tableName}] Added column ${columnName}`);
	return true;
}

async function ensureAdditionalCommissionSchema(pool) {
	const tableName = 'additional_commission';

	if (!(await tableExists(pool, tableName))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS additional_commission (
				IDNo INT NOT NULL AUTO_INCREMENT,
				AGENT_ID INT NULL DEFAULT NULL,
				AGENT_NAME VARCHAR(255) NULL DEFAULT NULL,
				CASH_OUT DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
				REMARKS VARCHAR(500) NULL DEFAULT NULL,
				ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				ENCODED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
				EDITED_BY INT NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				KEY idx_additional_commission_agent_id (AGENT_ID),
				KEY idx_additional_commission_active_dt (ACTIVE, ENCODED_DT)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[additional_commission] Created table additional_commission');
		return true;
	}

	await addColumnIfMissing(pool, tableName, 'AGENT_ID', 'AGENT_ID INT NULL DEFAULT NULL AFTER IDNo');
	await addColumnIfMissing(pool, tableName, 'AGENT_NAME', 'AGENT_NAME VARCHAR(255) NULL DEFAULT NULL AFTER AGENT_ID');
	await addColumnIfMissing(pool, tableName, 'CASH_OUT', 'CASH_OUT DECIMAL(18, 2) NOT NULL DEFAULT 0.00 AFTER AGENT_NAME');
	await addColumnIfMissing(pool, tableName, 'REMARKS', 'REMARKS VARCHAR(500) NULL DEFAULT NULL AFTER CASH_OUT');
	await addColumnIfMissing(pool, tableName, 'ENCODED_DT', 'ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER REMARKS');
	await addColumnIfMissing(pool, tableName, 'ENCODED_BY', 'ENCODED_BY INT NULL DEFAULT NULL AFTER ENCODED_DT');
	await addColumnIfMissing(pool, tableName, 'EDITED_DT', 'EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER ENCODED_BY');
	await addColumnIfMissing(pool, tableName, 'EDITED_BY', 'EDITED_BY INT NULL DEFAULT NULL AFTER EDITED_DT');
	await addColumnIfMissing(pool, tableName, 'ACTIVE', 'ACTIVE TINYINT NOT NULL DEFAULT 1 AFTER EDITED_BY');

	return false;
}

module.exports = {
	ensureAdditionalCommissionSchema
};
