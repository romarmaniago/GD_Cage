/**
 * API routes for external apps (e.g. Flutter)
 * Base path: /api
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const argon2 = require('argon2');
const crypto = require('crypto');

// --- Helper: compute total rolling per game using same formula as game list ---
// Formula: total_rolling_nn + total_roller_return_cc + total_rolling_amount + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn
// Recs must have: GAME_ID, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION
function computeRollingGameListStyle(recs) {
  const byGame = {};
  recs.forEach((r) => {
    const gid = r.GAME_ID;
    if (!byGame[gid]) byGame[gid] = {
      buyin: 0,
      cashout: 0,
      total_cash_out_nn: 0,
      total_rolling_nn: 0,
      total_rolling_amount: 0,
      total_rolling_real: 0,
      total_rolling_nn_real: 0,
      total_rolling_cc_real: 0,
      total_roller_return_cc: 0,
    };
    const ct = Number(r.CAGE_TYPE);
    const amt = Number(r.AMOUNT) || 0;
    const nn = Number(r.NN_CHIPS) || 0;
    const cc = Number(r.CC_CHIPS) || 0;
    const rollerCC = Number(r.ROLLER_CC_CHIPS) || 0;
    const rollerTx = parseInt(r.ROLLER_TRANSACTION, 10) || 1;

    if (ct === 1) byGame[gid].buyin += amt + nn + cc;
    if (ct === 2) {
      byGame[gid].cashout += amt + nn + cc;
      byGame[gid].total_cash_out_nn += nn;
    }
    if (ct === 3) {
      byGame[gid].total_rolling_amount += amt;
      byGame[gid].total_rolling_nn += nn;
    }
    if (ct === 4) {
      byGame[gid].total_rolling_real += amt;
      byGame[gid].total_rolling_nn_real += nn;
      byGame[gid].total_rolling_cc_real += cc;
    }
    if (ct === 5 && rollerTx === 2) byGame[gid].total_roller_return_cc += rollerCC;
  });

  let totalRollingSum = 0;
  Object.keys(byGame).forEach((gid) => {
    const g = byGame[gid];
    const totalRollingCCWithReturns = g.total_roller_return_cc;
    g.rolling = g.total_rolling_nn + totalRollingCCWithReturns + g.total_rolling_amount + g.total_rolling_real + g.total_rolling_nn_real + g.total_rolling_cc_real - g.total_cash_out_nn;
    totalRollingSum += g.rolling;
  });
  return { byGame, totalRollingSum };
}

// --- Helper: same rolling + winloss formula, aggregated by agent (for ranking) ---
// Recs must have: GAME_ID, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, agent_id, AGENT_CODE, agent_name
// Optional: COMMISSION_TYPE, COMMISSION_PERCENTAGE (from game_list) to compute total commission per guest (same as game history modal).
// Returns: { byGame, byAgent } with byAgent[].commission when commission fields present.
function computeRollingAndWinlossByAgent(recs) {
  const byGame = {};
  recs.forEach((r) => {
    const gid = r.GAME_ID;
    if (!byGame[gid]) byGame[gid] = {
      agent_id: r.agent_id,
      AGENT_CODE: r.AGENT_CODE,
      agent_name: r.agent_name,
      buyin: 0,
      cashout: 0,
      total_cash_out_nn: 0,
      total_rolling_nn: 0,
      total_rolling_amount: 0,
      total_rolling_real: 0,
      total_rolling_nn_real: 0,
      total_rolling_cc_real: 0,
      total_roller_return_cc: 0,
      COMMISSION_TYPE: r.COMMISSION_TYPE != null ? Number(r.COMMISSION_TYPE) : null,
      COMMISSION_PERCENTAGE: r.COMMISSION_PERCENTAGE != null ? Number(r.COMMISSION_PERCENTAGE) : null,
    };
    const ct = Number(r.CAGE_TYPE);
    const amt = Number(r.AMOUNT) || 0;
    const nn = Number(r.NN_CHIPS) || 0;
    const cc = Number(r.CC_CHIPS) || 0;
    const rollerCC = Number(r.ROLLER_CC_CHIPS) || 0;
    const rollerTx = parseInt(r.ROLLER_TRANSACTION, 10) || 1;

    if (ct === 1) byGame[gid].buyin += amt + nn + cc;
    if (ct === 2) {
      byGame[gid].cashout += amt + nn + cc;
      byGame[gid].total_cash_out_nn += nn;
    }
    if (ct === 3) {
      byGame[gid].total_rolling_amount += amt;
      byGame[gid].total_rolling_nn += nn;
    }
    if (ct === 4) {
      byGame[gid].total_rolling_real += amt;
      byGame[gid].total_rolling_nn_real += nn;
      byGame[gid].total_rolling_cc_real += cc;
    }
    if (ct === 5 && rollerTx === 2) byGame[gid].total_roller_return_cc += rollerCC;
  });

  const byAgent = {};
  Object.keys(byGame).forEach((gid) => {
    const g = byGame[gid];
    const totalRollingCCWithReturns = g.total_roller_return_cc;
    g.rolling = g.total_rolling_nn + totalRollingCCWithReturns + g.total_rolling_amount + g.total_rolling_real + g.total_rolling_nn_real + g.total_rolling_cc_real - g.total_cash_out_nn;
    g.winloss = g.buyin - g.cashout;

    // Commission per game: same formula as account_game_history / game history modal (per guest)
    let gameCommission = 0;
    const commType = g.COMMISSION_TYPE;
    const commPct = g.COMMISSION_PERCENTAGE;
    if (commType != null && commPct != null && commPct > 0) {
      if (commType === 1 || commType === 3) {
        gameCommission = Math.round((g.rolling * commPct) / 100);
      } else if (commType === 2) {
        gameCommission = Math.round((g.winloss * commPct) / 100);
      }
    }

    const aid = g.agent_id;
    if (!byAgent[aid]) byAgent[aid] = { agent_id: aid, agent_code: g.AGENT_CODE, agent_name: g.agent_name, rolling: 0, winloss: 0, commission: 0 };
    byAgent[aid].rolling += g.rolling;
    byAgent[aid].winloss += g.winloss;
    byAgent[aid].commission += gameCommission;
  });
  return { byGame, byAgent };
}

// --- Helpers: resolve game IDs for a date (for daily settlement) ---
// When allowLiveFallback is true and dateStr is today, returns all active games if no settlement (for live today).
// For past dates or future dates with no settlement, returns [] so chart shows zeros.
async function getGameIdsForDate(dateStr, todayStr, allowLiveFallback = true) {
  const [hasSettlement] = await pool.execute(
    'SELECT 1 AS ok FROM daily_settlement WHERE SETTLEMENT_DATE = ? AND ACTIVE = 1 LIMIT 1',
    [dateStr]
  );
  if (hasSettlement.length > 0) {
    const [rows] = await pool.execute(
      `SELECT dsg.GAME_ID FROM daily_settlement_games dsg
       JOIN daily_settlement ds ON dsg.DAILY_SETTLEMENT_ID = ds.IDNo AND ds.ACTIVE = 1
       WHERE ds.SETTLEMENT_DATE = ? ORDER BY dsg.GAME_ID`,
      [dateStr]
    );
    return rows.map((r) => r.GAME_ID);
  }
  // Future date: never return games (chart must show zeros).
  if (dateStr > todayStr) return [];
  // Past date with no settlement: no games for that day.
  if (dateStr < todayStr) return [];
  // Today with no settlement: use all active games for live data.
  if (!allowLiveFallback) return [];
  const [rows] = await pool.execute(
    `SELECT IDNo FROM game_list WHERE ACTIVE != 0 AND (DAILY_SETTLEMENT = 1 OR DAILY_SETTLEMENT IS NULL) ORDER BY IDNo ASC`
  );
  return rows.map((r) => r.IDNo);
}

function isValidDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// ========== 1. REAL-TIME ==========

// Helper: MySQL SUM/DECIMAL can come as string; ensure number
const toNum = (v) => (v != null && v !== '') ? Number(v) : 0;
const rowVal = (rows, key) => toNum(rows[0]?.[key]);

/**
 * Fetches realtime data using the SAME formulas as dashboard.ejs.
 * Returns { success, ongoing_games, total_chips, cash_balance, guest_balance, net_junket_money, net_junket_cash }.
 */
