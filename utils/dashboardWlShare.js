const DEFAULT_DASHBOARD_WL_SHARE_PCT = 65;
const TABLE = 'dashboard_wl_share_percentages';

function normalizeSharePercentage(raw) {
	const pct = Number(raw);
	if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
	return Math.round(pct * 10000) / 10000;
}

function isValidMonthKey(monthKey) {
	return typeof monthKey === 'string' && /^\d{4}-\d{2}$/.test(monthKey);
}

function currentMonthKey(date) {
	const d = date instanceof Date ? date : new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	return `${y}-${m}`;
}

async function loadDashboardWlSharePct(pool, monthKey) {
	if (!isValidMonthKey(monthKey)) {
		return DEFAULT_DASHBOARD_WL_SHARE_PCT;
	}
	try {
		const [rows] = await pool.execute(
			`SELECT SHARE_PERCENTAGE
			 FROM \`${TABLE}\`
			 WHERE MONTH_KEY = ? AND ACTIVE = 1
			 LIMIT 1`,
			[monthKey]
		);
		const pct = Number(rows[0]?.SHARE_PERCENTAGE);
		return Number.isFinite(pct) ? pct : DEFAULT_DASHBOARD_WL_SHARE_PCT;
	} catch (err) {
		console.error('loadDashboardWlSharePct:', err.message);
		return DEFAULT_DASHBOARD_WL_SHARE_PCT;
	}
}

async function upsertDashboardWlSharePct(pool, monthKey, sharePercentage, userId) {
	await pool.execute(
		`INSERT INTO \`${TABLE}\`
			(MONTH_KEY, SHARE_PERCENTAGE, ACTIVE, ENCODED_BY, ENCODED_DT)
		 VALUES (?, ?, 1, ?, NOW())
		 ON DUPLICATE KEY UPDATE
			SHARE_PERCENTAGE = VALUES(SHARE_PERCENTAGE),
			ACTIVE = 1,
			EDITED_BY = VALUES(ENCODED_BY),
			EDITED_DT = VALUES(ENCODED_DT)`,
		[monthKey, sharePercentage, userId]
	);
}

module.exports = {
	DEFAULT_DASHBOARD_WL_SHARE_PCT,
	normalizeSharePercentage,
	isValidMonthKey,
	currentMonthKey,
	loadDashboardWlSharePct,
	upsertDashboardWlSharePct
};
