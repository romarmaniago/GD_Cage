const path = require('path');
const ExcelJS = require('exceljs');
const { numberFormatForValue } = require('./excelAmountFormat');
const { resolveExportProfile } = require('./exportProfiles');

const AMOUNT_FMT = '#,##0;[Red](#,##0)';

const THIN_BORDER = {
	top: { style: 'thin', color: { argb: 'FF666666' } },
	left: { style: 'thin', color: { argb: 'FF666666' } },
	bottom: { style: 'thin', color: { argb: 'FF666666' } },
	right: { style: 'thin', color: { argb: 'FF666666' } }
};

const FILL_HEADER = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFD9E1F2' }
};

const FILL_GRAND_TOTAL = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFE2E8F0' }
};

const FILL_HEADER_TOTAL_COL = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFFFF3CD' }
};

const FILL_TOTAL_BAND = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFFFF3CD' }
};

const FILL_ZEBRA = {
	type: 'pattern',
	pattern: 'solid',
	fgColor: { argb: 'FFF5F5F5' }
};

function sanitizeSheetName(raw) {
	if (raw == null || typeof raw !== 'string') return '';
	let s = raw.trim().replace(/[\]\[\\\/\?\*:]/g, '');
	if (s.length > 31) s = s.slice(0, 31);
	return s;
}

function sanitizeFilename(filename, fallback) {
	let outName = fallback;
	if (filename && typeof filename === 'string') {
		const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
		if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
		else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
	}
	return outName;
}

function displayWidth(value) {
	return Array.from(String(value == null ? '' : value).replace(/\r?\n/g, ' ')).reduce((sum, ch) => {
		return sum + (ch.charCodeAt(0) > 255 ? 2 : 1);
	}, 0);
}

function stripCurrencyPrefix(s) {
	return s.replace(/^\u20B1\s*/, '').replace(/^PHP\s*/i, '').trim();
}

function isOutflowCol(col1, outflowSet) {
	return outflowSet.has(col1);
}

function isSignedCol(col1, signedSet) {
	return signedSet.has(col1);
}

/**
 * @param {*} raw
 * @param {number} colIndex0
 * @param {object} profile
 * @param {Set<number>} outflowSet
 * @param {Set<number>} signedSet
 * @param {Set<number>} percentSet
 */
function coerceExportCell(raw, colIndex0, profile, outflowSet, signedSet, percentSet) {
	if (raw == null || raw === '') return '';
	const col1 = colIndex0 + 1;

	if (percentSet.has(col1)) {
		if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
		const s = String(raw).trim();
		const m = s.match(/^([-+]?[\d,]*\.?\d+)\s*%$/);
		if (m) {
			const n = parseFloat(m[1].replace(/,/g, ''));
			if (Number.isFinite(n)) return n / 100;
		}
		return raw;
	}

	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
	let s = String(raw).trim();
	s = stripCurrencyPrefix(s);
	if (/[a-zA-Z]/.test(s)) return s;
	if (/%/.test(s)) return s;

	const isParenDisplay = /^\(\s*[\d,.\s]+\s*\)$/.test(s);
	const normalized = s.replace(/,/g, '').trim();
	if (isParenDisplay) {
		const inner = normalized.replace(/[()]/g, '').trim();
		if (!/^[-+]?(?:\d+\.\d+|\d+\.?|\.\d+)(?:[eE][-+]?\d+)?$/.test(inner)) return s;
		const n = Number(inner);
		if (!Number.isFinite(n)) return s;
		if (isSignedCol(col1, signedSet) || isOutflowCol(col1, outflowSet)) return -Math.abs(n);
		return Math.abs(n);
	}

	if (normalized === '' || normalized === '-' || normalized === '+') return s;
	if (!/^[-+]?(?:\d+\.\d+|\d+\.?|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)) return s;
	const n = Number(normalized);
	return Number.isFinite(n) ? n : s;
}

