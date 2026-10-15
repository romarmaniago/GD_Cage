const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { buildTableExportXlsx, sendTableExportResponse } = require('../utils/ExcelExportService');
const { buildGameInformationGroupedExportXlsx } = require('../utils/GameInformationExportService');
const { fetchGamebookGameInformationRows } = require('../utils/gameInformationGamebook');
const { parseShareRollingInput } = require('../utils/commissionCalc');

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
		ag.IDNo AS AGENT_ID,
		COALESCE(NULLIF(TRIM(ag.AGENT_CODE), ''), '') AS AGENT_CODE,
		COALESCE(NULLIF(TRIM(ag.NAME), ''), '') AS AGENT_NAME,
		COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS GUEST_NAME,
		g.MEMBERSHIP_NO AS membership_no,
		gi.BUY_IN,
		gi.CASH_OUT,
		gi.WIN_LOSS,
		gi.ROLLING,
		gi.COMMISSION_TYPE,
		gi.COMMISSION_PERCENTAGE,
		gi.SHARE_PERCENTAGE,
		gi.ROLLING_PERCENTAGE,
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

/** Share 0 / Rolling 100 = Rolling, Share only = Shared, anything else = Share + Rolling. */
function deriveCommissionType(sharePct, rollingPct) {
	if (sharePct === 0 && rollingPct === 100) return 1;
	if (sharePct > 0 && rollingPct === 0) return 2;
	return 3;
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

	const shareRolling = parseShareRollingInput({
		share_percentage: body.sharePercentage,
		rolling_percentage: body.rollingPercentage
	});
	if (shareRolling.error) return { error: shareRolling.error };
	const commissionType = deriveCommissionType(shareRolling.sharePct, shareRolling.rollingPct);

	const ratePct = parseAmount(body.commissionPercentage);
	if (commissionType !== 2 && (ratePct === null || ratePct < 0)) {
		return { error: 'Rate percentage is required.' };
	}
	// Shared keeps Game Book semantics: COMMISSION_PERCENTAGE = Share %.
	const commissionPct = commissionType === 2 ? shareRolling.sharePct : ratePct;

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

	const accountId = parseOptionalId(body.accountId);
	if (!accountId) {
		return { error: 'Acct No / Name is required.' };
	}

	return {
		programDate,
		gameStart: parseOptionalDateTime(body.gameStart),
		gameType: parseGameType(body.gameType),
		gameNo,
		accountId,
		guestId: parseOptionalId(body.guestId),
		...amounts,
		commissionType,
		commissionPercentage: commissionPct,
		sharePercentage: shareRolling.sharePct,
		rollingPercentage: shareRolling.rollingPct,
		gameEndKind,
		gameEnded
	};
}

router.get('/game_information', checkSession, function (req, res) {
	const data = sessions(req, 'game_information');
	data.permissions = req.session.permissions;
	res.render('game_information/game_information', data);
});

router.get('/game_information_report', checkSession, function (req, res) {
	const data = sessions(req, 'game_information_report');
	data.permissions = req.session.permissions;
	res.render('game_information/report', data);
});

/** Report name corrections: { agentId: name } — replaces the account owner's name on the Report only */
router.get('/game_information_report/names', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute('SELECT AGENT_ID, NAME FROM gi_report_name');
		const names = {};
		for (const row of rows) names[row.AGENT_ID] = row.NAME;
		res.json(names);
	} catch (err) {
		console.error('[game_information_report/names]', err);
		res.status(500).json({ error: 'Error fetching names' });
	}
});

