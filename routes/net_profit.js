/**

 * Business net profit — **per program date** (one table row per day).
 *
 * - Games: game_list.PROGRAM_DATE
 *
 * - Expenses: expense_daily_settlement.SETTLEMENT_DATE (items → junket_house_expense).
 *
 * - House expenses not yet in expense_daily_settlement_items are rolled into **server today** when today falls in the selected range.
 *
 * Chip / commission formulas match public/assets/js/functions/game_list.js.
 *
 * Share uses a saved percentage per program date, defaulting to DEFAULT_NET_PROFIT_SHARE_PCT.

 */



const express = require('express');

const router = express.Router();

const pool = require('../config/db');

const { checkSession, sessions } = require('./auth');

/** Super Admin only — same as elsewhere (`permissions === 0`). */
function requireSuperAdmin(req, res, next) {
	const p = req.session.permissions;
	if (p !== 0 && p !== '0') {
		if (req.xhr || (req.headers.accept && String(req.headers.accept).includes('application/json'))) {
			return res.status(403).json({ success: false, error: 'Forbidden' });
		}
		return res.status(403).send('Forbidden');
	}
	next();
}

const superAdminOnly = [checkSession, requireSuperAdmin];

const { buildTableExportXlsx, sendTableExportResponse, sanitizeSheetName } = require('../utils/ExcelExportService');
const {
	DEFAULT_NET_PROFIT_SHARE_PCT,
	NET_PROFIT_SHARE_TABLE,
	pad2,
	ceilAmount,
	serverTodayStr,
	isValidYmd,
	normalizeSharePercentage,
	computeNetProfitRows,
	aggregateRowsByMonth,
} = require('../utils/netProfitCalc');

const MAX_RANGE_DAYS = 400;

function currentMonthRangeStr() {

	const range = require('../utils/monthEndCutoffRange').getMonthEndCutoffRange();

	return { start: range.startDate, end: range.endDateApi || range.endDate };

}



function isValidMonthKey(mk) {
	if (typeof mk !== 'string' || !/^\d{4}-\d{2}$/.test(mk)) return false;
	const m = Number(mk.slice(5, 7));
	return Number.isFinite(m) && m >= 1 && m <= 12;
}



function calendarDatesInMonth(monthKey) {
	const y = Number(monthKey.slice(0, 4));
	const m = Number(monthKey.slice(5, 7));
	const dim = new Date(y, m, 0).getDate();
	const out = [];
	for (let d = 1; d <= dim; d += 1) {
		out.push(`${y}-${pad2(m)}-${pad2(d)}`);
	}
	return out;
}



async function upsertSharePercentage(programDate, sharePercentage, userId) {
	await pool.execute(
		`INSERT INTO \`${NET_PROFIT_SHARE_TABLE}\`
			(PROGRAM_DATE, SHARE_PERCENTAGE, ACTIVE, ENCODED_BY, ENCODED_DT)
		 VALUES (?, ?, 1, ?, NOW())
		 ON DUPLICATE KEY UPDATE
			SHARE_PERCENTAGE = VALUES(SHARE_PERCENTAGE),
			ACTIVE = 1,
			EDITED_BY = VALUES(ENCODED_BY),
			EDITED_DT = VALUES(ENCODED_DT)`,
		[programDate, sharePercentage, userId]
	);
}



function daySpanInclusive(startStr, endStr) {

	const a = new Date(`${startStr}T12:00:00`);

	const b = new Date(`${endStr}T12:00:00`);

	if (a > b) return 0;

	return Math.floor((b - a) / 86400000) + 1;

}



// monthKeyFromYmd, formatMonthLabel, aggregateRowsByMonth now live in utils/netProfitCalc.js
// (shared with routes/api.js's monthly statistics endpoint).



// computeGameMetrics, loadSharePercentagesByDay, normalizeSharePercentage, fetchRecordsForGames,
// loadGamesInDateRange, loadDistinctProgramDatesInRange, loadExpenseTotalsByDay,
// loadUnsettledHouseExpenseTotal, loadUnsettledGamesForLive now live in utils/netProfitCalc.js
// (shared with routes/api.js GET /api/dashboard-summary).



router.get('/net_profit', superAdminOnly, async (req, res) => {

	try {

		const todayStr = serverTodayStr();

		const defaultRange = currentMonthRangeStr();

		const data = sessions(req, 'net_profit');

		data.permissions = req.session.permissions || 0;

		data.todayStr = todayStr;

		data.defaultRangeStart = defaultRange.start;

		data.defaultRangeEnd = defaultRange.end;

		data.netProfitHouseSharePct = DEFAULT_NET_PROFIT_SHARE_PCT;

		res.render('junket/net_profit', data);

	} catch (err) {

		console.error('net_profit page:', err);

		res.status(500).send('Error loading page');

	}

});



