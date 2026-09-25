const path = require('path');
const ExcelJS = require('exceljs');

const AMOUNT_FMT = '#,##0;[Red](#,##0)';

const THIN_BORDER = {
	top: { style: 'thin', color: { argb: 'FF666666' } },
	left: { style: 'thin', color: { argb: 'FF666666' } },
	bottom: { style: 'thin', color: { argb: 'FF666666' } },
	right: { style: 'thin', color: { argb: 'FF666666' } }
};

const FILL_START = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } };
const FILL_GAME_INFO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
const FILL_ADD_CHARGE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
const FILL_TOTAL_SETTLE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
const FILL_FINISH = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9D18E' } };
const FILL_PLAIN_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const FILL_GRAND_TOTAL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };

// Same visual template as the Game Information grouped export (Start / Game Information /
// Add Charge / Total Settle / Finish), so both exports read the same way. Commission has no
// Program End field, so the Finish group is just Game End.
const COLUMNS = [
	{ key: 'program_date', header: 'Program', group: 'Start', fill: FILL_START },
	{ key: 'game_start', header: 'Game', group: 'Start', fill: FILL_START },
	{ key: 'acc', header: 'Acc', group: 'Game Information', fill: FILL_GAME_INFO, leftAlign: true },
	{ key: 'guest_name', header: 'Guest', group: 'Game Information', fill: FILL_GAME_INFO, leftAlign: true },
	{ key: 'membership_no', header: 'Membership', group: 'Game Information', fill: FILL_GAME_INFO, leftAlign: true },
	{ key: 'game_type', header: 'Type', group: 'Game Information', fill: FILL_GAME_INFO, leftAlign: true },
	{ key: 'game_rate', header: 'Game Rate', group: 'Game Information', fill: FILL_GAME_INFO },
	{ key: 'game_no', header: 'Game #', group: 'Game Information', fill: FILL_GAME_INFO, leftAlign: true },
	{ key: 'buyin', header: 'Buy In', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'cashout', header: 'Cash Out', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'winloss', header: 'W/L', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'rolling', header: 'Rolling', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'settlement', header: 'Settlement', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'add_charge', header: 'Add Charge', fill: FILL_ADD_CHARGE, amount: true },
	{ key: 'total_settle', header: 'Total Settle', fill: FILL_TOTAL_SETTLE, amount: true },
	{ key: 'game_end', header: 'Game End', group: 'Finish', fill: FILL_FINISH }
];

