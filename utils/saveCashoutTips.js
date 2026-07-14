const TIP_TYPE = {
	ROLLER: 1,
	DEALER: 2
};

/** game_record TRANSACTION values for cash-out (CAGE_TYPE = 2). Tips are not posted to account_ledger. */
const CASHOUT_TRANSACTION = {
	CASH: 1,
	DEPOSIT: 2,
	CREDIT: 4,
	TIP_ROLLER: 5,
	TIP_DEALER: 6
};

/** Dealer tip cash-out — excluded from dashboard rolling/cash-balance totals (not W/L reset) */
const SQL_EXCLUDE_DEALER_TIP_CASHOUT = `AND TRANSACTION != ${CASHOUT_TRANSACTION.TIP_DEALER}`;

/** Game cash-out deductions from cash balance (excludes credit, roller tip, dealer tip) */
const SQL_DASHBOARD_GAME_CASHOUT_FILTER = `AND TRANSACTION NOT IN (${CASHOUT_TRANSACTION.CREDIT}, ${CASHOUT_TRANSACTION.TIP_ROLLER}, ${CASHOUT_TRANSACTION.TIP_DEALER})`;

/** Roller tip cash-out — counted as cash IN on dashboard */
const SQL_ROLLER_TIP_CASHOUT_ONLY = `AND TRANSACTION = ${CASHOUT_TRANSACTION.TIP_ROLLER}`;

/** Manual roller tip entry (Tip In) — cash IN on dashboard; excludes cash-out tips (game_record) */
const SQL_ROLLER_TIP_IN_CASHIN_ONLY = `AND TIP_TYPE = ${TIP_TYPE.ROLLER} AND CASHOUT_ID IS NULL`;

function parseTipAmount(raw) {
	const clean = String(raw || '').replace(/,/g, '').trim();
	if (clean === '') return 0;
	const n = Number(clean);
	return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function parseTipSplitAmounts(body) {
	const rollerNn = parseTipAmount(body && body.txtTipRollerNn);
	const rollerCc = parseTipAmount(body && body.txtTipRollerCc);
	const dealerNn = parseTipAmount(body && body.txtTipDealerNn);
	const dealerCc = parseTipAmount(body && body.txtTipDealerCc);

	if ([rollerNn, rollerCc, dealerNn, dealerCc].some((n) => Number.isNaN(n))) {
		return { roller: NaN, dealer: NaN, total: NaN };
	}

	const roller = rollerNn + rollerCc;
	const dealer = dealerNn + dealerCc;
	return { roller, dealer, total: roller + dealer };
}

function isTipEnabled(body) {
	const v = body && body.optTip;
	if (v === '1' || v === 1 || v === true || v === 'on') {
		return true;
	}

	const split = parseTipSplitAmounts(body);
	return split.total > 0;
}

function parseRollerName(raw) {
	const name = String(raw || '').trim();
	if (!name) return null;
	return name.length > 255 ? name.slice(0, 255) : name;
}

function parseTipStatus(raw) {
	const status = String(raw || '').trim();
	if (!status) return null;
	return status.length > 50 ? status.slice(0, 50) : status;
}

async function saveCashoutTips(db, payload) {
	const {
		gameId,
		accountId,
		cashoutId,
		rollerAmount,
		dealerAmount,
		rollerName,
		tipStatus,
		userId,
		dateNow
	} = payload;

	const parsedGameId = parseInt(gameId, 10);
	const parsedAccountId = parseInt(accountId, 10);
	const parsedCashoutId = parseInt(cashoutId, 10);

	if (!parsedGameId || !parsedAccountId || !parsedCashoutId) {
		throw new Error('Missing game, account, or cash-out reference for tip.');
	}

	const roller = parseTipAmount(rollerAmount);
	const dealer = parseTipAmount(dealerAmount);

	if (Number.isNaN(roller) || Number.isNaN(dealer)) {
		throw new Error('Invalid tip amounts.');
	}
	if (roller <= 0 && dealer <= 0) {
		throw new Error('Enter a Roller and/or Dealer tip amount.');
	}
	if ((roller > 0 || dealer > 0) && !parseRollerName(rollerName)) {
		throw new Error('Enter the roller name.');
	}
	if ((roller > 0 || dealer > 0) && !parseTipStatus(tipStatus)) {
		throw new Error('Enter the tip status (Roller or GM).');
	}

	const parsedRollerName = parseRollerName(rollerName);
	const parsedTipStatus = parseTipStatus(tipStatus);

	let programDate = null;
	if (payload.programDate) {
		const raw = String(payload.programDate).trim().slice(0, 10);
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) programDate = raw;
	}
	if (!programDate) {
		const [gameRows] = await db.execute(
			`SELECT DATE(PROGRAM_DATE) AS PROGRAM_DATE
			 FROM game_list
			 WHERE IDNo = ?
			 LIMIT 1`,
			[parsedGameId]
		);
		if (gameRows && gameRows[0] && gameRows[0].PROGRAM_DATE) {
			const raw = gameRows[0].PROGRAM_DATE;
			programDate = raw instanceof Date
				? [
						raw.getFullYear(),
						String(raw.getMonth() + 1).padStart(2, '0'),
						String(raw.getDate()).padStart(2, '0')
					].join('-')
				: String(raw).slice(0, 10);
		}
	}
	if (!programDate) {
		const d = dateNow instanceof Date ? dateNow : new Date(dateNow);
		programDate = [
			d.getFullYear(),
			String(d.getMonth() + 1).padStart(2, '0'),
			String(d.getDate()).padStart(2, '0')
		].join('-');
	}

	const rows = [];
	if (roller > 0) rows.push([TIP_TYPE.ROLLER, roller]);
	if (dealer > 0) rows.push([TIP_TYPE.DEALER, dealer]);

	for (const [tipType, amount] of rows) {
		await db.execute(
			`INSERT INTO tip (
				AMOUNT, GAME_ID, ACCOUNT_ID, TIP_TYPE, PROGRAM_DATE, CASHOUT_ID,
				ROLLER_NAME, TIP_STATUS, ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[amount, parsedGameId, parsedAccountId, tipType, programDate, parsedCashoutId, parsedRollerName, parsedTipStatus, userId, dateNow]
		);
	}
}

async function archiveTipsForCashout(db, cashoutId, userId, dateNow) {
	const parsedCashoutId = parseInt(cashoutId, 10);
	if (!parsedCashoutId) return;

	await db.execute(
		`UPDATE tip SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE CASHOUT_ID = ? AND ACTIVE = 1`,
		[userId, dateNow, parsedCashoutId]
	);
}

module.exports = {
	TIP_TYPE,
	CASHOUT_TRANSACTION,
	SQL_EXCLUDE_DEALER_TIP_CASHOUT,
	SQL_DASHBOARD_GAME_CASHOUT_FILTER,
	SQL_ROLLER_TIP_CASHOUT_ONLY,
	SQL_ROLLER_TIP_IN_CASHIN_ONLY,
	isTipEnabled,
	parseTipAmount,
	parseTipSplitAmounts,
	parseRollerName,
	parseTipStatus,
	saveCashoutTips,
	archiveTipsForCashout
};
