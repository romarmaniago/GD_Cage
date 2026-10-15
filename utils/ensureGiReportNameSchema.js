/**
 * Idempotent DB setup for the Game Information → Report corrections.
 * gi_report_name: replaces the account owner's name on the Report only.
 * gi_report_rolling: replaces an account's computed rolling for one program-date range
 * (DATE_FROM / DATE_TO; both '' for All), on the Report only.
 * gi_report_setting: REPORT card settings shared by every user (poster image, RAFFLE text, message).
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

async function ensureGiReportNameSchema(pool) {
	if (!(await tableExists(pool, 'gi_report_name'))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS gi_report_name (
				AGENT_ID INT NOT NULL,
				NAME VARCHAR(150) NOT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				PRIMARY KEY (AGENT_ID)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[gi_report_name] Created table gi_report_name');
	}
	if (!(await tableExists(pool, 'gi_report_rolling'))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS gi_report_rolling (
				AGENT_ID INT NOT NULL,
				DATE_FROM VARCHAR(10) NOT NULL DEFAULT '',
				DATE_TO VARCHAR(10) NOT NULL DEFAULT '',
				ROLLING DECIMAL(18,2) NOT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				PRIMARY KEY (AGENT_ID, DATE_FROM, DATE_TO)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[gi_report_name] Created table gi_report_rolling');
	}
	if (!(await tableExists(pool, 'gi_report_setting'))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS gi_report_setting (
				SETTING_KEY VARCHAR(50) NOT NULL,
				VALUE MEDIUMTEXT NOT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				PRIMARY KEY (SETTING_KEY)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[gi_report_name] Created table gi_report_setting');
	}
	return true;
}

module.exports = { ensureGiReportNameSchema };
