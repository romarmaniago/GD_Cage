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

/** Approximate Calibri 11 glyph widths in px (Excel's width unit is the "0" digit, 7px). */
const CALIBRI_PX = {
	A: 8, B: 8, C: 7.5, D: 9, E: 7, F: 6.5, G: 9, H: 9, I: 3.5, J: 4.5, K: 7.5, L: 6, M: 12,
	N: 9, O: 9.5, P: 7.5, Q: 9.5, R: 8, S: 6.5, T: 7, U: 9, V: 8, W: 12.5, X: 7.5, Y: 7, Z: 6.5,
	i: 3, j: 3, l: 3, f: 4, t: 4.5, r: 4.5, m: 11, w: 10,
	' ': 3, '.': 3.5, ',': 3.5, ':': 3.5, ';': 3.5, "'": 3, '!': 3.5, '|': 3.5,
	'/': 5, '-': 4.3, '(': 4, ')': 4, '[': 4, ']': 4, '·': 3.5, '&': 9.5, '%': 10, '@': 13
};

/** Text width in Excel column units, measured per glyph (CJK / Hangul ≈ 2.1 units). */
function measuredTextWidth(value) {
	let px = 0;
	Array.from(String(value == null ? '' : value).replace(/\r?\n/g, ' ')).forEach((ch) => {
		if (CALIBRI_PX[ch] != null) px += CALIBRI_PX[ch];
		else if (/[0-9]/.test(ch)) px += 7;
		else if (/[a-z]/.test(ch)) px += 6.5;
		else if (ch.charCodeAt(0) > 0x2e7f) px += 14.7;
		else px += 7;
	});
	return px / 7;
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
	const align = bodyAlignmentBase(colIndex0, profile, amountSet, leftSet, centerSet);
	return profile.noWrap ? Object.assign(align, { wrapText: false }) : align;
}

