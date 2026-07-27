/**
 * Idempotent DB setup for game_information agent groups (gi_agent_group).
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

async function ensureGiAgentGroupSchema(pool) {
	if (!(await tableExists(pool, 'gi_agent_group'))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS gi_agent_group (
				IDNo INT NOT NULL AUTO_INCREMENT,
				GROUP_NAME VARCHAR(100) NOT NULL,
				SORT_ORDER INT NOT NULL DEFAULT 0,
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NULL DEFAULT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				KEY idx_giag_active_sort (ACTIVE, SORT_ORDER)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[gi_agent_group] Created table gi_agent_group');
	}

	if (!(await tableExists(pool, 'gi_agent_group_member'))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS gi_agent_group_member (
				IDNo INT NOT NULL AUTO_INCREMENT,
				GROUP_ID INT NOT NULL,
				AGENT_ID INT NOT NULL,
				PRIMARY KEY (IDNo),
				UNIQUE KEY uk_giagm_group_agent (GROUP_ID, AGENT_ID),
				KEY idx_giagm_agent (AGENT_ID)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[gi_agent_group] Created table gi_agent_group_member');
	}

	return true;
}

module.exports = { ensureGiAgentGroupSchema };
