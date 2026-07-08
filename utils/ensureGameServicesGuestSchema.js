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

async function ensureGameServicesGuestSchema(pool) {
	const exists = await columnExists(pool, 'game_services', 'GUEST_ID');
	if (exists) return false;

	await pool.execute(
		'ALTER TABLE game_services ADD COLUMN GUEST_ID INT NULL DEFAULT NULL COMMENT \'guest.IDNo\' AFTER AGENT_ID'
	);
	await pool.execute(
		'ALTER TABLE game_services ADD KEY idx_game_services_guest_id (GUEST_ID)'
	);
	console.log('[game_services] Added column GUEST_ID');
	return true;
}

module.exports = { ensureGameServicesGuestSchema };
