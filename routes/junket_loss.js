const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { buildTableExportXlsx, sendTableExportResponse } = require('../utils/ExcelExportService');

router.get('/junket_loss', checkSession, function (req, res) {
	const data = sessions(req, 'junket_loss');
	data.permissions = req.session.permissions;
	res.render('junket/junket_loss', data);
});

router.get('/junket_loss_total', checkSession, async (req, res) => {
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

router.get('/junket_loss_data', async (req, res) => {
	try {
		let { fromDate, toDate } = req.query;
		const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

		if (!isValidDate(fromDate) || !isValidDate(toDate)) {
			const now = new Date();
			const first = new Date(now.getFullYear(), now.getMonth(), 1);
			const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
			const pad = (n) => String(n).padStart(2, '0');
			fromDate = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`;
			toDate = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
		}

		const query = `
			SELECT
				jl.IDNo,
				jl.DESCRIPTION,
				jl.AMOUNT,
				jl.IN_CHARGE,
				jl.ENCODED_BY,
				jl.ENCODED_DT,
				CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME) AS ENCODED_BY_NAME
			FROM junket_loss jl
			LEFT JOIN user_info ui ON ui.IDNo = jl.ENCODED_BY
			WHERE jl.ACTIVE = 1
				AND DATE(jl.ENCODED_DT) BETWEEN ? AND ?
			ORDER BY jl.ENCODED_DT DESC
		`;

		const [result] = await pool.execute(query, [fromDate, toDate]);
		res.json(result);
	} catch (error) {
		console.error('Error fetching junket loss data:', error);
		res.status(500).json({ message: 'Failed to fetch junket loss data' });
	}
});

router.post('/add_junket_loss', async (req, res) => {
	try {
		const { txtDescription, txtAmount, txtInCharge } = req.body;
		const date_now = new Date();
		const cleanAmount = String(txtAmount || '').replace(/,/g, '');

		if (!txtDescription || !txtInCharge || cleanAmount === '' || Number.isNaN(Number(cleanAmount))) {
			return res.status(400).json({ message: 'Invalid payload' });
		}

		const query = `
			INSERT INTO junket_loss (DESCRIPTION, AMOUNT, IN_CHARGE, ENCODED_BY, ENCODED_DT)
			VALUES (?, ?, ?, ?, ?)
		`;

		await pool.execute(
			query,
			[txtDescription.trim(), Number(cleanAmount), txtInCharge.trim(), req.session.user_id, date_now]
		);

		res.json({ message: 'Saved successfully' });
	} catch (error) {
		console.error('Error inserting junket loss:', error);
		res.status(500).json({ message: 'Failed to save junket loss' });
	}
});

router.put('/junket_loss/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		const { txtDescription, txtAmount, txtInCharge } = req.body;
		const date_now = new Date();
		const cleanAmount = String(txtAmount || '').replace(/,/g, '');

		if (!id || !txtDescription || !txtInCharge || cleanAmount === '' || Number.isNaN(Number(cleanAmount))) {
			return res.status(400).json({ message: 'Invalid payload' });
		}

		const query = `
			UPDATE junket_loss
			SET DESCRIPTION = ?, AMOUNT = ?, IN_CHARGE = ?, EDITED_BY = ?, EDITED_DT = ?
			WHERE IDNo = ? AND ACTIVE = 1
		`;

		await pool.execute(
			query,
			[txtDescription.trim(), Number(cleanAmount), txtInCharge.trim(), req.session.user_id, date_now, id]
		);

		res.json({ message: 'Updated successfully' });
	} catch (error) {
		console.error('Error updating junket loss:', error);
		res.status(500).json({ message: 'Failed to update junket loss' });
	}
});

router.put('/junket_loss/remove/:id', async (req, res) => {
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
router.post('/junket_loss/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'junketLoss',
			sheetName: 'Junket Loss',
			headers,
			rows,
			filename: filename || 'JunketLoss-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('junket_loss/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

module.exports = router;
