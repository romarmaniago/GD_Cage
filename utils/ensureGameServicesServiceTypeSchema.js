const LEGACY_SERVICE_TYPE_TO_CATEGORY = {
	fnb: 'F & B',
	hotel: 'Hotel',
	delivery: 'Delivery'
};

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

async function ensureGameServicesServiceTypeSchema(pool) {
	const columnType = String(await getColumnType(pool, 'game_services', 'SERVICE_TYPE') || '').toLowerCase();
	if (!columnType) return false;

	if (!columnType.startsWith('enum(')) {
		return false;
	}

	await pool.execute(
		"ALTER TABLE game_services MODIFY COLUMN SERVICE_TYPE VARCHAR(255) NOT NULL DEFAULT ''"
	);
	console.log('[game_services] Migrated SERVICE_TYPE from ENUM to VARCHAR(255)');

	for (const [legacySlug, categoryName] of Object.entries(LEGACY_SERVICE_TYPE_TO_CATEGORY)) {
		await pool.execute(
			'UPDATE game_services SET SERVICE_TYPE = ? WHERE SERVICE_TYPE = ?',
			[categoryName, legacySlug]
		);
	}

	return true;
}

module.exports = {
	ensureGameServicesServiceTypeSchema,
	LEGACY_SERVICE_TYPE_TO_CATEGORY
};
