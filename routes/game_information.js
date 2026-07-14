const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

/** Read-only Gamebook mirror — no write / transaction endpoints. */
const GAME_META_SELECT = `
	SELECT
		game_list.IDNo AS game_list_id,
		game_list.IDNo AS GAME_ID,
		game_list.ACCOUNT_ID,
		game_list.GUEST_ID,
		game_list.GAME_TYPE,
		game_list.COMMISSION_TYPE,
		game_list.COMMISSION_PERCENTAGE,
		game_list.PROGRAM_DATE,
		game_list.ENCODED_DT AS GAME_DATE_START,
		game_list.GAME_ENDED,
		game_list.ACTIVE AS game_status,
		game_list.SETTLED,
		account.IDNo AS account_no,
		agent.IDNo AS AGENT_ID,
		agent.AGENT_CODE AS agent_code,
		agent.NAME AS agent_name,
		COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS guest_name,
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
	LEFT JOIN guest g ON g.IDNo = game_list.GUEST_ID
`;

router.get('/game_information', checkSession, function (req, res) {
	const data = sessions(req, 'game_information');
	data.permissions = req.session.permissions;
	res.render('game_information/game_information', data);
});

router.get('/categorize_group', checkSession, function (req, res) {
	const data = sessions(req, 'game_information');
	data.permissions = req.session.permissions;
	res.render('game_information/categorize_group', data);
});

/** List Gamebook games (read-only). Amounts come from /game_list/:id/record on the client. */
router.get('/game_information_data', checkSession, async (req, res) => {
	const isValidYmd = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '').slice(0, 10));
	const { date, programFrom, programTo } = req.query;

	try {
		let where = 'WHERE game_list.ACTIVE != 0';
		const params = [];

		if (programFrom && programTo) {
			const fromS = String(programFrom).slice(0, 10);
			const toS = String(programTo).slice(0, 10);
			if (!isValidYmd(fromS) || !isValidYmd(toS)) {
				return res.status(400).json({ error: 'Invalid program date range. Use YYYY-MM-DD.' });
			}
			if (fromS > toS) {
				return res.status(400).json({ error: 'programFrom must be on or before programTo.' });
			}
			where += ' AND DATE(game_list.PROGRAM_DATE) BETWEEN ? AND ?';
			params.push(fromS, toS);
		} else if (date && isValidYmd(String(date).slice(0, 10))) {
			where += ' AND DATE(game_list.PROGRAM_DATE) = ?';
			params.push(String(date).slice(0, 10));
		}

		const [rows] = await pool.execute(
			`${GAME_META_SELECT} ${where} ORDER BY game_list.IDNo ASC`,
			params
		);
		res.json(rows);
	} catch (err) {
		console.error('[game_information_data]', err);
		res.status(500).json({ error: 'Error fetching data' });
	}
});

module.exports = router;