async function getRealtimeData() {
  // --- Ongoing games: buyin (CAGE_TYPE=1) and cashout (CAGE_TYPE=2) same as gamebook/game_list ---
  const [onGameList] = await pool.execute(
    `SELECT gl.IDNo AS game_id, gl.ACCOUNT_ID, gl.ENCODED_DT, gl.GAME_TYPE AS game_type,
            a.IDNo AS account_id, ag.AGENT_CODE, ag.NAME AS agent_name,
            SUM(CASE WHEN gr.CAGE_TYPE = 1 THEN COALESCE(gr.NN_CHIPS, 0) + COALESCE(gr.CC_CHIPS, 0) ELSE 0 END) AS buyin,
            SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN COALESCE(gr.NN_CHIPS, 0) + COALESCE(gr.CC_CHIPS, 0) ELSE 0 END) AS cashout
     FROM game_list gl
     JOIN account a ON gl.ACCOUNT_ID = a.IDNo
     JOIN agent ag ON a.AGENT_ID = ag.IDNo
     LEFT JOIN game_record gr ON gr.GAME_ID = gl.IDNo AND gr.ACTIVE != 0
     WHERE gl.ACTIVE NOT IN (0, 1)
     GROUP BY gl.IDNo, gl.ACCOUNT_ID, gl.ENCODED_DT, gl.GAME_TYPE, a.IDNo, ag.AGENT_CODE, ag.NAME
     ORDER BY gl.IDNo ASC`
  );

  // --- Dashboard-style queries (same as routes/dashboard.js + views/dashboard.ejs) ---
  const [
    [rTotalChipsBuyin], [rTotalChipsCashout], [rCCChipsBuyin], [rAccountNNChips], [rTotalCashOutRolling],
    [rAccountCCChipsReturn], [rCCChipsBuyinGame], [rCCBuyin], [rCCReturn], [rNNBuyin], [rNNReturn],
    [rRollerNNSubtract], [rRollerNNAdd], [rRollerCCSubtract], [rRollerCCAdd],
    [rCashDeposit], [rCashWithdraw], [rJunketExpense], [rNNChipsBuyin], [rAccountDeposit], [rSettlementDeposit],
    [rAccountWithdraw], [rNNChipsAccountCash], [rCCChipsBuyinCashOnly], [rTotalCashOut], [rAccountSettlement],
    [rAccountServicesDeduct], [rAccountTransfer], [rMArkerReturnCash], [rReturnMoney],
    [rAccountDeduct], [rMarkerIssueAccount], [rMArkerReturnDeposit]
  ] = await Promise.all([
    pool.execute('SELECT SUM(TOTAL_CHIPS) AS TotalChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute('SELECT SUM(TOTAL_CHIPS) AS TotalChipsCashout FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2'),
    pool.execute('SELECT SUM(CC_CHIPS) AS CCChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute('SELECT SUM(NN_CHIPS) AS TOTAL_NN FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=1'),
    pool.execute('SELECT SUM(NN_CHIPS) AS TOTAL_CASHOUT FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=2'),
    pool.execute('SELECT SUM(CC_CHIPS) AS CC_CHIPS_RETURN FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=2'),
    pool.execute('SELECT SUM(CC_CHIPS) AS TOTAL_CC FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=1 AND TRANSACTION IN (1,2,3)'),
    pool.execute('SELECT SUM(CC_CHIPS) AS CCBuyin FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute('SELECT SUM(CC_CHIPS) AS CCReturn FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2'),
    pool.execute('SELECT SUM(NN_CHIPS) AS NNBuyin FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute('SELECT SUM(NN_CHIPS) AS NNReturn FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2'),
    pool.execute('SELECT SUM(ROLLER_NN_CHIPS) AS ROLLER_NN_SUBTRACT FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=5 AND ROLLER_TRANSACTION=1'),
    pool.execute('SELECT SUM(ROLLER_NN_CHIPS) AS ROLLER_NN_ADD FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=5 AND ROLLER_TRANSACTION=2'),
    pool.execute('SELECT SUM(ROLLER_CC_CHIPS) AS ROLLER_CC_SUBTRACT FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=5 AND ROLLER_TRANSACTION=1'),
    pool.execute('SELECT SUM(ROLLER_CC_CHIPS) AS ROLLER_CC_ADD FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=5 AND ROLLER_TRANSACTION=2'),
    pool.execute('SELECT SUM(AMOUNT) AS CASH_DEPOSIT FROM junket_capital WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute('SELECT SUM(AMOUNT) AS CASH_WITHDRAW FROM junket_capital WHERE ACTIVE=1 AND TRANSACTION_ID=2'),
    pool.execute('SELECT SUM(AMOUNT) AS JUNKET_EXPENSE FROM junket_house_expense WHERE ACTIVE=1'),
    pool.execute('SELECT SUM(NN_CHIPS) AS NNChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_DEPOSIT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=2 AND account_ledger.TRANSACTION_ID=1 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS SETTLEMENT_DEPOSIT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=5 AND account_ledger.TRANSACTION_ID=1 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_WITHDRAW FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=2 AND account_ledger.TRANSACTION_DESC='ACCOUNT DETAILS' AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute('SELECT SUM(NN_CHIPS) AS TOTAL_NN_CASH FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=1 AND TRANSACTION=1'),
    pool.execute('SELECT SUM(CC_CHIPS) AS CC_CHIPS_BUYIN_CASH_ONLY FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=1 AND TRANSACTION=1'),
    pool.execute('SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_CASHOUT FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=2'),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_SETTLEMENT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=5 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_DEDUCT_SERVICES FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=2 AND account_ledger.TRANSACTION_DESC='SERVICES' AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_TRANSFER FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=1 AND account_ledger.TRANSFER=1 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_CASH FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=3 AND account_ledger.TRANSACTION_ID=11 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute('SELECT SUM(rm.AMOUNT) AS RETURN_MONEY FROM junket_return_money rm WHERE rm.ACTIVE=1'),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_DEDUCT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=2 AND account_ledger.TRANSACTION_DESC NOT IN ('ACCOUNT DETAILS','SERVICES') AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS TOTAL_ISSUE_RECORD FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=3 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_DEPOSIT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=3 AND account_ledger.TRANSACTION_ID=12 AND account.ACTIVE=1 AND agent.ACTIVE=1`)
  ]);

  // Game services: single SUM (dashboard uses first row only; we sum all for correctness)
  const [[rServiceCashGuest], [rServiceDepositGuest], [rServiceCashJunket], [rServiceDepositJunket]] = await Promise.all([
    pool.execute("SELECT SUM(AMOUNT) AS TOTAL FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=1 AND SOURCE_TYPE='GUEST'"),
    pool.execute("SELECT SUM(AMOUNT) AS TOTAL FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=2 AND SOURCE_TYPE='GUEST'"),
    pool.execute("SELECT SUM(AMOUNT) AS TOTAL FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=1 AND SOURCE_TYPE='JUNKET'"),
    pool.execute("SELECT SUM(AMOUNT) AS TOTAL FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=2 AND SOURCE_TYPE='JUNKET'")
  ]);

  const TotalChipsBuyin = rowVal(rTotalChipsBuyin, 'TotalChipsBuyin');
  const TotalChipsCashout = rowVal(rTotalChipsCashout, 'TotalChipsCashout');
  const CCChipsBuyin = rowVal(rCCChipsBuyin, 'CCChipsBuyin');
  const TOTAL_NN = rowVal(rAccountNNChips, 'TOTAL_NN');
  const TotalCashOutRolling = rowVal(rTotalCashOutRolling, 'TOTAL_CASHOUT');
  const CC_CHIPS_RETURN = rowVal(rAccountCCChipsReturn, 'CC_CHIPS_RETURN');
  const TOTAL_CC = rowVal(rCCChipsBuyinGame, 'TOTAL_CC');
  const CCBuyin = rowVal(rCCBuyin, 'CCBuyin');
  const CCReturn = rowVal(rCCReturn, 'CCReturn');
  const NNBuyin = rowVal(rNNBuyin, 'NNBuyin');
  const NNReturn = rowVal(rNNReturn, 'NNReturn');
  const ROLLER_NN_SUBTRACT = rowVal(rRollerNNSubtract, 'ROLLER_NN_SUBTRACT');
  const ROLLER_NN_ADD = rowVal(rRollerNNAdd, 'ROLLER_NN_ADD');
  const ROLLER_CC_SUBTRACT = rowVal(rRollerCCSubtract, 'ROLLER_CC_SUBTRACT');
  const ROLLER_CC_ADD = rowVal(rRollerCCAdd, 'ROLLER_CC_ADD');

  // Total Chips Balance (same as dashboard.ejs lines 189-205)
  const total_chips = TotalChipsBuyin - TotalChipsCashout + CCChipsBuyin - TOTAL_NN + TotalCashOutRolling + CC_CHIPS_RETURN - CCChipsBuyin - TOTAL_CC + CCBuyin - CCReturn + NNBuyin - NNReturn - ROLLER_NN_SUBTRACT + ROLLER_NN_ADD - ROLLER_CC_SUBTRACT + ROLLER_CC_ADD;

  const CASH_DEPOSIT = rowVal(rCashDeposit, 'CASH_DEPOSIT');
  const CASH_WITHDRAW = rowVal(rCashWithdraw, 'CASH_WITHDRAW');
  const JUNKET_EXPENSE = rowVal(rJunketExpense, 'JUNKET_EXPENSE');
  const NNChipsBuyin = rowVal(rNNChipsBuyin, 'NNChipsBuyin');
  const ACCOUNT_DEPOSIT = rowVal(rAccountDeposit, 'ACCOUNT_DEPOSIT');
  const SETTLEMENT_DEPOSIT = rowVal(rSettlementDeposit, 'SETTLEMENT_DEPOSIT');
  const ACCOUNT_WITHDRAW = rowVal(rAccountWithdraw, 'ACCOUNT_WITHDRAW');
  const TOTAL_NN_CASH = rowVal(rNNChipsAccountCash, 'TOTAL_NN_CASH');
  const CC_CHIPS_BUYIN_CASH_ONLY = rowVal(rCCChipsBuyinCashOnly, 'CC_CHIPS_BUYIN_CASH_ONLY');
  const TotalCashOut = rowVal(rTotalCashOut, 'TOTAL_CASHOUT');
  const ACCOUNT_SETTLEMENT = rowVal(rAccountSettlement, 'ACCOUNT_SETTLEMENT');
  const ACCOUNT_DEDUCT_SERVICES = rowVal(rAccountServicesDeduct, 'ACCOUNT_DEDUCT_SERVICES');
  const ServiceCashGuest = rowVal(rServiceCashGuest, 'TOTAL');
  const ServiceDepositGuest = rowVal(rServiceDepositGuest, 'TOTAL');
  const ServiceCashJunket = rowVal(rServiceCashJunket, 'TOTAL');
  const ServiceDepositJunket = rowVal(rServiceDepositJunket, 'TOTAL');
  const ACCOUNT_TRANSFER = rowVal(rAccountTransfer, 'ACCOUNT_TRANSFER');
  const MARKER_RETURN_CASH = rowVal(rMArkerReturnCash, 'MARKER_RETURN_CASH');
  const RETURN_MONEY = rowVal(rReturnMoney, 'RETURN_MONEY');

  // Cash Balance (same as dashboard.ejs lines 249-260)
  const cash_balance = CASH_DEPOSIT - CCChipsBuyin - CASH_WITHDRAW - JUNKET_EXPENSE - NNChipsBuyin + ACCOUNT_DEPOSIT + SETTLEMENT_DEPOSIT - ACCOUNT_WITHDRAW + TotalChipsCashout + TOTAL_NN_CASH + CC_CHIPS_BUYIN_CASH_ONLY - TotalCashOut - ACCOUNT_SETTLEMENT - ACCOUNT_DEDUCT_SERVICES + ServiceCashGuest + ServiceDepositGuest - ServiceCashJunket - ServiceDepositJunket - ACCOUNT_TRANSFER + MARKER_RETURN_CASH + RETURN_MONEY;

  const ACCOUNT_DEDUCT = rowVal(rAccountDeduct, 'ACCOUNT_DEDUCT');
  const TOTAL_ISSUE_RECORD = rowVal(rMarkerIssueAccount, 'TOTAL_ISSUE_RECORD');
  const MARKER_RETURN_DEPOSIT = rowVal(rMArkerReturnDeposit, 'MARKER_RETURN_DEPOSIT');

  // Guest Balance (same as dashboard.ejs lines 262-269)
  const guest_balance = Math.round(ACCOUNT_DEPOSIT + SETTLEMENT_DEPOSIT - ACCOUNT_WITHDRAW - ACCOUNT_DEDUCT - ACCOUNT_DEDUCT_SERVICES + TOTAL_ISSUE_RECORD - MARKER_RETURN_DEPOSIT);

  // houseBalance & net (same as dashboard.ejs 272-276)
  const houseBalance = cash_balance + total_chips;
  const net_junket_money = houseBalance - guest_balance;
  const net_junket_cash = cash_balance - guest_balance;

  // Ensure encoded_dt is sent as ISO UTC so the app shows correct local time (e.g. Philippines).
  const toIsoUtc = (v) => {
    if (v == null) return v;
    const d = v instanceof Date ? v : new Date(typeof v === 'string' && !/Z|[-+]\d{2}:?\d{2}$/.test(v.trim()) ? v.trim() + 'Z' : v);
    return isNaN(d.getTime()) ? v : d.toISOString();
  };
  return {
    success: true,
    ongoing_games: onGameList.map((g) => ({
      game_id: g.game_id,
      account_id: g.account_id,
      agent_code: g.AGENT_CODE,
      agent_name: g.agent_name,
      buyin: Number(g.buyin) || 0,
      cashout: Number(g.cashout) || 0,
      encoded_dt: toIsoUtc(g.ENCODED_DT),
      game_type: g.game_type || '',
    })),
    total_chips,
    cash_balance,
    guest_balance,
    net_junket_money,
    net_junket_cash,
  };
}

/**
 * GET /api/realtime
 * Real-time: ongoing games, total chips, cash balance, guest balance, net junket money, net junket cash.
 * No query params required.
 */
router.get('/realtime', async (req, res) => {
  try {
    const data = await getRealtimeData();
    res.json(data);
  } catch (err) {
    console.error('Error in GET /api/realtime:', err);
    res.status(500).json({ success: false, error: 'Error fetching realtime data' });
  }
});

// ========== AUTH (Flutter app login) ==========
// Same user_info table and password logic as routes/auth.js (Argon2 + MD5 fallback).

function isArgonHash(hash) {
  return typeof hash === 'string' && hash.startsWith('$argon2');
}
function generateMD5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

/**
 * POST /api/auth/login
 * Body: { username, password } (JSON).
 * Returns: { success, token, user: { username, firstname, lastname, user_id, permissions, role } } or { success: false, error }.
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const userStr = (username != null && String(username).trim()) ? String(username).trim() : '';
    const passStr = (password != null && String(password)) ? String(password) : '';
    if (!userStr || !passStr) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    const [results] = await pool.execute(
      `SELECT user_info.IDNo, user_info.USERNAME, user_info.FIRSTNAME, user_info.LASTNAME, user_info.PERMISSIONS, user_info.PASSWORD, user_info.SALT, user_role.ROLE AS role_name
       FROM user_info
       LEFT JOIN user_role ON user_role.IDNo = user_info.PERMISSIONS AND user_role.ACTIVE = 1
       WHERE user_info.USERNAME = ? AND user_info.ACTIVE = 1`,
      [userStr]
    );
    if (!results || results.length === 0) {
      return res.status(401).json({ success: false, error: 'User not found or inactive' });
    }
    const user = results[0];
    const storedPassword = user.PASSWORD;
    const salt = user.SALT;
    let isValid = false;
    let isLegacy = false;
    if (isArgonHash(storedPassword)) {
      isValid = await argon2.verify(storedPassword, passStr);
    } else {
      const hashedMD5 = generateMD5((salt || '') + passStr);
      isValid = (hashedMD5 === storedPassword);
      isLegacy = true;
    }
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Incorrect password' });
    }
    if (isLegacy) {
      const newHash = await argon2.hash(passStr);
      await pool.execute('UPDATE user_info SET PASSWORD = ?, SALT = NULL WHERE IDNo = ?', [newHash, user.IDNo]);
    }
    const newSessionToken = crypto.randomBytes(32).toString('hex');
    await pool.execute(
      'UPDATE user_info SET USER_STATUS = 1, LAST_LOGIN = NOW(), LAST_ACTIVITY = NOW(), SESSION_TOKEN = ? WHERE IDNo = ?',
      [newSessionToken, user.IDNo]
    );
    return res.json({
      success: true,
      token: newSessionToken,
      user: {
        username: user.USERNAME,
        firstname: user.FIRSTNAME || '',
        lastname: user.LASTNAME || '',
        user_id: user.IDNo,
        permissions: user.PERMISSIONS != null ? Number(user.PERMISSIONS) : 0,
        role: (user.role_name != null && String(user.role_name).trim()) ? String(user.role_name).trim() : 'User',
      },
    });
  } catch (err) {
    console.error('Error in POST /api/auth/login:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ========== NOTIFICATIONS (executive app) ==========
// Table: executive_notifications — created automatically on first API call (no manual DB step).
// Per-user isolation (Account A vs B):
//   - Read: executive_notification_reads(notification_id, user_id). When A marks as read, B still sees unread.
//   - Cleared: executive_notification_cleared(notification_id, user_id). When A clears, only A's list hides those; B still sees them.
// GET uses current user's token → only this user's readIds/clearedIds. PATCH/DELETE only write for this user.

const NOTIFICATIONS_TABLE = 'executive_notifications';
const NOTIFICATION_READS_TABLE = 'executive_notification_reads';
const NOTIFICATION_CLEARED_TABLE = 'executive_notification_cleared';

/** Resolve Authorization Bearer token to user_id (user_info.IDNo). Returns null if missing or invalid. */
async function getAuthUserId(req) {
  const auth = req.headers && req.headers.authorization;
  if (!auth || typeof auth !== 'string') return null;
  const token = auth.replace(/^\s*Bearer\s+/i, '').trim();
  if (!token) return null;
  const [rows] = await pool.execute(
    'SELECT IDNo FROM user_info WHERE SESSION_TOKEN = ? AND ACTIVE = 1 LIMIT 1',
    [token]
  );
  return rows && rows[0] ? Number(rows[0].IDNo) : null;
}

async function ensureNotificationsTable() {
  const createSql = `
    CREATE TABLE IF NOT EXISTS \`${NOTIFICATIONS_TABLE}\` (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'info',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      \`read\` TINYINT(1) NOT NULL DEFAULT 0,
      INDEX idx_created (created_at)
    )
  `;
  await pool.query(createSql);
  try {
    await pool.query(`ALTER TABLE \`${NOTIFICATIONS_TABLE}\` ADD COLUMN \`read\` TINYINT(1) NOT NULL DEFAULT 0`);
  } catch (e) {
    if (e?.code !== 'ER_DUP_FIELDNAME') throw e;
  }
}

async function ensureNotificationReadsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${NOTIFICATION_READS_TABLE}\` (
      notification_id INT NOT NULL,
      user_id INT NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notification_id, user_id),
      INDEX idx_user (user_id)
    )
  `);
}

/** Per user: notifications this user has "cleared" (read + clear) so they stay hidden from list. */
async function ensureNotificationClearedTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${NOTIFICATION_CLEARED_TABLE}\` (
      notification_id INT NOT NULL,
      user_id INT NOT NULL,
      cleared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notification_id, user_id),
      INDEX idx_user (user_id)
    )
  `);
}

const NOTIFICATION_PAGE_LIMIT = 20;

/**
 * GET /api/notifications
 * Returns notifications for the current user only. Read and cleared state are per user (user_id from Bearer token).
 * Query: limit (default 20), offset (default 0). Response: { notifications, total }.
 */
router.get('/notifications', async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    await ensureNotificationsTable();
    await ensureNotificationReadsTable();
    await ensureNotificationClearedTable();
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || NOTIFICATION_PAGE_LIMIT, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let clearedIds = new Set();
    if (userId != null) {
      const [clearedRows] = await pool.execute(`SELECT notification_id FROM \`${NOTIFICATION_CLEARED_TABLE}\` WHERE user_id = ?`, [userId]);
      clearedIds = new Set((clearedRows || []).map((r) => Number(r.notification_id)));
    }

    const clearedList = clearedIds.size > 0 ? [...clearedIds] : [0];
    const placeholders = clearedList.map(() => '?').join(',');
    const [totalRows] = await pool.query(
      `SELECT COUNT(*) AS c FROM \`${NOTIFICATIONS_TABLE}\` WHERE id NOT IN (${placeholders})`,
      clearedList
    );
    const total = Number(totalRows?.[0]?.c ?? 0);

    let [rows] = await pool.query(
      `SELECT id, title, message, type, created_at FROM \`${NOTIFICATIONS_TABLE}\` WHERE id NOT IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...clearedList, limit, offset]
    );
    if (!rows?.length && total === 0 && offset === 0) {
      await pool.query(
        `INSERT INTO \`${NOTIFICATIONS_TABLE}\` (title, message, type) VALUES
         ('System', 'Notifications are connected. Clear all to start fresh.', 'info'),
         ('Welcome', 'Demo CageX App is ready. You can monitor cage activity from here.', 'success')`
      );
      [rows] = await pool.query(
        `SELECT id, title, message, type, created_at FROM \`${NOTIFICATIONS_TABLE}\` WHERE id NOT IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...clearedList, limit, offset]
      );
    }
    rows = rows || [];
    let readIds = new Set();
    if (userId != null && rows.length > 0) {
      const ids = rows.map((r) => Number(r.id));
      const [readRows] = await pool.execute(
        `SELECT notification_id FROM \`${NOTIFICATION_READS_TABLE}\` WHERE user_id = ? AND notification_id IN (${ids.map(() => '?').join(',')})`,
        [userId, ...ids]
      );
      readIds = new Set((readRows || []).map((r) => Number(r.notification_id)));
    }
    const notifications = rows.map((r) => ({
      id: r.id,
      title: r.title || '',
      message: r.message || '',
      type: r.type || 'info',
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      read: readIds.has(Number(r.id)),
    }));
    res.json({ notifications, total });
  } catch (err) {
    console.error('Error in GET /api/notifications:', err);
    res.status(500).json({ success: false, error: 'Error fetching notifications' });
  }
});

const NOTIFICATION_DEDUPE_SECONDS = 30;

/**
 * Helper: create one notification in DB (for server-side use, e.g. from gamebook/routes).
 * Dedupe: same title+message in last 30s → return existing id (no double insert vs app-created).
 * Usage: const api = require('./routes/api'); await api.createServerNotification({ title, message, type });
 */
async function createServerNotification({ title, message, type }) {
  await ensureNotificationsTable();
  const titleStr = (title != null && String(title).trim()) ? String(title).trim() : 'Notification';
  const messageStr = (message != null && String(message).trim()) ? String(message).trim() : '';
  const typeStr = (type != null && String(type).trim()) ? String(type).trim() : 'info';

  const [existing] = await pool.query(
    `SELECT id FROM \`${NOTIFICATIONS_TABLE}\` WHERE title = ? AND message = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND) ORDER BY created_at DESC LIMIT 1`,
    [titleStr, messageStr, NOTIFICATION_DEDUPE_SECONDS]
  );
  if (existing && existing.length > 0) {
    return Number(existing[0].id);
  }

  const [result] = await pool.query(
    `INSERT INTO \`${NOTIFICATIONS_TABLE}\` (title, message, type) VALUES (?, ?, ?)`,
    [titleStr, messageStr, typeStr]
  );
  return result?.insertId != null ? Number(result.insertId) : null;
}

/**
 * POST /api/notifications
 * Create one notification (e.g. when new game appears in realtime).
 * Body: { title, message, type } (type optional, default 'info').
 * Dedupe: if same title+message was inserted in the last 30s, skip insert and return existing id (avoids duplicate from multiple tabs/clients).
 */
router.post('/notifications', async (req, res) => {
  try {
    await ensureNotificationsTable();
    const { title, message, type } = req.body || {};
    const titleStr = (title != null && String(title).trim()) ? String(title).trim() : 'Notification';
    const messageStr = (message != null && String(message).trim()) ? String(message).trim() : '';
    const typeStr = (type != null && String(type).trim()) ? String(type).trim() : 'info';

    const [existing] = await pool.query(
      `SELECT id FROM \`${NOTIFICATIONS_TABLE}\` WHERE title = ? AND message = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND) ORDER BY created_at DESC LIMIT 1`,
      [titleStr, messageStr, NOTIFICATION_DEDUPE_SECONDS]
    );
    if (existing && existing.length > 0) {
      return res.status(201).json({ success: true, id: Number(existing[0].id), duplicate: true });
    }

    const [result] = await pool.query(
      `INSERT INTO \`${NOTIFICATIONS_TABLE}\` (title, message, type) VALUES (?, ?, ?)`,
      [titleStr, messageStr, typeStr]
    );
    const id = result?.insertId;
    res.status(201).json({ success: true, id: id != null ? Number(id) : null });
  } catch (err) {
    console.error('Error in POST /api/notifications:', err);
    res.status(500).json({ success: false, error: 'Error creating notification' });
  }
});

/**
 * POST /api/notifications/from-server
 * Same as POST /api/notifications but for server-side callers. Uses same 30s dedupe (title+message)
 * so app and server don't create duplicate rows for the same event.
 * Body: { title, message, type }.
 */
router.post('/notifications/from-server', async (req, res) => {
  try {
    const id = await createServerNotification(req.body || {});
    res.status(201).json({ success: true, id });
  } catch (err) {
    console.error('Error in POST /api/notifications/from-server:', err);
    res.status(500).json({ success: false, error: 'Error creating notification' });
  }
});

/**
 * PATCH /api/notifications/:id
 * Mark one notification as read for this user only (other users keep it unread). Requires Authorization: Bearer <token>.
 */
router.patch('/notifications/:id', async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (userId == null) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }
    await ensureNotificationsTable();
    await ensureNotificationReadsTable();
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) {
      return res.status(400).json({ success: false, error: 'Invalid notification id' });
    }
    await pool.execute(
      `INSERT INTO \`${NOTIFICATION_READS_TABLE}\` (notification_id, user_id, read_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE read_at = NOW()`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error in PATCH /api/notifications/:id:', err);
    res.status(500).json({ success: false, error: 'Error marking notification as read' });
  }
});

