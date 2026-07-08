async function ensureSoaFnbHotelSchema(pool) {
	// Stores SOA (F&B, Hotel) settlements independent from game_services.
	await pool.execute(`
		CREATE TABLE IF NOT EXISTS soa_fnb_hotel (
			IDNo INT NOT NULL AUTO_INCREMENT,
			SOA_DATE DATE NOT NULL,
			CATEGORY VARCHAR(32) NOT NULL,
			AMOUNT DECIMAL(15,2) NOT NULL DEFAULT 0,
			REMARKS VARCHAR(255) NULL,
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
	return true;
}

module.exports = { ensureSoaFnbHotelSchema };