function bodyAlignment(colIndex0, profile, amountSet, leftSet, centerSet) {
	const col1 = colIndex0 + 1;
	if (leftSet.has(col1)) {
		return { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
	}
	if (amountSet.has(col1)) {
		return { vertical: 'middle', horizontal: 'right', indent: 1, wrapText: true };
	}
	if (centerSet.has(col1)) {
		return { vertical: 'middle', horizontal: 'center', wrapText: true };
	}
	if (profile.zebraRows || profile.highlightTotalCol) {
		return { vertical: 'middle', horizontal: 'center', wrapText: true };
	}
	return { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function autoFitRowHeights(ws, startRow, endRow) {
	for (let rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
		const row = ws.getRow(rowNumber);
		if (!row) continue;
		let maxLines = 1;
		row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
			if (!cell.alignment || !cell.alignment.wrapText) return;
			const colWidth = ws.getColumn(colNumber).width || 10;
			const text = cell.value == null ? '' : (cell.formula ? '' : String(cell.value));
			if (!text) return;
			let lineCount = 0;
			text.split(/\r?\n/).forEach((segment) => {
				lineCount += Math.max(1, Math.ceil(displayWidth(segment) / Math.max(1, colWidth - 1)));
			});
			maxLines = Math.max(maxLines, lineCount);
		});
		row.height = Math.max(15, Math.min(120, maxLines * 15));
	}
}

function addGrandTotalRow(ws, ncol, dataRowCount, profile, outflowSet, amountSet, fillGrandTotal, grandTotalLabel, amountNumFmt) {
	if (dataRowCount <= 0 || profile.skipGrandTotal) return;
	const dataStartRow = 2;
	const dataEndRow = 1 + dataRowCount;
	const totalRowNum = dataEndRow + 1;
	const labelCols = profile.labelCols || 1;
	const amountAlign = { vertical: 'middle', horizontal: 'right', indent: 1, wrapText: true };
	const grandTotalBorder = {
		top: { style: 'medium', color: { argb: 'FF333333' } },
		left: { style: 'thin', color: { argb: 'FF666666' } },
		bottom: { style: 'thin', color: { argb: 'FF666666' } },
		right: { style: 'thin', color: { argb: 'FF666666' } }
	};

	const totalRow = ws.addRow(Array.from({ length: ncol }, () => null));

	profile.amountCols.forEach((col1) => {
		if (!amountSet.has(col1)) return;
		const letter = ws.getColumn(col1).letter;
		const range = letter + dataStartRow + ':' + letter + dataEndRow;
		const sumExpr = isOutflowCol(col1, outflowSet) ? 'ABS(SUM(' + range + '))' : 'SUM(' + range + ')';
		const cell = totalRow.getCell(col1);
		cell.value = { formula: sumExpr };
		cell.numFmt = amountNumFmt;
		cell.alignment = amountAlign;
	});

	if (labelCols > 1) {
		try {
			ws.mergeCells(totalRowNum, 1, totalRowNum, labelCols);
		} catch (mergeErr) {
			console.warn('export: grand total merge skipped:', mergeErr.message);
		}
	}

	const labelCell = totalRow.getCell(1);
	labelCell.value = grandTotalLabel;
	labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };

	for (let col1 = 1; col1 <= ncol; col1++) {
		const cell = totalRow.getCell(col1);
		cell.font = { bold: true, size: 11 };
		cell.fill = fillGrandTotal;
		cell.border = grandTotalBorder;
		if (!cell.alignment) {
			cell.alignment = col1 <= labelCols
				? labelCell.alignment
				: { vertical: 'middle', horizontal: 'center', wrapText: true };
		}
	}

	totalRow.height = 24;
}

