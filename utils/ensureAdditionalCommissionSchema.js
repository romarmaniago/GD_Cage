/**
 * Idempotent DB setup for additional_commission table.
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

async function addColumnIfMissing(pool, tableName, columnName, ddl) {
	if (await columnExists(pool, tableName, columnName)) return false;

	await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
	console.log(`[${tableName}] Added column ${columnName}`);
	return true;
}

async function dropColumnIfExists(pool, tableName, columnName) {
	if (!(await columnExists(pool, tableName, columnName))) return false;

	await pool.execute(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
	console.log(`[${tableName}] Dropped column ${columnName}`);
	return true;
}

async function migrateLegacyAmountColumns(pool, tableName) {
	const hasDeposit = await columnExists(pool, tableName, 'DEPOSIT');
	const hasCashOut = await columnExists(pool, tableName, 'CASH_OUT');
	if (!hasDeposit && !hasCashOut) return;

	const depositExpr = hasDeposit ? 'COALESCE(DEPOSIT, 0)' : '0';
	const cashOutExpr = hasCashOut ? 'COALESCE(CASH_OUT, 0)' : '0';
	const typeCase = hasDeposit
		? `CASE WHEN ${depositExpr} > 0 THEN 1 ELSE 2 END`
		: '2';
	const amountCase = hasDeposit && hasCashOut
		? `CASE WHEN ${depositExpr} > 0 THEN ${depositExpr} ELSE ${cashOutExpr} END`
		: hasDeposit
			? depositExpr
			: cashOutExpr;
	const legacyFilter = hasDeposit && hasCashOut
		? `(${depositExpr} > 0 OR ${cashOutExpr} > 0)`
		: hasDeposit
			? `(${depositExpr} > 0)`
			: `(${cashOutExpr} > 0)`;

	await pool.execute(`
		UPDATE ${tableName}
		SET TYPE = ${typeCase},
		    AMOUNT = ${amountCase}
		WHERE ACTIVE = 1
		  AND (COALESCE(AMOUNT, 0) = 0 OR TYPE IS NULL)
		  AND ${legacyFilter}
	`);
}

async function linkLegacyDepositLedgers(pool, tableName) {
	if (!(await columnExists(pool, tableName, 'ACCOUNT_LEDGER_ID'))) return;

	await pool.execute(`
		UPDATE ${tableName} ac
		JOIN account a ON a.AGENT_ID = ac.AGENT_ID AND a.ACTIVE = 1
		JOIN account_ledger al ON al.ACCOUNT_ID = a.IDNo
			AND al.ACTIVE = 1
			AND al.TRANSACTION_ID = 1
			AND al.TRANSACTION_TYPE = 2
			AND al.TRANSACTION_DESC = 'ADDITIONAL COMMISSION'
			AND al.AMOUNT = ac.AMOUNT
			AND ABS(TIMESTAMPDIFF(SECOND, al.ENCODED_DT, ac.ENCODED_DT)) <= 10
		SET ac.ACCOUNT_LEDGER_ID = al.IDNo
		WHERE ac.ACTIVE = 1
		  AND ac.TYPE = 1
		  AND ac.ACCOUNT_LEDGER_ID IS NULL
		  AND ac.AMOUNT > 0
	`);
}

async function ensureAdditionalCommissionSchema(pool) {
	const tableName = 'additional_commission';

	if (!(await tableExists(pool, tableName))) {
		await pool.execute(`
			CREATE TABLE IF NOT EXISTS additional_commission (
				IDNo INT NOT NULL AUTO_INCREMENT,
				AGENT_ID INT NULL DEFAULT NULL,
				AGENT_NAME VARCHAR(255) NULL DEFAULT NULL,
				TYPE TINYINT NOT NULL DEFAULT 2 COMMENT '1=Deposit, 2=Cashout',
				AMOUNT DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
				ACCOUNT_LEDGER_ID INT NULL DEFAULT NULL,
				REMARKS VARCHAR(500) NULL DEFAULT NULL,
				ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				ENCODED_BY INT NULL DEFAULT NULL,
				EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
				EDITED_BY INT NULL DEFAULT NULL,
				ACTIVE TINYINT NOT NULL DEFAULT 1,
				PRIMARY KEY (IDNo),
				KEY idx_additional_commission_agent_id (AGENT_ID),
				KEY idx_additional_commission_active_dt (ACTIVE, ENCODED_DT),
				KEY idx_additional_commission_type (TYPE),
				KEY idx_additional_commission_ledger_id (ACCOUNT_LEDGER_ID)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
		`);
		console.log('[additional_commission] Created table additional_commission');
		return true;
	}

	await addColumnIfMissing(pool, tableName, 'AGENT_ID', 'AGENT_ID INT NULL DEFAULT NULL AFTER IDNo');
	await addColumnIfMissing(pool, tableName, 'AGENT_NAME', 'AGENT_NAME VARCHAR(255) NULL DEFAULT NULL AFTER AGENT_ID');
	await addColumnIfMissing(pool, tableName, 'TYPE', 'TYPE TINYINT NOT NULL DEFAULT 2 COMMENT \'1=Deposit, 2=Cashout\' AFTER AGENT_NAME');
	await addColumnIfMissing(pool, tableName, 'AMOUNT', 'AMOUNT DECIMAL(18, 2) NOT NULL DEFAULT 0.00 AFTER TYPE');
	await addColumnIfMissing(pool, tableName, 'ACCOUNT_LEDGER_ID', 'ACCOUNT_LEDGER_ID INT NULL DEFAULT NULL AFTER AMOUNT');
	await addColumnIfMissing(pool, tableName, 'REMARKS', 'REMARKS VARCHAR(500) NULL DEFAULT NULL AFTER ACCOUNT_LEDGER_ID');
	await addColumnIfMissing(pool, tableName, 'ENCODED_DT', 'ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER REMARKS');
	await addColumnIfMissing(pool, tableName, 'ENCODED_BY', 'ENCODED_BY INT NULL DEFAULT NULL AFTER ENCODED_DT');
	await addColumnIfMissing(pool, tableName, 'EDITED_DT', 'EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER ENCODED_BY');
	await addColumnIfMissing(pool, tableName, 'EDITED_BY', 'EDITED_BY INT NULL DEFAULT NULL AFTER EDITED_DT');
	await addColumnIfMissing(pool, tableName, 'ACTIVE', 'ACTIVE TINYINT NOT NULL DEFAULT 1 AFTER EDITED_BY');

	await migrateLegacyAmountColumns(pool, tableName);
	await linkLegacyDepositLedgers(pool, tableName);
	await dropColumnIfExists(pool, tableName, 'DEPOSIT');
	await dropColumnIfExists(pool, tableName, 'CASH_OUT');

	return false;
}

module.exports = {
	ensureAdditionalCommissionSchema
};