function displayWidth(value) {
	return Array.from(String(value == null ? '' : value)).reduce((sum, ch) => {
		return sum + (ch.charCodeAt(0) > 255 ? 2 : 1);
	}, 0);
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

/** Chronological, oldest first — matches the Commission screen: Program Date, then Game Start,
 *  then Game # ('YYYY-MM-DD' / 'YYYY-MM-DD HH:mm' strings, so a plain compare is chronological). */
function sortCommissionExportRows(rows) {
	return rows.slice().sort((a, b) => {
		const dateA = String((a && a.program_date) || '');
		const dateB = String((b && b.program_date) || '');
		if (dateA !== dateB) return dateA.localeCompare(dateB);
		const startA = String((a && a.game_start) || '');
		const startB = String((b && b.game_start) || '');
		if (startA !== startB) return startA.localeCompare(startB);
		const gameA = String((a && a.game_no) || '');
		const gameB = String((b && b.game_no) || '');
		return gameA.localeCompare(gameB, undefined, { numeric: true });
	});
}

/** Purely-numeric-looking strings ("300141802") get flagged by Excel's "number stored as
 *  text" warning (the green corner triangle) unless they're an actual Number. Values that
 *  aren't purely numeric (e.g. "-") are left as text, which Excel never flags. */
function numericOrText(value) {
	if (value == null || value === '') return '';
	const s = String(value).trim();
	return /^-?\d+$/.test(s) ? Number(s) : s;
}

function toRowValues(r) {
	return {
		program_date: r.program_date || '',
		game_start: r.game_start || '',
		acc: r.acc || '-',
		guest_name: r.guest_name || '-',
		membership_no: r.membership_no ? numericOrText(r.membership_no) : '-',
		game_type: r.game_type || '',
		game_rate: r.game_rate != null && r.game_rate !== '' ? Number(r.game_rate) / 100 : '',
		game_no: numericOrText(r.game_no),
		buyin: Number(r.buyin) || 0,
		cashout: Number(r.cashout) || 0,
		winloss: Number(r.winloss) || 0,
		rolling: Number(r.rolling) || 0,
		settlement: Number(r.settlement) || 0,
		add_charge: Number(r.add_charge) || 0,
		total_settle: Number(r.total_settle) || 0,
		game_end: r.game_end || ''
	};
}

/**
 * Builds the grouped-header Commission export (Start / Game Information / Add Charge /
 * Total Settle / Finish), matching the Game Information export's visual template.
 * @param {object} opts
 * @param {Array<object>} opts.rows - plain row objects captured from the on-screen table
 * @param {string} [opts.filename]
 * @param {number} [opts.maxRows=10000]
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function buildCommissionGroupedExportXlsx(opts) {
	const { rows, filename, maxRows = 10000 } = opts || {};

	if (!Array.isArray(rows)) {
		throw Object.assign(new Error('Invalid rows'), { status: 400 });
	}
	if (rows.length > maxRows) {
		throw Object.assign(new Error('Too many rows'), { status: 400 });
	}

	const sortedRows = sortCommissionExportRows(rows);
	const ncol = COLUMNS.length;
	const workbook = new ExcelJS.Workbook();
	const ws = workbook.addWorksheet('Commission', {
		views: [{ state: 'frozen', ySplit: 2 }]
	});

	// Build the two header rows, merging group cells horizontally and single-column
	// headers vertically across both rows.
	const headerRow1 = ws.getRow(1);
	const headerRow2 = ws.getRow(2);
	headerRow1.height = 20;
	headerRow2.height = 20;

	let col = 1;
	while (col <= ncol) {
		const meta = COLUMNS[col - 1];
		if (meta.group) {
			let span = 1;
			while (col + span <= ncol && COLUMNS[col + span - 1].group === meta.group) span++;
			if (span > 1) {
				ws.mergeCells(1, col, 1, col + span - 1);
			}
			headerRow1.getCell(col).value = meta.group;
			for (let c = col; c < col + span; c++) {
				headerRow2.getCell(c).value = COLUMNS[c - 1].header;
			}
			col += span;
		} else {
			ws.mergeCells(1, col, 2, col);
			headerRow1.getCell(col).value = meta.header;
			col += 1;
		}
	}

	for (let c = 1; c <= ncol; c++) {
		[headerRow1.getCell(c), headerRow2.getCell(c)].forEach((cell) => {
			cell.font = { bold: true };
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			cell.border = THIN_BORDER;
			cell.fill = COLUMNS[c - 1].fill || FILL_PLAIN_HEADER;
		});
	}

	const rowValueMaps = sortedRows.map(toRowValues);
	rowValueMaps.forEach((v) => {
		const rowValues = COLUMNS.map((meta) => v[meta.key]);
		const dataRow = ws.addRow(rowValues);
		COLUMNS.forEach((meta, idx) => {
			const cell = dataRow.getCell(idx + 1);
			cell.border = THIN_BORDER;
			if (meta.key === 'game_rate') {
				cell.numFmt = '0.00%';
				cell.alignment = { vertical: 'middle', horizontal: 'center' };
			} else if (meta.amount) {
				cell.numFmt = AMOUNT_FMT;
				cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
			} else if (meta.leftAlign) {
				cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
			} else {
				cell.alignment = { vertical: 'middle', horizontal: 'center' };
			}
		});
	});

	const dataRowCount = sortedRows.length;
	if (dataRowCount > 0) {
		const dataStartRow = 3;
		const dataEndRow = 2 + dataRowCount;
		const totalRowNum = dataEndRow + 1;
		const labelCols = 8; // through Game #
		const totalRow = ws.getRow(totalRowNum);

		ws.mergeCells(totalRowNum, 1, totalRowNum, labelCols);
		const labelCell = totalRow.getCell(1);
		labelCell.value = 'Grand Total';
		labelCell.alignment = { vertical: 'middle', horizontal: 'center' };

		COLUMNS.forEach((meta, idx) => {
			if (!meta.amount) return;
			const col1 = idx + 1;
			const letter = ws.getColumn(col1).letter;
			const range = letter + dataStartRow + ':' + letter + dataEndRow;
			const cell = totalRow.getCell(col1);
			cell.value = { formula: 'SUM(' + range + ')' };
			cell.numFmt = AMOUNT_FMT;
			cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
		});

		for (let c = 1; c <= ncol; c++) {
			const cell = totalRow.getCell(c);
			cell.font = { bold: true };
			cell.fill = FILL_GRAND_TOTAL;
			cell.border = THIN_BORDER;
			if (!cell.alignment) cell.alignment = { vertical: 'middle', horizontal: 'center' };
		}
		totalRow.height = 20;
	}

	COLUMNS.forEach((meta, idx) => {
		var maxLen = displayWidth(meta.header);
		rowValueMaps.forEach((v) => {
			var val = v[meta.key];
			var len = displayWidth(meta.amount ? Number(val).toLocaleString('en-US') : val);
			if (len > maxLen) maxLen = len;
		});
		if (dataRowCount > 0 && meta.key === 'program_date') {
			maxLen = Math.max(maxLen, displayWidth('Grand Total'));
		}
		var minWidth = meta.amount ? 11 : 10;
		var width = Math.max(minWidth, maxLen + 3);
		ws.getColumn(idx + 1).width = width;
	});

	const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
	const outName = sanitizeFilename(filename, 'Commission-export.xlsx');
	return { buffer, filename: outName };
}

module.exports = {
	buildCommissionGroupedExportXlsx
};
