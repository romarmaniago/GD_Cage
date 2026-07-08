const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const router = express.Router();
const pool = require('../config/db');

const { checkSession, sessions } = require('./auth');
const { sendTelegramMessage, sendTelegramToAdditionalChats, sendTelegramToManagement } = require('../utils/telegram');
const dashboardQueries = require('../utils/dashboardQueries');
const { applyCommaThousandsToNumericCells } = require('../utils/excelAmountFormat');
const { getAgentTelegramChatId } = require('../utils/agentTelegram');
const { getEnabledChatIds } = require('../utils/telegramChatIds');
const { isTipEnabled, parseTipSplitAmounts, saveCashoutTips, archiveTipsForCashout, CASHOUT_TRANSACTION, parseRollerName, parseTipStatus } = require('../utils/saveCashoutTips');

/** Junket/house account used when resolving pending via New Game (account.IDNo). */
const PENDING_JUNKET_RESOLVE_ACCOUNT_ID = -1;

// Helper function to get agent notification chat IDs from telegram_api table
// Returns all chat IDs stored in AGENT_CHATID column (for INF501-INF599 notifications)
async function getAgentNotificationChatIds() {
	try {
		// Query telegram_api table for GUEST user type with AGENT_CHATID column
		const [rows] = await pool.execute(
			'SELECT AGENT_CHATID FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
			['GUEST']
		);
		
		if (rows.length === 0 || !rows[0].AGENT_CHATID) return [];
		return getEnabledChatIds(rows[0].AGENT_CHATID);
	} catch (error) {
		// If AGENT_CHATID column doesn't exist yet, return empty array
		console.warn('Error fetching agent notification chat IDs (AGENT_CHATID column may not exist):', error.message);
		return [];
	}
}

// Helper function to send message to agent notification chat IDs
// options: { logPreview?: string, logMeta?: { accountCode, guestName, amount } } — forwarded to sendTelegramMessage
async function sendToAgentNotifications(agentCode, messageText, options = {}) {
	if (!agentCode || !messageText) return;

	// Check if agent code is between INF501 and INF599 (case-insensitive)
	const agentCodeUpper = String(agentCode).toUpperCase();
	const isInRange = agentCodeUpper >= 'INF501' && agentCodeUpper <= 'INF599';

	if (!isInRange) return; // Only send notifications for INF501-INF599

	try {
		const chatIds = await getAgentNotificationChatIds();

		if (chatIds.length === 0) {
			return; // No notifications configured
		}

		// Send to each configured chat ID
		for (const chatId of chatIds) {
			try {
				await sendTelegramMessage(messageText, chatId, options || {});
			} catch (error) {
				console.error(`Error sending message to chat ID ${chatId} for agent ${agentCode}:`, error.message);
				// Continue sending to other chat IDs even if one fails
			}
		}
	} catch (error) {
		console.error('Error in sendToAgentNotifications:', error.message);
		// Continue execution even if notification fails
	}
}

/**
 * Build a Telegram send options bag for gamebook events.
 * Stores the short English `logPreview` label (with optional `· #gameId` suffix) in
 * `telegram_send_log.message_preview` and the structured `accountCode`/`guestName`/`amount`
 * in dedicated columns — so the Telegram message log UI doesn't have to parse the bilingual body.
 */
function gamebookTelegramOpts(label, accountCode, guestName, amount, gameId) {
	const gid = gameId != null && String(gameId).trim() !== '' ? String(gameId).trim() : '';
	const previewLabel = gid ? `${label} · Game #${gid}` : label;
	return {
		logPreview: previewLabel,
		logMeta: {
			accountCode: accountCode || '',
			guestName: guestName || '',
			amount: Math.abs(Number(amount) || 0)
		}
	};
}

/** LIVE / TELEBET (+ legacy 라이브·텔레벳) → agent vs management display strings */
function normalizeTelegramGameTypeKey(raw) {
	if (raw == null || String(raw).trim() === '') return null;
	const s = String(raw).trim();
	const u = s.toUpperCase();
	if (u === 'LIVE' || s === '라이브') return 'LIVE';
	if (u === 'TELEBET' || s === '텔레벳') return 'TELEBET';
	return null;
}

function telegramGameTypeLabels(rawGameType) {
	if (rawGameType == null || String(rawGameType).trim() === '') {
		return { agentText: '', managementText: '' };
	}
	const norm = normalizeTelegramGameTypeKey(rawGameType);
	if (norm === 'LIVE') {
		return { agentText: '라이브', managementText: '라이브 LIVE' };
	}
	if (norm === 'TELEBET') {
		return { agentText: '아바타', managementText: '아바타 AVATAR' };
	}
	const fallback = String(rawGameType).trim();
	return { agentText: fallback, managementText: fallback };
}

/** Settlement Telegram: extra lines after game # */
function telegramSettlementGameTypeLines(rawGameType) {
	const { agentText, managementText } = telegramGameTypeLabels(rawGameType);
	if (!agentText) return { agentLine: '', managementLine: '' };
	return {
		agentLine: `\n게임 유형 : ${agentText}`,
		managementLine: `\n게임 유형 Game type : ${managementText}`
	};
}

const SETTLEMENT_GAME_RECORD_TOTALS_SQL = `SELECT IDNo, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, CAGE_TYPE FROM game_record WHERE ACTIVE != 0 AND GAME_ID = ? ORDER BY IDNo ASC`;

/** Mirror of public computeRollerChipsBalanceFromRecords (game_list.js). */
function computeRollerChipsBalanceFromRecordsNode(rows) {
	let totalRollerNn = 0;
	let totalRollerCc = 0;
	let totalAddNN = 0;
	let totalAddCC = 0;
	let totalReturnNN = 0;
	let totalReturnCC = 0;

	for (const row of rows || []) {
		if (parseInt(row.CAGE_TYPE, 10) !== 5) continue;
		let rollerTransaction = parseInt(row.ROLLER_TRANSACTION, 10);
		if (Number.isNaN(rollerTransaction) || rollerTransaction === 0) rollerTransaction = 1;
		const nn = Number(row.ROLLER_NN_CHIPS) || 0;
		const cc = Number(row.ROLLER_CC_CHIPS) || 0;
		if (rollerTransaction === 1) {
			totalRollerNn += nn;
			totalRollerCc += cc;
			totalAddNN += nn;
			totalAddCC += cc;
		} else if (rollerTransaction === 2) {
			totalRollerNn -= nn;
			totalRollerCc -= cc;
			totalReturnNN += nn;
			totalReturnCC += cc;
		}
	}

	const netNNRaw = totalRollerNn;
	const netCCRaw = totalRollerCc;
	const combinedNet = Math.max(0, netNNRaw + netCCRaw);
	let transferNN = 0;
	let transferCC = 0;
	if (combinedNet > 0) {
		if (netNNRaw >= 0 && netCCRaw > 0) {
			transferNN = netNNRaw;
			transferCC = netCCRaw;
		} else if (netNNRaw >= 0 && netCCRaw <= 0) {
			transferNN = combinedNet;
			transferCC = 0;
		} else if (netNNRaw < 0 && netCCRaw >= 0) {
			transferNN = 0;
			transferCC = combinedNet;
		} else {
			transferNN = combinedNet;
			transferCC = 0;
		}
	}

	return {
		netNNRaw,
		netCCRaw,
		combinedNet,
		transferNN,
		transferCC,
		requiredReturnTotal: combinedNet
	};
}

/** Roller chips on continuation game: same total as parent (all as NN); last rolling CC is returned on parent only. */
function computeCutoffTransferRollerNN(rollerTotals) {
	return Math.max(0, rollerTotals.combinedNet || 0);
}

async function getRollerTotalsForGame(db, gameId) {
	const [rows] = await db.execute(SETTLEMENT_GAME_RECORD_TOTALS_SQL, [gameId]);
	return computeRollerChipsBalanceFromRecordsNode(rows);
}

function parseChipAmount(raw) {
	return parseFloat(String(raw || '0').replace(/,/g, '')) || 0;
}

function initialMopToTransType(initialMop) {
	const m = String(initialMop || '').trim().toUpperCase();
	if (m === 'CASH') return 1;
	if (m === 'DEPOSIT') return 2;
	if (m === 'IOU') return 3;
	return null;
}

async function resolveParentTransType(db, parentGameId, initialMop) {
	const transType = initialMopToTransType(initialMop);
	if (transType) return transType;
	const [rows] = await db.execute(
		`SELECT TRANSACTION FROM game_record
		 WHERE GAME_ID = ? AND ACTIVE != 0 AND CAGE_TYPE IN (1, 3) AND TRANSACTION IS NOT NULL
		 ORDER BY IDNo ASC LIMIT 1`,
		[parentGameId]
	);
	return parseInt(rows[0]?.TRANSACTION, 10) || 1;
}

function isCutoffSplitEnabled(body) {
	return (
		body.txtCutoffUseSplit === '1' ||
		body.txtCutoffUseSplit === 1 ||
		String(body.txtCutoffUseSplit || '').toLowerCase() === 'true'
	);
}

function buildCutoffParentCashoutLegs(body, parentTransType) {
	const nn = parseChipAmount(body.txtCutoffRemainingNN || body.txtCutoffBuyInNN);
	const cc = parseChipAmount(body.txtCutoffRemainingCC || body.txtCutoffBuyInCC);
	if (nn + cc <= 0) {
		return [];
	}
	return [{ nn, cc, transType: parentTransType }];
}

function buildCutoffSplitBuyInLegs(body) {
	if (!isCutoffSplitEnabled(body)) {
		return [];
	}
	return [
		{ nn: parseChipAmount(body.txtCutoffCashNN), cc: parseChipAmount(body.txtCutoffCashCC), transType: 1 },
		{ nn: parseChipAmount(body.txtCutoffDepNN), cc: parseChipAmount(body.txtCutoffDepCC), transType: 2 },
		{ nn: parseChipAmount(body.txtCutoffCreditNN), cc: parseChipAmount(body.txtCutoffCreditCC), transType: 4 }
	].filter((leg) => leg.nn + leg.cc > 0);
}

function buildCutoffNewGameBuyInLegs(body, parentTransType) {
	const legs = buildCutoffParentCashoutLegs(body, parentTransType);
	legs.push(...buildCutoffSplitBuyInLegs(body));
	return legs;
}

function parseCutoffTips(body) {
	return {
		rollerNn: parseChipAmount(body.txtCutoffTipRollerNn),
		rollerCc: parseChipAmount(body.txtCutoffTipRollerCc),
		dealerNn: parseChipAmount(body.txtCutoffTipDealerNn),
		dealerCc: parseChipAmount(body.txtCutoffTipDealerCc)
	};
}

function isInGameSplitEnabled(body) {
	return (
		body.txtInGameUseSplit === '1' ||
		body.txtInGameUseSplit === 1 ||
		String(body.txtInGameUseSplit || '').toLowerCase() === 'true'
	);
}

function buildInGameParentCashoutLegs(body, parentTransType) {
	const nn = parseChipAmount(body.txtInGameRemainingNN || body.txtInGameBuyInNN);
	const cc = parseChipAmount(body.txtInGameRemainingCC || body.txtInGameBuyInCC);
	if (nn + cc <= 0) {
		return [];
	}
	return [{ nn, cc, transType: parentTransType }];
}

function buildInGameSplitBuyInLegs(body) {
	if (!isInGameSplitEnabled(body)) {
		return [];
	}
	return [
		{ nn: parseChipAmount(body.txtInGameCashNN), cc: parseChipAmount(body.txtInGameCashCC), transType: 1 },
		{ nn: parseChipAmount(body.txtInGameDepNN), cc: parseChipAmount(body.txtInGameDepCC), transType: 2 },
		{ nn: parseChipAmount(body.txtInGameCreditNN), cc: parseChipAmount(body.txtInGameCreditCC), transType: 4 }
	].filter((leg) => leg.nn + leg.cc > 0);
}

function buildInGameCommissionBuyInLeg(payment) {
	const total = Math.max(0, parseChipAmount(payment));
	if (total <= 0) {
		return null;
	}
	const nn = Math.floor(total / 1000) * 1000;
	const cc = total - nn;
	return { nn, cc, transType: 1 };
}

function buildInGameNewGameBuyInLegs(body, parentTransType, commissionPayment) {
	const legs = buildInGameParentCashoutLegs(body, parentTransType);
	const commissionLeg = buildInGameCommissionBuyInLeg(commissionPayment);
	if (commissionLeg) {
		legs.push(commissionLeg);
	}
	legs.push(...buildInGameSplitBuyInLegs(body));
	return legs;
}

function parseInGameTips(body) {
	return {
		rollerNn: parseChipAmount(body.txtInGameTipRollerNn),
		rollerCc: parseChipAmount(body.txtInGameTipRollerCc),
		dealerNn: parseChipAmount(body.txtInGameTipDealerNn),
		dealerCc: parseChipAmount(body.txtInGameTipDealerCc)
	};
}

function projectInGameSettlementMetrics({ rolling, winLoss, commissionType, commissionRate, servicesTotal }, body) {
	const tips = parseInGameTips(body || {});
	const remainingNn = parseChipAmount(body?.txtInGameRemainingNN || body?.txtInGameBuyInNN);
	const remainingCc = parseChipAmount(body?.txtInGameRemainingCC || body?.txtInGameBuyInCC);
	const lastRolling = parseChipAmount(body?.txtInGameLastRolling);

	const additionalCashoutNn = remainingNn + tips.rollerNn + tips.dealerNn;
	const additionalCashoutCc = remainingCc + tips.rollerCc + tips.dealerCc;
	const projectedRolling = rolling - additionalCashoutNn + lastRolling;
	const projectedWinLoss = winLoss - additionalCashoutNn - additionalCashoutCc;
	const commissionGross = computeReceiptCommission(
		{ COMMISSION_TYPE: commissionType, COMMISSION_PERCENTAGE: commissionRate },
		projectedWinLoss,
		projectedRolling
	);
	const payment = commissionGross - (servicesTotal || 0);

	return {
		commissionGross,
		payment,
		projectedRolling,
		projectedWinLoss
	};
}

function buyinTransTypeForCutoffLeg(transType) {
	return transType === 4 ? 3 : transType;
}

async function insertCutoffTipRecords(db, { parentGameId, parentAccountId, encodedBy, dateNow, tips, rollerName, tipStatus }) {
	const rollerLeg = tips.rollerNn + tips.rollerCc;
	const dealerLeg = tips.dealerNn + tips.dealerCc;
	if (rollerLeg <= 0 && dealerLeg <= 0) {
		return;
	}

	let resolvedRollerName = parseRollerName(rollerName);
	if (!resolvedRollerName) {
		const [nameRows] = await db.execute(
			`SELECT COALESCE(NULLIF(TRIM(g.NAME), ''), agent.NAME, '-') AS tip_name
			 FROM game_list gl
			 JOIN account ON account.IDNo = gl.ACCOUNT_ID
			 JOIN agent ON agent.IDNo = account.AGENT_ID
			 LEFT JOIN guest g ON g.IDNo = gl.GUEST_ID
			 WHERE gl.IDNo = ? LIMIT 1`,
			[parentGameId]
		);
		resolvedRollerName = parseRollerName(nameRows[0]?.tip_name) || '-';
	}
	const resolvedTipStatus = parseTipStatus(tipStatus) || 'Roller';

	const gameRecordSQL = `
		INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;

	if (rollerLeg > 0) {
		const [rollerResult] = await db.execute(gameRecordSQL, [
			parentGameId,
			dateNow,
			2,
			0,
			tips.rollerNn,
			tips.rollerCc,
			CASHOUT_TRANSACTION.TIP_ROLLER,
			encodedBy,
			dateNow
		]);
		await saveCashoutTips(db, {
			gameId: parentGameId,
			accountId: parentAccountId,
			cashoutId: rollerResult.insertId,
			rollerAmount: rollerLeg,
			dealerAmount: 0,
			rollerName: resolvedRollerName,
			tipStatus: resolvedTipStatus,
			userId: encodedBy,
			dateNow
		});
	}

	if (dealerLeg > 0) {
		const [dealerResult] = await db.execute(gameRecordSQL, [
			parentGameId,
			dateNow,
			2,
			0,
			tips.dealerNn,
			tips.dealerCc,
			CASHOUT_TRANSACTION.TIP_DEALER,
			encodedBy,
			dateNow
		]);
		await saveCashoutTips(db, {
			gameId: parentGameId,
			accountId: parentAccountId,
			cashoutId: dealerResult.insertId,
			rollerAmount: 0,
			dealerAmount: dealerLeg,
			rollerName: resolvedRollerName,
			tipStatus: resolvedTipStatus,
			userId: encodedBy,
			dateNow
		});
	}
}

async function insertCutoffCashoutLeg(db, {
	parentGameId,
	parentAccountId,
	leg,
	encodedBy,
	dateNow,
	agentQuery
}) {
	const legTotal = leg.nn + leg.cc;
	if (legTotal <= 0) {
		return null;
	}

	const gameRecordSQL = `
		INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const [cashoutResult] = await db.execute(gameRecordSQL, [
		parentGameId,
		dateNow,
		2,
		0,
		leg.nn,
		leg.cc,
		leg.transType,
		encodedBy,
		dateNow
	]);

	if (leg.transType === 2) {
		await db.execute(
			`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[parentAccountId, parentGameId, 1, 2, 'Chips Returned', legTotal, encodedBy, dateNow]
		);
	} else if (leg.transType === 4) {
		await db.execute(
			`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[parentAccountId, parentGameId, 1, 4, 'Chips Returned', legTotal, encodedBy, dateNow]
		);
	} else {
		await db.execute(
			`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[parentAccountId, parentGameId, 1, leg.transType, 'Chips Returned', legTotal, encodedBy, dateNow]
		);
	}

	if (leg.transType === 1) {
		const [agentRows] = await db.execute(agentQuery, [parentAccountId]);
		if (agentRows.length > 0 && agentRows[0].agent_id) {
			await db.execute(
				`INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					cashoutResult.insertId,
					agentRows[0].agent_id,
					legTotal.toString(),
					'Game Cash-out',
					2,
					`Game - ${parentGameId}`,
					encodedBy,
					dateNow
				]
			);
		}
	}

	return cashoutResult.insertId;
}

async function insertCutoffBuyinLeg(db, {
	newGameId,
	parentAccountId,
	leg,
	encodedBy,
	dateNow,
	tradingDateNew,
	agentQuery
}) {
	const legTotal = leg.nn + leg.cc;
	if (legTotal <= 0) {
		return;
	}

	const buyinTransType = buyinTransTypeForCutoffLeg(leg.transType);
	const gameRecordSQL = `
		INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;

	await db.execute(gameRecordSQL, [
		newGameId,
		tradingDateNew,
		1,
		0,
		leg.nn,
		leg.cc,
		buyinTransType,
		encodedBy,
		dateNow
	]);
	await db.execute(gameRecordSQL, [
		newGameId,
		tradingDateNew,
		3,
		0,
		leg.nn,
		leg.cc,
		buyinTransType,
		encodedBy,
		dateNow
	]);

	if (buyinTransType === 2) {
		await db.execute(
			`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[parentAccountId, newGameId, 2, buyinTransType, 'INITIAL BUY-IN', legTotal, encodedBy, dateNow]
		);
	} else if (buyinTransType === 3) {
		await db.execute(
			`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[parentAccountId, newGameId, 10, buyinTransType, legTotal, `Buy-in Game: ${newGameId}`, encodedBy, dateNow]
		);
	}

	if (buyinTransType === 1) {
		const [agentRows] = await db.execute(agentQuery, [parentAccountId]);
		if (agentRows.length > 0 && agentRows[0].agent_id) {
			await db.execute(
				`INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					newGameId,
					agentRows[0].agent_id,
					legTotal.toString(),
					'Game buy-in',
					1,
					`Game - ${newGameId}`,
					encodedBy,
					dateNow
				]
			);
		}
	}
}

/**
 * CUT OFF: end parent game, cashout buy-in on parent, last rolling on parent (ROLLING + roller return),
 * create continuation game with same buy-in and roller chips.
 */
async function performGameCutoff(db, params) {
	const {
		parentGameId,
		encodedBy,
		dateNow,
		programDate,
		cashoutLegs,
		buyInLegs,
		lastRollingCC,
		tips,
		rollerName,
		tipStatus
	} = params;

	const [parentRows] = await db.execute(
		`SELECT ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ACTIVE
		 FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1`,
		[parentGameId]
	);
	if (!parentRows.length) {
		const err = new Error('Parent game not found.');
		err.statusCode = 404;
		throw err;
	}
	const parent = parentRows[0];
	const parentActive = parseInt(parent.ACTIVE, 10);
	if (parentActive !== 2) {
		const err = new Error('Only ON GAME games can be cut off.');
		err.statusCode = 400;
		throw err;
	}

	const parentAccountId = parseInt(parent.ACCOUNT_ID, 10);
	const transType = await resolveParentTransType(db, parentGameId, parent.INITIAL_MOP);
	const parentCashoutLegs = Array.isArray(cashoutLegs) && cashoutLegs.length ? cashoutLegs : [];
	const newGameBuyInLegs = Array.isArray(buyInLegs) && buyInLegs.length ? buyInLegs : [];
	const cutoffTips = tips || { rollerNn: 0, rollerCc: 0, dealerNn: 0, dealerCc: 0 };
	const rollerTotals = await getRollerTotalsForGame(db, parentGameId);
	const totalRollerBalance = Math.max(0, rollerTotals.combinedNet || 0);
	const parentNetNN = Math.max(0, rollerTotals.netNNRaw || 0);
	const parentNetCC = Math.max(0, rollerTotals.netCCRaw || 0);
	const transferRollerNN = computeCutoffTransferRollerNN(rollerTotals);
	const lastRolling = Math.max(0, lastRollingCC);
	const lastRollingNnReturn = Math.min(lastRolling, parentNetNN);
	const lastRollingCcReturn = Math.max(0, lastRolling - lastRollingNnReturn);
	const remainingNnReturnOnParent = Math.max(0, parentNetNN - lastRollingNnReturn);
	const remainingCcReturnOnParent = Math.max(0, parentNetCC - lastRollingCcReturn);
	const buyInNN = newGameBuyInLegs.reduce((sum, leg) => sum + leg.nn, 0);
	const buyInCC = newGameBuyInLegs.reduce((sum, leg) => sum + leg.cc, 0);
	const buyInTotal = buyInNN + buyInCC;

	const allNnLegs = [...parentCashoutLegs, ...newGameBuyInLegs];
	for (const leg of allNnLegs) {
		if (leg.nn > 0 && leg.nn % 1000 !== 0) {
			const err = new Error('Remaining NN Chips must be in thousands.');
			err.statusCode = 400;
			throw err;
		}
	}
	if (cutoffTips.rollerNn > 0 && cutoffTips.rollerNn % 1000 !== 0) {
		const err = new Error('Tip Roller NN Chips must be in thousands.');
		err.statusCode = 400;
		throw err;
	}
	if (cutoffTips.dealerNn > 0 && cutoffTips.dealerNn % 1000 !== 0) {
		const err = new Error('Tip Dealer NN Chips must be in thousands.');
		err.statusCode = 400;
		throw err;
	}
	if (lastRollingCC > 0 && lastRollingCC > totalRollerBalance + 0.001) {
		const err = new Error(
			`Last Rolling (${lastRollingCC}) exceeds available roller chips balance (${totalRollerBalance}).`
		);
		err.statusCode = 400;
		throw err;
	}

	const tradingDateNew = parseProgramDateAsDateTime(programDate);
	const initialMOP = { 1: 'CASH', 2: 'DEPOSIT', 3: 'IOU' }[transType] || parent.INITIAL_MOP;

	const rollerChipsSQL = `
		INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const agentQuery = `
		SELECT agent.IDNo AS agent_id, agent.AGENT_CODE, agent.NAME
		FROM agent
		JOIN account ON account.AGENT_ID = agent.IDNo
		WHERE account.ACTIVE = 1 AND account.IDNo = ?
	`;

	await insertCutoffTipRecords(db, {
		parentGameId,
		parentAccountId,
		encodedBy,
		dateNow,
		tips: cutoffTips,
		rollerName,
		tipStatus
	});

	// 1. End parent game
	await db.execute(
		`UPDATE game_list SET ACTIVE = 1, GAME_ENDED = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
		[dateNow, encodedBy, dateNow, parentGameId]
	);

	// 2. Cashout on parent (remaining chips → chips returned)
	for (const leg of parentCashoutLegs) {
		await insertCutoffCashoutLeg(db, {
			parentGameId,
			parentAccountId,
			leg,
			encodedBy,
			dateNow,
			agentQuery
		});
	}

	const rollingRecordSQL = `
		INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, NN_CHIPS, CC_CHIPS, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`;

	// 3. Last rolling → ROLLING column (CAGE_TYPE 4) + roller return on parent
	// NN portion: CAGE_TYPE 4 adds to rolling; CC-only excess uses CC roller return (also adds to rolling)
	if (lastRollingNnReturn > 0) {
		await db.execute(rollingRecordSQL, [
			parentGameId,
			dateNow,
			4,
			0,
			lastRollingNnReturn,
			encodedBy,
			dateNow
		]);
	}
	if (lastRollingNnReturn > 0) {
		await db.execute(rollerChipsSQL, [
			parentGameId,
			dateNow,
			5,
			0,
			0,
			0,
			lastRollingNnReturn,
			0,
			2,
			encodedBy,
			dateNow
		]);
	}
	if (lastRollingCcReturn > 0) {
		await db.execute(rollerChipsSQL, [
			parentGameId,
			dateNow,
			5,
			0,
			0,
			0,
			0,
			lastRollingCcReturn,
			2,
			encodedBy,
			dateNow
		]);
	}

	// 4. Create continuation game (ON GAME)
	let newGameId;
	try {
		const [newGameResult] = await db.execute(
			`INSERT INTO game_list (ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE, CUTOFF_PARENT_GAME_ID, ACTIVE)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)`,
			[
				parentAccountId,
				parent.GUEST_ID,
				parent.GAME_TYPE,
				initialMOP,
				parent.COMMISSION_TYPE,
				parent.COMMISSION_PERCENTAGE,
				encodedBy,
				dateNow,
				programDate,
				parentGameId
			]
		);
		newGameId = newGameResult.insertId;
	} catch (insertErr) {
		const [newGameResult] = await db.execute(
			`INSERT INTO game_list (ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE, ACTIVE)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2)`,
			[
				parentAccountId,
				parent.GUEST_ID,
				parent.GAME_TYPE,
				initialMOP,
				parent.COMMISSION_TYPE,
				parent.COMMISSION_PERCENTAGE,
				encodedBy,
				dateNow,
				programDate
			]
		);
		newGameId = newGameResult.insertId;
	}

	try {
		await db.execute(
			`UPDATE game_list SET CUTOFF_CONTINUED_GAME_ID = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
			[newGameId, encodedBy, dateNow, parentGameId]
		);
	} catch (linkErr) {
		// CUTOFF_CONTINUED_GAME_ID column may be missing
	}

	// 5. Buy-in on new game (remaining + optional split additional)
	for (const leg of newGameBuyInLegs) {
		await insertCutoffBuyinLeg(db, {
			newGameId,
			parentAccountId,
			leg,
			encodedBy,
			dateNow,
			tradingDateNew,
			agentQuery
		});
	}

	// 6. Clear remaining parent roller; new game gets full balance as NN
	if (remainingNnReturnOnParent > 0) {
		await db.execute(rollerChipsSQL, [
			parentGameId,
			dateNow,
			5,
			0,
			0,
			0,
			remainingNnReturnOnParent,
			0,
			2,
			encodedBy,
			dateNow
		]);
	}
	if (remainingCcReturnOnParent > 0) {
		await db.execute(rollerChipsSQL, [
			parentGameId,
			dateNow,
			5,
			0,
			0,
			0,
			0,
			remainingCcReturnOnParent,
			2,
			encodedBy,
			dateNow
		]);
	}
	if (transferRollerNN > 0) {
		await db.execute(rollerChipsSQL, [
			newGameId,
			tradingDateNew,
			5,
			0,
			0,
			0,
			transferRollerNN,
			0,
			1,
			encodedBy,
			dateNow
		]);
	}

	return {
		newGameId,
		parentGameId,
		transferRollerNN,
		lastRollingCC,
		buyInNN,
		buyInCC
	};
}

/**
 * IN-GAME SETTLEMENT: end + auto-settle parent game, cashout remaining + last rolling,
 * create new ON GAME with buy-in = remaining chips + commission (+ split additional).
 */
async function performInGameSettlement(db, params) {
	const {
		parentGameId,
		encodedBy,
		dateNow,
		programDate,
		cashoutLegs,
		buyInLegs,
		settlementFigures,
		lastRollingCC,
		tips,
		rollerName,
		tipStatus
	} = params;

	const [parentRows] = await db.execute(
		`SELECT ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ACTIVE, SETTLED
		 FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1`,
		[parentGameId]
	);
	if (!parentRows.length) {
		const err = new Error('Game not found.');
		err.statusCode = 404;
		throw err;
	}
	const parent = parentRows[0];
	if (parseInt(parent.ACTIVE, 10) !== 2) {
		const err = new Error('Only ON GAME games can use in-game settlement.');
		err.statusCode = 400;
		throw err;
	}
	if (Number(parent.SETTLED) === 1) {
		const err = new Error('This game is already settled.');
		err.statusCode = 400;
		throw err;
	}

	const parentAccountId = parseInt(parent.ACCOUNT_ID, 10);
	const transType = await resolveParentTransType(db, parentGameId, parent.INITIAL_MOP);
	const parentCashoutLegs = Array.isArray(cashoutLegs) && cashoutLegs.length ? cashoutLegs : [];
	const newGameBuyInLegs = Array.isArray(buyInLegs) && buyInLegs.length ? buyInLegs : [];
	const settlementTips = tips || { rollerNn: 0, rollerCc: 0, dealerNn: 0, dealerCc: 0 };
	const figures = settlementFigures || { payment: 0, servicesTotal: 0, settlementTransType: 1 };
	const rollerTotals = await getRollerTotalsForGame(db, parentGameId);
	const totalRollerBalance = Math.max(0, rollerTotals.combinedNet || 0);
	const parentNetNN = Math.max(0, rollerTotals.netNNRaw || 0);
	const parentNetCC = Math.max(0, rollerTotals.netCCRaw || 0);
	const transferRollerNN = computeCutoffTransferRollerNN(rollerTotals);
	const lastRolling = Math.max(0, lastRollingCC);
	const lastRollingNnReturn = Math.min(lastRolling, parentNetNN);
	const lastRollingCcReturn = Math.max(0, lastRolling - lastRollingNnReturn);
	const remainingNnReturnOnParent = Math.max(0, parentNetNN - lastRollingNnReturn);
	const remainingCcReturnOnParent = Math.max(0, parentNetCC - lastRollingCcReturn);

	const allNnLegs = [...parentCashoutLegs, ...newGameBuyInLegs];
	for (const leg of allNnLegs) {
		if (leg.nn > 0 && leg.nn % 1000 !== 0) {
			const err = new Error('Remaining NN Chips must be in thousands.');
			err.statusCode = 400;
			throw err;
		}
	}
	if (settlementTips.rollerNn > 0 && settlementTips.rollerNn % 1000 !== 0) {
		const err = new Error('Tip Roller NN Chips must be in thousands.');
		err.statusCode = 400;
		throw err;
	}
	if (settlementTips.dealerNn > 0 && settlementTips.dealerNn % 1000 !== 0) {
		const err = new Error('Tip Dealer NN Chips must be in thousands.');
		err.statusCode = 400;
		throw err;
	}
	if (lastRollingCC > 0 && lastRollingCC > totalRollerBalance + 0.001) {
		const err = new Error(
			`Last Rolling (${lastRollingCC}) exceeds available roller chips balance (${totalRollerBalance}).`
		);
		err.statusCode = 400;
		throw err;
	}

	const tradingDateNew = parseProgramDateAsDateTime(programDate);
	const initialMOP = { 1: 'CASH', 2: 'DEPOSIT', 3: 'IOU' }[transType] || parent.INITIAL_MOP;

	const rollerChipsSQL = `
		INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const rollingRecordSQL = `
		INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, NN_CHIPS, CC_CHIPS, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`;
	const agentQuery = `
		SELECT agent.IDNo AS agent_id, agent.AGENT_CODE, agent.NAME
		FROM agent
		JOIN account ON account.AGENT_ID = agent.IDNo
		WHERE account.ACTIVE = 1 AND account.IDNo = ?
	`;

	await insertCutoffTipRecords(db, {
		parentGameId,
		parentAccountId,
		encodedBy,
		dateNow,
		tips: settlementTips,
		rollerName,
		tipStatus
	});

	await db.execute(
		`UPDATE game_list SET ACTIVE = 1, GAME_ENDED = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
		[dateNow, encodedBy, dateNow, parentGameId]
	);

	await autoSettleEndedGame(db, {
		gameId: parentGameId,
		accountId: parentAccountId,
		encodedBy,
		dateNow,
		payment: figures.payment,
		fnb: figures.servicesTotal,
		transType: figures.settlementTransType,
		skipLedger: true
	});

	for (const leg of parentCashoutLegs) {
		await insertCutoffCashoutLeg(db, {
			parentGameId,
			parentAccountId,
			leg,
			encodedBy,
			dateNow,
			agentQuery
		});
	}

	if (lastRollingNnReturn > 0) {
		await db.execute(rollingRecordSQL, [
			parentGameId,
			dateNow,
			4,
			0,
			lastRollingNnReturn,
			encodedBy,
			dateNow
		]);
		await db.execute(rollerChipsSQL, [
			parentGameId,
			dateNow,
			5,
			0,
			0,
			0,
			lastRollingNnReturn,
			0,
			2,
			encodedBy,
			dateNow
		]);
	}
	if (lastRollingCcReturn > 0) {
		await db.execute(rollerChipsSQL, [
			parentGameId,
			dateNow,
			5,
			0,
			0,
			0,
			0,
			lastRollingCcReturn,
			2,
			encodedBy,
			dateNow
		]);
	}

	let newGameId;
	const [newGameResult] = await db.execute(
		`INSERT INTO game_list (ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE, ACTIVE)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2)`,
		[
			parentAccountId,
			parent.GUEST_ID,
			parent.GAME_TYPE,
			initialMOP,
			parent.COMMISSION_TYPE,
			parent.COMMISSION_PERCENTAGE,
			encodedBy,
			dateNow,
			programDate
		]
	);
	newGameId = newGameResult.insertId;

	for (const leg of newGameBuyInLegs) {
		await insertCutoffBuyinLeg(db, {
			newGameId,
			parentAccountId,
			leg,
			encodedBy,
			dateNow,
			tradingDateNew,
			agentQuery
		});
	}

	if (remainingNnReturnOnParent > 0) {
		await db.execute(rollerChipsSQL, [
			parentGameId,
			dateNow,
			5,
			0,
			0,
			0,
			remainingNnReturnOnParent,
			0,
			2,
			encodedBy,
			dateNow
		]);
	}
	if (remainingCcReturnOnParent > 0) {
		await db.execute(rollerChipsSQL, [
			parentGameId,
			dateNow,
			5,
			0,
			0,
			0,
			0,
			remainingCcReturnOnParent,
			2,
			encodedBy,
			dateNow
		]);
	}
	if (transferRollerNN > 0) {
		await db.execute(rollerChipsSQL, [
			newGameId,
			tradingDateNew,
			5,
			0,
			0,
			0,
			transferRollerNN,
			0,
			1,
			encodedBy,
			dateNow
		]);
	}

	return {
		newGameId,
		parentGameId,
		lastRollingCC,
		settlementPayment: figures.payment
	};
}

/** Soft-delete junket_loss row(s) linked to a game (JUNKET_LOSS_ID and/or GAME_ID). */
async function softDeleteJunketLossLinkedToGame(db, gameId, junketLossId, editedBy, dateNow) {
	if (!gameId || !editedBy) return;
	const lossId = parseInt(junketLossId, 10) || null;
	try {
		if (lossId) {
			await db.execute(
				`UPDATE junket_loss SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1`,
				[editedBy, dateNow, lossId]
			);
		}
		await db.execute(
			`UPDATE junket_loss SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE GAME_ID = ? AND ACTIVE = 1`,
			[editedBy, dateNow, gameId]
		);
	} catch (err) {
		if (lossId) {
			try {
				await db.execute(
					`UPDATE junket_loss SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1`,
					[editedBy, dateNow, lossId]
				);
			} catch (innerErr) {
				console.error('softDeleteJunketLossLinkedToGame by ID:', innerErr);
			}
		}
	}
}

/**
 * Auto roller RETURN on resolve. Uses buy-in NN/CC split when provided (guest/junket modal);
 * otherwise falls back to outstanding split from roller records.
 */
async function insertAutoRollerReturnForPendingGame(db, gameId, encodedBy, dateNow, rollerTotals, buyinSplit) {
	const totals = rollerTotals || (await getRollerTotalsForGame(db, gameId));
	const requiredTotal = parseFloat(totals.requiredReturnTotal) || 0;
	let returnNN = 0;
	let returnCC = 0;

	if (buyinSplit && (buyinSplit.returnNN != null || buyinSplit.returnCC != null)) {
		returnNN = Math.max(0, parseFloat(buyinSplit.returnNN) || 0);
		returnCC = Math.max(0, parseFloat(buyinSplit.returnCC) || 0);
		if (requiredTotal > 0 && Math.abs(returnNN + returnCC - requiredTotal) > 0.001) {
			const err = new Error(
				`Return split (${returnNN} NN + ${returnCC} CC) must equal outstanding balance (${requiredTotal}).`
			);
			err.statusCode = 400;
			throw err;
		}
	} else {
		returnNN = totals.transferNN || 0;
		returnCC = totals.transferCC || 0;
	}

	if (returnNN <= 0 && returnCC <= 0) {
		return { inserted: false, returnNN: 0, returnCC: 0 };
	}

	const rollerChipsReturnSQL = `
		INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const [insertResult] = await db.execute(rollerChipsReturnSQL, [
		gameId,
		dateNow,
		5,
		0,
		0,
		0,
		returnNN,
		returnCC,
		2,
		encodedBy,
		dateNow
	]);
	return {
		inserted: true,
		returnNN,
		returnCC,
		recordId: insertResult.insertId
	};
}

function normalizePendingRemarks(raw) {
	const text = String(raw || '').trim();
	if (!text) return null;
	return text.length > 500 ? text.slice(0, 500) : text;
}

function parsePendingBuyinRecordIds(csv) {
	if (!csv) return [];
	return String(csv)
		.split(',')
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => n > 0);
}

