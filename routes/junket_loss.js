const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { buildTableExportXlsx, sendTableExportResponse } = require('../utils/ExcelExportService');
const { getAccountCashBalance } = require('../utils/junketCapitalTransfer');
const {
	toApiDate,
	getMonthEndCutoffRange,
	expandApiEndDateToMonthEnd,
} = require('../utils/monthEndCutoffRange');

function junketLossApiEndDate(endYmd) {
	if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
	const parts = String(endYmd).slice(0, 10).split('-').map(Number);
	const lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
	if (parts[2] === lastDayOfMonth - 1) {
		return expandApiEndDateToMonthEnd(endYmd);
	}
	return endYmd;
}

function normalizeJunketLossDateRange(fromDate, toDate) {
	let from = toApiDate(fromDate);
	let to = junketLossApiEndDate(toApiDate(toDate));

	if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
		const fallback = getMonthEndCutoffRange();
		from = fallback.startDate;
		to = fallback.endDateApi || junketLossApiEndDate(fallback.endDate);
	}

	if (from > to) {
		const swap = from;
		from = to;
		to = swap;
	}

	return { fromDate: from, toDate: to };
}

function parseOptionalId(value) {
	if (value === undefined || value === null || String(value).trim() === '') return null;
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePaymentType(value) {
	const n = parseInt(value, 10);
	return n === 1 || n === 2 ? n : null;
}

const JUNKET_LOSS_TRANS_LOSS = 1;
const JUNKET_LOSS_TRANS_RECOVERY = 2;

/** Form amount sign picks the type: negative = Loss, positive = Recovery. */
function junketLossTransactionFromInput(amount) {
	return Number(amount) < 0 ? JUNKET_LOSS_TRANS_LOSS : JUNKET_LOSS_TRANS_RECOVERY;
}

/** Loss rows are stored positive, Recovery rows negative, so SUM(AMOUNT) is always the net loss. */
function signedJunketLossAmount(amount, transaction) {
	const abs = Math.abs(Number(amount) || 0);
	return transaction === JUNKET_LOSS_TRANS_RECOVERY ? -abs : abs;
}

function parseProgramDate(value) {
	const raw = String(value || '').trim().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
	return raw;
}

function buildEncodedDtFromProgramDate(programDate) {
	const now = new Date();
	const parts = String(programDate).split('-').map(Number);
	return new Date(
		parts[0],
		parts[1] - 1,
		parts[2],
		now.getHours(),
		now.getMinutes(),
		now.getSeconds()
	);
}

router.get('/junket_loss', checkSession, function (req, res) {
	return res.redirect(301, '/loss_amount');
});

router.get('/loss_amount', checkSession, function (req, res) {
	const data = sessions(req, 'loss_amount');
	data.permissions = req.session.permissions;
	res.render('junket/junket_loss', data);
});

router.get('/loss_amount_total', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute(
			'SELECT COALESCE(SUM(AMOUNT), 0) AS TOTAL FROM junket_loss WHERE ACTIVE = 1'
		);
		res.json({ total: Number(rows[0] && rows[0].TOTAL) || 0 });
	} catch (error) {
		console.error('Error fetching junket loss total:', error);
		res.status(500).json({ message: 'Failed to fetch junket loss total' });
	}
});

