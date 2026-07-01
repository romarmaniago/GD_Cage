/**
 * Idempotent DB setup for dashboard_wl_share_percentages (per-month W/L rate on Anticipated Profit).
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

async function ensureDashboardWlShareSchema(pool) {
	const tableName = 'dashboard_wl_share_percentages';

	if (await tableExists(pool, tableName)) {
		return true;
	}

	await pool.execute(
		`CREATE TABLE IF NOT EXISTS \`${tableName}\` (
		  \`IDNo\` INT NOT NULL AUTO_INCREMENT,
		  \`MONTH_KEY\` CHAR(7) NOT NULL,
		  \`SHARE_PERCENTAGE\` DECIMAL(7,4) NOT NULL DEFAULT 65.0000,
		  \`ACTIVE\` TINYINT NOT NULL DEFAULT 1,
		  \`ENCODED_BY\` INT NULL DEFAULT NULL,
		  \`ENCODED_DT\` DATETIME NULL DEFAULT NULL,
		  \`EDITED_BY\` INT NULL DEFAULT NULL,
		  \`EDITED_DT\` DATETIME NULL DEFAULT NULL,
		  PRIMARY KEY (\`IDNo\`),
		  UNIQUE KEY \`uk_dashboard_wl_share_month\` (\`MONTH_KEY\`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
	);
	console.log('[dashboard_wl_share_percentages] Created table');
	return true;
}

module.exports = { ensureDashboardWlShareSchema };
