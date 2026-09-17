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

// column1 -> { header, group, fill, amount }
const COLUMNS = [
	{ key: 'program_date', header: 'Program', group: 'Start', fill: FILL_START },
	{ key: 'game_start', header: 'Game', group: 'Start', fill: FILL_START },
	{ key: 'acc_group', header: 'Acc & Group', group: 'Game Information', fill: FILL_GAME_INFO, leftAlign: true },
	{ key: 'guest_name', header: 'Name', group: 'Game Information', fill: FILL_GAME_INFO },
	{ key: 'membership_no', header: 'Membership', group: 'Game Information', fill: FILL_GAME_INFO },
	{ key: 'game_type', header: 'Type', group: 'Game Information', fill: FILL_GAME_INFO, leftAlign: true },
	{ key: 'game_rate', header: 'Game Rate', group: 'Game Information', fill: FILL_GAME_INFO },
	{ key: 'game_id_label', header: 'Game #', group: 'Game Information', fill: FILL_GAME_INFO, leftAlign: true },
	{ key: 'buyin', header: 'Buy In', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'cashout', header: 'Cash Out', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'winloss', header: 'W/L', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'rolling', header: 'Rolling', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'settlement', header: 'Settlement', group: 'Game Information', fill: FILL_GAME_INFO, amount: true },
	{ key: 'fnb', header: 'F&B', group: 'Add Charge', fill: FILL_ADD_CHARGE, amount: true },
	{ key: 'hotel', header: 'Hotel', group: 'Add Charge', fill: FILL_ADD_CHARGE, amount: true },
	{ key: 'incidental', header: 'Incidental', group: 'Add Charge', fill: FILL_ADD_CHARGE, amount: true },
	{ key: 'total_settle', header: 'Total Settle', fill: FILL_TOTAL_SETTLE, amount: true },
	{ key: 'roller_chips', header: 'Rolling Chips', fill: FILL_PLAIN_HEADER, amount: true },
	{ key: 'program_end', header: 'Program End', group: 'Finish', fill: FILL_FINISH },
	{ key: 'game_end', header: 'Game End', group: 'Finish', fill: FILL_FINISH },
	{ key: 'note', header: 'Note', group: 'Memo', fill: FILL_PLAIN_HEADER },
	{ key: 'settled_label', header: '정산', group: 'Memo', fill: FILL_PLAIN_HEADER }
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

const DEFAULT_GROUP_NAME = 'main';

/** Main always first, then everything else alphabetically — matches the Manage Groups list order. */
function sortGameBookExportRows(rows) {
	return rows.slice().sort((a, b) => {
		const nameA = String((a && a.group_name) || 'Main').trim();
		const nameB = String((b && b.group_name) || 'Main').trim();
		const isMainA = nameA.toLowerCase() === DEFAULT_GROUP_NAME;
		const isMainB = nameB.toLowerCase() === DEFAULT_GROUP_NAME;
		if (isMainA !== isMainB) return isMainA ? -1 : 1;
		const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
		if (nameCmp !== 0) return nameCmp;
		// Same group — break ties by Game Start (both are 'YYYY-MM-DD HH:mm' strings, so
		// a plain string compare sorts chronologically).
		const startA = String((a && a.game_start) || '');
		const startB = String((b && b.game_start) || '');
		return startA.localeCompare(startB);
	});
}

/** Purely-numeric-looking strings ("300141802") get flagged by Excel's "number stored as
 *  text" warning (the green corner triangle) unless they're an actual Number. Values that
 *  aren't purely numeric (e.g. "90045 (90044)" or "-") are left as text, which Excel never
 *  flags. */
function numericOrText(value) {
	if (value == null || value === '') return '';
	const s = String(value).trim();
	return /^-?\d+$/.test(s) ? Number(s) : s;
}

function toRowValues(r) {
	const code = r.agent_code || '';
	const group = r.group_name || 'Main';
	return {
		program_date: r.program_date || '',
		game_start: r.game_start || '',
		acc_group: code ? code + ' (' + group + ')' : '',
		guest_name: r.guest_name || '-',
		membership_no: r.membership_no ? numericOrText(r.membership_no) : '-',
		game_type: r.game_type || '',
		game_rate: r.commission_percentage != null && r.commission_percentage !== '' ? Number(r.commission_percentage) / 100 : '',
		game_id_label: numericOrText(r.game_id_label),
		buyin: Number(r.buyin) || 0,
		cashout: Number(r.cashout) || 0,
		winloss: Number(r.winloss) || 0,
		rolling: Number(r.rolling) || 0,
		settlement: Number(r.settlement) || 0,
		fnb: Number(r.fnb) || 0,
		hotel: Number(r.hotel) || 0,
		incidental: Number(r.incidental) || 0,
		total_settle: Number(r.total_settle) || 0,
		roller_chips: Number(r.roller_chips) || 0,
		program_end: r.program_end || '',
		game_end: r.game_end || '',
		note: r.note || '-',
		settled_label: r.settled ? 'O' : 'X'
	};
}

/**
 * Builds the grouped-header Game Book export (Start / Game Information / Add Charge /
 * Total Settle / Rolling Chips / Finish / Memo), matching the reference template.
 * @param {object} opts
 * @param {Array<object>} opts.rows - plain row objects, see captureGameListExportRow (client)
 * @param {string} [opts.filename]
 * @param {number} [opts.maxRows=10000]
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function buildGameBookGroupedExportXlsx(opts) {
	const { rows, filename, maxRows = 10000 } = opts || {};

	if (!Array.isArray(rows)) {
		throw Object.assign(new Error('Invalid rows'), { status: 400 });
	}
	if (rows.length > maxRows) {
		throw Object.assign(new Error('Too many rows'), { status: 400 });
	}

	const sortedRows = sortGameBookExportRows(rows);
	const ncol = COLUMNS.length;
	const workbook = new ExcelJS.Workbook();
	const ws = workbook.addWorksheet('Game Book', {
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
	const outName = sanitizeFilename(filename, 'Gamebook-export.xlsx');
	return { buffer, filename: outName };
}

module.exports = {
	buildGameBookGroupedExportXlsx
};
