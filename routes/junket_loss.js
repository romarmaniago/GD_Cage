const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { buildTableExportXlsx, sendTableExportResponse } = require('../utils/ExcelExportService');
const {
	toApiDate,
	getMonthEndCutoffRange,
	expandApiEndDateToMonthEnd,
} = require('../utils/monthEndCutoffRange');

function junketLossApiEndDate(endYmd) {
	if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
	const parts = String(endYmd).slice(0, 10).split('-').map(Number);
	const lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
	if (parts[2] === lastDayOfMonth - 1) {
		return expandApiEndDateToMonthEnd(endYmd);
	}
	return endYmd;
}

function normalizeJunketLossDateRange(fromDate, toDate) {
	let from = toApiDate(fromDate);
	let to = junketLossApiEndDate(toApiDate(toDate));

	if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
		const fallback = getMonthEndCutoffRange();
		from = fallback.startDate;
		to = fallback.endDateApi || junketLossApiEndDate(fallback.endDate);
	}

	if (from > to) {
		const swap = from;
		from = to;
		to = swap;
	}

	return { fromDate: from, toDate: to };
}

function parseOptionalId(value) {
	if (value === undefined || value === null || String(value).trim() === '') return null;
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePaymentType(value) {
	const n = parseInt(value, 10);
	return n === 1 || n === 2 ? n : null;
}

const JUNKET_LOSS_TRANS_LOSS = 1;
const JUNKET_LOSS_TRANS_RECOVERY = 2;

/** Loss rows are stored positive, Recovery rows negative, so SUM(AMOUNT) is always the net loss. */
function signedJunketLossAmount(amount, transaction) {
	const abs = Math.abs(Number(amount) || 0);
	return transaction === JUNKET_LOSS_TRANS_RECOVERY ? -abs : abs;
}

function parseProgramDate(value) {
	const raw = String(value || '').trim().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
	return raw;
}

function buildEncodedDtFromProgramDate(programDate) {
	const now = new Date();
	const parts = String(programDate).split('-').map(Number);
	return new Date(
		parts[0],
		parts[1] - 1,
		parts[2],
		now.getHours(),
		now.getMinutes(),
		now.getSeconds()
	);
}

router.get('/junket_loss', checkSession, function (req, res) {
	return res.redirect(301, '/loss_amount');
});

router.get('/loss_amount', checkSession, function (req, res) {
	const data = sessions(req, 'loss_amount');
	data.permissions = req.session.permissions;
	res.render('junket/junket_loss', data);
});

router.get('/loss_amount_total', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute(
			'SELECT COALESCE(SUM(AMOUNT), 0) AS TOTAL FROM junket_loss WHERE ACTIVE = 1'
		);
		res.json({ total: Number(rows[0] && rows[0].TOTAL) || 0 });
	} catch (error) {
		console.error('Error fetching junket loss total:', error);
		res.status(500).json({ message: 'Failed to fetch junket loss total' });
	}
});

router.get('/loss_amount_data', async (req, res) => {
	try {
		const { fromDate, toDate } = normalizeJunketLossDateRange(req.query.fromDate, req.query.toDate);

		const query = `
			SELECT
				jl.IDNo,
				jl.DESCRIPTION,
				jl.AMOUNT,
				jl.IN_CHARGE,
				jl.PROGRAM_DATE,
				jl.ACCOUNT_ID,
				jl.GUEST_ID,
				jl.PAYMENT_TYPE,
				jl.TRANSACTION,
				jl.LOSS_SETTLEMENT_ID,
				jl.ENCODED_BY,
				jl.ENCODED_DT,
				CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME) AS ENCODED_BY_NAME,
				NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(TRIM(ag.AGENT_CODE), ''), NULLIF(TRIM(ag.NAME), ''))), '') AS ACCOUNT_NAME,
				NULLIF(TRIM(ag.AGENT_CODE), '') AS ACCOUNT_CODE,
				NULLIF(TRIM(ag.NAME), '') AS ACCOUNT_HOLDER,
				NULLIF(TRIM(g.NAME), '') AS GUEST_NAME
			FROM junket_loss jl
			LEFT JOIN user_info ui ON ui.IDNo = jl.ENCODED_BY
			LEFT JOIN account a ON a.IDNo = jl.ACCOUNT_ID
			LEFT JOIN agent ag ON ag.IDNo = a.AGENT_ID
			LEFT JOIN guest g ON g.IDNo = jl.GUEST_ID
			WHERE jl.ACTIVE = 1
				AND jl.PROGRAM_DATE BETWEEN ? AND ?
			ORDER BY jl.PROGRAM_DATE DESC, jl.IDNo DESC
		`;

		const [result] = await pool.execute(query, [fromDate, toDate]);
		res.json(result);
	} catch (error) {
		console.error('Error fetching junket loss data:', error);
		res.status(500).json({ message: 'Failed to fetch junket loss data' });
	}
});

