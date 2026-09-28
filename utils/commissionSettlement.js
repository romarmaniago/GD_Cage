/**
 * Commission settlement (Commission → Settle) — shared by routes/commission.js.
 *
 * Same games as the Commission table (/commission_data: settled, by program date) and the same per-game
 * math as the dashboard (gameFiguresFromRecords + computeGameCommission). Each game's Add Charge paid via
 * "Settle" (game_services TRANSACTION_ID = 3) rides along, unless already settled on the Add Charge page.
 *
 * Slip lines are signed from the junket's side: commission paid out is negative, Add Charge positive.
 */
const { gameFiguresFromRecords } = require('./dashboardPeriodSummary');
const { computeGameCommission, getShareRollingSplit, COMMISSION_TYPE } = require('./commissionCalc');

function round2(n) {
	return Math.round((Number(n) || 0) * 100) / 100;
}

/** 50 → "50", 1.5 → "1.5" */
function pct(n) {
	return String(round2(n));
}

/** Slip section a game belongs to, e.g. "Rolling 100%", "Share 50%", "Share 25% + Rolling 50%". */
function commissionGroupOf(game) {
	const type = parseInt(game.COMMISSION_TYPE, 10);
	const { sharePct, rollingPct } = getShareRollingSplit(game);
	if (type === COMMISSION_TYPE.SHARED) {
		return { order: 2, title: `Share ${pct(game.COMMISSION_PERCENTAGE)}%` };
	}
	if (type === COMMISSION_TYPE.SHARE_ROLLING) {
		return { order: 3, title: `Share ${pct(sharePct)}% + Rolling ${pct(rollingPct)}%` };
	}
	return { order: 1, title: `Rolling ${pct(rollingPct)}%` };
}

/**
 * Games for the slip. Unsettled (by commission) within fromDate..toDate, or the games of one saved batch.
 * Joins match /commission_data so the slip covers exactly what the Commission table lists.
 */
async function loadCommissionGames(db, { fromDate, toDate, settlementId, forUpdate = false }) {
	const where = settlementId
		? 'gl.COMMISSION_SETTLEMENT_ID = ?'
		: `gl.COMMISSION_SETTLEMENT_ID IS NULL
			AND DATE(COALESCE(gl.PROGRAM_DATE, gl.ENCODED_DT)) BETWEEN ? AND ?`;
	const [games] = await db.execute(
		`SELECT gl.IDNo, gl.COMMISSION_TYPE, gl.COMMISSION_PERCENTAGE, gl.SHARE_PERCENTAGE, gl.ROLLING_PERCENTAGE
		 FROM game_list gl
		 JOIN account ON gl.ACCOUNT_ID = account.IDNo
		 JOIN agent ON agent.IDNo = account.AGENT_ID
		 JOIN agency ON agency.IDNo = agent.AGENCY
		 WHERE gl.ACTIVE != 0
			AND gl.SETTLED = 1
			AND ${where}
		 ORDER BY gl.IDNo ASC
		 ${forUpdate ? 'FOR UPDATE' : ''}`,
		settlementId ? [settlementId] : [fromDate, toDate]
	);
	return games || [];
}

/**
 * Per-game figures + slip. `settlementId` set → the Add Charge rows already tagged to that batch;
 * otherwise the game's still-unsettled "Settle" Add Charge rows.
 */
async function buildCommissionSettlement(db, games, { settlementId = null } = {}) {
	const groups = new Map();
	const serviceIds = [];
	const rates = new Set();

	for (const game of games) {
		const [records] = await db.execute(
			`SELECT AMOUNT, NN_CHIPS, CC_CHIPS, CAGE_TYPE, ROLLER_TRANSACTION, ROLLER_CC_CHIPS
			 FROM game_record
			 WHERE ACTIVE != 0 AND GAME_ID = ?
			 ORDER BY IDNo ASC`,
			[game.IDNo]
		);
		const figures = gameFiguresFromRecords(records || []);
		const commission = computeGameCommission(game, figures.winLoss, figures.rolling, { absRolling: false });

		const [services] = await db.execute(
			settlementId
				? `SELECT IDNo, AMOUNT FROM game_services
				   WHERE GAME_ID = ? AND ACTIVE = 1 AND TRANSACTION_ID = 3 AND COMMISSION_SETTLEMENT_ID = ?`
				: `SELECT IDNo, AMOUNT FROM game_services
				   WHERE GAME_ID = ? AND ACTIVE = 1 AND TRANSACTION_ID = 3
					AND SERVICE_SETTLEMENT_ID IS NULL AND COMMISSION_SETTLEMENT_ID IS NULL`,
			settlementId ? [game.IDNo, settlementId] : [game.IDNo]
		);
		const addCharge = (services || []).reduce((s, r) => s + (Number(r.AMOUNT) || 0), 0);
		(services || []).forEach((r) => serviceIds.push(r.IDNo));

		const type = parseInt(game.COMMISSION_TYPE, 10);
		if ((type === COMMISSION_TYPE.ROLLING || type === COMMISSION_TYPE.SHARE_ROLLING) && Number(game.COMMISSION_PERCENTAGE) > 0) {
			rates.add(Number(game.COMMISSION_PERCENTAGE).toFixed(2));
		}

		const { order, title } = commissionGroupOf(game);
		const g = groups.get(title) || { order, title, buyIn: 0, cashOut: 0, winLoss: 0, rolling: 0, settlement: 0, addCharge: 0 };
		g.buyIn += figures.buyIn;
		g.cashOut += figures.cashOut;
		g.winLoss += figures.winLoss;
		g.rolling += figures.rolling;
		g.settlement += -commission;
		g.addCharge += addCharge;
		groups.set(title, g);
	}

	const sorted = [...groups.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
	const mains = [];
	if (rates.size) {
		mains.push({ kind: 'info', name: 'Rolling Rate', text: [...rates].map((r) => `${r}%`).join(' / ') });
	}
	let total = 0;
	sorted.forEach((g) => {
		const groupTotal = round2(g.settlement + g.addCharge);
		total += groupTotal;
		mains.push({ kind: 'divider' });
		mains.push({ kind: 'title', name: g.title });
		mains.push({ name: 'Buy In', amount: round2(g.buyIn) });
		mains.push({ name: 'Cash Out', amount: -round2(g.cashOut) });
		mains.push({ name: 'Win / Loss', amount: round2(g.winLoss) });
		mains.push({ name: 'Rolling', amount: round2(g.rolling) });
		mains.push({ name: 'Settlement', amount: round2(g.settlement) });
		mains.push({ name: 'Add Charge', amount: round2(g.addCharge) });
		mains.push({ kind: 'total', name: 'Total', amount: groupTotal });
	});

	return { mains, total: round2(total), count: games.length, serviceIds, hideGrandTotal: true };
}

async function previewCommissionSettlement(db, fromDate, toDate) {
	const games = await loadCommissionGames(db, { fromDate, toDate });
	const slip = await buildCommissionSettlement(db, games);
	return { mains: slip.mains, total: slip.total, count: slip.count, hideGrandTotal: true };
}

module.exports = {
	loadCommissionGames,
	buildCommissionSettlement,
	previewCommissionSettlement
};