/**
 * POST /api/notifications/mark-all-read
 * Mark all visible notifications as read for this user. List stays; red dot goes away. Per user.
 */
router.post('/notifications/mark-all-read', async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (userId == null) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }
    await ensureNotificationsTable();
    await ensureNotificationReadsTable();
    await ensureNotificationClearedTable();
    const [clearedRows] = await pool.execute(`SELECT notification_id FROM \`${NOTIFICATION_CLEARED_TABLE}\` WHERE user_id = ?`, [userId]);
    const clearedIds = new Set((clearedRows || []).map((r) => Number(r.notification_id)));
    const clearedList = clearedIds.size > 0 ? [...clearedIds] : [0];
    const placeholders = clearedList.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT id FROM \`${NOTIFICATIONS_TABLE}\` WHERE id NOT IN (${placeholders}) ORDER BY created_at DESC LIMIT 500`,
      clearedList
    );
    const ids = (rows || []).map((r) => Number(r.id)).filter((id) => id > 0);
    if (ids.length > 0) {
      await pool.execute(
        `INSERT INTO \`${NOTIFICATION_READS_TABLE}\` (notification_id, user_id, read_at) VALUES ${ids.map(() => '(?, ?, NOW())').join(',')} ON DUPLICATE KEY UPDATE read_at = NOW()`,
        ids.flatMap((id) => [id, userId])
      );
    }
    res.json({ success: true, marked: ids.length });
  } catch (err) {
    console.error('Error in POST /api/notifications/mark-all-read:', err);
    res.status(500).json({ success: false, error: 'Error marking all as read' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Hide this one notification for this user (swipe to dismiss). Other users still see it. Per user.
 */
router.delete('/notifications/:id', async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (userId == null) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }
    await ensureNotificationClearedTable();
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) {
      return res.status(400).json({ success: false, error: 'Invalid notification id' });
    }
    await pool.execute(
      `INSERT IGNORE INTO \`${NOTIFICATION_CLEARED_TABLE}\` (notification_id, user_id, cleared_at) VALUES (?, ?, NOW())`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error in DELETE /api/notifications/:id:', err);
    res.status(500).json({ success: false, error: 'Error hiding notification' });
  }
});

