/**
 * Idempotent DB setup for tip table.
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

async function ensureTipSchema(pool) {
	const exists = await tableExists(pool, 'tip');
	if (!exists) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS tip (
				IDNo INT NOT NULL AUTO_INCREMENT,
				AMOUNT DECIMAL(18, 2) NOT NULL,
				GAME_ID INT NULL DEFAULT NULL COMMENT 'game_list.IDNo',
				ACCOUNT_ID INT NULL DEFAULT NULL COMMENT 'account.IDNo',
				TIP_TYPE TINYINT NOT NULL COMMENT '1=Roller, 2=Dealer',
				TIP_DATETIME DATETIME NOT NULL,
				CASHOUT_ID INT NULL DEFAULT NULL COMMENT 'game_record.IDNo',
				REMARKS VARCHAR(500) NULL DEFAULT NULL,
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NULL DEFAULT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				KEY idx_tip_active_dt (ACTIVE, TIP_DATETIME),
				KEY idx_tip_game_id (GAME_ID),
				KEY idx_tip_account_id (ACCOUNT_ID),
				KEY idx_tip_cashout_id (CASHOUT_ID)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[tip] Created table tip');
		return true;
	}

	if (!(await columnExists(pool, 'tip', 'CASHOUT_ID'))) {
		await pool.execute(
			`ALTER TABLE tip
			 ADD COLUMN CASHOUT_ID INT NULL DEFAULT NULL COMMENT 'game_record.IDNo' AFTER TIP_DATETIME,
			 ADD KEY idx_tip_cashout_id (CASHOUT_ID)`
		);
		console.log('[tip] Added column CASHOUT_ID');
	}

	return false;
}

module.exports = { ensureTipSchema };
