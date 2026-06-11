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

async function ensureGameServicesDeliveryFeeSchema(pool) {
	const exists = await columnExists(pool, 'game_services', 'DELIVERY_FEE');
	if (exists) return false;

	await pool.execute(
		'ALTER TABLE game_services ADD COLUMN DELIVERY_FEE DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER AMOUNT'
	);
	console.log('[game_services] Added column DELIVERY_FEE');
	return true;
}

module.exports = { ensureGameServicesDeliveryFeeSchema };
