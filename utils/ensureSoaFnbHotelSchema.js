async function ensureSoaFnbHotelSchema(pool) {
	// Stores SOA (F&B, Hotel) settlements independent from game_services.
	await pool.execute(`
		CREATE TABLE IF NOT EXISTS soa_fnb_hotel (
			IDNo INT NOT NULL AUTO_INCREMENT,
			SOA_DATE DATE NOT NULL,
			CATEGORY VARCHAR(100) NOT NULL,
			AMOUNT DECIMAL(15,2) NOT NULL DEFAULT 0,
			REMARKS VARCHAR(500) NULL,
			JOIN_PREV TINYINT(1) NOT NULL DEFAULT 0,
			SORT_KEY DOUBLE NULL,
			ACTIVE TINYINT(1) NOT NULL DEFAULT 1,
			ENCODED_BY INT NULL,
			ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UPDATED_BY INT NULL,
			UPDATED_DT DATETIME NULL,
			PRIMARY KEY (IDNo),
			KEY idx_soa_fnb_hotel_date (SOA_DATE),
			KEY idx_soa_fnb_hotel_category (CATEGORY),
			KEY idx_soa_fnb_hotel_active (ACTIVE)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);

	const [[col]] = await pool.execute(
		`SELECT CHARACTER_MAXIMUM_LENGTH AS max_len
		 FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = 'soa_fnb_hotel'
		   AND COLUMN_NAME = 'CATEGORY'
		 LIMIT 1`
	);
	if (col && Number(col.max_len) < 100) {
		await pool.execute('ALTER TABLE soa_fnb_hotel MODIFY COLUMN CATEGORY VARCHAR(100) NOT NULL');
	}

	const [[remarksCol]] = await pool.execute(
		`SELECT CHARACTER_MAXIMUM_LENGTH AS max_len
		 FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = 'soa_fnb_hotel'
		   AND COLUMN_NAME = 'REMARKS'
		 LIMIT 1`
	);
	if (remarksCol && Number(remarksCol.max_len) < 500) {
		await pool.execute('ALTER TABLE soa_fnb_hotel MODIFY COLUMN REMARKS VARCHAR(500) NULL');
	}

	// JOIN_PREV = 1: the row is joined to the one above (no line between them on the sheet).
	const [[joinCol]] = await pool.execute(
		`SELECT COUNT(*) AS cnt
		 FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = 'soa_fnb_hotel'
		   AND COLUMN_NAME = 'JOIN_PREV'`
	);
	if (!Number(joinCol?.cnt)) {
		await pool.execute('ALTER TABLE soa_fnb_hotel ADD COLUMN JOIN_PREV TINYINT(1) NOT NULL DEFAULT 0 AFTER REMARKS');
	}

	// SORT_KEY: sheet order; NULL = in the order added (IDNo). Lines added with "+"
	// get a key between the rows around them.
	const [[sortCol]] = await pool.execute(
		`SELECT COUNT(*) AS cnt
		 FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE()
		   AND TABLE_NAME = 'soa_fnb_hotel'
		   AND COLUMN_NAME = 'SORT_KEY'`
	);
	if (!Number(sortCol?.cnt)) {
		await pool.execute('ALTER TABLE soa_fnb_hotel ADD COLUMN SORT_KEY DOUBLE NULL AFTER JOIN_PREV');
	}

	return true;
}

module.exports = { ensureSoaFnbHotelSchema };
