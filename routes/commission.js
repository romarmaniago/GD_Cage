const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');

const TYPE_DEPOSIT = 1;
const TYPE_CASHOUT = 2;

async function getAdditionalCommissionTotal(connection) {
    const [totalRows] = await connection.execute(
        `SELECT COALESCE(SUM(AMOUNT), 0) AS total
         FROM additional_commission
         WHERE ACTIVE = 1`
    );
    return Math.round(Number(totalRows[0]?.total || 0));
}

async function getAccountIdByAgentId(connection, agentId) {
    const [accountRows] = await connection.execute(
        'SELECT IDNo FROM account WHERE AGENT_ID = ? AND ACTIVE = 1 LIMIT 1',
        [agentId]
    );
    return accountRows.length ? accountRows[0].IDNo : null;
}

async function getCurrentBalance(connection, accountId) {
    const [balanceRows] = await connection.execute(
        `SELECT transaction_type.TRANSACTION, account_ledger.AMOUNT
         FROM account_ledger
         JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
         WHERE account_ledger.TRANSACTION_TYPE IN (2, 5, 3)
           AND account_ledger.ACCOUNT_ID = ?
           AND account_ledger.ACTIVE = 1`,
        [accountId]
    );

    let depositAmount = 0;
    let withdrawAmount = 0;
    let markerRedeemAmount = 0;
    let markerReturnDeposit = 0;

    balanceRows.forEach((row) => {
        const amount = Number(row.AMOUNT) || 0;
        if (row.TRANSACTION === 'DEPOSIT') depositAmount += amount;
        if (row.TRANSACTION === 'WITHDRAW') withdrawAmount += amount;
        if (row.TRANSACTION === 'MARKER REDEEM') markerRedeemAmount += amount;
        if (row.TRANSACTION === 'IOU RETURN DEPOSIT') markerReturnDeposit += amount;
    });

    return depositAmount + markerRedeemAmount - withdrawAmount - markerReturnDeposit;
}

async function insertDepositLedger(connection, { accountId, amount, remarks, encodedBy, encodedDate }) {
    const [ledgerResult] = await connection.execute(
        `INSERT INTO account_ledger
            (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT)
         VALUES (?, 1, 2, 'ADDITIONAL COMMISSION', ?, ?, ?, ?)`,
        [accountId, amount, remarks || null, encodedBy, encodedDate]
    );

    const balanceAfter = await getCurrentBalance(connection, accountId);
    const balanceBefore = balanceAfter - amount;

    try {
        await connection.execute(
            `INSERT INTO account_transaction_history
                (ledger_id, account_id, transaction_id, transaction_name, amount, balance_before, balance_after, remarks, transfer_account_id, direction, encoded_by, encoded_dt)
             VALUES (?, ?, 1, 'DEPOSIT', ?, ?, ?, ?, NULL, 'DEPOSIT', ?, ?)`,
            [
                ledgerResult.insertId,
                accountId,
                amount,
                balanceBefore,
                balanceAfter,
                remarks || null,
                encodedBy,
                encodedDate
            ]
        );
    } catch (historyError) {
        console.error('account_transaction_history insert failed:', historyError);
    }

    return ledgerResult.insertId;
}

async function softDeleteLedger(connection, ledgerId, userId, editedDate) {
    if (!ledgerId) return;
    await connection.execute(
        'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1',
        [userId, editedDate, ledgerId]
    );
}

