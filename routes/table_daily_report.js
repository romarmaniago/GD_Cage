const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

router.get('/table_daily_report', checkSession, (req, res) => {
	const data = sessions(req, 'table_daily_report');
	data.permissions = req.session.permissions || 0;
	res.render('reports/table_daily_report', data);
});

router.get('/junket_tables_data', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute(
			`SELECT
				IDNo AS id,
				TABLE_NAME AS table_name,
				ACTIVE AS active,
				DATE_FORMAT(ENCODED_DT, '%Y-%m-%d %H:%i') AS encoded_dt,
				DATE_FORMAT(EDITED_DT, '%Y-%m-%d %H:%i') AS edited_dt
			 FROM junket_tables
			 ORDER BY TABLE_NAME ASC`
		);

		res.json(rows || []);
	} catch (error) {
		console.error('junket_tables_data:', error);
		res.status(500).json({ message: 'Error loading junket tables.' });
	}
});

router.post('/add_junket_table', checkSession, async (req, res) => {
	try {
		const rawName = String(req.body.table_name || req.body.txtTableName || '').trim();
		if (!rawName) {
			return res.status(400).json({ message: 'Table name is required.' });
		}

		const tableName = rawName.slice(0, 120);
		const userId = req.session.user_id || null;
		const now = new Date();

		await pool.execute(
			`INSERT INTO junket_tables (TABLE_NAME, ACTIVE, ENCODED_BY, ENCODED_DT)
			 VALUES (?, 1, ?, ?)`,
			[tableName, userId, now]
		);

		res.json({ success: true, message: 'Junket table added successfully.' });
	} catch (error) {
		if (error && error.code === 'ER_DUP_ENTRY') {
			return res.status(400).json({ message: 'Table name already exists.' });
		}
		console.error('add_junket_table:', error);
		res.status(500).json({ message: 'Error adding junket table.' });
	}
});

router.put('/junket_table/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!id || id < 1) {
			return res.status(400).json({ message: 'Invalid table id.' });
		}

		const rawName = String(req.body.table_name || req.body.txtTableName || '').trim();
		if (!rawName) {
			return res.status(400).json({ message: 'Table name is required.' });
		}

		const tableName = rawName.slice(0, 120);
		const userId = req.session.user_id || null;
		const now = new Date();

		const [result] = await pool.execute(
			`UPDATE junket_tables
			 SET TABLE_NAME = ?, EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[tableName, userId, now, id]
		);

		if (!result || result.affectedRows === 0) {
			return res.status(404).json({ message: 'Junket table not found.' });
		}

		res.json({ success: true, message: 'Junket table updated successfully.' });
	} catch (error) {
		if (error && error.code === 'ER_DUP_ENTRY') {
			return res.status(400).json({ message: 'Table name already exists.' });
		}
		console.error('junket_table update:', error);
		res.status(500).json({ message: 'Error updating junket table.' });
	}
});

router.put('/junket_table/remove/:id', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!id || id < 1) {
			return res.status(400).json({ message: 'Invalid table id.' });
		}

		const userId = req.session.user_id || null;
		const now = new Date();

		const [result] = await pool.execute(
			`UPDATE junket_tables
			 SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[userId, now, id]
		);

		if (!result || result.affectedRows === 0) {
			return res.status(404).json({ message: 'Junket table not found or already removed.' });
		}

		res.json({ success: true, message: 'Junket table removed successfully.' });
	} catch (error) {
		console.error('junket_table remove:', error);
		res.status(500).json({ message: 'Error removing junket table.' });
	}
});

module.exports = router;
