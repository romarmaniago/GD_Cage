/**
 * Idempotent DB setup for junket_loss (Loss Amount) extended columns.
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

async function ensureJunketLossSchema(pool) {
	const exists = await tableExists(pool, 'junket_loss');
	if (!exists) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS junket_loss (
				IDNo INT NOT NULL AUTO_INCREMENT,
				DESCRIPTION TEXT NULL,
				AMOUNT DECIMAL(18, 2) NOT NULL DEFAULT 0,
				IN_CHARGE VARCHAR(150) NULL DEFAULT NULL,
				PROGRAM_DATE DATE NULL DEFAULT NULL,
				ACCOUNT_ID INT NULL DEFAULT NULL COMMENT 'account.IDNo',
				GUEST_ID INT NULL DEFAULT NULL COMMENT 'guest.IDNo',
				PAYMENT_TYPE TINYINT NULL DEFAULT NULL COMMENT '1=Chip, 2=Cash',
				GAME_ID INT NULL DEFAULT NULL COMMENT 'game_list.IDNo',
				NON_CASH TINYINT NOT NULL DEFAULT 0 COMMENT '1 = offset by a LOSS buy-in, not taken from cash balance',
				TRANSACTION TINYINT NOT NULL DEFAULT 1 COMMENT '1=Loss (AMOUNT > 0), 2=Recovery (AMOUNT < 0)',
				ENCODED_BY INT NULL DEFAULT NULL,
				ENCODED_DT DATETIME NULL DEFAULT NULL,
				EDITED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				KEY idx_junket_loss_active_dt (ACTIVE, ENCODED_DT),
				KEY idx_junket_loss_program_date (ACTIVE, PROGRAM_DATE),
				KEY idx_junket_loss_account_id (ACCOUNT_ID),
				KEY idx_junket_loss_guest_id (GUEST_ID),
				KEY idx_junket_loss_game_id (GAME_ID)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[junket_loss] Created table junket_loss');
		return true;
	}

	const columns = [
		{
			name: 'PROGRAM_DATE',
			ddl: `ADD COLUMN PROGRAM_DATE DATE NULL DEFAULT NULL AFTER IN_CHARGE`
		},
		{
			name: 'ACCOUNT_ID',
			ddl: `ADD COLUMN ACCOUNT_ID INT NULL DEFAULT NULL COMMENT 'account.IDNo' AFTER PROGRAM_DATE`
		},
		{
			name: 'GUEST_ID',
			ddl: `ADD COLUMN GUEST_ID INT NULL DEFAULT NULL COMMENT 'guest.IDNo' AFTER ACCOUNT_ID`
		},
		{
			name: 'PAYMENT_TYPE',
			ddl: `ADD COLUMN PAYMENT_TYPE TINYINT NULL DEFAULT NULL COMMENT '1=Chip, 2=Cash' AFTER GUEST_ID`
		},
		{
			name: 'NON_CASH',
			ddl: `ADD COLUMN NON_CASH TINYINT NOT NULL DEFAULT 0 COMMENT '1 = offset by a LOSS buy-in, not taken from cash balance'`
		},
		{
			name: 'TRANSACTION',
			ddl: `ADD COLUMN TRANSACTION TINYINT NOT NULL DEFAULT 1 COMMENT '1=Loss (AMOUNT > 0), 2=Recovery (AMOUNT < 0)'`
		}
	];

	for (const col of columns) {
		if (!(await columnExists(pool, 'junket_loss', col.name))) {
			await pool.execute(`ALTER TABLE junket_loss ${col.ddl}`);
			console.log(`[junket_loss] Added column ${col.name}`);
		}
	}

	// Recoveries are stored as negative amounts; label any that predate the TRANSACTION column.
	await pool.execute(`UPDATE junket_loss SET TRANSACTION = 2 WHERE AMOUNT < 0 AND TRANSACTION <> 2`);

	return true;
}

module.exports = { ensureJunketLossSchema };
