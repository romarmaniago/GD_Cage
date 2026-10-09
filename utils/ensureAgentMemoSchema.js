/**
 * Idempotent DB setup for the Agent Portal MEMO (sticky note per agent):
 * agent.MEMO (sanitized HTML, text colors only).
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

async function ensureAgentMemoSchema(pool) {
	if (!(await columnExists(pool, 'agent', 'MEMO'))) {
		await pool.execute(`ALTER TABLE agent ADD COLUMN MEMO MEDIUMTEXT NULL DEFAULT NULL`);
		console.log('[agent] Added column MEMO');
	}
	// MEMO_COLOR (sticky-note background) was dropped from the feature — remove the leftover column.
	if (await columnExists(pool, 'agent', 'MEMO_COLOR')) {
		await pool.execute(`ALTER TABLE agent DROP COLUMN MEMO_COLOR`);
		console.log('[agent] Dropped unused column MEMO_COLOR');
	}
}

module.exports = { ensureAgentMemoSchema };
