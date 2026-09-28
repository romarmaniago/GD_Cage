/**
 * Void (undo) a settlement batch — View settlement → Void (routes/settlement.js).
 *
 * In one transaction: the batch becomes ACTIVE = 0 (kept for audit with VOIDED_BY / VOIDED_DT / VOID_REASON),
 * its junket_capital row is archived (Company goes back), and its records are released — unlocked and
 * counted again on the dashboard. Settling never touched cash_transaction or account ledgers, so neither
 * does voiding. Batches never share records, so any batch can be voided in any order.
 */

/** type → batch table + how to release its records. `release` returns the number of records released. */
const SETTLEMENT_TYPES = {
	expense: {
		table: 'junket_expense_settlement',
		label: 'Expenses',
		async release(db, id) {
			// Settling only takes RESET = 1 rows, so voiding restores RESET = 1.
			const [e] = await db.execute(
				'UPDATE junket_house_expense SET RESET = 1, EXPENSE_SETTLEMENT_ID = NULL WHERE EXPENSE_SETTLEMENT_ID = ?',
				[id]
			);
			const [r] = await db.execute(
				'UPDATE junket_return_money SET RESET = 1, EXPENSE_SETTLEMENT_ID = NULL WHERE EXPENSE_SETTLEMENT_ID = ?',
				[id]
			);
			return e.affectedRows + r.affectedRows;
		}
	},
	loss: {
		table: 'junket_loss_settlement',
		label: 'Loss Amount',
		async release(db, id) {
			const [r] = await db.execute('UPDATE junket_loss SET LOSS_SETTLEMENT_ID = NULL WHERE LOSS_SETTLEMENT_ID = ?', [id]);
			return r.affectedRows;
		}
	},
	additional: {
		table: 'additional_commission_settlement',
		label: 'Additional',
		async release(db, id) {
			const [r] = await db.execute(
				'UPDATE additional_commission SET ADDITIONAL_SETTLEMENT_ID = NULL WHERE ADDITIONAL_SETTLEMENT_ID = ?',
				[id]
			);
			return r.affectedRows;
		}
	},
	service: {
		table: 'service_settlement',
		label: 'Add Charge',
		async release(db, id) {
			const [r] = await db.execute('UPDATE game_services SET SERVICE_SETTLEMENT_ID = NULL WHERE SERVICE_SETTLEMENT_ID = ?', [id]);
			return r.affectedRows;
		}
	},
	commission: {
		table: 'commission_settlement',
		label: 'Commission',
		async release(db, id) {
			// Games reopen in Gamebook; their "Settle" Add Charge rows count on the dashboard again.
			const [g] = await db.execute('UPDATE game_list SET COMMISSION_SETTLEMENT_ID = NULL WHERE COMMISSION_SETTLEMENT_ID = ?', [id]);
			await db.execute('UPDATE game_services SET COMMISSION_SETTLEMENT_ID = NULL WHERE COMMISSION_SETTLEMENT_ID = ?', [id]);
			return g.affectedRows;
		}
	}
};

const SETTLEMENT_TABLES = Object.values(SETTLEMENT_TYPES).map((t) => t.table);

function voidError(status, message) {
	const err = new Error(message);
	err.status = status;
	return err;
}

/**
 * @returns {Promise<{ released: number, capitalId: number|null }>}
 * @throws Error with .status (400 / 404 / 409) for user-facing failures
 */
async function voidSettlement(pool, type, settlementId, { userId, reason }) {
	const cfg = SETTLEMENT_TYPES[type];
	if (!cfg) throw voidError(400, 'Unknown settlement type.');
	const id = parseInt(settlementId, 10);
	if (!id) throw voidError(400, 'Invalid settlement.');
	const why = String(reason || '').trim();
	if (!why) throw voidError(400, 'Please enter the reason for voiding this settlement.');

	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();

		const [rows] = await connection.execute(
			`SELECT IDNo, ACTIVE, CAPITAL_ID FROM ${cfg.table} WHERE IDNo = ? LIMIT 1 FOR UPDATE`,
			[id]
		);
		if (!rows.length) throw voidError(404, 'Settlement not found.');
		if (Number(rows[0].ACTIVE) !== 1) throw voidError(409, 'This settlement is already voided.');

		const dateNow = new Date();
		const released = await cfg.release(connection, id);

		await connection.execute(
			`UPDATE ${cfg.table}
			 SET ACTIVE = 0, VOIDED_BY = ?, VOIDED_DT = ?, VOID_REASON = ?
			 WHERE IDNo = ?`,
			[userId, dateNow, why.slice(0, 500), id]
		);

		const capitalId = rows[0].CAPITAL_ID || null;
		if (capitalId) {
			await connection.execute(
				'UPDATE junket_capital SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1',
				[userId, dateNow, capitalId]
			);
		}

		await connection.commit();
		return { released, capitalId };
	} catch (err) {
		try { await connection.rollback(); } catch (rollbackErr) { /* ignore */ }
		throw err;
	} finally {
		connection.release();
	}
}

module.exports = { SETTLEMENT_TYPES, SETTLEMENT_TABLES, voidSettlement };
