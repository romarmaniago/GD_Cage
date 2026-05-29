/**
 * Idempotent DB setup for expense main/sub categories (PARENT_ID + default Car subs).
 * Runs on server startup so live deploys apply schema + seed automatically.
 */

const CAR_SUBS = ['Fuel', 'PMS', 'Tires', 'Battery'];

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

async function ensureParentIdColumn(pool) {
    const exists = await columnExists(pool, 'expense_category', 'PARENT_ID');
    if (exists) return false;

    await pool.execute('ALTER TABLE expense_category ADD COLUMN PARENT_ID INT NULL DEFAULT NULL');
    console.log('[expense_category] Added column PARENT_ID');
    return true;
}

async function ensureCarSubCategories(pool) {
    const [carRows] = await pool.execute(
        "SELECT IDNo, CATEGORY, TYPE FROM expense_category WHERE ACTIVE = 1 AND UPPER(TRIM(CATEGORY)) = 'CAR' LIMIT 1"
    );
    if (!carRows.length) {
        console.log('[expense_category] No active "Car" main category — skip sub-category seed');
        return;
    }

    const carId = carRows[0].IDNo;
    const carType = carRows[0].TYPE != null ? carRows[0].TYPE : 2;

    await pool.execute('UPDATE expense_category SET PARENT_ID = NULL WHERE IDNo = ?', [carId]);

    const subIds = {};
    for (const name of CAR_SUBS) {
        const [existing] = await pool.execute(
            'SELECT IDNo FROM expense_category WHERE UPPER(TRIM(CATEGORY)) = UPPER(TRIM(?)) LIMIT 1',
            [name]
        );
        if (existing.length) {
            const id = existing[0].IDNo;
            subIds[name] = id;
            await pool.execute(
                'UPDATE expense_category SET PARENT_ID = ?, TYPE = ?, ACTIVE = 1 WHERE IDNo = ?',
                [carId, carType, id]
            );
        } else {
            const [ins] = await pool.execute(
                'INSERT INTO expense_category (CATEGORY, TYPE, PARENT_ID, ENCODED_BY, ENCODED_DT, ACTIVE) VALUES (?, ?, ?, 1, NOW(), 1)',
                [name, carType, carId]
            );
            subIds[name] = ins.insertId;
            console.log(`[expense_category] Created sub "${name}" (ID ${ins.insertId}) under Car (${carId})`);
        }
    }

    const fuelId = subIds.Fuel;
    if (fuelId) {
        const [migrateResult] = await pool.execute(
            'UPDATE junket_house_expense SET CATEGORY_ID = ? WHERE ACTIVE = 1 AND CATEGORY_ID = ?',
            [fuelId, carId]
        );
        if (migrateResult.affectedRows > 0) {
            console.log(
                `[expense_category] Migrated ${migrateResult.affectedRows} expense(s) from Car → Fuel`
            );
        }
    }
}

/**
 * @param {import('mysql2/promise').Pool} pool
 */
async function ensureExpenseCategorySchema(pool) {
    try {
        await ensureParentIdColumn(pool);
        await ensureCarSubCategories(pool);
    } catch (err) {
        console.error('[expense_category] Schema/seed check failed:', err.message);
        throw err;
    }
}

module.exports = {
    ensureExpenseCategorySchema,
    ensureParentIdColumn,
    ensureCarSubCategories,
    CAR_SUBS
};