router.get('/net_profit_data', superAdminOnly, async (req, res) => {

	try {

		const todayStr = serverTodayStr();



		let start = String(req.query.start || '').trim();

		let end = String(req.query.end || '').trim();

		const viewRaw = String(req.query.view || 'monthly').trim().toLowerCase();

		const view = viewRaw === 'daily' ? 'daily' : 'monthly';

		if (!isValidYmd(start) || !isValidYmd(end)) {

			const defaultRange = currentMonthRangeStr();

			start = defaultRange.start;

			end = defaultRange.end;

		}

		if (start > end) {

			const t = start;

			start = end;

			end = t;

		}

		const spanDays = daySpanInclusive(start, end);

		if (spanDays > MAX_RANGE_DAYS) {

			return res.status(400).json({

				success: false,

				error: `Ang range ay hanggang ${MAX_RANGE_DAYS} araw lang.`,

			});

		}



		// Shared with routes/api.js GET /api/dashboard-summary — see utils/netProfitCalc.js.
		const rowsAsc = await computeNetProfitRows(start, end);



		const displayRowsAsc = view === 'monthly' ? aggregateRowsByMonth(rowsAsc) : rowsAsc;

		const rows = displayRowsAsc.slice().reverse();



		const range_totals = rowsAsc.reduce(

			(acc, r) => {

				acc.game_count += r.game_count;

				acc.win_loss += r.win_loss;

				acc.casino_share += r.casino_share;

				acc.commission += r.commission;

				acc.house_expenses_settled += r.house_expenses_settled;

				acc.grand_net_profit += r.grand_net_profit;

				return acc;

			},

			{

				game_count: 0,

				win_loss: 0,

				casino_share: 0,

				commission: 0,

				house_expenses_settled: 0,

				grand_net_profit: 0,

			}

		);

		range_totals.win_loss = ceilAmount(range_totals.win_loss);

		range_totals.casino_share = ceilAmount(range_totals.casino_share);

		range_totals.house_expenses_settled = ceilAmount(range_totals.house_expenses_settled);

		range_totals.grand_net_profit = ceilAmount(range_totals.grand_net_profit);

		range_totals.commission = ceilAmount(range_totals.commission);
		const sharePercentages = rowsAsc.map((r) => Number(r.share_percentage)).filter(Number.isFinite);
		const firstSharePercentage = sharePercentages[0];
		range_totals.share_percentage =
			sharePercentages.length > 0 && sharePercentages.every((pct) => pct === firstSharePercentage)
				? firstSharePercentage
				: null;



		res.json({

			success: true,

			mode: 'range',

			view,

			start,

			end,

			server_today: todayStr,

			house_share_pct: DEFAULT_NET_PROFIT_SHARE_PCT,

			rows,

			range_totals,

		});

	} catch (err) {

		console.error('net_profit_data:', err);

		res.status(500).json({ success: false, error: 'Error computing net profit' });

	}

});



router.post('/net_profit/share_percentage', superAdminOnly, async (req, res) => {
	try {
		const programDate = String(req.body?.program_date || '').trim();
		const sharePercentage = normalizeSharePercentage(req.body?.share_percentage);

		if (!isValidYmd(programDate)) {
			return res.status(400).json({ success: false, error: 'Invalid program date' });
		}
		if (sharePercentage == null) {
			return res.status(400).json({ success: false, error: 'Share percentage must be between 0 and 100' });
		}

		const userId = req.session.user_id || null;
		await upsertSharePercentage(programDate, sharePercentage, userId);

		res.json({ success: true, program_date: programDate, share_percentage: sharePercentage });
	} catch (err) {
		console.error('net_profit/share_percentage:', err);
		res.status(500).json({ success: false, error: 'Error saving share percentage' });
	}
});



router.post('/net_profit/share_percentage/month', superAdminOnly, async (req, res) => {
	try {
		const monthKey = String(req.body?.month || req.body?.month_key || '').trim();
		const sharePercentage = normalizeSharePercentage(req.body?.share_percentage);

		if (!isValidMonthKey(monthKey)) {
			return res.status(400).json({ success: false, error: 'Invalid month' });
		}
		if (sharePercentage == null) {
			return res.status(400).json({ success: false, error: 'Share percentage must be between 0 and 100' });
		}

		const userId = req.session.user_id || null;
		const dates = calendarDatesInMonth(monthKey);
		for (const programDate of dates) {
			await upsertSharePercentage(programDate, sharePercentage, userId);
		}

		res.json({
			success: true,
			month: monthKey,
			days_updated: dates.length,
			share_percentage: sharePercentage,
		});
	} catch (err) {
		console.error('net_profit/share_percentage/month:', err);
		res.status(500).json({ success: false, error: 'Error saving share percentage for month' });
	}
});



router.post('/net_profit/export_xlsx', superAdminOnly, async function (req, res) {
	try {
		const { headers, rows, filename, sheetName } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'netProfit',
			sheetName: sanitizeSheetName(sheetName) || 'Net profit',
			headers,
			rows,
			filename: filename || 'NetProfit-export.xlsx',
			maxRows: 2000
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('net_profit/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

router.get('/business_net_profit', superAdminOnly, (req, res) => {

	res.redirect(301, '/net_profit');

});



router.get('/business_net_profit_data', superAdminOnly, (req, res) => {

	const i = req.url.indexOf('?');

	res.redirect(301, '/net_profit_data' + (i >= 0 ? req.url.slice(i) : ''));

});



module.exports = router;


