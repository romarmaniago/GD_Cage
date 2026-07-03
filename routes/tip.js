const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

const TIP_TYPE = {
	ROLLER: 1,
	DEALER: 2
};

function parseAmount(raw) {
	const clean = String(raw || '').replace(/,/g, '').trim();
	if (clean === '' || Number.isNaN(Number(clean))) return NaN;
	const n = Number(clean);
	return Number.isFinite(n) && n > 0 ? n : NaN;
}

function parseTipType(raw) {
	const n = parseInt(raw, 10);
	return n === TIP_TYPE.ROLLER || n === TIP_TYPE.DEALER ? n : null;
}

function parseAccountId(raw) {
	if (raw === undefined || raw === null || raw === '') return null;
	const n = parseInt(raw, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseGuestId(raw) {
	if (raw === undefined || raw === null || raw === '') return null;
	const n = parseInt(raw, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseGameId(raw) {
	if (raw === undefined || raw === null || raw === '') return null;
	const n = parseInt(raw, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseRemarks(raw) {
	return String(raw || '').trim().slice(0, 500) || null;
}

function parseTipStatus(raw) {
	const status = String(raw || '').trim();
	if (!status) return null;
	return status.slice(0, 50);
}

function parseRollerName(raw) {
	const name = String(raw || '').trim();
	if (!name) return null;
	return name.slice(0, 255);
}

function parseTipDatetime(raw) {
	const s = String(raw || '').trim();
	if (!s) return null;
	const d = new Date(s);
	return Number.isNaN(d.getTime()) ? null : d;
}

function tipTypeLabel(tipType) {
	switch (Number(tipType)) {
		case TIP_TYPE.ROLLER:
			return 'Roller';
		case TIP_TYPE.DEALER:
			return 'Dealer';
		default:
			return 'Unknown';
	}
}

async function validateActiveAccount(accountId) {
	const [rows] = await pool.execute(
		`SELECT acc.IDNo, acc.AGENT_ID, ag.AGENT_CODE, ag.NAME
		 FROM account acc
		 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 WHERE acc.IDNo = ? AND acc.ACTIVE = 1 AND ag.ACTIVE = 1
		 LIMIT 1`,
		[accountId]
	);
	return rows && rows[0] ? rows[0] : null;
}

async function validateActiveGuest(guestId) {
	const [rows] = await pool.execute(
		`SELECT g.IDNo, g.AGENT_ID, g.NAME
		 FROM guest g
		 JOIN agent ag ON ag.IDNo = g.AGENT_ID
		 WHERE g.IDNo = ? AND g.ACTIVE = 1 AND ag.ACTIVE = 1
		 LIMIT 1`,
		[guestId]
	);
	return rows && rows[0] ? rows[0] : null;
}

async function validateActiveGame(gameId) {
	const [rows] = await pool.execute(
		`SELECT gl.IDNo, gl.GAME_NO
		 FROM game_list gl
		 WHERE gl.IDNo = ? AND gl.ACTIVE != 0
		 LIMIT 1`,
		[gameId]
	);
	return rows && rows[0] ? rows[0] : null;
}

async function getRollerTipAvailableBalance(db) {
	const conn = db || pool;
	const [[rollerRow]] = await conn.execute(
		`SELECT COALESCE(SUM(t.AMOUNT), 0) AS TOTAL
		 FROM tip t
		 WHERE t.ACTIVE = 1 AND t.TIP_TYPE = ?`,
		[TIP_TYPE.ROLLER]
	);
	const [[tipSettlementRow]] = await conn.execute(
		`SELECT COALESCE(SUM(ts.AMOUNT), 0) AS TOTAL
		 FROM tip_settlement ts
		 WHERE ts.ACTIVE = 1`
	);

	const grossRoller = parseFloat(rollerRow && rollerRow.TOTAL) || 0;
	const tipSettled = parseFloat(tipSettlementRow && tipSettlementRow.TOTAL) || 0;
	const available = grossRoller - tipSettled;

	return {
		grossRoller,
		tipSettled,
		available: Math.max(0, available)
	};
}

router.get('/tip', checkSession, function (req, res) {
	const data = sessions(req, 'tip');
	data.permissions = req.session.permissions;
	res.render('tip/tip', data);
});

router.get('/tip_roller_balance', checkSession, async (req, res) => {
	try {
		const balance = await getRollerTipAvailableBalance(pool);
		res.json(balance);
	} catch (err) {
		console.error('tip_roller_balance:', err);
		res.status(500).json({ message: 'Failed to load roller tip balance.' });
	}
});

router.get('/tip_roller_history', checkSession, async (req, res) => {
	try {
		const accountId = parseAccountId(req.query.accountId);
		const tipParams = [TIP_TYPE.ROLLER];
		let tipSql = `
			SELECT
				t.ROLLER_NAME,
				t.TIP_STATUS,
				COALESCE(NULLIF(TRIM(t.TIP_STATUS), ''), 'Roller') AS TIP_STATUS_LABEL,
				COALESCE(NULLIF(TRIM(t.ROLLER_NAME), ''), NULLIF(TRIM(t.REMARKS), ''), '—') AS PERSON_NAME
			FROM tip t
			WHERE t.ACTIVE = 1 AND t.TIP_TYPE = ?
		`;
		if (accountId) {
			tipSql += ' AND t.ACCOUNT_ID = ?';
			tipParams.push(accountId);
		}
		tipSql += ' ORDER BY t.TIP_DATETIME DESC, t.IDNo DESC LIMIT 50';

		const [tipRows] = await pool.execute(tipSql, tipParams);
		const [settlementRows] = await pool.execute(
			`SELECT
				ts.ROLLER_NAME,
				ts.TIP_STATUS,
				COALESCE(NULLIF(TRIM(ts.TIP_STATUS), ''), 'GM') AS TIP_STATUS_LABEL,
				COALESCE(
					NULLIF(TRIM(ts.ROLLER_NAME), ''),
					NULLIF(TRIM(CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME)), ''),
					'—'
				) AS PERSON_NAME
			 FROM tip_settlement ts
			 LEFT JOIN user_info ui ON ui.IDNo = ts.ENCODED_BY
			 WHERE ts.ACTIVE = 1
			 ORDER BY ts.SETTLEMENT_DATETIME DESC, ts.IDNo DESC
			 LIMIT 50`
		);

		const history = [];
		const seen = new Set();
		const pushHistory = function (row) {
			const personName = (row && row.PERSON_NAME && String(row.PERSON_NAME).trim()) || '';
			const status = (row && row.TIP_STATUS_LABEL && String(row.TIP_STATUS_LABEL).trim()) ||
				(row && row.TIP_STATUS && String(row.TIP_STATUS).trim()) || '';
			const key = `${personName.toLowerCase()}|${status.toLowerCase()}`;
			if (seen.has(key)) return;
			seen.add(key);
			history.push({
				PERSON_NAME: personName || '—',
				ROLLER_NAME: row && row.ROLLER_NAME ? String(row.ROLLER_NAME).trim() : '',
				STATUS: status || 'Roller',
				TIP_STATUS: row && row.TIP_STATUS ? String(row.TIP_STATUS).trim() : '',
				TIP_STATUS_LABEL: status || 'Roller'
			});
		};

		(tipRows || []).forEach(pushHistory);
		(settlementRows || []).forEach(pushHistory);

		res.json({ history });
	} catch (err) {
		console.error('tip_roller_history:', err);
		res.status(500).json({ message: 'Failed to load roller tip history.' });
	}
});

router.get('/tip_games', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute(
			`SELECT
				gl.IDNo AS id,
				COALESCE(NULLIF(TRIM(CAST(gl.GAME_NO AS CHAR)), ''), CAST(gl.IDNo AS CHAR)) AS game_no,
				gl.ENCODED_DT AS game_date,
				ag.AGENT_CODE AS agent_code,
				ag.NAME AS agent_name
			 FROM game_list gl
			 JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo
			 JOIN agent ag ON acc.AGENT_ID = ag.IDNo
			 WHERE gl.ACTIVE != 0
			 ORDER BY gl.ENCODED_DT DESC, gl.IDNo DESC
			 LIMIT 500`
		);
		res.json(rows || []);
	} catch (err) {
		console.error('tip_games:', err);
		res.status(500).json({ message: 'Failed to load games' });
	}
});

router.get('/tip_data', checkSession, async (req, res) => {
	try {
		const [tipRows] = await pool.execute(
			`SELECT
				t.IDNo,
				t.AMOUNT,
				t.GAME_ID,
				t.ACCOUNT_ID,
				t.GUEST_ID,
				t.TIP_TYPE,
				t.TIP_DATETIME,
				t.ROLLER_NAME,
				t.TIP_STATUS,
				t.REMARKS,
				t.CASHOUT_ID,
				COALESCE(NULLIF(TRIM(CAST(gl.GAME_NO AS CHAR)), ''), CAST(t.GAME_ID AS CHAR)) AS GAME_NO,
				ag.AGENT_CODE,
				ag.NAME AS AGENT_NAME,
				COALESCE(NULLIF(TRIM(g_direct.NAME), ''), NULLIF(TRIM(g.NAME), ''), '-') AS GUEST_NAME
			 FROM tip t
			 LEFT JOIN game_list gl ON gl.IDNo = t.GAME_ID
			 LEFT JOIN guest g ON g.IDNo = gl.GUEST_ID
			 LEFT JOIN guest g_direct ON g_direct.IDNo = t.GUEST_ID
			 LEFT JOIN account acc ON acc.IDNo = t.ACCOUNT_ID
			 LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 WHERE t.ACTIVE = 1
			 ORDER BY t.TIP_DATETIME DESC, t.IDNo DESC`
		);

		const [tipSettlementRows] = await pool.execute(
			`SELECT
				ts.IDNo,
				ts.AMOUNT,
				ts.SETTLEMENT_DATETIME,
				ts.REMARKS,
				ts.ROLLER_NAME,
				ts.TIP_STATUS,
				COALESCE(NULLIF(TRIM(ts.TIP_STATUS), ''), 'GM') AS TIP_STATUS_LABEL,
				COALESCE(
					NULLIF(TRIM(ts.ROLLER_NAME), ''),
					NULLIF(TRIM(CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME)), ''),
					'—'
				) AS PERSON_NAME
			 FROM tip_settlement ts
			 LEFT JOIN user_info ui ON ui.IDNo = ts.ENCODED_BY
			 WHERE ts.ACTIVE = 1
			 ORDER BY ts.SETTLEMENT_DATETIME DESC, ts.IDNo DESC`
		);

		const formatAccountDisplay = function (agentCode, agentName) {
			if (!agentCode) return '-';
			return `${agentCode}${agentName ? ` (${agentName})` : ''}`;
		};

		const formatTipPersonName = function (row) {
			return (row && row.ROLLER_NAME && String(row.ROLLER_NAME).trim()) || '—';
		};

		const formatRowRemarks = function (raw) {
			const text = String(raw || '').trim();
			return text || '—';
		};

		const remarksEditValue = function (raw) {
			return String(raw || '').trim();
		};

		const formatTipStatus = function (row) {
			return (row && row.TIP_STATUS && String(row.TIP_STATUS).trim()) || 'Roller';
		};

		const groups = new Map();
		(tipRows || []).forEach(function (row) {
			const dtMs = row.TIP_DATETIME ? new Date(row.TIP_DATETIME).getTime() : 0;
			const key = row.GAME_ID != null
				? `${row.GAME_ID}|${row.ACCOUNT_ID}|${dtMs}`
				: `standalone-${row.IDNo}`;
			if (!groups.has(key)) {
				groups.set(key, {
					TIP_DATETIME: row.TIP_DATETIME,
					GAME_NO: row.GAME_NO,
					ACCOUNT_DISPLAY: formatAccountDisplay(row.AGENT_CODE, row.AGENT_NAME),
					GUEST_NAME: row.GUEST_NAME || '-',
					roller: null,
					dealer: null,
					rollerTipId: null,
					dealerTipId: null,
					sortId: row.IDNo
				});
			}
			const group = groups.get(key);
			const part = {
				amount: parseFloat(row.AMOUNT) || 0,
				status: formatTipStatus(row),
				name: formatTipPersonName(row),
				remarksRaw: remarksEditValue(row.REMARKS)
			};
			if (Number(row.TIP_TYPE) === TIP_TYPE.ROLLER) {
				group.roller = part;
				group.rollerTipId = row.IDNo;
			} else if (Number(row.TIP_TYPE) === TIP_TYPE.DEALER) {
				group.dealer = part;
				group.dealerTipId = row.IDNo;
			}
			group.sortId = Math.max(group.sortId, row.IDNo);
		});

		const buildTipSide = function (side, transactionLabel, mirrorSide) {
			if (side) {
				return {
					transaction: transactionLabel,
					amount: side.amount,
					status: side.status,
					name: side.name
				};
			}
			return {
				transaction: transactionLabel,
				amount: 0,
				status: mirrorSide ? mirrorSide.status : '—',
				name: mirrorSide ? mirrorSide.name : '—'
			};
		};

		const data = [];
		groups.forEach(function (group) {
			const rollerSide = buildTipSide(group.roller, 'Roller Tip', group.dealer);
			const dealerSide = buildTipSide(group.dealer, 'Dealer Tip', group.roller);
			const rowRemarksRaw = (group.roller && group.roller.remarksRaw) ||
				(group.dealer && group.dealer.remarksRaw) ||
				'';
			const remarksRecordId = (group.roller && group.roller.remarksRaw && group.rollerTipId) ||
				(group.dealer && group.dealer.remarksRaw && group.dealerTipId) ||
				group.rollerTipId ||
				group.dealerTipId ||
				null;
			data.push({
				TIP_DATETIME: group.TIP_DATETIME,
				ACCOUNT_DISPLAY: group.ACCOUNT_DISPLAY,
				GUEST_NAME: group.GUEST_NAME,
				GAME_NO: group.GAME_NO,
				ROLLER_TRANSACTION: rollerSide.transaction,
				ROLLER_AMOUNT: rollerSide.amount,
				ROLLER_STATUS: rollerSide.status,
				ROLLER_NAME: rollerSide.name,
				DEALER_TRANSACTION: dealerSide.transaction,
				DEALER_AMOUNT: dealerSide.amount,
				DEALER_STATUS: dealerSide.status,
				DEALER_NAME: dealerSide.name,
				REMARKS: formatRowRemarks(rowRemarksRaw),
				REMARKS_EDIT: rowRemarksRaw,
				REMARKS_SOURCE: remarksRecordId ? 'tip' : null,
				REMARKS_RECORD_ID: remarksRecordId,
				SORT_ID: group.sortId,
				ROW_KIND: 'tip'
			});
		});

		(tipSettlementRows || []).forEach(function (row) {
			const amount = parseFloat(row.AMOUNT) || 0;
			if (amount <= 0) return;
			const personName = row.PERSON_NAME || '—';
			const tipStatus = row.TIP_STATUS_LABEL || 'GM';
			data.push({
				TIP_DATETIME: row.SETTLEMENT_DATETIME,
				ACCOUNT_DISPLAY: '—',
				GUEST_NAME: '—',
				GAME_NO: '—',
				ROLLER_TRANSACTION: 'Settlement',
				ROLLER_AMOUNT: -amount,
				ROLLER_STATUS: tipStatus,
				ROLLER_NAME: personName,
				DEALER_TRANSACTION: 'Dealer Tip',
				DEALER_AMOUNT: 0,
				DEALER_STATUS: tipStatus,
				DEALER_NAME: personName,
				REMARKS: formatRowRemarks(row.REMARKS),
				REMARKS_EDIT: remarksEditValue(row.REMARKS),
				REMARKS_SOURCE: 'tip_settlement',
				REMARKS_RECORD_ID: row.IDNo,
				SORT_ID: 'TS-' + row.IDNo,
				ROW_KIND: 'tip_settlement'
			});
		});

		data.sort(function (a, b) {
			const da = new Date(a.TIP_DATETIME).getTime() || 0;
			const db = new Date(b.TIP_DATETIME).getTime() || 0;
			if (db !== da) return db - da;
			return String(b.SORT_ID).localeCompare(String(a.SORT_ID));
		});

		res.json(data);
	} catch (err) {
		console.error('tip_data:', err);
		res.status(500).json({ message: 'Failed to load tip data' });
	}
});

router.post('/tip_in', checkSession, async (req, res) => {
	try {
		const amount = parseAmount(req.body.txtAmount);
		const accountId = parseAccountId(req.body.txtAccountId);
		const guestId = parseGuestId(req.body.txtGuestId);
		const tipStatus = parseTipStatus(req.body.txtTipStatus);
		const rollerName = parseRollerName(req.body.txtRollerName);
		const remarks = parseRemarks(req.body.txtRemarks);
		const userId = req.session.user_id || null;
		const dateNow = new Date();

		if (Number.isNaN(amount)) {
			return res.status(400).json({ message: 'Enter a valid amount greater than zero.' });
		}
		if (!tipStatus) {
			return res.status(400).json({ message: 'Please enter the tip status (Roller or GM).' });
		}
		if (!rollerName) {
			return res.status(400).json({ message: 'Please enter the name.' });
		}

		let account = null;
		if (accountId) {
			account = await validateActiveAccount(accountId);
			if (!account) {
				return res.status(400).json({ message: 'Invalid or inactive account.' });
			}
		}

		let guest = null;
		if (guestId) {
			guest = await validateActiveGuest(guestId);
			if (!guest) {
				return res.status(400).json({ message: 'Invalid or inactive guest.' });
			}
		}

		if (account && guest && parseInt(account.AGENT_ID, 10) !== parseInt(guest.AGENT_ID, 10)) {
			return res.status(400).json({ message: 'Selected guest does not belong to the selected account.' });
		}

		await pool.execute(
			`INSERT INTO tip (
				AMOUNT, GAME_ID, ACCOUNT_ID, GUEST_ID, TIP_TYPE, TIP_DATETIME, REMARKS,
				ROLLER_NAME, TIP_STATUS, ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[amount, accountId, guestId, TIP_TYPE.ROLLER, dateNow, remarks, rollerName, tipStatus, userId, dateNow]
		);

		const updatedBalance = await getRollerTipAvailableBalance(pool);
		res.json({
			message: 'Roller tip saved successfully.',
			availableBalance: updatedBalance.available
		});
	} catch (err) {
		console.error('tip_in:', err);
		res.status(500).json({ message: 'Failed to save roller tip.' });
	}
});

router.post('/tip_settlement', checkSession, async (req, res) => {
	const connection = await pool.getConnection();
	try {
		const amount = parseAmount(req.body.txtAmount);
		const remarks = parseRemarks(req.body.txtRemarks);
		const tipStatus = parseTipStatus(req.body.txtTipStatus);
		const rollerName = parseRollerName(req.body.txtRollerName);
		const userId = req.session.user_id || null;
		const dateNow = new Date();

		if (Number.isNaN(amount)) {
			return res.status(400).json({ message: 'Enter a valid settlement amount greater than zero.' });
		}
		if (!tipStatus) {
			return res.status(400).json({ message: 'Please enter the tip status (Roller or GM).' });
		}
		if (!rollerName) {
			return res.status(400).json({ message: 'Please enter the name.' });
		}

		await connection.beginTransaction();

		const balance = await getRollerTipAvailableBalance(connection);
		if (amount > balance.available) {
			await connection.rollback();
			return res.status(400).json({
				message: 'Settlement amount cannot exceed available roller tip balance.'
			});
		}

		await connection.execute(
			`INSERT INTO tip_settlement (
				AMOUNT, SETTLEMENT_DATETIME, REMARKS, ROLLER_NAME, TIP_STATUS,
				ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
			[amount, dateNow, remarks, rollerName, tipStatus, userId, dateNow]
		);

		await connection.commit();

		const updatedBalance = await getRollerTipAvailableBalance(pool);
		res.json({
			message: 'Tip settlement saved successfully.',
			availableBalance: updatedBalance.available
		});
	} catch (err) {
		try {
			await connection.rollback();
		} catch (rbErr) {
			console.error('tip_settlement rollback:', rbErr);
		}
		console.error('tip_settlement:', err);
		res.status(500).json({ message: 'Failed to save tip settlement.' });
	} finally {
		connection.release();
	}
});

router.post('/add_tip', checkSession, async (req, res) => {
	try {
		const amount = parseAmount(req.body.txtAmount);
		const gameId = parseGameId(req.body.txtGameId);
		const accountId = parseAccountId(req.body.txtAccountId);
		const tipType = parseTipType(req.body.txtTipType);
		const tipDatetime = parseTipDatetime(req.body.txtTipDatetime) || new Date();
		const remarks = parseRemarks(req.body.txtRemarks);
		const dateNow = new Date();
		const userId = req.session.user_id || null;

		if (Number.isNaN(amount)) {
			return res.status(400).json({ message: 'Enter a valid amount greater than zero' });
		}
		if (!tipType) {
			return res.status(400).json({ message: 'Select tip type (Roller or Dealer)' });
		}
		if (!gameId) {
			return res.status(400).json({ message: 'Select a game number' });
		}
		if (!accountId) {
			return res.status(400).json({ message: 'Select an account' });
		}

		const game = await validateActiveGame(gameId);
		if (!game) {
			return res.status(400).json({ message: 'Invalid or inactive game' });
		}
		const account = await validateActiveAccount(accountId);
		if (!account) {
			return res.status(400).json({ message: 'Invalid or inactive account' });
		}

		await pool.execute(
			`INSERT INTO tip (
				AMOUNT, GAME_ID, ACCOUNT_ID, TIP_TYPE, TIP_DATETIME, REMARKS,
				ENCODED_BY, ENCODED_DT, ACTIVE
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[amount, gameId, accountId, tipType, tipDatetime, remarks, userId, dateNow]
		);

		res.json({ message: 'Saved successfully' });
	} catch (err) {
		console.error('add_tip:', err);
		res.status(500).json({ message: 'Failed to save tip' });
	}
});

router.put('/tip/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		const amount = parseAmount(req.body.txtAmount);
		const gameId = parseGameId(req.body.txtGameId);
		const accountId = parseAccountId(req.body.txtAccountId);
		const tipType = parseTipType(req.body.txtTipType);
		const tipDatetime = parseTipDatetime(req.body.txtTipDatetime);
		const remarks = parseRemarks(req.body.txtRemarks);
		const dateNow = new Date();
		const userId = req.session.user_id || null;

		if (!id || !tipType || !tipDatetime) {
			return res.status(400).json({ message: 'Invalid payload' });
		}
		if (Number.isNaN(amount)) {
			return res.status(400).json({ message: 'Enter a valid amount greater than zero' });
		}
		if (!gameId) {
			return res.status(400).json({ message: 'Select a game number' });
		}
		if (!accountId) {
			return res.status(400).json({ message: 'Select an account' });
		}

		const [existingRows] = await pool.execute(
			`SELECT IDNo FROM tip WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1`,
			[id]
		);
		if (!existingRows || !existingRows.length) {
			return res.status(404).json({ message: 'Record not found' });
		}

		const game = await validateActiveGame(gameId);
		if (!game) {
			return res.status(400).json({ message: 'Invalid or inactive game' });
		}
		const account = await validateActiveAccount(accountId);
		if (!account) {
			return res.status(400).json({ message: 'Invalid or inactive account' });
		}

		await pool.execute(
			`UPDATE tip
			 SET AMOUNT = ?, GAME_ID = ?, ACCOUNT_ID = ?, TIP_TYPE = ?, TIP_DATETIME = ?, REMARKS = ?,
			     EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[amount, gameId, accountId, tipType, tipDatetime, remarks, userId, dateNow, id]
		);

		res.json({ message: 'Updated successfully' });
	} catch (err) {
		console.error('tip update:', err);
		res.status(500).json({ message: 'Failed to update tip' });
	}
});

router.put('/tip/remove/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		const dateNow = new Date();
		const userId = req.session.user_id || null;

		if (!id) return res.status(400).json({ message: 'Invalid ID' });

		const [rows] = await pool.execute(
			`SELECT IDNo FROM tip WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1`,
			[id]
		);
		if (!rows || !rows.length) {
			return res.status(404).json({ message: 'Record not found' });
		}

		await pool.execute(
			`UPDATE tip SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`,
			[userId, dateNow, id]
		);

		res.json({ message: 'Deleted successfully' });
	} catch (err) {
		console.error('tip remove:', err);
		res.status(500).json({ message: 'Failed to delete tip' });
	}
});

module.exports = router;
