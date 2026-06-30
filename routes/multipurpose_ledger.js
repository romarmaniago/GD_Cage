const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { applyCommaThousandsToNumericCells } = require('../utils/excelAmountFormat');
const { sendTelegramToManagement } = require('../utils/telegram');

/** 1=Deposit, 2=Withdrawal, 3=Transfer to account, 4=Money Exchange */
const TRANS_TYPE = {
	DEPOSIT: 1,
	WITHDRAWAL: 2,
	TRANSFER: 3,
	MONEY_EXCHANGE: 4
};

const CREDIT_TYPES = new Set([TRANS_TYPE.DEPOSIT]);
const DEBIT_TYPES = new Set([TRANS_TYPE.WITHDRAWAL, TRANS_TYPE.TRANSFER, TRANS_TYPE.MONEY_EXCHANGE]);
/** New transfers: junket funds → account only */
const TRANSFER_TYPES = new Set([TRANS_TYPE.TRANSFER]);
/** Guest Portal label when multipurpose ledger transfers to this account. */
const JFL_ACCOUNT_TRANSFER_DESC = 'TRANSFERRED FROM JUNKET FUNDS';

/** Allowed currencies for multipurpose ledger (display order). */
const JFL_CURRENCY_CODES = ['PHP', 'KRW', 'USD', 'JPY', 'USDT'];

function orderMultipurposeLedgerCurrencies(rows) {
	const list = rows || [];
	const byCode = new Map(
		list.map((r) => [String(r.code || r.CODE || '').toUpperCase(), r])
	);
	return JFL_CURRENCY_CODES.map((code) => byCode.get(code)).filter(Boolean);
}

function isAllowedJflCurrencyCode(code) {
	return JFL_CURRENCY_CODES.includes(String(code || '').toUpperCase());
}

async function loadMultipurposeLedgerCurrencies() {
	const placeholders = JFL_CURRENCY_CODES.map(() => '?').join(', ');
	const [rows] = await pool.execute(
		`SELECT ID AS id, CODE AS code, NAME AS name
		 FROM currency_master
		 WHERE ACTIVE = 1 AND CODE IN (${placeholders})`,
		JFL_CURRENCY_CODES
	);
	return orderMultipurposeLedgerCurrencies(rows);
}

function parseAmount(raw) {
	const clean = String(raw || '').replace(/,/g, '').trim();
	if (clean === '' || Number.isNaN(Number(clean))) return NaN;
	const n = Number(clean);
	return Number.isFinite(n) && n > 0 ? n : NaN;
}

function parseTransType(raw) {
	const n = parseInt(raw, 10);
	if (n === TRANS_TYPE.MONEY_EXCHANGE) return null;
	return CREDIT_TYPES.has(n) || DEBIT_TYPES.has(n) ? n : null;
}