/** Saves a corrected name; an empty name removes the correction (back to the owner's name) */
router.put('/game_information_report/name/:agentId', checkSession, async (req, res) => {
	try {
		const p = req.session.permissions;
		if (p === 2 || p === '2') return res.status(403).json({ error: 'Forbidden' });

		const agentId = parseInt(req.params.agentId, 10);
		if (!agentId) return res.status(400).json({ error: 'Invalid account' });
		const name = String((req.body && req.body.name) || '').replace(/\s+/g, ' ').trim().slice(0, 150);

		if (!name) {
			await pool.execute('DELETE FROM gi_report_name WHERE AGENT_ID = ?', [agentId]);
		} else {
			await pool.execute(
				`INSERT INTO gi_report_name (AGENT_ID, NAME, EDITED_BY, EDITED_DT) VALUES (?, ?, ?, NOW())
				 ON DUPLICATE KEY UPDATE NAME = VALUES(NAME), EDITED_BY = VALUES(EDITED_BY), EDITED_DT = VALUES(EDITED_DT)`,
				[agentId, name, req.session.user_id || null]
			);
		}
		res.json({ name: name || null });
	} catch (err) {
		console.error('[game_information_report/name PUT]', err);
		res.status(500).json({ error: 'Failed to save name' });
	}
});

/** REPORT card settings: poster = JPEG/PNG data URL (scaled down in the browser), raffle / message = text */
const REPORT_SETTING_KEYS = ['poster', 'raffle', 'message'];
const REPORT_POSTER_MAX_CHARS = 8 * 1024 * 1024;

router.get('/game_information_report/settings', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute('SELECT SETTING_KEY, VALUE FROM gi_report_setting');
		const settings = { poster: null, raffle: null, message: null };
		for (const row of rows) {
			if (REPORT_SETTING_KEYS.includes(row.SETTING_KEY)) settings[row.SETTING_KEY] = row.VALUE;
		}
		res.json(settings);
	} catch (err) {
		console.error('[game_information_report/settings]', err);
		res.status(500).json({ error: 'Error fetching settings' });
	}
});

/** Saves one setting; an empty value removes it (card goes back to the default) */
router.put('/game_information_report/settings/:key', checkSession, async (req, res) => {
	try {
		const p = req.session.permissions;
		if (p === 2 || p === '2') return res.status(403).json({ error: 'Forbidden' });

		const key = String(req.params.key || '');
		if (!REPORT_SETTING_KEYS.includes(key)) return res.status(400).json({ error: 'Invalid setting' });

		let value = String((req.body && req.body.value) || '').trim();
		if (key === 'poster') {
			if (value && !/^data:image\/(jpeg|png|webp);base64,/.test(value)) {
				return res.status(400).json({ error: 'Invalid image' });
			}
			if (value.length > REPORT_POSTER_MAX_CHARS) return res.status(400).json({ error: 'Image is too large' });
		} else {
			value = value.replace(/\s+/g, ' ').slice(0, 500);
		}

		if (!value) {
			await pool.execute('DELETE FROM gi_report_setting WHERE SETTING_KEY = ?', [key]);
		} else {
			await pool.execute(
				`INSERT INTO gi_report_setting (SETTING_KEY, VALUE, EDITED_BY, EDITED_DT) VALUES (?, ?, ?, NOW())
				 ON DUPLICATE KEY UPDATE VALUE = VALUES(VALUE), EDITED_BY = VALUES(EDITED_BY), EDITED_DT = VALUES(EDITED_DT)`,
				[key, value, req.session.user_id || null]
			);
		}
		res.json({ value: value || null });
	} catch (err) {
		console.error('[game_information_report/settings PUT]', err);
		res.status(500).json({ error: 'Failed to save setting' });
	}
});

/** Program-date range key for rolling corrections: both '' for All */
function reportRangeKey(source) {
	const from = String((source && source.programFrom) || '').slice(0, 10);
	const to = String((source && source.programTo) || '').slice(0, 10);
	if (!from && !to) return { from: '', to: '' };
	if (!isValidYmd(from) || !isValidYmd(to)) return null;
	return { from, to };
}

