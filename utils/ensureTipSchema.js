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

async function ensureTipSchema(pool) {
	const exists = await tableExists(pool, 'tip');
	if (!exists) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS tip (
				IDNo INT NOT NULL AUTO_INCREMENT,
				AMOUNT DECIMAL(18, 2) NOT NULL,
				GAME_ID INT NULL DEFAULT NULL COMMENT 'game_list.IDNo',
				ACCOUNT_ID INT NULL DEFAULT NULL COMMENT 'account.IDNo',
				GUEST_ID INT NULL DEFAULT NULL COMMENT 'guest.IDNo',
				TIP_TYPE TINYINT NOT NULL COMMENT '1=Roller, 2=Dealer',
				PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected or game program date (date only)',
				CASHOUT_ID INT NULL DEFAULT NULL COMMENT 'game_record.IDNo',
				REMARKS VARCHAR(500) NULL DEFAULT NULL,
				ROLLER_NAME VARCHAR(255) NULL DEFAULT NULL,
				TIP_STATUS VARCHAR(50) NULL DEFAULT NULL,
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NOT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				KEY idx_tip_encoded_dt (ACTIVE, ENCODED_DT),
				KEY idx_tip_program_date (ACTIVE, PROGRAM_DATE),
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
			 ADD COLUMN CASHOUT_ID INT NULL DEFAULT NULL COMMENT 'game_record.IDNo' AFTER TIP_TYPE,
			 ADD KEY idx_tip_cashout_id (CASHOUT_ID)`
		);
		console.log('[tip] Added column CASHOUT_ID');
	}

	if (!(await columnExists(pool, 'tip', 'ROLLER_NAME'))) {
		await pool.execute(
			`ALTER TABLE tip
			 ADD COLUMN ROLLER_NAME VARCHAR(255) NULL DEFAULT NULL AFTER REMARKS`
		);
		await pool.execute(
			`UPDATE tip
			 SET ROLLER_NAME = TRIM(REMARKS)
			 WHERE ROLLER_NAME IS NULL
			   AND REMARKS IS NOT NULL
			   AND TRIM(REMARKS) != ''`
		);
		console.log('[tip] Added column ROLLER_NAME');
	}

	if (!(await columnExists(pool, 'tip', 'TIP_STATUS'))) {
		await pool.execute(
			`ALTER TABLE tip
			 ADD COLUMN TIP_STATUS VARCHAR(50) NULL DEFAULT NULL AFTER ROLLER_NAME`
		);
		console.log('[tip] Added column TIP_STATUS');
	}

	if (!(await columnExists(pool, 'tip', 'GUEST_ID'))) {
		await pool.execute(
			`ALTER TABLE tip
			 ADD COLUMN GUEST_ID INT NULL DEFAULT NULL COMMENT 'guest.IDNo' AFTER ACCOUNT_ID,
			 ADD KEY idx_tip_guest_id (GUEST_ID)`
		);
		console.log('[tip] Added column GUEST_ID');
	}

	if (!(await columnExists(pool, 'tip', 'PROGRAM_DATE'))) {
		const afterCol = (await columnExists(pool, 'tip', 'TIP_DATETIME')) ? 'TIP_DATETIME' : 'TIP_TYPE';
		await pool.execute(
			`ALTER TABLE tip
			 ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected or game program date (date only)' AFTER ${afterCol},
			 ADD KEY idx_tip_program_date (ACTIVE, PROGRAM_DATE)`
		);
		console.log('[tip] Added column PROGRAM_DATE');
	}

	if (await columnExists(pool, 'tip', 'TIP_DATETIME')) {
		await pool.execute(
			`UPDATE tip
			 SET ENCODED_DT = COALESCE(ENCODED_DT, TIP_DATETIME)
			 WHERE ENCODED_DT IS NULL
			   AND TIP_DATETIME IS NOT NULL`
		);
	}

	await pool.execute(
		`UPDATE tip t
		 LEFT JOIN game_list gl ON gl.IDNo = t.GAME_ID
		 SET t.PROGRAM_DATE = COALESCE(
			 DATE(t.PROGRAM_DATE),
			 DATE(gl.PROGRAM_DATE),
			 DATE(t.ENCODED_DT)
		 )
		 WHERE t.PROGRAM_DATE IS NULL
		   AND (gl.PROGRAM_DATE IS NOT NULL OR t.ENCODED_DT IS NOT NULL)`
	);

	if (await columnExists(pool, 'tip', 'TIP_DATETIME')) {
		if (await indexExists(pool, 'tip', 'idx_tip_active_dt')) {
			await pool.execute('ALTER TABLE tip DROP INDEX idx_tip_active_dt');
		}
		await pool.execute('ALTER TABLE tip DROP COLUMN TIP_DATETIME');
		console.log('[tip] Dropped column TIP_DATETIME');
	}

	if (!(await indexExists(pool, 'tip', 'idx_tip_encoded_dt'))) {
		await pool.execute(
			'ALTER TABLE tip ADD KEY idx_tip_encoded_dt (ACTIVE, ENCODED_DT)'
		);
		console.log('[tip] Added index idx_tip_encoded_dt');
	}

	if (!(await tableExists(pool, 'tip_settlement'))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS tip_settlement (
				IDNo INT NOT NULL AUTO_INCREMENT,
				AMOUNT DECIMAL(18, 2) NOT NULL,
				SETTLEMENT_DATETIME DATETIME NOT NULL,
				PROGRAM_DATE DATE NULL DEFAULT NULL,
				REMARKS VARCHAR(500) NULL DEFAULT NULL,
				ROLLER_NAME VARCHAR(255) NULL DEFAULT NULL,
				TIP_STATUS VARCHAR(50) NULL DEFAULT NULL,
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NULL DEFAULT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				KEY idx_tip_settlement_active_dt (ACTIVE, SETTLEMENT_DATETIME),
				KEY idx_tip_settlement_program_date (ACTIVE, PROGRAM_DATE)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[tip] Created table tip_settlement');
	}

	if (await tableExists(pool, 'tip_settlement')) {
		if (!(await columnExists(pool, 'tip_settlement', 'ROLLER_NAME'))) {
			await pool.execute(
				`ALTER TABLE tip_settlement
				 ADD COLUMN ROLLER_NAME VARCHAR(255) NULL DEFAULT NULL AFTER REMARKS`
			);
			console.log('[tip] Added column tip_settlement.ROLLER_NAME');
		}
		if (!(await columnExists(pool, 'tip_settlement', 'TIP_STATUS'))) {
			await pool.execute(
				`ALTER TABLE tip_settlement
				 ADD COLUMN TIP_STATUS VARCHAR(50) NULL DEFAULT NULL AFTER ROLLER_NAME`
			);
			console.log('[tip] Added column tip_settlement.TIP_STATUS');
		}
		if (!(await columnExists(pool, 'tip_settlement', 'PROGRAM_DATE'))) {
			await pool.execute(
				`ALTER TABLE tip_settlement
				 ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL COMMENT 'User-selected program date (date only)' AFTER SETTLEMENT_DATETIME,
				 ADD KEY idx_tip_settlement_program_date (ACTIVE, PROGRAM_DATE)`
			);
			console.log('[tip] Added column tip_settlement.PROGRAM_DATE');
		}
		await pool.execute(
			`UPDATE tip_settlement
			 SET PROGRAM_DATE = DATE(SETTLEMENT_DATETIME)
			 WHERE PROGRAM_DATE IS NULL
			   AND SETTLEMENT_DATETIME IS NOT NULL`
		);
	}

	return false;
}

module.exports = { ensureTipSchema };
