const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession } = require('./auth');
const { DEFAULT_GAME_GROUP } = require('../utils/ensureGameGroupSchema');

function requireManageGameGroup(req, res, next) {
	if (req.session.permissions === 2) {
		return res.status(403).json({ error: 'You do not have permission to manage groups' });
	}
	next();
}

function isDefaultGroupName(name) {
	return String(name || '').trim().toLowerCase() === DEFAULT_GAME_GROUP.toLowerCase();
}

router.get('/game_group_data', checkSession, async (req, res) => {
	try {
		const [result] = await pool.execute(
			`SELECT * FROM game_group WHERE ACTIVE = 1
			 ORDER BY (LOWER(TRIM(NAME)) = LOWER(?)) DESC, NAME ASC`,
			[DEFAULT_GAME_GROUP]
		);
		res.json(result);
	} catch (error) {
		console.error('Error fetching game group data:', error);
		res.status(500).send('Error fetching data');
	}
});

router.post('/add_game_group', checkSession, requireManageGameGroup, async (req, res) => {
	const { txtName } = req.body;
	const date_now = new Date();
	const name = txtName != null ? String(txtName).trim() : '';

	if (!name) {
		return res.status(400).json({ success: false, error: 'Group name is required' });
	}

	try {
		const [existing] = await pool.execute(
			'SELECT IDNo FROM game_group WHERE ACTIVE = 1 AND LOWER(TRIM(NAME)) = LOWER(TRIM(?)) LIMIT 1',
			[name]
		);
		if (existing.length) {
			return res.status(400).json({ success: false, error: 'Group already exists' });
		}

		const [result] = await pool.execute(
			'INSERT INTO game_group (NAME, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)',
			[name, req.session.user_id, date_now]
		);
		res.json({ success: true, id: result.insertId, name });
	} catch (err) {
		console.error('Error inserting game group:', err);
		res.status(500).json({ success: false, error: 'Error inserting game group' });
	}
});

router.put('/game_group/:id', checkSession, requireManageGameGroup, async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const { txtName } = req.body;
	const date_now = new Date();
	const name = txtName != null ? String(txtName).trim() : '';

	if (!id) {
		return res.status(400).json({ error: 'Invalid group id' });
	}
	if (!name) {
		return res.status(400).json({ error: 'Group name is required' });
	}

	try {
		const [currentRows] = await pool.execute(
			'SELECT NAME FROM game_group WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
			[id]
		);
		if (!currentRows.length) {
			return res.status(404).json({ error: 'Group not found' });
		}
		if (isDefaultGroupName(currentRows[0].NAME)) {
			return res.status(400).json({ error: `"${DEFAULT_GAME_GROUP}" cannot be edited.` });
		}

		const [existing] = await pool.execute(
			'SELECT IDNo FROM game_group WHERE ACTIVE = 1 AND LOWER(TRIM(NAME)) = LOWER(TRIM(?)) AND IDNo != ? LIMIT 1',
			[name, id]
		);
		if (existing.length) {
			return res.status(400).json({ error: 'Group already exists' });
		}

		await pool.execute(
			'UPDATE game_group SET NAME = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[name, req.session.user_id, date_now, id]
		);
		res.send('Group updated successfully');
	} catch (err) {
		console.error('Error updating game group:', err);
		res.status(500).json({ error: 'Error updating game group' });
	}
});

router.put('/game_group/remove/:id', checkSession, requireManageGameGroup, async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const date_now = new Date();

	if (!id) {
		return res.status(400).json({ error: 'Invalid group id' });
	}

	try {
		const [groupRows] = await pool.execute(
			'SELECT IDNo, NAME FROM game_group WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
			[id]
		);
		if (!groupRows.length) {
			return res.status(404).json({ error: 'Group not found' });
		}
		if (isDefaultGroupName(groupRows[0].NAME)) {
			return res.status(400).json({ error: `"${DEFAULT_GAME_GROUP}" cannot be deleted.` });
		}

		const [inUse] = await pool.execute(
			'SELECT COUNT(*) AS cnt FROM game_list WHERE GROUP_ID = ? AND ACTIVE != 0',
			[id]
		);
		if (Number(inUse[0]?.cnt || 0) > 0) {
			return res.status(400).json({ error: 'This group is currently used by one or more games and cannot be deleted.' });
		}

		await pool.execute(
			'UPDATE game_group SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[0, req.session.user_id, date_now, id]
		);
		res.send('Group archived successfully');
	} catch (err) {
		console.error('Error archiving game group:', err);
		res.status(500).json({ error: 'Error archiving game group' });
	}
});

module.exports = router;
