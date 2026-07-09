/**
 * Credit transaction helpers — dual-write alongside account_ledger.
 * credit_transaction = intended source of truth; ledger remains mirrored for now.
 *
 * CREDIT_ACTION values (UI labels):
 *   Transfer      = return thru deposit
 *   Buy-in        = game credit
 *   Cash-in       = return thru cash
 *   Cash-out      = cash credit
 *   Chips Return  = chips return thru credit (ledger 1-4)
 *
 * CREDIT_SOURCE (for returns / buy-in tracking):
 *   CREDIT = cash credit bucket
 *   BUYIN  = game credit bucket
 */

const { ensureCreditSchema } = require('./ensureCreditSchema');

const CREDIT_ACTIONS = {
	TRANSFER: 'Transfer',
	BUY_IN: 'Buy-in',
	CASH_IN: 'Cash-in',
	CASH_OUT: 'Cash-out',
	CHIPS_RETURN: 'Chips Return'
};

const CREDIT_SOURCES = {
	CREDIT: 'CREDIT',
	BUYIN: 'BUYIN'
};

let ensurePromise = null;

function ensureCreditTable(pool) {
	if (!ensurePromise) {
		ensurePromise = ensureCreditSchema(pool).catch((err) => {
			ensurePromise = null;
			throw err;
		});
	}
	return ensurePromise;
}

