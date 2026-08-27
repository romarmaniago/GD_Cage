const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { buildAgentWinlossReport } = require('../utils/agentWinlossReport');
const { buildTableExportXlsx, sendTableExportResponse, sanitizeSheetName } = require('../utils/ExcelExportService');

// Statistics page routes
router.get("/game_statistic", checkSession, function (req, res) {
    const permissions = req.session.permissions || 0;
    res.render("statistics/game_statistic", {
        ...sessions(req, 'game_statistic'),
        permissions: permissions
    });
});

router.get("/live_statistic", checkSession, function (req, res) {
    const data = sessions(req, 'live_statistic');
    data.permissions = req.session.permissions || 0;
    res.render("statistics/live_statistic", data);
});

router.get("/telebet_statistic", checkSession, function (req, res) {
    const data = sessions(req, 'telebet_statistic');
    data.permissions = req.session.permissions || 0;
    res.render("statistics/telebet_statistic", data);
});

router.get("/agent_statistic", checkSession, function (req, res) {
    const data = sessions(req, 'agent_statistic');
    data.permissions = req.session.permissions || 0;
    res.render("statistics/agent_statistic", data);
});

router.get("/guest_statistic", checkSession, function (req, res) {
    const data = sessions(req, 'guest_statistic');
    data.permissions = req.session.permissions || 0;
    res.render("statistics/guest_statistic", data);
});

router.get("/guest_game_statistic", checkSession, function (req, res) {
    const data = sessions(req, 'guest_game_statistic');
    data.permissions = req.session.permissions || 0;
    res.render("statistics/guest_game_statistic", data);
});

// API Routes for statistics data
router.get('/get_stats_data', async (req, res) => {
    try {
        const query = `
            SELECT IDNo, GAME_TYPE_STATS,
                   BUY_IN_STATS, 
                   WIN_LOSS_STATS,
                   ROLLING_STATS, 
                   COMMISSION_STATS, 
                   HOUSE_SHARE_STATS,
                   EXPENSE_STATS,
                   ENCODED_DT, 
                   ENCODED_BY  
            FROM game_stats 
            WHERE ACTIVE = 1
        `;
        const [results] = await pool.execute(query);
        res.status(200).json(results);
    } catch (err) {
        console.error('Error fetching data:', err);
        res.status(500).json({ success: false, message: 'Error fetching data' });
    }
});

// Guest Statistics Data
router.get('/guest_statistics_data', async (req, res) => {
    let { agency, start_date, end_date } = req.query;

    if (!start_date || !end_date) {
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        start_date = start_date || firstDayOfMonth.toISOString().split('T')[0];
        end_date = end_date || currentDate.toISOString().split('T')[0];
    }

    if (!agency) {
        return res.status(400).json({ error: 'agency is required' });
    }

    const query = `
        SELECT *, 
            game_list.IDNo AS game_list_id, 
            game_list.ACTIVE AS game_status, 
            account.IDNo AS account_no, 
            agent.AGENCY as agent_agencyIDNo, 
            agency.AGENCY as agency_name, 
            agent.AGENT_CODE AS agent_code, 
            agent.NAME AS agent_name,  
            game_list.ENCODED_DT AS GAME_DATE_START 
        FROM game_list
        JOIN account ON game_list.ACCOUNT_ID = account.IDNo
        JOIN agent ON agent.IDNo = account.AGENT_ID
        JOIN agency ON agency.IDNo = agent.AGENCY
        WHERE game_list.ACTIVE != 0 
          AND agency.AGENCY = ? 
          AND DATE(game_list.ENCODED_DT) BETWEEN ? AND ?
    `;

    try {
        const [rows] = await pool.execute(query, [agency, start_date, end_date]);
        res.json(rows);
    } catch (error) {
        console.error('Database Error:', error);
        return res.status(500).send('Database error');
    }
});

