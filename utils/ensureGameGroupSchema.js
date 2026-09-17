const DEFAULT_GAME_GROUP = 'Main';

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

async function ensureGameGroupTable(pool) {
	const exists = await tableExists(pool, 'game_group');
	if (exists) return false;

	await pool.execute(`
		CREATE TABLE game_group (
			IDNo INT(11) NOT NULL AUTO_INCREMENT,
			NAME VARCHAR(50) NOT NULL,
			ENCODED_BY INT(11) NOT NULL,
			ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			EDITED_BY INT(11) DEFAULT NULL,
			EDITED_DT DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
			ACTIVE TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0=Inactive, 1=Active',
			PRIMARY KEY (IDNo)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);
	console.log('[game_group] Created table game_group');
	return true;
}

async function ensureDefaultGameGroup(pool) {
	const encodedBy = 1;
	const now = new Date();

	const [existing] = await pool.execute(
		'SELECT IDNo FROM game_group WHERE LOWER(TRIM(NAME)) = LOWER(TRIM(?)) LIMIT 1',
		[DEFAULT_GAME_GROUP]
	);

	if (!existing.length) {
		await pool.execute(
			'INSERT INTO game_group (NAME, ENCODED_BY, ENCODED_DT, ACTIVE) VALUES (?, ?, ?, 1)',
			[DEFAULT_GAME_GROUP, encodedBy, now]
		);
		console.log(`[game_group] Seeded default group "${DEFAULT_GAME_GROUP}"`);
	}
}

async function ensureGameListGroupIdColumn(pool) {
	if (!(await tableExists(pool, 'game_list'))) return;
	if (await columnExists(pool, 'game_list', 'GROUP_ID')) return;

	await pool.execute(`ALTER TABLE game_list ADD COLUMN GROUP_ID INT(11) NULL DEFAULT NULL AFTER GUEST_ID`);
	console.log('[game_group] Added game_list.GROUP_ID column');
}

async function backfillGameListGroupId(pool) {
	await pool.execute(
		`UPDATE game_list
		 SET GROUP_ID = (SELECT IDNo FROM game_group WHERE LOWER(TRIM(NAME)) = LOWER(TRIM(?)) LIMIT 1)
		 WHERE GROUP_ID IS NULL`,
		[DEFAULT_GAME_GROUP]
	);
}

async function ensureGameGroupSchema(pool) {
	try {
		await ensureGameGroupTable(pool);
		await ensureDefaultGameGroup(pool);
		await ensureGameListGroupIdColumn(pool);
		await backfillGameListGroupId(pool);
	} catch (err) {
		console.error('[game_group] Schema/seed check failed:', err.message);
		throw err;
	}
}

module.exports = {
	ensureGameGroupSchema,
	DEFAULT_GAME_GROUP
};
