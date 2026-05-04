const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

function coerceDailyReportMatrixCell(raw) {
	if (raw == null || raw === '') return '';
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
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

function sanitizeDailyReportSheetName(raw) {
	if (raw == null || typeof raw !== 'string') return '';
	let s = raw.trim().replace(/[\]\[\\\/\?\*:]/g, '');
	if (s.length > 31) s = s.slice(0, 31);
	return s;
}

router.post('/daily_report_matrix/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename, sheetName } = req.body || {};
		if (!Array.isArray(headers) || headers.length === 0) {
			return res.status(400).json({ error: 'Invalid headers' });
		}
		if (!Array.isArray(rows)) {
			return res.status(400).json({ error: 'Invalid rows' });
		}
		const MAX_ROWS = 5000;
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

		const fillHeaderDefault = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFD9E1F2' }
		};
		const fillHeaderTotalCol = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFFFF3CD' }
		};
		const fillTotalBand = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFFFF3CD' }
		};
		const fillZebra = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFF5F5F5' }
		};

		let totalColIndex = -1;
		headers.forEach((h, i) => {
			if (String(h == null ? '' : h).trim().toLowerCase() === 'total') totalColIndex = i;
		});

		function isTotalSummaryRow(arr) {
			const first = Array.isArray(arr) ? arr[0] : undefined;
			if (first == null || first === '') return false;
			return String(first).trim().toLowerCase() === 'total';
		}

		const workbook = new ExcelJS.Workbook();
		const sheetTitle = sanitizeDailyReportSheetName(sheetName) || 'Daily Report';
		const ws = workbook.addWorksheet(sheetTitle, {
			views: [{ state: 'frozen', ySplit: 1 }]
		});

		const headerRow = ws.addRow(headers.map((h) => (h == null ? '' : String(h))));
		headerRow.height = 22;
		headerRow.eachCell((cell, colNumber) => {
			const colIdx = colNumber - 1;
			cell.font = { bold: true };
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			cell.border = thinBorder;
			cell.fill = colIdx === totalColIndex ? fillHeaderTotalCol : fillHeaderDefault;
		});

		rows.forEach((r, rowIdx) => {
			const arr = Array.isArray(r) ? r : [];
			const padded = Array.from({ length: ncol }, (_, i) => {
				const v = arr[i];
				if (v == null || v === '') return '';
				return coerceDailyReportMatrixCell(v);
			});
			const isGrandTotalRow = isTotalSummaryRow(arr);
			const dataRow = ws.addRow(padded);
			dataRow.eachCell((cell, colNumber) => {
				const colIdx = colNumber - 1;
				cell.border = thinBorder;
				cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
				if (isGrandTotalRow) {
					cell.fill = fillTotalBand;
					cell.font = { bold: true };
					return;
				}
				if (colIdx === totalColIndex) {
					cell.fill = fillTotalBand;
					return;
				}
				if (rowIdx % 2 === 1) {
					cell.fill = fillZebra;
				}
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
			return Math.min(52, Math.max(10, m + 2));
		});
		for (let i = 1; i <= ncol; i++) {
			const col = ws.getColumn(i);
			col.width = colMaxLens[i - 1];
			col.alignment = { horizontal: 'center', vertical: 'middle' };
		}

		const buffer = await workbook.xlsx.writeBuffer();
		let outName = 'DailyReport-export.xlsx';
		if (filename && typeof filename === 'string') {
			const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
			if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
			else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
		}
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('daily_report_matrix/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

router.get('/table_daily_report', checkSession, (req, res) => {
	const data = sessions(req, 'table_daily_report_rolling');
	data.permissions = req.session.permissions || 0;
	res.render('daily_reports/rolling', data);
});

router.get('/table_daily_report_rolling', checkSession, (req, res) => {
	const data = sessions(req, 'table_daily_report_rolling');
	data.permissions = req.session.permissions || 0;
	res.render('daily_reports/rolling', data);
});

router.get('/table_daily_report_winloss', checkSession, (req, res) => {
	const data = sessions(req, 'table_daily_report_winloss');
	data.permissions = req.session.permissions || 0;
	res.render('daily_reports/winloss', data);
});

router.get('/junket_tables_data', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute(
			`SELECT
				IDNo AS id,
				TABLE_NAME AS table_name,
				ACTIVE AS active
			 FROM junket_tables
			 WHERE ACTIVE = 1
			 ORDER BY IDNo ASC`
		);

		res.json(rows || []);
	} catch (error) {
		console.error('junket_tables_data:', error);
		res.status(500).json({ message: 'Error loading junket tables.' });
	}
});

router.get('/daily_report_available_tables', checkSession, async (req, res) => {
	try {
		const reportDate = String(req.query.report_date || '').trim();
		const reportModeRaw = String(req.query.report_mode || 'both').trim().toLowerCase();
		const reportMode = ['rolling', 'winloss', 'both'].includes(reportModeRaw) ? reportModeRaw : 'both';
		if (!reportDate) {
			return res.status(400).json({ message: 'Report date is required.' });
		}

		let modeCondition = 'AND dtr.IDNo IS NULL';
		if (reportMode === 'rolling') {
			modeCondition = 'AND (dtr.IDNo IS NULL OR dtr.ROLLING_AMT = 0)';
		} else if (reportMode === 'winloss') {
			modeCondition = 'AND (dtr.IDNo IS NULL OR dtr.WINLOSS_AMT = 0)';
		}

		const [rows] = await pool.execute(
			`SELECT
				jt.IDNo AS id,
				jt.TABLE_NAME AS table_name
			 FROM junket_tables jt
			 LEFT JOIN daily_table_reports dtr
				ON dtr.JUNKET_TABLE_ID = jt.IDNo
				AND dtr.REPORT_DATE = ?
				AND dtr.ACTIVE = 1
			 WHERE jt.ACTIVE = 1
				${modeCondition}
			 ORDER BY jt.IDNo ASC`,
			[reportDate]
		);

		res.json(rows || []);
	} catch (error) {
		console.error('daily_report_available_tables:', error);
		res.status(500).json({ message: 'Error loading available tables for report date.' });
	}
});

router.get('/daily_report_list', checkSession, async (req, res) => {
	try {
		const reportModeRaw = String(req.query.report_mode || 'both').trim().toLowerCase();
		const reportMode = ['rolling', 'winloss', 'both'].includes(reportModeRaw) ? reportModeRaw : 'both';
		const reportDate = String(req.query.report_date || '').trim();
		const reportDateFrom = String(req.query.report_date_from || '').trim();
		const reportDateTo = String(req.query.report_date_to || '').trim();

		let valueCondition = 'AND (dtr.ROLLING_AMT <> 0 OR dtr.WINLOSS_AMT <> 0)';
		if (reportMode === 'rolling') {
			valueCondition = 'AND dtr.ROLLING_AMT <> 0';
		} else if (reportMode === 'winloss') {
			valueCondition = 'AND dtr.WINLOSS_AMT <> 0';
		}

		let dateCondition = '';
		const params = [];
		if (reportDateFrom && reportDateTo) {
			dateCondition = 'AND dtr.REPORT_DATE BETWEEN ? AND ?';
			params.push(reportDateFrom, reportDateTo);
		} else if (reportDate) {
			dateCondition = 'AND dtr.REPORT_DATE = ?';
			params.push(reportDate);
		}

		const [rows] = await pool.execute(
			`SELECT
				dtr.IDNo AS id,
				jt.IDNo AS junket_table_id,
				DATE_FORMAT(dtr.REPORT_DATE, '%Y-%m-%d') AS report_date,
				jt.TABLE_NAME AS table_name,
				dtr.ROLLING_AMT AS rolling_amt,
				dtr.WINLOSS_AMT AS winloss_amt
			 FROM daily_table_reports dtr
			 INNER JOIN junket_tables jt ON jt.IDNo = dtr.JUNKET_TABLE_ID
			 WHERE dtr.ACTIVE = 1
				${dateCondition}
				${valueCondition}
			 ORDER BY dtr.REPORT_DATE DESC, jt.IDNo ASC`,
			params
		);

		res.json(rows || []);
	} catch (error) {
		console.error('daily_report_list:', error);
		res.status(500).json({ message: 'Error loading daily reports.' });
	}
});

router.post('/add_junket_table', checkSession, async (req, res) => {
	try {
		const rawName = String(req.body.table_name || req.body.txtTableName || '').trim();
		if (!rawName) {
			return res.status(400).json({ message: 'Table name is required.' });
		}

		const tableName = rawName.slice(0, 120);
		const userId = req.session.user_id || null;
		const now = new Date();

		const [existingRows] = await pool.execute(
			`SELECT IDNo AS id, ACTIVE AS active
			 FROM junket_tables
			 WHERE TABLE_NAME = ?
			 LIMIT 1`,
			[tableName]
		);

		if (existingRows && existingRows.length > 0) {
			const existing = existingRows[0];
			if (Number(existing.active) === 1) {
				return res.status(400).json({ message: 'Table name already exists.' });
			}

			await pool.execute(
				`UPDATE junket_tables
				 SET ACTIVE = 1, EDITED_BY = ?, EDITED_DT = ?
				 WHERE IDNo = ?`,
				[userId, now, existing.id]
			);

			return res.json({ success: true, message: 'Junket table restored successfully.' });
		}

		await pool.execute(
			`INSERT INTO junket_tables (TABLE_NAME, ACTIVE, ENCODED_BY, ENCODED_DT)
			 VALUES (?, 1, ?, ?)`,
			[tableName, userId, now]
		);

		res.json({ success: true, message: 'Junket table added successfully.' });
	} catch (error) {
		if (error && error.code === 'ER_DUP_ENTRY') {
			return res.status(400).json({ message: 'Table name already exists.' });
		}
		console.error('add_junket_table:', error);
		res.status(500).json({ message: 'Error adding junket table.' });
	}
});

router.put('/junket_table/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!id || id < 1) {
			return res.status(400).json({ message: 'Invalid table id.' });
		}

		const rawName = String(req.body.table_name || req.body.txtTableName || '').trim();
		if (!rawName) {
			return res.status(400).json({ message: 'Table name is required.' });
		}

		const tableName = rawName.slice(0, 120);
		const userId = req.session.user_id || null;
		const now = new Date();

		const [result] = await pool.execute(
			`UPDATE junket_tables
			 SET TABLE_NAME = ?, EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[tableName, userId, now, id]
		);

		if (!result || result.affectedRows === 0) {
			return res.status(404).json({ message: 'Junket table not found.' });
		}

		res.json({ success: true, message: 'Junket table updated successfully.' });
	} catch (error) {
		if (error && error.code === 'ER_DUP_ENTRY') {
			return res.status(400).json({ message: 'Table name already exists.' });
		}
		console.error('junket_table update:', error);
		res.status(500).json({ message: 'Error updating junket table.' });
	}
});

router.put('/junket_table/remove/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!id || id < 1) {
			return res.status(400).json({ message: 'Invalid table id.' });
		}

		const userId = req.session.user_id || null;
		const now = new Date();

		const [result] = await pool.execute(
			`UPDATE junket_tables
			 SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[userId, now, id]
		);

		if (!result || result.affectedRows === 0) {
			return res.status(404).json({ message: 'Junket table not found or already removed.' });
		}

		res.json({ success: true, message: 'Junket table removed successfully.' });
	} catch (error) {
		console.error('junket_table remove:', error);
		res.status(500).json({ message: 'Error removing junket table.' });
	}
});

