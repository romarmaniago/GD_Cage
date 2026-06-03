/**

 * Business net profit — **per settlement date** (one table row per day).

 * - Games: daily_settlement.SETTLEMENT_DATE (via daily_settlement_games.DAILY_SETTLEMENT_ID)

 * - Expenses: expense_daily_settlement.SETTLEMENT_DATE (items → junket_house_expense).

 * - House expenses not yet in expense_daily_settlement_items are rolled into **server today** when today falls in the selected range.

 * Chip / commission formulas match public/assets/js/functions/game_list.js.

 * Share uses a saved percentage per settlement date, defaulting to DEFAULT_NET_PROFIT_SHARE_PCT.

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

const path = require('path');
const ExcelJS = require('exceljs');
const { applyCommaThousandsToNumericCells } = require('../utils/excelAmountFormat');

const MAX_RANGE_DAYS = 400;

/** Default % for net profit share rows when no settlement-date override exists. */
const DEFAULT_NET_PROFIT_SHARE_PCT = 65;
const NET_PROFIT_SHARE_TABLE = 'net_profit_share_percentages';



function pad2(n) {

	return String(n).padStart(2, '0');

}



/** Whole currency/units — always round up (toward +∞). */
function ceilAmount(n) {
	const x = Number(n);
	if (!Number.isFinite(x)) return 0;
	return Math.ceil(x);
}



function serverTodayStr() {

	const now = new Date();

	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

}



function currentMonthRangeStr() {

	const now = new Date();

	const year = now.getFullYear();

	const month = now.getMonth();

	const start = `${year}-${pad2(month + 1)}-01`;

	const lastDay = new Date(year, month + 1, 0).getDate();

	const end = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;

	return { start, end };

}