// Agent Statistics Data
router.get('/agent_statistics_data', async (req, res) => {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
        return res.status(400).json({ error: 'start_date and end_date are required' });
    }

    const query = `
        SELECT *, 
            game_list.IDNo AS game_list_id, 
            game_list.ACTIVE AS game_status, 
            account.IDNo AS account_no, 
            agent.AGENCY as agent_agencyIDNo, 
            agency.AGENCY as agency_name, 
            agent.AGENT_CODE AS agent_code, 
            agent.NAME AS agent_name,  
            game_list.ENCODED_DT AS GAME_DATE_START 
        FROM game_list
        JOIN account ON game_list.ACCOUNT_ID = account.IDNo
        JOIN agent ON agent.IDNo = account.AGENT_ID
        JOIN agency ON agency.IDNo = agent.AGENCY
        WHERE game_list.ACTIVE != 0 
          AND DATE(game_list.ENCODED_DT) BETWEEN ? AND ?
        ORDER BY game_list.IDNo ASC
    `;

    try {
        const [rows] = await pool.execute(query, [start_date, end_date]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(500).send('Error fetching data');
    }
});

// Game Statistics Data
router.get('/game_statistics_data', async (req, res) => {
    const query = `SELECT *, game_list.IDNo AS game_list_id, game_list.ACTIVE AS game_status, 
                          account.IDNo AS account_no, agent.AGENT_CODE AS agent_code, 
                          agent.NAME AS agent_name, game_list.ENCODED_DT AS GAME_DATE_START 
                   FROM game_list
                   JOIN account ON game_list.ACCOUNT_ID = account.IDNo
                   JOIN agent ON agent.IDNo = account.AGENT_ID
                   JOIN agency ON agency.IDNo = agent.AGENCY
                   WHERE game_list.ACTIVE != 0 
                   ORDER BY game_list.IDNo ASC`;

    try {
        const [rows] = await pool.execute(query);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(500).send('Error fetching data');
    }
});