/** Rolling corrections for one range: { agentId: rolling } */
router.get('/game_information_report/rolling', checkSession, async (req, res) => {
	try {
		const range = reportRangeKey(req.query);
		if (!range) return res.status(400).json({ error: 'Invalid program date range' });
		const [rows] = await pool.execute(
			'SELECT AGENT_ID, ROLLING FROM gi_report_rolling WHERE DATE_FROM = ? AND DATE_TO = ?',
			[range.from, range.to]
		);
		const rolling = {};
		for (const row of rows) rolling[row.AGENT_ID] = Number(row.ROLLING);
		res.json(rolling);
	} catch (err) {
		console.error('[game_information_report/rolling]', err);
		res.status(500).json({ error: 'Error fetching rolling' });
	}
});

/** Saves a corrected rolling for the range; rolling null/'' removes the correction */
router.put('/game_information_report/rolling/:agentId', checkSession, async (req, res) => {
	try {
		const p = req.session.permissions;
		if (p === 2 || p === '2') return res.status(403).json({ error: 'Forbidden' });

		const agentId = parseInt(req.params.agentId, 10);
		if (!agentId) return res.status(400).json({ error: 'Invalid account' });
		const range = reportRangeKey(req.body);
		if (!range) return res.status(400).json({ error: 'Invalid program date range' });

		const raw = req.body ? req.body.rolling : null;
		if (raw === null || raw === undefined || String(raw).trim() === '') {
			await pool.execute(
				'DELETE FROM gi_report_rolling WHERE AGENT_ID = ? AND DATE_FROM = ? AND DATE_TO = ?',
				[agentId, range.from, range.to]
			);
			return res.json({ rolling: null });
		}

		const rolling = parseAmount(raw);
		if (rolling === null) return res.status(400).json({ error: 'Invalid rolling amount' });
		await pool.execute(
			`INSERT INTO gi_report_rolling (AGENT_ID, DATE_FROM, DATE_TO, ROLLING, EDITED_BY, EDITED_DT) VALUES (?, ?, ?, ?, ?, NOW())
			 ON DUPLICATE KEY UPDATE ROLLING = VALUES(ROLLING), EDITED_BY = VALUES(EDITED_BY), EDITED_DT = VALUES(EDITED_DT)`,
			[agentId, range.from, range.to, rolling, req.session.user_id || null]
		);
		res.json({ rolling });
	} catch (err) {
		console.error('[game_information_report/rolling PUT]', err);
		res.status(500).json({ error: 'Failed to save rolling' });
	}
});

// Categorize Group page retired — groups are now managed as a filter on Analytics.
router.get('/categorize_group', checkSession, function (req, res) {
	res.redirect(302, '/commission_analytics');
});

/**
 * List Game Information rows: manual entries from the game_information table plus
 * read-only records sourced from the Game Book (game_list). Game Book rows carry no
 * manual_id and are not editable.
 */