/**
 * DELETE /api/notifications
 * Clear all = hide every notification for this user in one go (read + unread). Other users unaffected.
 * No need to mark as read first; one tap clears the whole list for this user.
 */
router.delete('/notifications', async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (userId == null) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }
    await ensureNotificationsTable();
    await ensureNotificationReadsTable();
    await ensureNotificationClearedTable();
    const [rows] = await pool.query(
      `SELECT id FROM \`${NOTIFICATIONS_TABLE}\` ORDER BY created_at DESC LIMIT 100`
    );
    const allIds = (rows || []).map((r) => Number(r.id)).filter((id) => id > 0);
    if (allIds.length > 0) {
      await pool.execute(
        `INSERT IGNORE INTO \`${NOTIFICATION_CLEARED_TABLE}\` (notification_id, user_id, cleared_at) VALUES ${allIds.map(() => '(?, ?, NOW())').join(',')}`,
        allIds.flatMap((id) => [id, userId])
      );
    }
    await pool.execute(`DELETE FROM \`${NOTIFICATION_READS_TABLE}\` WHERE user_id = ?`, [userId]);
    res.json({ success: true, message: 'All notifications cleared for this user', cleared: allIds.length });
  } catch (err) {
    console.error('Error in DELETE /api/notifications:', err);
    res.status(500).json({ success: false, error: 'Error clearing notifications' });
  }
});

