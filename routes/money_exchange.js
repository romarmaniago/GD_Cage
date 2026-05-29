const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

/** Super Admin only — same as elsewhere (`permissions === 0`). */
function requireSuperAdmin(req, res, next) {
	const p = req.session.permissions;
	if (p !== 0 && p !== '0') {
		return res.status(403).send('Forbidden');
	}
	next();
}

/** Legacy URL → money exchange page */
router.get('/others', checkSession, (req, res) => {
	res.redirect(301, '/money_exchange');
});

router.get('/money_exchange', checkSession, async (req, res) => {
	const data = sessions(req, 'money_exchange');
	data.permissions = req.session.permissions;
	try {
		const [rows] = await pool.execute(
			`SELECT ID AS id, CODE AS code, NAME AS name
			 FROM currency_master
			 WHERE ACTIVE = 1
			 ORDER BY SORT_ORDER ASC, CODE ASC`
		);
		data.currencies = rows || [];
	} catch (err) {
		console.error('money_exchange currency_master:', err.message);
		data.currencies = [];
	}
	res.render('money_exchange/money_exchange', data);
});

// ----- Money exchange transactions (money_exchange_transaction) -----

function parseOptionalAccountId(v) {
	if (v === undefined || v === null || v === '') return null;
	const n = parseInt(v, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseOptionalTxnId(v) {
	if (v === undefined || v === null || v === '') return null;
	const n = parseInt(v, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

/** Trimmed guest name or null; caller validates walk-in requires non-empty */
function parseGuestName(body) {
	const s = String(body.txtGuestName || body.txtGuestname || '').trim();
	return s ? s.slice(0, 255) : null;
}

async function getCurrencyCodesByIds(inCurrencyId, exchangeCurrencyId) {
	const [rows] = await pool.execute(
		`SELECT ID, CODE
		 FROM currency_master
		 WHERE ID IN (?, ?)`,
		[inCurrencyId, exchangeCurrencyId]
	);
	const codeMap = new Map((rows || []).map((r) => [Number(r.ID), String(r.CODE || '').toUpperCase()]));
	return {
		inCode: codeMap.get(Number(inCurrencyId)) || '',
		exCode: codeMap.get(Number(exchangeCurrencyId)) || '',
	};
}

const currencyStrengthRank = {
	USD: 5,
	USDT: 4,
	PHP: 3,
	JPY: 2,
	KRW: 1,
};

function getCurrencyRank(code) {
	const c = String(code || '').toUpperCase();
	if (!c) return 0;
	return Number(currencyStrengthRank[c] || 0);
}

function computeExchangeAmountByDirection(amountIn, ratePct, inCode, exCode) {
	if (!Number.isFinite(amountIn) || !Number.isFinite(ratePct) || ratePct <= 0) return NaN;
	if (!inCode || !exCode || inCode === exCode) return NaN;
	// Stronger -> weaker uses multiply. Weaker -> stronger uses divide.
	const inRank = getCurrencyRank(inCode);
	const exRank = getCurrencyRank(exCode);
	if (inRank >= exRank) return Number((amountIn * ratePct).toFixed(2));
	return Number((amountIn / ratePct).toFixed(2));
}

/** POST deposit — TRANS_TYPE = 1 */
router.post('/add_money_exchange_deposit', checkSession, async (req, res) => {
	try {
		const accountId = parseOptionalAccountId(req.body.txtAccountId);
		const guestName = parseGuestName(req.body);
		const remark = String(req.body.txtRemark || '')
			.trim()
			.slice(0, 500);
		const inCcy = parseInt(req.body.txtInCurrencyId, 10);
		const exCcy = parseInt(req.body.txtExchangeCurrencyId, 10);
		const amountIn = Number(req.body.txtAmountIn);
		const ratePct = Number(req.body.txtRatePercent);
		const clientExchangeAmt = Number(req.body.txtExchangeAmount);
		const uid = req.session.user_id || null;
		const dateNow = new Date();

		if (!accountId && !guestName) {
			return res.status(400).send(
				'Guest name is required when no account is selected'
			);
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

		await pool.execute(
			`INSERT INTO money_exchange_transaction (
				TRANS_TYPE, TRANS_DATETIME, ACCOUNT_ID, GUEST_NAME, REMARK,
				IN_CURRENCY_ID, AMOUNT_IN, EXCHANGE_CURRENCY_ID, RATE_PERCENT, EXCHANGE_AMOUNT,
				ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[
				dateNow,
				accountId,
				guestName,
				remark || null,
				inCcy,
				amountIn,
				exCcy,
				ratePct,
				exchangeAmt,
				uid,
				dateNow,
			]
		);
		res.send('Deposit saved successfully');
	} catch (err) {
		console.error('add_money_exchange_deposit:', err);
		res.status(500).send(err.message || 'Error saving deposit');
	}
});

/** POST return — TRANS_TYPE = 2 */
router.post('/add_money_exchange_return', checkSession, async (req, res) => {
	try {
		const accountId = parseOptionalAccountId(req.body.txtAccountId);
		const guestName = parseGuestName(req.body);
		const remark = String(req.body.txtRemark || '')
			.trim()
			.slice(0, 500);
		const returnAmt = Number(req.body.txtReturnAmount);
		const sourceDepositId = parseOptionalTxnId(req.body.txtSourceDepositId);
		const uid = req.session.user_id || null;
		const dateNow = new Date();

		if (Number.isNaN(returnAmt) || returnAmt <= 0) {
			return res.status(400).send('Enter a valid return amount');
		}
		if (!sourceDepositId) {
			return res.status(400).send('Select a deposit row to return');
		}

		const [depositRows] = await pool.execute(
			`SELECT
				t.ID, t.TRANS_TYPE, t.ACTIVE,
				t.AMOUNT_IN, t.EXCHANGE_AMOUNT,
				c1.CODE AS IN_CURRENCY_CODE,
				c2.CODE AS EXCHANGE_CURRENCY_CODE
			 FROM money_exchange_transaction t
			 LEFT JOIN currency_master c1 ON c1.ID = t.IN_CURRENCY_ID
			 LEFT JOIN currency_master c2 ON c2.ID = t.EXCHANGE_CURRENCY_ID
			 WHERE t.ID = ?`,
			[sourceDepositId]
		);
		if (!depositRows || !depositRows.length) {
			return res.status(404).send('Selected deposit record not found');
		}
		const dep = depositRows[0];
		if (Number(dep.ACTIVE) !== 1 || Number(dep.TRANS_TYPE) !== 1) {
			return res.status(400).send('Selected record is not an active deposit');
		}
		const inCode = String(dep.IN_CURRENCY_CODE || '').toUpperCase();
		const exCode = String(dep.EXCHANGE_CURRENCY_CODE || '').toUpperCase();
		const baseAmount =
			inCode === 'PHP' && exCode !== 'PHP'
				? Number(dep.AMOUNT_IN)
				: Number(dep.EXCHANGE_AMOUNT);
		if (!Number.isFinite(baseAmount)) {
			return res.status(400).send('Selected deposit has invalid base return amount');
		}
		if (returnAmt < baseAmount) {
			return res
				.status(400)
				.send(`Return amount cannot be lower than required base amount (${baseAmount})`);
		}
		const computedMargin = returnAmt - baseAmount;

		const [linkedRows] = await pool.execute(
			`SELECT ID
			 FROM money_exchange_transaction
			 WHERE ACTIVE = 1 AND TRANS_TYPE = 2 AND SOURCE_DEPOSIT_ID = ?
			 LIMIT 1`,
			[sourceDepositId]
		);
		if (linkedRows && linkedRows.length) {
			return res.status(400).send('This deposit is already returned');
		}

		await pool.execute(
			`INSERT INTO money_exchange_transaction (
				TRANS_TYPE, TRANS_DATETIME, ACCOUNT_ID, GUEST_NAME, REMARK,
				RETURN_AMOUNT, MARGIN_RETURN, SOURCE_DEPOSIT_ID, ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (2, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[
				dateNow,
				accountId,
				guestName,
				remark || null,
				returnAmt,
				computedMargin,
				sourceDepositId,
				uid,
				dateNow,
			]
		);
		res.send('Return saved successfully');
	} catch (err) {
		console.error('add_money_exchange_return:', err);
		res.status(500).send(err.message || 'Error saving return');
	}
});

/** GET deposit history (JSON) */
router.get('/money_exchange_deposit_history', checkSession, async (req, res) => {
	try {
		const limit = Math.min(
			Math.max(parseInt(req.query.limit, 10) || 200, 1),
			500
		);
		const [rows] = await pool.query(
			`SELECT
				t.ID AS id,
				DATE_FORMAT(t.TRANS_DATETIME, '%b %e, %Y %H:%i') AS trans_datetime,
				UNIX_TIMESTAMP(t.TRANS_DATETIME) AS trans_sort,
				t.ACCOUNT_ID AS account_id,
				ag.AGENT_CODE AS agent_code,
				ag.NAME AS agent_name,
				NULLIF(TRIM(t.GUEST_NAME), '') AS guest_name,
				t.REMARK AS remark,
				c1.CODE AS in_currency_code,
				t.AMOUNT_IN AS amount_in,
				c2.CODE AS exchange_currency_code,
				t.RATE_PERCENT AS rate_percent,
				t.EXCHANGE_AMOUNT AS exchange_amount,
				r.ID AS return_txn_id,
				DATE_FORMAT(r.TRANS_DATETIME, '%b %e, %Y %H:%i') AS return_datetime,
				r.RETURN_AMOUNT AS return_amount,
				r.MARGIN_RETURN AS margin_return,
				r.REMARK AS return_remark,
				CASE
					WHEN r.ID IS NOT NULL
					THEN 'Returned'
					ELSE 'Pending'
				END AS return_status
			FROM money_exchange_transaction t
			LEFT JOIN account acc ON acc.IDNo = t.ACCOUNT_ID
			LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN currency_master c1 ON c1.ID = t.IN_CURRENCY_ID
			LEFT JOIN currency_master c2 ON c2.ID = t.EXCHANGE_CURRENCY_ID
			LEFT JOIN money_exchange_transaction r
				ON r.SOURCE_DEPOSIT_ID = t.ID
				AND r.TRANS_TYPE = 2
				AND r.ACTIVE = 1
			WHERE t.TRANS_TYPE = 1 AND t.ACTIVE = 1
			ORDER BY t.TRANS_DATETIME DESC, t.ID DESC
			LIMIT ${limit}`
		);
		res.json(rows || []);
	} catch (err) {
		console.error('money_exchange_deposit_history:', err);
		res.status(500).send('Error loading deposit history');
	}
});

/** GET return history (JSON) */
router.get('/money_exchange_return_history', checkSession, async (req, res) => {
	try {
		const limit = Math.min(
			Math.max(parseInt(req.query.limit, 10) || 200, 1),
			500
		);
		const [rows] = await pool.query(
			`SELECT
				t.ID AS id,
				DATE_FORMAT(t.TRANS_DATETIME, '%b %e, %Y %H:%i') AS trans_datetime,
				UNIX_TIMESTAMP(t.TRANS_DATETIME) AS trans_sort,
				t.ACCOUNT_ID AS account_id,
				ag.AGENT_CODE AS agent_code,
				ag.NAME AS agent_name,
				NULLIF(TRIM(t.GUEST_NAME), '') AS guest_name,
				t.REMARK AS remark,
				t.RETURN_AMOUNT AS return_amount,
				t.MARGIN_RETURN AS margin_return,
				t.SOURCE_DEPOSIT_ID AS source_deposit_id
			FROM money_exchange_transaction t
			LEFT JOIN account acc ON acc.IDNo = t.ACCOUNT_ID
			LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			WHERE t.TRANS_TYPE = 2 AND t.ACTIVE = 1
			ORDER BY t.TRANS_DATETIME DESC, t.ID DESC
			LIMIT ${limit}`
		);
		res.json(rows || []);
	} catch (err) {
		console.error('money_exchange_return_history:', err);
		res.status(500).send('Error loading return history');
	}
});

/** GET one row (JSON) — Super Admin only */
router.get(
	'/money_exchange_transaction/:id',
	checkSession,
	requireSuperAdmin,
	async (req, res) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (!id || id < 1) {
				return res.status(400).send('Invalid id');
			}
			const [rows] = await pool.execute(
				`SELECT
					ID AS id,
					TRANS_TYPE AS trans_type,
					ACCOUNT_ID AS account_id,
					NULLIF(TRIM(GUEST_NAME), '') AS guest_name,
					REMARK AS remark,
					IN_CURRENCY_ID AS in_currency_id,
					AMOUNT_IN AS amount_in,
					EXCHANGE_CURRENCY_ID AS exchange_currency_id,
					RATE_PERCENT AS rate_percent,
					EXCHANGE_AMOUNT AS exchange_amount,
					RETURN_AMOUNT AS return_amount,
					MARGIN_RETURN AS margin_return,
					SOURCE_DEPOSIT_ID AS source_deposit_id
				FROM money_exchange_transaction
				WHERE ID = ? AND ACTIVE = 1`,
				[id]
			);
			if (!rows || !rows.length) {
				return res.status(404).send('Transaction not found');
			}
			res.json(rows[0]);
		} catch (err) {
			console.error('money_exchange_transaction GET:', err);
			res.status(500).send(err.message || 'Error loading transaction');
		}
	}
);

/** PUT update — Super Admin only */
router.put(
	'/money_exchange_transaction/:id',
	checkSession,
	requireSuperAdmin,
	async (req, res) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (!id || id < 1) {
				return res.status(400).send('Invalid id');
			}
			const [existingRows] = await pool.execute(
				`SELECT ID, TRANS_TYPE FROM money_exchange_transaction WHERE ID = ? AND ACTIVE = 1`,
				[id]
			);
			if (!existingRows || !existingRows.length) {
				return res.status(404).send('Transaction not found');
			}
			const transType = Number(existingRows[0].TRANS_TYPE);
			const uid = req.session.user_id || null;
			const dateNow = new Date();

			if (transType === 1) {
				const accountId = parseOptionalAccountId(req.body.txtAccountId);
				const guestName = parseGuestName(req.body);
				const remark = String(req.body.txtRemark || '')
					.trim()
					.slice(0, 500);
				const inCcy = parseInt(req.body.txtInCurrencyId, 10);
				const exCcy = parseInt(req.body.txtExchangeCurrencyId, 10);
				const amountIn = Number(req.body.txtAmountIn);
				const ratePct = Number(req.body.txtRatePercent);
				const clientExchangeAmt = Number(req.body.txtExchangeAmount);

				if (!accountId && !guestName) {
					return res.status(400).send(
						'Guest name is required when no account is selected'
					);
				}
				if (!inCcy || inCcy < 1 || !exCcy || exCcy < 1) {
					return res.status(400).send('Select in currency and exchange currency');
				}
				if (inCcy === exCcy) {
					return res
						.status(400)
						.send('In currency and exchange currency must differ');
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
					return res
						.status(400)
						.send('Enter valid amount, rate %, and exchange amount');
				}

				const [result] = await pool.execute(
					`UPDATE money_exchange_transaction SET
						ACCOUNT_ID = ?, GUEST_NAME = ?, REMARK = ?,
						IN_CURRENCY_ID = ?, AMOUNT_IN = ?, EXCHANGE_CURRENCY_ID = ?, RATE_PERCENT = ?, EXCHANGE_AMOUNT = ?,
						EDITED_BY = ?, EDITED_DT = ?
					WHERE ID = ? AND TRANS_TYPE = 1 AND ACTIVE = 1`,
					[
						accountId,
						guestName,
						remark || null,
						inCcy,
						amountIn,
						exCcy,
						ratePct,
						exchangeAmt,
						uid,
						dateNow,
						id,
					]
				);
				if (result.affectedRows === 0) {
					return res.status(404).send('Update failed');
				}
				return res.send('Deposit updated successfully');
			}

			if (transType === 2) {
				const accountId = parseOptionalAccountId(req.body.txtAccountId);
				const guestName = parseGuestName(req.body);
				const remark = String(req.body.txtRemark || '')
					.trim()
					.slice(0, 500);
				const returnAmt = Number(req.body.txtReturnAmount);
				const sourceDepositId = parseOptionalTxnId(req.body.txtSourceDepositId);

				if (Number.isNaN(returnAmt) || returnAmt <= 0) {
					return res.status(400).send('Enter a valid return amount');
				}
				if (!sourceDepositId) {
					return res.status(400).send('Select a deposit row to return');
				}

				const [depositRows] = await pool.execute(
					`SELECT
						t.ID, t.TRANS_TYPE, t.ACTIVE,
						t.AMOUNT_IN, t.EXCHANGE_AMOUNT,
						c1.CODE AS IN_CURRENCY_CODE,
						c2.CODE AS EXCHANGE_CURRENCY_CODE
					 FROM money_exchange_transaction t
					 LEFT JOIN currency_master c1 ON c1.ID = t.IN_CURRENCY_ID
					 LEFT JOIN currency_master c2 ON c2.ID = t.EXCHANGE_CURRENCY_ID
					 WHERE t.ID = ?`,
					[sourceDepositId]
				);
				if (!depositRows || !depositRows.length) {
					return res.status(404).send('Selected deposit record not found');
				}
				const dep = depositRows[0];
				if (Number(dep.ACTIVE) !== 1 || Number(dep.TRANS_TYPE) !== 1) {
					return res.status(400).send('Selected record is not an active deposit');
				}
				const inCode = String(dep.IN_CURRENCY_CODE || '').toUpperCase();
				const exCode = String(dep.EXCHANGE_CURRENCY_CODE || '').toUpperCase();
				const baseAmount =
					inCode === 'PHP' && exCode !== 'PHP'
						? Number(dep.AMOUNT_IN)
						: Number(dep.EXCHANGE_AMOUNT);
				if (!Number.isFinite(baseAmount)) {
					return res.status(400).send('Selected deposit has invalid base return amount');
				}
				if (returnAmt < baseAmount) {
					return res
						.status(400)
						.send(`Return amount cannot be lower than required base amount (${baseAmount})`);
				}
				const computedMargin = returnAmt - baseAmount;

				const [linkedRows] = await pool.execute(
					`SELECT ID
					 FROM money_exchange_transaction
					 WHERE ACTIVE = 1 AND TRANS_TYPE = 2 AND SOURCE_DEPOSIT_ID = ? AND ID <> ?
					 LIMIT 1`,
					[sourceDepositId, id]
				);
				if (linkedRows && linkedRows.length) {
					return res.status(400).send('This deposit is already returned');
				}

				const [result] = await pool.execute(
					`UPDATE money_exchange_transaction SET
						ACCOUNT_ID = ?, GUEST_NAME = ?, REMARK = ?,
						RETURN_AMOUNT = ?, MARGIN_RETURN = ?, SOURCE_DEPOSIT_ID = ?,
						EDITED_BY = ?, EDITED_DT = ?
					WHERE ID = ? AND TRANS_TYPE = 2 AND ACTIVE = 1`,
					[
						accountId,
						guestName,
						remark || null,
						returnAmt,
						computedMargin,
						sourceDepositId,
						uid,
						dateNow,
						id,
					]
				);
				if (result.affectedRows === 0) {
					return res.status(404).send('Update failed');
				}
				return res.send('Return updated successfully');
			}

			return res.status(400).send('Unknown transaction type');
		} catch (err) {
			console.error('money_exchange_transaction PUT:', err);
			res.status(500).send(err.message || 'Error updating transaction');
		}
	}
);

/** PUT delete (soft: ACTIVE = 0) — Super Admin only */
router.put(
	'/money_exchange_transaction/:id/delete',
	checkSession,
	requireSuperAdmin,
	async (req, res) => {
		try {
			const id = parseInt(req.params.id, 10);
			if (!id || id < 1) {
				return res.status(400).send('Invalid id');
			}
			const uid = req.session.user_id || null;
			const dateNow = new Date();
			const [result] = await pool.execute(
				`UPDATE money_exchange_transaction
				 SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
				 WHERE ID = ? AND ACTIVE = 1`,
				[uid, dateNow, id]
			);
			if (result.affectedRows === 0) {
				return res.status(404).send('Not found or already deleted');
			}
			res.send('Transaction deleted successfully');
		} catch (err) {
			console.error('money_exchange_transaction delete:', err);
			res.status(500).send(err.message || 'Error deleting transaction');
		}
	}
);

// ----- Currency master CRUD (same style as accounts.js agency) -----

/** GET list — like /agency_data; ?all=1 = include inactive (modal) */
router.get('/currency_data', checkSession, async (req, res) => {
	try {
		const all = req.query.all === '1' || req.query.all === 'true';
		const query = all
			? `SELECT ID AS id, CODE AS code, NAME AS name, ACTIVE AS active,
					 DATE_FORMAT(ENCODED_DT, '%Y-%m-%d %H:%i') AS encoded_dt,
					 DATE_FORMAT(EDITED_DT, '%Y-%m-%d %H:%i') AS edited_dt
				 FROM currency_master
				 ORDER BY SORT_ORDER ASC, CODE ASC`
			: `SELECT ID AS id, CODE AS code, NAME AS name
				 FROM currency_master
				 WHERE ACTIVE = 1
				 ORDER BY SORT_ORDER ASC, CODE ASC`;
		const [results] = await pool.execute(query);
		res.json(results);
	} catch (err) {
		console.error('Error fetching currency data:', err);
		res.status(500).send('Error fetching data');
	}
});

/** ADD — like /add_agency */
router.post('/add_currency', checkSession, async (req, res) => {
	try {
		const txtCode = String(req.body.txtCode || '')
			.trim()
			.toUpperCase()
			.slice(0, 10);
		const txtName = String(req.body.txtName || '').trim().slice(0, 64);
		const date_now = new Date();
		const uid = req.session.user_id || null;

		if (!txtCode || !txtName) {
			return res.status(400).send('Code and name are required');
		}

		await pool.execute(
			`INSERT INTO currency_master (CODE, NAME, SORT_ORDER, ACTIVE, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, 0, 1, ?, ?)`,
			[txtCode, txtName, uid, date_now]
		);
		res.send('Currency added successfully');
	} catch (err) {
		if (err.code === 'ER_DUP_ENTRY') {
			return res.status(500).send('Currency code already exists');
		}
		console.error('Error inserting currency:', err);
		res.status(500).send('Error inserting currency');
	}
});

/** EDIT — like /agency/:id */
router.put('/currency/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		const txtCode = String(req.body.txtCode || '')
			.trim()
			.toUpperCase()
			.slice(0, 10);
		const txtName = String(req.body.txtName || '').trim().slice(0, 64);
		const txtActive =
			req.body.txtActive === '1' || req.body.txtActive === 1 ? 1 : 0;
		const date_now = new Date();
		const uid = req.session.user_id || null;

		if (!id || id < 1) {
			return res.status(500).send('Invalid id');
		}
		if (!txtCode) {
			return res.status(500).send('Code is required');
		}
		if (!txtName) {
			return res.status(500).send('Name is required');
		}

		const [result] = await pool.execute(
			`UPDATE currency_master
			 SET CODE = ?, NAME = ?, ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ?
			 WHERE ID = ?`,
			[txtCode, txtName, txtActive, uid, date_now, id]
		);
		if (result.affectedRows === 0) {
			return res.status(500).send('Currency not found');
		}
		res.send('Currency updated successfully');
	} catch (err) {
		if (err.code === 'ER_DUP_ENTRY') {
			return res.status(500).send('Currency code already exists');
		}
		console.error('Error updating currency:', err);
		res.status(500).send('Error updating currency');
	}
});

/** ARCHIVE / deactivate — like /agency/remove/:id */
router.put('/currency/remove/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		const date_now = new Date();
		const uid = req.session.user_id || null;

		if (!id || id < 1) {
			return res.status(500).send('Invalid id');
		}

		const [result] = await pool.execute(
			`UPDATE currency_master
			 SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
			 WHERE ID = ? AND ACTIVE = 1`,
			[uid, date_now, id]
		);
		if (result.affectedRows === 0) {
			return res.status(500).send('Currency not found or already inactive');
		}
		res.send('Currency archived successfully');
	} catch (err) {
		console.error('Error archiving currency:', err);
		res.status(500).send('Error archiving currency');
	}
});

module.exports = router;