router.get('/loss_amount_data', async (req, res) => {
	try {
		const { fromDate, toDate } = normalizeJunketLossDateRange(req.query.fromDate, req.query.toDate);

		const query = `
			SELECT
				jl.IDNo,
				jl.DESCRIPTION,
				jl.AMOUNT,
				jl.IN_CHARGE,
				jl.PROGRAM_DATE,
				jl.ACCOUNT_ID,
				jl.GUEST_ID,
				jl.PAYMENT_TYPE,
				jl.TRANSACTION,
				jl.LOSS_SETTLEMENT_ID,
				jl.ENCODED_BY,
				jl.ENCODED_DT,
				CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME) AS ENCODED_BY_NAME,
				NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(TRIM(ag.AGENT_CODE), ''), NULLIF(TRIM(ag.NAME), ''))), '') AS ACCOUNT_NAME,
				NULLIF(TRIM(ag.AGENT_CODE), '') AS ACCOUNT_CODE,
				NULLIF(TRIM(ag.NAME), '') AS ACCOUNT_HOLDER,
				NULLIF(TRIM(g.NAME), '') AS GUEST_NAME
			FROM junket_loss jl
			LEFT JOIN user_info ui ON ui.IDNo = jl.ENCODED_BY
			LEFT JOIN account a ON a.IDNo = jl.ACCOUNT_ID
			LEFT JOIN agent ag ON ag.IDNo = a.AGENT_ID
			LEFT JOIN guest g ON g.IDNo = jl.GUEST_ID
			WHERE jl.ACTIVE = 1
				AND jl.PROGRAM_DATE BETWEEN ? AND ?
			ORDER BY jl.PROGRAM_DATE DESC, jl.IDNo DESC
		`;

		const [result] = await pool.execute(query, [fromDate, toDate]);
		res.json(result);
	} catch (error) {
		console.error('Error fetching junket loss data:', error);
		res.status(500).json({ message: 'Failed to fetch junket loss data' });
	}
});

