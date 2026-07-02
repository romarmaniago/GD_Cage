/**
 * Idempotent DB setup for dashboard_check_remarks table.
 * Stores remarks for Main Cage Rolling Check and W/L Check per date.
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

async function migrateLegacyRemarksTables(pool, tableName) {
	if (await tableExists(pool, 'rolling_check_remarks')) {
		await pool.execute(
			`INSERT INTO ${tableName} (REPORT_DATE, CHECK_TYPE, REMARKS, ENCODED_BY, ENCODED_DT, EDITED_BY, EDITED_DT, ACTIVE)
			 SELECT REPORT_DATE, 'rolling', REMARKS, ENCODED_BY, ENCODED_DT, EDITED_BY, EDITED_DT, ACTIVE
			 FROM rolling_check_remarks
			 ON DUPLICATE KEY UPDATE
				REMARKS = IF(VALUES(REMARKS) IS NOT NULL AND VALUES(REMARKS) <> '', VALUES(REMARKS), ${tableName}.REMARKS),
				EDITED_BY = VALUES(EDITED_BY),
				EDITED_DT = VALUES(EDITED_DT),
				ACTIVE = VALUES(ACTIVE)`
		);
		console.log('[dashboard_check_remarks] Migrated rolling_check_remarks');
	}

	if (await tableExists(pool, 'wl_check_remarks')) {
		await pool.execute(
			`INSERT INTO ${tableName} (REPORT_DATE, CHECK_TYPE, REMARKS, ENCODED_BY, ENCODED_DT, EDITED_BY, EDITED_DT, ACTIVE)
			 SELECT REPORT_DATE, 'wl', REMARKS, ENCODED_BY, ENCODED_DT, EDITED_BY, EDITED_DT, ACTIVE
			 FROM wl_check_remarks
			 ON DUPLICATE KEY UPDATE
				REMARKS = IF(VALUES(REMARKS) IS NOT NULL AND VALUES(REMARKS) <> '', VALUES(REMARKS), ${tableName}.REMARKS),
				EDITED_BY = VALUES(EDITED_BY),
				EDITED_DT = VALUES(EDITED_DT),
				ACTIVE = VALUES(ACTIVE)`
		);
		console.log('[dashboard_check_remarks] Migrated wl_check_remarks');
	}
}

async function ensureDashboardCheckRemarksSchema(pool) {
	const tableName = 'dashboard_check_remarks';

	if (!(await tableExists(pool, tableName))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS dashboard_check_remarks (
				IDNo INT NOT NULL AUTO_INCREMENT,
				REPORT_DATE DATE NOT NULL,
				CHECK_TYPE VARCHAR(20) NOT NULL,
				REMARKS VARCHAR(500) NULL DEFAULT NULL,
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				UNIQUE KEY uk_dashboard_check_remarks_date_type (REPORT_DATE, CHECK_TYPE),
				KEY idx_dashboard_check_remarks_active (ACTIVE, CHECK_TYPE)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[dashboard_check_remarks] Created table dashboard_check_remarks');
	}

	if (await tableExists(pool, 'rolling_check_remarks') || await tableExists(pool, 'wl_check_remarks')) {
		await migrateLegacyRemarksTables(pool, tableName);
	}
}

module.exports = {
	ensureDashboardCheckRemarksSchema
};