// ========== 2. DAILY SETTLEMENT ==========

/**
 * GET /api/daily-settlement
 * Daily settlement: number of games, buy-in, game rolling, win loss, commission, junket expenses.
 * Query: date=YYYY-MM-DD (optional, default today), or start_date & end_date for chart range.
 * Returns chart-ready data (labels + series) for graphs.
 */
router.get('/daily-settlement', async (req, res) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    let dateParam = req.query.date;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    const forChart = startDate && endDate && isValidDate(startDate) && isValidDate(endDate);

    if (forChart) {
      // Range: return daily series for graphs. Use client's start_date and end_date so labels align (e.g. last = "Today").
      // For dates after server today, push zeros so we still return 7 days and client can show correct weekday labels.
      const labels = [];
      const gameCounts = [];
      const buyins = [];
      const rollings = [];
      const winlosses = [];
      const commissions = [];
      const junketExpenses = [];

      const start = new Date(startDate + 'T00:00:00.000Z');
      const end = new Date(endDate + 'T00:00:00.000Z');
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        labels.push(dateStr);
        if (dateStr > todayStr) {
          gameCounts.push(0);
          buyins.push(0);
          rollings.push(0);
          winlosses.push(0);
          commissions.push(0);
          junketExpenses.push(0);
          continue;
        }
        const gameIds = await getGameIdsForDate(dateStr, todayStr, true);

        if (gameIds.length === 0) {
          gameCounts.push(0);
          buyins.push(0);
          rollings.push(0);
          winlosses.push(0);
          commissions.push(0);
          const [expRow] = await pool.execute(
            'SELECT COALESCE(SUM(AMOUNT), 0) AS v FROM junket_house_expense WHERE ACTIVE = 1 AND RESET = 1 AND DATE(ENCODED_DT) = ?',
            [dateStr]
          );
          junketExpenses.push(Number(expRow[0]?.v) || 0);
        } else {
          const ph = gameIds.map(() => '?').join(',');
          const [recs] = await pool.execute(
            `SELECT GAME_ID, CAGE_TYPE, COALESCE(AMOUNT, 0) AS AMOUNT, COALESCE(NN_CHIPS, 0) AS NN_CHIPS, COALESCE(CC_CHIPS, 0) AS CC_CHIPS,
             COALESCE(ROLLER_CC_CHIPS, 0) AS ROLLER_CC_CHIPS, ROLLER_TRANSACTION
             FROM game_record WHERE ACTIVE != 0 AND GAME_ID IN (${ph})`,
            gameIds
          );
          const { byGame, totalRollingSum } = computeRollingGameListStyle(recs);
          let totalBuyin = 0, totalWL = 0;
          Object.keys(byGame).forEach((gid) => {
            totalBuyin += byGame[gid].buyin;
            totalWL += byGame[gid].buyin - byGame[gid].cashout;
          });
          const totalRolling = totalRollingSum;

          const [commRows] = await pool.execute(
            `SELECT gl.IDNo, gl.COMMISSION_PERCENTAGE, gl.COMMISSION_TYPE
             FROM game_list gl WHERE gl.IDNo IN (${ph}) AND gl.ACTIVE != 0 AND gl.SETTLED = 1`,
            gameIds
          );
          let dayCommission = 0;
          for (const row of commRows) {
            const [cr] = await pool.execute(
              `SELECT SUM(CASE WHEN CAGE_TYPE IN (3,4) THEN NN_CHIPS+CC_CHIPS WHEN CAGE_TYPE=5 AND ROLLER_TRANSACTION=2 THEN ROLLER_CC_CHIPS ELSE 0 END) AS r,
                SUM(CASE WHEN CAGE_TYPE=2 THEN NN_CHIPS ELSE 0 END) AS c FROM game_record WHERE ACTIVE!=0 AND GAME_ID=?`,
              [row.IDNo]
            );
            const rolling = Number(cr[0]?.r) || 0;
            const cashout = Number(cr[0]?.c) || 0;
            if (row.COMMISSION_TYPE === 1) dayCommission += (rolling - cashout) * (row.COMMISSION_PERCENTAGE / 100);
            else if (row.COMMISSION_TYPE === 2) dayCommission += (byGame[row.IDNo] ? (byGame[row.IDNo].buyin - byGame[row.IDNo].cashout) : 0) * (row.COMMISSION_PERCENTAGE / 100);
          }

          const [expRow] = await pool.execute(
            'SELECT COALESCE(SUM(AMOUNT), 0) AS v FROM junket_house_expense WHERE ACTIVE = 1 AND RESET = 1 AND DATE(ENCODED_DT) = ?',
            [dateStr]
          );

          gameCounts.push(gameIds.length);
          buyins.push(totalBuyin);
          rollings.push(totalRolling);
          winlosses.push(totalWL);
          commissions.push(Math.round(dayCommission));
          junketExpenses.push(Number(expRow[0]?.v) || 0);
        }
      }

      return res.json({
        success: true,
        chart: {
          labels,
          number_of_games: gameCounts,
          buy_in: buyins,
          game_rolling: rollings,
          win_loss: winlosses,
          commission: commissions,
          junket_expenses: junketExpenses,
        },
      });
    }

    if (!dateParam || dateParam === '') dateParam = todayStr;
    if (!isValidDate(dateParam)) {
      return res.status(400).json({ success: false, error: 'Invalid date. Use YYYY-MM-DD.' });
    }

    const gameIds = await getGameIdsForDate(dateParam, todayStr);
    let number_of_games = gameIds.length;
    let buy_in = 0, game_rolling = 0, win_loss = 0, commission = 0;

    if (gameIds.length > 0) {
      const ph = gameIds.map(() => '?').join(',');
      const [recs] = await pool.execute(
        `SELECT GAME_ID, CAGE_TYPE, COALESCE(AMOUNT, 0) AS AMOUNT, COALESCE(NN_CHIPS, 0) AS NN_CHIPS, COALESCE(CC_CHIPS, 0) AS CC_CHIPS,
         COALESCE(ROLLER_CC_CHIPS, 0) AS ROLLER_CC_CHIPS, ROLLER_TRANSACTION
         FROM game_record WHERE ACTIVE != 0 AND GAME_ID IN (${ph})`,
        gameIds
      );
      const { byGame, totalRollingSum } = computeRollingGameListStyle(recs);
      Object.keys(byGame).forEach((gid) => {
        buy_in += byGame[gid].buyin;
        win_loss += byGame[gid].buyin - byGame[gid].cashout;
      });
      game_rolling = totalRollingSum;

      const [commRows] = await pool.execute(
        `SELECT gl.IDNo, gl.COMMISSION_PERCENTAGE, gl.COMMISSION_TYPE FROM game_list gl WHERE gl.IDNo IN (${ph}) AND gl.ACTIVE != 0 AND gl.SETTLED = 1`,
        gameIds
      );
      for (const row of commRows) {
        const [cr] = await pool.execute(
          `SELECT SUM(CASE WHEN CAGE_TYPE IN (3,4) THEN NN_CHIPS+CC_CHIPS WHEN CAGE_TYPE=5 AND ROLLER_TRANSACTION=2 THEN ROLLER_CC_CHIPS ELSE 0 END) AS r,
            SUM(CASE WHEN CAGE_TYPE=2 THEN NN_CHIPS ELSE 0 END) AS c FROM game_record WHERE ACTIVE!=0 AND GAME_ID=?`,
          [row.IDNo]
        );
        const rolling = Number(cr[0]?.r) || 0;
        const cashout = Number(cr[0]?.c) || 0;
        if (row.COMMISSION_TYPE === 1) commission += (rolling - cashout) * (row.COMMISSION_PERCENTAGE / 100);
        else if (row.COMMISSION_TYPE === 2) commission += (byGame[row.IDNo] ? (byGame[row.IDNo].buyin - byGame[row.IDNo].cashout) : 0) * (row.COMMISSION_PERCENTAGE / 100);
      }
      commission = Math.round(commission);
    }

    const [expRow] = await pool.execute(
      'SELECT COALESCE(SUM(AMOUNT), 0) AS v FROM junket_house_expense WHERE ACTIVE = 1 AND RESET = 1 AND DATE(ENCODED_DT) = ?',
      [dateParam]
    );
    const junket_expenses = Number(expRow[0]?.v) || 0;

    res.json({
      success: true,
      date: dateParam,
      number_of_games,
      buy_in,
      game_rolling,
      win_loss,
      commission,
      junket_expenses,
    });
  } catch (err) {
    console.error('Error in GET /api/daily-settlement:', err);
    res.status(500).json({ success: false, error: 'Error fetching daily settlement' });
  }
});

