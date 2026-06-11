/**
 * Idempotent DB setup for net_profit_share_percentages.PROGRAM_DATE (per-day share % key).
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

async function ensureNetProfitShareProgramDateSchema(pool) {
	const tableName = 'net_profit_share_percentages';

	if (!(await tableExists(pool, tableName))) {
		await pool.execute(
			`CREATE TABLE IF NOT EXISTS \`${tableName}\` (
			  \`IDNo\` INT NOT NULL AUTO_INCREMENT,
			  \`PROGRAM_DATE\` DATE NOT NULL,
			  \`SHARE_PERCENTAGE\` DECIMAL(7,4) NOT NULL DEFAULT 65.0000,
			  \`ACTIVE\` TINYINT NOT NULL DEFAULT 1,
			  \`ENCODED_BY\` INT NULL DEFAULT NULL,
			  \`ENCODED_DT\` DATETIME NULL DEFAULT NULL,
			  \`EDITED_BY\` INT NULL DEFAULT NULL,
			  \`EDITED_DT\` DATETIME NULL DEFAULT NULL,
			  PRIMARY KEY (\`IDNo\`),
			  UNIQUE KEY \`uk_net_profit_share_program_date\` (\`PROGRAM_DATE\`)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
		);
		console.log('[net_profit_share_percentages] Created table with PROGRAM_DATE');
		return true;
	}

	if (
		(await columnExists(pool, tableName, 'SETTLEMENT_DATE')) &&
		!(await columnExists(pool, tableName, 'PROGRAM_DATE'))
	) {
		await pool.execute(
			`ALTER TABLE \`${tableName}\`
			 CHANGE COLUMN \`SETTLEMENT_DATE\` \`PROGRAM_DATE\` DATE NOT NULL`
		);
		console.log('[net_profit_share_percentages] Renamed SETTLEMENT_DATE → PROGRAM_DATE');
	}

	try {
		await pool.execute(
			`ALTER TABLE \`${tableName}\`
			 DROP INDEX \`uk_net_profit_share_settlement_date\``
		);
	} catch (_err) {
		// index may not exist
	}

	if (await columnExists(pool, tableName, 'PROGRAM_DATE')) {
		try {
			await pool.execute(
				`ALTER TABLE \`${tableName}\`
				 ADD UNIQUE KEY \`uk_net_profit_share_program_date\` (\`PROGRAM_DATE\`)`
			);
		} catch (_err) {
			// unique key may already exist
		}
	}

	return true;
}

module.exports = { ensureNetProfitShareProgramDateSchema };
