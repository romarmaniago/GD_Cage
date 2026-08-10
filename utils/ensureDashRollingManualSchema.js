/**
 * Idempotent DB setup for dashboard_rolling_manual table.
 * Stores manually-entered Buy In / Cash Out / Rolling for Main Cage Rolling Check
 * dates that fall before the auto-computed data cutoff (no source data exists).
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

async function ensureDashRollingManualSchema(pool) {
	const tableName = 'dashboard_rolling_manual';

	if (await tableExists(pool, tableName)) return false;

	await pool.execute(`
		CREATE TABLE IF NOT EXISTS dashboard_rolling_manual (
			IDNo INT NOT NULL AUTO_INCREMENT,
			REPORT_DATE DATE NOT NULL,
			BUY_IN DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
			CASH_OUT DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
			ROLLING DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
			ENCODED_BY INT NULL DEFAULT NULL,
			ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			EDITED_BY INT NULL DEFAULT NULL,
			EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
			ACTIVE TINYINT NOT NULL DEFAULT 1,
			PRIMARY KEY (IDNo),
			UNIQUE KEY uk_dashboard_rolling_manual_date (REPORT_DATE)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);
	console.log('[dashboard_rolling_manual] Created table dashboard_rolling_manual');
	return true;
}

module.exports = {
	ensureDashRollingManualSchema
};
