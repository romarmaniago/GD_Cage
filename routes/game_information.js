const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

const GAME_INFORMATION_SELECT = `
	SELECT
		gi.IDNo AS manual_id,
		gi.PROGRAM_DATE,
		gi.GAME_START,
		gi.GAME_TYPE,
		gi.GAME_NO,
		gi.ACCOUNT_ID,
		gi.GUEST_ID,
		NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(TRIM(ag.AGENT_CODE), ''), NULLIF(TRIM(ag.NAME), ''))), '') AS ACCOUNT_TEXT,
		COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS GUEST_NAME,
		gi.BUY_IN,
		gi.CASH_OUT,
		gi.WIN_LOSS,
		gi.ROLLING,
		gi.COMMISSION_TYPE,
		gi.COMMISSION_PERCENTAGE,
		gi.COMMISSION,
		gi.ADD_CHARGE,
		gi.TOTAL_SETTLEMENT,
		gi.GAME_END_KIND,
		gi.GAME_ENDED
	FROM game_information gi
	LEFT JOIN account acc ON acc.IDNo = gi.ACCOUNT_ID
	LEFT JOIN agent ag ON ag.IDNo = acc.AGENT_ID
	LEFT JOIN guest g ON g.IDNo = gi.GUEST_ID
`;

function isValidYmd(d) {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '').slice(0, 10));
}

function buildProgramDateWhere(query) {
	const { date, programFrom, programTo } = query;
	let where = 'WHERE gi.ACTIVE = 1';
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
		where += ' AND DATE(gi.PROGRAM_DATE) BETWEEN ? AND ?';
		params.push(fromS, toS);
	} else if (date && isValidYmd(String(date).slice(0, 10))) {
		where += ' AND DATE(gi.PROGRAM_DATE) = ?';
		params.push(String(date).slice(0, 10));
	}

	return { where, params };
}

function parseAmount(value) {
	const clean = String(value ?? '').replace(/,/g, '').trim();
	if (clean === '' || Number.isNaN(Number(clean))) return null;
	return Number(clean);
}

function parseCommissionType(value) {
	const n = parseInt(value, 10);
	return n === 1 || n === 2 || n === 3 ? n : null;
}

function parseGameType(value) {
	const raw = String(value || '').trim().toUpperCase();
	return raw === 'TELEBET' ? 'TELEBET' : 'LIVE';
}