router.post('/add_loss_amount', async (req, res) => {
	try {
		const {
			txtDescription,
			txtAmount,
			txtInCharge,
			txtProgramDate,
			txtAccountId,
			txtGuestId,
			txtPaymentType
		} = req.body;

		const programDate = parseProgramDate(txtProgramDate);
		const cleanAmount = String(txtAmount || '').replace(/,/g, '');
		const paymentType = parsePaymentType(txtPaymentType);
		const accountId = parseOptionalId(txtAccountId);
		const guestId = parseOptionalId(txtGuestId);

		if (
			!txtDescription ||
			!txtInCharge ||
			!programDate ||
			!paymentType ||
			cleanAmount === '' ||
			Number.isNaN(Number(cleanAmount))
		) {
			return res.status(400).json({ message: 'Invalid payload' });
		}

		const encodedDt = buildEncodedDtFromProgramDate(programDate);
		const transaction = Number(cleanAmount) < 0 ? JUNKET_LOSS_TRANS_RECOVERY : JUNKET_LOSS_TRANS_LOSS;

		const query = `
			INSERT INTO junket_loss (
				DESCRIPTION, AMOUNT, IN_CHARGE, PROGRAM_DATE, ACCOUNT_ID, GUEST_ID, PAYMENT_TYPE, TRANSACTION,
				ENCODED_BY, ENCODED_DT
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;

		await pool.execute(query, [
			txtDescription.trim(),
			signedJunketLossAmount(cleanAmount, transaction),
			txtInCharge.trim(),
			programDate,
			accountId,
			guestId,
			paymentType,
			transaction,
			req.session.user_id,
			encodedDt
		]);

		res.json({ message: 'Saved successfully' });
	} catch (error) {
		console.error('Error inserting junket loss:', error);
		res.status(500).json({ message: 'Failed to save junket loss' });
	}
});

router.put('/loss_amount/:id', checkSession, async (req, res) => {
	if (req.session?.permissions !== 0) {
		return res.status(403).json({ message: 'Only Super Admin can edit loss amount.' });
	}
	try {
		const id = parseInt(req.params.id, 10);
		const {
			txtDescription,
			txtAmount,
			txtInCharge,
			txtProgramDate,
			txtAccountId,
			txtGuestId,
			txtPaymentType
		} = req.body;

		const programDate = parseProgramDate(txtProgramDate);
		const date_now = new Date();
		const cleanAmount = String(txtAmount || '').replace(/,/g, '');
		const paymentType = parsePaymentType(txtPaymentType);
		const accountId = parseOptionalId(txtAccountId);
		const guestId = parseOptionalId(txtGuestId);

		if (
			!id ||
			!txtDescription ||
			!txtInCharge ||
			!programDate ||
			!paymentType ||
			cleanAmount === '' ||
			Number.isNaN(Number(cleanAmount))
		) {
			return res.status(400).json({ message: 'Invalid payload' });
		}

		if (await isJunketLossSettled(id)) {
			return res.status(409).json({ message: JUNKET_LOSS_SETTLED_LOCKED });
		}

		// Keep the row's Loss / Recovery type: the edit form only sends the amount, never its sign.
		const [existingRows] = await pool.execute(
			'SELECT TRANSACTION FROM junket_loss WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
			[id]
		);
		if (!existingRows.length) {
			return res.status(404).json({ message: 'Loss amount not found' });
		}
		const transaction = parseInt(existingRows[0].TRANSACTION, 10) || JUNKET_LOSS_TRANS_LOSS;

		const query = `
			UPDATE junket_loss
			SET DESCRIPTION = ?, AMOUNT = ?, IN_CHARGE = ?, PROGRAM_DATE = ?,
				ACCOUNT_ID = ?, GUEST_ID = ?, PAYMENT_TYPE = ?,
				EDITED_BY = ?, EDITED_DT = ?
			WHERE IDNo = ? AND ACTIVE = 1
		`;

		await pool.execute(query, [
			txtDescription.trim(),
			signedJunketLossAmount(cleanAmount, transaction),
			txtInCharge.trim(),
			programDate,
			accountId,
			guestId,
			paymentType,
			req.session.user_id,
			date_now,
			id
		]);

		res.json({ message: 'Updated successfully' });
	} catch (error) {
		console.error('Error updating junket loss:', error);
		res.status(500).json({ message: 'Failed to update junket loss' });
	}
});

router.put('/loss_amount/remove/:id', checkSession, async (req, res) => {
	if (req.session?.permissions !== 0) {
		return res.status(403).json({ message: 'Only Super Admin can delete loss amount.' });
	}
	try {
		const id = parseInt(req.params.id, 10);
		const date_now = new Date();

		if (!id) return res.status(400).json({ message: 'Invalid ID' });
		if (await isJunketLossSettled(id)) {
			return res.status(409).json({ message: JUNKET_LOSS_SETTLED_LOCKED });
		}

		const query = `UPDATE junket_loss SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query, [0, req.session.user_id, date_now, id]);

		res.json({ message: 'Archived successfully' });
	} catch (error) {
		console.error('Error archiving junket loss:', error);
		res.status(500).json({ message: 'Failed to archive junket loss' });
	}
});

