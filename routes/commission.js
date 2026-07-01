const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

router.get("/commission", checkSession, function (req, res) {
	const data = sessions(req, 'commission');
	data.permissions = req.session.permissions;
	res.render("junket/commission", data);
});

router.get("/additional_commission", checkSession, function (req, res) {
	const data = sessions(req, 'additional_commission');
	data.permissions = req.session.permissions;
	res.render("junket/additional_commission", data);
});

router.get("/commission_analytics", checkSession, function (req, res) {
	const data = sessions(req, 'commission');
	data.permissions = req.session.permissions;
	res.render("junket/commission_analytics", data);
});

router.get("/commission_panel", checkSession, function (req, res) {
	res.redirect(302, '/commission_analytics');
});

router.get('/additional_commission_data', checkSession, async (req, res) => {
    const query = `
        SELECT
            ac.IDNo,
            ac.AGENT_ID,
            COALESCE(agent.AGENT_CODE, CAST(ac.AGENT_ID AS CHAR), '') AS account,
            COALESCE(NULLIF(TRIM(ac.AGENT_NAME), ''), agent.NAME, '') AS name,
            ac.CASH_OUT,
            ac.REMARKS,
            ac.ENCODED_DT
        FROM additional_commission ac
        LEFT JOIN agent ON agent.IDNo = ac.AGENT_ID
        WHERE ac.ACTIVE = 1
        ORDER BY ac.ENCODED_DT DESC, ac.IDNo DESC`;

    try {
        const [rows] = await pool.execute(query);
        res.json(rows);
    } catch (error) {
        console.error('Error loading additional commission data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.get('/additional_commission_agents', checkSession, async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT IDNo AS agent_id, AGENT_CODE AS account, NAME AS name
            FROM agent
            WHERE ACTIVE = 1
            ORDER BY AGENT_CODE ASC, NAME ASC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error loading additional commission agents:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/add_additional_commission', checkSession, async (req, res) => {
    try {
        const { agentId, agentName, cashOut, remarks } = req.body;
        const cleanCashOut = String(cashOut || '').replace(/,/g, '');
        const parsedAgentId = parseInt(agentId, 10);
        const parsedCashOut = Number(cleanCashOut);

        if (!parsedAgentId || cleanCashOut === '' || Number.isNaN(parsedCashOut)) {
            return res.status(400).json({ message: 'Invalid payload' });
        }

        const [agentRows] = await pool.execute(
            'SELECT NAME FROM agent WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
            [parsedAgentId]
        );

        if (!agentRows.length) {
            return res.status(400).json({ message: 'Invalid agent' });
        }

        const savedAgentName = String(agentName || agentRows[0].NAME || '').trim();

        await pool.execute(
            `INSERT INTO additional_commission
                (AGENT_ID, AGENT_NAME, CASH_OUT, REMARKS, ENCODED_DT, ENCODED_BY, ACTIVE)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [
                parsedAgentId,
                savedAgentName,
                parsedCashOut,
                String(remarks || '').trim(),
                new Date(),
                req.session.user_id
            ]
        );

        const [totalRows] = await pool.execute(
            `SELECT COALESCE(SUM(CASH_OUT), 0) AS total
             FROM additional_commission
             WHERE ACTIVE = 1`
        );

        res.json({
            message: 'Saved successfully',
            total: Math.round(Number(totalRows[0]?.total || 0))
        });
    } catch (error) {
        console.error('Error saving additional commission:', error);
        res.status(500).json({ message: 'Failed to save additional commission' });
    }
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
            game_list.ENCODED_DT AS GAME_DATE_START,
            game_list.GAME_ENDED,
            game_list.PROGRAM_DATE,
            game_list.GAME_TYPE,
            game_list.SETTLED,
            game_list.COMMISSION_PERCENTAGE,
            game_list.COMMISSION_TYPE,
            account.IDNo AS account_no,
            agent.IDNo AS agent_id,
            agent.AGENT_CODE AS agent_code,
            agent.NAME AS agent_name,
            agent.AGENCY AS agency_id,
            COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS guest_name
        FROM game_list 
        JOIN account ON game_list.ACCOUNT_ID = account.IDNo
        JOIN agent ON agent.IDNo = account.AGENT_ID
        JOIN agency ON agency.IDNo = agent.AGENCY
        LEFT JOIN guest g ON g.IDNo = game_list.GUEST_ID
        WHERE game_list.ACTIVE != 0
          AND game_list.SETTLED = 1
          AND DATE(COALESCE(game_list.GAME_ENDED, game_list.ENCODED_DT)) >= ?
          AND DATE(COALESCE(game_list.GAME_ENDED, game_list.ENCODED_DT)) <= ?
        ORDER BY COALESCE(game_list.GAME_ENDED, game_list.ENCODED_DT) DESC, game_list.IDNo DESC`;

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