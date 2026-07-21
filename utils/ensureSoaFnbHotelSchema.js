async function ensureSoaFnbHotelSchema(pool) {
	// Stores SOA (F&B, Hotel) settlements independent from game_services.
	await pool.execute(`
		CREATE TABLE IF NOT EXISTS soa_fnb_hotel (
			IDNo INT NOT NULL AUTO_INCREMENT,
			SOA_DATE DATE NOT NULL,
			CATEGORY VARCHAR(100) NOT NULL,
			AMOUNT DECIMAL(15,2) NOT NULL DEFAULT 0,
			REMARKS VARCHAR(500) NULL,
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

	return true;
}

module.exports = { ensureSoaFnbHotelSchema };