function isValidYmd(d) {

	return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

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



async function upsertSharePercentage(settlementDate, sharePercentage, userId) {
	await pool.execute(
		`INSERT INTO \`${NET_PROFIT_SHARE_TABLE}\`
			(SETTLEMENT_DATE, SHARE_PERCENTAGE, ACTIVE, ENCODED_BY, ENCODED_DT)
		 VALUES (?, ?, 1, ?, NOW())
		 ON DUPLICATE KEY UPDATE
			SHARE_PERCENTAGE = VALUES(SHARE_PERCENTAGE),
			ACTIVE = 1,
			EDITED_BY = VALUES(ENCODED_BY),
			EDITED_DT = VALUES(ENCODED_DT)`,
		[settlementDate, sharePercentage, userId]
	);
}



function daySpanInclusive(startStr, endStr) {

	const a = new Date(`${startStr}T12:00:00`);

	const b = new Date(`${endStr}T12:00:00`);

	if (a > b) return 0;

	return Math.floor((b - a) / 86400000) + 1;

}



function monthKeyFromYmd(ymd) {

	return String(ymd || '').slice(0, 7);

}



function formatMonthLabel(monthKey) {

	const parts = String(monthKey || '').split('-');

	const y = Number(parts[0]);

	const m = Number(parts[1]);

	if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthKey;

	const dt = new Date(y, m - 1, 1);

	return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

}



/** Roll up per-day net profit rows into one row per calendar month (ascending). */
function aggregateRowsByMonth(rowsAsc) {

	const byMonth = new Map();

	for (const r of rowsAsc || []) {

		const mk = monthKeyFromYmd(r.settlement_date);

		if (!/^\d{4}-\d{2}$/.test(mk)) continue;

		if (!byMonth.has(mk)) {

			byMonth.set(mk, {

				game_count: 0,

				win_loss: 0,

				casino_share: 0,

				commission: 0,

				house_expenses_settled: 0,

				grand_net_profit: 0,

				share_percentages: [],

			});

		}

		const agg = byMonth.get(mk);

		agg.game_count += r.game_count;

		agg.win_loss += r.win_loss;

		agg.casino_share += r.casino_share;

		agg.commission += r.commission;

		agg.house_expenses_settled += r.house_expenses_settled;

		agg.grand_net_profit += r.grand_net_profit;

		if (Number.isFinite(Number(r.share_percentage))) {

			agg.share_percentages.push(Number(r.share_percentage));

		}

	}



	return [...byMonth.entries()]

		.sort((a, b) => a[0].localeCompare(b[0]))

		.map(([mk, agg]) => {

			const win_loss = ceilAmount(agg.win_loss);

			const casino_share = ceilAmount(agg.casino_share);

			const house_expenses_settled = ceilAmount(agg.house_expenses_settled);

			const grand_net_profit = ceilAmount(agg.grand_net_profit);

			const pcts = agg.share_percentages;

			const firstPct = pcts[0];

			let share_percentage;

			if (pcts.length > 0 && pcts.every((pct) => pct === firstPct)) {

				share_percentage = firstPct;

			} else if (win_loss !== 0) {

				share_percentage = Math.round((casino_share / win_loss) * 100 * 10000) / 10000;

			} else {

				share_percentage = DEFAULT_NET_PROFIT_SHARE_PCT;

			}

			return {

				settlement_date: `${mk}-01`,

				settlement_label: formatMonthLabel(mk),

				month_key: mk,

				game_count: agg.game_count,

				win_loss,

				share_percentage,

				casino_share,

				commission: ceilAmount(agg.commission),

				house_expenses_settled,

				grand_net_profit,

			};

		});

}



/**

 * @param {Array<object>} records - game_record rows ORDER BY IDNo ASC

 * @param {object} gl - game_list row with COMMISSION_TYPE, COMMISSION_PERCENTAGE, HOUSE_SHARE

 */

function computeGameMetrics(records, gl) {

	let total_nn_init = 0;

	let total_cc_init = 0;

	let total_nn = 0;

	let total_cc = 0;

	let total_cash_out_nn = 0;

	let total_cash_out_cc = 0;

	let total_rolling_nn = 0;

	let total_rolling = 0;

	let total_rolling_cc = 0;

	let total_rolling_real = 0;

	let total_rolling_nn_real = 0;

	let total_rolling_cc_real = 0;

	let total_roller_nn = 0;

	let total_roller_cc = 0;

	let total_roller_return_cc = 0;



	for (const res of records) {

		const ct = Number(res.CAGE_TYPE);

		if (ct === 1 && (total_nn_init !== 0 || total_cc_init !== 0)) {

			total_nn += Number(res.NN_CHIPS) || 0;

			total_cc += Number(res.CC_CHIPS) || 0;

		}

		if (ct === 1 && total_nn_init === 0 && total_cc_init === 0) {

			total_nn_init += Number(res.NN_CHIPS) || 0;

			total_cc_init += Number(res.CC_CHIPS) || 0;

		}

		if (ct === 2) {

			total_cash_out_nn += Number(res.NN_CHIPS) || 0;

			total_cash_out_cc += Number(res.CC_CHIPS) || 0;

		}

		if (ct === 3) {

			total_rolling += Number(res.AMOUNT) || 0;

			total_rolling_nn += Number(res.NN_CHIPS) || 0;

			total_rolling_cc += Number(res.CC_CHIPS) || 0;

		}

		if (ct === 4) {

			total_rolling_real += Number(res.AMOUNT) || 0;

			total_rolling_nn_real += Number(res.NN_CHIPS) || 0;

			total_rolling_cc_real += Number(res.CC_CHIPS) || 0;

		}

		if (ct === 5) {

			const rollerTransaction = parseInt(res.ROLLER_TRANSACTION, 10) || 1;

			if (rollerTransaction === 1) {

				total_roller_nn += Number(res.ROLLER_NN_CHIPS) || 0;

				total_roller_cc += Number(res.ROLLER_CC_CHIPS) || 0;

			} else if (rollerTransaction === 2) {

				total_roller_nn -= Number(res.ROLLER_NN_CHIPS) || 0;

				total_roller_cc -= Number(res.ROLLER_CC_CHIPS) || 0;

				total_roller_return_cc += Number(res.ROLLER_CC_CHIPS) || 0;

			}

		}

	}



	const total_initial = total_nn_init + total_cc_init;

	const total_buy_in_chips = total_nn + total_cc;

	const total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;

	const totalRollingCCWithReturns = total_roller_return_cc;

	const total_rolling_chips =

		total_rolling_nn +

		totalRollingCCWithReturns +

		total_rolling +

		total_rolling_real +

		total_rolling_nn_real +

		total_rolling_cc_real -

		total_cash_out_nn;



	const winLoss = total_initial + total_buy_in_chips - total_cash_out_chips;



	const commissionType = Number(gl.COMMISSION_TYPE);

	const commissionPct = Number(gl.COMMISSION_PERCENTAGE) || 0;

	let commission = 0;

	if (commissionPct > 0) {

		if (commissionType === 1 || commissionType === 3) {

			commission = Math.ceil((total_rolling_chips * commissionPct) / 100);

		} else if (commissionType === 2) {

			commission = Math.ceil((winLoss * commissionPct) / 100);

		}

	}



	return {

		winLoss,

		rolling: total_rolling_chips,

		commission,

	};

}



async function loadSharePercentagesByDay(startStr, endStr) {
	const [rows] = await pool.execute(
		`SELECT CAST(SETTLEMENT_DATE AS CHAR) AS settlement_day, SHARE_PERCENTAGE
		 FROM \`${NET_PROFIT_SHARE_TABLE}\`
		 WHERE ACTIVE = 1
		   AND CAST(SETTLEMENT_DATE AS DATE) >= CAST(? AS DATE)
		   AND CAST(SETTLEMENT_DATE AS DATE) <= CAST(? AS DATE)`,
		[startStr, endStr]
	);
	const map = new Map();
	for (const r of rows || []) {
		const d = String(r.settlement_day || '').slice(0, 10);
		const pct = Number(r.SHARE_PERCENTAGE);
		if (isValidYmd(d) && Number.isFinite(pct)) map.set(d, pct);
	}
	return map;
}



function normalizeSharePercentage(raw) {
	const pct = Number(raw);
	if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
	return Math.round(pct * 10000) / 10000;
}



async function fetchRecordsForGames(gameIds) {

	if (!gameIds.length) return new Map();

	const placeholders = gameIds.map(() => '?').join(',');

	const [recs] = await pool.execute(

		`SELECT GAME_ID, AMOUNT, NN_CHIPS, CC_CHIPS, CAGE_TYPE, ROLLER_TRANSACTION, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS

		 FROM game_record

		 WHERE ACTIVE != 0 AND GAME_ID IN (${placeholders})

		 ORDER BY GAME_ID ASC, IDNo ASC`,

		gameIds

	);

	const byGame = new Map();

	for (const r of recs) {

		const gid = r.GAME_ID;

		if (!byGame.has(gid)) byGame.set(gid, []);

		byGame.get(gid).push(r);

	}

	return byGame;

}



async function loadGamesInDateRange(startStr, endStr) {

	const [gameRows] = await pool.execute(

		`SELECT

			CAST(ds.SETTLEMENT_DATE AS CHAR) AS settlement_day,

			gl.IDNo AS game_id,

			gl.COMMISSION_TYPE,

			gl.COMMISSION_PERCENTAGE,

			gl.HOUSE_SHARE

		FROM daily_settlement_games dsg

		JOIN daily_settlement ds ON dsg.DAILY_SETTLEMENT_ID = ds.IDNo AND ds.ACTIVE = 1

		JOIN game_list gl ON gl.IDNo = dsg.GAME_ID AND gl.ACTIVE != 0

		WHERE CAST(ds.SETTLEMENT_DATE AS DATE) >= CAST(? AS DATE)

		  AND CAST(ds.SETTLEMENT_DATE AS DATE) <= CAST(? AS DATE)

		ORDER BY ds.SETTLEMENT_DATE ASC, gl.IDNo ASC`,

		[startStr, endStr]

	);

	return gameRows || [];

}



async function loadDistinctSettlementDatesInRange(startStr, endStr) {

	const [rows] = await pool.execute(

		`SELECT DISTINCT d FROM (

		   SELECT CAST(ds.SETTLEMENT_DATE AS DATE) AS d

		   FROM daily_settlement_games dsg

		   JOIN daily_settlement ds ON dsg.DAILY_SETTLEMENT_ID = ds.IDNo AND ds.ACTIVE = 1

		   WHERE CAST(ds.SETTLEMENT_DATE AS DATE) >= CAST(? AS DATE)

		     AND CAST(ds.SETTLEMENT_DATE AS DATE) <= CAST(? AS DATE)

		   UNION

		   SELECT CAST(eds.SETTLEMENT_DATE AS DATE) AS d

		   FROM expense_daily_settlement eds

		   WHERE eds.ACTIVE = 1

		     AND CAST(eds.SETTLEMENT_DATE AS DATE) >= CAST(? AS DATE)

		     AND CAST(eds.SETTLEMENT_DATE AS DATE) <= CAST(? AS DATE)

		 ) t

		 WHERE d IS NOT NULL

		 ORDER BY d ASC`,

		[startStr, endStr, startStr, endStr]

	);

	const out = [];

	for (const r of rows || []) {

		const raw = r.d;

		let d = '';

		if (raw instanceof Date) {

			d = `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;

		} else {

			d = String(raw || '').slice(0, 10);

		}

		if (isValidYmd(d)) out.push(d);

	}

	return out;

}



async function loadExpenseTotalsByDay(startStr, endStr) {

	const map = new Map();

	try {

		const [rows] = await pool.execute(

			`SELECT

				CAST(eds.SETTLEMENT_DATE AS CHAR) AS settlement_day,

				COALESCE(SUM(jhe.AMOUNT), 0) AS total_amt

			 FROM expense_daily_settlement eds

			 JOIN expense_daily_settlement_items it

			   ON it.DAILY_SETTLEMENT_ID = eds.IDNo AND it.EXPENSE_TYPE = 'expense'

			 JOIN junket_house_expense jhe ON jhe.IDNo = it.EXPENSE_ID AND jhe.ACTIVE = 1

			 WHERE eds.ACTIVE = 1

			   AND CAST(eds.SETTLEMENT_DATE AS DATE) >= CAST(? AS DATE)

			   AND CAST(eds.SETTLEMENT_DATE AS DATE) <= CAST(? AS DATE)

			 GROUP BY CAST(eds.SETTLEMENT_DATE AS DATE)

			 ORDER BY settlement_day ASC`,

			[startStr, endStr]

		);

		for (const r of rows || []) {

			const raw = r.settlement_day;

			let d = '';

			if (raw instanceof Date) {

				d = `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;

			} else {

				d = String(raw || '').slice(0, 10);

			}

			if (isValidYmd(d)) map.set(d, Number(r.total_amt) || 0);

		}

	} catch (_e) {

		/* table missing etc. */

	}

	return map;

}