router.post('/add_loss_amount', checkSession, async (req, res) => {
	let connection;
	try {
		const {
			txtDescription,
			txtAmount,
			txtInCharge,
			txtProgramDate,
			txtAccountId,
			txtGuestId,
			txtPaymentType
		} = req.body;

		const programDate = parseProgramDate(txtProgramDate);
		const cleanAmount = String(txtAmount || '').replace(/,/g, '');
		const paymentType = parsePaymentType(txtPaymentType);
		const accountId = parseOptionalId(txtAccountId);
		const guestId = parseOptionalId(txtGuestId);

		if (
			!txtDescription ||
			!txtInCharge ||
			!programDate ||
			!Number(cleanAmount)
		) {
			return res.status(400).json({ message: 'Invalid payload' });
		}

		const encodedDt = buildEncodedDtFromProgramDate(programDate);
		const transaction = junketLossTransactionFromInput(cleanAmount);
		// Chip / Cash is required for a Loss, optional for a Recovery.
		if (transaction === JUNKET_LOSS_TRANS_LOSS && !paymentType) {
			return res.status(400).json({ message: 'Invalid payload' });
		}

		const amountAbs = Math.abs(Number(cleanAmount));
		const description = txtDescription.trim();
		const userId = req.session.user_id;
		const now = new Date();

		connection = await pool.getConnection();
		await connection.beginTransaction();

		// With an account: same as the Agent Portal Loss Amount, a "Deposit / Withdraw - Loss Amount" ledger
		// row moves the account balance (Loss = deposit, Recovery = withdraw) and carries the cash (NON_CASH = 1).
		let ledger = null;
		if (accountId) {
			ledger = await insertLossLedger(connection, { accountId, transaction, amount: amountAbs, remarks: description, userId, now });
			if (ledger.error) {
				await connection.rollback();
				return res.status(400).json({ message: ledger.error });
			}
		}

		await connection.execute(
			`INSERT INTO junket_loss (
				DESCRIPTION, AMOUNT, IN_CHARGE, PROGRAM_DATE, ACCOUNT_ID, GUEST_ID, PAYMENT_TYPE, NON_CASH, TRANSACTION,
				ACCOUNT_LEDGER_ID, ENCODED_BY, ENCODED_DT
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				description,
				signedJunketLossAmount(cleanAmount, transaction),
				txtInCharge.trim(),
				programDate,
				accountId,
				guestId,
				paymentType,
				ledger ? 1 : 0,
				transaction,
				ledger ? ledger.ledgerId : null,
				userId,
				encodedDt
			]
		);

		await connection.commit();
		if (ledger) await recordLossLedgerHistory(ledger, description, userId, now);

		res.json({ message: 'Saved successfully' });
	} catch (error) {
		if (connection) await connection.rollback().catch(() => {});
		console.error('Error inserting junket loss:', error);
		res.status(500).json({ message: 'Failed to save junket loss' });
	} finally {
		if (connection) connection.release();
	}
});

router.put('/loss_amount/:id', checkSession, async (req, res) => {
	// Same users as Add: everyone but PERMISSIONS 2.
	if (Number(req.session?.permissions) === 2) {
		return res.status(403).json({ message: 'Not authorized to edit loss amount.' });
	}
	let connection;
	try {
		const id = parseInt(req.params.id, 10);
		const {
			txtDescription,
			txtAmount,
			txtInCharge,
			txtProgramDate,
			txtAccountId,
			txtGuestId,
			txtPaymentType
		} = req.body;

		const programDate = parseProgramDate(txtProgramDate);
		const date_now = new Date();
		const cleanAmount = String(txtAmount || '').replace(/,/g, '');
		const paymentType = parsePaymentType(txtPaymentType);
		const accountId = parseOptionalId(txtAccountId);
		const guestId = parseOptionalId(txtGuestId);

		if (
			!id ||
			!txtDescription ||
			!txtInCharge ||
			!programDate ||
			!Number(cleanAmount)
		) {
			return res.status(400).json({ message: 'Invalid payload' });
		}

		if (await isJunketLossSettled(id)) {
			return res.status(409).json({ message: JUNKET_LOSS_SETTLED_LOCKED });
		}

		const [existingRows] = await pool.execute(
			`SELECT DESCRIPTION, ACCOUNT_ID, ACCOUNT_LEDGER_ID, PAYMENT_TYPE, GAME_ID, NON_CASH
			 FROM junket_loss WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1`,
			[id]
		);
		if (!existingRows.length) {
			return res.status(404).json({ message: 'Loss amount not found' });
		}
		const existing = existingRows[0];
		const transaction = junketLossTransactionFromInput(cleanAmount);
		const ledger = await fetchPortalLossLedger(existing.ACCOUNT_LEDGER_ID);

		// Chip / Cash is optional on a Recovery: left blank on a linked row, keep the row's own type.
		const savedPaymentType = paymentType || (ledger ? parsePaymentType(existing.PAYMENT_TYPE) : null);
		if (transaction === JUNKET_LOSS_TRANS_LOSS && !savedPaymentType) {
			return res.status(400).json({ message: 'Invalid payload' });
		}

		const amountAbs = Math.abs(Number(cleanAmount));
		const description = txtDescription.trim();
		const userId = req.session.user_id;
		// A row keeps / gets a ledger row when it has an account: an already linked row, or an account
		// newly picked here. Game Book rows (GAME_ID) and older rows whose account is unchanged stay as they are.
		const wantsLedger = !!accountId && (
			!!ledger || (existing.GAME_ID == null && Number(existing.ACCOUNT_ID || 0) !== accountId)
		);

		connection = await pool.getConnection();
		await connection.beginTransaction();

		let ledgerId = ledger ? ledger.IDNo : null;
		let nonCash = Number(existing.NON_CASH) || 0;
		let newLedger = null;

		if (wantsLedger && ledger) {
			const ledgerTxnId = lossLedgerTransactionId(transaction);
			if (ledgerTxnId === LOSS_LEDGER_WITHDRAW) {
				// Balance without this row's own ledger amount.
				let available = await getAccountCashBalance(connection, accountId);
				if (Number(ledger.ACCOUNT_ID) === accountId) {
					const oldAmount = parseFloat(ledger.AMOUNT) || 0;
					available += parseInt(ledger.TRANSACTION_ID, 10) === LOSS_LEDGER_WITHDRAW ? oldAmount : -oldAmount;
				}
				if (amountAbs > available + 0.009) {
					await connection.rollback();
					return res.status(400).json({ message: insufficientBalanceMessage(available) });
				}
			}
			// Keep the ledger's own remarks unless the description was changed here.
			const remarksChanged = description !== String(existing.DESCRIPTION || '').trim();
			await connection.execute(
				`UPDATE account_ledger
				 SET ACCOUNT_ID = ?, TRANSACTION_ID = ?, AMOUNT = ?, AUTO_REMARKS = ?,
				     REMARKS = ${remarksChanged ? '?' : 'REMARKS'}, EDITED_BY = ?, EDITED_DT = ?
				 WHERE IDNo = ? AND ACTIVE = 1`,
				[
					accountId,
					ledgerTxnId,
					amountAbs,
					lossLedgerAutoRemarks(ledgerTxnId),
					...(remarksChanged ? [description] : []),
					userId,
					date_now,
					ledger.IDNo
				]
			);
			const txnName = lossLedgerTransactionName(ledgerTxnId);
			await connection.execute(
				`UPDATE account_transaction_history
				 SET amount = ?, account_id = ?, transaction_id = ?, transaction_name = ?, direction = ?
				 WHERE ledger_id = ?`,
				[amountAbs, accountId, ledgerTxnId, txnName, txnName, ledger.IDNo]
			).catch((err) => console.error('account_transaction_history update failed:', err));
		} else if (wantsLedger) {
			newLedger = await insertLossLedger(connection, { accountId, transaction, amount: amountAbs, remarks: description, userId, now: date_now });
			if (newLedger.error) {
				await connection.rollback();
				return res.status(400).json({ message: newLedger.error });
			}
			ledgerId = newLedger.ledgerId;
			nonCash = 1;
		} else if (ledger) {
			// Account cleared: the ledger row goes, and the loss carries the cash itself again.
			await archiveLossLedger(connection, ledger.IDNo, userId, date_now);
			ledgerId = null;
			nonCash = 0;
		}

		await connection.execute(
			`UPDATE junket_loss
			 SET DESCRIPTION = ?, AMOUNT = ?, IN_CHARGE = ?, PROGRAM_DATE = ?,
				 ACCOUNT_ID = ?, GUEST_ID = ?, PAYMENT_TYPE = ?, TRANSACTION = ?, NON_CASH = ?, ACCOUNT_LEDGER_ID = ?,
				 EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[
				description,
				signedJunketLossAmount(cleanAmount, transaction),
				txtInCharge.trim(),
				programDate,
				accountId,
				guestId,
				savedPaymentType,
				transaction,
				nonCash,
				ledgerId,
				userId,
				date_now,
				id
			]
		);

		await connection.commit();
		if (newLedger) await recordLossLedgerHistory(newLedger, description, userId, date_now);

		res.json({ message: 'Updated successfully' });
	} catch (error) {
		if (connection) await connection.rollback().catch(() => {});
		console.error('Error updating junket loss:', error);
		res.status(500).json({ message: 'Failed to update junket loss' });
	} finally {
		if (connection) connection.release();
	}
});

