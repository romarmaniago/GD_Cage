const { SQL_HOUSE_EXPENSE_APPROVED_ONLY } = require('./houseExpenseQueries');
const { buildDashboardServiceExpensePayload } = require('./dashboardServiceBalance');
const { fetchActiveServiceCategories } = require('./serviceCategoryHelpers');
const { getMonthEndCutoffRange } = require('./monthEndCutoffRange');
const {
	SQL_DASHBOARD_GAME_CASHOUT_FILTER,
	SQL_EXCLUDE_DEALER_TIP_CASHOUT,
	SQL_ROLLER_TIP_CASHOUT_ONLY,
	SQL_ROLLER_TIP_IN_CASHIN_ONLY
} = require('./saveCashoutTips');
const { SQL_EXCLUDE_HOUSE_BALANCE_LEDGER_AL } = require('./junketCapitalTransfer');
const { getCreditGrandTotalSql } = require('./creditService');

function isYmd(value) {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function resolvePeriodDates(dateFrom, dateTo) {
	const from = String(dateFrom || '').trim().slice(0, 10);
	const to = String(dateTo || '').trim().slice(0, 10);
	if (isYmd(from) && isYmd(to)) {
		return from <= to ? { dateFrom: from, dateTo: to } : { dateFrom: to, dateTo: from };
	}
	const cutoff = getMonthEndCutoffRange();
	return {
		dateFrom: cutoff.startDate,
		dateTo: cutoff.endDateApi || cutoff.endDate
	};
}

async function sumScalar(pool, sql, params) {
	try {
		const [rows] = await pool.execute(sql, params);
		return Math.round(Number(rows && rows[0] && (rows[0].total ?? rows[0].TOTAL)) || 0);
	} catch (err) {
		console.error('dashboardPeriodSummary sumScalar:', err.message || err);
		return 0;
	}
}

function chipsDt(alias) {
	return `COALESCE(${alias}.PROGRAM_DATE, DATE(${alias}.ENCODED_DT))`;
}

function capitalDt(alias) {
	return `COALESCE(${alias}.PROGRAM_DATE, DATE(${alias}.ENCODED_DT))`;
}

function ledgerDt(alias) {
	return `DATE(${alias}.ENCODED_DT)`;
}

function gameDt(alias) {
	return `DATE(${alias}.PROGRAM_DATE)`;
}

async function computeWinLossForPeriod(pool, dateFrom, dateTo) {
	const [rows] = await pool.execute(
		`SELECT
			SUM(CASE WHEN gr.CAGE_TYPE = 1 THEN (gr.NN_CHIPS + gr.CC_CHIPS) ELSE 0 END) AS cashin,
			SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN (gr.NN_CHIPS + gr.CC_CHIPS) ELSE 0 END) AS cashout
		 FROM game_list gl
		 INNER JOIN game_record gr ON gr.GAME_ID = gl.IDNo
		 WHERE gr.ACTIVE = 1
			AND gl.ACTIVE != 0
			AND gl.PROGRAM_DATE IS NOT NULL
			AND ${gameDt('gl')} BETWEEN ? AND ?`,
		[dateFrom, dateTo]
	);
	const cashin = Number(rows && rows[0] && rows[0].cashin) || 0;
	const cashout = Number(rows && rows[0] && rows[0].cashout) || 0;
	return Math.round(cashin - cashout);
}

async function computeExpenseForPeriod(pool, dateFrom, dateTo) {
	return sumScalar(
		pool,
		`SELECT COALESCE(SUM(AMOUNT), 0) AS total
		 FROM junket_house_expense
		 WHERE ACTIVE = 1
			AND ${SQL_HOUSE_EXPENSE_APPROVED_ONLY}
			AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?`,
		[dateFrom, dateTo]
	);
}

async function computeJunketLossForPeriod(pool, dateFrom, dateTo) {
	return sumScalar(
		pool,
		`SELECT COALESCE(SUM(AMOUNT), 0) AS total
		 FROM junket_loss
		 WHERE ACTIVE = 1
			AND PROGRAM_DATE BETWEEN ? AND ?`,
		[dateFrom, dateTo]
	);
}

async function computeJunketCapitalBalanceForPeriod(pool, dateFrom, dateTo) {
	const p = [dateFrom, dateTo];
	const [deposit, withdraw] = await Promise.all([
		sumScalar(
			pool,
			`SELECT COALESCE(SUM(AMOUNT), 0) AS total
			 FROM junket_capital jc
			 WHERE jc.ACTIVE = 1
				AND jc.TRANSACTION_ID = 1
				AND ${capitalDt('jc')} BETWEEN ? AND ?`,
			p
		),
		sumScalar(
			pool,
			`SELECT COALESCE(SUM(AMOUNT), 0) AS total
			 FROM junket_capital jc
			 WHERE jc.ACTIVE = 1
				AND jc.TRANSACTION_ID = 2
				AND ${capitalDt('jc')} BETWEEN ? AND ?`,
			p
		)
	]);
	return Math.round(deposit - withdraw);
}

async function computeSoaForPeriod(pool, dateFrom, dateTo) {
	return sumScalar(
		pool,
		`SELECT COALESCE(SUM(AMOUNT), 0) AS total
		 FROM soa_fnb_hotel
		 WHERE ACTIVE = 1
			AND SOA_DATE BETWEEN ? AND ?`,
		[dateFrom, dateTo]
	);
}

async function computeAdditionalCommissionForPeriod(pool, dateFrom, dateTo) {
	return sumScalar(
		pool,
		`SELECT COALESCE(SUM(AMOUNT), 0) AS total
		 FROM additional_commission
		 WHERE ACTIVE = 1
			AND DATE(COALESCE(PROGRAM_DATE, ENCODED_DT)) BETWEEN ? AND ?`,
		[dateFrom, dateTo]
	);
}

async function computeCommissionSettlementForPeriod(pool, dateFrom, dateTo) {
	const [games] = await pool.execute(
		`SELECT
			gl.IDNo AS game_list_id,
			gl.COMMISSION_PERCENTAGE,
			gl.COMMISSION_TYPE
		 FROM game_list gl
		 WHERE gl.ACTIVE != 0
			AND gl.SETTLED = 1
			AND DATE(COALESCE(gl.GAME_ENDED, gl.ENCODED_DT)) BETWEEN ? AND ?
		 ORDER BY gl.IDNo ASC`,
		[dateFrom, dateTo]
	);

	if (!games || !games.length) return 0;

	let total = 0;
	for (const row of games) {
		const gameId = row.game_list_id;
		const rollingRate = Number(row.COMMISSION_PERCENTAGE) || 0;
		const commissionType = Number(row.COMMISSION_TYPE);
		if (!gameId || !rollingRate) continue;

		const [records] = await pool.execute(
			`SELECT AMOUNT, NN_CHIPS, CC_CHIPS, CAGE_TYPE, ROLLER_TRANSACTION, ROLLER_CC_CHIPS
			 FROM game_record
			 WHERE ACTIVE != 0 AND GAME_ID = ?
			 ORDER BY IDNo ASC`,
			[gameId]
		);
		if (!records || !records.length) continue;

		let totalNnInit = 0;
		let totalCcInit = 0;
		let totalNn = 0;
		let totalCc = 0;
		let totalCashOutNn = 0;
		let totalCashOutCc = 0;
		let totalRollingNn = 0;
		let totalRolling = 0;
		let totalRollingReal = 0;
		let totalRollingNnReal = 0;
		let totalRollingCcReal = 0;
		let totalRollerReturnCc = 0;

		for (const rec of records) {
			const cageType = Number(rec.CAGE_TYPE);
			if (cageType === 1 && (totalNnInit !== 0 || totalCcInit !== 0)) {
				totalNn += Number(rec.NN_CHIPS) || 0;
				totalCc += Number(rec.CC_CHIPS) || 0;
			}
			if (cageType === 1 && totalNnInit === 0 && totalCcInit === 0) {
				totalNnInit += Number(rec.NN_CHIPS) || 0;
				totalCcInit += Number(rec.CC_CHIPS) || 0;
			}
			if (cageType === 2) {
				totalCashOutNn += Number(rec.NN_CHIPS) || 0;
				totalCashOutCc += Number(rec.CC_CHIPS) || 0;
			}
			if (cageType === 3) {
				totalRolling += Number(rec.AMOUNT) || 0;
				totalRollingNn += Number(rec.NN_CHIPS) || 0;
			}
			if (cageType === 4) {
				totalRollingReal += Number(rec.AMOUNT) || 0;
				totalRollingNnReal += Number(rec.NN_CHIPS) || 0;
				totalRollingCcReal += Number(rec.CC_CHIPS) || 0;
			}
			if (cageType === 5) {
				const rollerTransaction = parseInt(rec.ROLLER_TRANSACTION, 10) || 1;
				if (rollerTransaction === 2) {
					totalRollerReturnCc += Number(rec.ROLLER_CC_CHIPS) || 0;
				}
			}
		}

		const totalInitial = totalNnInit + totalCcInit;
		const totalBuyInChips = totalNn + totalCc;
		const totalCashOutChips = totalCashOutNn + totalCashOutCc;
		const totalRollingChips =
			totalRollingNn +
			totalRollerReturnCc +
			totalRolling +
			totalRollingReal +
			totalRollingNnReal +
			totalRollingCcReal -
			totalCashOutNn;
		const totalAmount = totalBuyInChips + totalInitial;
		const winlossValue = totalAmount - totalCashOutChips;

		let net = 0;
		if (commissionType === 1 || commissionType === 3) {
			net = Math.round((totalRollingChips * rollingRate) / 100);
		} else if (commissionType === 2) {
			net = Math.round((winlossValue * rollingRate) / 100);
		}
		total += net;
	}

	return Math.round(total);
}

async function loadServiceExpenseDataForPeriod(pool, dateFrom, dateTo) {
	const dateFilter = `AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?`;
	const params = [dateFrom, dateTo];

	const [junketDepositRows] = await pool.execute(
		`SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
		 FROM game_services
		 WHERE ACTIVE = 1 AND TRANSACTION_ID = 2 AND SOURCE_TYPE = 'JUNKET'
			${dateFilter}
		 GROUP BY SERVICE_TYPE`,
		params
	);
	const [junketCashRows] = await pool.execute(
		`SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
		 FROM game_services
		 WHERE ACTIVE = 1 AND TRANSACTION_ID IN (1, 3) AND SOURCE_TYPE = 'JUNKET'
			${dateFilter}
		 GROUP BY SERVICE_TYPE`,
		params
	);
	const [guestDepositRows] = await pool.execute(
		`SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
		 FROM game_services
		 WHERE ACTIVE = 1 AND TRANSACTION_ID = 2 AND SOURCE_TYPE = 'GUEST'
			${dateFilter}
		 GROUP BY SERVICE_TYPE`,
		params
	);
	const [guestCashRows] = await pool.execute(
		`SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
		 FROM game_services
		 WHERE ACTIVE = 1 AND TRANSACTION_ID IN (1, 3) AND SOURCE_TYPE = 'GUEST'
			${dateFilter}
		 GROUP BY SERVICE_TYPE`,
		params
	);

	const categories = await fetchActiveServiceCategories(pool);
	return buildDashboardServiceExpensePayload(
		categories,
		junketCashRows || [],
		junketDepositRows || [],
		guestCashRows || [],
		guestDepositRows || []
	);
}

async function computeNnChipsForPeriod(pool, dateFrom, dateTo) {
	const p = [dateFrom, dateTo];
	const [
		nnBuyin,
		nnCashout,
		accountNn,
		cashOutRolling,
		realRolling,
		nnRolling,
		ccRolling,
		nnBuyinJ,
		nnReturnJ,
		rollerSub,
		rollerAdd,
		monthly
	] = await Promise.all([
		sumScalar(pool, `SELECT COALESCE(SUM(j.NN_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=1 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.NN_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=2 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.NN_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=1 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.NN_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=2 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=4 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.NN_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=3 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=3 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.NN_CHIPS),0) AS total FROM junket_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=1 AND DATE(j.ENCODED_DT) BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.NN_CHIPS),0) AS total FROM junket_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=2 AND DATE(j.ENCODED_DT) BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.ROLLER_NN_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=5 AND gr.ROLLER_TRANSACTION=1 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.ROLLER_NN_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=5 AND gr.ROLLER_TRANSACTION=2 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.NN_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=4 AND j.RESET=0 AND ${chipsDt('j')} BETWEEN ? AND ?`, p)
	]);

	return (
		nnBuyin -
		nnCashout -
		accountNn +
		cashOutRolling -
		realRolling +
		nnRolling +
		ccRolling +
		nnBuyinJ -
		nnReturnJ -
		rollerSub +
		rollerAdd -
		monthly
	);
}

async function computeCcChipsForPeriod(pool, dateFrom, dateTo) {
	const p = [dateFrom, dateTo];
	const [
		ccBuyin,
		ccCashout,
		realRolling,
		ccRolling,
		nnRolling,
		ccReturnAccount,
		ccBuyinGame,
		ccBuyinJ,
		ccReturnJ,
		rollerSub,
		rollerAdd,
		monthly
	] = await Promise.all([
		sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=1 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=2 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=4 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=3 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.NN_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=3 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=2 ${SQL_EXCLUDE_DEALER_TIP_CASHOUT} AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=1 AND gr.TRANSACTION IN (1,2,3) AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=1 AND DATE(j.ENCODED_DT) BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=2 AND DATE(j.ENCODED_DT) BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.ROLLER_CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=5 AND gr.ROLLER_TRANSACTION=1 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.ROLLER_CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=5 AND gr.ROLLER_TRANSACTION=2 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=4 AND j.RESET=0 AND ${chipsDt('j')} BETWEEN ? AND ?`, p)
	]);

	return (
		ccBuyin -
		ccCashout +
		realRolling -
		ccRolling -
		nnRolling +
		ccReturnAccount -
		ccBuyinGame +
		ccBuyinJ -
		ccReturnJ -
		rollerSub +
		rollerAdd -
		monthly
	);
}

async function computeCashForPeriod(pool, dateFrom, dateTo) {
	const p = [dateFrom, dateTo];
	const svcDate = 'COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?';

	const [
		cashDeposit,
		accountDeposit,
		settlementDeposit,
		chipsCashout,
		nnCashBuyin,
		ccCashBuyin,
		svcGuestCash,
		svcGuestDeposit,
		markerReturnCash,
		rollerTipCashin,
		tipInCashin,
		ccChipsBuyin,
		cashWithdraw,
		expense,
		nnChipsBuyin,
		accountWithdraw,
		gameCashout,
		accountSettlement,
		accountServices,
		markerIssue,
		svcJunketCash,
		svcJunketDeposit,
		accountTransfer,
		junketLoss,
		tipSettlement,
		mxCashNet
	] = await Promise.all([
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM junket_capital jc WHERE jc.ACTIVE=1 AND jc.TRANSACTION_ID=1 AND ${capitalDt('jc')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(al.AMOUNT),0) AS total FROM account_ledger al JOIN account a ON a.IDNo=al.ACCOUNT_ID JOIN agent ag ON ag.IDNo=a.AGENT_ID WHERE al.ACTIVE=1 AND al.TRANSACTION_TYPE=2 AND al.TRANSACTION_ID=1 AND ${SQL_EXCLUDE_HOUSE_BALANCE_LEDGER_AL} AND a.ACTIVE=1 AND ag.ACTIVE=1 AND ${ledgerDt('al')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(al.AMOUNT),0) AS total FROM account_ledger al JOIN account a ON a.IDNo=al.ACCOUNT_ID JOIN agent ag ON ag.IDNo=a.AGENT_ID WHERE al.ACTIVE=1 AND al.TRANSACTION_TYPE=5 AND al.TRANSACTION_ID=1 AND a.ACTIVE=1 AND ag.ACTIVE=1 AND ${ledgerDt('al')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.TOTAL_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=2 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.NN_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=1 AND gr.TRANSACTION=1 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=1 AND gr.TRANSACTION=1 AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=1 AND SOURCE_TYPE='GUEST' AND ${svcDate}`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=2 AND SOURCE_TYPE='GUEST' AND ${svcDate}`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(al.AMOUNT),0) AS total FROM account_ledger al JOIN account a ON a.IDNo=al.ACCOUNT_ID JOIN agent ag ON ag.IDNo=a.AGENT_ID WHERE al.ACTIVE=1 AND al.TRANSACTION_TYPE=3 AND al.TRANSACTION_ID=11 AND a.ACTIVE=1 AND ag.ACTIVE=1 AND ${ledgerDt('al')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.NN_CHIPS+gr.CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=2 ${SQL_ROLLER_TIP_CASHOUT_ONLY} AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM tip WHERE ACTIVE=1 ${SQL_ROLLER_TIP_IN_CASHIN_ONLY} AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=1 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM junket_capital jc WHERE jc.ACTIVE=1 AND jc.TRANSACTION_ID=2 AND ${capitalDt('jc')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM junket_house_expense WHERE ACTIVE=1 AND ${SQL_HOUSE_EXPENSE_APPROVED_ONLY} AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(j.NN_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=1 AND ${chipsDt('j')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(al.AMOUNT),0) AS total FROM account_ledger al JOIN account a ON a.IDNo=al.ACCOUNT_ID JOIN agent ag ON ag.IDNo=a.AGENT_ID WHERE al.ACTIVE=1 AND al.TRANSACTION_ID=2 AND al.TRANSACTION_DESC='ACCOUNT DETAILS' AND a.ACTIVE=1 AND ag.ACTIVE=1 AND ${ledgerDt('al')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(gr.NN_CHIPS+gr.CC_CHIPS),0) AS total FROM game_record gr INNER JOIN game_list gl ON gl.IDNo=gr.GAME_ID WHERE gr.ACTIVE=1 AND gr.CAGE_TYPE=2 ${SQL_DASHBOARD_GAME_CASHOUT_FILTER} AND ${gameDt('gl')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(al.AMOUNT),0) AS total FROM account_ledger al JOIN account a ON a.IDNo=al.ACCOUNT_ID JOIN agent ag ON ag.IDNo=a.AGENT_ID WHERE al.ACTIVE=1 AND al.TRANSACTION_TYPE=5 AND a.ACTIVE=1 AND ag.ACTIVE=1 AND ${ledgerDt('al')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(al.AMOUNT),0) AS total FROM account_ledger al JOIN account a ON a.IDNo=al.ACCOUNT_ID JOIN agent ag ON ag.IDNo=a.AGENT_ID WHERE al.ACTIVE=1 AND al.TRANSACTION_ID=2 AND al.TRANSACTION_DESC='SERVICES' AND a.ACTIVE=1 AND ag.ACTIVE=1 AND ${ledgerDt('al')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(al.AMOUNT),0) AS total FROM account_ledger al JOIN account a ON a.IDNo=al.ACCOUNT_ID JOIN agent ag ON ag.IDNo=a.AGENT_ID WHERE al.ACTIVE=1 AND al.TRANSACTION_ID=3 AND a.ACTIVE=1 AND ag.ACTIVE=1 AND ${ledgerDt('al')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=1 AND SOURCE_TYPE='JUNKET' AND ${svcDate}`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=2 AND SOURCE_TYPE='JUNKET' AND ${svcDate}`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(al.AMOUNT),0) AS total FROM account_ledger al JOIN account a ON a.IDNo=al.ACCOUNT_ID JOIN agent ag ON ag.IDNo=a.AGENT_ID WHERE al.ACTIVE=1 AND al.TRANSACTION_ID=1 AND al.TRANSFER=1 AND a.ACTIVE=1 AND ag.ACTIVE=1 AND ${ledgerDt('al')} BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM junket_loss WHERE ACTIVE=1 AND PROGRAM_DATE BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM tip_settlement WHERE ACTIVE=1 AND COALESCE(PROGRAM_DATE, DATE(SETTLEMENT_DATETIME)) BETWEEN ? AND ?`, p),
		sumScalar(pool, `
			SELECT COALESCE(SUM(
				CASE
					WHEN r.ID IS NOT NULL THEN COALESCE(r.MARGIN_RETURN, 0)
					WHEN in_ccy.CODE = 'PHP' AND ex_ccy.CODE <> 'PHP' THEN COALESCE(d.AMOUNT_IN, 0)
					WHEN ex_ccy.CODE = 'PHP' AND in_ccy.CODE <> 'PHP' THEN -COALESCE(d.EXCHANGE_AMOUNT, 0)
					ELSE 0
				END
			), 0) AS total
			FROM money_exchange_transaction d
			LEFT JOIN currency_master in_ccy ON in_ccy.ID = d.IN_CURRENCY_ID
			LEFT JOIN currency_master ex_ccy ON ex_ccy.ID = d.EXCHANGE_CURRENCY_ID
			LEFT JOIN money_exchange_transaction r ON r.SOURCE_DEPOSIT_ID = d.ID AND r.TRANS_TYPE = 2 AND r.ACTIVE = 1
			WHERE d.ACTIVE = 1 AND d.TRANS_TYPE = 1
				AND DATE(COALESCE(d.TRANS_DATETIME, d.ENCODED_DT)) BETWEEN ? AND ?`, p)
	]);

	const cashIn =
		cashDeposit +
		accountDeposit +
		settlementDeposit +
		chipsCashout +
		nnCashBuyin +
		ccCashBuyin +
		svcGuestCash +
		svcGuestDeposit +
		markerReturnCash +
		rollerTipCashin +
		tipInCashin;

	const cashOut =
		ccChipsBuyin +
		cashWithdraw +
		expense +
		nnChipsBuyin +
		accountWithdraw +
		gameCashout +
		accountSettlement +
		accountServices +
		markerIssue +
		svcJunketCash +
		svcJunketDeposit +
		accountTransfer +
		junketLoss +
		tipSettlement;

	return cashIn - cashOut + mxCashNet;
}

