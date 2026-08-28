/**
 * Read-only Game Information rows sourced from the Game Book (game_list + game_record).
 *
 * The Game Book page computes BUY-IN / CASH-OUT / WIN-LOSS / ROLLING / COMMISSION /
 * TOTAL SETTLE on the client from raw game_record chip movements. This module ports the
 * same math server-side so the numbers shown on the Game Information page match the
 * Game Book exactly. These rows carry no manual_id, so the front-end treats them as
 * non-editable records.
 */

function isValidYmd(d) {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '').slice(0, 10));
}

/** Program-date filter for game_list, mirroring buildProgramDateWhere() for game_information. */
function buildGamebookProgramDateWhere(query) {
	const { date, programFrom, programTo } = query || {};
	let where = 'WHERE gl.ACTIVE != 0';
	const params = [];

	if (programFrom && programTo) {
		const fromS = String(programFrom).slice(0, 10);
		const toS = String(programTo).slice(0, 10);
		if (!isValidYmd(fromS) || !isValidYmd(toS)) {
			return { error: 'Invalid program date range. Use YYYY-MM-DD.' };
		}
		if (fromS > toS) {
			return { error: 'programFrom must be on or before programTo.' };
		}
		where += ' AND DATE(gl.PROGRAM_DATE) BETWEEN ? AND ?';
		params.push(fromS, toS);
	} else if (date && isValidYmd(String(date).slice(0, 10))) {
		where += ' AND DATE(gl.PROGRAM_DATE) = ?';
		params.push(String(date).slice(0, 10));
	}

	return { where, params };
}

/** Reduce one game's game_record rows into buy-in / cash-out / win-loss / rolling chips. */
function reduceGameRecords(records) {
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

	for (const rec of records || []) {
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

	return {
		buyIn: totalAmount,
		cashOut: totalCashOutChips,
		winLoss: totalAmount - totalCashOutChips,
		rolling: totalRollingChips
	};
}

/** Net commission, same rule as the Game Book: type 1/3 on |rolling|, type 2 on win/loss. */
function computeCommission(commissionType, commissionPercentage, rolling, winLoss) {
	const type = Number(commissionType);
	const rate = Number(commissionPercentage) || 0;
	if (!rate) return 0;
	if (type === 1 || type === 3) {
		return Math.round((Math.abs(rolling) * rate) / 100);
	}
	if (type === 2) {
		return Math.round((winLoss * rate) / 100);
	}
	return 0;
}

/**
 * Fetch Game Book games as read-only Game Information rows for the given date filter.
 * `query` accepts the same keys as the /game_information_data endpoint (date | programFrom+programTo).
 */
async function fetchGamebookGameInformationRows(pool, query) {
	const filter = buildGamebookProgramDateWhere(query);
	if (filter.error) return { error: filter.error };

	const [games] = await pool.execute(
		`SELECT
			gl.IDNo AS game_list_id,
			gl.PROGRAM_DATE,
			gl.ENCODED_DT AS GAME_START,
			gl.GAME_TYPE,
			gl.ACCOUNT_ID,
			gl.GUEST_ID,
			gl.COMMISSION_TYPE,
			gl.COMMISSION_PERCENTAGE,
			gl.GAME_ENDED,
			gl.SETTLED,
			NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(TRIM(ag.AGENT_CODE), ''), NULLIF(TRIM(ag.NAME), ''))), '') AS ACCOUNT_TEXT,
			ag.IDNo AS AGENT_ID,
			COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS GUEST_NAME,
			COALESCE((
				SELECT SUM(gs.AMOUNT)
				FROM game_services gs
				WHERE gs.GAME_ID = gl.IDNo
				  AND gs.ACTIVE = 1
				  AND gs.TRANSACTION_ID = 3
			), 0) AS ADD_CHARGE
		 FROM game_list gl
		 LEFT JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
		 LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 LEFT JOIN guest g ON g.IDNo = gl.GUEST_ID
		 ${filter.where}
		 ORDER BY gl.PROGRAM_DATE ASC, gl.IDNo ASC`,
		filter.params
	);

	if (!games.length) return { rows: [] };

	const ids = games.map((g) => g.game_list_id);
	const placeholders = ids.map(() => '?').join(', ');
	const [records] = await pool.execute(
		`SELECT GAME_ID, AMOUNT, NN_CHIPS, CC_CHIPS, CAGE_TYPE, ROLLER_TRANSACTION, ROLLER_CC_CHIPS
		 FROM game_record
		 WHERE ACTIVE != 0 AND GAME_ID IN (${placeholders})
		 ORDER BY GAME_ID ASC, IDNo ASC`,
		ids
	);

	const recordsByGame = {};
	for (const rec of records) {
		(recordsByGame[rec.GAME_ID] = recordsByGame[rec.GAME_ID] || []).push(rec);
	}

	const rows = games.map((game) => {
		const totals = reduceGameRecords(recordsByGame[game.game_list_id]);
		const commission = computeCommission(
			game.COMMISSION_TYPE,
			game.COMMISSION_PERCENTAGE,
			totals.rolling,
			totals.winLoss
		);
		const addCharge = Number(game.ADD_CHARGE) || 0;

		return {
			manual_id: null,
			SOURCE: 'gamebook',
			game_list_id: game.game_list_id,
			PROGRAM_DATE: game.PROGRAM_DATE,
			GAME_START: game.GAME_START,
			GAME_TYPE: game.GAME_TYPE,
			GAME_NO: String(game.game_list_id),
			ACCOUNT_ID: game.ACCOUNT_ID,
			GUEST_ID: game.GUEST_ID,
			ACCOUNT_TEXT: game.ACCOUNT_TEXT,
			AGENT_ID: game.AGENT_ID,
			GUEST_NAME: game.GUEST_NAME,
			BUY_IN: totals.buyIn,
			CASH_OUT: totals.cashOut,
			WIN_LOSS: totals.winLoss,
			ROLLING: totals.rolling,
			COMMISSION_TYPE: game.COMMISSION_TYPE,
			COMMISSION_PERCENTAGE: game.COMMISSION_PERCENTAGE,
			COMMISSION: commission,
			ADD_CHARGE: addCharge,
			TOTAL_SETTLEMENT: commission - addCharge,
			GAME_END_KIND: game.GAME_ENDED ? 'datetime' : 'end_game',
			GAME_ENDED: game.GAME_ENDED,
			SETTLED: game.SETTLED
		};
	});

	return { rows };
}

module.exports = {
	buildGamebookProgramDateWhere,
	reduceGameRecords,
	computeCommission,
	fetchGamebookGameInformationRows
};
