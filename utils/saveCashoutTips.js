const TIP_TYPE = {
	ROLLER: 1,
	DEALER: 2
};

function isTipEnabled(body) {
	const v = body && body.optTip;
	return v === '1' || v === 1 || v === true || v === 'on';
}

function parseTipAmount(raw) {
	const clean = String(raw || '').replace(/,/g, '').trim();
	if (clean === '') return 0;
	const n = Number(clean);
	return Number.isFinite(n) && n >= 0 ? n : NaN;
}

async function saveCashoutTips(db, payload) {
	const {
		gameId,
		accountId,
		cashoutId,
		rollerAmount,
		dealerAmount,
		expectedTotal,
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

	const tipTotal = roller + dealer;
	const expected = Number(expectedTotal) || 0;
	if (Math.abs(tipTotal - expected) > 0.001) {
		throw new Error('Roller + Dealer must equal total NN & CC chips.');
	}

	const rows = [];
	if (roller > 0) rows.push([TIP_TYPE.ROLLER, roller]);
	if (dealer > 0) rows.push([TIP_TYPE.DEALER, dealer]);

	for (const [tipType, amount] of rows) {
		await db.execute(
			`INSERT INTO tip (
				AMOUNT, GAME_ID, ACCOUNT_ID, TIP_TYPE, TIP_DATETIME, CASHOUT_ID,
				ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[amount, parsedGameId, parsedAccountId, tipType, dateNow, parsedCashoutId, userId, dateNow]
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
	isTipEnabled,
	parseTipAmount,
	saveCashoutTips,
	archiveTipsForCashout
};
