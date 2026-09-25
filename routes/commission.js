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
         WHERE ACTIVE = 1 AND ADDITIONAL_SETTLEMENT_ID IS NULL`
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
        `SELECT IDNo, AGENT_ID, AGENT_NAME, TYPE, AMOUNT, ACCOUNT_LEDGER_ID, REMARKS, PROGRAM_DATE
         FROM additional_commission
         WHERE IDNo = ? AND ACTIVE = 1
         LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

function parseProgramDate(value) {
    const raw = String(value || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const [y, m, d] = raw.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
        Number.isNaN(dt.getTime())
        || dt.getUTCFullYear() !== y
        || dt.getUTCMonth() + 1 !== m
        || dt.getUTCDate() !== d
    ) {
        return null;
    }
    return raw;
}

function parsePayload(body) {
    const parsedAgentId = parseInt(body.agentId, 10);
    const parsedType = parseInt(body.type, 10);
    const cleanAmount = String(body.amount || '').replace(/,/g, '');
    const parsedAmount = Number(cleanAmount) || 0;
    const trimmedRemarks = String(body.remarks || '').trim();
    const parsedProgramDate = parseProgramDate(body.programDate || body.program_date);

    return {
        parsedAgentId,
        parsedType,
        parsedAmount,
        trimmedRemarks,
        parsedProgramDate,
        savedAgentName: String(body.agentName || '').trim()
    };
}

function isValidPayload({ parsedAgentId, parsedType, parsedAmount, parsedProgramDate }) {
    return Boolean(
        parsedAgentId
        && (parsedType === TYPE_DEPOSIT || parsedType === TYPE_CASHOUT)
        && parsedAmount > 0
        && parsedProgramDate
    );
}

