/**
 * Add Charge settlement (Add Charge → Settle) — shared by routes/fnb_hotel.js.
 *
 * Mirrors the dashboard's Add Charge balance (utils/dashboardServiceBalance.js): per active service
 * category, GUEST rows add their AMOUNT and JUNKET rows subtract |AMOUNT|; only TRANSACTION_ID 1-3.
 */
const { matchesServiceCategory } = require('./dashboardServiceBalance');
const { fetchActiveServiceCategories } = require('./serviceCategoryHelpers');

/** Signed contribution of one game_services row to the Add Charge balance. */
function signedServiceAmount(row) {
	const amount = Number(row.AMOUNT) || 0;
	return String(row.SOURCE_TYPE).toUpperCase() === 'JUNKET' ? -Math.abs(amount) : amount;
}

/**
 * Per-category breakdown of the given rows, in the dashboard's category order.
 * Returns { mains: [{ name, amount }], total, rows } — rows = those in at least one active category.
 */
function summarizeServiceRows(categories, rows) {
	const counted = new Set();
	const mains = categories.map((cat) => {
		let amount = 0;
		rows.forEach((row) => {
			if (!matchesServiceCategory(row.SERVICE_TYPE, cat.key)) return;
			amount += signedServiceAmount(row);
			counted.add(row);
		});
		return { name: cat.label, amount: Math.round(amount * 100) / 100 };
	});
	const total = Math.round(mains.reduce((s, m) => s + m.amount, 0) * 100) / 100;
	return { mains, total, rows: rows.filter((r) => counted.has(r)) };
}

/**
 * Narrow the active categories to one (dashboard F&B / Hotel / … modal). `name` may be the category
 * label ("F & B") or its dashboard key ("fnb"). Returns null when `name` is given but unknown.
 */
function pickServiceCategories(categories, name) {
	const wanted = String(name == null ? '' : name).trim().toLowerCase();
	if (!wanted) return categories;
	const hit = categories.find(
		(c) => String(c.label).trim().toLowerCase() === wanted || String(c.key).trim().toLowerCase() === wanted
	);
	return hit ? [hit] : null;
}

/** Unsettled rows whose program date is within fromDate..toDate (lock them when forUpdate). */
async function loadUnsettledServiceRows(db, fromDate, toDate, { forUpdate = false } = {}) {
	const [rows] = await db.execute(
		`SELECT IDNo, SERVICE_TYPE, SOURCE_TYPE, AMOUNT
		 FROM game_services
		 WHERE ACTIVE = 1
			AND SERVICE_SETTLEMENT_ID IS NULL
			AND COMMISSION_SETTLEMENT_ID IS NULL
			AND TRANSACTION_ID IN (1, 2, 3)
			AND SOURCE_TYPE IN ('JUNKET', 'GUEST')
			AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?
		 ${forUpdate ? 'FOR UPDATE' : ''}`,
		[fromDate, toDate]
	);
	return rows || [];
}

/** Settlement slip preview for fromDate..toDate (optionally one category): { mains, total, count }. */
async function previewServiceSettlement(db, fromDate, toDate, categoryName) {
	const categories = pickServiceCategories(await fetchActiveServiceCategories(db), categoryName);
	if (!categories) return null;
	const rows = await loadUnsettledServiceRows(db, fromDate, toDate);
	const summary = summarizeServiceRows(categories, rows);
	return { mains: summary.mains, total: summary.total, count: summary.rows.length };
}

/** Breakdown of a saved settlement's rows (only its category when it settled one): { mains, total }. */
async function summarizeSettledServices(db, settlementId, categoryName) {
	const categories = pickServiceCategories(await fetchActiveServiceCategories(db), categoryName)
		|| await fetchActiveServiceCategories(db);
	const [rows] = await db.execute(
		`SELECT IDNo, SERVICE_TYPE, SOURCE_TYPE, AMOUNT
		 FROM game_services
		 WHERE SERVICE_SETTLEMENT_ID = ? AND ACTIVE = 1`,
		[settlementId]
	);
	const summary = summarizeServiceRows(categories, rows || []);
	return { mains: summary.mains, total: summary.total };
}

module.exports = {
	pickServiceCategories,
	signedServiceAmount,
	summarizeServiceRows,
	loadUnsettledServiceRows,
	previewServiceSettlement,
	summarizeSettledServices,
	fetchActiveServiceCategories
};
