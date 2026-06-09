const DEFAULT_SERVICES_CATEGORIES = ['F & B', 'Hotel', 'Delivery'];

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

async function ensureServicesCategoryTable(pool) {
	const exists = await tableExists(pool, 'services_category');
	if (exists) return false;

	await pool.execute(`
		CREATE TABLE services_category (
			IDNo INT(11) NOT NULL AUTO_INCREMENT,
			CATEGORY VARCHAR(255) NOT NULL,
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

async function ensureDefaultServicesCategories(pool) {
	const encodedBy = 1;
	const now = new Date();

	for (const category of DEFAULT_SERVICES_CATEGORIES) {
		const [existing] = await pool.execute(
			'SELECT IDNo FROM services_category WHERE LOWER(TRIM(CATEGORY)) = LOWER(TRIM(?)) LIMIT 1',
			[category]
		);
		if (existing.length) continue;

		await pool.execute(
			'INSERT INTO services_category (CATEGORY, ENCODED_BY, ENCODED_DT, ACTIVE) VALUES (?, ?, ?, 1)',
			[category, encodedBy, now]
		);
		console.log(`[services_category] Seeded category "${category}"`);
	}
}

async function ensureServicesCategorySchema(pool) {
	try {
		await ensureServicesCategoryTable(pool);
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