async function saveAdditionalCommission(connection, {
    recordId = null,
    parsedAgentId,
    savedAgentName,
    parsedType,
    parsedAmount,
    trimmedRemarks,
    parsedProgramDate,
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
             SET AGENT_ID = ?, AGENT_NAME = ?, TYPE = ?, AMOUNT = ?, ACCOUNT_LEDGER_ID = ?, REMARKS = ?, PROGRAM_DATE = ?, EDITED_BY = ?, EDITED_DT = ?
             WHERE IDNo = ? AND ACTIVE = 1`,
            [
                parsedAgentId,
                savedAgentName,
                parsedType,
                parsedAmount,
                ledgerId,
                trimmedRemarks,
                parsedProgramDate,
                userId,
                now,
                recordId
            ]
        );

        return recordId;
    }

    const [insertResult] = await connection.execute(
        `INSERT INTO additional_commission
            (AGENT_ID, AGENT_NAME, TYPE, AMOUNT, ACCOUNT_LEDGER_ID, REMARKS, PROGRAM_DATE, ENCODED_DT, ENCODED_BY, ACTIVE)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
            parsedAgentId,
            savedAgentName,
            parsedType,
            parsedAmount,
            ledgerId,
            trimmedRemarks,
            parsedProgramDate,
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

router.get("/commission_settlement", checkSession, function (req, res) {
	const data = sessions(req, 'commission_settlement');
	data.permissions = req.session.permissions;
	res.render("junket/commission_settlement", data);
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
    const startRaw = String(req.query.start || req.query.fromDate || '').trim().slice(0, 10);
    const endRaw = String(req.query.end || req.query.toDate || '').trim().slice(0, 10);
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? startRaw : null;
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? endRaw : null;

    let whereSql = 'WHERE ac.ACTIVE = 1';
    const params = [];

    if (startDate && endDate) {
        whereSql += ` AND DATE(COALESCE(ac.PROGRAM_DATE, ac.ENCODED_DT)) BETWEEN ? AND ?`;
        params.push(startDate, endDate);
    } else if (startDate) {
        whereSql += ` AND DATE(COALESCE(ac.PROGRAM_DATE, ac.ENCODED_DT)) >= ?`;
        params.push(startDate);
    } else if (endDate) {
        whereSql += ` AND DATE(COALESCE(ac.PROGRAM_DATE, ac.ENCODED_DT)) <= ?`;
        params.push(endDate);
    }

    const query = `
        SELECT
            ac.IDNo,
            ac.AGENT_ID,
            COALESCE(agent.AGENT_CODE, CAST(ac.AGENT_ID AS CHAR), '') AS account,
            COALESCE(NULLIF(TRIM(ac.AGENT_NAME), ''), agent.NAME, '') AS name,
            ac.TYPE,
            ac.AMOUNT,
            ac.REMARKS,
            ac.PROGRAM_DATE,
            ac.ENCODED_DT,
            ac.ADDITIONAL_SETTLEMENT_ID
        FROM additional_commission ac
        LEFT JOIN agent ON agent.IDNo = ac.AGENT_ID
        ${whereSql}
        ORDER BY COALESCE(ac.PROGRAM_DATE, DATE(ac.ENCODED_DT)) DESC, ac.IDNo DESC`;

    try {
        const [rows] = await pool.execute(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error loading additional commission data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const ADDITIONAL_SETTLED_LOCKED = 'This additional commission is already settled and can no longer be changed.';

/** True when the additional_commission row belongs to an Additional settlement (locked). */
async function isAdditionalCommissionSettled(id) {
    const [rows] = await pool.execute(
        'SELECT ADDITIONAL_SETTLEMENT_ID FROM additional_commission WHERE IDNo = ? LIMIT 1',
        [id]
    );
    return !!(rows.length && rows[0].ADDITIONAL_SETTLEMENT_ID != null);
}

/**
 * Slip label per row: the account code (same as the table's Account # column).
 * CASE/CHAR_LENGTH instead of NULLIF(…, ''): AGENT_CODE's collation can't be compared with a literal here.
 */
const SQL_ADDITIONAL_ACCOUNT_CODE = 'COALESCE(agent.AGENT_CODE, CAST(ac.AGENT_ID AS CHAR))';
const SQL_ADDITIONAL_SETTLEMENT_GROUP =
    `CASE WHEN CHAR_LENGTH(TRIM(${SQL_ADDITIONAL_ACCOUNT_CODE})) > 0 THEN TRIM(${SQL_ADDITIONAL_ACCOUNT_CODE}) ELSE 'No Account' END`;

function formatSettlementYmd(ymd) {
    const p = String(ymd).split('-').map(Number);
    return `${p[1]}/${p[2]}/${p[0]}`;
}

function todayLocalYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * SETTLE ADDITIONAL COMMISSION (Settlement (Additional) modal → Save)
 * Settles every unsettled additional_commission row whose program date is within fromDate..toDate:
 * withdraws the total from junket_capital (TRANSACTION_ID = 2, DESCRIPTION = 'Additional') and tags
 * the rows with ADDITIONAL_SETTLEMENT_ID. Account ledgers (Transfer type) are left untouched.
 */
router.post('/additional_commission/settle', checkSession, async (req, res) => {
    const fromDate = parseProgramDate(req.body?.fromDate);
    const toDate = parseProgramDate(req.body?.toDate);
    if (!fromDate || !toDate || fromDate > toDate) {
        return res.status(400).json({ error: 'Select a valid Start and Finish date.' });
    }
    const expectedRaw = req.body?.expectedAmount;
    const expectedAmount = expectedRaw === undefined || expectedRaw === null || expectedRaw === ''
        ? null
        : Number(expectedRaw);

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT IDNo, AMOUNT
             FROM additional_commission
             WHERE ACTIVE = 1
               AND ADDITIONAL_SETTLEMENT_ID IS NULL
               AND DATE(COALESCE(PROGRAM_DATE, ENCODED_DT)) BETWEEN ? AND ?
             FOR UPDATE`,
            [fromDate, toDate]
        );
        if (!rows.length) {
            await connection.rollback();
            return res.status(400).json({ error: 'Nothing to settle for the selected dates.' });
        }

        const amount = Math.round(rows.reduce((acc, r) => acc + (Number(r.AMOUNT) || 0), 0) * 100) / 100;

        if (expectedAmount !== null && Number.isFinite(expectedAmount) && Math.abs(expectedAmount - amount) >= 0.01) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Additional commission changed since the settlement was opened. Please review the new total.',
                amount
            });
        }

        const dateNow = new Date();
        const userId = req.session?.user_id ?? null;

        const [settleResult] = await connection.execute(
            `INSERT INTO additional_commission_settlement (DATE_FROM, DATE_TO, AMOUNT, ACTIVE, ENCODED_BY, ENCODED_DT)
             VALUES (?, ?, ?, 1, ?, ?)`,
            [fromDate, toDate, amount, userId, dateNow]
        );
        const settlementId = settleResult.insertId;

        let capitalId = null;
        if (amount > 0) {
            const [userRows] = await connection.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [userId]);
            const fullname = userRows.length ? userRows[0].FIRSTNAME || null : null;
            const remarks = `Additional settlement ${formatSettlementYmd(fromDate)} - ${formatSettlementYmd(toDate)}`;
            const [capitalResult] = await connection.execute(
                `INSERT INTO junket_capital
                    (TRANSACTION_ID, FULLNAME, DESCRIPTION, AMOUNT, REMARKS, ACTIVE, ENCODED_BY, ENCODED_DT, PROGRAM_DATE)
                 VALUES (2, ?, 'Additional', ?, ?, 1, ?, ?, ?)`,
                [fullname, amount, remarks, userId, dateNow, todayLocalYmd()]
            );
            capitalId = capitalResult.insertId;
            await connection.execute(
                'UPDATE additional_commission_settlement SET CAPITAL_ID = ? WHERE IDNo = ?',
                [capitalId, settlementId]
            );
        }

        const ids = rows.map((r) => r.IDNo);
        await connection.execute(
            `UPDATE additional_commission SET ADDITIONAL_SETTLEMENT_ID = ? WHERE IDNo IN (${ids.map(() => '?').join(',')})`,
            [settlementId, ...ids]
        );

        const total = await getAdditionalCommissionTotal(connection);
        await connection.commit();
        res.json({ success: true, settlement_id: settlementId, capital_id: capitalId, amount, count: ids.length, total });
    } catch (err) {
        if (connection) {
            try { await connection.rollback(); } catch (rollbackErr) { /* ignore */ }
        }
        console.error('Error settling additional commission:', err);
        res.status(500).json({ error: 'Failed to settle additional commission' });
    } finally {
        if (connection) connection.release();
    }
});

/** View one saved Additional settlement (Authorized Master Account ledger), grouped per account code. */
router.get('/additional_commission_settlement/:id', checkSession, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

        const [settleRows] = await pool.execute(
            `SELECT IDNo,
                DATE_FORMAT(DATE_FROM, '%Y-%m-%d') AS DATE_FROM,
                DATE_FORMAT(DATE_TO, '%Y-%m-%d') AS DATE_TO,
                AMOUNT, CAPITAL_ID, ENCODED_DT
             FROM additional_commission_settlement
             WHERE IDNo = ? AND ACTIVE = 1
             LIMIT 1`,
            [id]
        );
        if (!settleRows.length) return res.status(404).json({ error: 'Settlement not found' });

        const [groupRows] = await pool.execute(
            `SELECT ${SQL_ADDITIONAL_SETTLEMENT_GROUP} AS NAME, SUM(ac.AMOUNT) AS AMOUNT
             FROM additional_commission ac
             LEFT JOIN agent ON agent.IDNo = ac.AGENT_ID
             WHERE ac.ADDITIONAL_SETTLEMENT_ID = ? AND ac.ACTIVE = 1
             GROUP BY ${SQL_ADDITIONAL_SETTLEMENT_GROUP}
             ORDER BY NAME ASC`,
            [id]
        );

        const settlement = settleRows[0];
        res.json({
            id: settlement.IDNo,
            date_from: settlement.DATE_FROM,
            date_to: settlement.DATE_TO,
            amount: Number(settlement.AMOUNT) || 0,
            capital_id: settlement.CAPITAL_ID,
            settled_at: settlement.ENCODED_DT,
            // Additional commission is a cost (negative on the slip).
            mains: groupRows.map((r) => ({ name: r.NAME, amount: -(Number(r.AMOUNT) || 0) })),
            total: -(Number(settlement.AMOUNT) || 0)
        });
    } catch (err) {
        console.error('Error loading additional commission settlement:', err);
        res.status(500).json({ error: 'Failed to load settlement' });
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
            parsedProgramDate: payload.parsedProgramDate,
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
    if (req.session?.permissions !== 0) {
        return res.status(403).json({ message: 'Only Super Admin can edit additional commission.' });
    }

    const recordId = parseInt(req.params.id, 10);
    if (recordId && await isAdditionalCommissionSettled(recordId)) {
        return res.status(409).json({ message: ADDITIONAL_SETTLED_LOCKED });
    }

    const connection = await pool.getConnection();

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
            parsedProgramDate: payload.parsedProgramDate,
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
    if (req.session?.permissions !== 0) {
        return res.status(403).json({ message: 'Only Super Admin can delete additional commission.' });
    }

    const recordId = parseInt(req.params.id, 10);
    if (recordId && await isAdditionalCommissionSettled(recordId)) {
        return res.status(409).json({ message: ADDITIONAL_SETTLED_LOCKED });
    }

    const connection = await pool.getConnection();

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
            -- Add charge is per game (same source as Game List). game_list.FNB holds the
            -- whole group's total on the primary game after a merged settlement.
            COALESCE((
                SELECT SUM(gs.AMOUNT)
                FROM game_services gs
                WHERE gs.GAME_ID = game_list.IDNo
                  AND gs.ACTIVE = 1
                  AND gs.TRANSACTION_ID = 3
            ), 0) AS fnb,
            game_list.PAYMENT AS payment,
            game_list.ACCOUNT_ID,
            game_list.ENCODED_DT AS GAME_DATE_START,
            game_list.GAME_ENDED,
            game_list.PROGRAM_DATE,
            game_list.GAME_TYPE,
            game_list.SETTLED,
            game_list.COMMISSION_PERCENTAGE, game_list.SHARE_PERCENTAGE, game_list.ROLLING_PERCENTAGE,
            game_list.COMMISSION_TYPE,
            account.IDNo AS account_no,
            agent.IDNo AS agent_id,
            agent.AGENT_CODE AS agent_code,
            agent.NAME AS agent_name,
            agent.AGENCY AS agency_id,
            COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS guest_name,
            g.MEMBERSHIP_NO AS membership_no
        FROM game_list 
        JOIN account ON game_list.ACCOUNT_ID = account.IDNo
        JOIN agent ON agent.IDNo = account.AGENT_ID
        JOIN agency ON agency.IDNo = agent.AGENCY
        LEFT JOIN guest g ON g.IDNo = game_list.GUEST_ID
        WHERE game_list.ACTIVE != 0
          AND game_list.SETTLED = 1
          AND DATE(COALESCE(game_list.PROGRAM_DATE, game_list.ENCODED_DT)) >= ?
          AND DATE(COALESCE(game_list.PROGRAM_DATE, game_list.ENCODED_DT)) <= ?
        ORDER BY COALESCE(game_list.PROGRAM_DATE, game_list.ENCODED_DT) DESC, game_list.IDNo DESC`;

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