function parseAccountId(raw) {
	if (raw === undefined || raw === null || raw === '') return null;
	const n = parseInt(raw, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseCurrencyId(raw) {
	if (raw === undefined || raw === null || raw === '') return null;
	const n = parseInt(raw, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseInCharge(raw) {
	return String(raw || '').trim().slice(0, 150);
}

function parseRemarks(raw) {
	return String(raw || '').trim().slice(0, 2000);
}

function isCreditType(transType) {
	return CREDIT_TYPES.has(Number(transType));
}

function isDebitType(transType) {
	return DEBIT_TYPES.has(Number(transType));
}

function isTransferType(transType) {
	return TRANSFER_TYPES.has(Number(transType));
}

function transTypeLabel(transType) {
	switch (Number(transType)) {
		case TRANS_TYPE.DEPOSIT:
			return 'Deposit';
		case TRANS_TYPE.WITHDRAWAL:
			return 'Withdrawal';
		case TRANS_TYPE.TRANSFER:
			return 'Transfer';
		case TRANS_TYPE.MONEY_EXCHANGE:
			return 'Money Exchange';
		default:
			return 'Unknown';
	}
}

function transTypeTelegramHeadline(action, transType) {
	const typeLabel = transTypeLabel(transType);
	const actionKey = String(action || 'add').toLowerCase();
	if (actionKey === 'edit') {
		return `* 멀티목적 장부 수정 Multipurpose Ledger — ${typeLabel} Updated *`;
	}
	if (actionKey === 'delete') {
		return `* 멀티목적 장부 삭제 Multipurpose Ledger — ${typeLabel} Deleted *`;
	}
	if (Number(transType) === TRANS_TYPE.DEPOSIT) {
		return '* 멀티목적 장부 입금 Multipurpose Ledger — Deposit *';
	}
	if (Number(transType) === TRANS_TYPE.WITHDRAWAL) {
		return '* 멀티목적 장부 출금 Multipurpose Ledger — Withdrawal *';
	}
	if (isTransferType(transType)) {
		return '* 멀티목적 장부 이체 Multipurpose Ledger — Transfer *';
	}
	if (Number(transType) === TRANS_TYPE.MONEY_EXCHANGE) {
		return '* 멀티목적 장부 환전 Multipurpose Ledger — Money Exchange *';
	}
	return `* 멀티목적 장부 Multipurpose Ledger — ${typeLabel} *`;
}

const { formatDateTimeDisplay, formatDateDisplay } = require('../utils/formatDateTime');

function formatTelegramDateTime(dateObj) {
	const d = dateObj instanceof Date ? dateObj : new Date();
	const full = formatDateTimeDisplay(d);
	return {
		date: formatDateDisplay(d),
		time: full.length >= 16 ? full.slice(11) : ''
	};
}

async function getUserDisplayName(userId) {
	if (!userId) return 'Unknown';
	const [rows] = await pool.execute(
		`SELECT CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME) AS NAME
		 FROM user_info ui WHERE ui.IDNo = ? LIMIT 1`,
		[userId]
	);
	const name = rows && rows[0] && rows[0].NAME ? String(rows[0].NAME).trim() : '';
	return name || 'Unknown';
}

async function getAccountTelegramLabel(accountId) {
	if (!accountId) return null;
	const [rows] = await pool.execute(
		`SELECT ag.AGENT_CODE, ag.NAME
		 FROM account acc
		 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 WHERE acc.IDNo = ? LIMIT 1`,
		[accountId]
	);
	if (!rows || !rows[0]) return null;
	const code = rows[0].AGENT_CODE ? String(rows[0].AGENT_CODE).trim() : '';
	const name = rows[0].NAME ? String(rows[0].NAME).trim() : '';
	if (code && name) return `${code} — ${name}`;
	return code || name || null;
}

function buildJflManagementTelegramText(payload) {
	const {
		action,
		transType,
		amount,
		remarks,
		inCharge,
		accountLabel,
		balance,
		currencyCode,
		processedBy
	} = payload;
	const { date, time } = formatTelegramDateTime(new Date());
	const ccyLabel = currencyCode ? ` ${currencyCode}` : '';
	const lines = [
		'Demo Cage',
		'',
		transTypeTelegramHeadline(action, transType),
		'',
		`유형 : ${transTypeLabel(transType)}`,
		`금액 Amount : ${(Number(amount) || 0).toLocaleString('en-US')}${ccyLabel}`
	];
	if (accountLabel) {
		lines.push(`계정 Account : ${accountLabel}`);
	}
	lines.push(
		`담당 In charge : ${inCharge || '-'}`,
		`비고 Remarks : ${remarks || '-'}`,
		`잔고 Balance${ccyLabel ? ` (${currencyCode})` : ''} : ${(Number(balance) || 0).toLocaleString('en-US')}`,
		`처리 Processed by : ${processedBy || 'Unknown'}`,
		'',
		`날짜 Date : ${date}`,
		`시간 Time : ${time}`
	);
	return lines.join('\n');
}

async function notifyJflManagementTelegram(payload) {
	try {
		const text = buildJflManagementTelegramText(payload);
		const accountLabel = payload.accountLabel ? String(payload.accountLabel) : '';
		const accountCode = accountLabel.includes(' — ')
			? accountLabel.split(' — ')[0].trim()
			: accountLabel.trim() || null;
		const actionLabel = String(payload.action || 'add').toLowerCase();
		await sendTelegramToManagement(text, {
			logPreview: `Multipurpose Ledger ${actionLabel} — ${transTypeLabel(payload.transType)}`,
			logMeta: {
				accountCode: accountCode || undefined,
				guestName: payload.inCharge || undefined,
				amount: payload.amount
			}
		});
	} catch (telegramErr) {
		console.error('multipurpose_ledger Telegram (management):', telegramErr.message);
	}
}

async function validateActiveAccount(accountId) {
	const [rows] = await pool.execute(
		`SELECT acc.IDNo, ag.AGENT_CODE, ag.NAME
		 FROM account acc
		 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 WHERE acc.IDNo = ? AND acc.ACTIVE = 1 AND ag.ACTIVE = 1
		 LIMIT 1`,
		[accountId]
	);
	return rows && rows[0] ? rows[0] : null;
}

async function validateActiveCurrency(currencyId) {
	const [rows] = await pool.execute(
		`SELECT ID, CODE FROM currency_master WHERE ID = ? AND ACTIVE = 1 LIMIT 1`,
		[currencyId]
	);
	return rows && rows[0] ? rows[0] : null;
}

async function getDefaultCurrencyId() {
	const [rows] = await pool.execute(
		`SELECT ID FROM currency_master
		 WHERE ACTIVE = 1
		 ORDER BY CASE WHEN CODE = 'PHP' THEN 0 ELSE 1 END, SORT_ORDER ASC, CODE ASC
		 LIMIT 1`
	);
	return rows && rows[0] ? Number(rows[0].ID) : null;
}

/** Per-currency junket funds pool — not house cash balance. */
async function computeJunketFundsBalance(currencyId, excludeLedgerId) {
	if (!currencyId) return 0;
	const params = [currencyId];
	let excludeSql = '';
	if (excludeLedgerId) {
		excludeSql = ' AND IDNo <> ?';
		params.push(excludeLedgerId);
	}
	const [rows] = await pool.execute(
		`SELECT
			COALESCE(SUM(CASE WHEN TRANS_TYPE = 1 THEN AMOUNT ELSE 0 END), 0) -
			COALESCE(SUM(CASE WHEN TRANS_TYPE IN (2, 3, 4) THEN AMOUNT ELSE 0 END), 0) AS BALANCE
		 FROM junket_funds_ledger
		 WHERE ACTIVE = 1 AND CURRENCY_ID = ?${excludeSql}`,
		params
	);
	return Number(rows && rows[0] && rows[0].BALANCE) || 0;
}

async function computeAllJunketFundsBalances() {
	const placeholders = JFL_CURRENCY_CODES.map(() => '?').join(', ');
	const [rows] = await pool.execute(
		`SELECT
			cm.ID AS currency_id,
			cm.CODE AS currency_code,
			COALESCE(SUM(CASE WHEN jl.TRANS_TYPE = 1 THEN jl.AMOUNT ELSE 0 END), 0) -
			COALESCE(SUM(CASE WHEN jl.TRANS_TYPE IN (2, 3, 4) THEN jl.AMOUNT ELSE 0 END), 0) AS balance
		 FROM currency_master cm
		 LEFT JOIN junket_funds_ledger jl
			ON jl.CURRENCY_ID = cm.ID AND jl.ACTIVE = 1
		 WHERE cm.ACTIVE = 1 AND cm.CODE IN (${placeholders})
		 GROUP BY cm.ID, cm.CODE
		 ORDER BY FIELD(cm.CODE, ${placeholders})`,
		[...JFL_CURRENCY_CODES, ...JFL_CURRENCY_CODES]
	);
	return (rows || []).map((row) => ({
		currency_id: Number(row.currency_id),
		currency_code: String(row.currency_code || ''),
		balance: Number(row.balance) || 0
	}));
}

async function getCurrencyCodeById(currencyId) {
	if (!currencyId) return '';
	const [rows] = await pool.execute(
		`SELECT CODE FROM currency_master WHERE ID = ? LIMIT 1`,
		[currencyId]
	);
	return rows && rows[0] ? String(rows[0].CODE || '') : '';
}

function junketDebitAmountForExisting(existing, currencyId) {
	if (!existing || !isDebitType(existing.TRANS_TYPE)) return 0;
	if (currencyId && Number(existing.CURRENCY_ID) !== Number(currencyId)) return 0;
	return Number(existing.AMOUNT) || 0;
}

async function assertSufficientJunketBalance(transType, amount, currencyId, excludeLedgerId, existingRow) {
	if (!isDebitType(transType)) return null;
	if (!currencyId) {
		return 'Select a currency';
	}
	const currency = await validateActiveCurrency(currencyId);
	if (!currency) {
		return 'Invalid or inactive currency';
	}
	const balance = await computeJunketFundsBalance(currencyId, excludeLedgerId);
	const effectiveBalance = balance + junketDebitAmountForExisting(existingRow, currencyId);
	if (amount > effectiveBalance) {
		const code = currency.CODE ? String(currency.CODE) : '';
		const label = code ? `${code} ` : '';
		return `Insufficient ${label}balance. Available: ${effectiveBalance.toLocaleString('en-US')}`;
	}
	return null;
}

function buildAccountLedgerRemarks(remarks) {
	const text = String(remarks || '').trim();
	return text || 'Transfer from multipurpose ledger';
}

async function upsertAccountLedgerForTransfer(connection, {
	accountId,
	amount,
	remarks,
	userId,
	dateNow,
	accountLedgerId
}) {
	const transactionId = 1;
	const ledgerRemarks = buildAccountLedgerRemarks(remarks);

	if (accountLedgerId) {
		await connection.execute(
			`UPDATE account_ledger
			 SET ACCOUNT_ID = ?, TRANSACTION_ID = ?, AMOUNT = ?, REMARKS = ?,
			     EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[accountId, transactionId, amount, ledgerRemarks, userId, dateNow, accountLedgerId]
		);
		return accountLedgerId;
	}

	const [result] = await connection.execute(
		`INSERT INTO account_ledger (
			ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC,
			AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT
		) VALUES (?, ?, 2, ?, ?, ?, ?, ?)`,
		[accountId, transactionId, JFL_ACCOUNT_TRANSFER_DESC, amount, ledgerRemarks, userId, dateNow]
	);
	return result.insertId;
}

async function archiveLinkedAccountLedger(connection, accountLedgerId, userId, dateNow) {
	if (!accountLedgerId) return;
	await connection.execute(
		`UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1`,
		[userId, dateNow, accountLedgerId]
	);
}

async function getPhpCurrencyId() {
	const [rows] = await pool.execute(
		`SELECT ID FROM currency_master WHERE ACTIVE = 1 AND CODE = 'PHP' LIMIT 1`
	);
	if (rows && rows[0]) return Number(rows[0].ID);
	return getDefaultCurrencyId();
}

async function saveJunketFundsEntry(connection, payload, existingRow) {
	const {
		transType,
		amount,
		currencyId: submittedCurrencyId,
		remarks,
		inCharge,
		accountId,
		userId,
		dateNow,
		ledgerId
	} = payload;

	let currencyId = submittedCurrencyId;
	if (isTransferType(transType)) {
		currencyId = await getPhpCurrencyId();
		if (!currencyId) {
			return { error: 'PHP currency is not configured' };
		}
	}

	if (!currencyId) {
		return { error: 'Select a currency' };
	}
	const currency = await validateActiveCurrency(currencyId);
	if (!currency) {
		return { error: 'Invalid or inactive currency' };
	}
	if (!isAllowedJflCurrencyCode(currency.CODE)) {
		return { error: 'Invalid currency for multipurpose ledger' };
	}

	if (isTransferType(transType) && !accountId) {
		return { error: 'Select an account for transfer' };
	}
	if (!isTransferType(transType) && accountId) {
		return { error: 'Account is only required for transfers' };
	}

	if (isTransferType(transType)) {
		const account = await validateActiveAccount(accountId);
		if (!account) {
			return { error: 'Invalid or inactive account' };
		}
	}

	const junketErr = await assertSufficientJunketBalance(
		transType,
		amount,
		currencyId,
		ledgerId || null,
		existingRow
	);
	if (junketErr) return { error: junketErr };

	let accountLedgerId = existingRow && existingRow.ACCOUNT_LEDGER_ID ? existingRow.ACCOUNT_LEDGER_ID : null;
	const hadAccountLink =
		existingRow &&
		(existingRow.ACCOUNT_LEDGER_ID || isTransferType(existingRow.TRANS_TYPE));

	if (isTransferType(transType)) {
		accountLedgerId = await upsertAccountLedgerForTransfer(connection, {
			accountId,
			amount,
			remarks,
			userId,
			dateNow,
			accountLedgerId: hadAccountLink ? accountLedgerId : null
		});
	} else if (hadAccountLink && accountLedgerId) {
		await archiveLinkedAccountLedger(connection, accountLedgerId, userId, dateNow);
		accountLedgerId = null;
	}

	const storedAccountId = isTransferType(transType) ? accountId : null;

	if (ledgerId) {
		await connection.execute(
			`UPDATE junket_funds_ledger
			 SET TRANS_TYPE = ?, ACCOUNT_ID = ?, ACCOUNT_LEDGER_ID = ?,
			     AMOUNT = ?, CURRENCY_ID = ?, REMARKS = ?, IN_CHARGE = ?,
			     EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[
				transType,
				storedAccountId,
				accountLedgerId,
				amount,
				currencyId,
				remarks,
				inCharge,
				userId,
				dateNow,
				ledgerId
			]
		);
	} else {
		const [insertResult] = await connection.execute(
			`INSERT INTO junket_funds_ledger (
				TRANS_TYPE, ACCOUNT_ID, ACCOUNT_LEDGER_ID,
				AMOUNT, CURRENCY_ID, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[
				transType,
				storedAccountId,
				accountLedgerId,
				amount,
				currencyId,
				remarks,
				inCharge,
				userId,
				dateNow
			]
		);
		return { id: insertResult.insertId };
	}

	return { id: ledgerId };
}

router.get('/multipurpose_ledger', checkSession, async function (req, res) {
	const data = sessions(req, 'multipurpose_ledger');
	data.permissions = req.session.permissions;
	try {
		data.currencies = await loadMultipurposeLedgerCurrencies();
	} catch (err) {
		console.error('multipurpose_ledger currency_master:', err.message);
		data.currencies = [];
	}
	res.render('junket/multipurpose_ledger', data);
});

router.get('/multipurpose_ledger/balance', checkSession, async (req, res) => {
	try {
		const currencyId = parseCurrencyId(req.query.currencyId);
		if (currencyId) {
			const balance = await computeJunketFundsBalance(currencyId);
			const code = await getCurrencyCodeById(currencyId);
			return res.json({ currency_id: currencyId, currency_code: code, balance });
		}
		const balances = await computeAllJunketFundsBalances();
		res.json({ balances });
	} catch (err) {
		console.error('multipurpose_ledger/balance:', err);
		res.status(500).json({ message: 'Failed to load balance' });
	}
});

router.get('/multipurpose_ledger_data', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute(
			`SELECT
				jl.IDNo,
				jl.TRANS_TYPE,
				jl.ACCOUNT_ID,
				jl.AMOUNT,
				jl.CURRENCY_ID,
				cm.CODE AS CURRENCY_CODE,
				jl.REMARKS,
				jl.IN_CHARGE,
				jl.ENCODED_BY,
				jl.ENCODED_DT,
				ag.AGENT_CODE,
				ag.NAME AS AGENT_NAME,
				mxe.GUEST_NAME AS EXCHANGE_GUEST_NAME,
				mxe.AMOUNT_IN AS EXCHANGE_AMOUNT_IN,
				in_cm.CODE AS EXCHANGE_IN_CURRENCY_CODE,
				ex_ag.AGENT_CODE AS EXCHANGE_AGENT_CODE,
				ex_ag.NAME AS EXCHANGE_AGENT_NAME,
				CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME) AS ENCODED_BY_NAME
			FROM junket_funds_ledger jl
			LEFT JOIN currency_master cm ON cm.ID = jl.CURRENCY_ID
			LEFT JOIN account acc ON acc.IDNo = jl.ACCOUNT_ID
			LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN multipurpose_ledger_exchange mxe
				ON mxe.LEDGER_ID = jl.IDNo AND mxe.TRANS_TYPE = 1 AND mxe.ACTIVE = 1
			LEFT JOIN currency_master in_cm ON in_cm.ID = mxe.IN_CURRENCY_ID
			LEFT JOIN account ex_acc ON ex_acc.IDNo = mxe.ACCOUNT_ID
			LEFT JOIN agent ex_ag ON ex_ag.IDNo = ex_acc.AGENT_ID
			LEFT JOIN user_info ui ON ui.IDNo = jl.ENCODED_BY
			WHERE jl.ACTIVE = 1
			${JFL_MAIN_TABLE_EXCLUDE_LEDGER_SQL}
			ORDER BY jl.ENCODED_DT DESC, jl.IDNo DESC`
		);

		const data = (rows || []).map((row) => {
			let accountDisplay = '-';
			let guestDisplay = '';
			if (Number(row.TRANS_TYPE) === TRANS_TYPE.MONEY_EXCHANGE) {
				if (row.EXCHANGE_AGENT_CODE) {
					accountDisplay = `${row.EXCHANGE_AGENT_CODE}${row.EXCHANGE_AGENT_NAME ? ` — ${row.EXCHANGE_AGENT_NAME}` : ''}`;
				}
				guestDisplay = row.EXCHANGE_GUEST_NAME ? String(row.EXCHANGE_GUEST_NAME).trim() : '';
			} else if (row.ACCOUNT_ID && row.AGENT_CODE) {
				accountDisplay = `${row.AGENT_CODE}${row.AGENT_NAME ? ` — ${row.AGENT_NAME}` : ''}`;
			}
			return {
				...row,
				ACCOUNT_DISPLAY: accountDisplay,
				GUEST_DISPLAY: guestDisplay || '-',
				APPROVED_BY_DISPLAY: row.IN_CHARGE ? String(row.IN_CHARGE).trim() : '',
				TRANS_TYPE_LABEL: transTypeLabel(row.TRANS_TYPE)
			};
		});

		res.json(data);
	} catch (err) {
		console.error('multipurpose_ledger_data:', err);
		res.status(500).json({ message: 'Failed to load ledger data' });
	}
});

router.post('/add_multipurpose_ledger', checkSession, async (req, res) => {
	const connection = await pool.getConnection();
	try {
		const transType = parseTransType(req.body.txtTransType);
		const amount = parseAmount(req.body.txtAmount);
		const currencyId = parseCurrencyId(req.body.txtCurrencyId);
		const remarks = parseRemarks(req.body.txtRemarks);
		const inCharge = parseInCharge(req.body.txtInCharge);
		const accountId = parseAccountId(req.body.txtAccountId);
		const dateNow = new Date();
		const userId = req.session.user_id || null;

		if (!transType) {
			return res.status(400).json({ message: 'Select a transaction type' });
		}
		if (Number.isNaN(amount)) {
			return res.status(400).json({ message: 'Enter a valid amount greater than zero' });
		}
		if (!remarks) {
			return res.status(400).json({ message: 'Remarks is required' });
		}
		if (!inCharge) {
			return res.status(400).json({ message: 'Approved by is required' });
		}

		await connection.beginTransaction();
		const result = await saveJunketFundsEntry(connection, {
			transType,
			amount,
			currencyId,
			remarks,
			inCharge,
			accountId,
			userId,
			dateNow,
			ledgerId: null
		}, null);

		if (result.error) {
			await connection.rollback();
			return res.status(400).json({ message: result.error });
		}

		await connection.commit();

		const balance = await computeJunketFundsBalance(currencyId);
		const currencyCode = await getCurrencyCodeById(currencyId);
		const processedBy = await getUserDisplayName(userId);
		const accountLabel = await getAccountTelegramLabel(accountId);
		await notifyJflManagementTelegram({
			action: 'add',
			transType,
			amount,
			remarks,
			inCharge,
			accountLabel,
			balance,
			currencyCode,
			processedBy,
			ledgerId: result.id
		});

		res.json({ message: 'Saved successfully' });
	} catch (err) {
		await connection.rollback();
		console.error('add_multipurpose_ledger:', err);
		res.status(500).json({ message: 'Failed to save entry' });
	} finally {
		connection.release();
	}
});

router.put('/multipurpose_ledger/:id', checkSession, async (req, res) => {
	const connection = await pool.getConnection();
	try {
		const id = parseInt(req.params.id, 10);
		const transType = parseTransType(req.body.txtTransType);
		const amount = parseAmount(req.body.txtAmount);
		const currencyId = parseCurrencyId(req.body.txtCurrencyId);
		const remarks = parseRemarks(req.body.txtRemarks);
		const inCharge = parseInCharge(req.body.txtInCharge);
		const accountId = parseAccountId(req.body.txtAccountId);
		const dateNow = new Date();
		const userId = req.session.user_id || null;

		if (!id || !transType) {
			return res.status(400).json({ message: 'Invalid payload' });
		}
		if (Number.isNaN(amount)) {
			return res.status(400).json({ message: 'Enter a valid amount greater than zero' });
		}
		if (!remarks) {
			return res.status(400).json({ message: 'Remarks is required' });
		}
		if (!inCharge) {
			return res.status(400).json({ message: 'Approved by is required' });
		}

		const [existingRows] = await connection.execute(
			`SELECT TRANS_TYPE, AMOUNT, CURRENCY_ID, ACCOUNT_ID, ACCOUNT_LEDGER_ID
			 FROM junket_funds_ledger WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1`,
			[id]
		);
		if (!existingRows || !existingRows.length) {
			return res.status(404).json({ message: 'Record not found' });
		}
		const existing = existingRows[0];

		await connection.beginTransaction();
		const result = await saveJunketFundsEntry(
			connection,
			{
				transType,
				amount,
				currencyId,
				remarks,
				inCharge,
				accountId,
				userId,
				dateNow,
				ledgerId: id
			},
			existing
		);

		if (result.error) {
			await connection.rollback();
			return res.status(400).json({ message: result.error });
		}

		await connection.commit();
		res.json({ message: 'Updated successfully' });
	} catch (err) {
		await connection.rollback();
		console.error('multipurpose_ledger update:', err);
		res.status(500).json({ message: 'Failed to update entry' });
	} finally {
		connection.release();
	}
});

function buildExchangeLedgerRemarks(remark, inCode, exCode) {
	const base = String(remark || '').trim() || 'Money exchange';
	const pair = inCode && exCode ? ` (${inCode} → ${exCode})` : '';
	return (base + pair).slice(0, 2000);
}

async function archiveJunketLedgerRow(connection, ledgerId, userId, dateNow) {
	if (!ledgerId) return;
	await connection.execute(
		`UPDATE junket_funds_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1`,
		[userId, dateNow, ledgerId]
	);
}

/** Hide internal swap legs from the main multipurpose ledger grid. */
const JFL_MAIN_TABLE_EXCLUDE_LEDGER_SQL = `
	AND NOT EXISTS (
		SELECT 1 FROM multipurpose_ledger_exchange mxe_h
		WHERE mxe_h.ACTIVE = 1
		  AND (
			(mxe_h.CREDIT_LEDGER_ID = jl.IDNo AND mxe_h.TRANS_TYPE = 1)
			OR (mxe_h.RETURN_IN_LEDGER_ID = jl.IDNo AND mxe_h.TRANS_TYPE = 2)
			OR (mxe_h.RETURN_EX_LEDGER_ID = jl.IDNo AND mxe_h.TRANS_TYPE = 2)
		  )
	)`;

async function archiveLinkedExchangeRecords(connection, ledgerId, userId, dateNow) {
	const [depRows] = await connection.execute(
		`SELECT IDNo, LEDGER_ID, CREDIT_LEDGER_ID
		 FROM multipurpose_ledger_exchange
		 WHERE ACTIVE = 1 AND TRANS_TYPE = 1
		   AND (LEDGER_ID = ? OR CREDIT_LEDGER_ID = ?)
		 LIMIT 1`,
		[ledgerId, ledgerId]
	);
	if (!depRows || !depRows.length) return;
	const dep = depRows[0];
	const depositId = dep.IDNo;

	const [retRows] = await connection.execute(
		`SELECT RETURN_IN_LEDGER_ID, RETURN_EX_LEDGER_ID
		 FROM multipurpose_ledger_exchange
		 WHERE ACTIVE = 1 AND TRANS_TYPE = 2 AND SOURCE_DEPOSIT_ID = ?
		 LIMIT 1`,
		[depositId]
	);
	const ret = retRows && retRows[0];

	await archiveJunketLedgerRow(connection, dep.LEDGER_ID, userId, dateNow);
	await archiveJunketLedgerRow(connection, dep.CREDIT_LEDGER_ID, userId, dateNow);
	if (ret) {
		await archiveJunketLedgerRow(connection, ret.RETURN_IN_LEDGER_ID, userId, dateNow);
		await archiveJunketLedgerRow(connection, ret.RETURN_EX_LEDGER_ID, userId, dateNow);
	}

	await connection.execute(
		`UPDATE multipurpose_ledger_exchange
		 SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
		 WHERE ACTIVE = 1 AND (IDNo = ? OR (SOURCE_DEPOSIT_ID = ? AND TRANS_TYPE = 2))`,
		[userId, dateNow, depositId, depositId]
	);
}

async function archiveLinkedRecordsOnRemove(connection, ledgerId, userId, dateNow) {
	const [rows] = await connection.execute(
		`SELECT ACCOUNT_LEDGER_ID FROM junket_funds_ledger WHERE IDNo = ? LIMIT 1`,
		[ledgerId]
	);
	const row = rows && rows[0];
	if (!row) return;
	await archiveLinkedAccountLedger(connection, row.ACCOUNT_LEDGER_ID, userId, dateNow);
	await archiveLinkedExchangeRecords(connection, ledgerId, userId, dateNow);
}

router.put('/multipurpose_ledger/remove/:id', checkSession, async (req, res) => {
	const connection = await pool.getConnection();
	try {
		const id = parseInt(req.params.id, 10);
		const dateNow = new Date();
		const userId = req.session.user_id || null;

		if (!id) return res.status(400).json({ message: 'Invalid ID' });

		const [rows] = await connection.execute(
			`SELECT IDNo FROM junket_funds_ledger WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1`,
			[id]
		);
		if (!rows || !rows.length) {
			return res.status(404).json({ message: 'Record not found' });
		}

		await connection.beginTransaction();
		await connection.execute(
			`UPDATE junket_funds_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
			[userId, dateNow, id]
		);
		await archiveLinkedRecordsOnRemove(connection, id, userId, dateNow);
		await connection.commit();
		res.json({ message: 'Deleted successfully' });
	} catch (err) {
		await connection.rollback();
		console.error('multipurpose_ledger remove:', err);
		res.status(500).json({ message: 'Failed to delete entry' });
	} finally {
		connection.release();
	}
});

function exportAlignment(header) {
	const h = String(header || '').toUpperCase();
	if (h.includes('AMOUNT') || h.includes('BALANCE')) {
		return { vertical: 'middle', horizontal: 'right', indent: 1, wrapText: false };
	}
	return { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false };
}

function exportDisplayWidth(value) {
	return Array.from(String(value == null ? '' : value).replace(/\r?\n/g, ' ')).reduce((sum, ch) => {
		return sum + (ch.charCodeAt(0) > 255 ? 2 : 1);
	}, 0);
}

function coerceExportCell(raw) {
	if (raw == null || raw === '') return '';
	let s = String(raw).trim();
	s = s.replace(/^\u20B1\s*/, '').replace(/^PHP\s*/i, '').trim();
	if (/[a-zA-Z]/.test(s)) return s;
	const normalized = s.replace(/,/g, '');
	if (!/^[-+]?(?:\d+\.\d+|\d+\.?|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)) return s;
	const n = Number(normalized);
	return Number.isFinite(n) ? n : s;
}

router.post('/multipurpose_ledger/export_xlsx', checkSession, async (req, res) => {
	try {
		const { headers, rows, filename } = req.body || {};
		if (!Array.isArray(headers) || headers.length === 0) {
			return res.status(400).json({ error: 'Invalid headers' });
		}
		if (!Array.isArray(rows)) {
			return res.status(400).json({ error: 'Invalid rows' });
		}
		if (rows.length > 10000) {
			return res.status(400).json({ error: 'Too many rows' });
		}

		const ncol = headers.length;
		const thinBorder = {
			top: { style: 'thin', color: { argb: 'FF666666' } },
			left: { style: 'thin', color: { argb: 'FF666666' } },
			bottom: { style: 'thin', color: { argb: 'FF666666' } },
			right: { style: 'thin', color: { argb: 'FF666666' } }
		};

		const workbook = new ExcelJS.Workbook();
		const ws = workbook.addWorksheet('Multipurpose Ledger', {
			views: [{ state: 'frozen', ySplit: 1 }]
		});

		const headerRow = ws.addRow(headers.map((h) => (h == null ? '' : String(h))));
		headerRow.height = 22;
		headerRow.eachCell((cell, colNumber) => {
			cell.font = { bold: true };
			cell.alignment = exportAlignment(headers[colNumber - 1]);
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
				return coerceExportCell(v);
			});
			const dataRow = ws.addRow(padded);
			dataRow.eachCell((cell, colNumber) => {
				cell.border = thinBorder;
				cell.alignment = exportAlignment(headers[colNumber - 1]);
			});
		});

		const colMaxLens = headers.map((h, c) => {
			let m = exportDisplayWidth(h);
			for (let ri = 0; ri < rows.length; ri++) {
				const row = rows[ri];
				if (!Array.isArray(row) || row[c] == null) continue;
				m = Math.max(m, exportDisplayWidth(row[c]));
			}
			return Math.min(100, Math.max(12, m + 4));
		});
		for (let i = 1; i <= ncol; i++) {
			ws.getColumn(i).width = colMaxLens[i - 1];
		}

		applyCommaThousandsToNumericCells(ws);

		let outName = 'MultipurposeLedger-export.xlsx';
		if (filename && typeof filename === 'string') {
			const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
			if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
			else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
		}

		const buffer = await workbook.xlsx.writeBuffer();
		res.setHeader(
			'Content-Type',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		res.setHeader('Content-Disposition', `attachment; filename="${outName.replace(/"/g, '')}"`);
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('multipurpose_ledger/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

// ----- Multipurpose ledger money exchange (multipurpose_ledger_exchange) -----

const EXCHANGE_TRANS = { DEPOSIT: 1, RETURN: 2 };

const currencyStrengthRank = {
	USD: 5,
	USDT: 4,
	PHP: 3,
	JPY: 2,
	KRW: 1
};

function parseOptionalAccountId(v) {
	if (v === undefined || v === null || v === '') return null;
	const n = parseInt(v, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseOptionalExchangeId(v) {
	if (v === undefined || v === null || v === '') return null;
	const n = parseInt(v, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseExchangeGuestName(body) {
	const s = String(body.txtGuestName || body.txtGuestname || '').trim();
	return s ? s.slice(0, 255) : null;
}

function parseExchangeRemark(raw) {
	return String(raw || '').trim().slice(0, 500);
}

async function getCurrencyCodesByIds(inCurrencyId, exchangeCurrencyId) {
	const [rows] = await pool.execute(
		`SELECT ID, CODE FROM currency_master WHERE ID IN (?, ?)`,
		[inCurrencyId, exchangeCurrencyId]
	);
	const codeMap = new Map((rows || []).map((r) => [Number(r.ID), String(r.CODE || '').toUpperCase()]));
	return {
		inCode: codeMap.get(Number(inCurrencyId)) || '',
		exCode: codeMap.get(Number(exchangeCurrencyId)) || ''
	};
}

function getCurrencyRank(code) {
	const c = String(code || '').toUpperCase();
	if (!c) return 0;
	return Number(currencyStrengthRank[c] || 0);
}

function computeExchangeAmountByDirection(amountIn, ratePct, inCode, exCode) {
	if (!Number.isFinite(amountIn) || !Number.isFinite(ratePct) || ratePct <= 0) return NaN;
	if (!inCode || !exCode || inCode === exCode) return NaN;
	const inRank = getCurrencyRank(inCode);
	const exRank = getCurrencyRank(exCode);
	if (inRank >= exRank) return Number((amountIn * ratePct).toFixed(2));
	return Number((amountIn / ratePct).toFixed(2));
}

router.get('/multipurpose_ledger/exchange/deposit_history', checkSession, async (req, res) => {
	try {
		const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
		const [rows] = await pool.query(
			`SELECT
				t.IDNo AS id,
				DATE_FORMAT(t.TRANS_DATETIME, '%b %e, %Y %H:%i') AS trans_datetime,
				UNIX_TIMESTAMP(t.TRANS_DATETIME) AS trans_sort,
				t.ACCOUNT_ID AS account_id,
				ag.AGENT_CODE AS agent_code,
				ag.NAME AS agent_name,
				NULLIF(TRIM(t.GUEST_NAME), '') AS guest_name,
				t.REMARK AS remark,
				t.IN_CHARGE AS in_charge,
				c1.CODE AS in_currency_code,
				t.AMOUNT_IN AS amount_in,
				c2.CODE AS exchange_currency_code,
				t.RATE_PERCENT AS rate_percent,
				t.EXCHANGE_AMOUNT AS exchange_amount,
				r.IDNo AS return_txn_id,
				DATE_FORMAT(r.TRANS_DATETIME, '%b %e, %Y %H:%i') AS return_datetime,
				r.RETURN_AMOUNT AS return_amount,
				r.MARGIN_RETURN AS margin_return,
				r.REMARK AS return_remark,
				CASE WHEN r.IDNo IS NOT NULL THEN 'Returned' ELSE 'Pending' END AS return_status
			FROM multipurpose_ledger_exchange t
			LEFT JOIN account acc ON acc.IDNo = t.ACCOUNT_ID
			LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN currency_master c1 ON c1.ID = t.IN_CURRENCY_ID
			LEFT JOIN currency_master c2 ON c2.ID = t.EXCHANGE_CURRENCY_ID
			LEFT JOIN multipurpose_ledger_exchange r
				ON r.SOURCE_DEPOSIT_ID = t.IDNo AND r.TRANS_TYPE = 2 AND r.ACTIVE = 1
			WHERE t.TRANS_TYPE = 1 AND t.ACTIVE = 1
			ORDER BY t.TRANS_DATETIME DESC, t.IDNo DESC
			LIMIT ${limit}`
		);
		res.json(rows || []);
	} catch (err) {
		console.error('multipurpose_ledger/exchange/deposit_history:', err);
		res.status(500).send('Error loading deposit history');
	}
});

router.post('/multipurpose_ledger/exchange/deposit', checkSession, async (req, res) => {
	const connection = await pool.getConnection();
	try {
		const accountId = parseOptionalAccountId(req.body.txtAccountId);
		const guestName = parseExchangeGuestName(req.body);
		const remark = parseExchangeRemark(req.body.txtRemark);
		const inCharge = parseInCharge(req.body.txtInCharge);
		const inCcy = parseInt(req.body.txtInCurrencyId, 10);
		const exCcy = parseInt(req.body.txtExchangeCurrencyId, 10);
		const amountIn = Number(String(req.body.txtAmountIn || '').replace(/,/g, ''));
		const ratePct = Number(req.body.txtRatePercent);
		const clientExchangeAmt = Number(String(req.body.txtExchangeAmount || '').replace(/,/g, ''));
		const uid = req.session.user_id || null;
		const dateNow = new Date();

		if (!inCharge) {
			return res.status(400).send('Approved by is required');
		}
		if (!accountId && !guestName) {
			return res.status(400).send('Guest name is required when no account is selected');
		}
		if (!inCcy || inCcy < 1 || !exCcy || exCcy < 1) {
			return res.status(400).send('Select in currency and exchange currency');
		}
		if (inCcy === exCcy) {
			return res.status(400).send('In currency and exchange currency must differ');
		}
		const exchangeAmt = Number(Number(clientExchangeAmt).toFixed(2));
		if (
			Number.isNaN(amountIn) ||
			Number.isNaN(ratePct) ||
			Number.isNaN(exchangeAmt) ||
			amountIn <= 0 ||
			ratePct <= 0 ||
			exchangeAmt <= 0
		) {
			return res.status(400).send('Enter valid amount, rate %, and exchange amount');
		}

		const exBalanceErr = await assertSufficientJunketBalance(
			TRANS_TYPE.MONEY_EXCHANGE,
			exchangeAmt,
			exCcy,
			null,
			null
		);
		if (exBalanceErr) {
			return res.status(400).send(exBalanceErr);
		}

		const { inCode, exCode } = await getCurrencyCodesByIds(inCcy, exCcy);
		const expectedExchangeAmt = computeExchangeAmountByDirection(amountIn, ratePct, inCode, exCode);
		if (!Number.isFinite(expectedExchangeAmt) || Math.abs(expectedExchangeAmt - exchangeAmt) > 0.02) {
			return res.status(400).send('Exchange amount does not match amount and rate');
		}

		const ledgerRemarks = buildExchangeLedgerRemarks(remark, inCode, exCode);

		await connection.beginTransaction();

		const [inCreditResult] = await connection.execute(
			`INSERT INTO junket_funds_ledger (
				TRANS_TYPE, ACCOUNT_ID, ACCOUNT_LEDGER_ID,
				AMOUNT, CURRENCY_ID, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
			[TRANS_TYPE.DEPOSIT, amountIn, inCcy, ledgerRemarks, inCharge, uid, dateNow]
		);
		const inCreditLedgerId = inCreditResult.insertId;

		const [exDebitResult] = await connection.execute(
			`INSERT INTO junket_funds_ledger (
				TRANS_TYPE, ACCOUNT_ID, ACCOUNT_LEDGER_ID,
				AMOUNT, CURRENCY_ID, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
			[TRANS_TYPE.MONEY_EXCHANGE, exchangeAmt, exCcy, ledgerRemarks, inCharge, uid, dateNow]
		);
		const exDebitLedgerId = exDebitResult.insertId;

		await connection.execute(
			`INSERT INTO multipurpose_ledger_exchange (
				LEDGER_ID, CREDIT_LEDGER_ID, TRANS_TYPE, TRANS_DATETIME, ACCOUNT_ID, GUEST_NAME, REMARK,
				IN_CHARGE, IN_CURRENCY_ID, AMOUNT_IN, EXCHANGE_CURRENCY_ID, RATE_PERCENT, EXCHANGE_AMOUNT,
				ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[
				exDebitLedgerId,
				inCreditLedgerId,
				dateNow,
				accountId,
				guestName,
				remark || null,
				inCharge,
				inCcy,
				amountIn,
				exCcy,
				ratePct,
				exchangeAmt,
				uid,
				dateNow
			]
		);

		await connection.commit();

		const balanceEx = await computeJunketFundsBalance(exCcy);
		const processedBy = await getUserDisplayName(uid);
		const accountLabel = accountId ? await getAccountTelegramLabel(accountId) : guestName;
		await notifyJflManagementTelegram({
			action: 'add',
			transType: TRANS_TYPE.MONEY_EXCHANGE,
			amount: exchangeAmt,
			remarks: `${ledgerRemarks} | +${amountIn.toLocaleString('en-US')} ${inCode}`,
			inCharge,
			accountLabel,
			balance: balanceEx,
			currencyCode: exCode,
			processedBy,
			ledgerId: exDebitLedgerId
		});

		res.send('Deposit saved successfully');
	} catch (err) {
		await connection.rollback();
		console.error('multipurpose_ledger/exchange/deposit:', err);
		res.status(500).send(err.message || 'Error saving deposit');
	} finally {
		connection.release();
	}
});

router.post('/multipurpose_ledger/exchange/return', checkSession, async (req, res) => {
	const connection = await pool.getConnection();
	try {
		const accountId = parseOptionalAccountId(req.body.txtAccountId);
		const guestName = parseExchangeGuestName(req.body);
		const remark = parseExchangeRemark(req.body.txtRemark);
		const returnAmt = Number(String(req.body.txtReturnAmount || '').replace(/,/g, ''));
		const sourceDepositId = parseOptionalExchangeId(req.body.txtSourceDepositId);
		const uid = req.session.user_id || null;
		const dateNow = new Date();

		if (Number.isNaN(returnAmt) || returnAmt <= 0) {
			return res.status(400).send('Enter a valid return amount');
		}
		if (!sourceDepositId) {
			return res.status(400).send('Select a deposit row to return');
		}

		const [depositRows] = await connection.execute(
			`SELECT
				t.IDNo, t.TRANS_TYPE, t.ACTIVE, t.IN_CHARGE, t.REMARK,
				t.IN_CURRENCY_ID, t.EXCHANGE_CURRENCY_ID, t.CREDIT_LEDGER_ID, t.LEDGER_ID,
				t.AMOUNT_IN, t.EXCHANGE_AMOUNT,
				c1.CODE AS IN_CURRENCY_CODE,
				c2.CODE AS EXCHANGE_CURRENCY_CODE,
				jl_led.TRANS_TYPE AS LEDGER_TRANS_TYPE,
				jl_cred.TRANS_TYPE AS CREDIT_LEDGER_TRANS_TYPE
			 FROM multipurpose_ledger_exchange t
			 LEFT JOIN currency_master c1 ON c1.ID = t.IN_CURRENCY_ID
			 LEFT JOIN currency_master c2 ON c2.ID = t.EXCHANGE_CURRENCY_ID
			 LEFT JOIN junket_funds_ledger jl_led ON jl_led.IDNo = t.LEDGER_ID
			 LEFT JOIN junket_funds_ledger jl_cred ON jl_cred.IDNo = t.CREDIT_LEDGER_ID
			 WHERE t.IDNo = ?`,
			[sourceDepositId]
		);
		if (!depositRows || !depositRows.length) {
			return res.status(404).send('Selected deposit record not found');
		}
		const dep = depositRows[0];
		if (Number(dep.ACTIVE) !== 1 || Number(dep.TRANS_TYPE) !== EXCHANGE_TRANS.DEPOSIT) {
			return res.status(400).send('Selected record is not an active deposit');
		}
		const inCode = String(dep.IN_CURRENCY_CODE || '').toUpperCase();
		const exCode = String(dep.EXCHANGE_CURRENCY_CODE || '').toUpperCase();
		const amountIn = Number(dep.AMOUNT_IN);
		const exchangeAmt = Number(dep.EXCHANGE_AMOUNT);
		const inCcy = Number(dep.IN_CURRENCY_ID);
		const exCcy = Number(dep.EXCHANGE_CURRENCY_ID);
		const hasSwapLegs = dep.CREDIT_LEDGER_ID != null && Number(dep.CREDIT_LEDGER_ID) > 0;
		/** Current: in=deposit (credit), ex=money exchange (debit). Legacy flip had the opposite. */
		const swapInAddsBalance =
			hasSwapLegs && Number(dep.CREDIT_LEDGER_TRANS_TYPE) === TRANS_TYPE.DEPOSIT;
		const baseAmount =
			inCode === 'PHP' && exCode !== 'PHP'
				? amountIn
				: exchangeAmt;
		if (!Number.isFinite(baseAmount)) {
			return res.status(400).send('Selected deposit has invalid base return amount');
		}
		if (returnAmt < baseAmount) {
			return res
				.status(400)
				.send(`Return amount cannot be lower than required base amount (${baseAmount})`);
		}
		const computedMargin = returnAmt - baseAmount;

		const [linkedRows] = await connection.execute(
			`SELECT IDNo FROM multipurpose_ledger_exchange
			 WHERE ACTIVE = 1 AND TRANS_TYPE = 2 AND SOURCE_DEPOSIT_ID = ? LIMIT 1`,
			[sourceDepositId]
		);
		if (linkedRows && linkedRows.length) {
			return res.status(400).send('This deposit is already returned');
		}

		if (hasSwapLegs) {
			if (swapInAddsBalance) {
				const inErr = await assertSufficientJunketBalance(
					TRANS_TYPE.MONEY_EXCHANGE,
					amountIn,
					inCcy,
					null,
					null
				);
				if (inErr) return res.status(400).send(inErr);
			} else {
				const exErr = await assertSufficientJunketBalance(
					TRANS_TYPE.MONEY_EXCHANGE,
					exchangeAmt,
					exCcy,
					null,
					null
				);
				if (exErr) return res.status(400).send(exErr);
			}
		}

		const returnLedgerRemarks = buildExchangeLedgerRemarks(
			remark || dep.REMARK,
			inCode,
			exCode
		);
		const inCharge = dep.IN_CHARGE || null;

		await connection.beginTransaction();

		let returnInLedgerId = null;
		let returnExLedgerId = null;

		if (!hasSwapLegs) {
			const [returnInResult] = await connection.execute(
				`INSERT INTO junket_funds_ledger (
					TRANS_TYPE, ACCOUNT_ID, ACCOUNT_LEDGER_ID,
					AMOUNT, CURRENCY_ID, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
				) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
				[
					TRANS_TYPE.DEPOSIT,
					amountIn,
					inCcy,
					`Return — ${returnLedgerRemarks}`,
					inCharge,
					uid,
					dateNow
				]
			);
			returnInLedgerId = returnInResult.insertId;
		} else if (swapInAddsBalance) {
			const [returnInResult] = await connection.execute(
				`INSERT INTO junket_funds_ledger (
					TRANS_TYPE, ACCOUNT_ID, ACCOUNT_LEDGER_ID,
					AMOUNT, CURRENCY_ID, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
				) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
				[
					TRANS_TYPE.MONEY_EXCHANGE,
					amountIn,
					inCcy,
					`Return — ${returnLedgerRemarks}`,
					inCharge,
					uid,
					dateNow
				]
			);
			returnInLedgerId = returnInResult.insertId;

			const [returnExResult] = await connection.execute(
				`INSERT INTO junket_funds_ledger (
					TRANS_TYPE, ACCOUNT_ID, ACCOUNT_LEDGER_ID,
					AMOUNT, CURRENCY_ID, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
				) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
				[
					TRANS_TYPE.DEPOSIT,
					exchangeAmt,
					exCcy,
					`Return — ${returnLedgerRemarks}`,
					inCharge,
					uid,
					dateNow
				]
			);
			returnExLedgerId = returnExResult.insertId;
		} else {
			const [returnInResult] = await connection.execute(
				`INSERT INTO junket_funds_ledger (
					TRANS_TYPE, ACCOUNT_ID, ACCOUNT_LEDGER_ID,
					AMOUNT, CURRENCY_ID, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
				) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
				[
					TRANS_TYPE.DEPOSIT,
					amountIn,
					inCcy,
					`Return — ${returnLedgerRemarks}`,
					inCharge,
					uid,
					dateNow
				]
			);
			returnInLedgerId = returnInResult.insertId;

			const [returnExResult] = await connection.execute(
				`INSERT INTO junket_funds_ledger (
					TRANS_TYPE, ACCOUNT_ID, ACCOUNT_LEDGER_ID,
					AMOUNT, CURRENCY_ID, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
				) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
				[
					TRANS_TYPE.MONEY_EXCHANGE,
					exchangeAmt,
					exCcy,
					`Return — ${returnLedgerRemarks}`,
					inCharge,
					uid,
					dateNow
				]
			);
			returnExLedgerId = returnExResult.insertId;
		}

		await connection.execute(
			`INSERT INTO multipurpose_ledger_exchange (
				TRANS_TYPE, TRANS_DATETIME, ACCOUNT_ID, GUEST_NAME, REMARK, IN_CHARGE,
				RETURN_AMOUNT, MARGIN_RETURN, SOURCE_DEPOSIT_ID,
				RETURN_IN_LEDGER_ID, RETURN_EX_LEDGER_ID,
				ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[
				dateNow,
				accountId,
				guestName,
				remark || null,
				inCharge,
				returnAmt,
				computedMargin,
				sourceDepositId,
				returnInLedgerId,
				returnExLedgerId,
				uid,
				dateNow
			]
		);

		await connection.commit();
		res.send('Return saved successfully');
	} catch (err) {
		await connection.rollback();
		console.error('multipurpose_ledger/exchange/return:', err);
		res.status(500).send(err.message || 'Error saving return');
	} finally {
		connection.release();
	}
});

module.exports = router;