async function computeRcChipsForPeriod(pool, dateFrom, dateTo) {
	return sumScalar(
		pool,
		`SELECT COALESCE(SUM(GREATEST(0, balances.net_balance)), 0) AS total
		 FROM (
			SELECT
				gr.GAME_ID,
				SUM(
					CASE
						WHEN COALESCE(gr.ROLLER_TRANSACTION, 1) = 1
							THEN COALESCE(gr.ROLLER_NN_CHIPS, 0) + COALESCE(gr.ROLLER_CC_CHIPS, 0)
						WHEN gr.ROLLER_TRANSACTION = 2
							THEN -(COALESCE(gr.ROLLER_NN_CHIPS, 0) + COALESCE(gr.ROLLER_CC_CHIPS, 0))
						ELSE 0
					END
				) AS net_balance
			FROM game_record gr
			INNER JOIN game_list gl ON gl.IDNo = gr.GAME_ID
			WHERE gr.CAGE_TYPE = 5
				AND gr.ACTIVE = 1
				AND gl.ACTIVE != 0
				AND ${gameDt('gl')} BETWEEN ? AND ?
			GROUP BY gr.GAME_ID
		 ) balances
		 WHERE balances.net_balance > 0`,
		[dateFrom, dateTo]
	);
}

// Guest Line is all-time (not period-filtered), matching dashboard SSR guestBalance.
// Uses the canonical account-ledger formula shared with the Agency (LINE) page
// (/agency_line_stats) so the dashboard figure matches "Total Balance" there.
async function computeGuestBalanceForPeriod(pool) {
	return sumScalar(pool, `
		SELECT COALESCE(SUM(
			CASE
				WHEN tt.TRANSACTION IN ('DEPOSIT', 'MARKER REDEEM') THEN al.AMOUNT
				WHEN tt.TRANSACTION IN ('WITHDRAW', 'IOU RETURN DEPOSIT') THEN -al.AMOUNT
				ELSE 0
			END
		), 0) AS total
		FROM account_ledger al
		JOIN transaction_type tt ON tt.IDNo = al.TRANSACTION_ID
		JOIN account a ON a.IDNo = al.ACCOUNT_ID
		JOIN agent ag ON ag.IDNo = a.AGENT_ID
		WHERE al.ACTIVE = 1
		  AND al.TRANSACTION_TYPE IN (2, 3, 5)
		  AND a.ACTIVE = 1
		  AND ag.ACTIVE = 1
	`);
}