function applyExportNumericFormats(ws, amountSet, percentSet, lastRowNum, amountNumFmt) {
	const numFmt = amountNumFmt || AMOUNT_FMT;
	ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
		if (rowNumber <= 1 || rowNumber > lastRowNum) return;
		row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
			if (cell.numFmt && /%/.test(String(cell.numFmt))) return;
			const hasFormula =
				!!cell.formula || (cell.value != null && typeof cell.value === 'object' && cell.value.formula);
			if (hasFormula) {
				if (amountSet.has(colNumber)) cell.numFmt = numFmt;
				return;
			}
			if (percentSet.has(colNumber) && typeof cell.value === 'number' && Number.isFinite(cell.value)) {
				cell.numFmt = '0.00%';
				return;
			}
			if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
				cell.numFmt = amountSet.has(colNumber) ? numFmt : numberFormatForValue(cell.value);
			}
		});
	});
}

function findTotalColIndex(headers) {
	let totalColIndex = -1;
	headers.forEach((h, i) => {
		if (String(h == null ? '' : h).trim().toLowerCase() === 'total') totalColIndex = i;
	});
	return totalColIndex;
}

function computeColumnWidths(headers, rows, dataRowCount, profile, grandTotalLabel) {
	return headers.map((h, c) => {
		const headerText = String(h == null ? '' : h);
		const upperHeader = headerText.toUpperCase();
		let m = displayWidth(headerText);
		for (let ri = 0; ri < rows.length; ri++) {
			const row = rows[ri];
			if (!Array.isArray(row) || row[c] == null) continue;
			const L = displayWidth(row[c]);
			if (L > m) m = L;
		}
		if (dataRowCount > 0 && c === 0) {
			m = Math.max(m, displayWidth(grandTotalLabel));
		}
		let minWidth = 11;
		let maxWidth = profile.zebraRows ? 52 : 60;
		if (upperHeader.includes('DESCRIPTION')) {
			minWidth = 24;
			maxWidth = 100;
		} else if (upperHeader.includes('PROGRAM DATE') || upperHeader.includes('GAME START') || upperHeader.includes('GAME END')) {
			minWidth = 14;
		} else if (upperHeader.includes('ACCT')) {
			minWidth = 18;
		} else if (upperHeader === 'GUEST') {
			minWidth = 14;
		} else if (upperHeader.includes('GAME RATE')) {
			minWidth = 13;
		} else if (upperHeader.includes('COMMISSION') || upperHeader.includes('TOTAL SETTLE')) {
			minWidth = 15;
		} else if (upperHeader.includes('BUY') || upperHeader.includes('CASH') || upperHeader.includes('WIN') || upperHeader.includes('ROLLING')) {
			minWidth = 13;
		} else if (upperHeader.includes('RECEIPT') || upperHeader.includes('DATE')) {
			minWidth = 18;
		}
		return Math.min(maxWidth, Math.max(minWidth, m + 4));
	});
}

