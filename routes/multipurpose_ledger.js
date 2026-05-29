const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { applyCommaThousandsToNumericCells } = require('../utils/excelAmountFormat');
const { sendTelegramToManagement } = require('../utils/telegram');

/** 1=Deposit, 2=Withdrawal, 3=legacy Transfer In, 4=Transfer to account */
const TRANS_TYPE = {
	DEPOSIT: 1,
	WITHDRAWAL: 2,
	TRANSFER_IN: 3,
	TRANSFER_OUT: 4
};

const CREDIT_TYPES = new Set([TRANS_TYPE.DEPOSIT, TRANS_TYPE.TRANSFER_IN]);
const DEBIT_TYPES = new Set([TRANS_TYPE.WITHDRAWAL, TRANS_TYPE.TRANSFER_OUT]);
/** New transfers: junket funds → account only */
const TRANSFER_TYPES = new Set([TRANS_TYPE.TRANSFER_OUT]);

function parseAmount(raw) {
	const clean = String(raw || '').replace(/,/g, '').trim();
	if (clean === '' || Number.isNaN(Number(clean))) return NaN;
	const n = Number(clean);
	return Number.isFinite(n) && n > 0 ? n : NaN;
}

function parseTransType(raw) {
	const n = parseInt(raw, 10);
	if (n === TRANS_TYPE.TRANSFER_IN) return null;
	return CREDIT_TYPES.has(n) || DEBIT_TYPES.has(n) ? n : null;
}

function parseAccountId(raw) {
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
		case TRANS_TYPE.TRANSFER_IN:
			return 'Transfer In (legacy)';
		case TRANS_TYPE.TRANSFER_OUT:
			return 'Transfer';
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
	return `* 멀티목적 장부 Multipurpose Ledger — ${typeLabel} *`;
}

