/**
 * The LINE / AGENT name text-color feature was removed: drop agency.NAME_COLOR and agent.NAME_COLOR.
 * Idempotent — does nothing once the columns are gone.
 */

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

async function dropNameColorColumns(pool) {
	for (const tableName of ['agency', 'agent']) {
		if (await columnExists(pool, tableName, 'NAME_COLOR')) {
			await pool.execute(`ALTER TABLE \`${tableName}\` DROP COLUMN NAME_COLOR`);
			console.log(`[${tableName}] Dropped unused column NAME_COLOR`);
		}
	}
}

module.exports = { dropNameColorColumns };
