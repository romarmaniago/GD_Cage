/**
 * Idempotent DB setup for per-record name text colors shown on the
 * Agency (LINE) page:
 *   - agency.NAME_COLOR : color for the LINE name
 *   - agent.NAME_COLOR  : color for the AGENT name
 * Value is a hex string (e.g. #ff0000). NULL / empty means "use the default color".
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

async function ensureNameColorColumn(pool, tableName) {
	if (!(await tableExists(pool, tableName))) return;
	if (!(await columnExists(pool, tableName, 'NAME_COLOR'))) {
		await pool.execute(
			`ALTER TABLE \`${tableName}\`
			 ADD COLUMN NAME_COLOR VARCHAR(20) NULL DEFAULT NULL`
		);
		console.log(`[${tableName}] Added column NAME_COLOR`);
	}
}

async function ensureAgencyNameColorSchema(pool) {
	await ensureNameColorColumn(pool, 'agency');
	await ensureNameColorColumn(pool, 'agent');
	return false;
}

module.exports = { ensureAgencyNameColorSchema };