function normalizeGuestId(raw) {
	const n = parseInt(raw, 10);
	return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeCreditAction(raw) {
	const v = String(raw || '').trim();
	const lower = v.toLowerCase().replace(/\s+/g, ' ');
	if (
		v === CREDIT_ACTIONS.TRANSFER ||
		lower === 'transfer' ||
		lower === 'return_deposit' ||
		lower === 'return thru deposit'
	) {
		return CREDIT_ACTIONS.TRANSFER;
	}
	if (
		v === CREDIT_ACTIONS.BUY_IN ||
		lower === 'buy-in' ||
		lower === 'buy in' ||
		lower === 'game_credit' ||
		lower === 'game credit'
	) {
		return CREDIT_ACTIONS.BUY_IN;
	}
	if (
		v === CREDIT_ACTIONS.CASH_IN ||
		lower === 'cash-in' ||
		lower === 'cash in' ||
		lower === 'return_cash' ||
		lower === 'return thru cash'
	) {
		return CREDIT_ACTIONS.CASH_IN;
	}
	if (
		v === CREDIT_ACTIONS.CASH_OUT ||
		lower === 'cash-out' ||
		lower === 'cash out' ||
		lower === 'cash_credit' ||
		lower === 'cash credit'
	) {
		return CREDIT_ACTIONS.CASH_OUT;
	}
	if (
		v === CREDIT_ACTIONS.CHIPS_RETURN ||
		lower === 'chips return' ||
		lower === 'chips_return'
	) {
		return CREDIT_ACTIONS.CHIPS_RETURN;
	}
	return null;
}

function normalizeCreditSource(raw, creditAction) {
	const v = String(raw || '').trim().toUpperCase();
	if (v === CREDIT_SOURCES.CREDIT || v === 'CASH') return CREDIT_SOURCES.CREDIT;
	if (v === CREDIT_SOURCES.BUYIN || v === 'GAME' || v === 'BUY-IN') return CREDIT_SOURCES.BUYIN;
	const action = normalizeCreditAction(creditAction);
	if (action === CREDIT_ACTIONS.BUY_IN || action === CREDIT_ACTIONS.CHIPS_RETURN) {
		return CREDIT_SOURCES.BUYIN;
	}
	if (action === CREDIT_ACTIONS.CASH_OUT) return CREDIT_SOURCES.CREDIT;
	// Transfer / Cash-in default to cash credit bucket when source not provided
	if (action === CREDIT_ACTIONS.TRANSFER || action === CREDIT_ACTIONS.CASH_IN) {
		return CREDIT_SOURCES.CREDIT;
	}
	return null;
}

function mapLedgerToCreditAction(transactionId, transactionType, creditActionHint) {
	const fromHint = normalizeCreditAction(creditActionHint);
	if (fromHint) return fromHint;
	const tid = String(transactionId);
	const ttype = String(transactionType == null ? '' : transactionType);
	if (tid === '3' && (ttype === '' || ttype === '3')) return CREDIT_ACTIONS.CASH_OUT;
	if (tid === '12') return CREDIT_ACTIONS.TRANSFER;
	if (tid === '11') return CREDIT_ACTIONS.CASH_IN;
	if (tid === '10') return CREDIT_ACTIONS.BUY_IN;
	if (tid === '1' && ttype === '4') return CREDIT_ACTIONS.CHIPS_RETURN;
	return CREDIT_ACTIONS.CASH_OUT;
}

function directionForAction(creditAction) {
	const action = normalizeCreditAction(creditAction) || creditAction;
	if (action === CREDIT_ACTIONS.CASH_OUT || action === CREDIT_ACTIONS.BUY_IN) return 'issue';
	return 'return';
}

function transactionInfoForAction(creditAction) {
	const action = normalizeCreditAction(creditAction);
	if (action === CREDIT_ACTIONS.CASH_OUT) return '3-3';
	if (action === CREDIT_ACTIONS.BUY_IN) return '10-3';
	if (action === CREDIT_ACTIONS.CASH_IN) return '11-3';
	if (action === CREDIT_ACTIONS.TRANSFER) return '12-3';
	if (action === CREDIT_ACTIONS.CHIPS_RETURN) return '1-4';
	return '3-3';
}

function transactionDescForHistory(creditAction, creditSource) {
	const action = normalizeCreditAction(creditAction);
	if (action !== CREDIT_ACTIONS.TRANSFER && action !== CREDIT_ACTIONS.CASH_IN) return null;
	const source = normalizeCreditSource(creditSource, action);
	if (source === CREDIT_SOURCES.BUYIN) return 'RETURN_SOURCE:BUYIN';
	return 'RETURN_SOURCE:CREDIT';
}

function normalizeProgramDate(raw) {
	const v = String(raw || '').trim();
	if (!v) return null;
	// Accept YYYY-MM-DD only (date input / ISO date prefix)
	const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
	return m ? m[1] : null;
}

function normalizeGuarantor(raw) {
	const v = String(raw || '').trim();
	if (!v) return null;
	return v.length > 255 ? v.slice(0, 255) : v;
}

/**
 * Insert a row into `credit_transaction`. Auto-creates table if missing.
 * @returns {Promise<number|null>} insertId
 */
async function insertCreditRecord(pool, {
	accountId,
	guestId = null,
	creditAction,
	creditSource = null,
	amount,
	balanceAfter = null,
	ledgerId = null,
	gameId = null,
	programDate = null,
	guarantor = null,
	remarks = null,
	encodedBy = null,
	encodedDt = null
}) {
	const action = normalizeCreditAction(creditAction);
	if (!action) return null;
	const acct = parseInt(accountId, 10);
	if (!Number.isInteger(acct) || acct <= 0) return null;
	const amt = parseFloat(String(amount || '0').replace(/,/g, '')) || 0;
	if (amt <= 0) return null;

	const direction = directionForAction(action);
	const source = normalizeCreditSource(creditSource, action);
	const when = encodedDt || new Date();
	const programDateVal = normalizeProgramDate(programDate);
	const guarantorVal = normalizeGuarantor(guarantor);

	try {
		await ensureCreditTable(pool);
		const ledgerIdVal = ledgerId != null ? parseInt(ledgerId, 10) || null : null;
		if (ledgerIdVal) {
			const [existing] = await pool.execute(
				`SELECT IDNo FROM credit_transaction WHERE LEDGER_ID = ? LIMIT 1`,
				[ledgerIdVal]
			);
			if (existing && existing.length) {
				return existing[0].IDNo;
			}
		}
		const [result] = await pool.execute(
			`INSERT INTO credit_transaction
				(ACCOUNT_ID, GUEST_ID, CREDIT_ACTION, CREDIT_SOURCE, DIRECTION, AMOUNT, BALANCE_AFTER, LEDGER_ID, GAME_ID, PROGRAM_DATE, GUARANTOR, REMARKS, ACTIVE, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			[
				acct,
				normalizeGuestId(guestId),
				action,
				source,
				direction,
				amt,
				balanceAfter != null ? Number(balanceAfter) : null,
				ledgerIdVal,
				gameId != null ? parseInt(gameId, 10) || null : null,
				programDateVal,
				guarantorVal,
				remarks || null,
				encodedBy != null ? encodedBy : null,
				when
			]
		);
		return result && result.insertId ? result.insertId : null;
	} catch (err) {
		// Unique LEDGER_ID race: treat as already inserted.
		if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) && ledgerId != null) {
			try {
				const [existing] = await pool.execute(
					`SELECT IDNo FROM credit_transaction WHERE LEDGER_ID = ? LIMIT 1`,
					[parseInt(ledgerId, 10)]
				);
				if (existing && existing.length) return existing[0].IDNo;
			} catch (_) { /* ignore */ }
		}
		console.error('[credit] insert failed:', err.message || err);
		return null;
	}
}

function getCreditDataBreakdownSql() {
	return `
		SELECT
			account.IDNo AS ACCOUNT_ID,
			agent.IDNo AS AGENT_ID,
			agent.AGENT_CODE AS AGENT_CODE,
			agent.NAME AS AGENT_NAME,
			ROUND(GREATEST(0, COALESCE(bal.BALANCE_CREDIT, 0)), 0) AS BALANCE_CREDIT,
			ROUND(GREATEST(0, COALESCE(bal.BALANCE_BUYIN, 0)), 0) AS BALANCE_BUYIN,
			ROUND(
				GREATEST(0, COALESCE(bal.BALANCE_CREDIT, 0)) + GREATEST(0, COALESCE(bal.BALANCE_BUYIN, 0)),
				0
			) AS TOTAL_AMOUNT
		FROM account
		JOIN agent ON agent.IDNo = account.AGENT_ID
		INNER JOIN (
			SELECT
				ct.ACCOUNT_ID,
				SUM(CASE
					WHEN ct.CREDIT_ACTION = 'Cash-out'
						OR (ct.DIRECTION = 'issue' AND COALESCE(ct.CREDIT_SOURCE, 'CREDIT') = 'CREDIT' AND ct.CREDIT_ACTION NOT IN ('Buy-in', 'Chips Return'))
						THEN ct.AMOUNT
					WHEN ct.DIRECTION = 'return' AND COALESCE(ct.CREDIT_SOURCE, 'CREDIT') = 'CREDIT'
						THEN -ct.AMOUNT
					ELSE 0
				END) AS BALANCE_CREDIT,
				SUM(CASE
					WHEN ct.CREDIT_ACTION = 'Buy-in'
						OR (ct.DIRECTION = 'issue' AND ct.CREDIT_SOURCE = 'BUYIN')
						THEN ct.AMOUNT
					WHEN ct.DIRECTION = 'return' AND (
						ct.CREDIT_SOURCE = 'BUYIN' OR ct.CREDIT_ACTION = 'Chips Return'
					)
						THEN -ct.AMOUNT
					ELSE 0
				END) AS BALANCE_BUYIN
			FROM credit_transaction ct
			WHERE ct.ACTIVE = 1
			GROUP BY ct.ACCOUNT_ID
		) bal ON bal.ACCOUNT_ID = account.IDNo
		WHERE account.ACTIVE = 1
		  AND agent.ACTIVE = 1
		  AND (
			GREATEST(0, COALESCE(bal.BALANCE_CREDIT, 0)) + GREATEST(0, COALESCE(bal.BALANCE_BUYIN, 0))
		  ) <> 0
		ORDER BY agent.AGENT_CODE ASC
	`;
}

function getCreditGrandTotalSql() {
	return `
		SELECT COALESCE(SUM(t.TOTAL_AMOUNT), 0) AS JUNKET_CREDIT
		FROM (
			SELECT
				ROUND(
					GREATEST(0, COALESCE(bal.BALANCE_CREDIT, 0)) + GREATEST(0, COALESCE(bal.BALANCE_BUYIN, 0)),
					0
				) AS TOTAL_AMOUNT
			FROM account
			JOIN agent ON agent.IDNo = account.AGENT_ID
			INNER JOIN (
				SELECT
					ct.ACCOUNT_ID,
					SUM(CASE
						WHEN ct.CREDIT_ACTION = 'Cash-out'
							OR (ct.DIRECTION = 'issue' AND COALESCE(ct.CREDIT_SOURCE, 'CREDIT') = 'CREDIT' AND ct.CREDIT_ACTION NOT IN ('Buy-in', 'Chips Return'))
							THEN ct.AMOUNT
						WHEN ct.DIRECTION = 'return' AND COALESCE(ct.CREDIT_SOURCE, 'CREDIT') = 'CREDIT'
							THEN -ct.AMOUNT
						ELSE 0
					END) AS BALANCE_CREDIT,
					SUM(CASE
						WHEN ct.CREDIT_ACTION = 'Buy-in'
							OR (ct.DIRECTION = 'issue' AND ct.CREDIT_SOURCE = 'BUYIN')
							THEN ct.AMOUNT
						WHEN ct.DIRECTION = 'return' AND (
							ct.CREDIT_SOURCE = 'BUYIN' OR ct.CREDIT_ACTION = 'Chips Return'
						)
							THEN -ct.AMOUNT
						ELSE 0
					END) AS BALANCE_BUYIN
				FROM credit_transaction ct
				WHERE ct.ACTIVE = 1
				GROUP BY ct.ACCOUNT_ID
			) bal ON bal.ACCOUNT_ID = account.IDNo
			WHERE account.ACTIVE = 1
			  AND agent.ACTIVE = 1
			  AND (
				GREATEST(0, COALESCE(bal.BALANCE_CREDIT, 0)) + GREATEST(0, COALESCE(bal.BALANCE_BUYIN, 0))
			  ) <> 0
		) t
	`;
}

function getCreditHistorySql() {
	return `
		SELECT
			COALESCE(ct.LEDGER_ID, ct.IDNo) AS IDNo,
			ct.IDNo AS CREDIT_TXN_ID,
			ct.LEDGER_ID,
			ct.ACCOUNT_ID,
			ct.GUEST_ID,
			ct.GAME_ID,
			ct.AMOUNT,
			ct.REMARKS,
			ct.ENCODED_DT,
			ct.CREDIT_ACTION,
			ct.CREDIT_SOURCE,
			ct.DIRECTION,
			DATE_FORMAT(ct.PROGRAM_DATE, '%Y-%m-%d') AS PROGRAM_DATE,
			ct.GUARANTOR,
			agent.NAME AS AGENT_NAME,
			agent.AGENT_CODE AS AGENT_CODE,
			COALESCE(NULLIF(TRIM(guest.NAME), ''), NULL) AS GUEST_NAME,
			CASE ct.CREDIT_ACTION
				WHEN 'Cash-out' THEN '3-3'
				WHEN 'Buy-in' THEN '10-3'
				WHEN 'Cash-in' THEN '11-3'
				WHEN 'Transfer' THEN '12-3'
				WHEN 'Chips Return' THEN '1-4'
				ELSE '3-3'
			END AS TRANSACTION_INFO,
			CASE
				WHEN ct.CREDIT_ACTION IN ('Transfer', 'Cash-in') AND ct.CREDIT_SOURCE = 'BUYIN' THEN 'RETURN_SOURCE:BUYIN'
				WHEN ct.CREDIT_ACTION IN ('Transfer', 'Cash-in') THEN 'RETURN_SOURCE:CREDIT'
				ELSE NULL
			END AS TRANSACTION_DESC
		FROM credit_transaction ct
		JOIN account ON account.IDNo = ct.ACCOUNT_ID
		JOIN agent ON agent.IDNo = account.AGENT_ID
		LEFT JOIN guest ON guest.IDNo = ct.GUEST_ID
		WHERE ct.ACTIVE = 1
		ORDER BY ct.ENCODED_DT DESC, ct.IDNo DESC
	`;
}

/** Total Credit tab: issue rows only (Buy-in + Cash-out) — per transaction, not per account. */
function getCreditIssueTransactionsSql() {
	return `
		SELECT
			COALESCE(ct.LEDGER_ID, ct.IDNo) AS IDNo,
			ct.IDNo AS CREDIT_TXN_ID,
			ct.LEDGER_ID,
			ct.ACCOUNT_ID,
			ct.GUEST_ID,
			ct.GAME_ID,
			ct.AMOUNT,
			ct.REMARKS,
			ct.ENCODED_DT,
			ct.CREDIT_ACTION,
			ct.CREDIT_SOURCE,
			ct.DIRECTION,
			DATE_FORMAT(ct.PROGRAM_DATE, '%Y-%m-%d') AS PROGRAM_DATE,
			ct.GUARANTOR,
			agent.IDNo AS AGENT_ID,
			agent.NAME AS AGENT_NAME,
			agent.AGENT_CODE AS AGENT_CODE,
			COALESCE(NULLIF(TRIM(guest.NAME), ''), NULL) AS GUEST_NAME,
			CASE ct.CREDIT_ACTION
				WHEN 'Cash-out' THEN '3-3'
				WHEN 'Buy-in' THEN '10-3'
				ELSE '3-3'
			END AS TRANSACTION_INFO
		FROM credit_transaction ct
		JOIN account ON account.IDNo = ct.ACCOUNT_ID
		JOIN agent ON agent.IDNo = account.AGENT_ID
		LEFT JOIN guest ON guest.IDNo = ct.GUEST_ID
		WHERE ct.ACTIVE = 1
		  AND ct.CREDIT_ACTION IN ('Buy-in', 'Cash-out')
		ORDER BY ct.ENCODED_DT DESC, ct.IDNo DESC
	`;
}

async function softDeleteCreditByLedgerId(pool, ledgerId, editedBy = null, editedDt = null) {
	const id = parseInt(ledgerId, 10);
	if (!Number.isInteger(id) || id <= 0) return false;
	try {
		await ensureCreditTable(pool);
		await pool.execute(
			`UPDATE credit_transaction
			 SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
			 WHERE LEDGER_ID = ? AND ACTIVE = 1`,
			[editedBy != null ? editedBy : null, editedDt || new Date(), id]
		);
		return true;
	} catch (err) {
		console.error('[credit] soft-delete by ledger failed:', err.message || err);
		return false;
	}
}

async function updateCreditRemarksByLedgerId(pool, ledgerId, remarks, editedBy = null, editedDt = null) {
	const id = parseInt(ledgerId, 10);
	if (!Number.isInteger(id) || id <= 0) return false;
	try {
		await ensureCreditTable(pool);
		await pool.execute(
			`UPDATE credit_transaction
			 SET REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?
			 WHERE LEDGER_ID = ? AND ACTIVE = 1`,
			[remarks || null, editedBy != null ? editedBy : null, editedDt || new Date(), id]
		);
		return true;
	} catch (err) {
		console.error('[credit] remarks update by ledger failed:', err.message || err);
		return false;
	}
}

/** Ledger / game_record remarks for Buy-in (remarks + Guarantor: …). */
function buildBuyinLedgerCreditRemarks(creditRemarks, creditGuarantor, fallback) {
	const parts = [];
	const r = (creditRemarks || '').toString().trim();
	const g = (creditGuarantor || '').toString().trim();
	if (r) parts.push(r);
	if (g) parts.push('Guarantor: ' + g);
	if (parts.length) return parts.join(' | ');
	return fallback || null;
}

/** PROGRAM_DATE YYYY-MM-DD → local midnight Date for game_record.TRADING_DATE. */
function programDateToTradingDate(ymd) {
	const normalized = normalizeProgramDate(ymd);
	if (!normalized) return null;
	const parts = normalized.split('-').map((n) => parseInt(n, 10));
	if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
	const dt = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
	if (dt.getFullYear() !== parts[0] || dt.getMonth() !== parts[1] - 1 || dt.getDate() !== parts[2]) {
		return null;
	}
	return dt;
}

/** Keep NN/CC ratio when Buy-in total amount changes. */
function redistributeBuyinChips(nn, cc, newTotal) {
	const oldNn = Number(nn) || 0;
	const oldCc = Number(cc) || 0;
	const oldTotal = oldNn + oldCc;
	const total = Math.abs(Number(newTotal) || 0);
	if (total <= 0) return { nn: 0, cc: 0 };
	if (oldTotal <= 0) return { nn: total, cc: 0 };
	if (oldCc === 0) return { nn: total, cc: 0 };
	if (oldNn === 0) return { nn: 0, cc: total };
	const newNn = Math.round((oldNn / oldTotal) * total);
	return { nn: newNn, cc: total - newNn };
}

/**
 * When editing a Buy-in credit row, mirror Program Date / Guest / Amount / Remarks
 * onto the linked game_list + credit buy-in game_record rows (TRANSACTION = 3).
 */
async function syncBuyinGameOnCreditEdit(pool, creditRow, fields, editedBy, editedDt) {
	const gameId = creditRow && creditRow.GAME_ID != null ? parseInt(creditRow.GAME_ID, 10) : null;
	if (!gameId || !Number.isInteger(gameId) || gameId <= 0) return;

	const action = normalizeCreditAction(creditRow.CREDIT_ACTION);
	if (action !== CREDIT_ACTIONS.BUY_IN) return;

	const when = editedDt || new Date();
	const editor = editedBy != null ? editedBy : null;
	const programDate = normalizeProgramDate(fields && fields.programDate);
	const guestId = normalizeGuestId(fields && (fields.guestId != null ? fields.guestId : fields.guest_id));
	const guarantor = normalizeGuarantor(fields && fields.guarantor);
	let remarks = fields && fields.remarks != null ? String(fields.remarks) : '';
	if (remarks.length > 500) remarks = remarks.slice(0, 500);
	let newAmount = null;
	if (fields && fields.amount != null && String(fields.amount).trim() !== '') {
		newAmount = Math.abs(parseFloat(String(fields.amount).replace(/,/g, '')));
		if (!Number.isFinite(newAmount) || newAmount <= 0) newAmount = null;
	}
	const oldAmount = Math.abs(parseFloat(creditRow.AMOUNT) || 0);
	const encodedDt = creditRow.ENCODED_DT;
	const gameRemarks = buildBuyinLedgerCreditRemarks(remarks, guarantor, `Buy-in Game: ${gameId}`);

	try {
		const gameSets = [];
		const gameParams = [];
		if (programDate) {
			gameSets.push('PROGRAM_DATE = ?');
			gameParams.push(programDate);
		}
		if (guestId != null || (fields && (fields.guestId != null || fields.guest_id != null))) {
			gameSets.push('GUEST_ID = ?');
			gameParams.push(guestId);
		}
		if (gameSets.length) {
			gameSets.push('EDITED_BY = ?', 'EDITED_DT = ?');
			gameParams.push(editor, when, gameId);
			await pool.execute(
				`UPDATE game_list SET ${gameSets.join(', ')} WHERE IDNo = ? AND ACTIVE != 0`,
				gameParams
			);
		}

		if (programDate) {
			const tradingDate = programDateToTradingDate(programDate);
			if (tradingDate) {
				await pool.execute(
					`UPDATE game_record SET TRADING_DATE = ? WHERE GAME_ID = ? AND ACTIVE = 1`,
					[tradingDate, gameId]
				);
			}
		}

		if (oldAmount > 0 && encodedDt) {
			const [recs] = await pool.execute(
				`SELECT IDNo, CAGE_TYPE, NN_CHIPS, CC_CHIPS
				 FROM game_record
				 WHERE GAME_ID = ?
				   AND ACTIVE = 1
				   AND CAGE_TYPE IN (1, 3)
				   AND TRANSACTION = 3
				   AND (NN_CHIPS + CC_CHIPS) = ?
				   AND ENCODED_DT = ?`,
				[gameId, oldAmount, encodedDt]
			);

			if (recs && recs.length) {
				const amountToApply = newAmount != null ? newAmount : oldAmount;
				for (const rec of recs) {
					const chips = redistributeBuyinChips(rec.NN_CHIPS, rec.CC_CHIPS, amountToApply);
					if (Number(rec.CAGE_TYPE) === 1) {
						await pool.execute(
							`UPDATE game_record
							 SET NN_CHIPS = ?, CC_CHIPS = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?
							 WHERE IDNo = ? AND ACTIVE = 1`,
							[chips.nn, chips.cc, gameRemarks, editor, when, rec.IDNo]
						);
					} else {
						await pool.execute(
							`UPDATE game_record
							 SET NN_CHIPS = ?, CC_CHIPS = ?, EDITED_BY = ?, EDITED_DT = ?
							 WHERE IDNo = ? AND ACTIVE = 1`,
							[chips.nn, chips.cc, editor, when, rec.IDNo]
						);
					}
				}
			} else if (gameRemarks) {
				// Amount/ENCODED_DT match missed (legacy) — still refresh remarks on credit buy-in rows for this game
				await pool.execute(
					`UPDATE game_record
					 SET REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?
					 WHERE GAME_ID = ? AND ACTIVE = 1 AND CAGE_TYPE = 1 AND TRANSACTION = 3
					   AND (NN_CHIPS + CC_CHIPS) = ?`,
					[gameRemarks, editor, when, gameId, oldAmount]
				);
			}
		}
	} catch (syncErr) {
		console.error('[credit] buy-in game sync failed:', syncErr.message || syncErr);
	}
}

/** Update credit_transaction fields (+ mirror amount/remarks to ledger; sync Buy-in game rows). */
async function updateCreditFieldsByLedgerId(pool, ledgerId, fields, editedBy = null, editedDt = null) {
	const id = parseInt(ledgerId, 10);
	if (!Number.isInteger(id) || id <= 0) return false;
	const programDate = normalizeProgramDate(fields && fields.programDate);
	const guarantor = normalizeGuarantor(fields && fields.guarantor);
	const guestId = normalizeGuestId(fields && (fields.guestId != null ? fields.guestId : fields.guest_id));
	let remarks = fields && fields.remarks != null ? String(fields.remarks) : '';
	if (remarks.length > 500) remarks = remarks.slice(0, 500);
	let amount = null;
	if (fields && fields.amount != null && String(fields.amount).trim() !== '') {
		amount = Math.abs(parseFloat(String(fields.amount).replace(/,/g, '')));
		if (!Number.isFinite(amount) || amount <= 0) return false;
	}
	const when = editedDt || new Date();
	try {
		await ensureCreditTable(pool);
		const [existingRows] = await pool.execute(
			`SELECT IDNo, LEDGER_ID, GAME_ID, CREDIT_ACTION, AMOUNT, ENCODED_DT, REMARKS, GUARANTOR, GUEST_ID, PROGRAM_DATE
			 FROM credit_transaction
			 WHERE ACTIVE = 1 AND (LEDGER_ID = ? OR IDNo = ?)
			 LIMIT 1`,
			[id, id]
		);
		const creditRow = existingRows && existingRows[0] ? existingRows[0] : null;
		if (!creditRow) return false;

		const [result] = await pool.execute(
			`UPDATE credit_transaction
			 SET PROGRAM_DATE = ?,
			     GUARANTOR = ?,
			     REMARKS = ?,
			     GUEST_ID = ?,
			     AMOUNT = COALESCE(?, AMOUNT),
			     EDITED_BY = ?,
			     EDITED_DT = ?
			 WHERE ACTIVE = 1 AND (LEDGER_ID = ? OR IDNo = ?)`,
			[
				programDate,
				guarantor,
				remarks || null,
				guestId,
				amount,
				editedBy != null ? editedBy : null,
				when,
				id,
				id
			]
		);
		if (!result || result.affectedRows === 0) return false;

		const isBuyIn = normalizeCreditAction(creditRow.CREDIT_ACTION) === CREDIT_ACTIONS.BUY_IN;
		const ledgerIdVal = creditRow.LEDGER_ID != null ? parseInt(creditRow.LEDGER_ID, 10) : id;
		const ledgerRemarks = isBuyIn
			? buildBuyinLedgerCreditRemarks(
				remarks,
				guarantor,
				creditRow.GAME_ID ? `Buy-in Game: ${creditRow.GAME_ID}` : null
			)
			: (remarks || null);

		try {
			if (amount != null) {
				await pool.execute(
					`UPDATE account_ledger
					 SET AMOUNT = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?
					 WHERE IDNo = ? AND ACTIVE = 1`,
					[amount, ledgerRemarks, editedBy != null ? editedBy : null, when, ledgerIdVal]
				);
			} else {
				await pool.execute(
					`UPDATE account_ledger SET REMARKS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1`,
					[ledgerRemarks, editedBy != null ? editedBy : null, when, ledgerIdVal]
				);
			}
		} catch (ledgerErr) {
			console.error('[credit] ledger mirror failed:', ledgerErr.message || ledgerErr);
		}

		if (isBuyIn) {
			await syncBuyinGameOnCreditEdit(pool, creditRow, fields, editedBy, when);
		}

		return true;
	} catch (err) {
		console.error('[credit] fields update by ledger failed:', err.message || err);
		return false;
	}
}

module.exports = {
	CREDIT_ACTIONS,
	CREDIT_SOURCES,
	normalizeGuestId,
	normalizeCreditAction,
	normalizeCreditSource,
	normalizeProgramDate,
	normalizeGuarantor,
	mapLedgerToCreditAction,
	directionForAction,
	transactionInfoForAction,
	transactionDescForHistory,
	insertCreditRecord,
	ensureCreditTable,
	getCreditDataBreakdownSql,
	getCreditGrandTotalSql,
	getCreditHistorySql,
	getCreditIssueTransactionsSql,
	softDeleteCreditByLedgerId,
	updateCreditRemarksByLedgerId,
	updateCreditFieldsByLedgerId
};
