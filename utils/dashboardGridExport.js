const ExcelJS = require('exceljs');
const { sanitizeFilename } = require('./ExcelExportService');

const AMOUNT_FMT = '#,##0;[Red](#,##0)';
const AMOUNT_FMT_UNSIGNED = '#,##0';

const BORDER = {
	top: { style: 'thin', color: { argb: 'FF000000' } },
	left: { style: 'thin', color: { argb: 'FF000000' } },
	bottom: { style: 'thin', color: { argb: 'FF000000' } },
	right: { style: 'thin', color: { argb: 'FF000000' } }
};

const BORDER_DOT = {
	top: { style: 'dotted', color: { argb: 'FF000000' } },
	left: { style: 'dotted', color: { argb: 'FF000000' } },
	bottom: { style: 'dotted', color: { argb: 'FF000000' } },
	right: { style: 'dotted', color: { argb: 'FF000000' } }
};

const FILL = {
	title: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4A460' } },
	date: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } },
	casino: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
	gold: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
	diff: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } },
	remarks: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } },
	total: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
	today: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
};

function toDisplayDate(iso) {
	if (!iso) return '';
	const parts = String(iso).split('-');
	if (parts.length !== 3) return String(iso);
	return `${+parts[1]}/${+parts[2]}`;
}

function todayIso() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function numOrBlank(value) {
	const n = Number(value);
	if (!Number.isFinite(n) || n === 0) return '';
	return Math.round(n);
}

function numOrZero(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.round(n);
}

function buildRollingAutoRemarks(row) {
	const tags = [];
	if (Number(row.buy_in) > 0) tags.push('BI');
	if (Number(row.cash_out) > 0) tags.push('CO');
	if (Number(row.rolling_cc) > 0) tags.push('R');
	return tags.join(',');
}

function formatRollingRemarks(row) {
	const auto = buildRollingAutoRemarks(row);
	const saved = String(row.remarks_saved || '').trim();
	if (auto && saved) return `${auto} | ${saved}`;
	if (saved) return saved;
	return auto;
}

function styleCell(cell, opts = {}) {
	const {
		fill,
		bold = false,
		align = 'center',
		border = BORDER_DOT,
		numFmt = null
	} = opts;
	cell.border = border;
	if (fill) cell.fill = fill;
	cell.font = { bold, size: 10 };
	cell.alignment = {
		vertical: 'middle',
		horizontal: align,
		wrapText: false
	};
	if (numFmt) cell.numFmt = numFmt;
}

function applyDataRowStyle(row, colCount, todayDate, isTotal = false) {
	const isToday = !isTotal && row.getCell(1).value === toDisplayDate(todayDate);
	row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
		const fill = isTotal ? FILL.total : (isToday ? FILL.today : null);
		const align = colNumber === 1 || colNumber === colCount ? 'center' : 'right';
		const bold = isTotal;
		styleCell(cell, {
			fill,
			bold,
			align,
			border: BORDER_DOT,
			numFmt: colNumber > 1 && colNumber < colCount ? AMOUNT_FMT_UNSIGNED : null
		});
	});
}

async function buildDashboardRollingExportXlsx(rows, totals, opts = {}) {
	const workbook = new ExcelJS.Workbook();
	const ws = workbook.addWorksheet(opts.sheetName || 'Rolling Check', {
		views: [{ state: 'frozen', ySplit: 3 }]
	});

	ws.columns = [
		{ width: 8 },
		{ width: 14 },
		{ width: 14 },
		{ width: 14 },
		{ width: 14 },
		{ width: 12 }
	];

	const titleRow = ws.addRow(['Main Cage Rolling Check']);
	ws.mergeCells(1, 1, 1, 6);
	styleCell(titleRow.getCell(1), { fill: FILL.title, bold: true, align: 'center', border: BORDER });
	titleRow.height = 22;

	const headerRow2 = ws.addRow(['Date', 'Casino', '', '', 'Gold Dragon', 'Remarks']);
	const headerRow3 = ws.addRow(['', 'Buy In', 'Cash Out', 'Rolling', 'Beyond Chips', '']);

	ws.mergeCells(2, 2, 2, 4);
	ws.mergeCells(2, 1, 3, 1);
	ws.mergeCells(2, 6, 3, 6);

	styleCell(headerRow2.getCell(1), { fill: FILL.date, bold: true, border: BORDER });
	styleCell(headerRow2.getCell(2), { fill: FILL.casino, bold: true, border: BORDER });
	styleCell(headerRow2.getCell(5), { fill: FILL.gold, bold: true, border: BORDER });
	styleCell(headerRow2.getCell(6), { fill: FILL.remarks, bold: true, border: BORDER });
	styleCell(headerRow3.getCell(2), { fill: FILL.casino, bold: true, border: BORDER });
	styleCell(headerRow3.getCell(3), { fill: FILL.casino, bold: true, border: BORDER });
	styleCell(headerRow3.getCell(4), { fill: FILL.casino, bold: true, border: BORDER });
	styleCell(headerRow3.getCell(5), { fill: FILL.gold, bold: true, border: BORDER });
	headerRow2.height = 18;
	headerRow3.height = 18;

	const todayDate = todayIso();
	(rows || []).forEach((row) => {
		const dataRow = ws.addRow([
			toDisplayDate(row.date),
			numOrBlank(row.buy_in),
			numOrBlank(row.cash_out),
			numOrBlank(row.rolling),
			numOrBlank(row.beyond_chips),
			formatRollingRemarks(row)
		]);
		applyDataRowStyle(dataRow, 6, todayDate);
		dataRow.height = 15;
	});

	const t = totals || {};
	const totalRow = ws.addRow([
		'Total',
		numOrZero(t.buy_in),
		numOrZero(t.cash_out),
		numOrZero(t.rolling),
		numOrZero(t.beyond_chips),
		''
	]);
	applyDataRowStyle(totalRow, 6, todayDate, true);
	totalRow.height = 18;

	const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
	const filename = sanitizeFilename(
		opts.filename,
		`MainCageRollingCheck_${opts.dateFrom || ''}_${opts.dateTo || ''}.xlsx`
	);
	return { buffer, filename };
}

