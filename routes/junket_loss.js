const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { applyCommaThousandsToNumericCells } = require('../utils/excelAmountFormat');

function coerceJunketLossExportCell(raw) {
	if (raw == null || raw === '') return '';
	let s = String(raw).trim();
	s = s.replace(/^\u20B1\s*/, '').replace(/^PHP\s*/i, '').trim();
	if (/[a-zA-Z]/.test(s)) return s;
	if (/%/.test(s)) return s;
	const normalized = s.replace(/,/g, '');
	if (normalized === '' || normalized === '-' || normalized === '+') return s;
	if (!/^[-+]?(?:\d+\.\d+|\d+\.?|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)) return s;
	const n = Number(normalized);
	return Number.isFinite(n) ? n : s;
}

router.get('/junket_loss', checkSession, function (req, res) {
	const data = sessions(req, 'junket_loss');
	data.permissions = req.session.permissions;
	res.render('junket/junket_loss', data);
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

/** Client omits ENCODED BY (index 3) and ACTION (last column). */
router.post('/junket_loss/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename } = req.body || {};
		if (!Array.isArray(headers) || headers.length === 0) {
			return res.status(400).json({ error: 'Invalid headers' });
		}
		if (!Array.isArray(rows)) {
			return res.status(400).json({ error: 'Invalid rows' });
		}
		const MAX_ROWS = 10000;
		if (rows.length > MAX_ROWS) {
			return res.status(400).json({ error: 'Too many rows' });
		}
		const ncol = headers.length;
		const thinBorder = {
			top: { style: 'thin', color: { argb: 'FF666666' } },
			left: { style: 'thin', color: { argb: 'FF666666' } },
			bottom: { style: 'thin', color: { argb: 'FF666666' } },
			right: { style: 'thin', color: { argb: 'FF666666' } }
		};

		const workbook = new ExcelJS.Workbook();
		const ws = workbook.addWorksheet('Junket Loss', {
			views: [{ state: 'frozen', ySplit: 1 }]
		});

		const headerRow = ws.addRow(headers.map((h) => (h == null ? '' : String(h))));
		headerRow.height = 22;
		headerRow.eachCell((cell) => {
			cell.font = { bold: true };
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			cell.border = thinBorder;
			cell.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FFD9E1F2' }
			};
		});

		rows.forEach((r) => {
			const arr = Array.isArray(r) ? r : [];
			const padded = Array.from({ length: ncol }, (_, i) => {
				const v = arr[i];
				if (v == null || v === '') return '';
				return coerceJunketLossExportCell(v);
			});
			const dataRow = ws.addRow(padded);
			dataRow.eachCell((cell) => {
				cell.border = thinBorder;
				cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			});
		});

		const colMaxLens = headers.map((h, c) => {
			let m = String(h == null ? '' : h).length;
			for (let ri = 0; ri < rows.length; ri++) {
				const row = rows[ri];
				if (!Array.isArray(row) || row[c] == null) continue;
				const L = String(row[c]).length;
				if (L > m) m = L;
			}
			return Math.min(48, Math.max(10, m + 2));
		});
		for (let i = 1; i <= ncol; i++) {
			const col = ws.getColumn(i);
			col.width = colMaxLens[i - 1];
			col.alignment = { horizontal: 'center', vertical: 'middle' };
		}

		applyCommaThousandsToNumericCells(ws);

		const buffer = await workbook.xlsx.writeBuffer();
		let outName = 'JunketLoss-export.xlsx';
		if (filename && typeof filename === 'string') {
			const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
			if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
			else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
		}
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('junket_loss/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

module.exports = router;