// ========== 3. MONTHLY ACCUMULATED ==========

/**
 * GET /api/monthly-accumulated
 * Monthly accumulated: win loss, commission (rank + amount), junket expenses, rolling (games), rolling (casino).
 * All values are strictly per requested month (year + month).
 * Query: year=YYYY&month=MM (optional; default current month).
 */
router.get('/monthly-accumulated', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    // Strictly this month's range: 1st through last day (or today if current month).
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endOfMonthStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const todayStr = now.toISOString().slice(0, 10);
    const endStr = (year === now.getFullYear() && month === now.getMonth() + 1) && endOfMonthStr > todayStr
      ? todayStr
      : endOfMonthStr;

    // Win loss (game_record in month, RESET=1 for current period)
    const [wlRow] = await pool.execute(
      `SELECT SUM(CASE WHEN CAGE_TYPE=1 THEN NN_CHIPS+CC_CHIPS ELSE 0 END) - SUM(CASE WHEN CAGE_TYPE=2 THEN NN_CHIPS+CC_CHIPS ELSE 0 END) AS v
       FROM game_record WHERE ACTIVE=1 AND DATE(ENCODED_DT) BETWEEN ? AND ?`,
      [startStr, endStr]
    );
    const monthly_win_loss = Number(wlRow[0]?.v) || 0;

    // Commission: per month only. Include games that were settled/encoded in this month (DATE(gl.ENCODED_DT) in [startStr, endStr]).
    // Same formula as dashboard: per-game total_rolling_chips + winloss (SETTLED=1), type 1/3 => rolling*rate, type 2 => winloss*rate.
    const [gamesInMonth] = await pool.execute(
      `SELECT gl.IDNo, gl.ACCOUNT_ID, gl.COMMISSION_PERCENTAGE, gl.COMMISSION_TYPE,
              ag.IDNo AS agent_id, ag.AGENT_CODE, ag.NAME AS agent_name
       FROM game_list gl
       JOIN account a ON gl.ACCOUNT_ID = a.IDNo
       JOIN agent ag ON a.AGENT_ID = ag.IDNo
       WHERE gl.ACTIVE != 0 AND gl.SETTLED = 1
         AND DATE(gl.ENCODED_DT) >= ? AND DATE(gl.ENCODED_DT) <= ?`,
      [startStr, endStr]
    );
    const commissionByGame = [];
    if (gamesInMonth.length > 0) {
      const gameIds = gamesInMonth.map((r) => r.IDNo);
      const ph = gameIds.map(() => '?').join(',');
      const [recs] = await pool.execute(
        `SELECT GAME_ID, CAGE_TYPE, COALESCE(AMOUNT, 0) AS AMOUNT, COALESCE(NN_CHIPS, 0) AS NN_CHIPS, COALESCE(CC_CHIPS, 0) AS CC_CHIPS,
         COALESCE(ROLLER_CC_CHIPS, 0) AS ROLLER_CC_CHIPS, ROLLER_TRANSACTION
         FROM game_record WHERE ACTIVE != 0 AND GAME_ID IN (${ph})`,
        gameIds
      );
      const { byGame } = computeRollingGameListStyle(recs);
      for (const row of gamesInMonth) {
        const g = byGame[row.IDNo];
        if (!g) continue;
        const rolling = Number(g.rolling) || 0;
        const winloss = g.buyin - g.cashout;
        const commType = Number(row.COMMISSION_TYPE);
        const commPct = Number(row.COMMISSION_PERCENTAGE) || 0;
        let amt = 0;
        if (commPct > 0) {
          if (commType === 1 || commType === 3) amt = Math.round((rolling * commPct) / 100);
          else if (commType === 2) amt = Math.round((winloss * commPct) / 100);
        }
        commissionByGame.push({
          game_id: row.IDNo,
          agent_id: row.agent_id,
          agent_code: row.AGENT_CODE || '',
          agent_name: row.agent_name || '',
          amount: amt,
        });
      }
    }
    const monthly_commission_total = commissionByGame.reduce((s, x) => s + x.amount, 0);
    // Aggregate by agent (guest/agent): sum commission per agent, then rank
    const byAgent = {};
    commissionByGame.forEach((x) => {
      const id = x.agent_id;
      if (!byAgent[id]) byAgent[id] = { agent_id: id, agent_code: x.agent_code, agent_name: x.agent_name, amount: 0 };
      byAgent[id].amount += x.amount;
    });
    const byAgentList = Object.values(byAgent).sort((a, b) => b.amount - a.amount);
    const monthly_commission_ranked = byAgentList.slice(0, 10).map((x, i) => ({
      rank: i + 1,
      agent_id: x.agent_id,
      agent_code: x.agent_code,
      agent_name: x.agent_name,
      amount: x.amount,
    }));

    const [expRow] = await pool.execute(
      'SELECT COALESCE(SUM(AMOUNT), 0) AS v FROM junket_house_expense WHERE ACTIVE = 1 AND DATE(ENCODED_DT) BETWEEN ? AND ?',
      [startStr, endStr]
    );
    const monthly_junket_expenses = Number(expRow[0]?.v) || 0;

    // Total rolling: same formula as game list (CAGE_TYPE 3/4/5 breakdown, AMOUNT, minus cash_out_nn)
    const [rollRecs] = await pool.execute(
      `SELECT GAME_ID, CAGE_TYPE, COALESCE(AMOUNT, 0) AS AMOUNT, COALESCE(NN_CHIPS, 0) AS NN_CHIPS, COALESCE(CC_CHIPS, 0) AS CC_CHIPS,
       COALESCE(ROLLER_CC_CHIPS, 0) AS ROLLER_CC_CHIPS, ROLLER_TRANSACTION
       FROM game_record WHERE ACTIVE != 0 AND DATE(ENCODED_DT) BETWEEN ? AND ?`,
      [startStr, endStr]
    );
    const { totalRollingSum: monthly_rolling_games } = computeRollingGameListStyle(rollRecs);

    // Monthly casino rolling = Total Chips Cashout for the month (same as new_total_chips.ejs modal: junket_total_chips TRANSACTION_ID=2)
    const [chipsCashoutRow] = await pool.execute(
      `SELECT COALESCE(SUM(TOTAL_CHIPS), 0) AS v FROM junket_total_chips
       WHERE ACTIVE = 1 AND TRANSACTION_ID = 2 AND DATE(ENCODED_DT) BETWEEN ? AND ?`,
      [startStr, endStr]
    ).catch(() => [{ v: 0 }]);
    const monthly_rolling_casino = Number(chipsCashoutRow[0]?.v) || 0;

    res.json({
      success: true,
      year,
      month,
      monthly_accumulated_win_loss: monthly_win_loss,
      monthly_accumulated_commission: { total: monthly_commission_total, by_rank: monthly_commission_ranked },
      monthly_accumulated_junket_expenses: monthly_junket_expenses,
      monthly_accumulated_rolling_games: monthly_rolling_games,
      monthly_accumulated_rolling_casino: monthly_rolling_casino,
    });
  } catch (err) {
    console.error('Error in GET /api/monthly-accumulated:', err);
    res.status(500).json({ success: false, error: 'Error fetching monthly accumulated' });
  }
});