async function buildDashboardWlExportXlsx(rows, totals, opts = {}) {
	const workbook = new ExcelJS.Workbook();
	const ws = workbook.addWorksheet(opts.sheetName || 'WL Check', {
		views: [{ state: 'frozen', ySplit: 2 }]
	});

	ws.columns = [
		{ width: 8 },
		{ width: 14 },
		{ width: 14 },
		{ width: 14 },
		{ width: 12 }
	];

	const titleRow = ws.addRow(['W/L Check']);
	ws.mergeCells(1, 1, 1, 5);
	styleCell(titleRow.getCell(1), { fill: FILL.title, bold: true, align: 'center', border: BORDER });
	titleRow.height = 22;

	const headerRow = ws.addRow(['Date', 'Casino', 'Gold Dragon', 'The difference', 'Remarks']);
	styleCell(headerRow.getCell(1), { fill: FILL.date, bold: true, border: BORDER });
	styleCell(headerRow.getCell(2), { fill: FILL.casino, bold: true, border: BORDER });
	styleCell(headerRow.getCell(3), { fill: FILL.gold, bold: true, border: BORDER });
	styleCell(headerRow.getCell(4), { fill: FILL.diff, bold: true, border: BORDER });
	styleCell(headerRow.getCell(5), { fill: FILL.remarks, bold: true, border: BORDER });
	headerRow.height = 18;

	const todayDate = todayIso();
	(rows || []).forEach((row) => {
		const casino = numOrBlank(row.casino);
		const gold = numOrBlank(row.gold_dragon);
		const diff = (Number(row.casino) || 0) - (Number(row.gold_dragon) || 0);
		const hasCasinoData = (Number(row.casino) || 0) !== 0;
		const hasGoldData = (Number(row.gold_dragon) || 0) !== 0;
		const diffVal = (diff === 0 && !hasCasinoData && !hasGoldData) ? '' : Math.round(diff);
		const dataRow = ws.addRow([
			toDisplayDate(row.date),
			casino,
			gold,
			diffVal,
			String(row.remarks_saved || '').trim()
		]);
		const isToday = row.date === todayDate;
		dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
			const fill = isToday ? FILL.today : null;
			const align = colNumber === 1 || colNumber === 5 ? 'center' : 'right';
			styleCell(cell, {
				fill,
				align,
				border: BORDER_DOT,
				numFmt: colNumber >= 2 && colNumber <= 4 ? AMOUNT_FMT : null
			});
		});
		dataRow.height = 15;
	});

	const t = totals || {};
	const totalCasino = numOrZero(t.casino_wl);
	const totalGold = numOrZero(t.gold_dragon_wl);
	const totalDiff = totalCasino - totalGold;
	const totalRow = ws.addRow([
		'Total',
		totalCasino,
		totalGold,
		totalDiff,
		''
	]);
	totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
		const align = colNumber === 1 || colNumber === 5 ? 'center' : 'right';
		styleCell(cell, {
			fill: FILL.total,
			bold: true,
			align,
			border: BORDER_DOT,
			numFmt: colNumber >= 2 && colNumber <= 4 ? AMOUNT_FMT : null
		});
	});
	totalRow.height = 18;

	const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
	const filename = sanitizeFilename(
		opts.filename,
		`WLCheck_${opts.dateFrom || ''}_${opts.dateTo || ''}.xlsx`
	);
	return { buffer, filename };
}

async function buildDashboardGridExportXlsx(payload) {
	const kind = String(payload.kind || '').trim().toLowerCase();
	const opts = {
		filename: payload.filename,
		sheetName: payload.sheetName,
		dateFrom: payload.date_from,
		dateTo: payload.date_to
	};
	if (kind === 'wl') {
		return buildDashboardWlExportXlsx(payload.wl_rows || [], payload.totals || {}, opts);
	}
	return buildDashboardRollingExportXlsx(payload.rolling_rows || [], payload.totals || {}, opts);
}

module.exports = {
	buildDashboardGridExportXlsx,
	buildDashboardRollingExportXlsx,
	buildDashboardWlExportXlsx
};
