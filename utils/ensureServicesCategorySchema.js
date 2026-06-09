const DEFAULT_SERVICES_CATEGORIES = [
	{ category: 'F & B', direction: null },
	{ category: 'Hotel', direction: null },
	{ category: 'Delivery', direction: null },
	{ category: 'Junket Payment', direction: 2 },
	{ category: 'Guest Payment', direction: 1 }
];

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

async function ensureServicesCategoryTable(pool) {
	const exists = await tableExists(pool, 'services_category');
	if (exists) return false;

	await pool.execute(`
		CREATE TABLE services_category (
			IDNo INT(11) NOT NULL AUTO_INCREMENT,
			CATEGORY VARCHAR(255) NOT NULL,
			DIRECTION TINYINT(1) DEFAULT NULL COMMENT '1=In, 2=Out',
			ENCODED_BY INT(11) NOT NULL,
			ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			EDITED_BY INT(11) DEFAULT NULL,
			EDITED_DT DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
			ACTIVE TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0=Inactive, 1=Active',
			PRIMARY KEY (IDNo)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);
	console.log('[services_category] Created table services_category');
	return true;
}

async function ensureDirectionColumn(pool) {
	const exists = await columnExists(pool, 'services_category', 'DIRECTION');
	if (exists) return false;

	await pool.execute(
		"ALTER TABLE services_category ADD COLUMN DIRECTION TINYINT(1) DEFAULT NULL COMMENT '1=In, 2=Out' AFTER CATEGORY"
	);
	console.log('[services_category] Added column DIRECTION');
	return true;
}

async function ensureDefaultServicesCategories(pool) {
	const encodedBy = 1;
	const now = new Date();

	for (const item of DEFAULT_SERVICES_CATEGORIES) {
		const category = item.category;
		const direction = item.direction;

		const [existing] = await pool.execute(
			'SELECT IDNo, DIRECTION FROM services_category WHERE LOWER(TRIM(CATEGORY)) = LOWER(TRIM(?)) LIMIT 1',
			[category]
		);

		if (!existing.length) {
			await pool.execute(
				'INSERT INTO services_category (CATEGORY, DIRECTION, ENCODED_BY, ENCODED_DT, ACTIVE) VALUES (?, ?, ?, ?, 1)',
				[category, direction, encodedBy, now]
			);
			console.log(`[services_category] Seeded category "${category}"`);
			continue;
		}

		if (direction != null && (existing[0].DIRECTION == null || existing[0].DIRECTION === '')) {
			await pool.execute('UPDATE services_category SET DIRECTION = ? WHERE IDNo = ?', [
				direction,
				existing[0].IDNo
			]);
			console.log(`[services_category] Set direction for "${category}"`);
		}
	}
}

async function ensureServicesCategorySchema(pool) {
	try {
		await ensureServicesCategoryTable(pool);
		await ensureDirectionColumn(pool);
		await ensureDefaultServicesCategories(pool);
	} catch (err) {
		console.error('[services_category] Schema/seed check failed:', err.message);
		throw err;
	}
}

module.exports = {
	ensureServicesCategorySchema,
	DEFAULT_SERVICES_CATEGORIES
};