async function computeCreditGrandTotal(pool) {
	try {
		const [rows] = await pool.execute(getCreditGrandTotalSql());
		return Math.round(Number(rows && rows[0] && rows[0].JUNKET_CREDIT) || 0);
	} catch (err) {
		console.error('dashboardPeriodSummary computeCreditGrandTotal:', err.message || err);
		return 0;
	}
}

async function computeTipBalanceForPeriod(pool, dateFrom, dateTo) {
	const p = [dateFrom, dateTo];
	const [gross, settled] = await Promise.all([
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM tip WHERE ACTIVE=1 AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?`, p),
		sumScalar(pool, `SELECT COALESCE(SUM(AMOUNT),0) AS total FROM tip_settlement WHERE ACTIVE=1 AND COALESCE(PROGRAM_DATE, DATE(SETTLEMENT_DATETIME)) BETWEEN ? AND ?`, p)
	]);
	return Math.max(0, gross - settled);
}

async function computeManualCashForPeriod(pool, dateFrom, dateTo) {
	try {
		const [rows] = await pool.execute(
			`SELECT UPPER(CURRENCY) AS CURRENCY, COALESCE(SUM(AMOUNT), 0) AS total
			 FROM cage_manual_cash
			 WHERE ACTIVE = 1
				AND REPORT_DATE BETWEEN ? AND ?
			 GROUP BY UPPER(CURRENCY)`,
			[dateFrom, dateTo]
		);
		const map = { USD: 0, GCASH: 0 };
		(rows || []).forEach((row) => {
			const code = String(row.CURRENCY || '').toUpperCase();
			map[code] = Math.round(Number(row.total) || 0);
		});
		return map;
	} catch (err) {
		return { USD: 0, GCASH: 0 };
	}
}

async function computeRollingForPeriod(pool, dateFrom, dateTo) {
	const p = [dateFrom, dateTo];
	// Actual Rolling = CC rolling chips only from junket_total_chips (TRANSACTION_ID 3),
	// i.e. the exact "Rolling" (rolling_cc) component of the Main Cage Rolling Check
	// table. No NN, cash-out, buy-in or roller-return adjustments. Date-filtered on
	// PROGRAM_DATE (fallback ENCODED_DT), matching the Rolling Check grid query.
	return sumScalar(pool, `SELECT COALESCE(SUM(j.CC_CHIPS),0) AS total FROM junket_total_chips j WHERE j.ACTIVE=1 AND j.TRANSACTION_ID=3 AND COALESCE(j.PROGRAM_DATE, DATE(j.ENCODED_DT)) BETWEEN ? AND ?`, p);
}

async function computeCageMainForPeriod(pool, dateFrom, dateTo) {
	const [nn, cc, cash, rc, guest, credit, tip, manual, rolling] = await Promise.all([
		computeNnChipsForPeriod(pool, dateFrom, dateTo),
		computeCcChipsForPeriod(pool, dateFrom, dateTo),
		computeCashForPeriod(pool, dateFrom, dateTo),
		computeRcChipsForPeriod(pool, dateFrom, dateTo),
		computeGuestBalanceForPeriod(pool),
		computeCreditGrandTotal(pool),
		computeTipBalanceForPeriod(pool, dateFrom, dateTo),
		computeManualCashForPeriod(pool, dateFrom, dateTo),
		computeRollingForPeriod(pool, dateFrom, dateTo)
	]);

	const nnChips = Math.round(nn);
	const ccChips = Math.round(cc);
	const phpCash = Math.round(cash);
	const totalChips = nnChips + ccChips;
	const houseBalance = phpCash + totalChips;

	return {
		usd: Math.round(Number(manual.USD) || 0),
		gcash: Math.round(Number(manual.GCASH) || 0),
		php_cash: phpCash,
		nn_chips: nnChips,
		cc_chips: ccChips,
		rc_chips: Math.round(rc),
		total_chips: totalChips,
		house_balance: houseBalance,
		cage_balance_total: houseBalance,
		cage_balance_diff: 0,
		guest_balance: Math.round(guest),
		credit: Math.round(credit),
		tip_balance: Math.round(tip),
		actual_rolling: Math.round(rolling)
	};
}

/**
 * Period totals for all dashboard amount panels (date-filtered like other pages).
 */
async function computeDashboardPeriodSummary(pool, dateFromInput, dateToInput) {
	const { dateFrom, dateTo } = resolvePeriodDates(dateFromInput, dateToInput);

	const [
		winLoss,
		expense,
		junketLoss,
		soa,
		additionalCommission,
		commissionSettlement,
		servicePayload,
		cageMain,
		companyCapitalBalance
	] = await Promise.all([
		computeWinLossForPeriod(pool, dateFrom, dateTo),
		computeExpenseForPeriod(pool, dateFrom, dateTo),
		computeJunketLossForPeriod(pool, dateFrom, dateTo),
		computeSoaForPeriod(pool, dateFrom, dateTo),
		computeAdditionalCommissionForPeriod(pool, dateFrom, dateTo),
		computeCommissionSettlementForPeriod(pool, dateFrom, dateTo),
		loadServiceExpenseDataForPeriod(pool, dateFrom, dateTo),
		computeCageMainForPeriod(pool, dateFrom, dateTo),
		computeJunketCapitalBalanceForPeriod(pool, dateFrom, dateTo)
	]);

	const serviceCategories = Array.isArray(servicePayload && servicePayload.categories)
		? servicePayload.categories
		: [];
	const serviceJunketOutTotal = Math.round(
		Number(servicePayload && servicePayload.junketOutTotal) ||
			serviceCategories.reduce((sum, cat) => sum + (Number(cat.junketOut) || 0), 0)
	);

	const companyExpenseBase = expense + junketLoss + commissionSettlement + additionalCommission;
	const serviceBalanceTotal = Math.round(
		serviceCategories.reduce((sum, cat) => sum + (Number(cat.balance) || 0), 0)
	);
	// "Company" section total = base costs minus the net service balance shown in the rows.
	const companyExpenseTotal = companyExpenseBase - serviceBalanceTotal;
	const mainAvailableAmount = Math.round(
		companyCapitalBalance
		- (Number(cageMain.credit) || 0)
		- expense
		- junketLoss
		- commissionSettlement
		- additionalCommission
		+ serviceBalanceTotal
	);

	return {
		date_from: dateFrom,
		date_to: dateTo,
		win_loss: winLoss,
		expense,
		junket_loss: junketLoss,
		soa,
		additional_commission: additionalCommission,
		commission_settlement: commissionSettlement,
		service_categories: serviceCategories,
		service_junket_out_total: serviceJunketOutTotal,
		company_expense_base: companyExpenseBase,
		company_expense_total: companyExpenseTotal,
		company_capital_balance: companyCapitalBalance,
		main_available_amount: mainAvailableAmount,
		cage: cageMain
	};
}

module.exports = {
	resolvePeriodDates,
	computeDashboardPeriodSummary
};
