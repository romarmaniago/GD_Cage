/**
 * Idempotent DB setup for beyond_chips table.
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

async function ensureBeyondChipsSchema(pool) {
	const tableName = 'beyond_chips';

	if (await tableExists(pool, tableName)) return false;

	await pool.execute(`
		CREATE TABLE IF NOT EXISTS beyond_chips (
			IDNo INT NOT NULL AUTO_INCREMENT,
			REPORT_DATE DATE NOT NULL,
			AMOUNT DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
			ENCODED_BY INT NULL DEFAULT NULL,
			ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			EDITED_BY INT NULL DEFAULT NULL,
			EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
			ACTIVE TINYINT NOT NULL DEFAULT 1,
			PRIMARY KEY (IDNo),
			KEY idx_beyond_chips_date_active (REPORT_DATE, ACTIVE)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);
	console.log('[beyond_chips] Created table beyond_chips');
	return true;
}

module.exports = {
	ensureBeyondChipsSchema
};