function parseOptionalId(value) {
	if (value === undefined || value === null || String(value).trim() === '') return null;
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function parseOptionalDateTime(value) {
	const raw = String(value || '').trim();
	if (!raw) return null;
	const dt = new Date(raw);
	return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizePayload(body) {
	const programDate = String(body.programDate || '').trim().slice(0, 10);
	if (!isValidYmd(programDate)) {
		return { error: 'Program Date is required (YYYY-MM-DD).' };
	}

	const gameEnded = parseOptionalDateTime(body.gameEnded);
	const gameEndKind = gameEnded ? 'datetime' : 'end_game';

	const commissionType = parseCommissionType(body.commissionType);
	if (!commissionType) {
		return { error: 'Game Rate type is required (R, S, or L).' };
	}

	const commissionPct = parseAmount(body.commissionPercentage);
	if (commissionPct === null || commissionPct < 0) {
		return { error: 'Game Rate percentage is required.' };
	}

	const amounts = {
		buyIn: parseAmount(body.buyIn),
		cashOut: parseAmount(body.cashOut),
		winLoss: parseAmount(body.winLoss),
		rolling: parseAmount(body.rolling),
		commission: parseAmount(body.commission),
		addCharge: parseAmount(body.addCharge),
		totalSettlement: parseAmount(body.totalSettlement)
	};

	for (const [key, val] of Object.entries(amounts)) {
		if (val === null) {
			return { error: `Invalid amount for ${key}.` };
		}
	}

	const gameNo = String(body.gameNo || '').trim();
	if (!gameNo) {
		return { error: 'Game # is required.' };
	}

	return {
		programDate,
		gameStart: parseOptionalDateTime(body.gameStart),
		gameType: parseGameType(body.gameType),
		gameNo,
		accountId: parseOptionalId(body.accountId),
		guestId: parseOptionalId(body.guestId),
		...amounts,
		commissionType,
		commissionPercentage: commissionPct,
		gameEndKind,
		gameEnded
	};
}

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

/** List rows from game_information table only. */
router.get('/game_information_data', checkSession, async (req, res) => {
	try {
		const filter = buildProgramDateWhere(req.query);
		if (filter.error) return res.status(400).json({ error: filter.error });

		const [rows] = await pool.execute(
			`${GAME_INFORMATION_SELECT} ${filter.where} ORDER BY gi.PROGRAM_DATE ASC, gi.IDNo ASC`,
			filter.params
		);
		res.json(rows);
	} catch (err) {
		console.error('[game_information_data]', err);
		res.status(500).json({ error: 'Error fetching data' });
	}
});

router.post('/game_information_data', checkSession, async (req, res) => {
	try {
		const payload = normalizePayload(req.body);
		if (payload.error) return res.status(400).json({ error: payload.error });

		const now = new Date();
		await pool.execute(
			`INSERT INTO game_information (
				PROGRAM_DATE, GAME_START, GAME_TYPE, GAME_NO, ACCOUNT_ID, GUEST_ID,
				BUY_IN, CASH_OUT, WIN_LOSS, ROLLING,
				COMMISSION_TYPE, COMMISSION_PERCENTAGE, COMMISSION, ADD_CHARGE, TOTAL_SETTLEMENT,
				GAME_END_KIND, GAME_ENDED, ENCODED_BY, ENCODED_DT
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				payload.programDate,
				payload.gameStart,
				payload.gameType,
				payload.gameNo,
				payload.accountId,
				payload.guestId,
				payload.buyIn,
				payload.cashOut,
				payload.winLoss,
				payload.rolling,
				payload.commissionType,
				payload.commissionPercentage,
				payload.commission,
				payload.addCharge,
				payload.totalSettlement,
				payload.gameEndKind,
				payload.gameEnded,
				req.session.user_id,
				now
			]
		);

		res.json({ message: 'Saved successfully' });
	} catch (err) {
		console.error('[game_information_data POST]', err);
		res.status(500).json({ error: 'Failed to save game' });
	}
});

router.put('/game_information_data/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: 'Invalid ID' });

		const payload = normalizePayload(req.body);
		if (payload.error) return res.status(400).json({ error: payload.error });

		const now = new Date();
		const [result] = await pool.execute(
			`UPDATE game_information SET
				PROGRAM_DATE = ?, GAME_START = ?, GAME_TYPE = ?, GAME_NO = ?, ACCOUNT_ID = ?, GUEST_ID = ?,
				BUY_IN = ?, CASH_OUT = ?, WIN_LOSS = ?, ROLLING = ?,
				COMMISSION_TYPE = ?, COMMISSION_PERCENTAGE = ?, COMMISSION = ?, ADD_CHARGE = ?, TOTAL_SETTLEMENT = ?,
				GAME_END_KIND = ?, GAME_ENDED = ?, EDITED_BY = ?, EDITED_DT = ?
			WHERE IDNo = ? AND ACTIVE = 1`,
			[
				payload.programDate,
				payload.gameStart,
				payload.gameType,
				payload.gameNo,
				payload.accountId,
				payload.guestId,
				payload.buyIn,
				payload.cashOut,
				payload.winLoss,
				payload.rolling,
				payload.commissionType,
				payload.commissionPercentage,
				payload.commission,
				payload.addCharge,
				payload.totalSettlement,
				payload.gameEndKind,
				payload.gameEnded,
				req.session.user_id,
				now,
				id
			]
		);

		if (!result.affectedRows) {
			return res.status(404).json({ error: 'Record not found' });
		}

		res.json({ message: 'Updated successfully' });
	} catch (err) {
		console.error('[game_information_data PUT]', err);
		res.status(500).json({ error: 'Failed to update game' });
	}
});

router.put('/game_information_data/remove/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!id) return res.status(400).json({ error: 'Invalid ID' });

		const now = new Date();
		const [result] = await pool.execute(
			`UPDATE game_information SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1`,
			[req.session.user_id, now, id]
		);

		if (!result.affectedRows) {
			return res.status(404).json({ error: 'Record not found' });
		}

		res.json({ message: 'Deleted successfully' });
	} catch (err) {
		console.error('[game_information_data remove]', err);
		res.status(500).json({ error: 'Failed to delete game' });
	}
});

module.exports = router;
