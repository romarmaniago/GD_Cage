/**
 * "Daily Report" side card (dashboard) — per-date and month-cutoff-total figures for
 * W/L, Rolling, Expenses, Settlement Commission and Settlement Additional, shown next
 * to the Daily Report table modal.
 *
 * W/L, Rolling and Settlement Commission are sourced the same way as the Daily Report
 * table (utils/netProfitCalc.js computeGamebookDailyReportRows): Game Book auto totals
 * (game_list / game_record) PLUS manually-added games from the Game Information page
 * (game_information table), so a manually-added game is reflected here too. Expenses
 * and Settlement Additional reuse the dashboard's own canonical period-summary formulas
 * (utils/dashboardPeriodSummary.js) so those two figures always match the rest of the
 * dashboard.
 */

const pool = require('../config/db');
const { getMonthEndCutoffRange } = require('./monthEndCutoffRange');
const { computeDashboardPeriodSummary } = require('./dashboardPeriodSummary');
const {
	isValidYmd,
	ceilAmount,
	serverTodayStr,
	computeGameMetrics,
	loadGamesInDateRange,
	fetchRecordsForGames,
	computeGamebookAutoTotalsByDate,
	loadManualGameInformationTotalsByDate,
} = require('./netProfitCalc');

/** Sum of the Game Book's per-game auto commission (computeGameMetrics) for [startStr, endStr]. */
async function computeGamebookCommissionTotal(startStr, endStr) {
	const gameRows = await loadGamesInDateRange(startStr, endStr);
	if (!gameRows.length) return 0;
	const recordsByGame = await fetchRecordsForGames(gameRows.map((r) => r.game_id));
	let total = 0;
	for (const row of gameRows) {
		const gl = {
			game_id: row.game_id,
			COMMISSION_TYPE: row.COMMISSION_TYPE,
			COMMISSION_PERCENTAGE: row.COMMISSION_PERCENTAGE,
			SHARE_PERCENTAGE: row.SHARE_PERCENTAGE,
			ROLLING_PERCENTAGE: row.ROLLING_PERCENTAGE,
			HOUSE_SHARE: row.HOUSE_SHARE,
		};
		const m = computeGameMetrics(recordsByGame.get(row.game_id) || [], gl);
		total += m.commission;
	}
	return total;
}

/** Sum of manually-added games' COMMISSION (game_information table) for [startStr, endStr]. */
async function loadManualGameInformationCommissionTotal(startStr, endStr) {
	const [rows] = await pool.execute(
		`SELECT COALESCE(SUM(gi.COMMISSION), 0) AS total
		FROM game_information gi
		WHERE gi.ACTIVE = 1
		  AND CAST(gi.PROGRAM_DATE AS DATE) >= CAST(? AS DATE)
		  AND CAST(gi.PROGRAM_DATE AS DATE) <= CAST(? AS DATE)`,
		[startStr, endStr]
	);
	return Number(rows && rows[0] && rows[0].total) || 0;
}

/** W/L + Rolling across [startStr, endStr] — Game Book auto totals plus manual Game Information games. */
async function computeWinLossRollingTotal(startStr, endStr) {
	const [gamebookByDate, manualByDate] = await Promise.all([
		computeGamebookAutoTotalsByDate(startStr, endStr),
		loadManualGameInformationTotalsByDate(startStr, endStr),
	]);
	let winLoss = 0;
	let rolling = 0;
	for (const bucket of gamebookByDate.values()) {
		winLoss += bucket.wl;
		rolling += bucket.rolling;
	}
	for (const bucket of manualByDate.values()) {
		winLoss += bucket.wl;
		rolling += bucket.rolling;
	}
	return { winLoss, rolling };
}

async function computeSettlementCommissionTotal(startStr, endStr) {
	const [gamebookCommission, manualCommission] = await Promise.all([
		computeGamebookCommissionTotal(startStr, endStr),
		loadManualGameInformationCommissionTotal(startStr, endStr),
	]);
	return gamebookCommission + manualCommission;
}

async function computePeriodMetrics(dateFrom, dateTo) {
	const [{ winLoss, rolling }, periodSummary, settlementCommission] = await Promise.all([
		computeWinLossRollingTotal(dateFrom, dateTo),
		computeDashboardPeriodSummary(pool, dateFrom, dateTo),
		computeSettlementCommissionTotal(dateFrom, dateTo),
	]);

	return {
		win_loss: ceilAmount(winLoss),
		rolling: ceilAmount(rolling),
		expenses: ceilAmount(periodSummary.expense),
		settlement_commission: ceilAmount(settlementCommission),
		settlement_additional: ceilAmount(periodSummary.additional_commission),
	};
}

/**
 * Daily Report side card payload for a single program date: "Today" (that date alone)
 * and "Total" (the month-end-cutoff period containing it — same range convention as
 * the dashboard's period filters).
 */
async function computeDailyReportSideSummary(dateStr) {
	const date = isValidYmd(dateStr) ? dateStr : serverTodayStr();
	const cutoff = getMonthEndCutoffRange(new Date(`${date}T00:00:00`));
	const monthFrom = cutoff.startDate;
	const monthTo = cutoff.endDate;

	const [today, total] = await Promise.all([
		computePeriodMetrics(date, date),
		computePeriodMetrics(monthFrom, monthTo),
	]);

	return { date, month_from: monthFrom, month_to: monthTo, today, total };
}

module.exports = {
	computeDailyReportSideSummary,
};
