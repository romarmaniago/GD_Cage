/**
 * Idempotent DB setup for the Agent Portal MEMO (sticky note per agent):
 * agent.MEMO (sanitized HTML, text colors only) and agent.MEMO_COLOR (note background).
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
	if (!(await columnExists(pool, 'agent', 'MEMO_COLOR'))) {
		await pool.execute(`ALTER TABLE agent ADD COLUMN MEMO_COLOR VARCHAR(20) NULL DEFAULT NULL`);
		console.log('[agent] Added column MEMO_COLOR');
	}
}

module.exports = { ensureAgentMemoSchema };