/** Sum of active junket_house_expense rows not linked to any active expense_daily_settlement item (type expense). */
async function loadUnsettledHouseExpenseTotal() {

	try {

		const [rows] = await pool.execute(

			`SELECT COALESCE(SUM(jhe.AMOUNT), 0) AS total_amt

			 FROM junket_house_expense jhe

			 WHERE jhe.ACTIVE = 1

			   AND NOT EXISTS (

				 SELECT 1

				 FROM expense_daily_settlement_items it

				 JOIN expense_daily_settlement eds ON eds.IDNo = it.DAILY_SETTLEMENT_ID AND eds.ACTIVE = 1

				 WHERE it.EXPENSE_ID = jhe.IDNo AND it.EXPENSE_TYPE = 'expense'

			   )`

		);

		return rows && rows[0] ? Number(rows[0].total_amt) || 0 : 0;

	} catch (_e) {

		return 0;

	}

}



async function loadUnsettledGamesForLive() {

	const [rows] = await pool.execute(

		`SELECT

			gl.IDNo AS game_id,

			gl.COMMISSION_TYPE,

			gl.COMMISSION_PERCENTAGE,

			gl.HOUSE_SHARE

		FROM game_list gl

		WHERE gl.ACTIVE != 0

		  AND (gl.DAILY_SETTLEMENT = 1 OR gl.DAILY_SETTLEMENT IS NULL)

		  AND NOT EXISTS (SELECT 1 FROM daily_settlement_games dsg WHERE dsg.GAME_ID = gl.IDNo)

		ORDER BY gl.IDNo ASC`

	);

	return rows || [];

}



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



		const unsettledGames = await loadUnsettledGamesForLive();

		const gameRows = await loadGamesInDateRange(start, end);

		const byDayGames = new Map();

		for (const row of gameRows) {

			const d = String(row.settlement_day || '').slice(0, 10);

			if (!isValidYmd(d)) continue;

			const gl = {

				game_id: row.game_id,

				COMMISSION_TYPE: row.COMMISSION_TYPE,

				COMMISSION_PERCENTAGE: row.COMMISSION_PERCENTAGE,

				HOUSE_SHARE: row.HOUSE_SHARE,

			};

			if (!byDayGames.has(d)) byDayGames.set(d, []);

			byDayGames.get(d).push(gl);

		}



		let distinctDates = await loadDistinctSettlementDatesInRange(start, end);

		const todayInRange = todayStr >= start && todayStr <= end;

		if (todayInRange && unsettledGames.length > 0 && distinctDates.indexOf(todayStr) === -1) {

			distinctDates = distinctDates.concat([todayStr]).sort();

		}



		function gamesForSettlementDate(d) {

			const fromDsg = byDayGames.get(d) || [];

			if (d !== todayStr || !todayInRange || !unsettledGames.length) {

				return fromDsg;

			}

			const merged = new Map();

			for (const g of fromDsg) merged.set(g.game_id, g);

			for (const ug of unsettledGames) {

				if (!merged.has(ug.game_id)) {

					merged.set(ug.game_id, {

						game_id: ug.game_id,

						COMMISSION_TYPE: ug.COMMISSION_TYPE,

						COMMISSION_PERCENTAGE: ug.COMMISSION_PERCENTAGE,

						HOUSE_SHARE: ug.HOUSE_SHARE,

					});

				}

			}

			return Array.from(merged.values());

		}



		const allGameIdSet = new Set(gameRows.map((r) => r.game_id));

		if (todayInRange) {

			for (const ug of unsettledGames) allGameIdSet.add(ug.game_id);

		}

		const recordsByGame = await fetchRecordsForGames([...allGameIdSet]);

		const expenseByDay = await loadExpenseTotalsByDay(start, end);

		const unsettledExpenseTotal = await loadUnsettledHouseExpenseTotal();

		if (todayInRange && unsettledExpenseTotal > 0) {

			expenseByDay.set(todayStr, (expenseByDay.get(todayStr) || 0) + unsettledExpenseTotal);

			if (distinctDates.indexOf(todayStr) === -1) {

				distinctDates = distinctDates.concat([todayStr]).sort();

			}

		}

		const sharePctByDay = await loadSharePercentagesByDay(start, end);



		const rowsAsc = distinctDates.map((d) => {

			const games = gamesForSettlementDate(d);

			let win_loss = 0;

			let commission = 0;

			for (const g of games) {

				const recs = recordsByGame.get(g.game_id) || [];

				const m = computeGameMetrics(recs, g);

				win_loss += m.winLoss;

				commission += m.commission;

			}

			const houseExp = expenseByDay.get(d) || 0;
			const sharePercentage = sharePctByDay.has(d) ? sharePctByDay.get(d) : DEFAULT_NET_PROFIT_SHARE_PCT;
			const casino_share = win_loss * (sharePercentage / 100);

			const net_before = casino_share - commission;

			const grand = net_before - houseExp;

			return {

				settlement_date: d,

				settlement_label: d,

				game_count: games.length,

				win_loss: ceilAmount(win_loss),

				share_percentage: sharePercentage,

				casino_share: ceilAmount(casino_share),

				commission: ceilAmount(commission),

				house_expenses_settled: ceilAmount(houseExp),

				grand_net_profit: ceilAmount(grand),

			};

		});



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
		const settlementDate = String(req.body?.settlement_date || '').trim();
		const sharePercentage = normalizeSharePercentage(req.body?.share_percentage);

		if (!isValidYmd(settlementDate)) {
			return res.status(400).json({ success: false, error: 'Invalid settlement date' });
		}
		if (sharePercentage == null) {
			return res.status(400).json({ success: false, error: 'Share percentage must be between 0 and 100' });
		}

		const userId = req.session.user_id || null;
		await upsertSharePercentage(settlementDate, sharePercentage, userId);

		res.json({ success: true, settlement_date: settlementDate, share_percentage: sharePercentage });
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
		for (const settlementDate of dates) {
			await upsertSharePercentage(settlementDate, sharePercentage, userId);
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



function coerceNetProfitExportCell(raw) {
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

function sanitizeNetProfitSheetName(raw) {
	if (raw == null || typeof raw !== 'string') return '';
	let s = raw.trim().replace(/[\]\[\\\/\?\*:]/g, '');
	if (s.length > 31) s = s.slice(0, 31);
	return s;
}

router.post('/net_profit/export_xlsx', superAdminOnly, async function (req, res) {
	try {
		const { headers, rows, filename, sheetName } = req.body || {};
		if (!Array.isArray(headers) || headers.length === 0) {
			return res.status(400).json({ error: 'Invalid headers' });
		}
		if (!Array.isArray(rows)) {
			return res.status(400).json({ error: 'Invalid rows' });
		}
		const MAX_ROWS = 2000;
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
		const fillHeader = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFD9E1F2' }
		};
		const fillTotalRow = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFFFF3CD' }
		};
		const fillZebra = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFF5F5F5' }
		};

		const workbook = new ExcelJS.Workbook();
		const sheetTitle = sanitizeNetProfitSheetName(sheetName) || 'Net profit';
		const ws = workbook.addWorksheet(sheetTitle, {
			views: [{ state: 'frozen', ySplit: 1 }]
		});

		const headerRow = ws.addRow(headers.map((h) => (h == null ? '' : String(h))));
		headerRow.height = 22;
		headerRow.eachCell((cell, colNumber) => {
			cell.font = { bold: true };
			cell.border = thinBorder;
			cell.fill = fillHeader;
			const colIdx = colNumber - 1;
			cell.alignment =
				colIdx === 0
					? { vertical: 'middle', horizontal: 'left', wrapText: true }
					: { vertical: 'middle', horizontal: 'right', wrapText: true };
		});

		rows.forEach((r, rowIdx) => {
			const arr = Array.isArray(r) ? r : [];
			const padded = Array.from({ length: ncol }, (_, i) => {
				const v = arr[i];
				if (v == null || v === '') return '';
				return coerceNetProfitExportCell(v);
			});
			const firstCell = arr[0];
			const isTotal = firstCell != null && String(firstCell).trim().toUpperCase() === 'TOTAL';
			const dataRow = ws.addRow(padded);
			dataRow.eachCell((cell, colNumber) => {
				cell.border = thinBorder;
				const colIdx = colNumber - 1;
				if (colIdx === 0) {
					cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
				} else {
					cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
				}
				if (isTotal) {
					cell.fill = fillTotalRow;
					cell.font = { bold: true };
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
			return Math.min(48, Math.max(10, m + 2));
		});
		for (let i = 1; i <= ncol; i++) {
			ws.getColumn(i).width = colMaxLens[i - 1];
		}

		applyCommaThousandsToNumericCells(ws);

		const buffer = await workbook.xlsx.writeBuffer();
		let outName = 'NetProfit-export.xlsx';
		if (filename && typeof filename === 'string') {
			const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
			if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
			else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
		}
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
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