router.get('/game_statistics/:id/record', async (req, res) => {
    const id = parseInt(req.params.id);
    const query = `SELECT AMOUNT, NN_CHIPS, CC_CHIPS, CAGE_TYPE,
                          ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION
                   FROM game_record 
                   JOIN game_list ON game_list.IDNo = game_record.GAME_ID 
                   WHERE game_list.ACTIVE != 0 
                     AND game_record.ACTIVE != 0 
                     AND GAME_ID = ?`;

    try {
        const [rows] = await pool.execute(query, [id]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

// Live Statistics Data
router.get('/live_game_statistics_data', async (req, res) => {
    const query = `SELECT *, game_list.IDNo AS game_list_id, game_list.ACTIVE AS game_status, 
                          account.IDNo AS account_no, agent.AGENT_CODE AS agent_code, 
                          agent.NAME AS agent_name, game_list.ENCODED_DT AS GAME_DATE_START 
                   FROM game_list
                   JOIN account ON game_list.ACCOUNT_ID = account.IDNo
                   JOIN agent ON agent.IDNo = account.AGENT_ID
                   JOIN agency ON agency.IDNo = agent.AGENCY
                   WHERE game_list.ACTIVE != 0 AND GAME_TYPE = 'LIVE' 
                   ORDER BY game_list.IDNo ASC`;

    try {
        const [rows] = await pool.execute(query);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

router.get('/live_game_statistics/:id/record', async (req, res) => {
    const id = parseInt(req.params.id);
    const query = `SELECT AMOUNT, NN_CHIPS, CC_CHIPS, CAGE_TYPE 
                   FROM game_record 
                   JOIN game_list ON game_list.IDNo = game_record.GAME_ID 
                   WHERE game_list.ACTIVE != 0 
                     AND game_record.ACTIVE != 0 
                     AND GAME_ID = ?`;

    try {
        const [rows] = await pool.execute(query, [id]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

// Telebet Statistics Data
router.get('/telebet_game_statistics_data', async (req, res) => {
    const query = `SELECT *, game_list.IDNo AS game_list_id, game_list.ACTIVE AS game_status, 
                          account.IDNo AS account_no, agent.AGENT_CODE AS agent_code, 
                          agent.NAME AS agent_name, game_list.ENCODED_DT AS GAME_DATE_START 
                   FROM game_list
                   JOIN account ON game_list.ACCOUNT_ID = account.IDNo
                   JOIN agent ON agent.IDNo = account.AGENT_ID
                   JOIN agency ON agency.IDNo = agent.AGENCY
                   WHERE game_list.ACTIVE != 0 AND GAME_TYPE = 'TELEBET' 
                   ORDER BY game_list.IDNo ASC`;

    try {
        const [rows] = await pool.execute(query);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});


// GET GUEST GAME STATISTICS
router.get('/guest_game_statistics_data', async (req, res) => {
    const { guest, start_date, end_date } = req.query;

    if (!guest || !start_date || !end_date) {
        return res.status(400).json({ error: 'guest, start_date, and end_date are required' });
    }

    const query = `
        SELECT *, 
            game_list.IDNo AS game_list_id, 
            game_list.ACTIVE AS game_status, 
            account.IDNo AS account_no, 
            agent.AGENCY as agent_agencyIDNo, 
            agency.AGENCY as agency_name, 
            agent.AGENT_CODE AS agent_code, 
            agent.NAME AS agent_name,  
            game_list.ENCODED_DT AS GAME_DATE_START 
        FROM game_list
        JOIN account ON game_list.ACCOUNT_ID = account.IDNo
        JOIN agent ON agent.IDNo = account.AGENT_ID
        JOIN agency ON agency.IDNo = agent.AGENCY
        WHERE game_list.ACTIVE != 0 
          AND agent.NAME = ? 
          AND DATE(game_list.ENCODED_DT) BETWEEN ? AND ?
    `;

    try {
        // Execute the query
        const [rows] = await pool.execute(query, [guest, start_date, end_date]);

        res.json(rows);
    } catch (error) {
        console.error('Database Error:', error);
        return res.status(500).send('Database error');
    }
});


// POST /add_stats - Insert game statistics
router.post('/add_stats', async (req, res) => {
	try {
	  const {
		game_type,
		buy_in,
		win_loss,
		rolling,
		commission,
		house_share,
		expense,
	  } = req.body;
	  const date_now = new Date();
	  const query = `
		INSERT INTO game_stats (
		  GAME_TYPE_STATS, BUY_IN_STATS, WIN_LOSS_STATS, ROLLING_STATS, 
		  COMMISSION_STATS, HOUSE_SHARE_STATS, EXPENSE_STATS, ENCODED_DT, ENCODED_BY
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	  `;
	  const [result] = await pool.execute(query, [
		game_type,
		buy_in,
		win_loss,
		rolling,
		commission,
		house_share,
		expense,
		date_now,
		req.session.user_id  // ENCODED_BY
	  ]);
	  res.status(200).json({ success: true, message: 'Data successfully inserted!' });
	} catch (err) {
	  console.error('Error inserting data:', err);
	  res.status(500).json({ success: false, message: 'Error inserting data' });
	}
  });

router.put('/game_stats/remove/:id', async (req, res) => {
	const id = parseInt(req.params.id, 10);
	const date_now = new Date();
	try {
		const query = `UPDATE game_stats SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query, [0, req.session.user_id, date_now, id]);
		res.send('GAME LIST updated successfully');
	} catch (err) {
		console.error('Error updating GAME LIST:', err);
		res.status(500).send('Error updating GAME LIST');
	}
});

  // Route to update house share
router.put('/update_house_share', async (req, res) => {
    const { game_type, txtHouseShare } = req.body;

    const query = 'UPDATE game_list SET HOUSE_SHARE = ? WHERE GAME_TYPE = ?';

    try {
        // Execute the update query
        const [result] = await pool.execute(query, [txtHouseShare, game_type]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Game type not found' });
        }

        return res.status(200).json({ message: 'House share updated successfully' });
    } catch (err) {
        console.error('Error updating house share:', err);
        return res.status(500).json({ message: 'Failed to update house share' });
    }
});

// Route to update expense
router.put('/update_expense', async (req, res) => {
    const { game_id, txtExpense } = req.body;

    const query = 'UPDATE game_list SET EXPENSE = ? WHERE IDNo = ?';

    try {
        // Execute the update query
        const [result] = await pool.execute(query, [txtExpense, game_id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Game not found' });
        }

        return res.status(200).json({ message: 'Expense updated successfully' });
    } catch (err) {
        console.error('Error updating expense:', err);
        return res.status(500).json({ message: 'Failed to update expense' });
    }
});


router.get('/agent_winloss_report', checkSession, (req, res) => {
	const data = sessions(req, 'agent_winloss_report');
	data.permissions = req.session.permissions || 0;
	res.render('statistics/agent_winloss_report', data);
});

router.get('/agent_winloss_report/data', checkSession, async (req, res) => {
	try {
		const payload = await buildAgentWinlossReport(pool, {
			date_from: req.query.date_from,
			date_to: req.query.date_to,
			group_by: req.query.group_by,
			agent_id: req.query.agent_id
		});
		res.json(payload);
	} catch (err) {
		console.error('agent_winloss_report/data:', err);
		res.status(500).json({ message: 'Failed to load agent win/loss report.' });
	}
});

router.get('/agent_winloss_report/agents', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute(
			`SELECT ag.IDNo AS agent_id, ag.AGENT_CODE AS agent_code, ag.NAME AS agent_name, agency.AGENCY AS agency_name
			 FROM agent ag
			 LEFT JOIN agency ON agency.IDNo = ag.AGENCY
			 WHERE ag.ACTIVE = 1
			 ORDER BY ag.AGENT_CODE ASC, ag.NAME ASC`
		);
		res.json(rows || []);
	} catch (err) {
		console.error('agent_winloss_report/agents:', err);
		res.status(500).json({ message: 'Failed to load agents.' });
	}
});

router.post('/agent_winloss_report/export_xlsx', checkSession, async (req, res) => {
	try {
		const { group_by, date_from, date_to, agent_id } = req.body || {};
		const payload = await buildAgentWinlossReport(pool, { group_by, date_from, date_to, agent_id });
		const normalizedGroup = payload.group_by;

		const formatAgentCell = (row) => {
			const code = String(row.agent_code || '').trim();
			const name = String(row.agent_name || '').trim();
			if (code && name) return `${code} (${name})`;
			return code || name || '';
		};

		let headers;
		let rows;
		let sheetName;
		if (normalizedGroup === 'day') {
			headers = ['Program Date', 'Agent Code (Agent Name)', 'Line', 'Games', 'Buy In', 'Cash Out', 'Win/Loss', 'Rolling'];
			rows = (payload.rows || []).map((row) => [
				row.program_date,
				formatAgentCell(row),
				row.agency_name || '',
				row.game_count,
				row.buy_in,
				row.cash_out,
				row.win_loss,
				row.rolling
			]);
			sheetName = 'Agent WL Daily';
		} else if (normalizedGroup === 'month') {
			headers = ['Month', 'Agent Code (Agent Name)', 'Line', 'Games', 'Buy In', 'Cash Out', 'Win/Loss', 'Rolling'];
			rows = (payload.rows || []).map((row) => [
				row.program_month,
				formatAgentCell(row),
				row.agency_name || '',
				row.game_count,
				row.buy_in,
				row.cash_out,
				row.win_loss,
				row.rolling
			]);
			sheetName = 'Agent WL Monthly';
		} else {
			headers = ['Program Date', 'Game #', 'Agent Code (Agent Name)', 'Line', 'Guest', 'Game Type', 'Buy In', 'Cash Out', 'Win/Loss', 'Rolling'];
			rows = (payload.rows || []).map((row) => [
				row.program_date,
				row.game_id,
				formatAgentCell(row),
				row.agency_name || '',
				row.guest_name,
				row.game_type,
				row.buy_in,
				row.cash_out,
				row.win_loss,
				row.rolling
			]);
			sheetName = 'Agent WL Per Game';
		}

		const totals = payload.totals || {};
		rows.push([]);
		if (normalizedGroup === 'day' || normalizedGroup === 'month') {
			rows.push(['GRAND TOTAL', '', '', totals.game_count, totals.buy_in, totals.cash_out, totals.win_loss, totals.rolling]);
		} else {
			rows.push(['GRAND TOTAL', '', '', '', '', '', totals.buy_in, totals.cash_out, totals.win_loss, totals.rolling]);
		}

		const result = await buildTableExportXlsx({
			profileKey: 'agentWinlossReport',
			sheetName: sanitizeSheetName(sheetName),
			headers,
			rows,
			filename: `Agent-WinLoss-${normalizedGroup}-${payload.date_from}-to-${payload.date_to}.xlsx`,
			maxRows: 20000
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('agent_winloss_report/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed.' });
	}
});

// Export the router
module.exports = router; 