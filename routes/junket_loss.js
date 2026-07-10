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
			'SELECT COALESCE(SUM(AMOUNT), 0) AS TOTAL FROM junket_loss WHERE ACTIVE = 1 AND GAME_ID IS NULL'
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
				jl.ENCODED_BY,
				jl.ENCODED_DT,
				CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME) AS ENCODED_BY_NAME,
				NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(TRIM(ag.AGENT_CODE), ''), NULLIF(TRIM(ag.NAME), ''))), '') AS ACCOUNT_NAME,
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

		const query = `
			INSERT INTO junket_loss (
				DESCRIPTION, AMOUNT, IN_CHARGE, PROGRAM_DATE, ACCOUNT_ID, GUEST_ID, PAYMENT_TYPE,
				ENCODED_BY, ENCODED_DT
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;

		await pool.execute(query, [
			txtDescription.trim(),
			Number(cleanAmount),
			txtInCharge.trim(),
			programDate,
			accountId,
			guestId,
			paymentType,
			req.session.user_id,
			encodedDt
		]);

		res.json({ message: 'Saved successfully' });
	} catch (error) {
		console.error('Error inserting junket loss:', error);
		res.status(500).json({ message: 'Failed to save junket loss' });
	}
});

router.put('/loss_amount/:id', async (req, res) => {
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

		const query = `
			UPDATE junket_loss
			SET DESCRIPTION = ?, AMOUNT = ?, IN_CHARGE = ?, PROGRAM_DATE = ?,
				ACCOUNT_ID = ?, GUEST_ID = ?, PAYMENT_TYPE = ?,
				EDITED_BY = ?, EDITED_DT = ?
			WHERE IDNo = ? AND ACTIVE = 1
		`;

		await pool.execute(query, [
			txtDescription.trim(),
			Number(cleanAmount),
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

router.put('/loss_amount/remove/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		const date_now = new Date();

		if (!id) return res.status(400).json({ message: 'Invalid ID' });

		const query = `UPDATE junket_loss SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query, [0, req.session.user_id, date_now, id]);

		res.json({ message: 'Archived successfully' });
	} catch (error) {
		console.error('Error archiving junket loss:', error);
		res.status(500).json({ message: 'Failed to archive junket loss' });
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