router.get('/game_information_data', checkSession, async (req, res) => {
	try {
		const filter = buildProgramDateWhere(req.query);
		if (filter.error) return res.status(400).json({ error: filter.error });

		const [manualRows] = await pool.execute(
			`${GAME_INFORMATION_SELECT} ${filter.where} ORDER BY gi.PROGRAM_DATE ASC, gi.IDNo ASC`,
			filter.params
		);

		const gamebook = await fetchGamebookGameInformationRows(pool, req.query);
		if (gamebook.error) return res.status(400).json({ error: gamebook.error });

		const rows = manualRows.concat(gamebook.rows);
		const toTime = (v) => {
			const t = new Date(v).getTime();
			return Number.isNaN(t) ? 0 : t;
		};
		rows.sort((a, b) => {
			const dateCmp = toTime(a.PROGRAM_DATE) - toTime(b.PROGRAM_DATE);
			if (dateCmp !== 0) return dateCmp;
			return toTime(a.GAME_START) - toTime(b.GAME_START);
		});

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
				COMMISSION_TYPE, COMMISSION_PERCENTAGE, SHARE_PERCENTAGE, ROLLING_PERCENTAGE,
				COMMISSION, ADD_CHARGE, TOTAL_SETTLEMENT,
				GAME_END_KIND, GAME_ENDED, ENCODED_BY, ENCODED_DT
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				payload.sharePercentage,
				payload.rollingPercentage,
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
				COMMISSION_TYPE = ?, COMMISSION_PERCENTAGE = ?, SHARE_PERCENTAGE = ?, ROLLING_PERCENTAGE = ?,
				COMMISSION = ?, ADD_CHARGE = ?, TOTAL_SETTLEMENT = ?,
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
				payload.sharePercentage,
				payload.rollingPercentage,
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

/** True when another active group already uses this name (case/space-insensitive). */
async function isGroupNameTaken(groupName, excludeGroupId) {
	let sql = 'SELECT IDNo FROM gi_agent_group WHERE ACTIVE = 1 AND LOWER(TRIM(GROUP_NAME)) = LOWER(TRIM(?))';
	const params = [groupName];
	if (excludeGroupId) {
		sql += ' AND IDNo <> ?';
		params.push(excludeGroupId);
	}
	const [rows] = await pool.execute(sql + ' LIMIT 1', params);
	return rows.length > 0;
}

function parseGroupRemarks(body) {
	const remarks = String(body.remarks || '').trim().slice(0, 255);
	return remarks || null;
}

function parseAgentIdArray(body) {
	const raw = body.agentIds ?? body.agent_ids;
	if (Array.isArray(raw)) {
		return raw.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0);
	}
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				return parsed.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0);
			}
		} catch (_) {
			/* comma-separated fallback */
		}
		return raw
			.split(',')
			.map((x) => parseInt(x.trim(), 10))
			.filter((n) => Number.isFinite(n) && n > 0);
	}
	return [];
}

function agentDisplayLabel(code, name) {
	const c = String(code || '').trim();
	const n = String(name || '').trim();
	if (c && n) return `${c} - ${n}`;
	return c || n || '—';
}

async function replaceGroupMembers(groupId, agentIds) {
	await pool.execute('DELETE FROM gi_agent_group_member WHERE GROUP_ID = ?', [groupId]);
	for (const agentId of agentIds) {
		await pool.execute(
			'INSERT INTO gi_agent_group_member (GROUP_ID, AGENT_ID) VALUES (?, ?)',
			[groupId, agentId]
		);
	}
}

function sumGameTotals(rows) {
	const totals = {
		game_count: 0,
		buy_in: 0,
		cash_out: 0,
		win_loss: 0,
		rolling: 0,
		commission: 0,
		add_charge: 0,
		total_settlement: 0
	};
	for (const row of rows) {
		totals.game_count += 1;
		totals.buy_in += parseFloat(row.BUY_IN) || 0;
		totals.cash_out += parseFloat(row.CASH_OUT) || 0;
		totals.win_loss += parseFloat(row.WIN_LOSS) || 0;
		totals.rolling += parseFloat(row.ROLLING) || 0;
		totals.commission += parseFloat(row.COMMISSION) || 0;
		totals.add_charge += parseFloat(row.ADD_CHARGE) || 0;
		totals.total_settlement += parseFloat(row.TOTAL_SETTLEMENT) || 0;
	}
	return totals;
}

/** List agent groups with members. */
router.get('/categorize_group_groups', checkSession, async (req, res) => {
	try {
		const [groups] = await pool.execute(
			`SELECT IDNo AS group_id, GROUP_NAME, REMARKS, SORT_ORDER
			 FROM gi_agent_group
			 WHERE ACTIVE = 1
			 ORDER BY SORT_ORDER ASC, GROUP_NAME ASC`
		);
		const [members] = await pool.execute(
			`SELECT m.GROUP_ID, m.AGENT_ID,
				ag.AGENT_CODE, ag.NAME AS agent_name
			 FROM gi_agent_group_member m
			 JOIN gi_agent_group g ON g.IDNo = m.GROUP_ID AND g.ACTIVE = 1
			 JOIN agent ag ON ag.IDNo = m.AGENT_ID AND ag.ACTIVE = 1`
		);

		const memberMap = {};
		for (const m of members) {
			const gid = m.GROUP_ID;
			if (!memberMap[gid]) memberMap[gid] = [];
			memberMap[gid].push({
				agent_id: m.AGENT_ID,
				agent_code: m.AGENT_CODE,
				agent_name: m.agent_name,
				label: agentDisplayLabel(m.AGENT_CODE, m.agent_name)
			});
		}

		const result = groups.map((g) => {
			const agents = memberMap[g.group_id] || [];
			return {
				group_id: g.group_id,
				group_name: g.GROUP_NAME,
				remarks: g.REMARKS || '',
				sort_order: g.SORT_ORDER,
				agents,
				agents_text: agents.map((a) => a.label).join(', ')
			};
		});

		res.json(result);
	} catch (err) {
		console.error('[categorize_group_groups GET]', err);
		res.status(500).json({ error: 'Error fetching agent groups' });
	}
});

