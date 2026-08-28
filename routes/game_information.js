const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { buildTableExportXlsx, sendTableExportResponse } = require('../utils/ExcelExportService');
const { fetchGamebookGameInformationRows } = require('../utils/gameInformationGamebook');

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

async function findAgentsAssignedToOtherGroups(agentIds, excludeGroupId) {
	if (!agentIds.length) return [];
	const placeholders = agentIds.map(() => '?').join(', ');
	const params = [...agentIds];
	let sql = `
		SELECT m.AGENT_ID, g.GROUP_NAME, ag.AGENT_CODE, ag.NAME AS agent_name
		FROM gi_agent_group_member m
		JOIN gi_agent_group g ON g.IDNo = m.GROUP_ID AND g.ACTIVE = 1
		JOIN agent ag ON ag.IDNo = m.AGENT_ID
		WHERE m.AGENT_ID IN (${placeholders})`;
	if (excludeGroupId) {
		sql += ' AND m.GROUP_ID <> ?';
		params.push(excludeGroupId);
	}
	const [rows] = await pool.execute(sql, params);
	return rows;
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
			`SELECT IDNo AS group_id, GROUP_NAME, SORT_ORDER
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

		const conflicts = await findAgentsAssignedToOtherGroups(agentIds, null);
		if (conflicts.length) {
			const names = conflicts
				.map((c) => `${agentDisplayLabel(c.AGENT_CODE, c.agent_name)} (${c.GROUP_NAME})`)
				.join(', ');
			return res.status(400).json({ error: `Agent already in another group: ${names}` });
		}

		const now = new Date();
		const [insertResult] = await pool.execute(
			`INSERT INTO gi_agent_group (GROUP_NAME, SORT_ORDER, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?)`,
			[groupName, parseInt(req.body.sortOrder, 10) || 0, req.session.user_id, now]
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

		const conflicts = await findAgentsAssignedToOtherGroups(agentIds, groupId);
		if (conflicts.length) {
			return res.status(400).json({
				error: `One or more agents are already assigned to another group (${conflicts[0].GROUP_NAME}).`
			});
		}

		const now = new Date();
		const [result] = await pool.execute(
			`UPDATE gi_agent_group SET
				GROUP_NAME = ?, SORT_ORDER = ?, EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[
				groupName,
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

router.post('/game_information/export_xlsx', checkSession, async (req, res) => {
	try {
		const { headers, rows, filename } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'gameInformation',
			sheetName: 'Game Information',
			headers,
			rows,
			filename: filename || 'Game_Information-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('[game_information/export_xlsx]', err);
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

module.exports = router;
