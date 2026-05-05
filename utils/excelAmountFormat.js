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

module.exports = { applyCommaThousandsToNumericCells };
