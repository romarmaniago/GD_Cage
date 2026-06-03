/**
 * Vehicle master for Car expenses + VEHICLE_ID on junket_house_expense.
 */

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

async function ensureHouseExpenseVehicleSchema(pool) {
    const exists = await tableExists(pool, 'house_expense_vehicle');
    if (!exists) {
        await pool.execute(`
            CREATE TABLE house_expense_vehicle (
                IDNo INT NOT NULL AUTO_INCREMENT,
                PLATE_NO VARCHAR(64) NOT NULL,
                MODEL VARCHAR(128) NULL DEFAULT NULL,
                REMARKS VARCHAR(255) NULL DEFAULT NULL,
                ACTIVE TINYINT NOT NULL DEFAULT 1,
                ENCODED_BY INT NULL DEFAULT NULL,
                ENCODED_DT DATETIME NULL DEFAULT NULL,
                EDITED_BY INT NULL DEFAULT NULL,
                EDITED_DT DATETIME NULL DEFAULT NULL,
                PRIMARY KEY (IDNo),
                KEY idx_house_expense_vehicle_active (ACTIVE),
                KEY idx_house_expense_vehicle_plate (PLATE_NO)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('[house_expense_vehicle] Created table house_expense_vehicle');
    }

    if (!(await columnExists(pool, 'junket_house_expense', 'VEHICLE_ID'))) {
        await pool.execute(
            'ALTER TABLE junket_house_expense ADD COLUMN VEHICLE_ID INT NULL DEFAULT NULL AFTER KM_L'
        );
        console.log('[junket_house_expense] Added column VEHICLE_ID');
    }
}

module.exports = {
    ensureHouseExpenseVehicleSchema
};
