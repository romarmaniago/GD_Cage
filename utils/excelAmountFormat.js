/**
 * Excel `#,##0.##` can show a stray "." after whole numbers. Use integer vs 2-decimal formats instead.
 * @param {number} v
 * @returns {string}
 */
function numberFormatForValue(v) {
	if (typeof v !== 'number' || !Number.isFinite(v)) return '#,##0.00';
	const r = Math.round(v * 1e6) / 1e6;
	if (Math.abs(r - Math.round(r)) < 1e-9) {
		return '#,##0';
	}
	return '#,##0';
}

/**
 * Apply Excel number formats so amounts show thousand separators (commas) without a trailing dot.
 * Integers: `#,##0` (e.g. 59, 3,000). Fractions: `#,##0.00`. Skips % cells.
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {object} [opts]
 * @param {number} [opts.headerRows=1]
 * @param {string} [opts.numFmt] - If set, every numeric cell uses this (overrides per-value formats)
 */
function applyCommaThousandsToNumericCells(ws, opts) {
	opts = opts || {};
	const headerRows = opts.headerRows != null ? opts.headerRows : 1;
	const fixedFmt = opts.numFmt != null && opts.numFmt !== '' ? opts.numFmt : null;

	ws.eachRow({ includeEmpty: false }, function (row, rowNumber) {
		if (rowNumber <= headerRows) return;
		row.eachCell({ includeEmpty: false }, function (cell) {
			const existingFmt = cell.numFmt != null ? String(cell.numFmt) : '';
			if (existingFmt && /%/.test(existingFmt)) return;
			const v = cell.value;
			if (typeof v === 'number' && Number.isFinite(v)) {
				cell.numFmt = fixedFmt != null ? fixedFmt : numberFormatForValue(v);
			}
		});
	});
}

function excelDisplayWidth(value) {
	return Array.from(String(value == null ? '' : value).replace(/\r?\n/g, ' ')).reduce((sum, ch) => {
		return sum + (ch.charCodeAt(0) > 255 ? 2 : 1);
	}, 0);
}

function excelCellDisplayText(cell) {
	const v = cell.value;
	if (v == null) return '';
	if (typeof v === 'object' && v.formula) return '';
	if (typeof v === 'number' && Number.isFinite(v)) {
		const r = Math.round(v * 1e6) / 1e6;
		if (Math.abs(r - Math.round(r)) < 1e-9) {
			return Math.round(r).toLocaleString('en-US');
		}
		return r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}
	return String(v).replace(/\r?\n/g, ' ');
}

/**
 * Set column widths from the widest cell in each column (CJK counts double).
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {object} [opts]
 * @param {number} [opts.minWidth=8]
 * @param {number} [opts.maxWidth=80]
 * @param {number} [opts.padding=4]
 * @param {number} [opts.startRow=1]
 * @param {number} [opts.endRow]
 * @param {boolean} [opts.boldExtra=1] - extra width when cell font is bold
 */
function autoFitExcelWorksheetColumns(ws, opts) {
	opts = opts || {};
	const minWidth = opts.minWidth != null ? opts.minWidth : 8;
	const maxWidth = opts.maxWidth != null ? opts.maxWidth : 80;
	const padding = opts.padding != null ? opts.padding : 4;
	const boldExtra = opts.boldExtra != null ? opts.boldExtra : 1;
	const startRow = opts.startRow != null ? opts.startRow : 1;
	const endRow = opts.endRow != null ? opts.endRow : ws.rowCount;

	const colMax = new Map();
	for (let rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
		const row = ws.getRow(rowNumber);
		if (!row) continue;
		row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
			const text = excelCellDisplayText(cell);
			if (!text) return;
			let w = excelDisplayWidth(text);
			if (cell.font && cell.font.bold) w += boldExtra;
			colMax.set(colNumber, Math.max(colMax.get(colNumber) || 0, w));
		});
	}

	colMax.forEach((maxLen, colNumber) => {
		ws.getColumn(colNumber).width = Math.min(maxWidth, Math.max(minWidth, maxLen + padding));
	});
}

module.exports = {
	applyCommaThousandsToNumericCells,
	numberFormatForValue,
	autoFitExcelWorksheetColumns
};