router.post('/categorize_group_groups', checkSession, async (req, res) => {
	try {
		const groupName = String(req.body.groupName || req.body.group_name || '').trim();
		if (!groupName) return res.status(400).json({ error: 'Group name is required.' });

		const agentIds = parseAgentIdArray(req.body);
		if (!agentIds.length) return res.status(400).json({ error: 'Select at least one agent.' });

		if (await isGroupNameTaken(groupName, null)) {
			return res.status(400).json({ error: `Group name "${groupName}" already exists.` });
		}

		const now = new Date();
		const [insertResult] = await pool.execute(
			`INSERT INTO gi_agent_group (GROUP_NAME, REMARKS, SORT_ORDER, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?)`,
			[groupName, parseGroupRemarks(req.body), parseInt(req.body.sortOrder, 10) || 0, req.session.user_id, now]
		);

		await replaceGroupMembers(insertResult.insertId, agentIds);
		res.json({ message: 'Group created successfully', group_id: insertResult.insertId });
	} catch (err) {
		console.error('[categorize_group_groups POST]', err);
		res.status(500).json({ error: 'Failed to create group' });
	}
});

router.put('/categorize_group_groups/:id', checkSession, async (req, res) => {
	try {
		const groupId = parseInt(req.params.id, 10);
		if (!groupId) return res.status(400).json({ error: 'Invalid group ID' });

		const groupName = String(req.body.groupName || req.body.group_name || '').trim();
		if (!groupName) return res.status(400).json({ error: 'Group name is required.' });

		const agentIds = parseAgentIdArray(req.body);
		if (!agentIds.length) return res.status(400).json({ error: 'Select at least one agent.' });

		if (await isGroupNameTaken(groupName, groupId)) {
			return res.status(400).json({ error: `Group name "${groupName}" already exists.` });
		}

		const now = new Date();
		const [result] = await pool.execute(
			`UPDATE gi_agent_group SET
				GROUP_NAME = ?, REMARKS = ?, SORT_ORDER = ?, EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[
				groupName,
				parseGroupRemarks(req.body),
				parseInt(req.body.sortOrder, 10) || 0,
				req.session.user_id,
				now,
				groupId
			]
		);

		if (!result.affectedRows) {
			return res.status(404).json({ error: 'Group not found' });
		}

		await replaceGroupMembers(groupId, agentIds);
		res.json({ message: 'Group updated successfully' });
	} catch (err) {
		console.error('[categorize_group_groups PUT]', err);
		res.status(500).json({ error: 'Failed to update group' });
	}
});

router.put('/categorize_group_groups/remove/:id', checkSession, async (req, res) => {
	try {
		const groupId = parseInt(req.params.id, 10);
		if (!groupId) return res.status(400).json({ error: 'Invalid group ID' });

		const now = new Date();
		const [result] = await pool.execute(
			`UPDATE gi_agent_group SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1`,
			[req.session.user_id, now, groupId]
		);

		if (!result.affectedRows) {
			return res.status(404).json({ error: 'Group not found' });
		}

		await pool.execute('DELETE FROM gi_agent_group_member WHERE GROUP_ID = ?', [groupId]);
		res.json({ message: 'Group deleted successfully' });
	} catch (err) {
		console.error('[categorize_group_groups remove]', err);
		res.status(500).json({ error: 'Failed to delete group' });
	}
});

/** Aggregated game totals per agent group for a program date range. */
router.get('/categorize_group_summary', checkSession, async (req, res) => {
	try {
		const filter = buildProgramDateWhere(req.query);
		if (filter.error) return res.status(400).json({ error: filter.error });

		const [groups] = await pool.execute(
			`SELECT IDNo AS group_id, GROUP_NAME
			 FROM gi_agent_group
			 WHERE ACTIVE = 1
			 ORDER BY SORT_ORDER ASC, GROUP_NAME ASC`
		);
		const [members] = await pool.execute(
			`SELECT m.GROUP_ID, m.AGENT_ID, ag.AGENT_CODE, ag.NAME AS agent_name
			 FROM gi_agent_group_member m
			 JOIN gi_agent_group g ON g.IDNo = m.GROUP_ID AND g.ACTIVE = 1
			 JOIN agent ag ON ag.IDNo = m.AGENT_ID`
		);
		const [games] = await pool.execute(
			`${GAME_INFORMATION_SELECT} ${filter.where} ORDER BY gi.PROGRAM_DATE ASC, gi.IDNo ASC`,
			filter.params
		);

		const groupAgents = {};
		const agentToGroup = {};
		for (const g of groups) {
			groupAgents[g.group_id] = [];
		}
		for (const m of members) {
			if (!groupAgents[m.GROUP_ID]) continue;
			const label = agentDisplayLabel(m.AGENT_CODE, m.agent_name);
			groupAgents[m.GROUP_ID].push(label);
			agentToGroup[m.AGENT_ID] = m.GROUP_ID;
		}

		const gamesByGroup = {};

		for (const g of groups) {
			gamesByGroup[g.group_id] = [];
		}

		for (const game of games) {
			const agentId = game.AGENT_ID ? parseInt(game.AGENT_ID, 10) : null;
			if (!agentId) continue;
			const gid = agentToGroup[agentId];
			if (gid) {
				gamesByGroup[gid].push(game);
			}
		}

		const rows = [];
		const groupedGames = [];

		for (const g of groups) {
			const groupGames = gamesByGroup[g.group_id] || [];
			groupedGames.push(...groupGames);
			const totals = sumGameTotals(groupGames);
			rows.push({
				group_id: g.group_id,
				group_name: g.GROUP_NAME,
				agents_text: (groupAgents[g.group_id] || []).join(', '),
				is_custom_group: true,
				games: groupGames,
				...totals
			});
		}

		const grand = sumGameTotals(groupedGames);
		res.json({ rows, grand });
	} catch (err) {
		console.error('[categorize_group_summary]', err);
		res.status(500).json({ error: 'Error fetching grouped summary' });
	}
});

router.post('/game_information/export_xlsx_grouped', checkSession, async (req, res) => {
	try {
		const { rows, filename } = req.body || {};
		const result = await buildGameInformationGroupedExportXlsx({
			rows,
			filename: filename || 'Game_Information-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('[game_information/export_xlsx_grouped]', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

router.post('/categorize_group/group_games_export_xlsx', checkSession, async (req, res) => {
	try {
		const { headers, rows, filename } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'groupGamesDetail',
			sheetName: 'Group Games',
			headers,
			rows,
			filename: filename || 'Group_Games-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('[categorize_group/group_games_export_xlsx]', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

router.post('/categorize_group_summary/export_xlsx', checkSession, async (req, res) => {
	try {
		const { headers, rows, filename } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'categorizeGroupSummary',
			sheetName: 'Grouped Games Summary',
			headers,
			rows,
			filename: filename || 'Categorize_Group-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('[categorize_group_summary/export_xlsx]', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

router.post('/game_information_report/export_xlsx', checkSession, async (req, res) => {
	try {
		const { headers, rows, filename } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'gameInformationReport',
			sheetName: 'Report',
			headers,
			rows,
			filename: filename || 'Report-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('[game_information_report/export_xlsx]', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

module.exports = router;
