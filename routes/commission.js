const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

router.get("/commission", checkSession, function (req, res) {
	const data = sessions(req, 'commission');
	data.permissions = req.session.permissions;
	res.render("junket/commission", data);
});

router.get("/commission_analytics", checkSession, function (req, res) {
	const data = sessions(req, 'commission');
	data.permissions = req.session.permissions;
	res.render("junket/commission_analytics", data);
});

router.get("/commission_panel", checkSession, function (req, res) {
	res.redirect(302, '/commission_analytics');
});

// GET COMMISSION DATA
router.get('/commission_data', async (req, res) => {
    // Change `const` to `let` for start and end so they can be reassigned
    let { start, end } = req.query;

    if (!start || !end) {
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

        start = firstDayOfMonth.toISOString().slice(0, 10); // YYYY-MM-DD
        end = currentDate.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    // Validate date format
    const isValidDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (!isValidDate(start) || !isValidDate(end)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const query = `
        SELECT DISTINCT
            game_list.IDNo AS game_list_id,
            game_list.ACTIVE AS game_status,
            game_list.FNB AS fnb,
            game_list.PAYMENT AS payment,
            game_list.ACCOUNT_ID,
            game_list.ENCODED_DT,
            game_list.GAME_ENDED,
            game_list.SETTLED,
            game_list.COMMISSION_PERCENTAGE,
            game_list.COMMISSION_TYPE,
            account.IDNo AS account_no,
            agent.IDNo AS agent_id,
            agent.AGENT_CODE AS agent_code,
            agent.NAME AS agent_name,
            agent.AGENCY AS agency_id
        FROM game_list 
        JOIN account ON game_list.ACCOUNT_ID = account.IDNo
        JOIN agent ON agent.IDNo = account.AGENT_ID
        JOIN agency ON agency.IDNo = agent.AGENCY
        WHERE game_list.ACTIVE != 0 
          AND DATE(game_list.ENCODED_DT) >= ? 
          AND DATE(game_list.ENCODED_DT) <= ?
        ORDER BY game_list.IDNo ASC`;

    try {
        const [rows] = await pool.execute(query, [start, end]);
        res.json(rows);
    } catch (error) {
        console.error('Error executing query:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Export the router
module.exports = router; 