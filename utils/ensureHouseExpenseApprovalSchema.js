/**
 * RECEIVER + APPROVAL_STATUS on junket_house_expense (pending / approved / rejected).
 * Existing rows default to approved (1).
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

async function ensureHouseExpenseApprovalSchema(pool) {
    if (!(await columnExists(pool, 'junket_house_expense', 'RECEIVER'))) {
        await pool.execute(
            'ALTER TABLE junket_house_expense ADD COLUMN RECEIVER VARCHAR(255) NULL DEFAULT NULL AFTER DESCRIPTION'
        );
        console.log('[junket_house_expense] Added column RECEIVER');
    }

    if (!(await columnExists(pool, 'junket_house_expense', 'APPROVAL_STATUS'))) {
        await pool.execute(
            'ALTER TABLE junket_house_expense ADD COLUMN APPROVAL_STATUS TINYINT NOT NULL DEFAULT 1 COMMENT "0=pending,1=approved,2=rejected" AFTER RECEIVER'
        );
        console.log('[junket_house_expense] Added column APPROVAL_STATUS');
    }

    await pool.execute(
        'UPDATE junket_house_expense SET APPROVAL_STATUS = 1 WHERE APPROVAL_STATUS IS NULL'
    );

    if (!(await columnExists(pool, 'junket_house_expense', 'KM_L'))) {
        await pool.execute(
            'ALTER TABLE junket_house_expense ADD COLUMN KM_L DECIMAL(10, 2) NULL DEFAULT NULL AFTER AMOUNT'
        );
        console.log('[junket_house_expense] Added column KM_L');
    }

    if (!(await columnExists(pool, 'junket_house_expense', 'CREATED_DT'))) {
        await pool.execute(
            'ALTER TABLE junket_house_expense ADD COLUMN CREATED_DT DATETIME NULL DEFAULT NULL AFTER ENCODED_DT'
        );
        console.log('[junket_house_expense] Added column CREATED_DT');
    }

    await pool.execute(
        'UPDATE junket_house_expense SET CREATED_DT = ENCODED_DT WHERE CREATED_DT IS NULL AND ENCODED_DT IS NOT NULL'
    );
}

module.exports = {
    ensureHouseExpenseApprovalSchema
};
