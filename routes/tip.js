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

function parseGameId(raw) {
	if (raw === undefined || raw === null || raw === '') return null;
	const n = parseInt(raw, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

function parseRemarks(raw) {
	return String(raw || '').trim().slice(0, 500) || null;
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
		`SELECT acc.IDNo, ag.AGENT_CODE, ag.NAME
		 FROM account acc
		 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 WHERE acc.IDNo = ? AND acc.ACTIVE = 1 AND ag.ACTIVE = 1
		 LIMIT 1`,
		[accountId]
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

router.get('/tip', checkSession, function (req, res) {
	const data = sessions(req, 'tip');
	data.permissions = req.session.permissions;
	res.render('tip/tip', data);
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
		const [rows] = await pool.execute(
			`SELECT
				t.IDNo,
				t.AMOUNT,
				t.GAME_ID,
				t.ACCOUNT_ID,
				t.TIP_TYPE,
				t.TIP_DATETIME,
				t.CASHOUT_ID,
				t.REMARKS,
				t.ENCODED_BY,
				t.ENCODED_DT,
				COALESCE(NULLIF(TRIM(CAST(gl.GAME_NO AS CHAR)), ''), CAST(t.GAME_ID AS CHAR)) AS GAME_NO,
				ag.AGENT_CODE,
				ag.NAME AS AGENT_NAME,
				COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS GUEST_NAME,
				CONCAT_WS(' ', ui.FIRSTNAME, ui.LASTNAME) AS ENCODED_BY_NAME
			 FROM tip t
			 LEFT JOIN game_list gl ON gl.IDNo = t.GAME_ID
			 LEFT JOIN guest g ON g.IDNo = gl.GUEST_ID
			 LEFT JOIN account acc ON acc.IDNo = t.ACCOUNT_ID
			 LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 LEFT JOIN user_info ui ON ui.IDNo = t.ENCODED_BY
			 WHERE t.ACTIVE = 1
			 ORDER BY t.TIP_DATETIME DESC, t.IDNo DESC`
		);

		const data = (rows || []).map((row) => {
			let accountDisplay = '-';
			if (row.ACCOUNT_ID && row.AGENT_CODE) {
				accountDisplay = `${row.AGENT_CODE}${row.AGENT_NAME ? ` (${row.AGENT_NAME})` : ''}`;
			}
			return {
				...row,
				ACCOUNT_DISPLAY: accountDisplay,
				TIP_TYPE_LABEL: tipTypeLabel(row.TIP_TYPE)
			};
		});

		res.json(data);
	} catch (err) {
		console.error('tip_data:', err);
		res.status(500).json({ message: 'Failed to load tip data' });
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
