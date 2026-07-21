/**
 * Idempotent DB setup for game_information (manual historical game entries).
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

async function ensureGameInformationSchema(pool) {
	const hasGi = await tableExists(pool, 'game_information');
	const hasLegacy = await tableExists(pool, 'game_information_manual');

	if (!hasGi && hasLegacy) {
		await pool.execute('RENAME TABLE game_information_manual TO game_information');
		console.log('[game_information] Renamed game_information_manual to game_information');
	}

	if (!(await tableExists(pool, 'game_information'))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS game_information (
				IDNo INT NOT NULL AUTO_INCREMENT,
				PROGRAM_DATE DATE NOT NULL,
				GAME_START DATETIME NULL DEFAULT NULL,
				GAME_TYPE VARCHAR(20) NOT NULL DEFAULT 'LIVE',
				GAME_NO VARCHAR(50) NULL DEFAULT NULL,
				ACCOUNT_ID INT NULL DEFAULT NULL COMMENT 'account.IDNo',
				GUEST_ID INT NULL DEFAULT NULL COMMENT 'guest.IDNo',
				BUY_IN DECIMAL(18, 2) NOT NULL DEFAULT 0,
				CASH_OUT DECIMAL(18, 2) NOT NULL DEFAULT 0,
				WIN_LOSS DECIMAL(18, 2) NOT NULL DEFAULT 0,
				ROLLING DECIMAL(18, 2) NOT NULL DEFAULT 0,
				COMMISSION_TYPE TINYINT NOT NULL DEFAULT 1 COMMENT '1=R rolling, 2=S share, 3=L loss',
				COMMISSION_PERCENTAGE DECIMAL(8, 2) NOT NULL DEFAULT 0,
				COMMISSION DECIMAL(18, 2) NOT NULL DEFAULT 0,
				ADD_CHARGE DECIMAL(18, 2) NOT NULL DEFAULT 0,
				TOTAL_SETTLEMENT DECIMAL(18, 2) NOT NULL DEFAULT 0,
				GAME_END_KIND VARCHAR(20) NOT NULL DEFAULT 'end_game' COMMENT 'datetime|on_game|pending|end_game',
				GAME_ENDED DATETIME NULL DEFAULT NULL,
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NULL DEFAULT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				KEY idx_gi_active_program (ACTIVE, PROGRAM_DATE),
				KEY idx_gi_game_no (GAME_NO),
				KEY idx_gi_account_id (ACCOUNT_ID),
				KEY idx_gi_guest_id (GUEST_ID)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[game_information] Created table game_information');
		return true;
	}

	const idColumns = [
		{
			name: 'ACCOUNT_ID',
			ddl: `ADD COLUMN ACCOUNT_ID INT NULL DEFAULT NULL COMMENT 'account.IDNo' AFTER GAME_NO`
		},
		{
			name: 'GUEST_ID',
			ddl: `ADD COLUMN GUEST_ID INT NULL DEFAULT NULL COMMENT 'guest.IDNo' AFTER ACCOUNT_ID`
		}
	];

	for (const col of idColumns) {
		if (!(await columnExists(pool, 'game_information', col.name))) {
			await pool.execute(`ALTER TABLE game_information ${col.ddl}`);
			console.log(`[game_information] Added column ${col.name}`);
		}
	}

	return true;
}

module.exports = { ensureGameInformationSchema };
