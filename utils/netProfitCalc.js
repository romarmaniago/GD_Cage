/**
 * Shared net-profit calculation core — single source of truth for "Win/Loss, Commission,
 * Expenses, Net Profit (NGR)" figures used by BOTH:
 *   - the web Net Profit page (routes/net_profit.js)
 *   - the Flutter app's dashboard summary (routes/api.js GET /api/dashboard-summary)
 *
 * Extracted verbatim from routes/net_profit.js so both consumers always agree — a fix or
 * formula change here automatically applies to both without needing a second edit.
 */

const pool = require('../config/db');

/** Default % for net profit share rows when no program-date override exists. */
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

function isValidYmd(d) {
	return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
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

async function loadGamesInDateRange(startStr, endStr) {
	const [gameRows] = await pool.execute(
		`SELECT
			CAST(gl.PROGRAM_DATE AS CHAR) AS program_day,
			gl.IDNo AS game_id,
			gl.COMMISSION_TYPE,
			gl.COMMISSION_PERCENTAGE,
			gl.HOUSE_SHARE
		FROM game_list gl
		WHERE gl.ACTIVE != 0
		  AND CAST(gl.PROGRAM_DATE AS DATE) >= CAST(? AS DATE)
		  AND CAST(gl.PROGRAM_DATE AS DATE) <= CAST(? AS DATE)
		ORDER BY gl.PROGRAM_DATE ASC, gl.IDNo ASC`,
		[startStr, endStr]
	);
	return gameRows || [];
}

async function loadDistinctProgramDatesInRange(startStr, endStr) {
	const [rows] = await pool.execute(
		`SELECT DISTINCT d FROM (
		   SELECT CAST(gl.PROGRAM_DATE AS DATE) AS d
		   FROM game_list gl
		   WHERE gl.ACTIVE != 0
		     AND CAST(gl.PROGRAM_DATE AS DATE) >= CAST(? AS DATE)
		     AND CAST(gl.PROGRAM_DATE AS DATE) <= CAST(? AS DATE)
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
				CAST(eds.SETTLEMENT_DATE AS CHAR) AS expense_day,
				COALESCE(SUM(jhe.AMOUNT), 0) AS total_amt
			 FROM expense_daily_settlement eds
			 JOIN expense_daily_settlement_items it
			   ON it.DAILY_SETTLEMENT_ID = eds.IDNo AND it.EXPENSE_TYPE = 'expense'
			 JOIN junket_house_expense jhe ON jhe.IDNo = it.EXPENSE_ID AND jhe.ACTIVE = 1
			 WHERE eds.ACTIVE = 1
			   AND CAST(eds.SETTLEMENT_DATE AS DATE) >= CAST(? AS DATE)
			   AND CAST(eds.SETTLEMENT_DATE AS DATE) <= CAST(? AS DATE)
			 GROUP BY CAST(eds.SETTLEMENT_DATE AS DATE)
			 ORDER BY expense_day ASC`,
			[startStr, endStr]
		);
		for (const r of rows || []) {
			const raw = r.expense_day;
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

/** Placeholder for "currently in-progress, not yet posted to game_list" games. Not implemented upstream — always empty. */
async function loadUnsettledGamesForLive() {
	return [];
}

async function loadSharePercentagesByDay(startStr, endStr) {
	const [rows] = await pool.execute(
		`SELECT CAST(PROGRAM_DATE AS CHAR) AS program_day, SHARE_PERCENTAGE
		 FROM \`${NET_PROFIT_SHARE_TABLE}\`
		 WHERE ACTIVE = 1
		   AND CAST(PROGRAM_DATE AS DATE) >= CAST(? AS DATE)
		   AND CAST(PROGRAM_DATE AS DATE) <= CAST(? AS DATE)`,
		[startStr, endStr]
	);
	const map = new Map();
	for (const r of rows || []) {
		const d = String(r.program_day || '').slice(0, 10);
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

/**
 * Per-program-date net profit rows for [startStr, endStr] — same computation as the
 * Net Profit page's Daily view (routes/net_profit.js GET /net_profit_data).
 * One row per distinct program date: { program_date, game_count, win_loss, share_percentage,
 * casino_share, commission, house_expenses_settled, grand_net_profit }.
 */
async function computeNetProfitRows(startStr, endStr) {
	const todayStr = serverTodayStr();
	const unsettledGames = await loadUnsettledGamesForLive();
	const gameRows = await loadGamesInDateRange(startStr, endStr);
	const byDayGames = new Map();
	for (const row of gameRows) {
		const d = String(row.program_day || '').slice(0, 10);
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

	let distinctDates = await loadDistinctProgramDatesInRange(startStr, endStr);
	const todayInRange = todayStr >= startStr && todayStr <= endStr;
	if (todayInRange && unsettledGames.length > 0 && distinctDates.indexOf(todayStr) === -1) {
		distinctDates = distinctDates.concat([todayStr]).sort();
	}

	function gamesForProgramDate(d) {
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
	const expenseByDay = await loadExpenseTotalsByDay(startStr, endStr);
	const unsettledExpenseTotal = await loadUnsettledHouseExpenseTotal();
	if (todayInRange && unsettledExpenseTotal > 0) {
		expenseByDay.set(todayStr, (expenseByDay.get(todayStr) || 0) + unsettledExpenseTotal);
		if (distinctDates.indexOf(todayStr) === -1) {
			distinctDates = distinctDates.concat([todayStr]).sort();
		}
	}
	const sharePctByDay = await loadSharePercentagesByDay(startStr, endStr);

	return distinctDates.map((d) => {
		const games = gamesForProgramDate(d);
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
			program_date: d,
			program_label: d,
			game_count: games.length,
			win_loss: ceilAmount(win_loss),
			share_percentage: sharePercentage,
			casino_share: ceilAmount(casino_share),
			commission: ceilAmount(commission),
			house_expenses_settled: ceilAmount(houseExp),
			grand_net_profit: ceilAmount(grand),
		};
	});
}

/** Sum of computeNetProfitRows(startStr, endStr) into one totals object (mirrors the Net Profit page's range_totals). */
async function computeNetProfitTotals(startStr, endStr) {
	const rowsAsc = await computeNetProfitRows(startStr, endStr);
	const totals = rowsAsc.reduce(
		(acc, r) => {
			acc.game_count += r.game_count;
			acc.win_loss += r.win_loss;
			acc.casino_share += r.casino_share;
			acc.commission += r.commission;
			acc.house_expenses_settled += r.house_expenses_settled;
			acc.grand_net_profit += r.grand_net_profit;
			return acc;
		},
		{ game_count: 0, win_loss: 0, casino_share: 0, commission: 0, house_expenses_settled: 0, grand_net_profit: 0 }
	);
	totals.win_loss = ceilAmount(totals.win_loss);
	totals.casino_share = ceilAmount(totals.casino_share);
	totals.house_expenses_settled = ceilAmount(totals.house_expenses_settled);
	totals.grand_net_profit = ceilAmount(totals.grand_net_profit);
	totals.commission = ceilAmount(totals.commission);
	return totals;
}

function monthKeyFromYmd(ymd) {
	return String(ymd || '').slice(0, 7);
}

function formatMonthLabel(monthKey) {
	const parts = String(monthKey || '').split('-');
	const y = Number(parts[0]);
	const m = Number(parts[1]);
	if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthKey;
	return `${y}-${String(m).padStart(2, '0')}`;
}

/** Roll up per-day net profit rows (from computeNetProfitRows) into one row per calendar month (ascending). */
function aggregateRowsByMonth(rowsAsc) {
	const byMonth = new Map();
	for (const r of rowsAsc || []) {
		const mk = monthKeyFromYmd(r.program_date);
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
				program_date: `${mk}-01`,
				program_label: formatMonthLabel(mk),
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

module.exports = {
	DEFAULT_NET_PROFIT_SHARE_PCT,
	NET_PROFIT_SHARE_TABLE,
	pad2,
	ceilAmount,
	serverTodayStr,
	isValidYmd,
	computeGameMetrics,
	loadGamesInDateRange,
	loadDistinctProgramDatesInRange,
	loadExpenseTotalsByDay,
	loadUnsettledHouseExpenseTotal,
	loadUnsettledGamesForLive,
	loadSharePercentagesByDay,
	normalizeSharePercentage,
	fetchRecordsForGames,
	computeNetProfitRows,
	computeNetProfitTotals,
	monthKeyFromYmd,
	formatMonthLabel,
	aggregateRowsByMonth,
};