async function setPendingRollerResolve(db, gameId, resolveType, linkGameId, editedBy, remarks, returnRecordId, buyinRecordIds) {
	const dateNow = new Date();
	const remarksVal = normalizePendingRemarks(remarks);
	const returnId = parseInt(returnRecordId, 10) || null;
	const buyinIds =
		resolveType === 1 && buyinRecordIds
			? String(buyinRecordIds)
					.split(',')
					.map((s) => parseInt(s.trim(), 10))
					.filter((n) => n > 0)
					.join(',') || null
			: null;
	try {
		await db.execute(
			`UPDATE game_list SET ACTIVE = 1, GAME_ENDED = ?, PENDING_ROLLER_RESOLVE = ?, PENDING_ROLLER_LINK_GAME_ID = ?, PENDING_ROLLER_RESOLVED_DT = ?, PENDING_ROLLER_REMARKS = ?, PENDING_ROLLER_RETURN_RECORD_ID = ?, PENDING_ROLLER_BUYIN_RECORD_IDS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
			[dateNow, resolveType, linkGameId || null, dateNow, remarksVal, returnId, buyinIds, editedBy, dateNow, gameId]
		);
	} catch (err) {
		try {
			await db.execute(
				`UPDATE game_list SET ACTIVE = 1, GAME_ENDED = ?, PENDING_ROLLER_RESOLVE = ?, PENDING_ROLLER_LINK_GAME_ID = ?, PENDING_ROLLER_RESOLVED_DT = ?, PENDING_ROLLER_REMARKS = ?, PENDING_ROLLER_RETURN_RECORD_ID = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
				[dateNow, resolveType, linkGameId || null, dateNow, remarksVal, returnId, editedBy, dateNow, gameId]
			);
		} catch (fallbackErr) {
			try {
				await db.execute(
					`UPDATE game_list SET ACTIVE = 1, GAME_ENDED = ?, PENDING_ROLLER_RESOLVE = ?, PENDING_ROLLER_LINK_GAME_ID = ?, PENDING_ROLLER_RESOLVED_DT = ?, PENDING_ROLLER_REMARKS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
					[dateNow, resolveType, linkGameId || null, dateNow, remarksVal, editedBy, dateNow, gameId]
				);
			} catch (fallbackErr2) {
				console.error('PENDING_ROLLER_RESOLVE columns missing? Run database/add_pending_roller_resolve.sql', fallbackErr2);
				throw fallbackErr2;
			}
		}
	}
}

/**
 * When a junket "new game" (#122) is deleted, undo resolve on parent pending game (#121):
 * restore roller RETURN, archive junket_loss, clear resolve flags, set ACTIVE back to PENDING (3).
 */
async function revertPendingRollerResolveWhenLinkGameDeleted(db, deletedGameId, editedBy, dateNow) {
	const linkId = parseInt(deletedGameId, 10);
	if (!linkId || !editedBy) return [];

	let parentRows = [];
	try {
		const [rows] = await db.execute(
			`SELECT IDNo, JUNKET_LOSS_ID, PENDING_ROLLER_RETURN_RECORD_ID, PENDING_ROLLER_RESOLVED_DT
			 FROM game_list
			 WHERE PENDING_ROLLER_LINK_GAME_ID = ? AND PENDING_ROLLER_RESOLVE = 2 AND ACTIVE != 0`,
			[linkId]
		);
		parentRows = rows;
	} catch (err) {
		const [rows] = await db.execute(
			`SELECT IDNo, JUNKET_LOSS_ID, PENDING_ROLLER_RESOLVED_DT
			 FROM game_list
			 WHERE PENDING_ROLLER_LINK_GAME_ID = ? AND PENDING_ROLLER_RESOLVE = 2 AND ACTIVE != 0`,
			[linkId]
		);
		parentRows = rows;
	}

	const revertedParentIds = [];
	for (const parent of parentRows) {
		const parentId = parseInt(parent.IDNo, 10);
		if (!parentId) continue;

		let returnRecordId = parseInt(parent.PENDING_ROLLER_RETURN_RECORD_ID, 10) || null;
		if (!returnRecordId && parent.PENDING_ROLLER_RESOLVED_DT) {
			const [retRows] = await db.execute(
				`SELECT IDNo FROM game_record
				 WHERE GAME_ID = ? AND ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 2
				 ORDER BY ABS(TIMESTAMPDIFF(SECOND, ENCODED_DT, ?)) ASC, IDNo DESC
				 LIMIT 1`,
				[parentId, parent.PENDING_ROLLER_RESOLVED_DT]
			);
			if (retRows.length) returnRecordId = retRows[0].IDNo;
		}

		if (returnRecordId) {
			await db.execute(
				`UPDATE game_record SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND GAME_ID = ?`,
				[editedBy, dateNow, returnRecordId, parentId]
			);
		}

		await softDeleteJunketLossLinkedToGame(db, parentId, parent.JUNKET_LOSS_ID, editedBy, dateNow);

		try {
			await db.execute(
				`UPDATE game_list SET
					ACTIVE = 3,
					GAME_ENDED = NULL,
					PENDING_ROLLER_RESOLVE = NULL,
					PENDING_ROLLER_LINK_GAME_ID = NULL,
					PENDING_ROLLER_RESOLVED_DT = NULL,
					PENDING_ROLLER_REMARKS = NULL,
					PENDING_ROLLER_RETURN_RECORD_ID = NULL,
					PENDING_ROLLER_BUYIN_RECORD_IDS = NULL,
					JUNKET_LOSS_ID = NULL,
					EDITED_BY = ?,
					EDITED_DT = ?
				 WHERE IDNo = ?`,
				[editedBy, dateNow, parentId]
			);
		} catch (clearErr) {
			await db.execute(
				`UPDATE game_list SET
					ACTIVE = 3,
					GAME_ENDED = NULL,
					PENDING_ROLLER_RESOLVE = NULL,
					PENDING_ROLLER_LINK_GAME_ID = NULL,
					PENDING_ROLLER_RESOLVED_DT = NULL,
					PENDING_ROLLER_REMARKS = NULL,
					JUNKET_LOSS_ID = NULL,
					EDITED_BY = ?,
					EDITED_DT = ?
				 WHERE IDNo = ?`,
				[editedBy, dateNow, parentId]
			);
		}

		revertedParentIds.push(parentId);
	}

	return revertedParentIds;
}

/**
 * When guest additional buy-in on a pending game is archived, undo resolve on that same game:
 * soft-delete resolve buy-in pair (if still active), undo auto roller RETURN, archive junket_loss, clear flags, ACTIVE = PENDING (3).
 */
async function revertPendingGuestResolveOnGame(db, gameId, editedBy, dateNow) {
	const gid = parseInt(gameId, 10);
	if (!gid || !editedBy) return false;

	let gameRows = [];
	try {
		const [rows] = await db.execute(
			`SELECT IDNo, JUNKET_LOSS_ID, PENDING_ROLLER_RETURN_RECORD_ID, PENDING_ROLLER_RESOLVED_DT, PENDING_ROLLER_BUYIN_RECORD_IDS
			 FROM game_list
			 WHERE IDNo = ? AND PENDING_ROLLER_RESOLVE = 1 AND ACTIVE != 0`,
			[gid]
		);
		gameRows = rows;
	} catch (err) {
		const [rows] = await db.execute(
			`SELECT IDNo, JUNKET_LOSS_ID, PENDING_ROLLER_RETURN_RECORD_ID, PENDING_ROLLER_RESOLVED_DT
			 FROM game_list
			 WHERE IDNo = ? AND PENDING_ROLLER_RESOLVE = 1 AND ACTIVE != 0`,
			[gid]
		);
		gameRows = rows;
	}
	if (!gameRows.length) return false;

	const game = gameRows[0];
	let buyinIds = parsePendingBuyinRecordIds(game.PENDING_ROLLER_BUYIN_RECORD_IDS);
	if (!buyinIds.length && game.PENDING_ROLLER_RESOLVED_DT) {
		const [fallbackBuyin] = await db.execute(
			`SELECT IDNo FROM game_record
			 WHERE GAME_ID = ? AND ACTIVE = 1 AND CAGE_TYPE IN (1, 3)
			 AND ABS(TIMESTAMPDIFF(SECOND, ENCODED_DT, ?)) <= 3
			 ORDER BY IDNo ASC`,
			[gid, game.PENDING_ROLLER_RESOLVED_DT]
		);
		buyinIds = fallbackBuyin.map((r) => parseInt(r.IDNo, 10)).filter(Boolean);
	}

	for (const buyinId of buyinIds) {
		await db.execute(
			`UPDATE game_record SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND GAME_ID = ? AND ACTIVE = 1`,
			[editedBy, dateNow, buyinId, gid]
		);
	}

	let returnRecordId = parseInt(game.PENDING_ROLLER_RETURN_RECORD_ID, 10) || null;
	if (!returnRecordId && game.PENDING_ROLLER_RESOLVED_DT) {
		const [retRows] = await db.execute(
			`SELECT IDNo FROM game_record
			 WHERE GAME_ID = ? AND ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 2
			 ORDER BY ABS(TIMESTAMPDIFF(SECOND, ENCODED_DT, ?)) ASC, IDNo DESC
			 LIMIT 1`,
			[gid, game.PENDING_ROLLER_RESOLVED_DT]
		);
		if (retRows.length) returnRecordId = retRows[0].IDNo;
	}
	if (returnRecordId) {
		await db.execute(
			`UPDATE game_record SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND GAME_ID = ?`,
			[editedBy, dateNow, returnRecordId, gid]
		);
	}

	await softDeleteJunketLossLinkedToGame(db, gid, game.JUNKET_LOSS_ID, editedBy, dateNow);

	try {
		await db.execute(
			`UPDATE game_list SET
				ACTIVE = 3,
				GAME_ENDED = NULL,
				PENDING_ROLLER_RESOLVE = NULL,
				PENDING_ROLLER_LINK_GAME_ID = NULL,
				PENDING_ROLLER_RESOLVED_DT = NULL,
				PENDING_ROLLER_REMARKS = NULL,
				PENDING_ROLLER_RETURN_RECORD_ID = NULL,
				PENDING_ROLLER_BUYIN_RECORD_IDS = NULL,
				JUNKET_LOSS_ID = NULL,
				EDITED_BY = ?,
				EDITED_DT = ?
			 WHERE IDNo = ?`,
			[editedBy, dateNow, gid]
		);
	} catch (clearErr) {
		await db.execute(
			`UPDATE game_list SET
				ACTIVE = 3,
				GAME_ENDED = NULL,
				PENDING_ROLLER_RESOLVE = NULL,
				PENDING_ROLLER_LINK_GAME_ID = NULL,
				PENDING_ROLLER_RESOLVED_DT = NULL,
				PENDING_ROLLER_REMARKS = NULL,
				JUNKET_LOSS_ID = NULL,
				EDITED_BY = ?,
				EDITED_DT = ?
			 WHERE IDNo = ?`,
			[editedBy, dateNow, gid]
		);
	}

	return true;
}

async function isArchivedPendingGuestResolveBuyin(db, gameId, recordId) {
	const gid = parseInt(gameId, 10);
	const rid = parseInt(recordId, 10);
	if (!gid || !rid) return false;

	let gameRows = [];
	try {
		const [rows] = await db.execute(
			`SELECT PENDING_ROLLER_RESOLVE, PENDING_ROLLER_RESOLVED_DT, PENDING_ROLLER_BUYIN_RECORD_IDS
			 FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1`,
			[gid]
		);
		gameRows = rows;
	} catch (_) {
		return false;
	}
	if (!gameRows.length || parseInt(gameRows[0].PENDING_ROLLER_RESOLVE, 10) !== 1) return false;

	const storedIds = parsePendingBuyinRecordIds(gameRows[0].PENDING_ROLLER_BUYIN_RECORD_IDS);
	if (storedIds.length) return storedIds.includes(rid);

	const resolvedDt = gameRows[0].PENDING_ROLLER_RESOLVED_DT;
	if (!resolvedDt) return false;

	const [recRows] = await db.execute(
		`SELECT IDNo, CAGE_TYPE, ENCODED_DT FROM game_record WHERE IDNo = ? AND GAME_ID = ? LIMIT 1`,
		[rid, gid]
	);
	if (!recRows.length) return false;
	const rec = recRows[0];
	if (![1, 3].includes(parseInt(rec.CAGE_TYPE, 10))) return false;
	const [diffRows] = await db.execute(
		`SELECT ABS(TIMESTAMPDIFF(SECOND, ?, ?)) AS diff_sec`,
		[rec.ENCODED_DT, resolvedDt]
	);
	return diffRows.length > 0 && parseInt(diffRows[0].diff_sec, 10) <= 3;
}

/**
 * Record roller chips "missing" in junket_loss once per game when fault is resolved via junket new game.
 */
async function ensureJunketLossForRollerMissing(db, gameId, amount, encodedBy, resolveLabel, remarks) {
	const missingAmount = parseFloat(amount) || 0;
	if (!gameId || missingAmount <= 0 || !encodedBy) return null;

	const dateNow = new Date();
	try {
		const [gameRows] = await db.execute(
			`SELECT JUNKET_LOSS_ID FROM game_list WHERE IDNo = ? LIMIT 1`,
			[gameId]
		);
		if (!gameRows.length) return null;

		const label = (resolveLabel || 'Resolved').trim();
		let description = `Roller chips missing - Game #${gameId} - (${label})`;
		const remarksText = normalizePendingRemarks(remarks);
		if (remarksText) {
			description += ' — ' + remarksText;
		}
		const inCharge = '-';

		const linkedLossId = parseInt(gameRows[0].JUNKET_LOSS_ID, 10) || null;
		if (linkedLossId) {
			await db.execute(
				`UPDATE junket_loss SET ACTIVE = 1, DESCRIPTION = ?, AMOUNT = ?, IN_CHARGE = ?, GAME_ID = ?,
				 ENCODED_BY = ?, ENCODED_DT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
				[description, missingAmount, inCharge, gameId, encodedBy, dateNow, encodedBy, dateNow, linkedLossId]
			);
			return linkedLossId;
		}

		// One row per GAME_ID (unique index) — reuse archived row after junket resolve was undone
		const [existingByGame] = await db.execute(
			`SELECT IDNo, ACTIVE FROM junket_loss WHERE GAME_ID = ? LIMIT 1`,
			[gameId]
		);
		if (existingByGame.length) {
			const lossId = existingByGame[0].IDNo;
			await db.execute(
				`UPDATE junket_loss SET ACTIVE = 1, DESCRIPTION = ?, AMOUNT = ?, IN_CHARGE = ?,
				 ENCODED_BY = ?, ENCODED_DT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
				[description, missingAmount, inCharge, encodedBy, dateNow, encodedBy, dateNow, lossId]
			);
			await db.execute(`UPDATE game_list SET JUNKET_LOSS_ID = ? WHERE IDNo = ?`, [lossId, gameId]);
			return lossId;
		}

		const [insertResult] = await db.execute(
			`INSERT INTO junket_loss (DESCRIPTION, AMOUNT, IN_CHARGE, GAME_ID, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[description, missingAmount, inCharge, gameId, encodedBy, dateNow]
		);
		const newLossId = insertResult.insertId;
		await db.execute(`UPDATE game_list SET JUNKET_LOSS_ID = ? WHERE IDNo = ?`, [newLossId, gameId]);
		return newLossId;
	} catch (err) {
		console.error('ensureJunketLossForRollerMissing (run database/add_game_junket_loss_link.sql?):', err);
		return null;
	}
}

async function assertPendingGame(db, gameId) {
	const [rows] = await db.execute(
		`SELECT IDNo, ACTIVE, SETTLED, ACCOUNT_ID, GUEST_ID, GAME_TYPE, COMMISSION_TYPE, COMMISSION_PERCENTAGE,
		 PENDING_ROLLER_RESOLVE, PENDING_ROLLER_LINK_GAME_ID
		 FROM game_list WHERE IDNo = ? AND ACTIVE = 3 LIMIT 1`,
		[gameId]
	);
	if (!rows.length) {
		const err = new Error('Game is not in PENDING status.');
		err.statusCode = 400;
		throw err;
	}
	if (rows[0].SETTLED === 1) {
		const err = new Error('Cannot resolve a settled game.');
		err.statusCode = 403;
		throw err;
	}
	return rows[0];
}

function buildBuyinLedgerCreditRemarks(creditRemarks, creditGuarantor, fallback) {
	const parts = [];
	const remarks = (creditRemarks || '').toString().trim();
	const guarantor = (creditGuarantor || '').toString().trim();
	if (remarks) parts.push(remarks);
	if (guarantor) parts.push('Guarantor: ' + guarantor);
	if (parts.length) return parts.join(' | ');
	return fallback || null;
}

function creditGuarantorRequiredError(creditTotal, creditGuarantor) {
	if ((parseFloat(creditTotal) || 0) > 0 && !(creditGuarantor || '').toString().trim()) {
		return 'Please enter the guarantor for the credit amount.';
	}
	return null;
}

const GAME_RECORD_BUYIN_SQL = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const GAME_RECORD_BUYIN_WITH_REMARKS_SQL = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function insertAdditionalBuyinForGame(db, { gameId, accountId, transType, nnAmount, ccAmount, encodedBy, dateNow, cashRemarks, depositRemarks, creditRemarks, creditGuarantor }) {
	const cashRemarksVal = (cashRemarks || '').toString().trim() || null;
	const depRemarks = (depositRemarks || '').toString().trim() || null;
	const creditLedgerRemarks = buildBuyinLedgerCreditRemarks(creditRemarks, creditGuarantor, `Add Buy-in Game: ${gameId}`);
	const gameRecordRemarks = transType === 1 ? cashRemarksVal : (transType === 2 ? depRemarks : (transType === 3 ? creditLedgerRemarks : null));
	const buyinRecordSql = gameRecordRemarks ? GAME_RECORD_BUYIN_WITH_REMARKS_SQL : GAME_RECORD_BUYIN_SQL;
	const buyinRecordParams = gameRecordRemarks
		? [gameId, dateNow, 1, 0, nnAmount, ccAmount, transType, gameRecordRemarks, encodedBy, dateNow]
		: [gameId, dateNow, 1, 0, nnAmount, ccAmount, transType, encodedBy, dateNow];
	const [nnInsert] = await db.execute(buyinRecordSql, buyinRecordParams);
	const [ccInsert] = await db.execute(GAME_RECORD_BUYIN_SQL, [gameId, dateNow, 3, 0, nnAmount, ccAmount, transType, encodedBy, dateNow]);
	const buyinRecordIds = `${nnInsert.insertId},${ccInsert.insertId}`;
	const totalAmount = nnAmount + ccAmount;
	if (transType === 2) {
		await db.execute(
			`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[accountId, gameId, 2, transType, 'ADDITIONAL BUY-IN', totalAmount, depRemarks, encodedBy, dateNow]
		);
	} else if (transType === 3) {
		await db.execute(
			`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[accountId, gameId, 10, transType, totalAmount, creditLedgerRemarks, encodedBy, dateNow]
		);
	}
	return { buyinRecordIds };
}

function computeSettlementTotalsFromRecords(gameRecords) {
	let total_nn_init = 0;
	let total_cc_init = 0;
	let total_nn = 0;
	let total_cc = 0;
	let total_cash_out_nn = 0;
	let total_cash_out_cc = 0;
	let total_rolling_nn = 0;
	let total_rolling_cc = 0;
	let total_rolling_amount = 0;
	let total_rolling_real = 0;
	let total_rolling_nn_real = 0;
	let total_rolling_cc_real = 0;
	let total_roller_return_cc = 0;

	for (const record of gameRecords || []) {
		const cageType = Number(record.CAGE_TYPE);

		if (cageType === 1 && (total_nn_init !== 0 || total_cc_init !== 0)) {
			total_nn += Number(record.NN_CHIPS) || 0;
			total_cc += Number(record.CC_CHIPS) || 0;
		}

		if (cageType === 1 && total_nn_init === 0 && total_cc_init === 0) {
			total_nn_init += Number(record.NN_CHIPS) || 0;
			total_cc_init += Number(record.CC_CHIPS) || 0;
		}

		if (cageType === 2) {
			total_cash_out_nn += Number(record.NN_CHIPS) || 0;
			total_cash_out_cc += Number(record.CC_CHIPS) || 0;
		}

		if (cageType === 3) {
			total_rolling_amount += Number(record.AMOUNT) || 0;
			total_rolling_nn += Number(record.NN_CHIPS) || 0;
			total_rolling_cc += Number(record.CC_CHIPS) || 0;
		}

		if (cageType === 4) {
			total_rolling_real += Number(record.AMOUNT) || 0;
			total_rolling_nn_real += Number(record.NN_CHIPS) || 0;
			total_rolling_cc_real += Number(record.CC_CHIPS) || 0;
		}

		if (cageType === 5) {
			const rollerTransaction = parseInt(record.ROLLER_TRANSACTION, 10) || 1;
			if (rollerTransaction === 2) {
				total_roller_return_cc += Number(record.ROLLER_CC_CHIPS) || 0;
			}
		}
	}

	const total_initial = total_nn_init + total_cc_init;
	const total_buy_in_chips = total_nn + total_cc;
	const total_buy_in = total_initial + total_buy_in_chips;
	const total_cash_out = total_cash_out_nn + total_cash_out_cc;
	const total_amount = total_buy_in_chips + total_initial;
	const winlossRaw = total_amount - total_cash_out;
	const winloss = winlossRaw < 0 ? Math.abs(winlossRaw) : -winlossRaw;
	const totalRollingCCWithReturns = total_roller_return_cc;
	const total_rolling = total_rolling_nn + totalRollingCCWithReturns + total_rolling_amount + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;

	return { total_buy_in, total_cash_out, winloss, total_rolling };
}

/** Match game list ROLLING and ROLLER CHIPS columns for one game's records. */
function computeGameRollingAndRollerTotalsFromRecords(gameRecords) {
	let total_rolling_nn = 0;
	let total_rolling_amount = 0;
	let total_rolling_real = 0;
	let total_rolling_nn_real = 0;
	let total_rolling_cc_real = 0;
	let total_cash_out_nn = 0;
	let total_roller_nn = 0;
	let total_roller_cc = 0;
	let total_roller_return_cc = 0;

	for (const record of gameRecords || []) {
		const cageType = Number(record.CAGE_TYPE);

		if (cageType === 2) {
			total_cash_out_nn += Number(record.NN_CHIPS) || 0;
		}

		if (cageType === 3) {
			total_rolling_amount += Number(record.AMOUNT) || 0;
			total_rolling_nn += Number(record.NN_CHIPS) || 0;
		}

		if (cageType === 4) {
			total_rolling_real += Number(record.AMOUNT) || 0;
			total_rolling_nn_real += Number(record.NN_CHIPS) || 0;
			total_rolling_cc_real += Number(record.CC_CHIPS) || 0;
		}

		if (cageType === 5) {
			const rollerTransaction = parseInt(record.ROLLER_TRANSACTION, 10) || 1;
			if (rollerTransaction === 1) {
				total_roller_nn += Number(record.ROLLER_NN_CHIPS) || 0;
				total_roller_cc += Number(record.ROLLER_CC_CHIPS) || 0;
			} else if (rollerTransaction === 2) {
				total_roller_nn -= Number(record.ROLLER_NN_CHIPS) || 0;
				total_roller_cc -= Number(record.ROLLER_CC_CHIPS) || 0;
				total_roller_return_cc += Number(record.ROLLER_CC_CHIPS) || 0;
			}
		}
	}

	const totalRollingCCWithReturns = total_roller_return_cc;
	const total_rolling_chips = total_rolling_nn + totalRollingCCWithReturns + total_rolling_amount + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;
	const total_roller_chips = total_roller_nn + total_roller_cc;

	return { total_rolling_chips, total_roller_chips };
}

function validateRollingAgainstRollerChips(gameRecords, ccAmount) {
	const totals = computeGameRollingAndRollerTotalsFromRecords(gameRecords);
	if (ccAmount > totals.total_roller_chips) {
		return {
			ok: false,
			error: `Rolling cannot exceed Roller Chips (${totals.total_roller_chips.toLocaleString()}).`
		};
	}
	return { ok: true };
}

function validateRollingAgainstNnBalance(ccAmount, nnBalance, previousCcAmount = 0) {
	const prev = parseFloat(previousCcAmount) || 0;
	const nnBal = parseFloat(nnBalance) || 0;
	const cc = parseFloat(ccAmount) || 0;
	const maxAllowed = nnBal + prev;
	if (cc > maxAllowed) {
		return {
			ok: false,
			error: `CC rolling cannot exceed the current NN balance of ${nnBal.toLocaleString()}.`
		};
	}
	return { ok: true };
}

async function fetchSettlementTotalsForGameId(gameId) {
	const [gameRecords] = await pool.execute(SETTLEMENT_GAME_RECORD_TOTALS_SQL, [gameId]);
	return computeSettlementTotalsFromRecords(gameRecords);
}

async function fetchCombinedSettlementTotals(gameIds) {
	const combined = { total_buy_in: 0, total_cash_out: 0, winloss: 0, total_rolling: 0 };
	for (const gid of gameIds) {
		const t = await fetchSettlementTotalsForGameId(gid);
		combined.total_buy_in += t.total_buy_in;
		combined.total_cash_out += t.total_cash_out;
		combined.winloss += t.winloss;
		combined.total_rolling += t.total_rolling;
	}
	return combined;
}

/** Cut-off settlement: both game IDs + Cut Off label for Telegram. */
function buildSettlementTelegramCutoffContext(primaryGameId, txtCutoffLinkedGameIds) {
	const primary = parseInt(primaryGameId, 10);
	const idSet = new Set();
	if (!isNaN(primary) && primary > 0) {
		idSet.add(primary);
	}
	if (txtCutoffLinkedGameIds) {
		String(txtCutoffLinkedGameIds)
			.split(',')
			.forEach((part) => {
				const n = parseInt(String(part).trim(), 10);
				if (!isNaN(n) && n > 0) {
					idSet.add(n);
				}
			});
	}
	const gameIds = Array.from(idSet).sort((a, b) => a - b);
	const isCutoff = gameIds.length > 1;
	const gameNumbersDisplay = isCutoff ? gameIds.join(' & ') : String(primaryGameId);
	const gameNumbersHash = isCutoff ? gameIds.map((id) => `#${id}`).join(' & ') : `#${primaryGameId}`;

	const agentTitleLine = isCutoff ? '\n컷오프 게임' : '';
	const mgmtTitleLine = isCutoff ? '\n컷오프 게임 Cutoff Game' : '';
	const agentGameLine = `\n게임 #: ${gameNumbersDisplay}`;
	const mgmtGameLine = `\n게임 Game #: ${gameNumbersDisplay}`;

	return {
		isCutoff,
		gameIds,
		gameNumbersDisplay,
		gameNumbersHash,
		agentTitleLine,
		mgmtTitleLine,
		agentGameLine,
		mgmtGameLine
	};
}

/** Cut-off new game: title lines for Game Start Telegram. */
function buildGameStartTelegramCutoffTitleLines(isCutoff) {
	return {
		agentTitleLine: isCutoff ? '\n컷오프 게임' : '',
		mgmtTitleLine: isCutoff ? '\n컷오프 게임 Cutoff Game' : ''
	};
}

async function fetchGuestDisplayNameById(db, guestId) {
	const gid = parseInt(guestId, 10);
	if (!gid) {
		return '';
	}
	try {
		const [rows] = await db.execute(
			`SELECT NAME FROM guest WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1`,
			[gid]
		);
		if (!rows.length) {
			return '';
		}
		return String(rows[0].NAME || '').trim();
	} catch (e) {
		return '';
	}
}

/** Guest line for Game Start Telegram (after account line). */
function buildGameStartTelegramGuestLines(guestDisplayName, useKorean) {
	const name = guestDisplayName ? String(guestDisplayName).trim() : '';
	if (!name) {
		return { agentLine: '', mgmtLine: '' };
	}
	if (useKorean) {
		return {
			agentLine: `\n게스트: ${name}`,
			mgmtLine: `\n게스트 Guest: ${name}`
		};
	}
	return {
		agentLine: `\nGuest: ${name}`,
		mgmtLine: `\nGuest: ${name}`
	};
}

/** Game # display — cut-off continuation shows e.g. 88 (87). */
function buildGameStartTelegramGameNoDisplay(gameId, cutoffParentGameId) {
	const gid = parseInt(gameId, 10);
	const parentId = parseInt(cutoffParentGameId, 10);
	if (!Number.isNaN(gid) && gid > 0 && !Number.isNaN(parentId) && parentId > 0) {
		return `${gid} (${parentId})`;
	}
	return String(gameId);
}

/** Buy-in / cash-out Telegram: guest & agent use parent #; management gets cut-off title when applicable. */
async function resolveCutoffTelegramGameContext(db, gameId) {
	const gid = parseInt(gameId, 10);
	const emptyTitle = buildGameStartTelegramCutoffTitleLines(false);
	if (!gid) {
		return {
			telegramGameNo: gameId,
			managementGameNo: String(gameId),
			isCutoffContinuation: false,
			cutoffTitle: emptyTitle
		};
	}
	let parentId = null;
	try {
		const [rows] = await db.execute(
			`SELECT CUTOFF_PARENT_GAME_ID FROM game_list WHERE IDNo = ? LIMIT 1`,
			[gid]
		);
		if (rows.length > 0) {
			parentId = parseInt(rows[0].CUTOFF_PARENT_GAME_ID, 10);
		}
	} catch (e) {
		// CUTOFF_PARENT_GAME_ID column may be missing
	}
	const isCutoffContinuation = !Number.isNaN(parentId) && parentId > 0;
	const managementGameNo = isCutoffContinuation
		? [parentId, gid].sort((a, b) => a - b).join(' & ')
		: String(gid);
	return {
		telegramGameNo: isCutoffContinuation ? parentId : gid,
		managementGameNo,
		isCutoffContinuation,
		cutoffTitle: buildGameStartTelegramCutoffTitleLines(isCutoffContinuation)
	};
}

async function resolveTelegramGameIdForGuest(db, gameId) {
	const ctx = await resolveCutoffTelegramGameContext(db, gameId);
	return ctx.telegramGameNo;
}

function formatLocalDateYmd(dt) {
	const d = dt instanceof Date ? dt : new Date(dt);
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Date-only (YYYY-MM-DD) from New Game modal txtProgramDate; used for game_list.PROGRAM_DATE. */
function parseGameListProgramDate(raw) {
	const ymd = normalizeSettlementDateYmd(raw == null ? '' : String(raw).trim().slice(0, 10));
	return ymd || formatLocalDateYmd(new Date());
}

/** PROGRAM_DATE (YYYY-MM-DD) as local midnight for game_record.TRADING_DATE. */
function parseProgramDateAsDateTime(ymd) {
	const normalized = normalizeSettlementDateYmd(ymd);
	if (!normalized) return new Date();
	const parts = normalized.split('-').map((n) => parseInt(n, 10));
	const dt = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
	if (dt.getFullYear() !== parts[0] || dt.getMonth() !== parts[1] - 1 || dt.getDate() !== parts[2]) {
		return new Date();
	}
	return dt;
}

function normalizeSettlementDateYmd(raw) {
	const s = raw == null ? '' : String(raw).trim().slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** On delete: clear cut-off link columns on partner game(s) and the row being deleted. */
async function clearCutoffLinksOnGameDelete(db, gameId, editedBy, editedDt) {
	const gid = parseInt(gameId, 10);
	const editorId = editedBy != null ? parseInt(editedBy, 10) : null;
	if (!gid || !editorId) {
		return;
	}
	const when = editedDt || new Date();
	try {
		await db.execute(
			`UPDATE game_list
			 SET CUTOFF_PARENT_GAME_ID = NULL,
			     CUTOFF_CONTINUED_GAME_ID = NULL,
			     EDITED_BY = ?,
			     EDITED_DT = ?
			 WHERE ACTIVE != 0
			   AND IDNo != ?
			   AND (CUTOFF_PARENT_GAME_ID = ? OR CUTOFF_CONTINUED_GAME_ID = ?)`,
			[editorId, when, gid, gid, gid]
		);
	} catch (e) {
		// CUTOFF_* columns may be missing
	}
}

// ======================= GAME LIST ==================

router.get("/game_list", checkSession, async function (req, res) {
	try {
	  const data = sessions(req, 'game_list');
	  data.permissions = req.session.permissions || 0;
  
	  // Load chip-related queries
	  const [
		sqlNNChipsBuyin,
		sqlNNChipsCashout,
		sqlAccountNNChips,
		sqlTotalCashOutRolling,
		sqlTotalRealRolling,
		sqlCCChipsBuyin,
		sqlCCChipsCashout,
		sqlNNChipsRolling,
		sqlCCChipsRolling,
		sqlRollerNNSubtract,
		sqlRollerNNAdd,
		sqlRollerCCSubtract,
		sqlRollerCCAdd,
		sqlNNBuyin,
		sqlNNReturn,
		// Add CC-specific queries
		sqlAccountCCChipsReturn,
		sqlCCChipsBuyinGame,
		sqlCCBuyin,
		sqlCCReturn
	  ] = await Promise.all([
		dashboardQueries.getNNChipsBuyin(),
		dashboardQueries.getNNChipsCashout(),
		dashboardQueries.getAccountNNChips(),
		dashboardQueries.getTotalCashOutRolling(),
		dashboardQueries.getTotalRealRolling(),
		dashboardQueries.getCCChipsBuyin(),
		dashboardQueries.getCCChipsCashout(),
		dashboardQueries.getNNChipsRolling(),
		dashboardQueries.getCCChipsRolling(),
		dashboardQueries.getRollerNNSubtract(),
		dashboardQueries.getRollerNNAdd(),
		dashboardQueries.getRollerCCSubtract(),
		dashboardQueries.getRollerCCAdd(),
		dashboardQueries.getNNBuyin(),
		dashboardQueries.getNNReturn(),
		// CC-specific queries
		dashboardQueries.getAccountCCChipsReturn(),
		dashboardQueries.getCCChipsBuyinGame(),
		dashboardQueries.getCCBuyin(),
		dashboardQueries.getCCReturn()
	  ]);
  
	  const now = new Date();
	  const pad = (n) => String(n).padStart(2, '0');
	  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

	  let initialProgramDate = todayStr;
	  const urlDate = req.query.date;
	  if (urlDate) {
	    if (urlDate === 'current') {
	      initialProgramDate = todayStr;
	    } else if (/^\d{4}-\d{2}-\d{2}$/.test(urlDate)) {
	      initialProgramDate = urlDate;
	    }
	  }

	  // Attach values to `data`
	  Object.assign(data, {
		sqlNNChipsBuyin,
		sqlNNChipsCashout,
		sqlAccountNNChips,
		sqlTotalCashOutRolling,
		sqlTotalRealRolling,
		sqlCCChipsBuyin,
		sqlCCChipsCashout,
		sqlNNChipsRolling,
		sqlCCChipsRolling,
		sqlRollerNNSubtract,
		sqlRollerNNAdd,
		sqlRollerCCSubtract,
		sqlRollerCCAdd,
		sqlNNBuyin,
		sqlNNReturn,
		// Attach CC-related data
		sqlAccountCCChipsReturn,
		sqlCCChipsBuyinGame,
		sqlCCBuyin,
		sqlCCReturn,
		initialProgramDate
	  });
  
	  res.render("gamebook/game_list", data);
	} catch (err) {
	  console.error(err);
	  res.status(500).send("Error fetching game list data");
	}
});

/** If the cell is only a number (optional commas/decimals/minus), store as number so Excel does not show green "text number" triangles. */
function coerceGameBookExportCell(raw) {
	if (raw == null || raw === '') return '';
	const s = String(raw).trim();
	if (/[a-zA-Z]/.test(s)) return s;
	if (/%/.test(s)) return s;
	const normalized = s.replace(/,/g, '');
	if (normalized === '' || normalized === '-' || normalized === '+') return s;
	// Integer or decimal only (commas already stripped); avoids dates/times with ":" etc.
	if (!/^[-+]?(?:\d+\.\d+|\d+\.?|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)) return s;
	const n = Number(normalized);
	return Number.isFinite(n) ? n : s;
}

/** 1-based Excel column numbers for GAME RATE & COMMISSION (no wrap, centered). */
function getGameListExportRateCommissionCols1Based(headers) {
	const set = new Set();
	(headers || []).forEach((h, i) => {
		const t = String(h == null ? '' : h).replace(/\s+/g, ' ').trim();
		const u = t.toUpperCase();
		if (/GAME\s*RATE|GAME\s*RAT\b/i.test(t) || (u.includes('GAME') && u.includes('RATE'))) {
			set.add(i + 1);
		}
		if (/^COMMISS/i.test(u) || u === 'COMMISSION') {
			set.add(i + 1);
		}
	});
	if (set.size === 0 && headers && headers.length >= 12) {
		set.add(11);
		set.add(12);
	}
	return set;
}

function gameListExportBodyAlignment(header) {
	const h = String(header || '').toUpperCase().replace(/\s+/g, ' ').trim();
	if (h === 'TYPE' || h.includes('ACCT') || h === 'GUEST') {
		return { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
	}
	if (
		h.includes('BUY') ||
		h.includes('CASH') ||
		h.includes('WIN') ||
		h.includes('LOSS') ||
		h.includes('ROLLING') ||
		h.includes('RATE') ||
		h.includes('COMMISSION') ||
		h.includes('ADD CHG') ||
		h.includes('SETTLE')
	) {
		return { vertical: 'middle', horizontal: 'right', indent: 1, wrapText: false };
	}
	return { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function gameListExportDisplayWidth(value) {
	return Array.from(String(value == null ? '' : value).replace(/\r?\n/g, ' ')).reduce((sum, ch) => {
		return sum + (ch.charCodeAt(0) > 255 ? 2 : 1);
	}, 0);
}

/** Build Game Book table as .xlsx with borders (client omits ROLLER CHIPS and ACTION columns). */
router.post('/game_list/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename } = req.body || {};
		if (!Array.isArray(headers) || headers.length === 0) {
			return res.status(400).json({ error: 'Invalid headers' });
		}
		if (!Array.isArray(rows)) {
			return res.status(400).json({ error: 'Invalid rows' });
		}
		const MAX_ROWS = 10000;
		if (rows.length > MAX_ROWS) {
			return res.status(400).json({ error: 'Too many rows' });
		}
		const ncol = headers.length;
		const rateCommCols1Based = getGameListExportRateCommissionCols1Based(headers);
		const thinBorder = {
			top: { style: 'thin', color: { argb: 'FF666666' } },
			left: { style: 'thin', color: { argb: 'FF666666' } },
			bottom: { style: 'thin', color: { argb: 'FF666666' } },
			right: { style: 'thin', color: { argb: 'FF666666' } }
		};

		const workbook = new ExcelJS.Workbook();
		const ws = workbook.addWorksheet('Game Book', {
			views: [{ state: 'frozen', ySplit: 1 }]
		});

		const headerRow = ws.addRow(headers.map((h) => (h == null ? '' : String(h))));
		headerRow.height = 22;
		headerRow.eachCell((cell, colNumber) => {
			cell.font = { bold: true };
			cell.alignment = gameListExportBodyAlignment(headers[colNumber - 1]);
			cell.border = thinBorder;
			cell.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FFD9E1F2' }
			};
		});

		rows.forEach((r) => {
			const arr = Array.isArray(r) ? r : [];
			const padded = Array.from({ length: ncol }, (_, i) => {
				const v = arr[i];
				if (v == null || v === '') return '';
				return coerceGameBookExportCell(v);
			});
			const dataRow = ws.addRow(padded);
			dataRow.eachCell((cell, colNumber) => {
				cell.border = thinBorder;
				cell.alignment = gameListExportBodyAlignment(headers[colNumber - 1]);
			});
		});

		const colMaxLens = headers.map((h, c) => {
			const headerText = String(h == null ? '' : h);
			const upperHeader = headerText.toUpperCase();
			let m = gameListExportDisplayWidth(headerText);
			for (let ri = 0; ri < rows.length; ri++) {
				const row = rows[ri];
				if (!Array.isArray(row) || row[c] == null) continue;
				const L = gameListExportDisplayWidth(row[c]);
				if (L > m) m = L;
			}
			let minWidth = 11;
			let maxWidth = 60;
			if (upperHeader.includes('PROGRAM DATE') || upperHeader.includes('GAME START') || upperHeader.includes('GAME END')) minWidth = 14;
			if (upperHeader.includes('ACCT')) minWidth = 18;
			if (upperHeader === 'GUEST') minWidth = 14;
			if (upperHeader.includes('GAME RATE')) minWidth = 13;
			if (upperHeader.includes('COMMISSION') || upperHeader.includes('TOTAL SETTLE')) minWidth = 15;
			if (upperHeader.includes('BUY') || upperHeader.includes('CASH') || upperHeader.includes('WIN') || upperHeader.includes('ROLLING')) minWidth = 13;
			let w = Math.min(maxWidth, Math.max(minWidth, m + 4));
			return w;
		});
		for (let i = 1; i <= ncol; i++) {
			ws.getColumn(i).width = colMaxLens[i - 1];
		}

		applyCommaThousandsToNumericCells(ws);

		const buffer = await workbook.xlsx.writeBuffer();
		let outName = 'Gamebook-export.xlsx';
		if (filename && typeof filename === 'string') {
			const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
			if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
			else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
		}
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('game_list/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

// Available chips snapshot for New Game modal (same formulas used in new_game_list.ejs)
router.get('/game_list_available_chips', async (_req, res) => {
	try {
		const [
			sqlNNChipsBuyin,
			sqlNNChipsCashout,
			sqlAccountNNChips,
			sqlTotalCashOutRolling,
			sqlTotalRealRolling,
			sqlCCChipsBuyin,
			sqlCCChipsCashout,
			sqlNNChipsRolling,
			sqlCCChipsRolling,
			sqlRollerNNSubtract,
			sqlRollerNNAdd,
			sqlRollerCCSubtract,
			sqlRollerCCAdd,
			sqlNNBuyin,
			sqlNNReturn,
			sqlAccountCCChipsReturn,
			sqlCCChipsBuyinGame,
			sqlCCBuyin,
			sqlCCReturn
		] = await Promise.all([
			dashboardQueries.getNNChipsBuyin(),
			dashboardQueries.getNNChipsCashout(),
			dashboardQueries.getAccountNNChips(),
			dashboardQueries.getTotalCashOutRolling(),
			dashboardQueries.getTotalRealRolling(),
			dashboardQueries.getCCChipsBuyin(),
			dashboardQueries.getCCChipsCashout(),
			dashboardQueries.getNNChipsRolling(),
			dashboardQueries.getCCChipsRolling(),
			dashboardQueries.getRollerNNSubtract(),
			dashboardQueries.getRollerNNAdd(),
			dashboardQueries.getRollerCCSubtract(),
			dashboardQueries.getRollerCCAdd(),
			dashboardQueries.getNNBuyin(),
			dashboardQueries.getNNReturn(),
			dashboardQueries.getAccountCCChipsReturn(),
			dashboardQueries.getCCChipsBuyinGame(),
			dashboardQueries.getCCBuyin(),
			dashboardQueries.getCCReturn()
		]);

		const n = (rows, key) => Number(rows?.[0]?.[key] || 0);

		const availableNN =
			n(sqlNNChipsBuyin, 'NNChipsBuyin') -
			n(sqlNNChipsCashout, 'NNChipsCashout') -
			n(sqlAccountNNChips, 'TOTAL_NN') +
			n(sqlTotalCashOutRolling, 'TOTAL_CASHOUT') -
			n(sqlTotalRealRolling, 'TOTAL_REAL_ROLLING') +
			n(sqlNNChipsRolling, 'NNChipsRolling') +
			n(sqlCCChipsRolling, 'CCChipsRolling') +
			n(sqlNNBuyin, 'NNBuyin') -
			n(sqlNNReturn, 'NNReturn') -
			n(sqlRollerNNSubtract, 'ROLLER_NN_SUBTRACT') +
			n(sqlRollerNNAdd, 'ROLLER_NN_ADD');

		const availableCC =
			n(sqlCCChipsBuyin, 'CCChipsBuyin') -
			n(sqlCCChipsCashout, 'CCChipsCashout') +
			n(sqlTotalRealRolling, 'TOTAL_REAL_ROLLING') -
			n(sqlCCChipsRolling, 'CCChipsRolling') -
			n(sqlNNChipsRolling, 'NNChipsRolling') +
			n(sqlAccountCCChipsReturn, 'CC_CHIPS_RETURN') -
			n(sqlCCChipsBuyinGame, 'TOTAL_CC') +
			n(sqlCCBuyin, 'CCBuyin') -
			n(sqlCCReturn, 'CCReturn') -
			n(sqlRollerCCSubtract, 'ROLLER_CC_SUBTRACT') +
			n(sqlRollerCCAdd, 'ROLLER_CC_ADD');

		return res.json({ availableNN, availableCC });
	} catch (err) {
		console.error('Error in /game_list_available_chips:', err);
		return res.status(500).json({ error: 'Failed to load available chips.' });
	}
});

router.get('/game_list_company_balance', async (_req, res) => {
	try {
		const balances = await dashboardQueries.computeHouseBalance();
		return res.json(balances);
	} catch (err) {
		console.error('Error in /game_list_company_balance:', err);
		return res.status(500).json({ error: 'Failed to load company balance.' });
	}
});

router.get('/game_list_cashout_credit/:accountId', async (req, res) => {
	const accountId = parseInt(req.params.accountId, 10);
	if (!Number.isFinite(accountId) || accountId <= 0) {
		return res.status(400).json({ error: 'Invalid account.' });
	}

	const markerQuery = `
		SELECT account.IDNo AS ACCOUNT_ID,
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) -
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END) AS TOTAL_AMOUNT,
			agent.AGENT_CODE AS AGENT_CODE,
			agent.NAME AS AGENT_NAME,
			agency.AGENCY AS AGENCY_NAME
		FROM agent
		JOIN account ON agent.IDNo = account.AGENT_ID
		JOIN agency ON agency.IDNo = agent.AGENCY
		JOIN account_ledger ON account.IDNo = account_ledger.ACCOUNT_ID
		WHERE account_ledger.TRANSACTION_TYPE IN (3, 4)
			AND account_ledger.ACTIVE = 1 AND agent.ACTIVE = 1 AND account_ledger.ACCOUNT_ID = ?
		GROUP BY account.IDNo, agent.AGENT_CODE, agent.NAME, agency.AGENCY`;

	const breakdownQuery = `
		SELECT inner_sub.BALANCE_CREDIT,
			inner_sub.TOTAL_AMOUNT - inner_sub.BALANCE_CREDIT AS BALANCE_BUYIN,
			inner_sub.TOTAL_AMOUNT
		FROM (
			SELECT sub.ACCOUNT_ID,
				ROUND(
					GREATEST(
						0,
						sub.CREDIT_ISSUED -
						sub.RETURNS_TAGGED_CREDIT -
						COALESCE(sub.RETURNS_UNTAGGED * sub.CREDIT_ISSUED / NULLIF(sub.TOTAL_ISSUED, 0), 0)
					),
					0
				) AS BALANCE_CREDIT,
				ROUND(
					sub.TOTAL_ISSUED - sub.RETURNS_TAGGED_CREDIT - sub.RETURNS_TAGGED_BUYIN - sub.RETURNS_UNTAGGED,
					0
				) AS TOTAL_AMOUNT
			FROM (
				SELECT account.IDNo AS ACCOUNT_ID,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID = 3 AND account_ledger.TRANSACTION_TYPE = 3 THEN account_ledger.AMOUNT ELSE 0 END) AS CREDIT_ISSUED,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) AND account_ledger.TRANSACTION_DESC = 'RETURN_SOURCE:CREDIT' THEN account_ledger.AMOUNT ELSE 0 END) AS RETURNS_TAGGED_CREDIT,
					SUM(CASE WHEN (account_ledger.TRANSACTION_ID IN (11, 12, 1) AND account_ledger.TRANSACTION_DESC = 'RETURN_SOURCE:BUYIN') OR (account_ledger.TRANSACTION_ID IN (11, 12) AND (account_ledger.TRANSACTION_DESC IS NULL OR TRIM(account_ledger.TRANSACTION_DESC) = '')) OR (account_ledger.TRANSACTION_ID = 1 AND account_ledger.TRANSACTION_TYPE = 4) THEN account_ledger.AMOUNT ELSE 0 END) AS RETURNS_TAGGED_BUYIN,
					SUM(CASE
						WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1)
							AND NOT (account_ledger.TRANSACTION_ID = 1 AND account_ledger.TRANSACTION_TYPE = 4)
							AND (account_ledger.TRANSACTION_DESC IS NULL OR account_ledger.TRANSACTION_DESC NOT IN ('RETURN_SOURCE:CREDIT', 'RETURN_SOURCE:BUYIN'))
							AND NOT (account_ledger.TRANSACTION_ID IN (11, 12) AND (account_ledger.TRANSACTION_DESC IS NULL OR TRIM(account_ledger.TRANSACTION_DESC) = ''))
						THEN account_ledger.AMOUNT
						ELSE 0
					END) AS RETURNS_UNTAGGED,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) AS TOTAL_ISSUED
				FROM account
				JOIN account_ledger ON account.IDNo = account_ledger.ACCOUNT_ID
				WHERE account_ledger.TRANSACTION_TYPE IN (3, 4)
					AND account_ledger.ACTIVE = 1
					AND account.IDNo = ?
				GROUP BY account.IDNo
			) sub
		) inner_sub`;

	const guestBalancesQuery = `
		SELECT
			guest.IDNo AS GUEST_ID,
			COALESCE(NULLIF(TRIM(guest.NAME), ''), 'Unknown') AS GUEST_NAME,
			ROUND(SUM(game_credit.BALANCE), 0) AS CREDIT_BALANCE
		FROM (
			SELECT
				gl.GUEST_ID,
				GREATEST(
					0,
					COALESCE(SUM(CASE WHEN al.TRANSACTION_ID IN (3, 10) THEN al.AMOUNT ELSE 0 END), 0) -
					COALESCE(SUM(CASE WHEN al.TRANSACTION_ID IN (11, 12, 1) THEN al.AMOUNT ELSE 0 END), 0)
				) AS BALANCE
			FROM game_list gl
			LEFT JOIN account_ledger al ON al.GAME_ID = gl.IDNo
				AND al.ACCOUNT_ID = gl.ACCOUNT_ID
				AND al.ACTIVE = 1
				AND al.TRANSACTION_TYPE IN (3, 4)
				AND (al.TRANSACTION_ID IN (3, 10, 11, 12, 1) OR al.TRANSACTION_TYPE = 4)
			WHERE gl.ACCOUNT_ID = ?
			GROUP BY gl.IDNo, gl.GUEST_ID
		) game_credit
		INNER JOIN guest ON guest.IDNo = game_credit.GUEST_ID
		WHERE game_credit.BALANCE > 0
		GROUP BY guest.IDNo, guest.NAME
		ORDER BY guest.NAME ASC`;

	const historyQuery = `
		SELECT account_ledger.*,
			agent.NAME AS AGENT_NAME,
			agent.AGENT_CODE AS AGENT_CODE,
			agency.AGENCY AS AGENCY_NAME,
			COALESCE(NULLIF(TRIM(guest.NAME), ''), '') AS GUEST_NAME,
			CONCAT(account_ledger.TRANSACTION_ID, '-', account_ledger.TRANSACTION_TYPE) AS TRANSACTION_INFO
		FROM account_ledger
		JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
		JOIN agent ON agent.IDNo = account.AGENT_ID
		JOIN agency ON agency.IDNo = agent.AGENCY
		LEFT JOIN game_list gl ON gl.IDNo = account_ledger.GAME_ID AND gl.ACCOUNT_ID = account_ledger.ACCOUNT_ID
		LEFT JOIN guest ON guest.IDNo = gl.GUEST_ID
		WHERE account_ledger.ACTIVE = 1
			AND account_ledger.ACCOUNT_ID = ?
			AND (account_ledger.TRANSACTION_ID IN (3, 10, 11, 12) OR account_ledger.TRANSACTION_TYPE = 4)
		ORDER BY account_ledger.ENCODED_DT DESC, account_ledger.IDNo DESC
		LIMIT 25`;

	try {
		const [[markerRow]] = await pool.execute(markerQuery, [accountId]);
		const [[breakdownRow]] = await pool.execute(breakdownQuery, [accountId]);
		const [guestBalanceRows] = await pool.execute(guestBalancesQuery, [accountId]);
		const [history] = await pool.execute(historyQuery, [accountId]);

		let agentCode = markerRow ? markerRow.AGENT_CODE || '' : '';
		let agentName = markerRow ? markerRow.AGENT_NAME || '' : '';
		let agencyName = markerRow ? markerRow.AGENCY_NAME || '' : '';

		if (!agentCode) {
			const [[agentRow]] = await pool.execute(`
				SELECT agent.AGENT_CODE, agent.NAME AS AGENT_NAME, agency.AGENCY AS AGENCY_NAME
				FROM account
				JOIN agent ON agent.IDNo = account.AGENT_ID
				JOIN agency ON agency.IDNo = agent.AGENCY
				WHERE account.IDNo = ? AND account.ACTIVE = 1
				LIMIT 1
			`, [accountId]);
			if (agentRow) {
				agentCode = agentRow.AGENT_CODE || '';
				agentName = agentRow.AGENT_NAME || '';
				agencyName = agentRow.AGENCY_NAME || '';
			}
		}

		const totalCredit = markerRow ? parseFloat(markerRow.TOTAL_AMOUNT) || 0 : 0;
		const balanceCredit = breakdownRow ? parseFloat(breakdownRow.BALANCE_CREDIT) || 0 : 0;
		const balanceBuyin = breakdownRow ? parseFloat(breakdownRow.BALANCE_BUYIN) || 0 : 0;
		const guestBalances = (guestBalanceRows || []).map((row) => ({
			guestId: row.GUEST_ID,
			guestName: row.GUEST_NAME || '',
			creditBalance: parseFloat(row.CREDIT_BALANCE) || 0
		}));

		return res.json({
			totalCredit,
			balanceCredit,
			balanceBuyin,
			guestBalances,
			agentCode,
			agentName,
			agencyName,
			history: history || []
		});
	} catch (err) {
		console.error('Error in /game_list_cashout_credit:', err);
		return res.status(500).json({ error: 'Failed to load credit context.' });
	}
});

router.get('/game_list_cashout_tips/:accountId', async (req, res) => {
	const accountId = parseInt(req.params.accountId, 10);
	if (!Number.isFinite(accountId) || accountId <= 0) {
		return res.status(400).json({ error: 'Invalid account.' });
	}

	const TIP_TYPE_ROLLER = 1;
	const TIP_TYPE_DEALER = 2;

	const buildTipHistory = async function (tipType) {
		const [tipRows] = await pool.execute(
			`SELECT
				t.IDNo,
				t.AMOUNT,
				t.TIP_DATETIME,
				t.ROLLER_NAME,
				t.TIP_STATUS,
				t.REMARKS,
				COALESCE(NULLIF(TRIM(t.ROLLER_NAME), ''), NULLIF(TRIM(t.REMARKS), ''), '—') AS PERSON_NAME,
				COALESCE(NULLIF(TRIM(t.TIP_STATUS), ''), 'Roller') AS TIP_STATUS_LABEL
			FROM tip t
			WHERE t.ACTIVE = 1 AND t.ACCOUNT_ID = ? AND t.TIP_TYPE = ?
			ORDER BY t.TIP_DATETIME DESC, t.IDNo DESC
			LIMIT 50`,
			[accountId, tipType]
		);

		const history = (tipRows || []).map((row) => ({
			IDNo: row.IDNo,
			AMOUNT: parseFloat(row.AMOUNT) || 0,
			TIP_DATETIME: row.TIP_DATETIME,
			TRANSACTION: tipType === TIP_TYPE_ROLLER ? 'Roller Tip' : 'Dealer Tip',
			STATUS: row.TIP_STATUS_LABEL || 'Roller',
			PERSON_NAME: row.PERSON_NAME || '—'
		}));

		const [[balanceRow]] = await pool.execute(
			`SELECT COALESCE(SUM(t.AMOUNT), 0) AS TIP_TOTAL
			FROM tip t
			WHERE t.ACTIVE = 1 AND t.ACCOUNT_ID = ? AND t.TIP_TYPE = ?`,
			[accountId, tipType]
		);

		const balance = parseFloat(balanceRow && balanceRow.TIP_TOTAL) || 0;

		return { balance, history };
	};

	try {
		const roller = await buildTipHistory(TIP_TYPE_ROLLER);
		const dealer = await buildTipHistory(TIP_TYPE_DEALER);

		return res.json({
			rollerBalance: roller.balance,
			dealerBalance: dealer.balance,
			rollerHistory: roller.history,
			dealerHistory: dealer.history
		});
	} catch (err) {
		console.error('Error in /game_list_cashout_tips:', err);
		return res.status(500).json({ error: 'Failed to load tip context.' });
	}
});

// ADD GAME LIST
router.post('/add_game_list', async (req, res) => {
	const {
		txtAccountCode,
		txtGameNo,
		txtAmount,
		txtGameType,
		txtNN,
		txtCC,
		txtRollerNN,
		txtRollerCC,
		txtTransType,
		txtGuestId,
		txtCommisionType,
		txtCommisionRate,
		totalBalanceGuest1,
		txtProgramDate
	} = req.body;

	// ENCODED_DT = actual save time; PROGRAM_DATE = user-selected game date (date only).
	const encoded_dt = new Date();
	const program_date = parseGameListProgramDate(txtProgramDate);
	const trading_date = parseProgramDateAsDateTime(program_date);

	// 🛡 Clean inputs and fallbacks
	const accountId = parseInt(txtAccountCode) || null;
	const gameType = txtGameType || 'N/A';
	const parsedGameNo = parseInt(txtGameNo, 10);
	// Backward compatible: current UI may not submit txtGameNo.
	const gameNo = Number.isNaN(parsedGameNo) ? 0 : parsedGameNo;
	const guestId = parseInt(txtGuestId, 10) || null;
	const commType = txtCommisionType || null;
	const commRate = parseFloat((txtCommisionRate || '0').replace(/,/g, '')) || 0;
	const nnAmount = parseFloat((txtNN || '0').replace(/,/g, '')) || 0;
	const ccAmount = parseFloat((txtCC || '0').replace(/,/g, '')) || 0;
	const rollerNNAmount = parseFloat((txtRollerNN || '0').replace(/,/g, '')) || 0;
	const rollerCCAmount = parseFloat((txtRollerCC || '0').replace(/,/g, '')) || 0;
	const transType = parseInt(txtTransType) || null;
	const encodedBy = req.session?.user_id || null;
	const totalAmount = nnAmount + ccAmount;
	const totalBalanceGuest = parseFloat(totalBalanceGuest1 || '0') || 0;

	const initialMOP = {
		1: 'CASH',
		2: 'DEPOSIT',
		3: 'IOU'
	}[transType];

	if (!initialMOP || !accountId || !transType || encodedBy === null) {
		console.error('Invalid or missing fields');
		return res.status(400).send('Invalid input data');
	}

	try {
		// 1. Insert into game_list
		const [result] = await pool.execute(`
			INSERT INTO game_list (ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[accountId, guestId, gameType, initialMOP, commType, commRate, encodedBy, encoded_dt, program_date]
		);

		const gameId = result.insertId;

		const cutoffStartTitle = buildGameStartTelegramCutoffTitleLines(false);

		// 2. Insert into game_record (CAGE_TYPE: 1 and 3)
		const gameRecordSQL = `
			INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;
		const [record1Result] = await pool.execute(gameRecordSQL, [gameId, trading_date, 1, 0, nnAmount, ccAmount, transType, encodedBy, encoded_dt]);
		const gameRecordId = record1Result.insertId; // 👈 Save inserted IDNo
		await pool.execute(gameRecordSQL, [gameId, trading_date, 3, 0, nnAmount, ccAmount, transType, encodedBy, encoded_dt]);
		
		// 2b. Insert ROLLER CHIPS into game_record (CAGE_TYPE: 5) if roller chips provided
		if (rollerNNAmount > 0 || rollerCCAmount > 0) {
			const rollerChipsSQL = `
				INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`;
			// For new games, roller chips are always treated as an ADD action (ROLLER_TRANSACTION = 1)
			await pool.execute(rollerChipsSQL, [gameId, trading_date, 5, 0, 0, 0, rollerNNAmount, rollerCCAmount, 1, encodedBy, encoded_dt]);
		}

		// 3. Insert into account_ledger (GAME_ID for direct link)
		if (transType === 2) {
			await pool.execute(`
				INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[accountId, gameId, 2, transType, 'INITIAL BUY-IN', totalAmount, encodedBy, encoded_dt]
			);
		} else if (transType === 3) {
			await pool.execute(`
				INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[accountId, gameId, 10, transType, totalAmount, `Buy-in Game: ${gameId}`, encodedBy, encoded_dt]
			);
		}

		// 4. Get agent info
		const [agentResults] = await pool.execute(`
			SELECT agent.IDNo AS agent_id, agent.AGENT_CODE, agent.NAME
			FROM agent
			JOIN account ON account.AGENT_ID = agent.IDNo
			WHERE account.ACTIVE = 1 AND account.IDNo = ?`,
			[accountId]
		);

		if (agentResults.length === 0) {
			console.error("No AGENT_CODE or NAME found for Account Code:", accountId);
			return res.redirect('/game_list');
		}

		const { agent_id: agentId, AGENT_CODE: agentCode, NAME: agentName } = agentResults[0];

		// 5. Get telegram ID
		const [telegramIdResults] = await pool.execute(`
			SELECT agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED 
			FROM agent
			JOIN account ON account.AGENT_ID = agent.IDNo
			WHERE account.ACTIVE = 1 AND account.IDNo = ?`,
			[accountId]
		);

	const date_nowTG = new Date().toLocaleDateString();
	const updated_time = new Date().toLocaleTimeString();
	let text = '';

	// Check if game type is LIVE or Telebet to use Korean translations
	const useKorean =
		normalizeTelegramGameTypeKey(gameType) != null ||
		normalizeTelegramGameTypeKey(txtGameType) != null;

	const gtList = telegramGameTypeLabels(gameType);
	const gtDeposit = telegramGameTypeLabels(txtGameType || gameType);
	const translatedGameType = gtList.agentText;
	const translatedTxtGameType = gtDeposit.agentText;
	
	// Korean translations
	const labels = {
		gameStart: useKorean ? '게임 시작' : 'Game Start',
		account: useKorean ? '계정' : 'Account',
		game: useKorean ? '게임' : 'Game',
		buyIn: useKorean ? '바이인' : 'Buy-in',
		accountBalance: useKorean ? '잔고' : 'Account Balance',
		date: useKorean ? '날짜' : 'Date',
		time: useKorean ? '시간' : 'Time',
		cash: useKorean ? '현금' : 'Cash',
		deposit: useKorean ? '계좌출금' : 'Deposit',
		credit: useKorean ? '크레딧' : 'Credit'
	};

	// Bilingual labels (Korean English) for management and agent notifications
	const mgmtLabels = {
		gameStart: '게임 시작 Game Start',
		account: '계정 Account',
		game: '게임 Game',
		buyIn: '바이인 Buy-in',
		date: '날짜 Date',
		time: '시간 Time'
	};
	// Commission type labels for Telegram (1 = none, 2 = Share, 3 = Losing)
	const commissionType = parseInt(txtCommisionType, 10) || null;
	const commissionTextLabel =
		commissionType === 2 ? '게임타입 : 셰어' :
		commissionType === 3 ? '게임타입 : 루징' :
		'';
	const commissionMgmtLabel =
		commissionType === 2 ? '게임타입 GameType : 셰어 Share' :
		commissionType === 3 ? '게임타입 GameType : 루징 Losing' :
		'';
	const commissionTextLine = commissionTextLabel ? `\n${commissionTextLabel}` : '';
	const commissionMgmtLine = commissionMgmtLabel ? `\n${commissionMgmtLabel}` : '';

	let effectiveGuestId = guestId;
	const guestDisplayName = await fetchGuestDisplayNameById(pool, effectiveGuestId);
	const guestTelegramLines = buildGameStartTelegramGuestLines(guestDisplayName, useKorean);
	const telegramLogGuestName = guestDisplayName || agentName;
	const gameNoForTelegram = buildGameStartTelegramGameNoDisplay(
		transType === 2 ? result.insertId : gameId,
		null
	);
	const managementGameNoForStart = gameNoForTelegram;

	let managementText = ''; // Message for management (without account balance)
	const agentBuyInPaymentSuffix =
		transType === 1
			? ` - ${labels.cash}`
			: transType === 2
				? ` - ${labels.deposit}`
				: transType === 3
					? ` - ${labels.credit}`
					: '';

	if (transType === 2) {
		const newTotalBalance = totalBalanceGuest - totalAmount;
		text = `Demo Cage\n\n* ${labels.gameStart} *${cutoffStartTitle.agentTitleLine}\n\n${labels.account}: ${agentCode} - ${agentName}${guestTelegramLines.agentLine}\n${labels.game} #: ${gameNoForTelegram} - ${translatedTxtGameType}${commissionTextLine}\n${labels.buyIn}: ${parseFloat(totalAmount).toLocaleString('en-US')}${agentBuyInPaymentSuffix}\n${labels.accountBalance}: ${parseFloat(newTotalBalance).toLocaleString('en-US')}\n\n${labels.date}: ${date_nowTG}\n${labels.time}: ${updated_time}`;
		// Management/agent message: bilingual labels, no payment type
		managementText = `Demo Cage\n\n* ${mgmtLabels.gameStart} *${cutoffStartTitle.mgmtTitleLine}\n\n${mgmtLabels.account} : ${agentCode} - ${agentName}${guestTelegramLines.mgmtLine}\n${mgmtLabels.game} #: ${managementGameNoForStart} - ${gtDeposit.managementText}${commissionMgmtLine}\n${mgmtLabels.buyIn} : ${parseFloat(totalAmount).toLocaleString('en-US')}\n\n${mgmtLabels.date} : ${date_nowTG}\n${mgmtLabels.time} : ${updated_time}`;
	} else if (transType === 1) {
		text = `Demo Cage\n\n* ${labels.gameStart} *${cutoffStartTitle.agentTitleLine}\n\n${labels.account}: ${agentCode} - ${agentName}${guestTelegramLines.agentLine}\n${labels.game} #: ${gameNoForTelegram} - ${translatedGameType}${commissionTextLine}\n${labels.buyIn}: ${totalAmount.toLocaleString('en-US')}${agentBuyInPaymentSuffix}\n\n${labels.date}: ${date_nowTG}\n${labels.time}: ${updated_time}`;
		// Management/agent message: bilingual labels, no payment type
		managementText = `Demo Cage\n\n* ${mgmtLabels.gameStart} *${cutoffStartTitle.mgmtTitleLine}\n\n${mgmtLabels.account} : ${agentCode} - ${agentName}${guestTelegramLines.mgmtLine}\n${mgmtLabels.game} #: ${managementGameNoForStart} - ${gtList.managementText}${commissionMgmtLine}\n${mgmtLabels.buyIn} : ${totalAmount.toLocaleString('en-US')}\n\n${mgmtLabels.date} : ${date_nowTG}\n${mgmtLabels.time} : ${updated_time}`;
	} else if (transType === 3) {
		text = `Demo Cage\n\n* ${labels.gameStart} *${cutoffStartTitle.agentTitleLine}\n\n${labels.account}: ${agentCode} - ${agentName}${guestTelegramLines.agentLine}\n${labels.game} #: ${gameNoForTelegram} - ${translatedGameType}${commissionTextLine}\n${labels.buyIn}: ${totalAmount.toLocaleString('en-US')}${agentBuyInPaymentSuffix}\n\n${labels.date}: ${date_nowTG}\n${labels.time}: ${updated_time}`;
		// Management/agent message: bilingual labels, no payment type
		managementText = `Demo Cage\n\n* ${mgmtLabels.gameStart} *${cutoffStartTitle.mgmtTitleLine}\n\n${mgmtLabels.account} : ${agentCode} - ${agentName}${guestTelegramLines.mgmtLine}\n${mgmtLabels.game} #: ${managementGameNoForStart} - ${gtList.managementText}${commissionMgmtLine}\n${mgmtLabels.buyIn} : ${totalAmount.toLocaleString('en-US')}\n\n${mgmtLabels.date} : ${date_nowTG}\n${mgmtLabels.time} : ${updated_time}`;
	}

		if (text && agentId) {
			const telegramId =
				telegramIdResults.length > 0 ? getAgentTelegramChatId(telegramIdResults[0]) : null;
			const gameStartGameId = transType === 2 ? result.insertId : gameId;
			const gameStartLogLabel = 'Game Start';
			const gameStartOpts = gamebookTelegramOpts(
				gameStartLogLabel,
				agentCode,
				telegramLogGuestName,
				totalAmount,
				gameStartGameId
			);
			if (telegramId) {
				try {
					await sendTelegramMessage(text, telegramId, gameStartOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to agent:', telegramError.message);
				}
			}
			try {
				await sendToAgentNotifications(agentCode, managementText, gameStartOpts);
			} catch (telegramError) {
				console.error('Failed to send to agent notifications:', telegramError.message);
			}
			try {
				await sendTelegramToAdditionalChats(text, gameStartOpts);
			} catch (telegramError) {
				console.error('Failed to send Telegram message to additional chats:', telegramError.message);
			}
			try {
				await sendTelegramToManagement(managementText, gameStartOpts);
			} catch (telegramError) {
				console.error('Failed to send Telegram message to management:', telegramError.message);
			}
		}

		// 6. Insert cash_transaction entry for cash buy-in
		if (transType === 1 && agentId) {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;
			await pool.execute(cashTransactionQuery, [
				gameId,
				agentId,
				totalAmount.toString(),
				'Game buy-in',
				1,
				`Game - ${gameId}`,
				encodedBy,
				encoded_dt
			]);
		}

		if (req.xhr || (req.get('Accept') || '').includes('application/json')) {
			return res.json({ success: true, gameId });
		}
		res.redirect('/game_list');
	} catch (err) {
		console.error('Error in /add_game_list:', err);
		res.status(500).send('Internal Server Error');
	}
});

// ADD GAME LIST (Split: Cash + Deposit + Credit)
router.post('/add_game_list_split', async (req, res) => {
	const {
		txtAccountCode,
		txtGameType,
		txtRollerNN,
		txtRollerCC,
		txtGuestId,
		txtCommisionType,
		txtCommisionRate,
		totalBalanceGuest1,
		txtProgramDate,
		split_cash_nn,
		split_cash_cc,
		split_dep_nn,
		split_dep_cc,
		split_credit_nn,
		split_credit_cc
	} = req.body;

	const parseAmt = (v) => {
		const s = (v === undefined || v === null ? '' : v).toString().replace(/,/g, '').trim();
		if (s === '') return 0;
		const n = parseFloat(s);
		return Number.isFinite(n) ? n : NaN;
	};

	const accountId = parseInt(txtAccountCode, 10) || null;
	const guestId = parseInt(txtGuestId, 10) || null;
	const encodedBy = req.session?.user_id || null;
	const gameType = txtGameType || 'N/A';
	const commType = txtCommisionType || null;
	const commRate = parseFloat((txtCommisionRate || '0').toString().replace(/,/g, '')) || 0;
	const rollerNNAmount = parseAmt(txtRollerNN);
	const rollerCCAmount = parseAmt(txtRollerCC);

	const cashNn = parseAmt(split_cash_nn);
	const cashCc = parseAmt(split_cash_cc);
	const depNn = parseAmt(split_dep_nn);
	const depCc = parseAmt(split_dep_cc);
	const creditNn = parseAmt(split_credit_nn);
	const creditCc = parseAmt(split_credit_cc);

	const cashTotal = cashNn + cashCc;
	const depositTotal = depNn + depCc;
	const creditTotal = creditNn + creditCc;
	const grandTotal = cashTotal + depositTotal + creditTotal;
	const totalBalanceGuest = parseFloat((totalBalanceGuest1 || '0').toString().replace(/,/g, '')) || 0;
	const depositRemarks = (req.body.txtDepositRemarks || '').toString().trim();
	const creditRemarks = (req.body.txtCreditRemarks || '').toString().trim();
	const creditGuarantor = (req.body.txtCreditGuarantor || '').toString().trim();
	const cashRemarks = (req.body.txtCashRemarks || '').toString().trim();
	const encoded_dt = new Date();
	const program_date = parseGameListProgramDate(txtProgramDate);
	const trading_date = parseProgramDateAsDateTime(program_date);

	if (!accountId || encodedBy === null) {
		return res.status(400).json({ error: 'Invalid account or session.' });
	}
	if ([cashNn, cashCc, depNn, depCc, creditNn, creditCc, rollerNNAmount, rollerCCAmount].some((n) => !Number.isFinite(n) || n < 0)) {
		return res.status(400).json({ error: 'Invalid split amounts.' });
	}
	if ((cashNn > 0 && cashNn % 1000 !== 0) || (depNn > 0 && depNn % 1000 !== 0) || (creditNn > 0 && creditNn % 1000 !== 0)) {
		return res.status(400).json({ error: 'NN split amounts must be in thousands.' });
	}
	if (depositTotal > totalBalanceGuest) {
		return res.status(400).json({ error: 'Deposit amount exceeds available balance.' });
	}
	if (grandTotal <= 0) {
		return res.status(400).json({ error: 'Total amount must be greater than zero.' });
	}
	const guarantorErr = creditGuarantorRequiredError(creditTotal, creditGuarantor);
	if (guarantorErr) return res.status(400).json({ error: guarantorErr });

	const gameRecordSQL = GAME_RECORD_BUYIN_SQL;
	const ledgerDepositSQL = `
		INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const ledgerCreditSQL = `
		INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`;

	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();

		const [gameResult] = await connection.execute(`
			INSERT INTO game_list (ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[accountId, guestId, gameType, 'SPLIT', commType, commRate, encodedBy, encoded_dt, program_date]
		);
		const gameId = gameResult.insertId;

		let cashRecordId = null;
		const creditGameRecordRemarks = buildBuyinLedgerCreditRemarks(creditRemarks, creditGuarantor, `Buy-in Game: ${gameId}`);
		if (cashTotal > 0) {
			const [cashRecord] = await connection.execute(GAME_RECORD_BUYIN_WITH_REMARKS_SQL, [gameId, trading_date, 1, 0, cashNn, cashCc, 1, cashRemarks || null, encodedBy, encoded_dt]);
			cashRecordId = cashRecord.insertId;
			await connection.execute(gameRecordSQL, [gameId, trading_date, 3, 0, cashNn, cashCc, 1, encodedBy, encoded_dt]);
		}
		if (depositTotal > 0) {
			await connection.execute(GAME_RECORD_BUYIN_WITH_REMARKS_SQL, [gameId, trading_date, 1, 0, depNn, depCc, 2, depositRemarks || null, encodedBy, encoded_dt]);
			await connection.execute(gameRecordSQL, [gameId, trading_date, 3, 0, depNn, depCc, 2, encodedBy, encoded_dt]);
		}
		if (creditTotal > 0) {
			await connection.execute(GAME_RECORD_BUYIN_WITH_REMARKS_SQL, [gameId, trading_date, 1, 0, creditNn, creditCc, 3, creditGameRecordRemarks, encodedBy, encoded_dt]);
			await connection.execute(gameRecordSQL, [gameId, trading_date, 3, 0, creditNn, creditCc, 3, encodedBy, encoded_dt]);
		}

		if (rollerNNAmount > 0 || rollerCCAmount > 0) {
			const rollerChipsSQL = `
				INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`;
			await connection.execute(rollerChipsSQL, [gameId, trading_date, 5, 0, 0, 0, rollerNNAmount, rollerCCAmount, 1, encodedBy, encoded_dt]);
		}

		if (depositTotal > 0) {
			await connection.execute(ledgerDepositSQL, [accountId, gameId, 2, 2, 'INITIAL BUY-IN', depositTotal, depositRemarks || null, encodedBy, encoded_dt]);
		}
		if (creditTotal > 0) {
			await connection.execute(ledgerCreditSQL, [
				accountId,
				gameId,
				10,
				3,
				creditTotal,
				creditGameRecordRemarks,
				encodedBy,
				encoded_dt
			]);
		}

		const [agentRows] = await connection.execute(`
			SELECT agent.IDNo AS agent_id
			FROM agent
			JOIN account ON account.AGENT_ID = agent.IDNo
			WHERE account.ACTIVE = 1 AND account.IDNo = ?`,
			[accountId]
		);
		if (cashTotal > 0 && cashRecordId && agentRows.length > 0 && agentRows[0].agent_id) {
			await connection.execute(`
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[cashRecordId, agentRows[0].agent_id, cashTotal.toString(), 'Game buy-in', 1, `Game - ${gameId}`, encodedBy, encoded_dt]
			);
		}

		await connection.commit();

		// Telegram after successful commit (DB already consistent)
		try {
			const [agentRows] = await pool.execute(`
				SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
				FROM account
				JOIN agent ON agent.IDNo = account.AGENT_ID
				WHERE account.ACTIVE = 1 AND account.IDNo = ?
				LIMIT 1`,
				[accountId]
			);
			if (Array.isArray(agentRows) && agentRows.length > 0) {
				const { AGENT_CODE: agentCode, NAME: agentName } = agentRows[0];
				const telegramId = getAgentTelegramChatId(agentRows[0]);
				const date_nowTG = encoded_dt.toLocaleDateString();
				const updated_time = new Date().toLocaleTimeString();
				const balanceAfterDeposit = totalBalanceGuest - depositTotal;
				const splitLinesKo = [];
				if (cashTotal > 0) splitLinesKo.push(`현금: ${cashTotal.toLocaleString('en-US')}`);
				if (depositTotal > 0) splitLinesKo.push(`계좌출금: ${depositTotal.toLocaleString('en-US')}`);
				if (creditTotal > 0) splitLinesKo.push(`크레딧: ${creditTotal.toLocaleString('en-US')}`);
				const splitTextBlockKo = splitLinesKo.join('\n');
				const splitLinesMgmt = [];
				if (cashTotal > 0) splitLinesMgmt.push(`현금 Cash: ${cashTotal.toLocaleString('en-US')}`);
				if (depositTotal > 0) splitLinesMgmt.push(`계좌출금 Deposit: ${depositTotal.toLocaleString('en-US')}`);
				if (creditTotal > 0) splitLinesMgmt.push(`크레딧 Credit: ${creditTotal.toLocaleString('en-US')}`);
				const splitTextBlockMgmt = splitLinesMgmt.join('\n');
				const splitGt = telegramGameTypeLabels(gameType);
				const text = `Demo Cage\n\n* 게임 시작 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${gameId} - ${splitGt.agentText}\n${splitTextBlockKo}\n총 바이인: ${grandTotal.toLocaleString('en-US')}${depositTotal > 0 ? `\n잔고: ${balanceAfterDeposit.toLocaleString('en-US')}` : ''}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				const managementText = `Demo Cage\n\n* 게임 시작 Game Start *\n\n계정 Account : ${agentCode} - ${agentName}\n게임 Game #: ${gameId} - ${splitGt.managementText}\n${splitTextBlockMgmt}\n총 바이인 Total Buy-in: ${grandTotal.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;

				const splitOpts = gamebookTelegramOpts('Game Start', agentCode, agentName, grandTotal, gameId);
				if (telegramId) {
					try { await sendTelegramMessage(text, telegramId, splitOpts); } catch (telegramError) { console.error('Failed to send Telegram message to agent:', telegramError.message); }
				}
				try { await sendToAgentNotifications(agentCode, managementText, splitOpts); } catch (telegramError) { console.error('Failed to send to agent notifications:', telegramError.message); }
				try { await sendTelegramToAdditionalChats(text, splitOpts); } catch (telegramError) { console.error('Failed to send Telegram message to additional chats:', telegramError.message); }
				try { await sendTelegramToManagement(managementText, splitOpts); } catch (telegramError) { console.error('Failed to send Telegram message to management:', telegramError.message); }
			}
		} catch (tgErr) {
			console.error('Telegram block after add_game_list_split:', tgErr);
		}

		if (req.xhr || (req.get('Accept') || '').includes('application/json')) {
			return res.json({ success: true, gameId });
		}
		return res.redirect('/game_list');
	} catch (err) {
		try {
			await connection.rollback();
		} catch (rbErr) {
			console.error('add_game_list_split rollback:', rbErr);
		}
		console.error('Error in /add_game_list_split (rolled back):', err);
		return res.status(500).json({ error: 'Failed to create split new game.' });
	} finally {
		connection.release();
	}
});


// ======================= GAME SERVICES ==================
function isDeliveryGameServiceType(serviceType) {
	const raw = String(serviceType || '').trim().toLowerCase();
	return raw === 'delivery' || raw.includes('delivery');
}

function parseGameServiceDeliveryFee(raw, serviceType) {
	if (!isDeliveryGameServiceType(serviceType)) return 0;
	const fee = parseFloat(String(raw || '0').replace(/,/g, ''));
	return Number.isFinite(fee) && fee >= 0 ? fee : 0;
}

function gameServiceChargeTotal(amount, deliveryFee, serviceType) {
	const amt = parseFloat(String(amount || '0').replace(/,/g, '')) || 0;
	return amt + parseGameServiceDeliveryFee(deliveryFee, serviceType);
}

// Get services for a game
router.get('/game_services/:gameId', checkSession, async (req, res) => {
	try {
		const gameId = parseInt(req.params.gameId, 10);
		if (Number.isNaN(gameId)) {
			return res.status(400).json({ error: 'Invalid game id' });
		}

		const [rows] = await pool.execute(
			`SELECT 
				gs.IDNo,
				gs.GAME_ID,
				gs.SERVICE_TYPE,
				gs.AMOUNT,
				COALESCE(gs.DELIVERY_FEE, 0) AS DELIVERY_FEE,
				gs.REMARKS,
				gs.TRANSACTION_ID,
				gs.AGENT_ID,
				gs.ACTIVE,
				gs.ENCODED_BY,
				gs.ENCODED_DT,
				COALESCE(ui.USERNAME, gs.ENCODED_BY) AS PROCESSED_BY
			FROM game_services gs
			LEFT JOIN user_info ui ON ui.IDNo = gs.ENCODED_BY
			WHERE gs.ACTIVE = 1 AND gs.GAME_ID = ?
			ORDER BY gs.ENCODED_DT DESC, gs.IDNo DESC`,
			[gameId]
		);

		return res.json(rows);
	} catch (err) {
		console.error('Error fetching game services:', err);
		return res.status(500).json({ error: 'Error fetching game services' });
	}
});

// Add a service to a game (use /add_game_services to avoid confusion with GET)
router.post('/add_game_services', checkSession, async (req, res) => {
	try {
		const { game_id, service_type, amount, delivery_fee, remarks, transaction_id, agent_id } = req.body;
		const gameId = parseInt(game_id, 10);
		const amt = parseFloat((amount || '0').toString().replace(/,/g, '')) || 0;
		const svc = (service_type || '').toLowerCase();
		const deliveryFee = parseGameServiceDeliveryFee(delivery_fee, svc);
		const chargeTotal = amt + deliveryFee;
		const validTypes = ['fnb', 'hotel', 'delivery', 'f & b', 'junket payment', 'guest payment'];
		let transactionId = parseInt(transaction_id, 10);
		transactionId = [2, 3].includes(transactionId) ? transactionId : 3;
		let agentId = parseInt(agent_id, 10);
		if (Number.isNaN(agentId) || agentId === 0) {
			agentId = null;
		}

		if (Number.isNaN(gameId) || !validTypes.includes(svc)) {
			return res.status(400).json({ error: 'Invalid input' });
		}

		const encodedBy = req.session?.user_id || null;
		const now = new Date();
		const [gameRows] = await pool.execute(`SELECT ACCOUNT_ID FROM game_list WHERE IDNo = ? LIMIT 1`, [gameId]);
		const accountId = (Array.isArray(gameRows) && gameRows.length > 0) ? gameRows[0].ACCOUNT_ID : null;

		const [insertResult] = await pool.execute(
			`INSERT INTO game_services (GAME_ID, SERVICE_TYPE, AMOUNT, DELIVERY_FEE, REMARKS, TRANSACTION_ID, AGENT_ID, ACTIVE, ENCODED_BY, ENCODED_DT, SOURCE_TYPE)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
			[gameId, svc, amt, deliveryFee, remarks || '', transactionId, agentId, encodedBy, now, 'GUEST']
		);


		const insertCashEntry = async (type) => {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;

			await pool.execute(cashTransactionQuery, [
				insertResult.insertId,
				agentId,
				chargeTotal.toString(),
				svc,
				type,
				`Game - ${gameId} ${remarks ? '- ' + remarks : ''}`.trim(),
				encodedBy,
				now
			]);
		};

		// Services from game_list modal always go to Cash-In (type 1), regardless of Cash/Deposit/Commission
		await insertCashEntry(1);

		if (transactionId === 2 && accountId) {
			await pool.execute(
				`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
				 VALUES (?, ?, 2, 2, 'SERVICES', ?, ?, ?)`,
				[accountId, gameId, chargeTotal, encodedBy, now]
			);

			try {
				const [accountRows] = await pool.execute(
					`SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
					 FROM account
					 JOIN agent ON agent.IDNo = account.AGENT_ID
					 WHERE account.ACTIVE = 1 AND account.IDNo = ?
					 LIMIT 1`,
					[accountId]
				);

				if (Array.isArray(accountRows) && accountRows.length > 0) {
					const { AGENT_CODE, NAME } = accountRows[0];
					const telegramIdAgent = getAgentTelegramChatId(accountRows[0]);

					if (telegramIdAgent) {
						const formattedAmount = chargeTotal.toLocaleString('en-US');
						const serviceLabel = svc.toUpperCase();
						const date_nowTG = now.toLocaleDateString();
						const updated_time = now.toLocaleTimeString();
						const remarksText = (remarks || '').trim();
						const serviceLine = remarksText
							? `서비스: ${serviceLabel} - ${remarksText}`
							: `서비스: ${serviceLabel}`;

						const text = `Demo Cage\n\n* 서비스 결제 *\n\n계정: ${AGENT_CODE} - ${NAME}\n${serviceLine}\n금액: ${formattedAmount} - 계좌출금\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

						const servicePaymentOpts = gamebookTelegramOpts('Service Payment', AGENT_CODE, NAME, amt, gameId);
						// Send to individual guest
						await sendTelegramMessage(text, telegramIdAgent, servicePaymentOpts);
						// Also broadcast to additional guest chats/channels
						await sendTelegramToAdditionalChats(text, servicePaymentOpts);
					}
				}
			} catch (telegramErr) {
				console.error('Failed to send Telegram message for game service deposit:', telegramErr.message || telegramErr);
			}
		}

		// Return the refreshed list
		const [rows] = await pool.execute(
			`SELECT 
				gs.IDNo,
				gs.GAME_ID,
				gs.SERVICE_TYPE,
				gs.AMOUNT,
				COALESCE(gs.DELIVERY_FEE, 0) AS DELIVERY_FEE,
				gs.REMARKS,
				gs.TRANSACTION_ID,
				gs.AGENT_ID,
				gs.ACTIVE,
				gs.ENCODED_BY,
				gs.ENCODED_DT,
				COALESCE(ui.USERNAME, gs.ENCODED_BY) AS PROCESSED_BY
			FROM game_services gs
			LEFT JOIN user_info ui ON ui.IDNo = gs.ENCODED_BY
			WHERE gs.ACTIVE = 1 AND gs.GAME_ID = ?
			ORDER BY gs.ENCODED_DT DESC, gs.IDNo DESC`,
			[gameId]
		);

		return res.json(rows);
	} catch (err) {
		console.error('Error adding game service:', err);
		return res.status(500).json({ error: 'Error adding game service' });
	}
});

// Update a service
router.put('/game_services/:id', checkSession, async (req, res) => {
	try {
		const serviceId = parseInt(req.params.id, 10);
		const { game_id, service_type, amount, delivery_fee, remarks, transaction_id } = req.body;
		const gameId = parseInt(game_id, 10);
		const amt = parseFloat((amount || '0').toString().replace(/,/g, '')) || 0;
		const svc = (service_type || '').toLowerCase();
		const deliveryFee = parseGameServiceDeliveryFee(delivery_fee, svc);
		const chargeTotal = amt + deliveryFee;
		const validTypes = ['fnb', 'hotel', 'delivery', 'f & b', 'junket payment', 'guest payment'];
		let transactionId = parseInt(transaction_id, 10);
		transactionId = [2, 3].includes(transactionId) ? transactionId : 3;

		const [[existingService]] = await pool.execute(
			`SELECT AMOUNT, COALESCE(DELIVERY_FEE, 0) AS DELIVERY_FEE, TRANSACTION_ID, ENCODED_BY, ENCODED_DT, SERVICE_TYPE, AGENT_ID, REMARKS, GAME_ID FROM game_services WHERE IDNo = ?`,
			[serviceId]
		);

		if (Number.isNaN(serviceId) || Number.isNaN(gameId) || !validTypes.includes(svc)) {
			return res.status(400).json({ error: 'Invalid input' });
		}

		const updatedBy = req.session?.user_id || null;
		const encodedBy = updatedBy;
		const now = new Date();

		await pool.execute(
			`UPDATE game_services
			 SET SERVICE_TYPE = ?, AMOUNT = ?, DELIVERY_FEE = ?, REMARKS = ?, TRANSACTION_ID = ?, UPDATED_BY = ?, UPDATED_DT = ?
			 WHERE IDNo = ?`,
			[svc, amt, deliveryFee, remarks || '', transactionId, updatedBy, now, serviceId]
		);

		const existingChargeTotal = parseFloat(existingService?.AMOUNT || 0) + parseFloat(existingService?.DELIVERY_FEE || 0);

		// delete old ledger entry if previous transaction was deposit (add GAME_ID for precise matching)
		if (existingService && parseInt(existingService.TRANSACTION_ID, 10) === 2) {
			const [gameRows] = await pool.execute(
				`SELECT ACCOUNT_ID FROM game_list WHERE IDNo = ? LIMIT 1`,
				[gameId]
			);
			const accountId = (Array.isArray(gameRows) && gameRows.length > 0) ? gameRows[0].ACCOUNT_ID : null;
			if (accountId) {
				const [ledgerRows] = await pool.execute(
					`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC = 'SERVICES' AND AMOUNT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
					[accountId, gameId, existingChargeTotal]
				);
				if (ledgerRows.length > 0) {
					await pool.execute(
						'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
						[updatedBy, now, ledgerRows[0].IDNo]
					);
				}
			}
		}

		// insert ledger entry if now a deposit
		if (transactionId === 2) {
			const [gameRows] = await pool.execute(
				`SELECT ACCOUNT_ID FROM game_list WHERE IDNo = ? LIMIT 1`,
				[gameId]
			);
			const accountId = (Array.isArray(gameRows) && gameRows.length > 0) ? gameRows[0].ACCOUNT_ID : null;
			if (accountId) {
				await pool.execute(
					`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
					 VALUES (?, ?, 2, 2, 'SERVICES', ?, ?, ?)`,
					[accountId, gameId, chargeTotal, updatedBy, now]
				);
			}
		}

		await pool.execute(
			'UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1',
			[updatedBy, now, serviceId]
		);

		const insertCashTransactions = async (type) => {
			const remarkText = [`Game - ${gameId}`, remarks ? remarks : ''].filter(Boolean).join(' - ');
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;

			await pool.execute(cashTransactionQuery, [
				serviceId,
				existingService?.AGENT_ID || null,
				chargeTotal.toString(),
				svc,
				type,
				remarkText,
				encodedBy,
				now
			]);
		};

		// Services from game_list modal always go to Cash-In (type 1), regardless of Cash/Deposit/Commission
		await insertCashTransactions(1);

		const [rows] = await pool.execute(
			`SELECT 
				gs.IDNo,
				gs.GAME_ID,
				gs.SERVICE_TYPE,
				gs.AMOUNT,
				COALESCE(gs.DELIVERY_FEE, 0) AS DELIVERY_FEE,
				gs.REMARKS,
				gs.TRANSACTION_ID,
				gs.AGENT_ID,
				gs.ACTIVE,
				gs.ENCODED_BY,
				gs.ENCODED_DT,
				COALESCE(ui.USERNAME, gs.ENCODED_BY) AS PROCESSED_BY
			FROM game_services gs
			LEFT JOIN user_info ui ON ui.IDNo = gs.ENCODED_BY
			WHERE gs.ACTIVE = 1 AND gs.GAME_ID = ?
			ORDER BY gs.ENCODED_DT DESC, gs.IDNo DESC`,
			[gameId]
		);

		return res.json(rows);
	} catch (err) {
		console.error('Error updating game service:', err);
		return res.status(500).json({ error: 'Error updating game service' });
	}
});

// Delete a service (soft delete)
router.delete('/game_services/:id', checkSession, async (req, res) => {
	try {
		const serviceId = parseInt(req.params.id, 10);
		const gameId = parseInt(req.body.game_id, 10);

		if (Number.isNaN(serviceId) || Number.isNaN(gameId)) {
			return res.status(400).json({ error: 'Invalid input' });
		}

		const updatedBy = req.session?.user_id || null;
		const now = new Date();

		// capture values before update for ledger cleanup
		const [[existingService]] = await pool.execute(
			`SELECT GAME_ID, AMOUNT, TRANSACTION_ID, ENCODED_BY, ENCODED_DT
			 FROM game_services
			 WHERE IDNo = ?`,
			[serviceId]
		);

		await pool.execute(
			`UPDATE game_services
			 SET ACTIVE = 0, UPDATED_BY = ?, UPDATED_DT = ?
			 WHERE IDNo = ?`,
			[updatedBy, now, serviceId]
		);

		if (existingService && parseInt(existingService.TRANSACTION_ID, 10) === 2) {
			const [gameRows] = await pool.execute(
				`SELECT ACCOUNT_ID FROM game_list WHERE IDNo = ? LIMIT 1`,
				[existingService.GAME_ID]
			);
			const accountId = (Array.isArray(gameRows) && gameRows.length > 0) ? gameRows[0].ACCOUNT_ID : null;
			if (accountId) {
				const [ledgerRows] = await pool.execute(
					`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC = 'SERVICES' AND AMOUNT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
					[accountId, existingService.GAME_ID, existingService.AMOUNT]
				);
				if (ledgerRows.length > 0) {
					await pool.execute(
						'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
						[updatedBy, now, ledgerRows[0].IDNo]
					);
				}
			}
		}

		const [rows] = await pool.execute(
			`SELECT 
				gs.IDNo,
				gs.GAME_ID,
				gs.SERVICE_TYPE,
				gs.AMOUNT,
				COALESCE(gs.DELIVERY_FEE, 0) AS DELIVERY_FEE,
				gs.REMARKS,
				gs.TRANSACTION_ID,
				gs.AGENT_ID,
				gs.ACTIVE,
				gs.ENCODED_BY,
				gs.ENCODED_DT,
				COALESCE(ui.USERNAME, gs.ENCODED_BY) AS PROCESSED_BY
			FROM game_services gs
			LEFT JOIN user_info ui ON ui.IDNo = gs.ENCODED_BY
			WHERE gs.ACTIVE = 1 AND gs.GAME_ID = ?
			ORDER BY gs.ENCODED_DT DESC, gs.IDNo DESC`,
			[gameId]
		);

		await pool.execute(
			'UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1',
			[updatedBy, now, serviceId]
		);

		return res.json(rows);
	} catch (err) {
		console.error('Error deleting game service:', err);
		return res.status(500).json({ error: 'Error deleting game service' });
	}
});

// GET GAME LIST — filtered by PROGRAM_DATE (daily_settlement tables no longer used)
router.get('/game_list_data', async (req, res) => {
    let { start, end, id, date, fromDate, toDate } = req.query;
    const isValidYmd = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '').slice(0, 10));

    const gameId = id ? parseInt(id, 10) : null;

    const baseSelect = `
        SELECT 
            game_list.*,
            game_list.IDNo AS game_list_id, 
            game_list.ACTIVE AS game_status, 
            account.IDNo AS account_no, 
            agent.IDNo AS AGENT_ID,
            agent.AGENT_CODE AS agent_code, 
            agent.NAME AS agent_name,  
            COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS guest_name,
            game_list.ENCODED_DT AS GAME_DATE_START,
            COALESCE((
                SELECT SUM(gs.AMOUNT)
                FROM game_services gs
                WHERE gs.GAME_ID = game_list.IDNo
                  AND gs.ACTIVE = 1
                  AND gs.TRANSACTION_ID = 3
            ), 0) AS ADD_CHG
        FROM game_list
        JOIN account ON game_list.ACCOUNT_ID = account.IDNo
        JOIN agent ON agent.IDNo = account.AGENT_ID
        JOIN agency ON agency.IDNo = agent.AGENCY
        LEFT JOIN guest g ON g.IDNo = game_list.GUEST_ID
    `;

    // If a specific game ID is requested, bypass date filtering to ensure it shows up.
    if (gameId) {
        const queryById = `
            SELECT 
                *, 
                game_list.IDNo AS game_list_id, 
                game_list.ACTIVE AS game_status, 
                account.IDNo AS account_no, 
                agent.IDNo AS AGENT_ID,
                agent.AGENT_CODE AS agent_code, 
                agent.NAME AS agent_name,  
                COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS guest_name,
                game_list.ENCODED_DT AS GAME_DATE_START,
                COALESCE((
                    SELECT SUM(gs.AMOUNT)
                    FROM game_services gs
                    WHERE gs.GAME_ID = game_list.IDNo
                      AND gs.ACTIVE = 1
                      AND gs.TRANSACTION_ID = 3
                ), 0) AS ADD_CHG
            FROM game_list
            JOIN account ON game_list.ACCOUNT_ID = account.IDNo
            JOIN agent ON agent.IDNo = account.AGENT_ID
            JOIN agency ON agency.IDNo = agent.AGENCY
            LEFT JOIN guest g ON g.IDNo = game_list.GUEST_ID
            WHERE game_list.ACTIVE != 0 
              AND game_list.IDNo = ?
            ORDER BY game_list.IDNo ASC
        `;

        try {
            const [rows] = await pool.execute(queryById, [gameId]);
            rows.forEach((row) => {
                row.is_pending = 0;
            });
            return res.json(rows);
        } catch (error) {
            console.error('Error fetching data by ID:', error);
            return res.status(500).json({ error: 'Error fetching data' });
        }
    }

    const unreturnedRollerOnly = ['1', 'true', 'yes'].includes(String(req.query.unreturned_roller || '').toLowerCase());
    if (unreturnedRollerOnly) {
        const query = baseSelect + `
            WHERE game_list.ACTIVE != 0
              AND game_list.IDNo IN (
                SELECT gr.GAME_ID
                FROM game_record gr
                WHERE gr.CAGE_TYPE = 5
                  AND gr.ACTIVE = 1
                GROUP BY gr.GAME_ID
                HAVING SUM(
                  CASE
                    WHEN COALESCE(gr.ROLLER_TRANSACTION, 1) = 1
                      THEN COALESCE(gr.ROLLER_NN_CHIPS, 0) + COALESCE(gr.ROLLER_CC_CHIPS, 0)
                    WHEN gr.ROLLER_TRANSACTION = 2
                      THEN -(COALESCE(gr.ROLLER_NN_CHIPS, 0) + COALESCE(gr.ROLLER_CC_CHIPS, 0))
                    ELSE 0
                  END
                ) > 0
              )
            ORDER BY game_list.IDNo DESC
        `;
        try {
            const [rows] = await pool.execute(query);
            rows.forEach((row) => {
                row.is_pending = 0;
            });
            return res.json(rows);
        } catch (error) {
            console.error('Error fetching games with unreturned roller chips:', error);
            return res.status(500).json({ error: 'Error fetching data' });
        }
    }

    const programFrom = req.query.programFrom;
    const programTo = req.query.programTo;
    if (programFrom && programTo) {
        const fromS = String(programFrom).slice(0, 10);
        const toS = String(programTo).slice(0, 10);
        if (!isValidYmd(fromS) || !isValidYmd(toS)) {
            return res.status(400).json({ error: 'Invalid program date range. Use YYYY-MM-DD.' });
        }
        if (fromS > toS) {
            return res.status(400).json({ error: 'programFrom must be on or before programTo.' });
        }
        const query = baseSelect + `
            WHERE game_list.ACTIVE != 0
              AND DATE(game_list.PROGRAM_DATE) BETWEEN ? AND ?
            ORDER BY game_list.IDNo ASC
        `;
        try {
            const [rows] = await pool.execute(query, [fromS, toS]);
            rows.forEach((row) => { row.is_pending = 0; });
            return res.json(rows);
        } catch (error) {
            console.error('[Game List Backend] Error fetching data by program date range:', error);
            return res.status(500).json({ error: 'Error fetching data' });
        }
    }

    // Game Start filter: date range on ENCODED_DT (actual game start timestamp)
    if (fromDate && toDate) {
        if (!isValidYmd(fromDate) || !isValidYmd(toDate)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        }
        const query = baseSelect + `
            WHERE game_list.ACTIVE != 0
              AND DATE(game_list.ENCODED_DT) BETWEEN ? AND ?
            ORDER BY game_list.IDNo ASC
        `;
        try {
            const [rows] = await pool.execute(query, [fromDate, toDate]);
            rows.forEach((row) => { row.is_pending = 0; });
            return res.json(rows);
        } catch (error) {
            console.error('[Game List Backend] Error fetching data by game start date range:', error);
            return res.status(500).json({ error: 'Error fetching data' });
        }
    }

    if (date !== undefined && date !== null && date !== '') {
        const dateS = String(date).slice(0, 10);
        if (!isValidYmd(dateS)) {
            return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });
        }
        const query = baseSelect + `
            WHERE game_list.ACTIVE != 0
              AND DATE(game_list.PROGRAM_DATE) = ?
            ORDER BY game_list.IDNo ASC
        `;
        try {
            const [rows] = await pool.execute(query, [dateS]);
            rows.forEach((row) => { row.is_pending = 0; });
            return res.json(rows);
        } catch (error) {
            console.error('[Game List Backend] Error fetching data by program date:', error);
            return res.status(500).json({ error: 'Error fetching data' });
        }
    }

    // Legacy: use start/end date range (PROGRAM_DATE)
    if (!start || !end) {
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        start = firstDayOfMonth.toISOString().slice(0, 10);
        end = currentDate.toISOString().slice(0, 10);
    }

    const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!isValidDate(start) || !isValidDate(end)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const query = baseSelect + `
        WHERE game_list.ACTIVE != 0
          AND DATE(game_list.PROGRAM_DATE) BETWEEN ? AND ?
        ORDER BY game_list.IDNo ASC
    `;

    try {
        const [rows] = await pool.execute(query, [start, end]);
        rows.forEach((row) => { row.is_pending = 0; });
        res.json(rows);
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(500).json({ error: 'Error fetching data' });
    }
});

// Telegram for merge settlement preview (no DB write)
router.post('/merge_settlement_telegram', checkSession, async (req, res) => {
    try {
        const {
            account_ids,
            account_display,
            game_numbers,
            date,
            time,
            buy_in,
            chips_return,
            win_loss,
            rolling,
            rate,
            settlement,
            services,
            payment
        } = req.body || {};

        let accountIds = [];
        if (Array.isArray(account_ids)) {
            accountIds = account_ids;
        } else if (typeof account_ids === 'string') {
            accountIds = account_ids.split(',').map((v) => v.trim()).filter(Boolean);
        }

        accountIds = accountIds.map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0);

        const uniqueAccountIds = [...new Set(accountIds)];
        if (uniqueAccountIds.length === 0) {
            return res.status(400).json({ success: false, error: 'No account IDs provided.' });
        }

        const safe = (v) => String(v == null ? '0' : v).trim() || '0';
        const parseMoney = (v) => {
            const n = parseFloat(String(v == null ? '0' : v).replace(/,/g, '').trim());
            return Number.isFinite(n) ? n : 0;
        };
        const gameNos = safe(game_numbers);
        const accountDisplayText = safe(account_display);
        const dateText = safe(date);
        const timeText = safe(time);
        const buyInText = safe(buy_in);
        const chipsReturnText = safe(chips_return);
        const rawWinLoss = parseMoney(win_loss);
        const guestWinLoss = rawWinLoss < 0 ? Math.abs(rawWinLoss) : -rawWinLoss;
        const winLossText = guestWinLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const rollingText = safe(rolling);
        const rateText = safe(rate);
        const settlementText = safe(settlement);
        const servicesText = safe(services);
        const paymentText = safe(payment);

        let successCount = 0;
        const failedAccounts = [];
        for (const accountId of uniqueAccountIds) {
            try {
                const [rows] = await pool.execute(
                    `SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
					 FROM account
					 JOIN agent ON account.AGENT_ID = agent.IDNo
					 WHERE account.IDNo = ? AND account.ACTIVE = 1
					 LIMIT 1`,
                    [accountId]
                );

                if (!rows.length || !getAgentTelegramChatId(rows[0])) {
                    failedAccounts.push(accountId);
                    continue;
                }

                const { AGENT_CODE: agentCode, NAME: agentName } = rows[0];
                const telegramId = getAgentTelegramChatId(rows[0]);
                const text =
                    `GD Cage\n\n` +
                    `계정 : ${accountDisplayText}\n` +
                    `게임 # : ${gameNos}\n\n` +
                    `바이인 합계 : ${buyInText}\n` +
                    `캐시아웃 합계 : ${chipsReturnText}\n` +
                    `윈/로스 Win/Loss : ${winLossText}\n` +
                    `토탈롤링 : ${rollingText}\n` +
                    `커미션 : ${paymentText}\n\n` +
                    `날짜 Date : ${dateText}\n` +
                    `시간 Time : ${timeText}`;

                const mergeOpts = gamebookTelegramOpts(
                    'End Game / Settlement',
                    agentCode,
                    agentName,
                    parseMoney(payment),
                    gameNos
                );
                await sendTelegramMessage(text, telegramId, mergeOpts);
                successCount++;
            } catch (sendErr) {
                console.error('merge_settlement_telegram send error:', sendErr.message || sendErr);
                failedAccounts.push(accountId);
            }
        }

        if (successCount === 0) {
            return res.status(500).json({ success: false, error: 'Failed to send Telegram to selected accounts.' });
        }

        const failNote = failedAccounts.length ? ` (${failedAccounts.length} failed)` : '';
        return res.json({ success: true, message: `Telegram sent to ${successCount} account(s)${failNote}.` });
    } catch (err) {
        console.error('merge_settlement_telegram:', err);
        return res.status(500).json({ success: false, error: 'Error sending merge Telegram.' });
    }
});

// GET GAME RECORD FOR A SPECIFIC GAME
router.get('/game_list/:id/record', async (req, res) => {
    const id = parseInt(req.params.id);
    const query = `SELECT IDNo, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, CAGE_TYPE, TRANSACTION, ENCODED_DT FROM game_record
                   WHERE ACTIVE != 0 AND GAME_ID = ? 
                   ORDER BY IDNo ASC`;

    try {
        const [result] = await pool.execute(query, [id]);
        res.json(result);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

// GET game start receipt data (initial buy-in breakdown)
router.get('/game_list/:id/start_receipt', async (req, res) => {
	const data = await buildGameReceipts(parseInt(req.params.id, 10));
	if (!data) {
		return res.status(404).json({ error: 'Game not found' });
	}
	const gameStart = (data.receipts || []).find((r) => r.type === 'game_start');
	if (!gameStart) {
		return res.status(404).json({ error: 'Game start receipt not found' });
	}
	return res.json(gameStart);
});

function receiptEncodedDtMs(dt) {
	if (dt == null) return null;
	if (dt instanceof Date) {
		const ms = dt.getTime();
		return Number.isFinite(ms) ? ms : null;
	}
	const ms = new Date(dt).getTime();
	return Number.isFinite(ms) ? ms : null;
}

function isSameReceiptEncodedDt(a, b) {
	const aMs = receiptEncodedDtMs(a);
	const bMs = receiptEncodedDtMs(b);
	if (aMs == null || bMs == null) return aMs === bMs;
	return aMs === bMs;
}

function sumChipsByTransaction(records, cageType, encodedDt) {
	let cash = 0;
	let deposit = 0;
	let credit = 0;
	(records || []).forEach((row) => {
		if (parseInt(row.CAGE_TYPE, 10) !== cageType) return;
		if (encodedDt != null && !isSameReceiptEncodedDt(row.ENCODED_DT, encodedDt)) return;
		const amt = parseFloat(row.NN_CHIPS || 0) + parseFloat(row.CC_CHIPS || 0);
		const trans = parseInt(row.TRANSACTION, 10);
		if (trans === 1) cash += amt;
		else if (trans === 2) deposit += amt;
		else if (trans === 3 || trans === CASHOUT_TRANSACTION.CREDIT) credit += amt;
	});
	return { cash, deposit, credit, total: cash + deposit + credit };
}

function formatTipReceiptLineLabel(typeLabel, personName, statusLabel) {
	const label = `- ${typeLabel} - ${personName}`;
	const status = (statusLabel || '').trim();
	if (!status) return label;
	if (status.toLowerCase() === typeLabel.toLowerCase()) return label;
	return `${label} (${status})`;
}

function buildConsolidatedTipReceipt(base, tipRows) {
	const rows = (tipRows || []).filter((row) => (parseFloat(row.AMOUNT) || 0) > 0);
	if (!rows.length) return null;

	let totalRoller = 0;
	let totalDealer = 0;
	const tipLines = rows.map((row) => {
		const amount = parseFloat(row.AMOUNT) || 0;
		const tipType = parseInt(row.TIP_TYPE, 10);
		const isDealer = tipType === 2;
		if (isDealer) totalDealer += amount;
		else totalRoller += amount;

		const personName = (
			row.person_name ||
			row.ROLLER_NAME ||
			row.REMARKS ||
			'-'
		).toString().trim() || '-';
		const statusLabel = (row.tip_status_label || row.TIP_STATUS || 'Roller').toString().trim() || 'Roller';
		const typeLabel = isDealer ? 'DEALER' : 'ROLLER';

		return {
			label: formatTipReceiptLineLabel(typeLabel, personName, statusLabel),
			amount
		};
	});

	const totalTip = totalRoller + totalDealer;
	const latestDt = rows.reduce((latest, row) => {
		const candidate = row.TIP_DATETIME || row.ENCODED_DT;
		if (!candidate) return latest;
		if (!latest) return candidate;
		const candidateMs = receiptEncodedDtMs(candidate) ?? 0;
		const latestMs = receiptEncodedDtMs(latest) ?? 0;
		return candidateMs >= latestMs ? candidate : latest;
	}, null);

	return {
		...base,
		type: 'tip',
		title: '* TIP *',
		encoded_dt: latestDt || rows[rows.length - 1].TIP_DATETIME || rows[rows.length - 1].ENCODED_DT,
		show_buyin: false,
		show_cashout: false,
		show_summary: false,
		show_settlement: false,
		show_tip: true,
		tip_lines: tipLines,
		tip_roller: totalRoller,
		tip_dealer: totalDealer,
		total_tip: totalTip
	};
}

const RECEIPT_TYPE_SORT_ORDER = {
	game_start: 1,
	add_buyin: 2,
	cashout: 3,
	tip: 4,
	game_finish: 5
};

function sortGameReceipts(receipts) {
	return (receipts || []).slice().sort((a, b) => {
		const aMs = receiptEncodedDtMs(a.encoded_dt) ?? 0;
		const bMs = receiptEncodedDtMs(b.encoded_dt) ?? 0;
		if (aMs !== bMs) return aMs - bMs;
		return (RECEIPT_TYPE_SORT_ORDER[a.type] || 99) - (RECEIPT_TYPE_SORT_ORDER[b.type] || 99);
	});
}

function isReceiptCashoutTransaction(trans) {
	const t = parseInt(trans, 10);
	return t === 1 || t === 2 || t === 3 || t === CASHOUT_TRANSACTION.CREDIT;
}

function computeReceiptWinLossRolling(records) {
	const buyinRecords = (records || []).filter((row) => parseInt(row.CAGE_TYPE, 10) === 1);
	const initialDt = buyinRecords.length ? buyinRecords[0].ENCODED_DT : null;

	let totalInitial = 0;
	let totalAdditional = 0;
	let totalCashOutNn = 0;
	let totalCashOutCc = 0;
	let totalRollingNn = 0;
	let totalRollingReal = 0;
	let totalRollingNnReal = 0;
	let totalRollingCcReal = 0;
	let totalRollerReturnCc = 0;

	(records || []).forEach((row) => {
		const cageType = parseInt(row.CAGE_TYPE, 10);
		const nn = parseFloat(row.NN_CHIPS || 0);
		const cc = parseFloat(row.CC_CHIPS || 0);
		const chips = nn + cc;

		if (cageType === 1) {
			if (isSameReceiptEncodedDt(row.ENCODED_DT, initialDt)) totalInitial += chips;
			else totalAdditional += chips;
		} else if (cageType === 2) {
			totalCashOutNn += nn;
			totalCashOutCc += cc;
		} else if (cageType === 3) {
			totalRollingNn += nn;
		} else if (cageType === 4) {
			totalRollingReal += parseFloat(row.AMOUNT || 0);
			totalRollingNnReal += nn;
			totalRollingCcReal += cc;
		} else if (cageType === 5 && parseInt(row.ROLLER_TRANSACTION, 10) === 2) {
			totalRollerReturnCc += parseFloat(row.ROLLER_CC_CHIPS || 0);
		}
	});

	const totalCashOutChips = totalCashOutNn + totalCashOutCc;
	const totalRollingChips = totalRollingNn + totalRollerReturnCc + totalRollingReal + totalRollingNnReal + totalRollingCcReal - totalCashOutNn;
	const winLoss = totalInitial + totalAdditional - totalCashOutChips;

	return { win_loss: winLoss, rolling: totalRollingChips };
}

function computeReceiptCommission(game, winLoss, rolling) {
	const commissionType = parseInt(game.COMMISSION_TYPE, 10);
	const rate = parseFloat(game.COMMISSION_PERCENTAGE) || 0;
	if (commissionType === 1 || commissionType === 3) {
		return Math.round((rolling * rate) / 100);
	}
	if (commissionType === 2) {
		return Math.round((winLoss * rate) / 100);
	}
	return 0;
}

async function computeInGameSettlementFigures(db, gameId, body) {
	const [gameRows] = await db.execute(
		`SELECT COMMISSION_TYPE, COMMISSION_PERCENTAGE, SETTLED
		 FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1`,
		[gameId]
	);
	if (!gameRows.length) {
		const err = new Error('Game not found.');
		err.statusCode = 404;
		throw err;
	}
	if (Number(gameRows[0].SETTLED) === 1) {
		const err = new Error('This game is already settled.');
		err.statusCode = 400;
		throw err;
	}

	const [recordRows] = await db.execute(
		`SELECT CAGE_TYPE, NN_CHIPS, CC_CHIPS, AMOUNT, ENCODED_DT, ROLLER_TRANSACTION, ROLLER_CC_CHIPS
		 FROM game_record WHERE GAME_ID = ? AND ACTIVE != 0 ORDER BY IDNo ASC`,
		[gameId]
	);
	const [serviceRows] = await db.execute(
		`SELECT COALESCE(SUM(AMOUNT), 0) AS services_total
		 FROM game_services WHERE GAME_ID = ? AND ACTIVE = 1 AND TRANSACTION_ID = 3`,
		[gameId]
	);

	const { win_loss: winLoss, rolling } = computeReceiptWinLossRolling(recordRows);
	const servicesTotal = parseFloat(serviceRows[0]?.services_total) || 0;
	const commissionType = parseInt(gameRows[0].COMMISSION_TYPE, 10);
	const commissionRate = parseFloat(gameRows[0].COMMISSION_PERCENTAGE) || 0;
	const projected = projectInGameSettlementMetrics({
		rolling,
		winLoss,
		commissionType,
		commissionRate,
		servicesTotal
	}, body);

	if ((commissionType === 1 || commissionType === 3) && servicesTotal > projected.commissionGross + 0.001) {
		const err = new Error('Services cannot exceed the computed settlement/commission amount.');
		err.statusCode = 400;
		throw err;
	}

	return {
		commissionGross: projected.commissionGross,
		servicesTotal,
		payment: projected.payment,
		settlementTransType: 1,
		projectedRolling: projected.projectedRolling,
		projectedWinLoss: projected.projectedWinLoss
	};
}

async function autoSettleEndedGame(db, {
	gameId,
	accountId,
	encodedBy,
	dateNow,
	payment,
	fnb,
	transType,
	skipLedger
}) {
	const paymentValue = parseFloat(payment) || 0;
	const fnbValue = parseFloat(fnb) || 0;
	const ledgerTransType = parseInt(transType, 10) || 1;

	if (!skipLedger && paymentValue !== 0) {
		await db.execute(
			`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, 5, 'COMMISSION', ?, ?, ?)`,
			[accountId, gameId, ledgerTransType, paymentValue, encodedBy, dateNow]
		);
	}

	await db.execute(
		`UPDATE game_list SET SETTLED = 1, FNB = ?, PAYMENT = ?, FAKE_SETTLE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
		[fnbValue, paymentValue, encodedBy, dateNow, gameId]
	);
}

async function buildGameReceipts(gameId) {
	if (!gameId || Number.isNaN(gameId)) return null;

	const [gameRows] = await pool.execute(`
		SELECT
			game_list.IDNo AS game_list_id,
			game_list.ENCODED_DT,
			game_list.GAME_ENDED,
			game_list.ACTIVE,
			game_list.SETTLED,
			game_list.PAYMENT,
			game_list.COMMISSION_TYPE,
			game_list.COMMISSION_PERCENTAGE,
			game_list.GAME_TYPE,
			agent.AGENT_CODE AS agent_code,
			agent.NAME AS agent_name,
			COALESCE((
				SELECT SUM(gs.AMOUNT)
				FROM game_services gs
				WHERE gs.GAME_ID = game_list.IDNo
				  AND gs.ACTIVE = 1
				  AND gs.TRANSACTION_ID = 3
			), 0) AS ADD_CHG
		FROM game_list
		JOIN account ON game_list.ACCOUNT_ID = account.IDNo
		JOIN agent ON agent.IDNo = account.AGENT_ID
		WHERE game_list.IDNo = ? AND game_list.ACTIVE != 0
		LIMIT 1`,
		[gameId]
	);
	if (!gameRows.length) return null;

	const game = gameRows[0];
	const [recordRows] = await pool.execute(`
		SELECT TRANSACTION, NN_CHIPS, CC_CHIPS, CAGE_TYPE, ENCODED_DT
		FROM game_record
		WHERE GAME_ID = ? AND ACTIVE != 0
		ORDER BY IDNo ASC`,
		[gameId]
	);

	const [tipRows] = await pool.execute(`
		SELECT
			t.IDNo,
			t.AMOUNT,
			t.TIP_TYPE,
			t.TIP_DATETIME,
			t.ENCODED_DT,
			t.ROLLER_NAME,
			t.TIP_STATUS,
			t.REMARKS,
			COALESCE(NULLIF(TRIM(t.ROLLER_NAME), ''), NULLIF(TRIM(t.REMARKS), ''), '-') AS person_name,
			COALESCE(NULLIF(TRIM(t.TIP_STATUS), ''), 'Roller') AS tip_status_label
		FROM tip t
		WHERE t.GAME_ID = ? AND t.ACTIVE = 1
		ORDER BY t.TIP_DATETIME ASC, t.IDNo ASC`,
		[gameId]
	);

	const base = {
		game_id: game.game_list_id,
		game_type: game.GAME_TYPE || '',
		agent_code: game.agent_code || '',
		agent_name: game.agent_name || ''
	};

	const buyinRecords = recordRows.filter((r) => parseInt(r.CAGE_TYPE, 10) === 1);
	const initialDt = buyinRecords.length ? buyinRecords[0].ENCODED_DT : null;
	const additionalDts = [];
	buyinRecords.forEach((r) => {
		if (!isSameReceiptEncodedDt(r.ENCODED_DT, initialDt) && !additionalDts.some((dt) => isSameReceiptEncodedDt(dt, r.ENCODED_DT))) {
			additionalDts.push(r.ENCODED_DT);
		}
	});

	const totalBuyin = sumChipsByTransaction(recordRows, 1, null);
	const totalCashout = sumChipsByTransaction(recordRows, 2, null);
	const { win_loss: winLoss, rolling } = computeReceiptWinLossRolling(recordRows);
	const receipts = [];

	const initialBuyin = sumChipsByTransaction(recordRows, 1, initialDt);
	if (initialBuyin.total > 0) {
		receipts.push({
			...base,
			type: 'game_start',
			title: '* Game start *',
			encoded_dt: initialDt,
			show_buyin: true,
			show_cashout: false,
			show_summary: false,
			buyin_label: '* BUY IN',
			cash: initialBuyin.cash,
			deposit: initialBuyin.deposit,
			credit: initialBuyin.credit,
			buy_in: initialBuyin.total
		});
	}

	if (additionalDts.length > 0) {
		const latestAddDt = additionalDts[additionalDts.length - 1];
		const latestAdd = sumChipsByTransaction(recordRows, 1, latestAddDt);
		receipts.push({
			...base,
			type: 'add_buyin',
			title: '* ADD *',
			encoded_dt: latestAddDt,
			show_buyin: true,
			show_cashout: true,
			show_summary: true,
			buyin_label: '* TOTAL BUY IN',
			cash: latestAdd.cash,
			deposit: latestAdd.deposit,
			credit: latestAdd.credit,
			buy_in: totalBuyin.total,
			cashout_cash: totalCashout.cash,
			cashout_deposit: totalCashout.deposit,
			cashout_credit: totalCashout.credit,
			total_cashout: totalCashout.total,
			win_loss: winLoss,
			rolling
		});
	}

	const cashoutRecords = recordRows.filter((r) => parseInt(r.CAGE_TYPE, 10) === 2 && isReceiptCashoutTransaction(r.TRANSACTION));
	if (cashoutRecords.length > 0) {
		const latestCashoutDt = cashoutRecords[cashoutRecords.length - 1].ENCODED_DT;
		const latestCashout = sumChipsByTransaction(recordRows, 2, latestCashoutDt);
		receipts.push({
			...base,
			type: 'cashout',
			title: '* CASH OUT *',
			encoded_dt: latestCashoutDt,
			show_buyin: true,
			show_cashout: true,
			show_summary: true,
			buyin_label: '* TOTAL BUY IN',
			cash: totalBuyin.cash,
			deposit: totalBuyin.deposit,
			credit: totalBuyin.credit,
			buy_in: totalBuyin.total,
			cashout_cash: latestCashout.cash,
			cashout_deposit: latestCashout.deposit,
			cashout_credit: latestCashout.credit,
			total_cashout: latestCashout.total,
			win_loss: winLoss,
			rolling
		});
	}

	const activeStatus = parseInt(game.ACTIVE, 10);
	if (activeStatus === 1) {
		const net = computeReceiptCommission(game, winLoss, rolling);
		const addChg = parseFloat(game.ADD_CHG) || 0;
		const settlement = net;
		const actSettlement = settlement - addChg;
		receipts.push({
			...base,
			type: 'game_finish',
			title: '* Game FINISH *',
			encoded_dt: game.GAME_ENDED || new Date(),
			show_buyin: true,
			show_cashout: true,
			show_summary: true,
			show_settlement: true,
			buyin_label: '* BUY IN',
			cashout_label: '* CASH OUT',
			cash: totalBuyin.cash,
			deposit: totalBuyin.deposit,
			credit: totalBuyin.credit,
			buy_in: totalBuyin.total,
			cashout_cash: totalCashout.cash,
			cashout_deposit: totalCashout.deposit,
			cashout_credit: totalCashout.credit,
			total_cashout: totalCashout.total,
			win_loss: winLoss,
			rolling,
			settlement,
			add_charge: addChg,
			act_settlement: actSettlement
		});
	}

	const tipReceipt = buildConsolidatedTipReceipt(base, tipRows);
	if (tipReceipt) receipts.push(tipReceipt);

	return { game_id: gameId, receipts: sortGameReceipts(receipts) };
}

// GET all transaction receipts for sequential display
router.get('/game_list/:id/receipts', async (req, res) => {
	const gameId = parseInt(req.params.id, 10);
	if (!gameId || Number.isNaN(gameId)) {
		return res.status(400).json({ error: 'Invalid game ID' });
	}
	try {
		const data = await buildGameReceipts(gameId);
		if (!data) {
			return res.status(404).json({ error: 'Game not found' });
		}
		return res.json(data);
	} catch (error) {
		console.error('Error fetching game receipts:', error);
		return res.status(500).json({ error: 'Error fetching game receipts' });
	}
});

// DELETE GAME LIST (Deactivate - soft delete)
router.put('/game_list/remove/:id', async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const date_now = new Date();
	const editedBy = req.session.user_id || null;

	if (!id || !editedBy) {
		return res.status(400).send('Invalid request');
	}

	try {
		let junketLossId = null;
		try {
			const [rows] = await pool.execute(
				'SELECT JUNKET_LOSS_ID FROM game_list WHERE IDNo = ? LIMIT 1',
				[id]
			);
			if (rows.length) junketLossId = rows[0].JUNKET_LOSS_ID;
		} catch (_) {
			/* JUNKET_LOSS_ID column may be missing */
		}

		await softDeleteJunketLossLinkedToGame(pool, id, junketLossId, editedBy, date_now);
		await pool.execute(
			'UPDATE game_list SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[0, editedBy, date_now, id]
		);
		res.send('GAME LIST updated successfully');
	} catch (err) {
		console.error('Error updating GAME LIST:', err);
		res.status(500).send('Error updating GAME LIST');
	}
});

// DELETE GAME LIST (Super Admin only - SOFT DELETE, excludes game_services)
router.delete('/game_list/delete/:id', checkSession, async (req, res) => {
	const permissions = req.session?.permissions;
	if (permissions !== 0) {
		return res.status(403).json({ error: 'Only Super Admin can delete games.' });
	}

	const gameId = parseInt(req.params.id);
	if (!gameId || isNaN(gameId)) {
		return res.status(400).json({ error: 'Invalid game ID' });
	}

	const date_now = new Date();
	const editedBy = req.session?.user_id || null;

	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();

		// 0. If this game was the junket "new game" for a pending resolve, undo parent resolve first
		const revertedParents = await revertPendingRollerResolveWhenLinkGameDeleted(
			connection,
			gameId,
			editedBy,
			date_now
		);

		// 1. Get game info (ACCOUNT_ID, ENCODED_DT for account_ledger matching)
		const [gameRows] = await connection.execute(
			'SELECT ACCOUNT_ID, FNB, PAYMENT, SETTLED, ENCODED_DT FROM game_list WHERE IDNo = ? AND ACTIVE != 0',
			[gameId]
		);
		if (gameRows.length === 0) {
			await connection.rollback();
			return res.status(404).json({ error: 'Game not found' });
		}
		const accountId = gameRows[0].ACCOUNT_ID;
		const gamePayment = gameRows[0].PAYMENT != null ? gameRows[0].PAYMENT : gameRows[0].FNB;
		const isSettled = gameRows[0].SETTLED === 1;
		const gameEncodedDt = gameRows[0].ENCODED_DT;
		let junketLossId = null;
		try {
			const [jlRows] = await connection.execute(
				'SELECT JUNKET_LOSS_ID FROM game_list WHERE IDNo = ? LIMIT 1',
				[gameId]
			);
			if (jlRows.length) junketLossId = jlRows[0].JUNKET_LOSS_ID;
		} catch (_) {
			/* JUNKET_LOSS_ID column may be missing */
		}

		// 2. Get all game_record IDs (exclude game_services - not touched)
		const [recordRows] = await connection.execute(
			'SELECT IDNo FROM game_record WHERE GAME_ID = ? AND ACTIVE != 0',
			[gameId]
		);
		const recordIds = recordRows.map(r => r.IDNo);

		// 3. Soft delete cash_transaction (TRANSACTION_ID = game_record.IDNo or gameId for buy-in)
		for (const rid of recordIds) {
			await connection.execute(
				'UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1',
				[editedBy, date_now, rid]
			);
		}
		await connection.execute(
			'UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1',
			[editedBy, date_now, gameId]
		);
		// EXCLUDED: game_services cash_transaction (TRANSACTION_ID = service IDNo)

		// 4. Soft delete account_ledger entries (game_record-related only, EXCLUDE game_services)
		// 4a. Direct link: soft delete all entries with GAME_ID = gameId (exclude SERVICES)
		await connection.execute(
			`UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE GAME_ID = ? AND ACTIVE = 1 AND COALESCE(TRANSACTION_DESC, '') != 'SERVICES'`,
			[editedBy, date_now, gameId]
		);
		// 4b. Backward compat: match old records (GAME_ID NULL) by ACCOUNT_ID, AMOUNT, ENCODED_DT
		const [allRecords] = await connection.execute(
			'SELECT IDNo, CAGE_TYPE, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_DT FROM game_record WHERE GAME_ID = ? AND ACTIVE != 0',
			[gameId]
		);
		for (const rec of allRecords) {
			const nn = rec.NN_CHIPS || 0;
			const cc = rec.CC_CHIPS || 0;
			const totalAmt = parseFloat(nn) + parseFloat(cc);
			const encDt = rec.ENCODED_DT;
			const trans = rec.TRANSACTION;

			if (rec.CAGE_TYPE === 2) {
				const [ledgerRows] = await connection.execute(
					`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND TRANSACTION_ID = 1 AND TRANSACTION_TYPE = ? AND TRANSACTION_DESC = 'Chips Returned' AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
					[accountId, trans, totalAmt, encDt]
				);
				if (ledgerRows.length > 0) {
					await connection.execute(
						'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
						[editedBy, date_now, ledgerRows[0].IDNo]
					);
				}
			} else if (rec.CAGE_TYPE === 1 || rec.CAGE_TYPE === 3) {
				if (trans == 2) {
					const [ledgerRows] = await connection.execute(
						`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC IN ('INITIAL BUY-IN','ADDITIONAL BUY-IN') AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
						[accountId, totalAmt, encDt]
					);
					if (ledgerRows.length > 0) {
						await connection.execute(
							'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
							[editedBy, date_now, ledgerRows[0].IDNo]
						);
					}
				} else if (trans == 3) {
					const [ledgerRows] = await connection.execute(
						`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND TRANSACTION_ID = 10 AND TRANSACTION_TYPE = 3 AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
						[accountId, totalAmt, encDt]
					);
					if (ledgerRows.length > 0) {
						await connection.execute(
							'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
							[editedBy, date_now, ledgerRows[0].IDNo]
						);
					}
				}
			}
		}
		// Initial buy-in from add_game_list (match by game ENCODED_DT, old records only)
		const [initLedger2] = await connection.execute(
			`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE IN (1,2) AND TRANSACTION_DESC = 'INITIAL BUY-IN' AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 2`,
			[accountId, gameEncodedDt]
		);
		for (const row of initLedger2) {
			await connection.execute(
				'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
				[editedBy, date_now, row.IDNo]
			);
		}
		const [initLedger10] = await connection.execute(
			`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND TRANSACTION_ID = 10 AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
			[accountId, gameEncodedDt]
		);
		if (initLedger10.length > 0) {
			await connection.execute(
				'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
				[editedBy, date_now, initLedger10[0].IDNo]
			);
		}
		// COMMISSION (settlement) - new records deleted by 4a (GAME_ID). Fallback for old records (GAME_ID NULL)
		if (isSettled) {
			const matchAmt = parseFloat(gamePayment) || parseFloat(gameRows[0].FNB || 0);
			if (matchAmt) {
				const [commRows] = await connection.execute(
					`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND TRANSACTION_TYPE = 5 AND TRANSACTION_DESC = 'COMMISSION' AND ROUND(AMOUNT, 2) = ROUND(?, 2) AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
					[accountId, matchAmt]
				);
				if (commRows.length > 0) {
					await connection.execute(
						'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
						[editedBy, date_now, commRows[0].IDNo]
					);
				}
			}
		}
		// EXCLUDED: account_ledger for game_services (SERVICES)

		// game_services: not soft-deleted here

		// 6. Soft delete game_record
		await connection.execute(
			'UPDATE game_record SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE GAME_ID = ?',
			[editedBy, date_now, gameId]
		);

		// 7. EXCLUDED: game_services

		// 7b. Soft-delete linked junket_loss (roller missing from pending resolve)
		await softDeleteJunketLossLinkedToGame(connection, gameId, junketLossId, editedBy, date_now);

		// 8. Clear cut-off links on partner game(s), then soft delete game_list
		await clearCutoffLinksOnGameDelete(connection, gameId, editedBy, date_now);
		try {
			await connection.execute(
				`UPDATE game_list
				 SET ACTIVE = 0,
				     CUTOFF_PARENT_GAME_ID = NULL,
				     CUTOFF_CONTINUED_GAME_ID = NULL,
				     EDITED_BY = ?,
				     EDITED_DT = ?
				 WHERE IDNo = ?`,
				[editedBy, date_now, gameId]
			);
		} catch (cutoffColErr) {
			await connection.execute(
				'UPDATE game_list SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
				[editedBy, date_now, gameId]
			);
		}

		await connection.commit();
		const msg =
			revertedParents.length > 0
				? `Game deleted. Game(s) ${revertedParents.join(', ')} restored to PENDING (roller chips and resolve undone).`
				: 'Game and related records deleted successfully.';
		res.json({
			success: true,
			message: msg,
			reverted_pending_parents: revertedParents
		});
	} catch (err) {
		await connection.rollback();
		console.error('Error soft deleting game:', err);
		res.status(500).json({ error: 'Failed to delete game. ' + (err.message || '') });
	} finally {
		connection.release();
	}
});

// STATUS GAME LIST (Updated with mysql2/promise)
router.put('/game_list/change_status/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const date_now = new Date();

		const {
			txtStatus,
			txtGameId,
			txtAccountCode,
			txtCapital,
			txtFinalChips,
			txtTotalRolling,
			txtWinloss,
			txtReturnRollerNN,
			txtReturnRollerCC,
			txtWasCutoff,
			txtCutoffProgramDate,
			txtCutoffBuyInNN,
			txtCutoffBuyInCC,
			txtCutoffLastRolling
		} = req.body;

		const formattedWinloss = parseFloat(txtWinloss) || 0;
		const adjustedWinloss = formattedWinloss > 0 ? -formattedWinloss : Math.abs(formattedWinloss);

		// Ensure all required parameters are defined
		if (!txtStatus) {
			return res.status(400).json({ error: 'Status is required' });
		}
		
		const editedBy = req.session.user_id || null; // Use null instead of undefined
		if (!editedBy) {
			return res.status(401).json({ error: 'User session not found' });
		}

		const isCutoffRequest =
			txtWasCutoff === '1' || txtWasCutoff === 1 || String(txtWasCutoff || '').toLowerCase() === 'true';
		if (isCutoffRequest) {
			const [cutoffGuardRows] = await pool.execute(
				`SELECT CUTOFF_PARENT_GAME_ID, CUTOFF_CONTINUED_GAME_ID
				 FROM game_list WHERE IDNo = ? LIMIT 1`,
				[id]
			);
			if (cutoffGuardRows.length > 0) {
				const continuedId = parseInt(cutoffGuardRows[0].CUTOFF_CONTINUED_GAME_ID, 10);
				const parentId = parseInt(cutoffGuardRows[0].CUTOFF_PARENT_GAME_ID, 10);
				if (
					(!Number.isNaN(continuedId) && continuedId > 0) ||
					(!Number.isNaN(parentId) && parentId > 0)
				) {
					return res.status(400).json({ error: 'This game cannot be cut off again.' });
				}
			}

			const programDate = parseGameListProgramDate(txtCutoffProgramDate);
			if (!normalizeSettlementDateYmd(programDate)) {
				return res.status(400).json({ error: 'Program date is required for cut off.' });
			}

			const lastRollingCC = parseChipAmount(txtCutoffLastRolling);
			const tips = parseCutoffTips(req.body);

			const connection = await pool.getConnection();
			try {
				await connection.beginTransaction();
				const [parentMetaRows] = await connection.execute(
					`SELECT INITIAL_MOP FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1`,
					[id]
				);
				const parentInitialMop = parentMetaRows.length ? parentMetaRows[0].INITIAL_MOP : null;
				const parentTransType = await resolveParentTransType(connection, id, parentInitialMop);
				const cashoutLegs = buildCutoffParentCashoutLegs(req.body, parentTransType);
				const buyInLegs = buildCutoffNewGameBuyInLegs(req.body, parentTransType);

				const cutoffResult = await performGameCutoff(connection, {
					parentGameId: id,
					encodedBy: editedBy,
					dateNow: date_now,
					programDate,
					cashoutLegs,
					buyInLegs,
					lastRollingCC,
					tips,
					rollerName: (req.body.txtTipRollerName || '').toString().trim(),
					tipStatus: (req.body.txtTipStatus || '').toString().trim()
				});
				await connection.commit();
				return res.json({
					success: true,
					message: 'Game ended (Cut Off).',
					new_game_id: cutoffResult.newGameId
				});
			} catch (cutoffErr) {
				try {
					await connection.rollback();
				} catch (rbErr) {
					console.error('cutoff rollback:', rbErr);
				}
				console.error('Error in cutoff change_status:', cutoffErr);
				const statusCode = cutoffErr.statusCode || 500;
				const msg = cutoffErr.message || 'Error processing cut off.';
				return res.status(statusCode).json({ error: msg });
			} finally {
				connection.release();
			}
		}

		const isInGameSettlementRequest =
			req.body.txtWasInGameSettlement === '1' ||
			req.body.txtWasInGameSettlement === 1 ||
			String(req.body.txtWasInGameSettlement || '').toLowerCase() === 'true';
		if (isInGameSettlementRequest) {
			const programDate = parseGameListProgramDate(req.body.txtInGameProgramDate);
			if (!normalizeSettlementDateYmd(programDate)) {
				return res.status(400).json({ error: 'Program date is required for in-game settlement.' });
			}

			const lastRollingCC = parseChipAmount(req.body.txtInGameLastRolling);
			const tips = parseInGameTips(req.body);

			const connection = await pool.getConnection();
			try {
				await connection.beginTransaction();
				const [gameMetaRows] = await connection.execute(
					`SELECT INITIAL_MOP FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1`,
					[id]
				);
				const initialMop = gameMetaRows.length ? gameMetaRows[0].INITIAL_MOP : null;
				const parentTransType = await resolveParentTransType(connection, id, initialMop);
				const settlementFigures = await computeInGameSettlementFigures(connection, id, req.body);
				const cashoutLegs = buildInGameParentCashoutLegs(req.body, parentTransType);
				const buyInLegs = buildInGameNewGameBuyInLegs(req.body, parentTransType, settlementFigures.payment);

				const settleResult = await performInGameSettlement(connection, {
					parentGameId: id,
					encodedBy: editedBy,
					dateNow: date_now,
					programDate,
					cashoutLegs,
					buyInLegs,
					settlementFigures,
					lastRollingCC,
					tips,
					rollerName: (req.body.txtTipRollerName || '').toString().trim(),
					tipStatus: (req.body.txtTipStatus || '').toString().trim()
				});
				await connection.commit();
				return res.json({
					success: true,
					message: 'In-game settlement recorded.',
					new_game_id: settleResult.newGameId
				});
			} catch (settleErr) {
				try {
					await connection.rollback();
				} catch (rbErr) {
					console.error('in-game settlement rollback:', rbErr);
				}
				console.error('Error in in-game settlement change_status:', settleErr);
				const statusCode = settleErr.statusCode || 500;
				const msg = settleErr.message || 'Error processing in-game settlement.';
				return res.status(statusCode).json({ error: msg });
			} finally {
				connection.release();
			}
		}

		// ✅ Update game_list status
		if (txtStatus === '2') {
			// ON GAME: revert settlement — soft-delete commission ledger/cash rows, clear settled flags
			const [gameRow] = await pool.execute(
				`SELECT ACCOUNT_ID, PAYMENT FROM game_list WHERE IDNo = ?`,
				[id]
			);
			const accId = gameRow.length > 0 ? gameRow[0].ACCOUNT_ID : null;
			const paymentForLegacy = gameRow.length > 0 ? gameRow[0].PAYMENT : null;

			await pool.execute(
				`UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
				 WHERE GAME_ID = ? AND ACTIVE = 1 AND TRANSACTION_TYPE = 5 AND TRANSACTION_DESC = 'COMMISSION'`,
				[editedBy, date_now, id]
			);

			if (accId != null && paymentForLegacy != null && !Number.isNaN(parseFloat(paymentForLegacy)) && parseFloat(paymentForLegacy) !== 0) {
				await pool.execute(
					`UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
					 WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND ACTIVE = 1 AND TRANSACTION_TYPE = 5
					 AND TRANSACTION_DESC = 'COMMISSION' AND ROUND(AMOUNT, 2) = ROUND(?, 2)`,
					[editedBy, date_now, accId, paymentForLegacy]
				);
			}

			await pool.execute(
				`UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
				 WHERE TRANSACTION_ID = ? AND ACTIVE = 1
				 AND CATEGORY IN ('Commission Cash-out', 'Commission Deposit', 'Commission')`,
				[editedBy, date_now, id]
			);

			await pool.execute(
				`UPDATE game_list SET ACTIVE = ?, GAME_ENDED = NULL, SETTLED = 0, FNB = 0, PAYMENT = 0, FAKE_SETTLE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
				[txtStatus, editedBy, date_now, id]
			);
		} else {
			await pool.execute(
				`UPDATE game_list SET ACTIVE = ?, GAME_ENDED = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
				[txtStatus, date_now, editedBy, date_now, id]
			);
		}

		// ✅ If game is being closed (status = 1 or 3), insert roller chips return (skip on CUT OFF)
		if ((txtStatus === "1" || txtStatus === "3") && !isCutoffRequest) {
			// Insert roller chips return if provided
			const returnNNAmount = parseFloat((txtReturnRollerNN || '0').replace(/,/g, '')) || 0;
			const returnCCAmount = parseFloat((txtReturnRollerCC || '0').replace(/,/g, '')) || 0;
			
			if (returnNNAmount > 0 || returnCCAmount > 0) {
				const rollerChipsReturnSQL = `
					INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, ENCODED_BY, ENCODED_DT)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`;
				await pool.execute(rollerChipsReturnSQL, [
					id, 
					date_now, 
					5, // CAGE_TYPE 5 for ROLLER CHIPS
					0, // AMOUNT is 0 for roller chips
					0, // NN_CHIPS is 0 (roller chips use ROLLER_NN_CHIPS)
					0, // CC_CHIPS is 0 (roller chips use ROLLER_CC_CHIPS)
					returnNNAmount, // ROLLER_NN_CHIPS
					returnCCAmount, // ROLLER_CC_CHIPS
					2, // ROLLER_TRANSACTION: 2 = RETURN
					req.session.user_id, 
					date_now
				]);
			}
		}

		res.send('Game status updated successfully');
	} catch (error) {
		console.error('Error processing request:', error);
		res.status(500).send('Error processing request');
	}
});

// Assign or change guest on an existing game (ON GAME, END GAME, or PENDING).
router.put('/game_list/:id/guest', async (req, res) => {
	try {
		const encodedBy = req.session.user_id;
		if (!encodedBy) return res.status(401).json({ error: 'User session not found' });

		const gameId = parseInt(req.params.id, 10);
		if (!gameId) return res.status(400).json({ error: 'Invalid game ID.' });

		let guestIdRaw = req.body.guest_id ?? req.body.GUEST_ID ?? req.body.txtGuestId;
		let guestId = null;
		if (guestIdRaw !== undefined && guestIdRaw !== null && String(guestIdRaw).trim() !== '' && String(guestIdRaw).toLowerCase() !== 'null') {
			guestId = parseInt(guestIdRaw, 10) || null;
			if (!guestId) return res.status(400).json({ error: 'Invalid guest ID.' });
		}

		const [gameRows] = await pool.execute(
			`SELECT gl.IDNo, gl.ACTIVE, gl.ACCOUNT_ID, gl.GUEST_ID, acc.AGENT_ID
			 FROM game_list gl
			 JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
			 WHERE gl.IDNo = ? AND gl.ACTIVE != 0
			 LIMIT 1`,
			[gameId]
		);
		if (!gameRows.length) {
			return res.status(404).json({ error: 'Game not found.' });
		}
		const game = gameRows[0];
		const activeStatus = parseInt(game.ACTIVE, 10);
		if (![1, 2, 3].includes(activeStatus)) {
			return res.status(400).json({ error: 'Guest can only be assigned on active games (ON GAME, END GAME, or PENDING).' });
		}

		if (guestId) {
			const [guestRows] = await pool.execute(
				`SELECT IDNo FROM guest WHERE IDNo = ? AND AGENT_ID = ? AND ACTIVE = 1 LIMIT 1`,
				[guestId, game.AGENT_ID]
			);
			if (!guestRows.length) {
				return res.status(400).json({ error: 'Guest does not belong to this account.' });
			}
		}

		const prevGuestIdRaw = game.GUEST_ID;
		const prevGuestId =
			prevGuestIdRaw !== undefined && prevGuestIdRaw !== null && String(prevGuestIdRaw).trim() !== ''
				? parseInt(prevGuestIdRaw, 10) || null
				: null;
		const guestUnchanged =
			(prevGuestId == null && guestId == null) ||
			(prevGuestId != null && guestId != null && prevGuestId === guestId);

		const dateNow = new Date();
		await pool.execute(
			`UPDATE game_list SET GUEST_ID = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
			[guestId, encodedBy, dateNow, gameId]
		);

		if (!guestUnchanged) {
			try {
				await pool.execute(
					`INSERT INTO game_guest_history (GAME_ID, PREV_GUEST_ID, NEW_GUEST_ID, ENCODED_BY, ENCODED_DT)
					 VALUES (?, ?, ?, ?, ?)`,
					[gameId, prevGuestId, guestId, encodedBy, dateNow]
				);
			} catch (histErr) {
				console.error('game_guest_history insert failed:', histErr);
			}
		}

		const guestName = guestId ? await fetchGuestDisplayNameById(pool, guestId) : '';
		res.json({
			success: true,
			game_id: gameId,
			guest_id: guestId,
			guest_name: guestName || '-'
		});
	} catch (error) {
		console.error('PUT /game_list/:id/guest:', error);
		res.status(500).json({ error: error.message || 'Error updating guest.' });
	}
});

router.get('/game_list/:id/guest_history', async (req, res) => {
	try {
		const gameId = parseInt(req.params.id, 10);
		if (!gameId) return res.status(400).json({ error: 'Invalid game ID.' });

		const [rows] = await pool.execute(
			`SELECT
				h.IDNo AS id,
				DATE_FORMAT(h.ENCODED_DT, '%b %e, %Y %H:%i') AS changed_at,
				UNIX_TIMESTAMP(h.ENCODED_DT) AS changed_sort,
				h.PREV_GUEST_ID AS prev_guest_id,
				h.NEW_GUEST_ID AS new_guest_id,
				COALESCE(NULLIF(TRIM(g1.NAME), ''), '-') AS prev_guest_name,
				COALESCE(NULLIF(TRIM(g2.NAME), ''), '-') AS new_guest_name,
				COALESCE(ui.USERNAME, CAST(h.ENCODED_BY AS CHAR)) AS changed_by
			FROM game_guest_history h
			LEFT JOIN guest g1 ON g1.IDNo = h.PREV_GUEST_ID
			LEFT JOIN guest g2 ON g2.IDNo = h.NEW_GUEST_ID
			LEFT JOIN user_info ui ON ui.IDNo = h.ENCODED_BY
			WHERE h.GAME_ID = ?
			ORDER BY h.ENCODED_DT DESC, h.IDNo DESC`,
			[gameId]
		);
		return res.json(rows || []);
	} catch (error) {
		console.error('GET /game_list/:id/guest_history:', error);
		return res.status(500).json({ error: error.message || 'Error loading guest history.' });
	}
});

// PENDING resolve — guest fault: additional buy-in, then end game (ACTIVE = 1)
router.post('/game_list/pending_resolve/guest_buyin', async (req, res) => {
	try {
		const encodedBy = req.session.user_id;
		if (!encodedBy) return res.status(401).json({ error: 'User session not found' });

		const gameId = parseInt(req.body.pending_game_id || req.body.game_id, 10);
		const accountId = parseInt(req.body.txtAccountCode, 10);
		const transType = parseInt(req.body.txtTransType, 10);
		const nnAmount = parseFloat(String(req.body.txtNN || '0').replace(/,/g, '')) || 0;
		const ccAmount = parseFloat(String(req.body.txtCC || '0').replace(/,/g, '')) || 0;
		const requiredBalance = parseFloat(String(req.body.required_balance || '0').replace(/,/g, '')) || 0;
		const enteredTotal = nnAmount + ccAmount;

		if (!gameId || !accountId || !transType) {
			return res.status(400).json({ error: 'Missing required fields.' });
		}
		if (enteredTotal <= 0) {
			return res.status(400).json({ error: 'Buy-in amount must be greater than zero.' });
		}
		if (nnAmount > 0 && nnAmount % 1000 !== 0) {
			return res.status(400).json({ error: 'NN Chips must be in thousands (e.g. 1,000 / 2,000).' });
		}

		const pendingGame = await assertPendingGame(pool, gameId);
		if (parseInt(pendingGame.ACCOUNT_ID, 10) !== accountId) {
			return res.status(400).json({ error: 'Account does not match this game.' });
		}

		const rollerTotals = await getRollerTotalsForGame(pool, gameId);
		const balance = rollerTotals.requiredReturnTotal;
		if (balance <= 0) {
			return res.status(400).json({ error: 'No outstanding roller chips balance on this game.' });
		}
		if (Math.abs(enteredTotal - balance) > 0.001) {
			return res.status(400).json({
				error: `Buy-in total (${enteredTotal}) must equal outstanding balance (${balance}).`
			});
		}
		if (requiredBalance > 0 && Math.abs(requiredBalance - balance) > 0.001) {
			return res.status(400).json({ error: 'Outstanding balance has changed. Please reopen the modal.' });
		}

		if (transType === 2) {
			const guestBal = parseFloat(String(req.body.totalBalanceGuest2 || '0').replace(/,/g, '')) || 0;
			if (enteredTotal > guestBal) {
				return res.status(400).json({ error: 'Deposit amount exceeds guest available balance.' });
			}
		}

		const dateNow = new Date();

		const buyinResult = await insertAdditionalBuyinForGame(pool, {
			gameId,
			accountId,
			transType,
			nnAmount,
			ccAmount,
			encodedBy,
			dateNow
		});
		const rollerReturn = await insertAutoRollerReturnForPendingGame(pool, gameId, encodedBy, dateNow, rollerTotals, {
			returnNN: nnAmount,
			returnCC: ccAmount
		});
		const remarks = req.body.txtRemarks;
		await setPendingRollerResolve(
			pool,
			gameId,
			1,
			null,
			encodedBy,
			remarks,
			rollerReturn.inserted ? rollerReturn.recordId : null,
			buyinResult.buyinRecordIds
		);

		res.json({
			success: true,
			message: 'Additional buy-in saved. Game ended. Roller chips returned automatically.',
			pending_roller_resolve: 1,
			roller_return: rollerReturn
		});
	} catch (error) {
		console.error('pending_resolve guest_buyin:', error);
		res.status(error.statusCode || 500).json({ error: error.message || 'Error processing request' });
	}
});

router.get('/game_list/pending_resolve/junket_account', async (req, res) => {
	try {
		const [rows] = await pool.execute(
			`SELECT acc.IDNo AS account_id, ag.AGENT_CODE AS agent_code, ag.NAME AS agent_name
			 FROM account acc
			 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 WHERE acc.IDNo = ?
			 LIMIT 1`,
			[PENDING_JUNKET_RESOLVE_ACCOUNT_ID]
		);
		if (!rows.length) {
			return res.status(404).json({ error: 'Junket account (IDNo -1) is not configured.' });
		}
		res.json(rows[0]);
	} catch (error) {
		console.error('pending_resolve junket_account:', error);
		res.status(500).json({ error: error.message || 'Error loading junket account.' });
	}
});

// PENDING resolve — junket fault: new game buy-in, then end pending game (ACTIVE = 1)
router.post('/game_list/pending_resolve/junket_new_game', async (req, res) => {
	try {
		const encodedBy = req.session.user_id;
		if (!encodedBy) return res.status(401).json({ error: 'User session not found' });

		const pendingGameId = parseInt(req.body.pending_game_id, 10);
		const accountId = PENDING_JUNKET_RESOLVE_ACCOUNT_ID;
		const guestId = null;
		const gameType = 'LIVE';
		const commType = 1;
		const commRate = 0;
		const nnAmount = parseFloat(String(req.body.txtNN || '0').replace(/,/g, '')) || 0;
		const ccAmount = parseFloat(String(req.body.txtCC || '0').replace(/,/g, '')) || 0;
		const requiredBalance = parseFloat(String(req.body.required_balance || '0').replace(/,/g, '')) || 0;
		const enteredTotal = nnAmount + ccAmount;
		const transType = 1;

		if (!pendingGameId) {
			return res.status(400).json({ error: 'Missing required fields.' });
		}

		const [junketAccountRows] = await pool.execute(
			`SELECT acc.IDNo FROM account acc WHERE acc.IDNo = ? LIMIT 1`,
			[accountId]
		);
		if (!junketAccountRows.length) {
			return res.status(400).json({ error: 'Junket account (IDNo -1) is not configured.' });
		}
		if (enteredTotal <= 0) {
			return res.status(400).json({ error: 'Buy-in amount must be greater than zero.' });
		}
		if (nnAmount > 0 && nnAmount % 1000 !== 0) {
			return res.status(400).json({ error: 'NN Chips must be in thousands (e.g. 1,000 / 2,000).' });
		}

		await assertPendingGame(pool, pendingGameId);

		const rollerTotals = await getRollerTotalsForGame(pool, pendingGameId);
		const balance = rollerTotals.requiredReturnTotal;
		if (balance <= 0) {
			return res.status(400).json({ error: 'No outstanding roller chips balance on this game.' });
		}
		if (Math.abs(enteredTotal - balance) > 0.001) {
			return res.status(400).json({
				error: `Buy-in total (${enteredTotal}) must equal outstanding balance (${balance}).`
			});
		}
		if (requiredBalance > 0 && Math.abs(requiredBalance - balance) > 0.001) {
			return res.status(400).json({ error: 'Outstanding balance has changed. Please reopen the modal.' });
		}

		const dateNow = new Date();
		const programDate = formatLocalDateYmd(dateNow);
		const initialMOP = 'CASH';

		const [newGameResult] = await pool.execute(
			`INSERT INTO game_list (ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[accountId, guestId, gameType, initialMOP, commType, commRate, encodedBy, dateNow, programDate]
		);
		const newGameId = newGameResult.insertId;

		const gameRecordSQL = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		await pool.execute(gameRecordSQL, [newGameId, dateNow, 1, 0, nnAmount, ccAmount, transType, encodedBy, dateNow]);
		await pool.execute(gameRecordSQL, [newGameId, dateNow, 3, 0, nnAmount, ccAmount, transType, encodedBy, dateNow]);
		const rollerReturn = await insertAutoRollerReturnForPendingGame(pool, pendingGameId, encodedBy, dateNow, rollerTotals, {
			returnNN: nnAmount,
			returnCC: ccAmount
		});
		const remarks = req.body.txtRemarks;
		await setPendingRollerResolve(
			pool,
			pendingGameId,
			2,
			newGameId,
			encodedBy,
			remarks,
			rollerReturn.inserted ? rollerReturn.recordId : null
		);
		const junketLossId = await ensureJunketLossForRollerMissing(pool, pendingGameId, balance, encodedBy, 'New Game', remarks);

		res.json({
			success: true,
			message: 'New game created. Pending game ended. Roller chips returned automatically.',
			new_game_id: newGameId,
			junket_loss_id: junketLossId,
			pending_roller_resolve: 2,
			roller_return: rollerReturn
		});
	} catch (error) {
		console.error('pending_resolve junket_new_game:', error);
		res.status(error.statusCode || 500).json({ error: error.message || 'Error processing request' });
	}
});


// ADD SETTLEMENT
router.post('/add_settlement', async (req, res) => {
	const {
		game_id_settle,
		txtAccountIDSettle,
		txtTransType,
		txtPayment,
		txtFNB,
		txtSettlementBalance,
		txtCutoffLinkedGameIds,
		send_telegram_agent,
		send_telegram_cage
	} = req.body;

	const sendTelegramAgent = send_telegram_agent === '1' || send_telegram_agent === 1 || send_telegram_agent === true;
	const sendTelegramCage = send_telegram_cage === '1' || send_telegram_cage === 1 || send_telegram_cage === true;

	// Validate required fields
	if (!game_id_settle || !txtAccountIDSettle || !txtTransType || !txtPayment || !txtFNB) {
		return res.status(400).json({ success: false, message: 'Missing required fields' });
	}

	// Remove commas from txtPayment and txtFNB
	let paymentValue = txtPayment.replace(/,/g, '');
	let fnbValue = txtFNB.replace(/,/g, '');
	let date_now = new Date();

	// TRANSACTION DETAILS
	let FNBDESC = 'COMMISSION';

	try {
		let fakeSettleBefore = 0;
		try {
			const [glRows] = await pool.execute(
				'SELECT COALESCE(FAKE_SETTLE, 0) AS FAKE_SETTLE FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1',
				[game_id_settle]
			);
			if (glRows.length > 0) {
				fakeSettleBefore = Number(glRows[0].FAKE_SETTLE) === 1 ? 1 : 0;
			}
		} catch (fakeErr) {
			fakeSettleBefore = 0;
		}

		// Insert settlement details into account_ledger (GAME_ID for direct link)
		const insertQuery = `INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
		await pool.execute(insertQuery, [txtAccountIDSettle, game_id_settle, txtTransType, 5, FNBDESC, paymentValue, req.session.user_id, date_now]);

		// Update the settled status, FNB, PAYMENT in game_list (clear fake-settle slip flag)
		const updateQuery = `UPDATE game_list SET SETTLED = 1, FNB = ?, PAYMENT = ?, FAKE_SETTLE = 0 WHERE IDNo = ?`;
		await pool.execute(updateQuery, [fnbValue, paymentValue, game_id_settle]);

		// Cut-off pair: mark linked games settled (commission recorded on primary game only)
		const primaryGameId = parseInt(game_id_settle, 10);
		if (txtCutoffLinkedGameIds && primaryGameId) {
			const linkedIds = String(txtCutoffLinkedGameIds)
				.split(',')
				.map((id) => parseInt(id.trim(), 10))
				.filter((id) => !isNaN(id) && id > 0 && id !== primaryGameId);
			for (const linkedId of linkedIds) {
				await pool.execute(
					`UPDATE game_list SET SETTLED = 1, FNB = 0, PAYMENT = 0, FAKE_SETTLE = 0 WHERE IDNo = ? AND ACTIVE != 0`,
					[linkedId]
				);
			}
		}

		// Fetch AGENT_CODE, NAME, and TELEGRAM_ID
		const agentQuery = `
            SELECT agent.IDNo AS agent_id, agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID,
                   COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.ACTIVE = 1 AND account.IDNo = ?
        `;

		let time_now = new Date();
		time_now.setHours(time_now.getHours());
		let updated_time = time_now.toLocaleTimeString();
		let date_nowTG = new Date().toLocaleDateString();

		const [agentResults] = await pool.query(agentQuery, [txtAccountIDSettle]);

		if (agentResults.length > 0) {
			const { agent_id: agentId, AGENT_CODE: agentCode, NAME: agentName } = agentResults[0];
			const telegramId = getAgentTelegramChatId(agentResults[0]);

			const cutoffCtx = buildSettlementTelegramCutoffContext(game_id_settle, txtCutoffLinkedGameIds);
			const totals = cutoffCtx.isCutoff
				? await fetchCombinedSettlementTotals(cutoffCtx.gameIds)
				: await fetchSettlementTotalsForGameId(game_id_settle);
			const { total_buy_in, total_cash_out, winloss, total_rolling } = totals;
			const gameRemark = cutoffCtx.isCutoff ? cutoffCtx.gameNumbersDisplay : String(game_id_settle);

			// Get commission type + GAME_TYPE (e.g. LIVE) from game_list for Telegram
			let commissionTextLine = '';
			let commissionMgmtLine = '';
			let gameTypeLine = '';
			let gameTypeMgmtLine = '';
			try {
				const [gameInfoRows] = await pool.execute(
					'SELECT COMMISSION_TYPE, GAME_TYPE FROM game_list WHERE IDNo = ? LIMIT 1',
					[game_id_settle]
				);
				if (Array.isArray(gameInfoRows) && gameInfoRows.length > 0) {
					const row = gameInfoRows[0];
					const commissionType = parseInt(row.COMMISSION_TYPE, 10) || null;
					if (commissionType === 2) {
						commissionTextLine = '\n게임타입 : 셰어';
						commissionMgmtLine = '\n게임타입 GameType : 셰어 Share';
					} else if (commissionType === 3) {
						commissionTextLine = '\n게임타입 : 루징';
						commissionMgmtLine = '\n게임타입 GameType : 루징 Losing';
					}
					if (row.GAME_TYPE != null && String(row.GAME_TYPE).trim() !== '') {
						const gt = telegramSettlementGameTypeLines(row.GAME_TYPE);
						gameTypeLine = gt.agentLine;
						gameTypeMgmtLine = gt.managementLine;
					}
				}
			} catch (commissionErr) {
				console.error('Failed to load commission type for settlement:', commissionErr.message || commissionErr);
			}

			// Prepare the Telegram message
			let text;
			let managementText; // Message for management (without account balance)
			if (txtTransType == 1) {
				const balRaw = txtSettlementBalance != null && txtSettlementBalance !== '' ? String(txtSettlementBalance) : '0';
				const currentBalance = parseFloat(balRaw.replace(/,/g, '') || '0') + parseFloat(paymentValue);
				text = `Demo Cage\n\n* 게임종료 / 정산 *${cutoffCtx.agentTitleLine}\n\n계정: ${agentCode} - ${agentName}${cutoffCtx.agentGameLine}${gameTypeLine}${commissionTextLine}\n커미션: ${parseFloat(paymentValue).toLocaleString('en-US')} - 계좌입금\n잔고: ${parseFloat(currentBalance).toLocaleString('en-US')}\n\n바이인 합계: ${total_buy_in.toLocaleString('en-US')}\n캐시아웃 합계: ${total_cash_out.toLocaleString('en-US')}\n윈/로스: ${winloss.toLocaleString('en-US')}\n토탈롤링: ${total_rolling.toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				// Management/agent message: bilingual labels, no payment type
				managementText = `Demo Cage\n\n* 게임종료 / 정산 End Game *${cutoffCtx.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}${cutoffCtx.mgmtGameLine}${gameTypeMgmtLine}${commissionMgmtLine}\n커미션 Commission : ${parseFloat(paymentValue).toLocaleString('en-US')}\n\n바이인 합계 Total Buy-in : ${total_buy_in.toLocaleString('en-US')}\n캐시아웃 합계 Total Cashout: ${total_cash_out.toLocaleString('en-US')}\n윈/로스 Win/Loss : ${winloss.toLocaleString('en-US')}\n토탈롤링 Total Rolling: ${total_rolling.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
			} else {
				text = `Demo Cage\n\n* 게임종료 / 정산 *${cutoffCtx.agentTitleLine}\n\n계정: ${agentCode} - ${agentName}${cutoffCtx.agentGameLine}${gameTypeLine}${commissionTextLine}\n커미션: ${parseFloat(paymentValue).toLocaleString('en-US')} - 현금\n\n바이인 합계: ${total_buy_in.toLocaleString('en-US')}\n캐시아웃 합계: ${total_cash_out.toLocaleString('en-US')}\n윈/로스: ${winloss.toLocaleString('en-US')}\n토탈롤링: ${total_rolling.toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				// Management/agent message: bilingual labels, no payment type
				managementText = `Demo Cage\n\n* 게임종료 / 정산 End Game *${cutoffCtx.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}${cutoffCtx.mgmtGameLine}${gameTypeMgmtLine}${commissionMgmtLine}\n커미션 Commission : ${parseFloat(paymentValue).toLocaleString('en-US')}\n\n바이인 합계 Total Buy-in : ${total_buy_in.toLocaleString('en-US')}\n캐시아웃 합계 Total Cashout: ${total_cash_out.toLocaleString('en-US')}\n윈/로스 Win/Loss : ${winloss.toLocaleString('en-US')}\n토탈롤링 Total Rolling: ${total_rolling.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
			}

			const sendAgentPaths = fakeSettleBefore !== 1 || sendTelegramAgent;
			const sendCagePaths = fakeSettleBefore !== 1 || sendTelegramCage;
			const settlementLogLabel = cutoffCtx.isCutoff ? 'End Game / Settlement (Cut Off)' : 'End Game / Settlement';
			const settlementOpts = gamebookTelegramOpts(
				settlementLogLabel,
				agentCode,
				agentName,
				paymentValue,
				cutoffCtx.gameNumbersDisplay
			);

			if (sendAgentPaths) {
				if (telegramId) {
					try {
						await sendTelegramMessage(text, telegramId, settlementOpts);
					} catch (telegramError) {
						console.error('Failed to send Telegram message to agent:', telegramError.message);
					}
				} else {
					console.error("No TELEGRAM_ID found for Account ID:", txtAccountIDSettle);
				}
				try {
					await sendToAgentNotifications(agentCode, managementText, settlementOpts);
				} catch (telegramError) {
					console.error('Failed to send to agent notifications:', telegramError.message);
				}
				try {
					await sendTelegramToAdditionalChats(text, settlementOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to additional chats:', telegramError.message);
				}
			}

			if (sendCagePaths) {
				try {
					await sendTelegramToManagement(managementText, settlementOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to management:', telegramError.message);
				}
			}

			const insertCashEntry = async (category, type, remark) => {
				if (!agentId) return;
				const cashTransactionQuery = `
					INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`;
				await pool.execute(cashTransactionQuery, [
					game_id_settle,
					agentId,
					paymentValue.toString(),
					category,
					type,
					remark,
					req.session.user_id,
					date_now
				]);
			};

			// Skip cash_transaction insert when payment amount is 0
			if (parseFloat(paymentValue) !== 0) {
				if (txtTransType == 5) {
					await insertCashEntry('Commission Cash-out', 2, `Game - ${gameRemark}`);
				} else if (txtTransType == 1) {
					await insertCashEntry('Commission Deposit', 1, `Game - ${gameRemark}`);
					await insertCashEntry('Commission', 2, `Game - ${gameRemark}`);
				}
			}
		} else {
			console.error("No AGENT_CODE or NAME found for Account ID:", txtAccountIDSettle);
		}

		// Send JSON success response
		res.json({ success: true, message: 'Settlement saved and status updated' });

	} catch (err) {
		console.error('Error processing settlement:', err);
		res.status(500).json({ success: false, message: 'Error processing settlement' });
	}
});

// Telegram from slip values only (hindi official settlement): settled o hindi — fake / preview figures mula sa Edit → Done
router.post('/settlement_slip_telegram', checkSession, async (req, res) => {
	const {
		game_id_settle,
		txtAccountIDSettle,
		txtPayment,
		txtBuyIn,
		txtChipsReturn,
		txtWinLoss,
		txtRolling,
		txtTransType,
		txtSettlementBalance,
		txtCutoffLinkedGameIds,
		send_telegram_agent,
		send_telegram_cage
	} = req.body;

	const sendTelegramAgent = send_telegram_agent === '1' || send_telegram_agent === 1 || send_telegram_agent === true;
	const sendTelegramCage = send_telegram_cage === '1' || send_telegram_cage === 1 || send_telegram_cage === true;

	const stripMoney = (v) => {
		const n = parseFloat(String(v == null ? '0' : v).replace(/,/g, '').trim());
		return Number.isFinite(n) ? n : 0;
	};

	if (!game_id_settle || !txtAccountIDSettle) {
		return res.status(400).json({ success: false, message: 'Missing game or account' });
	}
	if (!sendTelegramAgent && !sendTelegramCage) {
		return res.status(400).json({ success: false, message: 'Select Send to Agent and/or Send to Cage' });
	}

	try {
		const [gameRows] = await pool.execute(
			'SELECT COMMISSION_TYPE, GAME_TYPE FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1',
			[game_id_settle]
		);
		if (gameRows.length === 0) {
			return res.status(404).json({ success: false, message: 'Game not found' });
		}

		const agentQuery = `
            SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.ACTIVE = 1 AND account.IDNo = ?
        `;
		const [agentResults] = await pool.query(agentQuery, [txtAccountIDSettle]);
		if (agentResults.length === 0) {
			return res.status(404).json({ success: false, message: 'Agent not found for account' });
		}

		const { AGENT_CODE: agentCode, NAME: agentName } = agentResults[0];
		const telegramId = getAgentTelegramChatId(agentResults[0]);

		const paymentValue = stripMoney(txtPayment);
		const total_buy_in = stripMoney(txtBuyIn);
		const total_cash_out = stripMoney(txtChipsReturn);
		const winloss = stripMoney(txtWinLoss);
		const total_rolling = stripMoney(txtRolling);

		let commissionTextLine = '';
		let commissionMgmtLine = '';
		let gameTypeLine = '';
		let gameTypeMgmtLine = '';
		const commissionType = parseInt(gameRows[0].COMMISSION_TYPE, 10) || null;
		if (commissionType === 2) {
			commissionTextLine = '\n게임타입 : 셰어';
			commissionMgmtLine = '\n게임타입 GameType : 셰어 Share';
		} else if (commissionType === 3) {
			commissionTextLine = '\n게임타입 : 루징';
			commissionMgmtLine = '\n게임타입 GameType : 루징 Losing';
		}
		if (gameRows[0].GAME_TYPE != null && String(gameRows[0].GAME_TYPE).trim() !== '') {
			const gt = telegramSettlementGameTypeLines(gameRows[0].GAME_TYPE);
			gameTypeLine = gt.agentLine;
			gameTypeMgmtLine = gt.managementLine;
		}

		const time_now = new Date();
		const updated_time = time_now.toLocaleTimeString();
		const date_nowTG = new Date().toLocaleDateString();

		const tt = txtTransType == null || txtTransType === '' ? '' : String(txtTransType);
		const cutoffCtx = buildSettlementTelegramCutoffContext(game_id_settle, txtCutoffLinkedGameIds);

		let text;
		let managementText;

		if (tt === '1') {
			const balRaw = txtSettlementBalance != null && txtSettlementBalance !== '' ? String(txtSettlementBalance) : '0';
			const currentBalance = stripMoney(balRaw) + paymentValue;
			text = `Demo Cage\n\n* 게임종료 / 정산 *${cutoffCtx.agentTitleLine}\n\n계정: ${agentCode} - ${agentName}${cutoffCtx.agentGameLine}${gameTypeLine}${commissionTextLine}\n커미션: ${paymentValue.toLocaleString('en-US')} - 계좌입금\n잔고: ${currentBalance.toLocaleString('en-US')}\n\n바이인 합계: ${total_buy_in.toLocaleString('en-US')}\n캐시아웃 합계: ${total_cash_out.toLocaleString('en-US')}\n윈/로스: ${winloss.toLocaleString('en-US')}\n토탈롤링: ${total_rolling.toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
			managementText = `Demo Cage\n\n* 게임종료 / 정산 End Game *\n(편집됨 / Edited)${cutoffCtx.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}${cutoffCtx.mgmtGameLine}${gameTypeMgmtLine}${commissionMgmtLine}\n커미션 Commission : ${paymentValue.toLocaleString('en-US')}\n\n바이인 합계 Total Buy-in : ${total_buy_in.toLocaleString('en-US')}\n캐시아웃 합계 Total Cashout: ${total_cash_out.toLocaleString('en-US')}\n윈/로스 Win/Loss : ${winloss.toLocaleString('en-US')}\n토탈롤링 Total Rolling: ${total_rolling.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
		} else {
			text = `Demo Cage\n\n* 게임종료 / 정산 *${cutoffCtx.agentTitleLine}\n\n계정: ${agentCode} - ${agentName}${cutoffCtx.agentGameLine}${gameTypeLine}${commissionTextLine}\n커미션: ${paymentValue.toLocaleString('en-US')} - 현금\n\n바이인 합계: ${total_buy_in.toLocaleString('en-US')}\n캐시아웃 합계: ${total_cash_out.toLocaleString('en-US')}\n윈/로스: ${winloss.toLocaleString('en-US')}\n토탈롤링: ${total_rolling.toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
			managementText = `Demo Cage\n\n* 게임종료 / 정산 End Game *\n(편집됨 / Edited)${cutoffCtx.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}${cutoffCtx.mgmtGameLine}${gameTypeMgmtLine}${commissionMgmtLine}\n커미션 Commission : ${paymentValue.toLocaleString('en-US')}\n\n바이인 합계 Total Buy-in : ${total_buy_in.toLocaleString('en-US')}\n캐시아웃 합계 Total Cashout: ${total_cash_out.toLocaleString('en-US')}\n윈/로스 Win/Loss : ${winloss.toLocaleString('en-US')}\n토탈롤링 Total Rolling: ${total_rolling.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
		}

		const editLogLabel = cutoffCtx.isCutoff ? 'End Game / Settlement (Cut Off, Edited)' : 'End Game / Settlement (Edited)';
		const editSettlementOpts = gamebookTelegramOpts(
			editLogLabel,
			agentCode,
			agentName,
			paymentValue,
			cutoffCtx.gameNumbersDisplay
		);
		if (sendTelegramAgent) {
			if (telegramId) {
				try {
					await sendTelegramMessage(text, telegramId, editSettlementOpts);
				} catch (e) {
					console.error('settlement_slip_telegram agent:', e.message);
				}
			}
			try {
				await sendToAgentNotifications(agentCode, managementText, editSettlementOpts);
			} catch (e) {
				console.error('settlement_slip_telegram agent notify:', e.message);
			}
			try {
				await sendTelegramToAdditionalChats(text, editSettlementOpts);
			} catch (e) {
				console.error('settlement_slip_telegram additional:', e.message);
			}
		}

		if (sendTelegramCage) {
			try {
				await sendTelegramToManagement(managementText, editSettlementOpts);
			} catch (e) {
				console.error('settlement_slip_telegram management:', e.message);
			}
		}

		return res.json({ success: true, message: 'Telegram sent' });
	} catch (err) {
		console.error('settlement_slip_telegram:', err);
		return res.status(500).json({ success: false, message: 'Error sending Telegram' });
	}
});

// Settlement slip: Done → fake_settle 1 (FAKE_SETTLE = 1). Official /add_settlement resets to 0.
router.put('/game_list/:gameId/settlement_fake_settle', checkSession, async (req, res) => {
	const gameId = parseInt(req.params.gameId, 10);
	const raw = req.body && (req.body.fake_settle != null ? req.body.fake_settle : req.body.FAKE_SETTLE);
	const fakeSettle = raw === 1 || raw === '1' || raw === true ? 1 : 0;

	if (!gameId || isNaN(gameId)) {
		return res.status(400).json({ success: false, message: 'Invalid game ID' });
	}

	try {
		const [rows] = await pool.execute(
			'SELECT IDNo FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1',
			[gameId]
		);
		if (rows.length === 0) {
			return res.status(404).json({ success: false, message: 'Game not found' });
		}

		await pool.execute(
			'UPDATE game_list SET FAKE_SETTLE = ? WHERE IDNo = ? AND ACTIVE != 0',
			[fakeSettle, gameId]
		);

		return res.json({ success: true, fake_settle: fakeSettle });
	} catch (err) {
		console.error('Error updating FAKE_SETTLE:', err);
		return res.status(500).json({ success: false, message: 'Error updating settlement flag' });
	}
});

// Update commission / game rate (Rolling, Shared, Loosing) for ACTIVE 1/2/3
router.put('/game_list/:id/commission_percentage', async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const raw = req.body && (req.body.commission_percentage != null ? req.body.commission_percentage : req.body.txtCommisionRate);
	const rate = parseFloat(String(raw || '').replace(/,/g, ''));
	const permissions = req.session?.permissions;
	const allowed = permissions === 0;
	if (!allowed) {
		return res.status(403).json({ error: 'Not authorized to edit game rate.' });
	}
	if (!id || isNaN(id)) {
		return res.status(400).json({ error: 'Invalid game ID' });
	}
	if (isNaN(rate) || rate < 0 || rate > 100) {
		return res.status(400).json({ error: 'Rate must be between 0 and 100.' });
	}
	try {
		const [rows] = await pool.execute(
			'SELECT COMMISSION_TYPE, ACTIVE FROM game_list WHERE IDNo = ?',
			[id]
		);
		const active = Number(rows?.[0]?.ACTIVE);
		if (rows.length === 0 || ![1, 2, 3].includes(active)) {
			return res.status(404).json({ error: 'Game not found' });
		}
		const ct = parseInt(rows[0].COMMISSION_TYPE, 10);
		if (ct === 2 && (rate < 50 || rate > 100)) {
			return res.status(400).json({ error: 'Shared game rate must be between 50% and 100%.' });
		}
		await pool.execute(
			'UPDATE game_list SET COMMISSION_PERCENTAGE = ? WHERE IDNo = ?',
			[rate, id]
		);
		res.json({ success: true, commission_percentage: rate });
	} catch (err) {
		console.error('Error updating commission percentage:', err);
		res.status(500).json({ error: 'Failed to update game rate' });
	}
});

// Update game remarks for active games
router.put('/game_list/:id/remarks', async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const raw = req.body && (req.body.remarks != null ? req.body.remarks : req.body.txtRemarks);
	const remarks = raw != null ? String(raw).trim() : '';
	const permissions = req.session?.permissions;
	if (permissions === 2) {
		return res.status(403).json({ error: 'Not authorized to edit remarks.' });
	}
	if (!id || isNaN(id)) {
		return res.status(400).json({ error: 'Invalid game ID' });
	}
	if (remarks.length > 500) {
		return res.status(400).json({ error: 'Remarks must be 500 characters or less.' });
	}
	try {
		const [rows] = await pool.execute(
			'SELECT ACTIVE FROM game_list WHERE IDNo = ? AND ACTIVE != 0',
			[id]
		);
		if (rows.length === 0) {
			return res.status(404).json({ error: 'Game not found.' });
		}
		await pool.execute(
			'UPDATE game_list SET REMARKS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[remarks || null, req.session.user_id, new Date(), id]
		);
		res.json({ success: true, remarks });
	} catch (err) {
		console.error('Error updating game remarks:', err);
		res.status(500).json({ error: 'Failed to update remarks' });
	}
});

// Update PROGRAM_DATE (date only) for ACTIVE 1/2/3
router.put('/game_list/:id/program_date', async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const program_date = normalizeSettlementDateYmd(req.body?.program_date);
	const permissions = req.session?.permissions;
	if (permissions === 2) {
		return res.status(403).json({ error: 'Not authorized to edit program date.' });
	}
	if (!id || isNaN(id)) {
		return res.status(400).json({ error: 'Invalid game ID' });
	}
	if (!program_date) {
		return res.status(400).json({ error: 'Invalid program date.' });
	}
	let connection;
	try {
		const [rows] = await pool.execute(
			'SELECT ACTIVE, SETTLED, PROGRAM_DATE FROM game_list WHERE IDNo = ? AND ACTIVE != 0',
			[id]
		);
		if (rows.length === 0) {
			return res.status(404).json({ error: 'Game not found' });
		}
		const active = Number(rows[0].ACTIVE);
		if (![1, 2, 3].includes(active)) {
			return res.status(404).json({ error: 'Game not found or not editable.' });
		}
		if (Number(rows[0].SETTLED) === 1 && permissions !== 0) {
			return res.status(403).json({ error: 'Cannot edit program date on a settled game.' });
		}
		const currentRaw = rows[0].PROGRAM_DATE;
		const currentYmd = currentRaw
			? formatLocalDateYmd(currentRaw instanceof Date ? currentRaw : new Date(currentRaw))
			: null;
		if (currentYmd === program_date) {
			return res.json({ success: true, program_date });
		}
		const trading_date = parseProgramDateAsDateTime(program_date);
		const editedBy = req.session.user_id;
		const editedDt = new Date();
		connection = await pool.getConnection();
		await connection.beginTransaction();
		await connection.execute(
			'UPDATE game_list SET PROGRAM_DATE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[program_date, editedBy, editedDt, id]
		);
		await connection.execute(
			'UPDATE game_record SET TRADING_DATE = ? WHERE GAME_ID = ?',
			[trading_date, id]
		);
		await connection.commit();
		res.json({ success: true, program_date });
	} catch (err) {
		if (connection) {
			try { await connection.rollback(); } catch (_) { /* ignore */ }
		}
		console.error('Error updating program date:', err);
		res.status(500).json({ error: 'Failed to update program date' });
	} finally {
		if (connection) connection.release();
	}
});

// Update game type (LIVE / TELEBET) for ACTIVE 1/2/3
router.put('/game_list/:id/game_type', async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const raw = req.body && (req.body.game_type != null ? req.body.game_type : req.body.GAME_TYPE);
	const gameType = normalizeTelegramGameTypeKey(raw);
	const permissions = req.session?.permissions;
	if (permissions === 2) {
		return res.status(403).json({ error: 'Not authorized to edit game type.' });
	}
	if (!id || isNaN(id)) {
		return res.status(400).json({ error: 'Invalid game ID' });
	}
	if (!gameType) {
		return res.status(400).json({ error: 'Game type must be LIVE or TELEBET.' });
	}
	try {
		const [rows] = await pool.execute(
			'SELECT GAME_TYPE, ACTIVE FROM game_list WHERE IDNo = ? AND ACTIVE != 0',
			[id]
		);
		const active = Number(rows?.[0]?.ACTIVE);
		if (rows.length === 0 || ![1, 2, 3].includes(active)) {
			return res.status(404).json({ error: 'Game not found or not editable.' });
		}
		const current = normalizeTelegramGameTypeKey(rows[0].GAME_TYPE) || 'LIVE';
		if (current === gameType) {
			return res.json({ success: true, game_type: gameType });
		}
		await pool.execute(
			'UPDATE game_list SET GAME_TYPE = ? WHERE IDNo = ?',
			[gameType, id]
		);
		res.json({ success: true, game_type: gameType });
	} catch (err) {
		console.error('Error updating game type:', err);
		res.status(500).json({ error: 'Failed to update game type' });
	}
});

// Update commission type (Rolling/Shared) for ACTIVE 1/2/3
router.put('/game_list/:id/commission_type', async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const newType = parseInt(req.body?.commission_type, 10);
	const hasRate = req.body && req.body.commission_percentage != null && req.body.commission_percentage !== '';
	const reqRate = hasRate ? parseFloat(String(req.body.commission_percentage).replace(/,/g, '')) : null;
	const permissions = req.session?.permissions;
	const allowed = permissions === 0;
	if (!allowed) {
		return res.status(403).json({ error: 'Not authorized to edit commission type.' });
	}
	if (!id || isNaN(id)) {
		return res.status(400).json({ error: 'Invalid game ID' });
	}
	if (![1, 2].includes(newType)) {
		return res.status(400).json({ error: 'Invalid commission type.' });
	}
	if (hasRate && (isNaN(reqRate) || reqRate < 0 || reqRate > 100)) {
		return res.status(400).json({ error: 'Rate must be between 0 and 100.' });
	}
	try {
		const [rows] = await pool.execute(
			'SELECT COMMISSION_PERCENTAGE, ACTIVE FROM game_list WHERE IDNo = ?',
			[id]
		);
		const active = Number(rows?.[0]?.ACTIVE);
		if (rows.length === 0 || ![1, 2, 3].includes(active)) {
			return res.status(404).json({ error: 'Game not found' });
		}
		let rate = hasRate ? reqRate : (Number(rows[0].COMMISSION_PERCENTAGE) || 0);
		// Shared game requires minimum 50%.
		if (newType === 2 && rate < 50) {
			if (hasRate) return res.status(400).json({ error: 'Shared game rate must be between 50% and 100%.' });
			rate = 50;
		}
		await pool.execute(
			'UPDATE game_list SET COMMISSION_TYPE = ?, COMMISSION_PERCENTAGE = ? WHERE IDNo = ?',
			[newType, rate, id]
		);
		res.json({ success: true, commission_type: newType, commission_percentage: rate });
	} catch (err) {
		console.error('Error updating commission type:', err);
		res.status(500).json({ error: 'Failed to update commission type' });
	}
});

// EDIT GAME LIST COMMISSION
router.put('/game_list/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const {
        txtExpense,
        txtActualAgent,
        txtRemarks,
        txtCashier,
        txtManager
    } = req.body;

    let date_now = new Date();

    const query = `UPDATE game_list SET EXPENSE = ?, ACTUAL_TO_AGENT = ?, REMARKS = ?, CASHIER = ?, MANAGER = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;

    try {
        await pool.execute(query, [txtExpense, txtActualAgent, txtRemarks, txtCashier, txtManager, req.session.user_id, date_now, id]);
        res.send('GAME LIST updated successfully');
    } catch (err) {
        console.error('Error updating GAME LIST:', err);
        res.status(500).send('Error updating GAME LIST');
    }
});





// ADD GAME RECORD BUYIN
router.post('/game_list/add/buyin', async (req, res) => {
	const {
		game_id,
		txtAccountCode,
		txtTransType,
		txtNN,
		txtCC,
		totalBalanceGuest2,
		txtTotalAmountBuyin
	} = req.body;

	// Block add when game is settled
	const [settledRows] = await pool.execute('SELECT SETTLED FROM game_list WHERE IDNo = ? AND ACTIVE != 0', [game_id]);
	if (settledRows.length > 0 && settledRows[0].SETTLED === 1) {
		return res.status(403).json({ error: 'Cannot add records to a settled game.' });
	}

	let date_now = new Date();

	// Remove commas from NN and CC
	let txtNNamount = txtNN.split(',').join("") || 0;
	let txtCCamount = txtCC.split(',').join("") || 0;

	let AddBuyinDESC = 'ADDITIONAL BUY-IN';

	try {
		// First insert into game_record table (CAGE_TYPE = 1)
		const query1 = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		const [result1] = await pool.execute(query1, [game_id, date_now, 1, 0, txtNNamount, txtCCamount, txtTransType, req.session.user_id, date_now]);

		const gameRecordId = result1.insertId; // ✅ This is your IDNo of the inserted game_record

		// Second insert into game_record table (CAGE_TYPE = 3)
		const query2 = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		await pool.execute(query2, [game_id, date_now, 3, 0, txtNNamount, txtCCamount, txtTransType, req.session.user_id, date_now]);

		let queries = [];
		let totalAmount = parseFloat(txtNNamount) + parseFloat(txtCCamount);

		// Insert into account_ledger if transaction type is 2 or 3 (GAME_ID for direct link)
		if (txtTransType == 2) {
			const query3 = `INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
			queries.push(pool.execute(query3, [txtAccountCode, game_id, 2, txtTransType, AddBuyinDESC, totalAmount, req.session.user_id, date_now]));
		}

		if (txtTransType == 3) {
			const query4 = `INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
			queries.push(pool.execute(query4, [txtAccountCode, game_id, 10, txtTransType, totalAmount, `Add Buy-in Game: ${game_id}`, req.session.user_id, date_now]));
		}

		// Wait for all queries to finish
		await Promise.all(queries);

		// Fetch AGENT_CODE and NAME
		const agentQuery = `
			SELECT agent.IDNo AS agent_id, agent.AGENT_CODE, agent.NAME
			FROM agent
			JOIN account ON account.AGENT_ID = agent.IDNo
			WHERE account.ACTIVE = 1 AND account.IDNo = ?
		`;
		const [agentResults] = await pool.execute(agentQuery, [txtAccountCode]);

		if (agentResults.length > 0) {
			const { agent_id: agentId, AGENT_CODE: agentCode, NAME: agentName } = agentResults[0];

			// Fetch TELEGRAM_ID
			const telegramIdQuery = `
				SELECT agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED 
				FROM agent
				JOIN account ON account.AGENT_ID = agent.IDNo
				WHERE account.ACTIVE = 1 AND account.IDNo = ?
			`;
			const [telegramIdResults] = await pool.execute(telegramIdQuery, [txtAccountCode]);

			const [buyinGameTypeRows] = await pool.execute(
				'SELECT GAME_TYPE FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1',
				[game_id]
			);
			const buyinGt = telegramGameTypeLabels(buyinGameTypeRows[0]?.GAME_TYPE);
			const buyinGameLineAgent = buyinGt.agentText ? ` - ${buyinGt.agentText}` : '';
			const buyinGameLineMgmt = buyinGt.managementText ? ` - ${buyinGt.managementText}` : '';
			const cutoffTelegram = await resolveCutoffTelegramGameContext(pool, game_id);
			const telegramGameNo = cutoffTelegram.telegramGameNo;

			let time_now = new Date();
			let updated_time = time_now.toLocaleTimeString();
			let date_nowTG = new Date().toLocaleDateString();

			// Calculate new TotalBalance after withdrawal
			const totalBuyin = parseFloat(txtTotalAmountBuyin.replace(/,/g, '')) + totalAmount;
			const newTotalBalance = totalBalanceGuest2 - totalAmount;

			// Prepare Telegram message text
			let text = '';
			let managementText = ''; // Message for management (without account balance)
			if (txtTransType == 2) {
				text = `Demo Cage\n\n* 추가 바이인 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${telegramGameNo}${buyinGameLineAgent}\n바이인: ${parseFloat(totalAmount).toLocaleString('en-US')} - 계좌출금\n바이인 합계: ${parseFloat(totalBuyin).toLocaleString('en-US')}\n잔고: ${parseFloat(newTotalBalance).toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				managementText = `Demo Cage\n\n* 추가 바이인 Add Buy-in *${cutoffTelegram.cutoffTitle.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}\n게임 Game #: ${cutoffTelegram.managementGameNo}${buyinGameLineMgmt}\n바이인 Buy-in : ${parseFloat(totalAmount).toLocaleString('en-US')}\n바이인 합계 Total Buy-in : ${parseFloat(totalBuyin).toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
			} else if (txtTransType == 1) {
				text = `Demo Cage\n\n* 추가 바이인 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${telegramGameNo}${buyinGameLineAgent}\n바이인: ${parseFloat(totalAmount).toLocaleString('en-US')} - 현금\n바이인 합계: ${parseFloat(totalBuyin).toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				managementText = `Demo Cage\n\n* 추가 바이인 Add Buy-in *${cutoffTelegram.cutoffTitle.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}\n게임 Game #: ${cutoffTelegram.managementGameNo}${buyinGameLineMgmt}\n바이인 Buy-in : ${parseFloat(totalAmount).toLocaleString('en-US')}\n바이인 합계 Total Buy-in : ${parseFloat(totalBuyin).toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
			} else if (txtTransType == 3) {
				text = `Demo Cage\n\n* 추가 바이인 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${telegramGameNo}${buyinGameLineAgent}\n바이인: ${parseFloat(totalAmount).toLocaleString('en-US')} - 크레딧\n바이인 합계: ${parseFloat(totalBuyin).toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				managementText = `Demo Cage\n\n* 추가 바이인 Add Buy-in *${cutoffTelegram.cutoffTitle.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}\n게임 Game #: ${cutoffTelegram.managementGameNo}${buyinGameLineMgmt}\n바이인 Buy-in : ${parseFloat(totalAmount).toLocaleString('en-US')}\n바이인 합계 Total Buy-in : ${parseFloat(totalBuyin).toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
			}

			// Send Telegram messages (when we have agent data)
		if (text !== '' && agentResults.length > 0) {
				const telegramId =
				telegramIdResults.length > 0 ? getAgentTelegramChatId(telegramIdResults[0]) : null;
				const addBuyinLogLabel = cutoffTelegram.isCutoffContinuation ? 'Add Buy-in (Cut Off)' : 'Add Buy-in';
				const addBuyinOpts = gamebookTelegramOpts(addBuyinLogLabel, agentCode, agentName, totalAmount, telegramGameNo);
				if (telegramId) {
					try {
						await sendTelegramMessage(text, telegramId, addBuyinOpts);
					} catch (telegramError) {
						console.error('Failed to send Telegram message to agent:', telegramError.message);
					}
				} else {
					console.error("No TELEGRAM_ID found for Account Code:", txtAccountCode);
				}
				try {
					await sendToAgentNotifications(agentCode, text, addBuyinOpts);
				} catch (telegramError) {
					console.error('Failed to send to agent notifications:', telegramError.message);
				}
				try {
					await sendTelegramToAdditionalChats(text, addBuyinOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to additional chats:', telegramError.message);
				}
				try {
					await sendTelegramToManagement(managementText, addBuyinOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to management:', telegramError.message);
				}
			}
		}

		if (txtTransType == 1 && agentResults.length > 0 && agentResults[0].agent_id) {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;

			await pool.execute(cashTransactionQuery, [
				game_id,
				agentResults[0].agent_id,
				totalAmount.toString(),
				'Additional buy-in',
				1,
				`Game - ${game_id}`,
				req.session.user_id,
				date_now
			]);
		}

		res.redirect('/game_list');
	} catch (error) {
		res.status(500).send(error);
	}
});

// ADD GAME RECORD BUYIN (Split: Cash + Deposit + Credit)
router.post('/game_list/add/buyin_split', async (req, res) => {
	const {
		game_id,
		txtAccountCode,
		totalBalanceGuest2,
		txtTotalAmountBuyin,
		split_cash_nn,
		split_cash_cc,
		split_dep_nn,
		split_dep_cc,
		split_credit_nn,
		split_credit_cc
	} = req.body;

	const parseAmt = (v) => {
		const s = (v === undefined || v === null ? '' : v).toString().replace(/,/g, '').trim();
		if (s === '') return 0;
		const n = parseFloat(s);
		return Number.isFinite(n) ? n : NaN;
	};

	const cashNn = parseAmt(split_cash_nn);
	const cashCc = parseAmt(split_cash_cc);
	const depNn = parseAmt(split_dep_nn);
	const depCc = parseAmt(split_dep_cc);
	const creditNn = parseAmt(split_credit_nn);
	const creditCc = parseAmt(split_credit_cc);

	const cashTotal = cashNn + cashCc;
	const depositTotal = depNn + depCc;
	const creditTotal = creditNn + creditCc;
	const grandTotal = cashTotal + depositTotal + creditTotal;
	const totalBalance = parseFloat((totalBalanceGuest2 || '0').toString().replace(/,/g, '')) || 0;
	const depositRemarks = (req.body.txtDepositRemarks || '').toString().trim();
	const creditRemarks = (req.body.txtCreditRemarks || '').toString().trim();
	const creditGuarantor = (req.body.txtCreditGuarantor || '').toString().trim();
	const cashRemarks = (req.body.txtCashRemarks || '').toString().trim();
	const date_now = new Date();

	const [settledRows] = await pool.execute('SELECT SETTLED FROM game_list WHERE IDNo = ? AND ACTIVE != 0', [game_id]);
	if (settledRows.length > 0 && settledRows[0].SETTLED === 1) {
		return res.status(403).json({ error: 'Cannot add records to a settled game.' });
	}
	if ([cashNn, cashCc, depNn, depCc, creditNn, creditCc].some((n) => !Number.isFinite(n) || n < 0)) {
		return res.status(400).json({ error: 'Invalid split amounts.' });
	}
	if ((cashNn > 0 && cashNn % 1000 !== 0) || (depNn > 0 && depNn % 1000 !== 0) || (creditNn > 0 && creditNn % 1000 !== 0)) {
		return res.status(400).json({ error: 'NN split amounts must be in thousands.' });
	}
	if (grandTotal <= 0) {
		return res.status(400).json({ error: 'Total amount must be greater than zero.' });
	}
	if (depositTotal > totalBalance) {
		return res.status(400).json({ error: 'Deposit amount exceeds available balance.' });
	}
	const guarantorErr = creditGuarantorRequiredError(creditTotal, creditGuarantor);
	if (guarantorErr) return res.status(400).json({ error: guarantorErr });

	const gameRecordSQL = GAME_RECORD_BUYIN_SQL;
	const ledgerDepositSQL = `INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
	const ledgerCreditSQL = `INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();

		let cashRecordId = null;
		const creditGameRecordRemarks = buildBuyinLedgerCreditRemarks(creditRemarks, creditGuarantor, `Add Buy-in Game: ${game_id}`);
		if (cashTotal > 0) {
			const [cashRecord] = await connection.execute(GAME_RECORD_BUYIN_WITH_REMARKS_SQL, [game_id, date_now, 1, 0, cashNn, cashCc, 1, cashRemarks || null, req.session.user_id, date_now]);
			cashRecordId = cashRecord.insertId;
			await connection.execute(gameRecordSQL, [game_id, date_now, 3, 0, cashNn, cashCc, 1, req.session.user_id, date_now]);
		}
		if (depositTotal > 0) {
			await connection.execute(GAME_RECORD_BUYIN_WITH_REMARKS_SQL, [game_id, date_now, 1, 0, depNn, depCc, 2, depositRemarks || null, req.session.user_id, date_now]);
			await connection.execute(gameRecordSQL, [game_id, date_now, 3, 0, depNn, depCc, 2, req.session.user_id, date_now]);
			await connection.execute(ledgerDepositSQL, [txtAccountCode, game_id, 2, 2, 'ADDITIONAL BUY-IN', depositTotal, depositRemarks || null, req.session.user_id, date_now]);
		}
		if (creditTotal > 0) {
			await connection.execute(GAME_RECORD_BUYIN_WITH_REMARKS_SQL, [game_id, date_now, 1, 0, creditNn, creditCc, 3, creditGameRecordRemarks, req.session.user_id, date_now]);
			await connection.execute(gameRecordSQL, [game_id, date_now, 3, 0, creditNn, creditCc, 3, req.session.user_id, date_now]);
			await connection.execute(ledgerCreditSQL, [
				txtAccountCode,
				game_id,
				10,
				3,
				creditTotal,
				creditGameRecordRemarks,
				req.session.user_id,
				date_now
			]);
		}

		if (cashTotal > 0 && cashRecordId) {
			const [agentResults] = await connection.execute(`
				SELECT agent.IDNo AS agent_id
				FROM agent
				JOIN account ON account.AGENT_ID = agent.IDNo
				WHERE account.ACTIVE = 1 AND account.IDNo = ?`,
				[txtAccountCode]
			);
			if (agentResults.length > 0 && agentResults[0].agent_id) {
				await connection.execute(`
					INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					[cashRecordId, agentResults[0].agent_id, cashTotal.toString(), 'Additional buy-in', 1, `Game - ${game_id}`, req.session.user_id, date_now]
				);
			}
		}

		await connection.commit();

		// Telegram after successful commit (DB already consistent)
		try {
			const [agentRows] = await pool.execute(`
				SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
				FROM account
				JOIN agent ON agent.IDNo = account.AGENT_ID
				WHERE account.ACTIVE = 1 AND account.IDNo = ?
				LIMIT 1`,
				[txtAccountCode]
			);
			if (Array.isArray(agentRows) && agentRows.length > 0) {
				const { AGENT_CODE: agentCode, NAME: agentName } = agentRows[0];
				const telegramId = getAgentTelegramChatId(agentRows[0]);
				const [buyinSplitGameTypeRows] = await pool.execute(
					'SELECT GAME_TYPE FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1',
					[game_id]
				);
				const buyinSplitGt = telegramGameTypeLabels(buyinSplitGameTypeRows[0]?.GAME_TYPE);
				const buyinSplitGameLineAgent = buyinSplitGt.agentText ? ` - ${buyinSplitGt.agentText}` : '';
				const buyinSplitGameLineMgmt = buyinSplitGt.managementText ? ` - ${buyinSplitGt.managementText}` : '';
				const date_nowTG = new Date().toLocaleDateString();
				const updated_time = new Date().toLocaleTimeString();
				const splitLinesKo = [];
				if (cashTotal > 0) splitLinesKo.push(`현금: ${cashTotal.toLocaleString('en-US')}`);
				if (depositTotal > 0) splitLinesKo.push(`계좌출금: ${depositTotal.toLocaleString('en-US')}`);
				if (creditTotal > 0) splitLinesKo.push(`크레딧: ${creditTotal.toLocaleString('en-US')}`);
				const splitTextBlockKo = splitLinesKo.join('\n');
				const splitLinesMgmt = [];
				if (cashTotal > 0) splitLinesMgmt.push(`현금 Cash: ${cashTotal.toLocaleString('en-US')}`);
				if (depositTotal > 0) splitLinesMgmt.push(`계좌출금 Deposit: ${depositTotal.toLocaleString('en-US')}`);
				if (creditTotal > 0) splitLinesMgmt.push(`크레딧 Credit: ${creditTotal.toLocaleString('en-US')}`);
				const splitTextBlockMgmt = splitLinesMgmt.join('\n');
				const priorBuyinTotal = parseFloat((txtTotalAmountBuyin || '0').toString().replace(/,/g, '')) || 0;
				const totalBuyin = priorBuyinTotal + grandTotal;
				const newTotalBalance = totalBalance - depositTotal;
				const cutoffTelegram = await resolveCutoffTelegramGameContext(pool, game_id);
				const telegramGameNo = cutoffTelegram.telegramGameNo;
				const text = `Demo Cage\n\n* 추가 바이인 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${telegramGameNo}${buyinSplitGameLineAgent}\n${splitTextBlockKo}\n바이인 합계: ${totalBuyin.toLocaleString('en-US')}${depositTotal > 0 ? `\n잔고: ${newTotalBalance.toLocaleString('en-US')}` : ''}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				const managementText = `Demo Cage\n\n* 추가 바이인 Add Buy-in *${cutoffTelegram.cutoffTitle.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}\n게임 Game #: ${cutoffTelegram.managementGameNo}${buyinSplitGameLineMgmt}\n${splitTextBlockMgmt}\n바이인 합계 Total Buy-in : ${totalBuyin.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;

				const addBuyinSplitLogLabel = cutoffTelegram.isCutoffContinuation ? 'Add Buy-in (Cut Off)' : 'Add Buy-in';
				const addBuyinSplitOpts = gamebookTelegramOpts(addBuyinSplitLogLabel, agentCode, agentName, grandTotal, telegramGameNo);
				if (telegramId) {
					try {
						await sendTelegramMessage(text, telegramId, addBuyinSplitOpts);
					} catch (telegramError) {
						console.error('Failed to send Telegram message to agent:', telegramError.message);
					}
				} else {
					console.error('No TELEGRAM_ID found for Account Code:', txtAccountCode);
				}
				try {
					await sendToAgentNotifications(agentCode, text, addBuyinSplitOpts);
				} catch (telegramError) {
					console.error('Failed to send to agent notifications:', telegramError.message);
				}
				try {
					await sendTelegramToAdditionalChats(text, addBuyinSplitOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to additional chats:', telegramError.message);
				}
				try {
					await sendTelegramToManagement(managementText, addBuyinSplitOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to management:', telegramError.message);
				}
			}
		} catch (tgErr) {
			console.error('Telegram block after buyin_split:', tgErr);
		}

		return res.redirect('/game_list');
	} catch (err) {
		try {
			await connection.rollback();
		} catch (rbErr) {
			console.error('buyin_split rollback:', rbErr);
		}
		console.error('Error in /game_list/add/buyin_split (rolled back):', err);
		return res.status(500).json({ error: 'Failed to add split buy-in.' });
	} finally {
		connection.release();
	}
});


// ADD GAME RECORD CASH OUT
router.post('/game_list/add/cashout', async (req, res) => {
	const {
		game_id,
		txtAccountCode,
		txtTransType,
		txtNN,
		txtCC,
		txttotal_balance_cashout
	} = req.body;

	// Block add when game is settled
	const [settledRows] = await pool.execute('SELECT SETTLED FROM game_list WHERE IDNo = ? AND ACTIVE != 0', [game_id]);
	if (settledRows.length > 0 && settledRows[0].SETTLED === 1) {
		return res.status(403).json({ error: 'Cannot add records to a settled game.' });
	}

	let date_now = new Date();

	// Ensure at least one of txtNN or txtCC is provided and not empty
	if ((!txtNN || txtNN.trim() === '') && (!txtCC || txtCC.trim() === '')) {
		return res.status(400).send('At least one of NN Chips or CC Chips amounts is required.');
	}

	// Ensure txtTransType is provided and not empty
	if (!txtTransType || txtTransType.trim() === '') {
		return res.status(400).send('Transaction Type is required.');
	}

	// Remove commas and convert txtNN and txtCC to numerical values
	let txtNNamount = txtNN && txtNN.trim() !== '' ? txtNN.split(',').join("") : '0';
	let txtCCamount = txtCC && txtCC.trim() !== '' ? txtCC.split(',').join("") : '0';

	// Ensure that txtNNamount and txtCCamount are valid numbers
	if (isNaN(txtNNamount) || txtNNamount < 0) {
		return res.status(400).send('Invalid NN Chips amount.');
	}
	if (isNaN(txtCCamount) || txtCCamount < 0) {
		return res.status(400).send('Invalid CC Chips amount.');
	}

	// Convert to float values
	txtNNamount = parseFloat(txtNNamount);
	txtCCamount = parseFloat(txtCCamount);

	// Calculate chips returned and current balance after cash out
	let chipsReturn = txtNNamount + txtCCamount;
	let sanitizedBalanceCashout = (txttotal_balance_cashout || '0').replace(/,/g, '');
	let currentBalanceCashout = isNaN(sanitizedBalanceCashout) ? 0 : parseFloat(sanitizedBalanceCashout) + chipsReturn;

	let CashOutDESC = 'Chips Returned'; // TRANSACTION DETAILS

	const agentQuery = `
		SELECT agent.IDNo AS agent_id, agent.AGENT_CODE, agent.NAME
		FROM agent
		JOIN account ON account.AGENT_ID = agent.IDNo
		WHERE account.ACTIVE = 1 AND account.IDNo = ?
	`;

	const connection = await pool.getConnection();
	let gameRecordId;
	let agentResults = [];

	try {
		await connection.beginTransaction();

		const query1 = `INSERT INTO game_record(GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		const [result1] = await connection.execute(query1, [game_id, date_now, 2, 0, txtNNamount, txtCCamount, txtTransType, req.session.user_id, date_now]);
		gameRecordId = result1.insertId;

		const query2 = `INSERT INTO account_ledger(ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
		await connection.execute(query2, [txtAccountCode, game_id, 1, txtTransType, CashOutDESC, txtNNamount + txtCCamount, req.session.user_id, date_now]);

		if (isTipEnabled(req.body)) {
			const tipAmounts = parseTipSplitAmounts(req.body);
			await saveCashoutTips(connection, {
				gameId: game_id,
				accountId: txtAccountCode,
				cashoutId: gameRecordId,
				rollerAmount: tipAmounts.roller,
				dealerAmount: tipAmounts.dealer,
				rollerName: (req.body.txtTipRollerName || '').toString().trim(),
				tipStatus: (req.body.txtTipStatus || '').toString().trim(),
				userId: req.session.user_id,
				dateNow: date_now
			});
		}

		const [agentRows] = await connection.execute(agentQuery, [txtAccountCode]);
		agentResults = agentRows || [];

		if (txtTransType == 1 && agentResults.length > 0 && agentResults[0].agent_id) {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;
			await connection.execute(cashTransactionQuery, [
				gameRecordId,
				agentResults[0].agent_id,
				chipsReturn.toString(),
				'Game Cash-out',
				2,
				`Game - ${game_id}`,
				req.session.user_id,
				date_now
			]);
		}

		await connection.commit();
	} catch (err) {
		try {
			await connection.rollback();
		} catch (rbErr) {
			console.error('cashout rollback:', rbErr);
		}
		console.error('Error in /game_list/add/cashout:', err);
		const msg = err && err.message ? err.message : 'Internal Server Error';
		return res.status(500).send(msg);
	} finally {
		connection.release();
	}

	try {

		if (agentResults.length > 0) {
			const { agent_id: agentId, AGENT_CODE: agentCode, NAME: agentName } = agentResults[0];

			const telegramIdQuery = `
				SELECT agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED 
				FROM agent
				JOIN account ON account.AGENT_ID = agent.IDNo
				WHERE account.ACTIVE = 1 AND account.IDNo = ?
			`;
			const [telegramIdResults] = await pool.execute(telegramIdQuery, [txtAccountCode]);

			const [cashoutGameTypeRows] = await pool.execute(
				'SELECT GAME_TYPE FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1',
				[game_id]
			);
			const cashoutGt = telegramGameTypeLabels(cashoutGameTypeRows[0]?.GAME_TYPE);
			const cashoutGameLineAgent = cashoutGt.agentText ? ` - ${cashoutGt.agentText}` : '';
			const cashoutGameLineMgmt = cashoutGt.managementText ? ` - ${cashoutGt.managementText}` : '';
			const cutoffTelegram = await resolveCutoffTelegramGameContext(pool, game_id);
			const telegramGameNo = cutoffTelegram.telegramGameNo;

			const time_now = new Date();
			const updated_time = time_now.toLocaleTimeString();
			const date_nowTG = new Date().toLocaleDateString();

			let text = '';
			let managementText = '';
			if (txtTransType == 2) {
				text = `Demo Cage\n\n* 캐시아웃 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${telegramGameNo}${cashoutGameLineAgent}\n캐시아웃: ${chipsReturn.toLocaleString('en-US')} - 계좌입금\n잔고: ${currentBalanceCashout.toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				managementText = `Demo Cage\n\n* 캐시아웃 Cash-out *${cutoffTelegram.cutoffTitle.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}\n게임 Game #: ${cutoffTelegram.managementGameNo}${cashoutGameLineMgmt}\n캐시아웃 Cash-out : ${chipsReturn.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
			} else if (txtTransType == 1) {
				text = `Demo Cage\n\n* 캐시아웃 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${telegramGameNo}${cashoutGameLineAgent}\n캐시아웃: ${chipsReturn.toLocaleString('en-US')} - 현금\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				managementText = `Demo Cage\n\n* 캐시아웃 Cash-out *${cutoffTelegram.cutoffTitle.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}\n게임 Game #: ${cutoffTelegram.managementGameNo}${cashoutGameLineMgmt}\n캐시아웃 Cash-out : ${chipsReturn.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
			} else if (txtTransType == 4) {
				text = `Demo Cage\n\n* 캐시아웃 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${telegramGameNo}${cashoutGameLineAgent}\n캐시아웃: ${chipsReturn.toLocaleString('en-US')} - 크레딧\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
				managementText = `Demo Cage\n\n* 캐시아웃 Cash-out *${cutoffTelegram.cutoffTitle.mgmtTitleLine}\n\n계정 Account : ${agentCode} - ${agentName}\n게임 Game #: ${cutoffTelegram.managementGameNo}${cashoutGameLineMgmt}\n캐시아웃 Cash-out : ${chipsReturn.toLocaleString('en-US')}\n\n날짜 Date : ${date_nowTG}\n시간 Time : ${updated_time}`;
			}

			if (text !== '' && agentResults.length > 0) {
				const telegramId =
				telegramIdResults.length > 0 ? getAgentTelegramChatId(telegramIdResults[0]) : null;
				const cashoutLogLabel = cutoffTelegram.isCutoffContinuation ? 'Cash-out (Cut Off)' : 'Cash-out';
				const cashoutOpts = gamebookTelegramOpts(cashoutLogLabel, agentCode, agentName, chipsReturn, telegramGameNo);
				if (telegramId) {
					try {
						await sendTelegramMessage(text, telegramId, cashoutOpts);
					} catch (telegramError) {
						console.error('Failed to send Telegram message to agent:', telegramError.message);
					}
				} else {
					console.error("No TELEGRAM_ID found for Account Code:", txtAccountCode);
				}
				try {
					await sendToAgentNotifications(agentCode, text, cashoutOpts);
				} catch (telegramError) {
					console.error('Failed to send to agent notifications:', telegramError.message);
				}
				try {
					await sendTelegramToAdditionalChats(text, cashoutOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to additional chats:', telegramError.message);
				}
				try {
					await sendTelegramToManagement(managementText, cashoutOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to management:', telegramError.message);
				}
			}
		}

		res.redirect('/game_list');
	} catch (err) {
		console.error('Error in /game_list/add/cashout (post-commit):', err);
		res.status(500).send('Internal Server Error');
	}
});

// Split cash-out (Cash + Deposit + Credit legs) in a single DB transaction — all-or-nothing
router.post('/game_list/add/cashout_split', async (req, res) => {
	const {
		game_id,
		txtAccountCode,
		txttotal_balance_cashout,
		txtMarkerChipsReturn
	} = req.body;

	const parseAmt = (v) => {
		const s = (v === undefined || v === null ? '' : v).toString().replace(/,/g, '').trim();
		if (s === '') return 0;
		const n = parseFloat(s);
		return Number.isFinite(n) ? n : NaN;
	};

	let cashNn = parseAmt(req.body.split_cash_nn);
	let cashCc = parseAmt(req.body.split_cash_cc);
	let depNn = parseAmt(req.body.split_dep_nn);
	let depCc = parseAmt(req.body.split_dep_cc);
	let creditNn = parseAmt(req.body.split_credit_nn);
	let creditCc = parseAmt(req.body.split_credit_cc);
	const tipRollerNn = parseAmt(req.body.txtTipRollerNn);
	const tipRollerCc = parseAmt(req.body.txtTipRollerCc);
	const tipDealerNn = parseAmt(req.body.txtTipDealerNn);
	const tipDealerCc = parseAmt(req.body.txtTipDealerCc);
	const depositRemarks = (req.body.txtDepositRemarks || '').toString().trim();
	const creditRemarks = (req.body.txtCreditRemarks || '').toString().trim();
	const creditGuarantor = (req.body.txtCreditGuarantor || '').toString().trim();
	const tipRollerName = (req.body.txtTipRollerName || '').toString().trim();
	const tipStatus = (req.body.txtTipStatus || '').toString().trim();
	const buildCreditLedgerRemarks = function () {
		const parts = [];
		if (creditRemarks) parts.push(creditRemarks);
		if (creditGuarantor) parts.push('Guarantor: ' + creditGuarantor);
		return parts.length ? parts.join(' | ') : null;
	};

	const markerBalance = parseFloat((txtMarkerChipsReturn || '0').replace(/,/g, '')) || 0;
	const sanitizedBalanceCashout = (txttotal_balance_cashout || '0').replace(/,/g, '');

	const [settledRows] = await pool.execute('SELECT SETTLED FROM game_list WHERE IDNo = ? AND ACTIVE != 0', [game_id]);
	if (settledRows.length > 0 && settledRows[0].SETTLED === 1) {
		return res.status(403).json({ error: 'Cannot add records to a settled game.' });
	}

	if ([cashNn, cashCc, depNn, depCc, creditNn, creditCc, tipRollerNn, tipRollerCc, tipDealerNn, tipDealerCc]
		.some((n) => !Number.isFinite(n) || n < 0)) {
		return res.status(400).json({ error: 'Invalid amounts.' });
	}
	if (cashNn > 0 && cashNn % 1000 !== 0) {
		return res.status(400).json({ error: 'NN Cash must be in thousands.' });
	}
	if (depNn > 0 && depNn % 1000 !== 0) {
		return res.status(400).json({ error: 'NN Deposit must be in thousands.' });
	}
	if (creditNn > 0 && creditNn % 1000 !== 0) {
		return res.status(400).json({ error: 'NN Credit must be in thousands.' });
	}
	if (tipRollerNn > 0 && tipRollerNn % 1000 !== 0) {
		return res.status(400).json({ error: 'Tip Roller NN must be in thousands.' });
	}
	if (tipDealerNn > 0 && tipDealerNn % 1000 !== 0) {
		return res.status(400).json({ error: 'Tip Dealer NN must be in thousands.' });
	}

	const cashLeg = cashNn + cashCc;
	const depLeg = depNn + depCc;
	const creditLeg = creditNn + creditCc;
	const splitGrandTotal = cashLeg + depLeg + creditLeg;
	const tipRollerLeg = tipRollerNn + tipRollerCc;
	const tipDealerLeg = tipDealerNn + tipDealerCc;
	const tipGrandTotal = tipRollerLeg + tipDealerLeg;

	if ((tipRollerLeg > 0 || tipDealerLeg > 0) && !tipRollerName) {
		return res.status(400).json({ error: 'Enter the roller name.' });
	}
	if ((tipRollerLeg > 0 || tipDealerLeg > 0) && !tipStatus) {
		return res.status(400).json({ error: 'Enter the tip status (Roller or GM).' });
	}

	if (splitGrandTotal <= 0 && tipGrandTotal <= 0) {
		return res.status(400).json({ error: 'Enter a cash-out amount and/or a tip amount.' });
	}
	if (splitGrandTotal > 0 && creditLeg > 0 && (creditNn > markerBalance || creditCc > markerBalance || creditLeg > markerBalance)) {
		return res.status(400).json({ error: 'Credit return exceeds Credit Balance.' });
	}
	const guarantorErr = creditGuarantorRequiredError(creditLeg, creditGuarantor);
	if (guarantorErr) return res.status(400).json({ error: guarantorErr });

	const depositLegTotal = depNn + depCc;
	const currentBalanceAfterSplit =
		(parseFloat(sanitizedBalanceCashout) || 0) + depositLegTotal;

	const date_now = new Date();
	const CashOutDESC = 'Chips Returned';
	const userId = req.session.user_id;

	const query1 = `INSERT INTO game_record(GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
	const query2 = `INSERT INTO account_ledger(ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
	const query2Deposit = `INSERT INTO account_ledger(ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
	const query2Credit = `INSERT INTO account_ledger(ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

	const connection = await pool.getConnection();
	let gameRecordIdCash = null;
	try {
		await connection.beginTransaction();

		if (cashLeg > 0) {
			const [r1] = await connection.execute(query1, [
				game_id,
				date_now,
				2,
				0,
				cashNn,
				cashCc,
				1,
				userId,
				date_now
			]);
			gameRecordIdCash = r1.insertId;
			await connection.execute(query2, [
				txtAccountCode,
				game_id,
				1,
				1,
				CashOutDESC,
				cashLeg,
				userId,
				date_now
			]);
		}

		if (depLeg > 0) {
			const [r2] = await connection.execute(query1, [
				game_id,
				date_now,
				2,
				0,
				depNn,
				depCc,
				2,
				userId,
				date_now
			]);
			if (!gameRecordIdCash) {
				gameRecordIdCash = r2.insertId;
			}
			await connection.execute(query2Deposit, [
				txtAccountCode,
				game_id,
				1,
				2,
				CashOutDESC,
				depLeg,
				depositRemarks || null,
				userId,
				date_now
			]);
		}

		if (creditLeg > 0) {
			const [r3] = await connection.execute(query1, [
				game_id,
				date_now,
				2,
				0,
				creditNn,
				creditCc,
				4,
				userId,
				date_now
			]);
			if (!gameRecordIdCash) {
				gameRecordIdCash = r3.insertId;
			}
			await connection.execute(query2Credit, [
				txtAccountCode,
				game_id,
				1,
				4,
				CashOutDESC,
				creditLeg,
				buildCreditLedgerRemarks(),
				userId,
				date_now
			]);
		}

		const agentQuery = `
			SELECT agent.IDNo AS agent_id, agent.AGENT_CODE, agent.NAME
			FROM agent
			JOIN account ON account.AGENT_ID = agent.IDNo
			WHERE account.ACTIVE = 1 AND account.IDNo = ?
		`;
		const [agentResults] = await connection.execute(agentQuery, [txtAccountCode]);

		if (cashLeg > 0 && agentResults.length > 0 && agentResults[0].agent_id) {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;
			await connection.execute(cashTransactionQuery, [
				gameRecordIdCash,
				agentResults[0].agent_id,
				String(cashLeg),
				'Game Cash-out',
				2,
				`Game - ${game_id}`,
				userId,
				date_now
			]);
		}

		const cashTransactionQuery = `
			INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`;

		if (tipRollerLeg > 0) {
			const [tipRollerRecord] = await connection.execute(query1, [
				game_id,
				date_now,
				2,
				0,
				tipRollerNn,
				tipRollerCc,
				CASHOUT_TRANSACTION.TIP_ROLLER,
				userId,
				date_now
			]);
			await saveCashoutTips(connection, {
				gameId: game_id,
				accountId: txtAccountCode,
				cashoutId: tipRollerRecord.insertId,
				rollerAmount: tipRollerLeg,
				dealerAmount: 0,
				rollerName: tipRollerName,
				tipStatus,
				userId,
				dateNow: date_now
			});
		}

		if (tipDealerLeg > 0) {
			const [tipDealerRecord] = await connection.execute(query1, [
				game_id,
				date_now,
				2,
				0,
				tipDealerNn,
				tipDealerCc,
				CASHOUT_TRANSACTION.TIP_DEALER,
				userId,
				date_now
			]);
			await saveCashoutTips(connection, {
				gameId: game_id,
				accountId: txtAccountCode,
				cashoutId: tipDealerRecord.insertId,
				rollerAmount: 0,
				dealerAmount: tipDealerLeg,
				rollerName: tipRollerName,
				tipStatus,
				userId,
				dateNow: date_now
			});
		}

		await connection.commit();
	} catch (err) {
		try {
			await connection.rollback();
		} catch (rbErr) {
			console.error('cashout_split rollback:', rbErr);
		}
		console.error('Error in /game_list/add/cashout_split (rolled back):', err);
		return res.status(500).json({ error: 'Cash-out failed. No changes were saved.' });
	} finally {
		connection.release();
	}

	// Telegram after successful commit (DB already consistent)
	try {
		const agentQuery = `
			SELECT agent.IDNo AS agent_id, agent.AGENT_CODE, agent.NAME
			FROM agent
			JOIN account ON account.AGENT_ID = agent.IDNo
			WHERE account.ACTIVE = 1 AND account.IDNo = ?
		`;
		const [agentResults] = await pool.execute(agentQuery, [txtAccountCode]);
		if (agentResults.length > 0) {
			const { AGENT_CODE: agentCode, NAME: agentName } = agentResults[0];
			const telegramIdQuery = `
				SELECT agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED 
				FROM agent
				JOIN account ON account.AGENT_ID = agent.IDNo
				WHERE account.ACTIVE = 1 AND account.IDNo = ?
			`;
			const [telegramIdResults] = await pool.execute(telegramIdQuery, [txtAccountCode]);

			const [cashoutSplitGameTypeRows] = await pool.execute(
				'SELECT GAME_TYPE FROM game_list WHERE IDNo = ? AND ACTIVE != 0 LIMIT 1',
				[game_id]
			);
			const cashoutSplitGt = telegramGameTypeLabels(cashoutSplitGameTypeRows[0]?.GAME_TYPE);
			const cashoutSplitGameLineAgent = cashoutSplitGt.agentText ? ` - ${cashoutSplitGt.agentText}` : '';
			const cashoutSplitGameLineMgmt = cashoutSplitGt.managementText ? ` - ${cashoutSplitGt.managementText}` : '';

			const time_now = new Date();
			const updated_time = time_now.toLocaleTimeString();
			const date_nowTG = new Date().toLocaleDateString();

			const cashTotal = cashNn + cashCc;
			const depTotal = depNn + depCc;
			const creditTotal = creditNn + creditCc;
			const combinedGrandTotal = splitGrandTotal + tipGrandTotal;
			const cutoffTelegram = await resolveCutoffTelegramGameContext(pool, game_id);
			const telegramGameNo = cutoffTelegram.telegramGameNo;
			const creditLineKo = creditTotal > 0 ? `\n크레딧: ${creditTotal.toLocaleString('en-US')}` : '';
			const creditLineMgmt = creditTotal > 0 ? `\n크레딧 Credit: ${creditTotal.toLocaleString('en-US')}` : '';
			const tipLineKo = tipGrandTotal > 0 ? `\n팁: ${tipGrandTotal.toLocaleString('en-US')}` : '';
			const tipLineMgmt = tipGrandTotal > 0 ? `\n팁 Tip: ${tipGrandTotal.toLocaleString('en-US')}` : '';
			const text = `Demo Cage\n\n* 캐시아웃 *\n\n계정: ${agentCode} - ${agentName}\n게임 #: ${telegramGameNo}${cashoutSplitGameLineAgent}\n\n현금: ${cashTotal.toLocaleString('en-US')}\n계좌입금: ${depTotal.toLocaleString('en-US')}${creditLineKo}${tipLineKo}\n총 캐시아웃: ${combinedGrandTotal.toLocaleString('en-US')}\n잔고: ${currentBalanceAfterSplit.toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
			const managementText = `Demo Cage\n\n* 캐시아웃 Cash-out *${cutoffTelegram.cutoffTitle.mgmtTitleLine}\n\n계정 Account: ${agentCode} - ${agentName}\n게임 Game #: ${cutoffTelegram.managementGameNo}${cashoutSplitGameLineMgmt}\n\n현금 Cash: ${cashTotal.toLocaleString('en-US')}\n계좌입금 Deposit: ${depTotal.toLocaleString('en-US')}${creditLineMgmt}${tipLineMgmt}\n총 캐시아웃 Total Cash-out: ${combinedGrandTotal.toLocaleString('en-US')}\n\n날짜 Date: ${date_nowTG}\n시간 Time: ${updated_time}`;

			const telegramId =
				telegramIdResults.length > 0 ? getAgentTelegramChatId(telegramIdResults[0]) : null;
			const cashoutSplitLogLabel = cutoffTelegram.isCutoffContinuation ? 'Cash-out (Cut Off)' : 'Cash-out';
			const cashoutSplitOpts = gamebookTelegramOpts(
				cashoutSplitLogLabel,
				agentCode,
				agentName,
				combinedGrandTotal,
				telegramGameNo
			);
			if (telegramId) {
				try {
					await sendTelegramMessage(text, telegramId, cashoutSplitOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to agent:', telegramError.message);
				}
			} else {
				console.error('No TELEGRAM_ID found for Account Code:', txtAccountCode);
			}
			try {
				await sendToAgentNotifications(agentCode, text, cashoutSplitOpts);
			} catch (telegramError) {
				console.error('Failed to send to agent notifications:', telegramError.message);
			}
			try {
				await sendTelegramToAdditionalChats(text, cashoutSplitOpts);
			} catch (telegramError) {
				console.error('Failed to send Telegram message to additional chats:', telegramError.message);
			}
			try {
				await sendTelegramToManagement(managementText, cashoutSplitOpts);
			} catch (telegramError) {
				console.error('Failed to send Telegram message to management:', telegramError.message);
			}
		}
	} catch (tgErr) {
		console.error('Telegram block after cashout_split:', tgErr);
	}

	res.redirect('/game_list');
});


// ADD GAME RECORD ROLLING
router.post('/game_list/add/rolling', async (req, res) => {
	const { game_id, txtNN, txtCC } = req.body;

	// Block add when game is settled
	const [settledRows] = await pool.execute('SELECT SETTLED FROM game_list WHERE IDNo = ? AND ACTIVE != 0', [game_id]);
	if (settledRows.length > 0 && settledRows[0].SETTLED === 1) {
		return res.status(403).json({ error: 'Cannot add records to a settled game.' });
	}

	let date_now = new Date();

	// Remove commas from NN and CC (default to 0 if not provided)
	let txtNNamount = (txtNN || '0').split(',').join("");
	let txtCCamount = (txtCC || '0').split(',').join("");
	const ccAmount = parseFloat(txtCCamount) || 0;

	if (ccAmount <= 0) {
		return res.status(400).json({ error: 'Please enter CC Chips.' });
	}

	try {
		const [gameRecords] = await pool.execute(SETTLEMENT_GAME_RECORD_TOTALS_SQL, [game_id]);
		const rollingValidation = validateRollingAgainstRollerChips(gameRecords, ccAmount);
		if (!rollingValidation.ok) {
			return res.status(400).json({ error: rollingValidation.error });
		}

		const nnBalance = await dashboardQueries.computeNnChipsBalance();
		const nnValidation = validateRollingAgainstNnBalance(ccAmount, nnBalance, 0);
		if (!nnValidation.ok) {
			return res.status(400).json({ error: nnValidation.error });
		}

		const query = `INSERT INTO game_record(GAME_ID, TRADING_DATE, CAGE_TYPE, NN_CHIPS, CC_CHIPS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
		await pool.execute(query, [game_id, date_now, 4, txtNNamount, txtCCamount, req.session.user_id, date_now]);
		return res.json({ success: true });
	} catch (err) {
		console.error('Error inserting details', err);
		return res.status(500).json({ error: 'Error inserting details' });
	}
});

router.get('/game_list/:game_id/rolling/last', async (req, res) => {
	const gameId = parseInt(req.params.game_id, 10);

	if (Number.isNaN(gameId)) {
		return res.status(400).json({ error: 'Invalid game id' });
	}

	try {
		const query = `
			SELECT IDNo, NN_CHIPS, CC_CHIPS
			FROM game_record
			WHERE GAME_ID = ? AND CAGE_TYPE = 4
			ORDER BY IDNo DESC
			LIMIT 1
		`;
		const [rows] = await pool.execute(query, [gameId]);

		if (rows.length === 0) {
			return res.json({ data: null });
		}

		return res.json({ data: rows[0] });
	} catch (error) {
		console.error('Error fetching last rolling entry:', error);
		return res.status(500).json({ error: 'Unable to fetch last rolling entry' });
	}
});

router.post('/game_list/rolling/:id/update', async (req, res) => {
	const recordId = parseInt(req.params.id, 10);
	const { txtNN, txtCC } = req.body;

	if (Number.isNaN(recordId)) {
		return res.status(400).json({ error: 'Invalid rolling record id' });
	}

	const nnAmount = parseFloat((txtNN || '0').toString().replace(/,/g, '')) || 0;
	const ccAmount = parseFloat((txtCC || '0').toString().replace(/,/g, '')) || 0;

	if (ccAmount <= 0) {
		return res.status(400).json({ error: 'Please enter CC Chips.' });
	}

	try {
		const [existingRows] = await pool.execute(
			'SELECT GAME_ID, CC_CHIPS FROM game_record WHERE IDNo = ? AND CAGE_TYPE = 4 AND ACTIVE != 0',
			[recordId]
		);
		if (existingRows.length === 0) {
			return res.status(404).json({ error: 'Rolling record not found' });
		}

		const gameId = existingRows[0].GAME_ID;
		const oldCcAmount = parseFloat(existingRows[0].CC_CHIPS) || 0;
		const [gameRecords] = await pool.execute(SETTLEMENT_GAME_RECORD_TOTALS_SQL, [gameId]);
		const rollingValidation = validateRollingAgainstRollerChips(gameRecords, ccAmount);
		if (!rollingValidation.ok) {
			return res.status(400).json({ error: rollingValidation.error });
		}

		const nnBalance = await dashboardQueries.computeNnChipsBalance();
		const nnValidation = validateRollingAgainstNnBalance(ccAmount, nnBalance, oldCcAmount);
		if (!nnValidation.ok) {
			return res.status(400).json({ error: nnValidation.error });
		}

		const query = `
			UPDATE game_record
			SET NN_CHIPS = ?, CC_CHIPS = ?
			WHERE IDNo = ? AND CAGE_TYPE = 4
		`;

		const [result] = await pool.execute(query, [nnAmount, ccAmount, recordId]);

		if (result.affectedRows === 0) {
			return res.status(404).json({ error: 'Rolling record not found' });
		}

		return res.json({ success: true });
	} catch (error) {
		console.error('Error updating rolling record:', error);
		return res.status(500).json({ error: 'Unable to update rolling entry' });
	}
});

// ADD GAME RECORD ROLLER CHIPS
router.post('/game_list/add/roller_chips', async (req, res) => {
	const { game_id, txtRollerNN, txtRollerCC, txtTransType } = req.body;

	// Block add when game is settled
	const [settledRows] = await pool.execute('SELECT SETTLED FROM game_list WHERE IDNo = ? AND ACTIVE != 0', [game_id]);
	if (settledRows.length > 0 && settledRows[0].SETTLED === 1) {
		return res.status(403).json({ error: 'Cannot add records to a settled game.' });
	}

	let date_now = new Date();

	// Remove commas from NN and CC (default to 0 if not provided)
	let txtNNamount = (txtRollerNN || '0').split(',').join("");
	let txtCCamount = (txtRollerCC || '0').split(',').join("");

	// Validate that at least one value is provided
	if (parseFloat(txtNNamount) === 0 && parseFloat(txtCCamount) === 0) {
		return res.status(400).json({ error: 'Please enter at least one value: NN Chips or CC Chips' });
	}

	// Validate transaction type
	if (!txtTransType || (txtTransType !== '1' && txtTransType !== '2')) {
		return res.status(400).json({ error: 'Please select a valid Transaction Type (ADD or RETURN)' });
	}

	const query = `INSERT INTO game_record(GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
	try {
		await pool.execute(query, [
			game_id, 
			date_now, 
			5, // CAGE_TYPE 5 for ROLLER CHIPS
			0, // AMOUNT is 0 for roller chips
			0, // NN_CHIPS is 0 (roller chips use ROLLER_NN_CHIPS)
			0, // CC_CHIPS is 0 (roller chips use ROLLER_CC_CHIPS)
			txtNNamount, // ROLLER_NN_CHIPS
			txtCCamount, // ROLLER_CC_CHIPS
			txtTransType, // ROLLER_TRANSACTION: 1 = ADD, 2 = RETURN
			req.session.user_id, 
			date_now
		]);
		res.redirect('/game_list');
	} catch (err) {
		console.error('Error inserting roller chips details', err);
		res.status(500).json({ error: 'Error inserting roller chips details' });
	}
});


// ADD GAME RECORD
router.post('/add_game_record', checkSession, async (req, res) => {
    const {
        game_id,
        txtTradingDate,
        txtCategory,
        txtAmount,
        txtRemarks
    } = req.body;

    let date_now = new Date();

    const query = `INSERT INTO game_record(GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    try {
        await pool.execute(query, [game_id, date_now, txtCategory, txtAmount, txtRemarks, req.session.user_id, date_now]);
        res.redirect('/game_record/' + game_id);
    } catch (err) {
        console.error('Error inserting details', err);
        res.status(500).send('Error inserting details');
    }
});

// ======================= GAME RECORD ==================

router.get("/game_record/:id", checkSession, async (req, res) => {
	try {
	  const pageId = parseInt(req.params.id);
	  const query = `
		SELECT *
		FROM game_list  
		JOIN account ON game_list.ACCOUNT_ID = account.IDNo
		JOIN agent ON agent.IDNo = account.AGENT_ID
		JOIN agency ON agency.IDNo = agent.AGENCY
		WHERE game_list.ACTIVE != 0 AND game_list.IDNo = ?`;
		
	  const [results] = await pool.execute(query, [pageId]);
	  
	  if (!results || results.length === 0) {
		return res.status(404).send("No record found");
	  }
	  
	  res.render('gamebook/game_record', {
		username: req.session.username,
		firstname: req.session.firstname,
		lastname: req.session.lastname,
		user_id: req.session.user_id,
		page_id: pageId,
		reference: results[0].GAME_NO,
		currentPage: 'game_record'
	  });
	  
	} catch (error) {
	  console.error('Error executing MySQL query: ' + error.stack);
	  res.status(500).send("Error during login");
	}
  });

// GET GAME RECORD
router.get('/game_record_data/:id', checkSession, async (req, res) => {
	const id = parseInt(req.params.id);
	const query = `SELECT *, game_list.IDNo AS game_list_id, game_record.IDNo AS game_record_id, game_record.ENCODED_DT AS record_date, game_list.ACTIVE AS game_status, account.IDNo AS account_no, agent.AGENT_CODE AS agent_code, agent.NAME AS agent_name, COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS guest_name, game_record.ROLLER_NN_CHIPS, game_record.ROLLER_CC_CHIPS, game_record.ROLLER_TRANSACTION, game_list.FAKE_SETTLE AS FAKE_SETTLE
					FROM game_list 
					JOIN account ON game_list.ACCOUNT_ID = account.IDNo 
					JOIN agent ON agent.IDNo = account.AGENT_ID 
					JOIN agency ON agency.IDNo = agent.AGENCY 
					LEFT JOIN guest g ON g.IDNo = game_list.GUEST_ID
					JOIN game_record ON game_record.GAME_ID = game_list.IDNo 
					WHERE game_record.ACTIVE != 0 AND game_list.ACTIVE != 0 AND  game_record.GAME_ID = ?
					ORDER BY game_list.IDNo ASC`;
	try {
		const [result] = await pool.execute(query, [id]);
		res.json(result);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});

// GET single game_record for edit (Super Admin only)
router.get('/game_record/single/:id', checkSession, async (req, res) => {
	const permissions = req.session?.permissions;
	if (permissions !== 0) {
		return res.status(403).json({ error: 'Only Super Admin can edit game records.' });
	}
	const id = parseInt(req.params.id);
	if (!id || isNaN(id)) {
		return res.status(400).json({ error: 'Invalid record ID' });
	}
	try {
		const [rows] = await pool.execute(
			`SELECT IDNo, GAME_ID, CAGE_TYPE, NN_CHIPS, CC_CHIPS, AMOUNT, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, TRANSACTION FROM game_record WHERE IDNo = ? AND ACTIVE = 1`,
			[id]
		);
		if (rows.length === 0) return res.status(404).json({ error: 'Record not found' });
		return res.json(rows[0]);
	} catch (err) {
		console.error('Error fetching game record:', err);
		return res.status(500).json({ error: 'Error fetching record' });
	}
});

// EDIT GAME RECORD (Super Admin only)
router.put('/game_record/edit/:id', checkSession, async (req, res) => {
	const permissions = req.session?.permissions;
	if (permissions !== 0) {
		return res.status(403).json({ error: 'Only Super Admin can edit game records.' });
	}

	const id = parseInt(req.params.id);
	const { nn_chips, cc_chips, amount, roller_nn_chips, roller_cc_chips } = req.body;
	const date_now = new Date();

	if (!id || isNaN(id)) {
		return res.status(400).json({ error: 'Invalid record ID' });
	}

	try {
		const [recordRows] = await pool.execute(
			`SELECT GAME_ID, CAGE_TYPE, NN_CHIPS, CC_CHIPS, AMOUNT, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, TRANSACTION, ENCODED_DT FROM game_record WHERE IDNo = ? AND ACTIVE = 1`,
			[id]
		);
		if (recordRows.length === 0) {
			return res.status(404).json({ error: 'Record not found' });
		}
		const record = recordRows[0];
		const cageType = record.CAGE_TYPE;
		const gameId = record.GAME_ID;
		const oldNn = parseFloat(record.NN_CHIPS) || 0;
		const oldCc = parseFloat(record.CC_CHIPS) || 0;
		const oldAmount = parseFloat(record.AMOUNT) || 0;
		const oldTotal = oldNn + oldCc;
		const encodedDt = record.ENCODED_DT;
		const transaction = record.TRANSACTION;

		// CAGE_TYPE 1 (Buy-in) or 2 (Cash Out): nn_chips, cc_chips
		// CAGE_TYPE 3, 4: nn_chips, cc_chips, amount
		// CAGE_TYPE 5: roller_nn_chips, roller_cc_chips
		let newNn = oldNn, newCc = oldCc, newAmount = oldAmount, newRollerNn = record.ROLLER_NN_CHIPS || 0, newRollerCc = record.ROLLER_CC_CHIPS || 0;

		if (cageType === 1 || cageType === 2) {
			if (nn_chips !== undefined) newNn = parseFloat(nn_chips) || 0;
			if (cc_chips !== undefined) newCc = parseFloat(cc_chips) || 0;
		} else if (cageType === 3 || cageType === 4) {
			if (nn_chips !== undefined) newNn = parseFloat(nn_chips) || 0;
			if (cc_chips !== undefined) newCc = parseFloat(cc_chips) || 0;
			if (amount !== undefined) newAmount = parseFloat(amount) || 0;
		} else if (cageType === 5) {
			if (roller_nn_chips !== undefined) newRollerNn = parseFloat(roller_nn_chips) || 0;
			if (roller_cc_chips !== undefined) newRollerCc = parseFloat(roller_cc_chips) || 0;
		}

		const newTotal = newNn + newCc;

		// 1. Update game_record
		if (cageType === 1 || cageType === 2) {
			await pool.execute(
				`UPDATE game_record SET NN_CHIPS = ?, CC_CHIPS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
				[newNn, newCc, req.session.user_id, date_now, id]
			);
			// For CAGE_TYPE 1: also update paired CAGE_TYPE 3 (same GAME_ID, NN_CHIPS, CC_CHIPS, ENCODED_DT)
			if (cageType === 1) {
				await pool.execute(
					`UPDATE game_record SET NN_CHIPS = ?, CC_CHIPS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE GAME_ID = ? AND CAGE_TYPE = 3 AND NN_CHIPS = ? AND CC_CHIPS = ? AND ENCODED_DT = ? AND ACTIVE = 1`,
					[newNn, newCc, req.session.user_id, date_now, gameId, oldNn, oldCc, encodedDt]
				);
			}
		} else if (cageType === 3 || cageType === 4) {
			await pool.execute(
				`UPDATE game_record SET NN_CHIPS = ?, CC_CHIPS = ?, AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
				[newNn, newCc, newAmount, req.session.user_id, date_now, id]
			);
		} else if (cageType === 5) {
			await pool.execute(
				`UPDATE game_record SET ROLLER_NN_CHIPS = ?, ROLLER_CC_CHIPS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
				[newRollerNn, newRollerCc, req.session.user_id, date_now, id]
			);
		}

		// 2. Update account_ledger and cash_transaction for CAGE_TYPE 1 (Buy-in)
		if (cageType === 1 && oldTotal !== newTotal) {
			const [gameListRows] = await pool.execute(`SELECT ACCOUNT_ID FROM game_list WHERE IDNo = ? LIMIT 1`, [gameId]);
			if (gameListRows.length > 0) {
				const accountId = gameListRows[0].ACCOUNT_ID;
				if (transaction == 1) {
					// Cash: update cash_transaction (TRANSACTION_ID = game_id for buy-in) - LIMIT 1 to avoid updating multiple rows
					await pool.execute(
						`UPDATE cash_transaction SET AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1 AND (CATEGORY = 'Game buy-in' OR CATEGORY = 'Additional buy-in') AND TYPE = 1 AND AMOUNT = ? ORDER BY IDNo DESC LIMIT 1`,
						[newTotal, req.session.user_id, date_now, gameId, oldTotal]
					);
				}
				if (transaction == 2) {
					// Deposit: update account_ledger
					const [initRows] = await pool.execute(
						`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC = 'INITIAL BUY-IN' AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
						[accountId, gameId, oldTotal, encodedDt]
					);
					if (initRows.length > 0) {
						await pool.execute(`UPDATE account_ledger SET AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`, [newTotal, req.session.user_id, date_now, initRows[0].IDNo]);
					} else {
						const [addRows] = await pool.execute(
							`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC = 'ADDITIONAL BUY-IN' AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
							[accountId, gameId, oldTotal, encodedDt]
						);
						if (addRows.length > 0) {
							await pool.execute(`UPDATE account_ledger SET AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`, [newTotal, req.session.user_id, date_now, addRows[0].IDNo]);
						}
					}
				}
				if (transaction == 3) {
					// Marker: update account_ledger
					const [iouRows] = await pool.execute(
						`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 10 AND TRANSACTION_TYPE = 3 AND (TRANSACTION_DESC IS NULL OR TRANSACTION_DESC = '') AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
						[accountId, gameId, oldTotal, encodedDt]
					);
					if (iouRows.length > 0) {
						await pool.execute(`UPDATE account_ledger SET AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`, [newTotal, req.session.user_id, date_now, iouRows[0].IDNo]);
					} else {
						const [iouRows2] = await pool.execute(
							`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 10 AND TRANSACTION_TYPE = 3 AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
							[accountId, gameId, oldTotal, encodedDt]
						);
						if (iouRows2.length > 0) {
							await pool.execute(`UPDATE account_ledger SET AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`, [newTotal, req.session.user_id, date_now, iouRows2[0].IDNo]);
						}
					}
				}
			}
		}

		// 3. Update account_ledger and cash_transaction for CAGE_TYPE 2 (Cash Out)
		if (cageType === 2 && oldTotal !== newTotal) {
			const [gameListRows] = await pool.execute(`SELECT ACCOUNT_ID FROM game_list WHERE IDNo = ? LIMIT 1`, [gameId]);
			if (gameListRows.length > 0) {
				const accountId = gameListRows[0].ACCOUNT_ID;
				const [ledgerRows] = await pool.execute(
					`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 1 AND TRANSACTION_TYPE = ? AND TRANSACTION_DESC = 'Chips Returned' AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
					[accountId, gameId, transaction, oldTotal, encodedDt]
				);
				if (ledgerRows.length > 0) {
					await pool.execute(`UPDATE account_ledger SET AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`, [newTotal, req.session.user_id, date_now, ledgerRows[0].IDNo]);
				}
			}
			// cash_transaction: TRANSACTION_ID = game_record.IDNo for cash out
			await pool.execute(
				`UPDATE cash_transaction SET AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1`,
				[newTotal, req.session.user_id, date_now, id]
			);
		}

		return res.json({ success: true, message: 'Game record updated successfully' });
	} catch (err) {
		console.error('Error editing game record:', err);
		return res.status(500).json({ error: 'Error updating game record' });
	}
});

// DELETE GAME RECORD
router.put('/game_record/remove/:id', checkSession, async (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

		// First update the record based on IDNo
		const query = `UPDATE game_record SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	try {
		await pool.execute(query, [0, req.session.user_id, date_now, id]);

		// Now, fetch the details of the record for further query
		const recordQuery = `SELECT GAME_ID, CAGE_TYPE, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, TRANSACTION, ENCODED_DT FROM game_record WHERE IDNo = ?`;
		const [recordResult] = await pool.execute(recordQuery, [id]);

		// Ensure the result exists
		if (recordResult.length === 0) {
			return res.status(404).send('Record not found for additional deletion');
		}

		const record = recordResult[0];
		const nnChips = record.NN_CHIPS;
		const encodedDt = record.ENCODED_DT;
		const cageType = record.CAGE_TYPE;
		const gameId = record.GAME_ID;
		const transaction = record.TRANSACTION;
		const ccChips = record.CC_CHIPS || 0;

		// If CAGE_TYPE = 2 (Cash Out), delete corresponding account_ledger and cash_transaction entries
		if (cageType === 2) {
			// Get ACCOUNT_ID from game_list
			const gameListQuery = `SELECT ACCOUNT_ID FROM game_list WHERE IDNo = ? LIMIT 1`;
			const [gameListResult] = await pool.execute(gameListQuery, [gameId]);
			
			if (gameListResult.length > 0) {
				const accountId = gameListResult[0].ACCOUNT_ID;
				const totalAmount = parseFloat(nnChips) + parseFloat(ccChips);
				
				// Soft delete account_ledger (new: GAME_ID = gameId, old: GAME_ID IS NULL)
				const [ledgerRows] = await pool.execute(
					`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 1 AND TRANSACTION_TYPE = ? AND TRANSACTION_DESC = 'Chips Returned' AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
					[accountId, gameId, transaction, totalAmount, encodedDt]
				);
				if (ledgerRows.length > 0) {
					await pool.execute(
						'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
						[req.session.user_id, date_now, ledgerRows[0].IDNo]
					);
				}
			}

			// Soft delete from cash_transaction table
			// TRANSACTION_ID in cash_transaction refers to the game_record IDNo
			await pool.execute(
				'UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1',
				[req.session.user_id, new Date(), id]
			);

			await archiveTipsForCashout(pool, id, req.session.user_id, date_now);

			return res.send('Cash out record deleted successfully');
		}

		// If CAGE_TYPE = 1 or 3 (Buy-in), delete corresponding account_ledger and cash_transaction entries
		if (cageType === 1 || cageType === 3) {
			// Get ACCOUNT_ID from game_list
			const gameListQuery = `SELECT ACCOUNT_ID FROM game_list WHERE IDNo = ? LIMIT 1`;
			const [gameListResult] = await pool.execute(gameListQuery, [gameId]);
			
			if (gameListResult.length > 0) {
				const accountId = gameListResult[0].ACCOUNT_ID;
				const totalAmount = parseFloat(nnChips) + parseFloat(ccChips);
				
				// If TRANSACTION = 1 (Cash), delete from cash_transaction
				// Check for both "Game buy-in" (initial) and "Additional buy-in"
				// TRANSACTION_ID in cash_transaction = game_id (not game_record IDNo for buy-in)
				if (transaction == 1) {
					const softDeleteBy = req.session.user_id;
					const softDeleteDt = new Date();
					// Try to soft delete "Game buy-in" first (initial buy-in)
					const updateInitial = await pool.execute(
						`UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
						WHERE TRANSACTION_ID = ? AND ACTIVE = 1
						AND CATEGORY = 'Game buy-in' AND TYPE = 1 AND AMOUNT = ?`,
						[softDeleteBy, softDeleteDt, gameId, totalAmount]
					);
					// If no initial buy-in found, try "Additional buy-in"
					if (updateInitial[0].affectedRows === 0) {
						await pool.execute(
							`UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
							WHERE TRANSACTION_ID = ? AND ACTIVE = 1
							AND CATEGORY = 'Additional buy-in' AND TYPE = 1 AND AMOUNT = ?`,
							[softDeleteBy, softDeleteDt, gameId, totalAmount]
						);
					}
				}
				
				// If TRANSACTION = 2 (Deposit), soft delete account_ledger (new: GAME_ID, old: GAME_ID NULL)
				if (transaction == 2) {
					const softDeleteBy = req.session.user_id;
					const softDeleteDt = date_now;
					const [initRows] = await pool.execute(
						`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC = 'INITIAL BUY-IN' AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
						[accountId, gameId, totalAmount, encodedDt]
					);
					if (initRows.length > 0) {
						await pool.execute(
							'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
							[softDeleteBy, softDeleteDt, initRows[0].IDNo]
						);
					} else {
						const [addRows] = await pool.execute(
							`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC = 'ADDITIONAL BUY-IN' AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
							[accountId, gameId, totalAmount, encodedDt]
						);
						if (addRows.length > 0) {
							await pool.execute(
								'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
								[softDeleteBy, softDeleteDt, addRows[0].IDNo]
							);
						}
					}
				}
				
				// If TRANSACTION = 3 (IOU), soft delete account_ledger (new: GAME_ID, old: GAME_ID NULL)
				if (transaction == 3) {
					const softDeleteBy = req.session.user_id;
					const softDeleteDt = date_now;
					const [iouRows] = await pool.execute(
						`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 10 AND TRANSACTION_TYPE = 3 AND (TRANSACTION_DESC IS NULL OR TRANSACTION_DESC = '') AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
						[accountId, gameId, totalAmount, encodedDt]
					);
					if (iouRows.length > 0) {
						await pool.execute(
							'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
							[softDeleteBy, softDeleteDt, iouRows[0].IDNo]
						);
					} else {
						const [iouRows2] = await pool.execute(
							`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND (GAME_ID = ? OR GAME_ID IS NULL) AND TRANSACTION_ID = 10 AND TRANSACTION_TYPE = 3 AND AMOUNT = ? AND ENCODED_DT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
							[accountId, gameId, totalAmount, encodedDt]
						);
						if (iouRows2.length > 0) {
							await pool.execute(
								'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
								[softDeleteBy, softDeleteDt, iouRows2[0].IDNo]
							);
						}
					}
				}
			}
		}

		// If CAGE_TYPE = 5 (Roller Chips), delete matching roller chips record only
		// Roller chips are separate records, so we don't touch buy-in records (CAGE_TYPE 1 and 3)
		if (cageType === 5) {
			const rollerNN = record.ROLLER_NN_CHIPS || 0;
			const rollerCC = record.ROLLER_CC_CHIPS || 0;
			const rollerTransaction = record.ROLLER_TRANSACTION;
			
			// Delete matching roller chips record (same GAME_ID, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, ENCODED_DT)
			// This handles both ADD (ROLLER_TRANSACTION = 1) and RETURN (ROLLER_TRANSACTION = 2)
			const rollerDeleteQuery = `
				UPDATE game_record 
				SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? 
				WHERE GAME_ID = ? 
				AND CAGE_TYPE = 5 
				AND ROLLER_NN_CHIPS = ? 
				AND ROLLER_CC_CHIPS = ? 
				AND ROLLER_TRANSACTION = ? 
				AND ENCODED_DT = ?
			`;
			await pool.execute(rollerDeleteQuery, [0, req.session.user_id, date_now, gameId, rollerNN, rollerCC, rollerTransaction, encodedDt]);
			res.send('Roller chips record deleted successfully');
		} else {
			// For CAGE_TYPE 1 or 3 (Buy-in), delete matching buy-in pair
			// Update records with the same GAME_ID, NN_CHIPS, CC_CHIPS and ENCODED_DT for CAGE_TYPE 1 and 3
			// This ensures we only delete the matching pair (CAGE_TYPE 1 and 3) for the same buy-in
			const deleteQuery = `
				UPDATE game_record 
				SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? 
				WHERE GAME_ID = ? AND NN_CHIPS = ? AND CC_CHIPS = ? AND ENCODED_DT = ? AND CAGE_TYPE IN (1, 3)
			`;

			const [deleteResult] = await pool.execute(deleteQuery, [0, req.session.user_id, date_now, gameId, nnChips, ccChips, encodedDt]);

			// Also delete roller chips (CAGE_TYPE 5) if they were added together with the buy-in
			// Roller chips from new game have same GAME_ID and ENCODED_DT, and ROLLER_TRANSACTION = 1 (ADD)
			const rollerDeleteQuery = `
				UPDATE game_record 
				SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? 
				WHERE GAME_ID = ? 
				AND CAGE_TYPE = 5 
				AND ROLLER_TRANSACTION = 1 
				AND ENCODED_DT = ?
			`;
			await pool.execute(rollerDeleteQuery, [0, req.session.user_id, date_now, gameId, encodedDt]);

			let guestRevertSuffix = '';
			if (deleteResult.affectedRows > 0) {
				const shouldRevertGuest = await isArchivedPendingGuestResolveBuyin(pool, gameId, id);
				if (shouldRevertGuest) {
					const reverted = await revertPendingGuestResolveOnGame(
						pool,
						gameId,
						req.session.user_id,
						date_now
					);
					if (reverted) {
						guestRevertSuffix =
							' Game restored to PENDING (guest resolve and roller chips undone).';
					}
				}
			}

			// Check if any rows were updated
			if (deleteResult.affectedRows > 0) {
				res.send(
					'GAME LIST updated successfully for IDNo and matching CAGE_TYPE 1 and 3, including roller chips if added together.' +
						guestRevertSuffix
				);
			} else {
				res.send('No matching records found for deletion with CAGE_TYPE 1 and 3');
			}
		}
	} catch (err) {
		console.error('Error updating GAME LIST:', err);
		res.status(500).send('Error updating GAME LIST');
	}
});
// Export the router
module.exports = router; 