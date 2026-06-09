const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

function parseDirection(raw) {
	if (raw === undefined || raw === null || raw === '') return null;
	const n = parseInt(raw, 10);
	return n === 1 || n === 2 ? n : null;
}

router.get('/services_category', checkSession, function (req, res) {
	const permissions = req.session.permissions;

	res.render('popups/services_category', {
		...sessions(req, 'services_category'),
		permissions: permissions
	});
});

router.get('/services_category_data', checkSession, async (req, res) => {
	try {
		const [result] = await pool.execute(
			'SELECT * FROM services_category WHERE ACTIVE = 1 ORDER BY CATEGORY ASC'
		);
		res.json(result);
	} catch (error) {
		console.error('Error fetching services category data:', error);
		res.status(500).send('Error fetching data');
	}
});

router.post('/add_services_category', checkSession, async (req, res) => {
	const { txtCategory, txtDirection } = req.body;
	const date_now = new Date();
	const name = txtCategory != null ? String(txtCategory).trim() : '';
	const direction = parseDirection(txtDirection);

	if (!name) {
		return res.status(400).json({ success: false, error: 'Category name is required' });
	}

	try {
		const [existing] = await pool.execute(
			'SELECT IDNo FROM services_category WHERE ACTIVE = 1 AND LOWER(TRIM(CATEGORY)) = LOWER(TRIM(?)) LIMIT 1',
			[name]
		);
		if (existing.length) {
			return res.status(400).json({ success: false, error: 'Category already exists' });
		}

		const [result] = await pool.execute(
			'INSERT INTO services_category (CATEGORY, DIRECTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?)',
			[name, direction, req.session.user_id, date_now]
		);
		res.json({ success: true, id: result.insertId, category: name });
	} catch (err) {
		console.error('Error inserting services category:', err);
		res.status(500).json({ success: false, error: 'Error inserting services category' });
	}
});

router.put('/services_category/:id', checkSession, async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const { txtCategory, txtDirection } = req.body;
	const date_now = new Date();
	const name = txtCategory != null ? String(txtCategory).trim() : '';
	const direction = parseDirection(txtDirection);

	if (!id) {
		return res.status(400).json({ error: 'Invalid category id' });
	}
	if (!name) {
		return res.status(400).json({ error: 'Category name is required' });
	}

	try {
		const [existing] = await pool.execute(
			'SELECT IDNo FROM services_category WHERE ACTIVE = 1 AND LOWER(TRIM(CATEGORY)) = LOWER(TRIM(?)) AND IDNo != ? LIMIT 1',
			[name, id]
		);
		if (existing.length) {
			return res.status(400).json({ error: 'Category already exists' });
		}

		await pool.execute(
			'UPDATE services_category SET CATEGORY = ?, DIRECTION = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[name, direction, req.session.user_id, date_now, id]
		);
		res.send('Services category updated successfully');
	} catch (err) {
		console.error('Error updating services category:', err);
		res.status(500).json({ error: 'Error updating services category' });
	}
});

router.put('/services_category/remove/:id', checkSession, async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const date_now = new Date();

	if (!id) {
		return res.status(400).json({ error: 'Invalid category id' });
	}

	try {
		const [catRows] = await pool.execute(
			'SELECT IDNo FROM services_category WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
			[id]
		);
		if (!catRows.length) {
			return res.status(404).json({ error: 'Category not found' });
		}

		await pool.execute(
			'UPDATE services_category SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[0, req.session.user_id, date_now, id]
		);
		res.send('Services category archived successfully');
	} catch (err) {
		console.error('Error archiving services category:', err);
		res.status(500).json({ error: 'Error archiving services category' });
	}
});

module.exports = router;
