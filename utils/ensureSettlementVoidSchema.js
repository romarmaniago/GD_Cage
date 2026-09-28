/**
 * Idempotent DB setup for voiding a settlement (View settlement → Void).
 * Adds VOIDED_BY / VOIDED_DT / VOID_REASON to every settlement batch table; a voided batch keeps its
 * row (ACTIVE = 0) for audit. Runs after the tables are created (see config/db.js). See utils/settlementVoid.js.
 */
const { SETTLEMENT_TABLES } = require('./settlementVoid');

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

async function ensureSettlementVoidSchema(pool) {
	const columns = [
		['VOIDED_BY', 'VOIDED_BY INT NULL DEFAULT NULL'],
		['VOIDED_DT', 'VOIDED_DT DATETIME NULL DEFAULT NULL'],
		['VOID_REASON', 'VOID_REASON VARCHAR(500) NULL DEFAULT NULL']
	];
	for (const table of SETTLEMENT_TABLES) {
		for (const [name, ddl] of columns) {
			if (!(await columnExists(pool, table, name))) {
				await pool.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
				console.log(`[${table}] Added column ${name}`);
			}
		}
	}
	return true;
}

module.exports = { ensureSettlementVoidSchema };