function bodyAlignmentBase(colIndex0, profile, amountSet, leftSet, centerSet) {
	const col1 = colIndex0 + 1;
	if (leftSet.has(col1)) {
		return { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
	}
	if (amountSet.has(col1)) {
		const amountIndent = profile.amountIndent != null ? profile.amountIndent : 1;
		// No wrapText on amounts: Excel ignores the "_)" padding of the number format in wrapped cells,
		// so positives would not line up with "( )" negatives.
		return { vertical: 'middle', horizontal: 'right', indent: amountIndent, wrapText: false };
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
			const text = cell.value == null || cell.formula ? ''
				: (cell.value instanceof Date ? String(cell.numFmt || '0000-00-00') : String(cell.value));
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

/** @param {Object<string, number>} [totals] - fixed total per 1-based column (instead of a SUM formula),
 *  for pages whose total skips some rows (e.g. Loss Amount leaves settled entries out). */
function addGrandTotalRow(ws, ncol, dataRowCount, profile, outflowSet, amountSet, fillGrandTotal, grandTotalLabel, amountNumFmt, totals) {
	if (dataRowCount <= 0 || profile.skipGrandTotal) return;
	const dataStartRow = 2;
	const dataEndRow = 1 + dataRowCount;
	const totalRowNum = dataEndRow + 1;
	const labelCols = profile.labelCols || 1;
	const amountAlign = { vertical: 'middle', horizontal: 'right', indent: 1, wrapText: false }; // see bodyAlignment
	const grandTotalBorder = {
		top: { style: 'medium', color: { argb: 'FF333333' } },
		left: { style: 'thin', color: { argb: 'FF666666' } },
		bottom: { style: 'thin', color: { argb: 'FF666666' } },
		right: { style: 'thin', color: { argb: 'FF666666' } }
	};

	const totalRow = ws.addRow(Array.from({ length: ncol }, () => null));

	const noSumSet = new Set(profile.noSumCols || []);
	profile.amountCols.forEach((col1) => {
		if (!amountSet.has(col1) || noSumSet.has(col1)) return;
		const letter = ws.getColumn(col1).letter;
		const range = letter + dataStartRow + ':' + letter + dataEndRow;
		const sumExpr = isOutflowCol(col1, outflowSet) ? 'ABS(SUM(' + range + '))' : 'SUM(' + range + ')';
		const cell = totalRow.getCell(col1);
		const fixed = totals && totals[col1] != null && Number.isFinite(Number(totals[col1])) ? Number(totals[col1]) : null;
		cell.value = fixed != null ? fixed : { formula: sumExpr };
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
	labelCell.alignment = profile.grandTotalAlign === 'center'
		? { vertical: 'middle', horizontal: 'center', wrapText: !profile.noWrap }
		: { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: !profile.noWrap };

	for (let col1 = 1; col1 <= ncol; col1++) {
		const cell = totalRow.getCell(col1);
		cell.font = { bold: true, size: 11 };
		cell.fill = fillGrandTotal;
		cell.border = grandTotalBorder;
		if (!cell.alignment) {
			cell.alignment = col1 <= labelCols
				? labelCell.alignment
				: { vertical: 'middle', horizontal: 'center', wrapText: !profile.noWrap };
		}
	}

	totalRow.height = 24;
}

/** "2026-10-09 21:01" → { value: Date, numFmt: 'yyyy-mm-dd hh:mm' }, "2026-10-09" → 'yyyy-mm-dd',
 *  "2026-10" → 'yyyy-mm' (only when allowMonth); anything else → null. */
function toExcelDate(raw, allowMonth) {
	const s = String(raw == null ? '' : raw).trim();
	let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
	if (m) return { value: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))), numFmt: 'yyyy-mm-dd hh:mm' };
	m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (m) return { value: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), numFmt: 'yyyy-mm-dd' };
	m = allowMonth ? /^(\d{4})-(\d{2})$/.exec(s) : null;
	if (m) return { value: new Date(Date.UTC(+m[1], +m[2] - 1, 1)), numFmt: 'yyyy-mm' };
	return null;
}

function applyExportNumericFormats(ws, amountSet, percentSet, lastRowNum, amountNumFmt, plainNumberSet) {
	const numFmt = amountNumFmt || AMOUNT_FMT;
	ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
		if (rowNumber <= 1 || rowNumber > lastRowNum) return;
		row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
			if (cell.numFmt && /%/.test(String(cell.numFmt))) return;
			if (plainNumberSet && plainNumberSet.has(colNumber)) return;
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
		// bold header: ~10% wider than body text
		let m = profile.noWrap ? measuredTextWidth(headerText) * 1.1 : displayWidth(headerText);
		for (let ri = 0; ri < rows.length; ri++) {
			const row = rows[ri];
			if (!Array.isArray(row) || row[c] == null) continue;
			// a number shows with separators and "( )": "(7,626,670)", not "-7626670"
			const shown = typeof row[c] === 'number'
				? '(' + Math.round(Math.abs(row[c])).toLocaleString('en-US') + ')'
				: row[c];
			const L = profile.noWrap ? measuredTextWidth(shown) : displayWidth(shown);
			if (L > m) m = L;
		}
		if (dataRowCount > 0 && c === 0) {
			m = Math.max(m, profile.noWrap ? measuredTextWidth(grandTotalLabel) * 1.1 : displayWidth(grandTotalLabel));
		}
		// one line per row: exactly as wide as the longest value, plus room for the cell padding / indent
		if (profile.noWrap) return Math.min(150, Math.ceil(m) + 3);
		let minWidth = 11;
		// no wrapping: a capped column would cut the text off
		let maxWidth = profile.noWrap ? 150 : (profile.zebraRows ? 52 : 60);
		if (upperHeader.includes('DESCRIPTION')) {
			minWidth = 24;
			maxWidth = Math.max(maxWidth, 100);
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
		// Character count under-measures wide capitals (W, M, G, O…) in Calibri: without the extra 10%
		// names like "HWANG SEUNGHO" wrapped onto a hidden second line.
		return Math.min(maxWidth, Math.max(minWidth, Math.ceil(m * 1.1) + 4));
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
		totals,
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
	const dateSet = new Set(profile.dateCols || []);
	const plainNumberSet = new Set(profile.plainNumberCols || []);
	const amountNumFmt = profile.amountNumFmt || AMOUNT_FMT;
	const grandTotalLabel = profile.grandTotalLabel || 'GRAND TOTAL';
	const totalColIndex = profile.highlightTotalCol ? findTotalColIndex(headerStrings) : -1;

	const workbook = new ExcelJS.Workbook();
	const wsTitle = sanitizeSheetName(sheetName) || 'Export';
	const ws = workbook.addWorksheet(wsTitle, {
		views: [{ state: 'frozen', ySplit: 1 }]
	});

	const headerRow = ws.addRow(headerStrings);
	// taller when a profile's fixed widths make long headers wrap onto two lines
	headerRow.height = profile.headerHeight || 22;
	headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
		const colIdx = colNumber - 1;
		cell.font = { bold: true };
		cell.alignment = bodyAlignment(colNumber - 1, profile, amountSet, leftSet, centerSet);
		if (profile.zebraRows || profile.highlightTotalCol || profile.centerHeaders) {
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: !profile.noWrap };
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
		const isBoldRow = !!profile.boldRowLabel
			&& String(arr[0] == null ? '' : arr[0]).trim().toUpperCase() === String(profile.boldRowLabel).toUpperCase();
		for (let colNumber = 1; colNumber <= ncol; colNumber++) {
			const cell = dataRow.getCell(colNumber);
			const colIdx = colNumber - 1;
			cell.border = THIN_BORDER;
			if (isBoldRow) cell.font = { bold: true };
			cell.alignment = bodyAlignment(colNumber - 1, profile, amountSet, leftSet, centerSet);
			if (profile.highlightTotalCol && colIdx === totalColIndex) {
				cell.fill = FILL_TOTAL_BAND;
			} else if (profile.zebraRows && rowIdx % 2 === 1) {
				cell.fill = FILL_ZEBRA;
			}
			// Date / date & time text stays a date / date & time in Excel. Outside the profile's dateCols
			// only a full "YYYY-MM-DD[ HH:mm]" is taken (a bare "YYYY-MM" there may not be a month).
			const isDateCol = dateSet.has(colNumber);
			if (isDateCol || (!amountSet.has(colNumber) && !percentSet.has(colNumber))) {
				const date = toExcelDate(arr[colNumber - 1], isDateCol);
				if (date) {
					cell.value = date.value;
					cell.numFmt = date.numFmt;
				}
			}
			if (plainNumberSet.has(colNumber) && typeof cell.value === 'number') {
				cell.numFmt = '0';
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
		addGrandTotalRow(ws, ncol, dataRowCount, profile, outflowSet, amountSet, FILL_GRAND_TOTAL, grandTotalLabel, amountNumFmt, totals);
	}

	// A profile may fix the widths (balanced columns, long text wraps); otherwise size to content
	const colWidths = profile.columnWidths && profile.columnWidths.length === ncol
		? profile.columnWidths
		: computeColumnWidths(headerStrings, rows, dataRowCount, profile, grandTotalLabel);
	for (let i = 1; i <= ncol; i++) {
		ws.getColumn(i).width = colWidths[i - 1];
	}

	const lastRowNum = dataRowCount > 0 && !profile.skipGrandTotal ? dataRowCount + 2 : Math.max(1, dataRowCount + 1);
	autoFitRowHeights(ws, 2, lastRowNum);
	applyExportNumericFormats(ws, amountSet, percentSet, lastRowNum, amountNumFmt, plainNumberSet);

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