/**
 * GET /api/monthly-rolling-casino-by-year
 * Returns Total Chips Cashout (monthly casino rolling) for all 12 months of a year in one call.
 * Query: year=YYYY (optional; default current year).
 * Response: { success, year, by_month: [ { month: 1..12, value: number }, ... ] } (always 12 entries).
 */
router.get('/monthly-rolling-casino-by-year', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const [rows] = await pool.execute(
      `SELECT MONTH(ENCODED_DT) AS month, COALESCE(SUM(TOTAL_CHIPS), 0) AS v
       FROM junket_total_chips
       WHERE ACTIVE = 1 AND TRANSACTION_ID = 2 AND YEAR(ENCODED_DT) = ?
       GROUP BY MONTH(ENCODED_DT)`,
      [year]
    );
    const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, value: 0 }));
    (rows || []).forEach((r) => {
      const idx = Number(r.month) - 1;
      if (idx >= 0 && idx < 12) byMonth[idx].value = Number(r.v) || 0;
    });
    res.json({ success: true, year, by_month: byMonth });
  } catch (err) {
    console.error('Error in GET /api/monthly-rolling-casino-by-year:', err);
    res.status(500).json({ success: false, error: 'Error fetching monthly rolling casino by year' });
  }
});

// ========== 4. MARKER (REAL-TIME) ==========

/**
 * GET /api/marker
 * Real-time marker: guests (accounts) and balance.
 */