const JUNKET_LOSS_SETTLED_LOCKED = 'This loss amount is already settled and can no longer be changed.';

/** True when the junket_loss row belongs to a Loss Amount settlement (locked). */
async function isJunketLossSettled(id) {
	const [rows] = await pool.execute('SELECT LOSS_SETTLEMENT_ID FROM junket_loss WHERE IDNo = ? LIMIT 1', [id]);
	return !!(rows.length && rows[0].LOSS_SETTLEMENT_ID != null);
}

/** Slip label per row: the account code (e.g. YC000); rows without an account group together. */
const SQL_LOSS_SETTLEMENT_GROUP = `COALESCE(NULLIF(TRIM(ag.AGENT_CODE), ''), 'No Account')`;

function formatSettlementYmd(ymd) {
	const p = String(ymd).split('-').map(Number);
	return `${p[1]}/${p[2]}/${p[0]}`;
}

function todayLocalYmd() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * SETTLE LOSS AMOUNT (Settlement (Loss Amount) modal → Save)
 * Settles every unsettled junket_loss row (Loss and Recovery) whose program date is within
 * fromDate..toDate: withdraws the net amount from junket_capital (TRANSACTION_ID = 2,
 * DESCRIPTION = 'Loss Amount') and tags the rows with LOSS_SETTLEMENT_ID.
 */