router.put('/loss_amount/remove/:id', checkSession, async (req, res) => {
	if (Number(req.session?.permissions) === 2) {
		return res.status(403).json({ message: 'Not authorized to delete loss amount.' });
	}
	try {
		const id = parseInt(req.params.id, 10);
		const date_now = new Date();

		if (!id) return res.status(400).json({ message: 'Invalid ID' });
		if (await isJunketLossSettled(id)) {
			return res.status(409).json({ message: JUNKET_LOSS_SETTLED_LOCKED });
		}

		const [lossRows] = await pool.execute('SELECT ACCOUNT_LEDGER_ID FROM junket_loss WHERE IDNo = ? LIMIT 1', [id]);

		const query = `UPDATE junket_loss SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query, [0, req.session.user_id, date_now, id]);

		// Loss Amount with an account (Agent Portal or this form): its ledger row on the account goes with it.
		const portalLedger = await fetchPortalLossLedger(lossRows[0] && lossRows[0].ACCOUNT_LEDGER_ID);
		if (portalLedger) {
			await archiveLossLedger(pool, portalLedger.IDNo, req.session.user_id, date_now);
		}

		res.json({ message: 'Archived successfully' });
	} catch (error) {
		console.error('Error archiving junket loss:', error);
		res.status(500).json({ message: 'Failed to archive junket loss' });
	}
});

/** account_ledger TRANSACTION_ID of a Loss Amount ledger row: Loss = deposit, Recovery = withdraw (as in the Agent Portal). */
const LOSS_LEDGER_DEPOSIT = 1;
const LOSS_LEDGER_WITHDRAW = 2;

function lossLedgerTransactionId(transaction) {
	return transaction === JUNKET_LOSS_TRANS_LOSS ? LOSS_LEDGER_DEPOSIT : LOSS_LEDGER_WITHDRAW;
}

function lossLedgerTransactionName(ledgerTxnId) {
	return ledgerTxnId === LOSS_LEDGER_DEPOSIT ? 'DEPOSIT' : 'WITHDRAW';
}

function lossLedgerAutoRemarks(ledgerTxnId) {
	return ledgerTxnId === LOSS_LEDGER_DEPOSIT ? 'Deposit - Loss Amount' : 'Withdraw - Loss Amount';
}

function insufficientBalanceMessage(available) {
	return `Insufficient account balance. Available: ${available.toLocaleString('en-US')}.`;
}

/**
 * Adds the "Deposit / Withdraw - Loss Amount" ledger row on the account (same row the Agent Portal writes).
 * A withdraw (Recovery) must fit the account balance. Returns { ledgerId, ... } or { error }.
 */
async function insertLossLedger(connection, { accountId, transaction, amount, remarks, userId, now }) {
	const ledgerTxnId = lossLedgerTransactionId(transaction);
	const balanceBefore = await getAccountCashBalance(connection, accountId);
	if (ledgerTxnId === LOSS_LEDGER_WITHDRAW && amount > balanceBefore + 0.009) {
		return { error: insufficientBalanceMessage(balanceBefore) };
	}
	const [result] = await connection.execute(
		`INSERT INTO account_ledger (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, REMARKS, AUTO_REMARKS, ENCODED_BY, ENCODED_DT)
		 VALUES (?, ?, 2, 'ACCOUNT DETAILS', ?, ?, ?, ?, ?)`,
		[accountId, ledgerTxnId, amount, remarks || null, lossLedgerAutoRemarks(ledgerTxnId), userId, now]
	);
	return {
		ledgerId: result.insertId,
		accountId,
		ledgerTxnId,
		amount,
		balanceBefore,
		balanceAfter: balanceBefore + (ledgerTxnId === LOSS_LEDGER_DEPOSIT ? amount : -amount)
	};
}

/** Account history line for a new Loss Amount ledger row (after commit; a failure only logs). */
async function recordLossLedgerHistory(ledger, remarks, userId, now) {
	const name = lossLedgerTransactionName(ledger.ledgerTxnId);
	try {
		await pool.execute(
			`INSERT INTO account_transaction_history
			 (ledger_id, account_id, transaction_id, transaction_name, amount, balance_before, balance_after, remarks, transfer_account_id, direction, encoded_by, encoded_dt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
			[ledger.ledgerId, ledger.accountId, ledger.ledgerTxnId, name, ledger.amount, ledger.balanceBefore, ledger.balanceAfter, remarks || null, name, userId, now]
		);
	} catch (err) {
		console.error('account_transaction_history insert failed:', err);
	}
}

async function archiveLossLedger(db, ledgerId, userId, now) {
	await db.execute(
		'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1',
		[userId, now, ledgerId]
	);
	await db.execute('DELETE FROM account_transaction_history WHERE ledger_id = ?', [ledgerId])
		.catch((err) => console.error('account_transaction_history delete failed:', err));
}

const JUNKET_LOSS_SETTLED_LOCKED = 'This loss amount is already settled and can no longer be changed.';

/** Active "Withdraw / Deposit - Loss Amount" ledger row a Loss Amount (Agent Portal or with an account) is linked to. */
async function fetchPortalLossLedger(ledgerId) {
	const id = parseInt(ledgerId, 10);
	if (!id) return null;
	const [rows] = await pool.execute(
		'SELECT IDNo, ACCOUNT_ID, TRANSACTION_ID, AMOUNT FROM account_ledger WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
		[id]
	);
	return rows[0] || null;
}

/** True when the junket_loss row belongs to a Loss Amount settlement (locked). */
async function isJunketLossSettled(id) {
	const [rows] = await pool.execute('SELECT LOSS_SETTLEMENT_ID FROM junket_loss WHERE IDNo = ? LIMIT 1', [id]);
	return !!(rows.length && rows[0].LOSS_SETTLEMENT_ID != null);
}

/** Slip label per row: the account code (e.g. YC000); rows without an account group together. */
const SQL_LOSS_SETTLEMENT_GROUP = `COALESCE(NULLIF(TRIM(ag.AGENT_CODE), ''), 'No Account')`;

function formatSettlementYmd(ymd) {
	const p = String(ymd).split('-').map(Number);
	return `${p[1]}/${p[2]}/${p[0]}`;
}

function todayLocalYmd() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * SETTLE LOSS AMOUNT (Settlement (Loss Amount) modal → Save)
 * Settles every unsettled junket_loss row (Loss and Recovery) whose program date is within
 * fromDate..toDate: writes the net amount to junket_capital (DESCRIPTION = 'Loss Amount';
 * TRANSACTION_ID = 2 withdraw for a net loss, 1 deposit for a net recovery) and tags the rows
 * with LOSS_SETTLEMENT_ID.
 */
router.post('/loss_amount/settle', checkSession, async (req, res) => {
	const fromDate = parseProgramDate(req.body?.fromDate);
	const toDate = parseProgramDate(req.body?.toDate);
	if (!fromDate || !toDate || fromDate > toDate) {
		return res.status(400).json({ error: 'Select a valid Start and Finish date.' });
	}
	const expectedRaw = req.body?.expectedAmount;
	const expectedAmount = expectedRaw === undefined || expectedRaw === null || expectedRaw === ''
		? null
		: Number(expectedRaw);

	let connection;
	try {
		connection = await pool.getConnection();
		await connection.beginTransaction();

		const [lossRows] = await connection.execute(
			`SELECT IDNo, AMOUNT
			 FROM junket_loss
			 WHERE ACTIVE = 1
				AND LOSS_SETTLEMENT_ID IS NULL
				AND PROGRAM_DATE BETWEEN ? AND ?
			 FOR UPDATE`,
			[fromDate, toDate]
		);
		if (!lossRows.length) {
			await connection.rollback();
			return res.status(400).json({ error: 'Nothing to settle for the selected dates.' });
		}

		const amount = Math.round(lossRows.reduce((acc, r) => acc + (Number(r.AMOUNT) || 0), 0) * 100) / 100;

		if (expectedAmount !== null && Number.isFinite(expectedAmount) && Math.abs(expectedAmount - amount) >= 0.01) {
			await connection.rollback();
			return res.status(409).json({
				error: 'Loss amounts changed since the settlement was opened. Please review the new total.',
				amount
			});
		}
		const dateNow = new Date();
		const userId = req.session?.user_id ?? null;

		const [settleResult] = await connection.execute(
			`INSERT INTO junket_loss_settlement (DATE_FROM, DATE_TO, AMOUNT, ACTIVE, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, 1, ?, ?)`,
			[fromDate, toDate, amount, userId, dateNow]
		);
		const settlementId = settleResult.insertId;

		let capitalId = null;
		// Net loss withdraws from Company; a net recovery (loss money handed back) deposits into it.
		if (amount !== 0) {
			const [userRows] = await connection.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [userId]);
			const fullname = userRows.length ? userRows[0].FIRSTNAME || null : null;
			const remarks = `Loss amount settlement ${formatSettlementYmd(fromDate)} - ${formatSettlementYmd(toDate)}`;
			const [capitalResult] = await connection.execute(
				`INSERT INTO junket_capital
					(TRANSACTION_ID, FULLNAME, DESCRIPTION, AMOUNT, REMARKS, ACTIVE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE)
				 VALUES (?, ?, 'Loss Amount', ?, ?, 1, ?, ?, ?)`,
				[amount > 0 ? 2 : 1, fullname, Math.abs(amount), remarks, userId, dateNow, todayLocalYmd()]
			);
			capitalId = capitalResult.insertId;
			await connection.execute('UPDATE junket_loss_settlement SET CAPITAL_ID = ? WHERE IDNo = ?', [capitalId, settlementId]);
		}

		const ids = lossRows.map((r) => r.IDNo);
		await connection.execute(
			`UPDATE junket_loss SET LOSS_SETTLEMENT_ID = ? WHERE IDNo IN (${ids.map(() => '?').join(',')})`,
			[settlementId, ...ids]
		);

		await connection.commit();
		res.json({ success: true, settlement_id: settlementId, capital_id: capitalId, amount, count: ids.length });
	} catch (err) {
		if (connection) {
			try { await connection.rollback(); } catch (rollbackErr) { /* ignore */ }
		}
		console.error('Error settling loss amount:', err);
		res.status(500).json({ error: 'Failed to settle loss amount' });
	} finally {
		if (connection) connection.release();
	}
});