router.post('/add_daily_table_report', checkSession, async (req, res) => {
	try {
		const reportDate = String(req.body.report_date || '').trim();
		const reportModeRaw = String(req.body.report_mode || 'both').trim().toLowerCase();
		const reportMode = ['rolling', 'winloss', 'both'].includes(reportModeRaw) ? reportModeRaw : 'both';
		const shouldUpdateRolling = reportMode === 'rolling' || reportMode === 'both';
		const shouldUpdateWinloss = reportMode === 'winloss' || reportMode === 'both';

		if (!reportDate) {
			return res.status(400).json({ message: 'Report date is required.' });
		}

		const incomingReports = Array.isArray(req.body.reports) ? req.body.reports : [];
		const reports = incomingReports.length > 0
			? incomingReports
			: [{
				junket_table_id: req.body.junket_table_id,
				rolling: req.body.rolling,
				winloss: req.body.winloss
			}];

		if (!reports || reports.length === 0) {
			return res.status(400).json({ message: 'No table reports to save.' });
		}

		const normalizedReports = reports.map((item) => {
			const parsedRolling = Number(item.rolling);
			const parsedWinloss = Number(item.winloss);
			const rolling = Number.isNaN(parsedRolling) ? NaN : parsedRolling;
			const winloss = Number.isNaN(parsedWinloss) ? NaN : parsedWinloss;
			return {
				tableId: parseInt(item.junket_table_id, 10),
				rolling: shouldUpdateRolling ? rolling : 0,
				winloss: shouldUpdateWinloss ? winloss : 0
			};
		});

		const invalid = normalizedReports.find((item) => {
			if (!item.tableId || item.tableId < 1) return true;
			if (shouldUpdateRolling && Number.isNaN(item.rolling)) return true;
			if (shouldUpdateWinloss && Number.isNaN(item.winloss)) return true;
			return false;
		});
		if (invalid) {
			if (shouldUpdateRolling && shouldUpdateWinloss) {
				return res.status(400).json({ message: 'Each table needs valid Rolling and Winloss values.' });
			}
			return res.status(400).json({ message: shouldUpdateRolling ? 'Each table needs a valid Rolling value.' : 'Each table needs a valid Winloss value.' });
		}

		const uniqueTableIds = [...new Set(normalizedReports.map((item) => item.tableId))];
		if (uniqueTableIds.length === 0) {
			return res.status(400).json({ message: 'No valid tables provided.' });
		}

		const placeholders = uniqueTableIds.map(() => '?').join(',');
		const [tableRows] = await pool.execute(
			`SELECT IDNo
			 FROM junket_tables
			 WHERE ACTIVE = 1 AND IDNo IN (${placeholders})`,
			uniqueTableIds
		);

		const activeTableIds = new Set((tableRows || []).map((row) => Number(row.IDNo)));
		const hasInactiveTable = uniqueTableIds.some((id) => !activeTableIds.has(Number(id)));
		if (hasInactiveTable) {
			return res.status(400).json({ message: 'Some selected tables are not active or do not exist.' });
		}

		const userId = req.session.user_id || null;
		const now = new Date();

		for (const item of normalizedReports) {
			await pool.execute(
				`INSERT INTO daily_table_reports
					(REPORT_DATE, JUNKET_TABLE_ID, ROLLING_AMT, WINLOSS_AMT, ACTIVE, ENCODED_BY, ENCODED_DT)
				 VALUES (?, ?, ?, ?, 1, ?, ?)
				 ON DUPLICATE KEY UPDATE
					ROLLING_AMT = IF(?, VALUES(ROLLING_AMT), ROLLING_AMT),
					WINLOSS_AMT = IF(?, VALUES(WINLOSS_AMT), WINLOSS_AMT),
					EDITED_BY = VALUES(ENCODED_BY),
					EDITED_DT = VALUES(ENCODED_DT),
					ACTIVE = 1`,
				[reportDate, item.tableId, item.rolling, item.winloss, userId, now, shouldUpdateRolling ? 1 : 0, shouldUpdateWinloss ? 1 : 0]
			);
		}

		res.json({ success: true, message: 'Daily table reports saved successfully.' });
	} catch (error) {
		console.error('add_daily_table_report:', error);
		res.status(500).json({ message: 'Error saving daily table report.' });
	}
});

module.exports = router;