router.post('/loss_amount/settle', checkSession, async (req, res) => {
	const fromDate = parseProgramDate(req.body?.fromDate);
	const toDate = parseProgramDate(req.body?.toDate);
	if (!fromDate || !toDate || fromDate > toDate) {
		return res.status(400).json({ error: 'Select a valid Start and Finish date.' });
	}
	const expectedRaw = req.body?.expectedAmount;
	const expectedAmount = expectedRaw === undefined || expectedRaw === null || expectedRaw === ''
		? null
		: Number(expectedRaw);

	let connection;
	try {
		connection = await pool.getConnection();
		await connection.beginTransaction();

		const [lossRows] = await connection.execute(
			`SELECT IDNo, AMOUNT
			 FROM junket_loss
			 WHERE ACTIVE = 1
				AND LOSS_SETTLEMENT_ID IS NULL
				AND PROGRAM_DATE BETWEEN ? AND ?
			 FOR UPDATE`,
			[fromDate, toDate]
		);
		if (!lossRows.length) {
			await connection.rollback();
			return res.status(400).json({ error: 'Nothing to settle for the selected dates.' });
		}

		const amount = Math.round(lossRows.reduce((acc, r) => acc + (Number(r.AMOUNT) || 0), 0) * 100) / 100;

		if (expectedAmount !== null && Number.isFinite(expectedAmount) && Math.abs(expectedAmount - amount) >= 0.01) {
			await connection.rollback();
			return res.status(409).json({
				error: 'Loss amounts changed since the settlement was opened. Please review the new total.',
				amount
			});
		}
		if (amount < 0) {
			await connection.rollback();
			return res.status(400).json({ error: 'Recovery is greater than the loss for these dates.' });
		}

		const dateNow = new Date();
		const userId = req.session?.user_id ?? null;

		const [settleResult] = await connection.execute(
			`INSERT INTO junket_loss_settlement (DATE_FROM, DATE_TO, AMOUNT, ACTIVE, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, 1, ?, ?)`,
			[fromDate, toDate, amount, userId, dateNow]
		);
		const settlementId = settleResult.insertId;

		let capitalId = null;
		if (amount > 0) {
			const [userRows] = await connection.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [userId]);
			const fullname = userRows.length ? userRows[0].FIRSTNAME || null : null;
			const remarks = `Loss amount settlement ${formatSettlementYmd(fromDate)} - ${formatSettlementYmd(toDate)}`;
			const [capitalResult] = await connection.execute(
				`INSERT INTO junket_capital
					(TRANSACTION_ID, FULLNAME, DESCRIPTION, AMOUNT, REMARKS, ACTIVE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE)
				 VALUES (2, ?, 'Loss Amount', ?, ?, 1, ?, ?, ?)`,
				[fullname, amount, remarks, userId, dateNow, todayLocalYmd()]
			);
			capitalId = capitalResult.insertId;
			await connection.execute('UPDATE junket_loss_settlement SET CAPITAL_ID = ? WHERE IDNo = ?', [capitalId, settlementId]);
		}

		const ids = lossRows.map((r) => r.IDNo);
		await connection.execute(
			`UPDATE junket_loss SET LOSS_SETTLEMENT_ID = ? WHERE IDNo IN (${ids.map(() => '?').join(',')})`,
			[settlementId, ...ids]
		);

		await connection.commit();
		res.json({ success: true, settlement_id: settlementId, capital_id: capitalId, amount, count: ids.length });
	} catch (err) {
		if (connection) {
			try { await connection.rollback(); } catch (rollbackErr) { /* ignore */ }
		}
		console.error('Error settling loss amount:', err);
		res.status(500).json({ error: 'Failed to settle loss amount' });
	} finally {
		if (connection) connection.release();
	}
});

/** View one saved Loss Amount settlement (Authorized Master Account ledger), grouped per account code. */
router.get('/junket_loss_settlement/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

		const [settleRows] = await pool.execute(
			`SELECT IDNo,
				DATE_FORMAT(DATE_FROM, '%Y-%m-%d') AS DATE_FROM,
				DATE_FORMAT(DATE_TO, '%Y-%m-%d') AS DATE_TO,
				AMOUNT, CAPITAL_ID, ENCODED_DT
			 FROM junket_loss_settlement
			 WHERE IDNo = ? AND ACTIVE = 1
			 LIMIT 1`,
			[id]
		);
		if (!settleRows.length) return res.status(404).json({ error: 'Settlement not found' });

		const [groupRows] = await pool.execute(
			`SELECT ${SQL_LOSS_SETTLEMENT_GROUP} AS NAME, SUM(jl.AMOUNT) AS AMOUNT
			 FROM junket_loss jl
			 LEFT JOIN account a ON a.IDNo = jl.ACCOUNT_ID
			 LEFT JOIN agent ag ON ag.IDNo = a.AGENT_ID
			 WHERE jl.LOSS_SETTLEMENT_ID = ? AND jl.ACTIVE = 1
			 GROUP BY ${SQL_LOSS_SETTLEMENT_GROUP}
			 ORDER BY NAME ASC`,
			[id]
		);

		const settlement = settleRows[0];
		res.json({
			id: settlement.IDNo,
			date_from: settlement.DATE_FROM,
			date_to: settlement.DATE_TO,
			amount: Number(settlement.AMOUNT) || 0,
			capital_id: settlement.CAPITAL_ID,
			settled_at: settlement.ENCODED_DT,
			// Loss is a cost (negative on the slip); recoveries net it back.
			mains: groupRows.map((r) => ({ name: r.NAME, amount: -(Number(r.AMOUNT) || 0) })),
			total: -(Number(settlement.AMOUNT) || 0)
		});
	} catch (err) {
		console.error('Error loading loss amount settlement:', err);
		res.status(500).json({ error: 'Failed to load settlement' });
	}
});

/** Client omits ACTION (last column). */
router.post('/loss_amount/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'junketLoss',
			sheetName: 'Loss Amount',
			headers,
			rows,
			filename: filename || 'LossAmount-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('loss_amount/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

module.exports = router;
