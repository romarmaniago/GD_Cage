/**
 * Idempotent DB setup for guest.MEMBERSHIP_NO (manual entry, digits only).
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

async function getColumnType(pool, tableName, columnName) {
	const [rows] = await pool.execute(
		`SELECT COLUMN_TYPE
		 FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = ?
		   AND COLUMN_NAME = ?
		 LIMIT 1`,
		[tableName, columnName]
	);
	return rows[0]?.COLUMN_TYPE || '';
}

async function indexExists(pool, tableName, indexName) {
	const [rows] = await pool.execute(
		`SELECT COUNT(*) AS cnt
		 FROM information_schema.STATISTICS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = ?
		   AND INDEX_NAME = ?`,
		[tableName, indexName]
	);
	return Number(rows[0]?.cnt || 0) > 0;
}

async function ensureGuestMembershipSchema(pool) {
	if (!(await tableExists(pool, 'guest'))) return false;

	if (!(await columnExists(pool, 'guest', 'MEMBERSHIP_NO'))) {
		await pool.execute(
			`ALTER TABLE guest
			 ADD COLUMN MEMBERSHIP_NO VARCHAR(50) NULL DEFAULT NULL AFTER NAME`
		);
		console.log('[guest] Added column MEMBERSHIP_NO');
	} else {
		const columnType = String(await getColumnType(pool, 'guest', 'MEMBERSHIP_NO') || '').toLowerCase();
		if (columnType === 'varchar(10)') {
			await pool.execute(
				`ALTER TABLE guest MODIFY COLUMN MEMBERSHIP_NO VARCHAR(50) NULL DEFAULT NULL`
			);
			console.log('[guest] Expanded MEMBERSHIP_NO to VARCHAR(50)');
		}
	}

	if (!(await indexExists(pool, 'guest', 'idx_guest_membership_no'))) {
		await pool.execute(
			`CREATE UNIQUE INDEX idx_guest_membership_no ON guest (MEMBERSHIP_NO)`
		);
		console.log('[guest] Added unique index idx_guest_membership_no');
	}

	return false;
}

module.exports = { ensureGuestMembershipSchema };