/** View one saved Loss Amount settlement (Authorized Master Account ledger), grouped per account code. */
router.get('/junket_loss_settlement/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

		const [settleRows] = await pool.execute(
			`SELECT IDNo,
				DATE_FORMAT(DATE_FROM, '%Y-%m-%d') AS DATE_FROM,
				DATE_FORMAT(DATE_TO, '%Y-%m-%d') AS DATE_TO,
				AMOUNT, CAPITAL_ID, ENCODED_DT
			 FROM junket_loss_settlement
			 WHERE IDNo = ? AND ACTIVE = 1
			 LIMIT 1`,
			[id]
		);
		if (!settleRows.length) return res.status(404).json({ error: 'Settlement not found' });

		const [groupRows] = await pool.execute(
			`SELECT ${SQL_LOSS_SETTLEMENT_GROUP} AS NAME, SUM(jl.AMOUNT) AS AMOUNT
			 FROM junket_loss jl
			 LEFT JOIN account a ON a.IDNo = jl.ACCOUNT_ID
			 LEFT JOIN agent ag ON ag.IDNo = a.AGENT_ID
			 WHERE jl.LOSS_SETTLEMENT_ID = ? AND jl.ACTIVE = 1
			 GROUP BY ${SQL_LOSS_SETTLEMENT_GROUP}
			 ORDER BY NAME ASC`,
			[id]
		);

		const settlement = settleRows[0];
		res.json({
			id: settlement.IDNo,
			date_from: settlement.DATE_FROM,
			date_to: settlement.DATE_TO,
			amount: Number(settlement.AMOUNT) || 0,
			capital_id: settlement.CAPITAL_ID,
			settled_at: settlement.ENCODED_DT,
			// Loss is a cost (negative on the slip); recoveries net it back.
			mains: groupRows.map((r) => ({ name: r.NAME, amount: -(Number(r.AMOUNT) || 0) })),
			total: -(Number(settlement.AMOUNT) || 0)
		});
	} catch (err) {
		console.error('Error loading loss amount settlement:', err);
		res.status(500).json({ error: 'Failed to load settlement' });
	}
});

/** Client omits ACTION (last column). */
router.post('/loss_amount/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename, totals } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'junketLoss',
			// the page total skips settled entries, so the client sends it instead of a SUM formula
			totals: totals && typeof totals === 'object' ? totals : undefined,
			sheetName: 'Loss Amount',
			headers,
			rows,
			filename: filename || 'LossAmount-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('loss_amount/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

module.exports = router;