function formatTelegramDateTime(dateObj) {
	const d = dateObj instanceof Date ? dateObj : new Date();
	return {
		date: d.toLocaleDateString('en-US'),
		time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
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
		processedBy
	} = payload;
	const { date, time } = formatTelegramDateTime(new Date());
	const lines = [
		'Demo Cage',
		'',
		transTypeTelegramHeadline(action, transType),
		'',
		`유형 : ${transTypeLabel(transType)}`,
		`금액 Amount : ${(Number(amount) || 0).toLocaleString()}`
	];
	if (accountLabel) {
		lines.push(`계정 Account : ${accountLabel}`);
	}
	lines.push(
		`담당 In charge : ${inCharge || '-'}`,
		`비고 Remarks : ${remarks || '-'}`,
		`잔고 Balance : ${(Number(balance) || 0).toLocaleString()}`,
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

/** Standalone junket funds pool — not house cash balance. */
async function computeJunketFundsBalance(excludeLedgerId) {
	const params = [];
	let excludeSql = '';
	if (excludeLedgerId) {
		excludeSql = ' AND IDNo <> ?';
		params.push(excludeLedgerId);
	}
	const [rows] = await pool.execute(
		`SELECT
			COALESCE(SUM(CASE WHEN TRANS_TYPE IN (1, 3) THEN AMOUNT ELSE 0 END), 0) -
			COALESCE(SUM(CASE WHEN TRANS_TYPE IN (2, 4) THEN AMOUNT ELSE 0 END), 0) AS BALANCE
		 FROM junket_funds_ledger
		 WHERE ACTIVE = 1${excludeSql}`,
		params
	);
	return Number(rows && rows[0] && rows[0].BALANCE) || 0;
}

function junketDebitAmountForExisting(existing) {
	if (!existing || !isDebitType(existing.TRANS_TYPE)) return 0;
	return Number(existing.AMOUNT) || 0;
}

async function assertSufficientJunketBalance(transType, amount, excludeLedgerId, existingRow) {
	if (!isDebitType(transType)) return null;
	const balance = await computeJunketFundsBalance(excludeLedgerId);
	const effectiveBalance = balance + junketDebitAmountForExisting(existingRow);
	if (amount > effectiveBalance) {
		return `Insufficient junket funds balance. Available: ${effectiveBalance.toLocaleString()}`;
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
		) VALUES (?, ?, 2, 'JUNKET FUNDS', ?, ?, ?, ?)`,
		[accountId, transactionId, amount, ledgerRemarks, userId, dateNow]
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

async function saveJunketFundsEntry(connection, payload, existingRow) {
	const {
		transType,
		amount,
		remarks,
		inCharge,
		accountId,
		userId,
		dateNow,
		ledgerId
	} = payload;

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

	const junketErr = await assertSufficientJunketBalance(transType, amount, ledgerId || null, existingRow);
	if (junketErr) return { error: junketErr };

	let accountLedgerId = existingRow && existingRow.ACCOUNT_LEDGER_ID ? existingRow.ACCOUNT_LEDGER_ID : null;
	const hadAccountLink =
		existingRow &&
		(existingRow.ACCOUNT_LEDGER_ID ||
			isTransferType(existingRow.TRANS_TYPE) ||
			Number(existingRow.TRANS_TYPE) === TRANS_TYPE.TRANSFER_IN);

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
			     AMOUNT = ?, REMARKS = ?, IN_CHARGE = ?,
			     EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[
				transType,
				storedAccountId,
				accountLedgerId,
				amount,
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
				AMOUNT, REMARKS, IN_CHARGE, ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[
				transType,
				storedAccountId,
				accountLedgerId,
				amount,
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

router.get('/multipurpose_ledger', checkSession, function (req, res) {
	const data = sessions(req, 'multipurpose_ledger');
	data.permissions = req.session.permissions;
	res.render('junket/multipurpose_ledger', data);
});

router.get('/multipurpose_ledger/balance', checkSession, async (req, res) => {
	try {
		const balance = await computeJunketFundsBalance();
		res.json({ balance });
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
				jl.REMARKS,
				jl.IN_CHARGE,
				jl.ENCODED_BY,
				jl.ENCODED_DT,
				ag.AGENT_CODE,
				ag.NAME AS AGENT_NAME,
				CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME) AS ENCODED_BY_NAME
			FROM junket_funds_ledger jl
			LEFT JOIN account acc ON acc.IDNo = jl.ACCOUNT_ID
			LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info ui ON ui.IDNo = jl.ENCODED_BY
			WHERE jl.ACTIVE = 1
			ORDER BY jl.ENCODED_DT DESC, jl.IDNo DESC`
		);

		const data = (rows || []).map((row) => {
			const accountDisplay =
				row.ACCOUNT_ID && row.AGENT_CODE
					? `${row.AGENT_CODE}${row.AGENT_NAME ? ` — ${row.AGENT_NAME}` : ''}`
					: '-';
			return {
				...row,
				ACCOUNT_DISPLAY: accountDisplay,
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
			return res.status(400).json({ message: 'Person in charge is required' });
		}

		await connection.beginTransaction();
		const result = await saveJunketFundsEntry(connection, {
			transType,
			amount,
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

		const balance = await computeJunketFundsBalance();
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
			return res.status(400).json({ message: 'Person in charge is required' });
		}

		const [existingRows] = await connection.execute(
			`SELECT TRANS_TYPE, AMOUNT, ACCOUNT_ID, ACCOUNT_LEDGER_ID
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

async function archiveLinkedRecordsOnRemove(connection, ledgerId, userId, dateNow) {
	const [rows] = await connection.execute(
		`SELECT ACCOUNT_LEDGER_ID FROM junket_funds_ledger WHERE IDNo = ? LIMIT 1`,
		[ledgerId]
	);
	const row = rows && rows[0];
	if (!row) return;
	await archiveLinkedAccountLedger(connection, row.ACCOUNT_LEDGER_ID, userId, dateNow);
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

module.exports = router;