async function getActiveRecord(connection, id) {
    const [rows] = await connection.execute(
        `SELECT IDNo, AGENT_ID, AGENT_NAME, TYPE, AMOUNT, ACCOUNT_LEDGER_ID, REMARKS
         FROM additional_commission
         WHERE IDNo = ? AND ACTIVE = 1
         LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

function parsePayload(body) {
    const parsedAgentId = parseInt(body.agentId, 10);
    const parsedType = parseInt(body.type, 10);
    const cleanAmount = String(body.amount || '').replace(/,/g, '');
    const parsedAmount = Number(cleanAmount) || 0;
    const trimmedRemarks = String(body.remarks || '').trim();

    return {
        parsedAgentId,
        parsedType,
        parsedAmount,
        trimmedRemarks,
        savedAgentName: String(body.agentName || '').trim()
    };
}

function isValidPayload({ parsedAgentId, parsedType, parsedAmount }) {
    return Boolean(
        parsedAgentId
        && (parsedType === TYPE_DEPOSIT || parsedType === TYPE_CASHOUT)
        && parsedAmount > 0
    );
}

async function saveAdditionalCommission(connection, {
    recordId = null,
    parsedAgentId,
    savedAgentName,
    parsedType,
    parsedAmount,
    trimmedRemarks,
    userId
}) {
    const now = new Date();
    let ledgerId = null;

    if (parsedType === TYPE_DEPOSIT) {
        const accountId = await getAccountIdByAgentId(connection, parsedAgentId);
        if (!accountId) {
            const error = new Error('Guest account not found');
            error.statusCode = 400;
            throw error;
        }
        ledgerId = await insertDepositLedger(connection, {
            accountId,
            amount: parsedAmount,
            remarks: trimmedRemarks,
            encodedBy: userId,
            encodedDate: now
        });
    }

    if (recordId) {
        const existing = await getActiveRecord(connection, recordId);
        if (!existing) {
            const error = new Error('Record not found');
            error.statusCode = 404;
            throw error;
        }

        if (Number(existing.TYPE) === TYPE_DEPOSIT) {
            await softDeleteLedger(connection, existing.ACCOUNT_LEDGER_ID, userId, now);
        }

        await connection.execute(
            `UPDATE additional_commission
             SET AGENT_ID = ?, AGENT_NAME = ?, TYPE = ?, AMOUNT = ?, ACCOUNT_LEDGER_ID = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?
             WHERE IDNo = ? AND ACTIVE = 1`,
            [
                parsedAgentId,
                savedAgentName,
                parsedType,
                parsedAmount,
                ledgerId,
                trimmedRemarks,
                userId,
                now,
                recordId
            ]
        );

        return recordId;
    }

    const [insertResult] = await connection.execute(
        `INSERT INTO additional_commission
            (AGENT_ID, AGENT_NAME, TYPE, AMOUNT, ACCOUNT_LEDGER_ID, REMARKS, ENCODED_DT, ENCODED_BY, ACTIVE)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
            parsedAgentId,
            savedAgentName,
            parsedType,
            parsedAmount,
            ledgerId,
            trimmedRemarks,
            now,
            userId
        ]
    );

    return insertResult.insertId;
}

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
            ac.TYPE,
            ac.AMOUNT,
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
    const connection = await pool.getConnection();

    try {
        const payload = parsePayload(req.body);
        if (!isValidPayload(payload)) {
            connection.release();
            return res.status(400).json({ message: 'Invalid payload' });
        }

        const [agentRows] = await connection.execute(
            'SELECT NAME FROM agent WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
            [payload.parsedAgentId]
        );

        if (!agentRows.length) {
            connection.release();
            return res.status(400).json({ message: 'Invalid agent' });
        }

        payload.savedAgentName = payload.savedAgentName || String(agentRows[0].NAME || '').trim();

        await connection.beginTransaction();
        await saveAdditionalCommission(connection, {
            parsedAgentId: payload.parsedAgentId,
            savedAgentName: payload.savedAgentName,
            parsedType: payload.parsedType,
            parsedAmount: payload.parsedAmount,
            trimmedRemarks: payload.trimmedRemarks,
            userId: req.session.user_id
        });
        const total = await getAdditionalCommissionTotal(connection);
        await connection.commit();

        res.json({ message: 'Saved successfully', total });
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('Error rolling back additional commission save:', rollbackError);
        }
        console.error('Error saving additional commission:', error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Failed to save additional commission' });
    } finally {
        connection.release();
    }
});

router.put('/additional_commission/:id', checkSession, async (req, res) => {
    const connection = await pool.getConnection();
    const recordId = parseInt(req.params.id, 10);

    try {
        const payload = parsePayload(req.body);
        if (!recordId || !isValidPayload(payload)) {
            connection.release();
            return res.status(400).json({ message: 'Invalid payload' });
        }

        const [agentRows] = await connection.execute(
            'SELECT NAME FROM agent WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
            [payload.parsedAgentId]
        );

        if (!agentRows.length) {
            connection.release();
            return res.status(400).json({ message: 'Invalid agent' });
        }

        payload.savedAgentName = payload.savedAgentName || String(agentRows[0].NAME || '').trim();

        await connection.beginTransaction();
        await saveAdditionalCommission(connection, {
            recordId,
            parsedAgentId: payload.parsedAgentId,
            savedAgentName: payload.savedAgentName,
            parsedType: payload.parsedType,
            parsedAmount: payload.parsedAmount,
            trimmedRemarks: payload.trimmedRemarks,
            userId: req.session.user_id
        });
        const total = await getAdditionalCommissionTotal(connection);
        await connection.commit();

        res.json({ message: 'Updated successfully', total });
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('Error rolling back additional commission update:', rollbackError);
        }
        console.error('Error updating additional commission:', error);
        res.status(error.statusCode || 500).json({ message: error.message || 'Failed to update additional commission' });
    } finally {
        connection.release();
    }
});

router.delete('/additional_commission/:id', checkSession, async (req, res) => {
    const connection = await pool.getConnection();
    const recordId = parseInt(req.params.id, 10);

    try {
        if (!recordId) {
            connection.release();
            return res.status(400).json({ message: 'Invalid record id' });
        }

        const existing = await getActiveRecord(connection, recordId);
        if (!existing) {
            connection.release();
            return res.status(404).json({ message: 'Record not found' });
        }

        const now = new Date();
        await connection.beginTransaction();

        if (Number(existing.TYPE) === TYPE_DEPOSIT) {
            await softDeleteLedger(connection, existing.ACCOUNT_LEDGER_ID, req.session.user_id, now);
        }

        await connection.execute(
            'UPDATE additional_commission SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1',
            [req.session.user_id, now, recordId]
        );

        const total = await getAdditionalCommissionTotal(connection);
        await connection.commit();

        res.json({ message: 'Deleted successfully', total });
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('Error rolling back additional commission delete:', rollbackError);
        }
        console.error('Error deleting additional commission:', error);
        res.status(500).json({ message: 'Failed to delete additional commission' });
    } finally {
        connection.release();
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