router.get('/marker', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.IDNo AS account_id, ag.AGENT_CODE, ag.NAME AS agent_name,
              ay.AGENCY AS agency_name,
              SUM(CASE WHEN al.TRANSACTION_ID IN (3, 10) THEN al.AMOUNT ELSE 0 END) -
              SUM(CASE WHEN al.TRANSACTION_ID IN (11, 12, 1) THEN al.AMOUNT ELSE 0 END) AS balance,
              MAX(al.ENCODED_DT) AS last_activity
       FROM agent ag
       LEFT JOIN agency ay ON ay.IDNo = ag.AGENCY
       JOIN account a ON ag.IDNo = a.AGENT_ID
       JOIN account_ledger al ON a.IDNo = al.ACCOUNT_ID
       WHERE al.TRANSACTION_TYPE IN (3, 4) AND ag.ACTIVE = 1 AND a.ACTIVE = 1
       GROUP BY a.IDNo, ag.AGENT_CODE, ag.NAME, ay.AGENCY
       HAVING balance <> 0
       ORDER BY balance DESC`
    );
    res.json({
      success: true,
      marker: rows.map((r) => ({
        account_id: r.account_id,
        agent_code: r.AGENT_CODE,
        agent_name: r.agent_name,
        name: r.agent_name ?? null,
        agency_name: r.agency_name ?? null,
        balance: Number(r.balance) || 0,
        last_activity: r.last_activity ? new Date(r.last_activity).toISOString() : null,
      })),
    });
  } catch (err) {
    console.error('Error in GET /api/marker:', err);
    res.status(500).json({ success: false, error: 'Error fetching marker' });
  }
});

// ========== 5. GUEST/AGENT RANKING ==========

/**
 * GET /api/ranking
 * Guest/Agent ranking: monthly accumulated rolling, winning, losing.
 * Rolling volume uses same formula as game history / game list (TOTAL_ROLLING).
 * Query: year=YYYY&month=MM (optional), limit=N (default 20), offset=N (default 0).
 */
router.get('/ranking', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [rows] = await pool.execute(
      `SELECT gr.GAME_ID, gr.CAGE_TYPE, gr.AMOUNT, gr.NN_CHIPS, gr.CC_CHIPS, gr.ROLLER_CC_CHIPS, gr.ROLLER_TRANSACTION,
              ag.IDNo AS agent_id, ag.AGENT_CODE, ag.NAME AS agent_name,
              gl.COMMISSION_TYPE, gl.COMMISSION_PERCENTAGE
       FROM game_record gr
       JOIN game_list gl ON gr.GAME_ID = gl.IDNo AND gl.ACTIVE != 0
       JOIN account a ON gl.ACCOUNT_ID = a.IDNo
       JOIN agent ag ON a.AGENT_ID = ag.IDNo
       WHERE gr.ACTIVE != 0 AND DATE(gr.ENCODED_DT) BETWEEN ? AND ?`,
      [startStr, endStr]
    );

    const { byAgent } = computeRollingAndWinlossByAgent(rows);

    const fullRanking = Object.keys(byAgent).map((aid) => {
      const a = byAgent[aid];
      const winloss = Number(a.winloss) || 0;
      return {
        agent_id: a.agent_id,
        agent_code: a.agent_code,
        agent_name: a.agent_name,
        monthly_accumulated_rolling: Math.round(Number(a.rolling) || 0),
        monthly_accumulated_winning: winloss > 0 ? winloss : 0,
        monthly_accumulated_losing: winloss < 0 ? Math.abs(winloss) : 0,
        monthly_accumulated_commission: Number(a.commission) || 0,
      };
    });

    fullRanking.sort((a, b) => b.monthly_accumulated_rolling - a.monthly_accumulated_rolling);
    fullRanking.forEach((r, i) => { r.rank_rolling = i + 1; });
    fullRanking.sort((a, b) => b.monthly_accumulated_winning - a.monthly_accumulated_winning);
    fullRanking.forEach((r, i) => { r.rank_winning = i + 1; });
    fullRanking.sort((a, b) => b.monthly_accumulated_losing - a.monthly_accumulated_losing);
    fullRanking.forEach((r, i) => { r.rank_losing = i + 1; });
    fullRanking.sort((a, b) => a.rank_rolling - b.rank_rolling);

    const total = fullRanking.length;
    const ranking = fullRanking.slice(offset, offset + limit);

    res.json({
      success: true,
      year,
      month,
      ranking,
      total,
    });
  } catch (err) {
    console.error('Error in GET /api/ranking:', err);
    res.status(500).json({ success: false, error: 'Error fetching ranking' });
  }
});

// ========== SERVER-SIDE NOTIFICATION JOB (so app receives activity even when closed) ==========
// Polls realtime data and creates notifications for new game / buy-in / cash-out / game ended.
// Same logic as Flutter app; createServerNotification dedupes with app-created (30s title+message).

const NOTIFICATION_POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
let _realtimePrev = null; // { byId: Map<game_id, { buyin, cashout }> }

function fmtPeso(n) {
  return 'P' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}
function fmtTableDateTime(encodedDt) {
  if (encodedDt == null || encodedDt === '') return '';
  const d = typeof encodedDt === 'string' && !/Z|[-+]\d{2}:?\d{2}$/.test(encodedDt.trim())
    ? new Date(encodedDt.trim() + 'Z') : new Date(encodedDt);
  if (isNaN(d.getTime())) return String(encodedDt);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${(d.getUTCHours() % 12) || 12}:${pad(d.getUTCMinutes())} ${d.getUTCHours() >= 12 ? 'PM' : 'AM'}`;
}

async function runServerNotificationJob() {
  try {
    const data = await getRealtimeData();
    const games = data.ongoing_games || [];
    const byId = new Map(games.map((g) => [
      g.game_id,
      {
        buyin: Number(g.buyin) || 0,
        cashout: Number(g.cashout) || 0,
        account: `${(g.agent_name || '').trim()} (${(g.agent_code || '').trim()})`.trim() || g.agent_code,
        encoded_dt: g.encoded_dt,
        game_type: g.game_type || '',
      },
    ]));
    const prev = _realtimePrev;
    _realtimePrev = byId;

    if (prev === null) return; // first run: only set previous, no notifications (same as app)

    const prevIds = new Set(prev.keys());
    const currentIds = new Set(byId.keys());

    // New game started
    for (const g of games) {
      if (prevIds.has(g.game_id)) continue;
      const account = `${(g.agent_name || '').trim()} (${(g.agent_code || '').trim()})`.trim() || g.agent_code;
      const msg = `${account} – Buy-in ${fmtPeso(g.buyin)} at ${fmtTableDateTime(g.encoded_dt)} (${g.game_type || ''})`;
      await createServerNotification({ title: 'New game started', message: msg, type: 'game_start' });
    }

    // Buy-in added
    for (const g of games) {
      const p = prev.get(g.game_id);
      if (!p || g.buyin <= p.buyin) continue;
      const added = Number(g.buyin) - p.buyin;
      const nowStr = new Date().toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      const account = `${(g.agent_name || '').trim()} (${(g.agent_code || '').trim()})`.trim() || g.agent_code;
      const msg = `${account} added ${fmtPeso(added)} at ${nowStr} – total ${fmtPeso(g.buyin)} (${g.game_type || ''})`;
      await createServerNotification({ title: 'Buy-in added', message: msg, type: 'buy_in' });
    }

    // Cash-out added
    for (const g of games) {
      const p = prev.get(g.game_id);
      if (!p || g.cashout <= p.cashout) continue;
      const added = Number(g.cashout) - p.cashout;
      const nowStr = new Date().toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      const account = `${(g.agent_name || '').trim()} (${(g.agent_code || '').trim()})`.trim() || g.agent_code;
      const msg = `${account} cashed out ${fmtPeso(added)} at ${nowStr} – total ${fmtPeso(g.cashout)} (${g.game_type || ''})`;
      await createServerNotification({ title: 'Cash-out added', message: msg, type: 'cash_out' });
    }

    // Game ended
    for (const id of prevIds) {
      if (currentIds.has(id)) continue;
      const p = prev.get(id);
      if (!p) continue;
      const nowStr = new Date().toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      const winLoss = p.buyin - p.cashout;
      const msg = `${p.account} – game ended at ${nowStr} (${p.game_type}) – Win/Loss: ${fmtPeso(winLoss)}`;
      await createServerNotification({ title: 'Game has ended', message: msg, type: 'game_ended' });
    }
  } catch (err) {
    console.error('Error in server notification job:', err);
  }
}

let _serverNotificationInterval = setInterval(runServerNotificationJob, NOTIFICATION_POLL_INTERVAL_MS);
if (_serverNotificationInterval.unref) _serverNotificationInterval.unref();

// ========== LEGACY: WINLOSS ==========

router.getRealtimeData = getRealtimeData;
router.createServerNotification = createServerNotification;
module.exports = router;