/**
 * @param {object} opts
 * @param {string} [opts.profileKey]
 * @param {string} opts.sheetName
 * @param {string[]} opts.headers
 * @param {Array[]} opts.rows
 * @param {string} [opts.filename]
 * @param {number} [opts.maxRows=10000]
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function buildTableExportXlsx(opts) {
	const {
		profileKey,
		sheetName,
		headers,
		rows,
		filename,
		maxRows = 10000
	} = opts;

	if (!Array.isArray(headers) || headers.length === 0) {
		throw Object.assign(new Error('Invalid headers'), { status: 400 });
	}
	if (!Array.isArray(rows)) {
		throw Object.assign(new Error('Invalid rows'), { status: 400 });
	}
	if (rows.length > maxRows) {
		throw Object.assign(new Error('Too many rows'), { status: 400 });
	}

	const ncol = headers.length;
	const headerStrings = headers.map((h) => (h == null ? '' : String(h)));
	const profile = resolveExportProfile(profileKey, ncol, headerStrings);
	const amountSet = new Set(profile.amountCols);
	const outflowSet = new Set(profile.outflowCols);
	const signedSet = new Set(profile.signedCols);
	const percentSet = new Set(profile.percentCols);
	const leftSet = new Set(profile.leftAlignCols);
	const centerSet = new Set(profile.centerAlignCols);
	const amountNumFmt = profile.amountNumFmt || AMOUNT_FMT;
	const grandTotalLabel = profile.grandTotalLabel || 'GRAND TOTAL';
	const totalColIndex = profile.highlightTotalCol ? findTotalColIndex(headerStrings) : -1;

	const workbook = new ExcelJS.Workbook();
	const wsTitle = sanitizeSheetName(sheetName) || 'Export';
	const ws = workbook.addWorksheet(wsTitle, {
		views: [{ state: 'frozen', ySplit: 1 }]
	});

	const headerRow = ws.addRow(headerStrings);
	headerRow.height = 22;
	headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
		const colIdx = colNumber - 1;
		cell.font = { bold: true };
		cell.alignment = bodyAlignment(colNumber - 1, profile, amountSet, leftSet, centerSet);
		if (profile.zebraRows || profile.highlightTotalCol) {
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
		}
		cell.border = THIN_BORDER;
		cell.fill = colIdx === totalColIndex ? FILL_HEADER_TOTAL_COL : FILL_HEADER;
	});

	rows.forEach((r, rowIdx) => {
		const arr = Array.isArray(r) ? r : [];
		const padded = Array.from({ length: ncol }, (_, i) => {
			const v = arr[i];
			if (v == null || v === '') return '';
			return coerceExportCell(v, i, profile, outflowSet, signedSet, percentSet);
		});
		const dataRow = ws.addRow(padded);
		for (let colNumber = 1; colNumber <= ncol; colNumber++) {
			const cell = dataRow.getCell(colNumber);
			const colIdx = colNumber - 1;
			cell.border = THIN_BORDER;
			cell.alignment = bodyAlignment(colNumber - 1, profile, amountSet, leftSet, centerSet);
			if (profile.highlightTotalCol && colIdx === totalColIndex) {
				cell.fill = FILL_TOTAL_BAND;
			} else if (profile.zebraRows && rowIdx % 2 === 1) {
				cell.fill = FILL_ZEBRA;
			}
			if (percentSet.has(colNumber)) {
				const orig = arr[colNumber - 1];
				const s = orig == null ? '' : String(orig).trim();
				if (/^[-+]?[\d,]*\.?\d+\s*%$/.test(s) && typeof cell.value === 'number') {
					cell.numFmt = '0.00%';
				}
			}
		}
	});

	const dataRowCount = rows.length;
	if (dataRowCount > 0) {
		addGrandTotalRow(ws, ncol, dataRowCount, profile, outflowSet, amountSet, FILL_GRAND_TOTAL, grandTotalLabel, amountNumFmt);
	}

	const colWidths = computeColumnWidths(headerStrings, rows, dataRowCount, profile, grandTotalLabel);
	for (let i = 1; i <= ncol; i++) {
		ws.getColumn(i).width = colWidths[i - 1];
	}

	const lastRowNum = dataRowCount > 0 && !profile.skipGrandTotal ? dataRowCount + 2 : Math.max(1, dataRowCount + 1);
	autoFitRowHeights(ws, 2, lastRowNum);
	applyExportNumericFormats(ws, amountSet, percentSet, lastRowNum, amountNumFmt);

	const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
	const outName = sanitizeFilename(filename, 'Export.xlsx');
	return { buffer, filename: outName };
}

/**
 * @param {import('express').Response} res
 * @param {{ buffer: Buffer, filename: string }} result
 */
function sendTableExportResponse(res, result) {
	res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	res.setHeader('Content-Disposition', 'attachment; filename="' + result.filename.replace(/"/g, '') + '"');
	return res.send(result.buffer);
}

module.exports = {
	buildTableExportXlsx,
	sendTableExportResponse,
	sanitizeSheetName,
	sanitizeFilename,
	AMOUNT_FMT
};
