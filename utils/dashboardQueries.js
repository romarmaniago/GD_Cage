const pool = require('../config/db');
const { SQL_EXCLUDE_DEALER_TIP_CASHOUT, SQL_DASHBOARD_GAME_CASHOUT_FILTER, SQL_ROLLER_TIP_CASHOUT_ONLY } = require('./saveCashoutTips');
const { sqlJunketExpenseTotal } = require('./houseExpenseQueries');

// Function para kunin ang NN Chips Buyin
async function getNNChipsBuyin() {
  const sql = 'SELECT SUM(NN_CHIPS) AS NNChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang NN Chips Cashout
async function getNNChipsCashout() {
  const sql = 'SELECT SUM(NN_CHIPS) AS NNChipsCashout FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang Account NN Chips
async function getAccountNNChips() {
  const sql = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE = 1';
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang Total Cash Out Rolling
async function getTotalCashOutRolling() {
  const sql = `SELECT SUM(NN_CHIPS) AS TOTAL_CASHOUT FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE = 2 ${SQL_EXCLUDE_DEALER_TIP_CASHOUT}`;
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang Total Real Rolling
async function getTotalRealRolling() {
  const sql = 'SELECT SUM(CC_CHIPS) AS TOTAL_REAL_ROLLING FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE = 4';
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang CC Chips Buyin
async function getCCChipsBuyin() {
  const sql = 'SELECT SUM(CC_CHIPS) AS CCChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang CC Chips Cashout
async function getCCChipsCashout() {
  const sql = 'SELECT SUM(CC_CHIPS) AS CCChipsCashout FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang NN Chips Rolling
async function getNNChipsRolling() {
  const sql = 'SELECT SUM(NN_CHIPS) AS NNChipsRolling FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=3';
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang CC Chips Rolling
async function getCCChipsRolling() {
  const sql = 'SELECT SUM(CC_CHIPS) AS CCChipsRolling FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=3';
  const [rows] = await pool.execute(sql);
  return rows;
}

// ROLLER CHIPS queries for CAGE_TYPE = 5
async function getRollerNNSubtract() {
  const sql = 'SELECT SUM(ROLLER_NN_CHIPS) AS ROLLER_NN_SUBTRACT FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 1';
  const [rows] = await pool.execute(sql);
  return rows;
}

async function getRollerNNAdd() {
  const sql = 'SELECT SUM(ROLLER_NN_CHIPS) AS ROLLER_NN_ADD FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 2';
  const [rows] = await pool.execute(sql);
  return rows;
}

async function getRollerCCSubtract() {
  const sql = 'SELECT SUM(ROLLER_CC_CHIPS) AS ROLLER_CC_SUBTRACT FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 1';
  const [rows] = await pool.execute(sql);
  return rows;
}

async function getRollerCCAdd() {
  const sql = 'SELECT SUM(ROLLER_CC_CHIPS) AS ROLLER_CC_ADD FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 2';
  const [rows] = await pool.execute(sql);
  return rows;
}
// Function para kunin ang NN Buyin
async function getNNBuyin() {
  const sql = 'SELECT SUM(NN_CHIPS) AS NNBuyin FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
  const [rows] = await pool.execute(sql);
  return rows;
}

// Function para kunin ang NN Return
async function getNNReturn() {
  const sql = 'SELECT SUM(NN_CHIPS) AS NNReturn FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
  const [rows] = await pool.execute(sql);
  return rows;
}

// ✅ CC-specific additional queries:
async function getAccountCCChipsReturn() {
  const sql = `SELECT SUM(CC_CHIPS) AS CC_CHIPS_RETURN FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE = 2 ${SQL_EXCLUDE_DEALER_TIP_CASHOUT}`;
  const [rows] = await pool.execute(sql);
  return rows;
}

async function getCCChipsBuyinGame() {
  const sql = 'SELECT SUM(CC_CHIPS) AS TOTAL_CC FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE = 1 AND TRANSACTION IN (1, 2, 3)';
  const [rows] = await pool.execute(sql);
  return rows;
}

async function getCCBuyin() {
  const sql = 'SELECT SUM(CC_CHIPS) AS CCBuyin FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
  const [rows] = await pool.execute(sql);
  return rows;
}

async function getCCReturn() {
  const sql = 'SELECT SUM(CC_CHIPS) AS CCReturn FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
  const [rows] = await pool.execute(sql);
  return rows;
}

/** First row numeric field; matches dashboard.ejs (+row[0].KEY || 0) */
function rowNum(rows, key) {
  const v = rows?.[0]?.[key];
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Same formula as views/dashboard.ejs nnChipsBalance */
async function computeNnChipsBalance() {
  const [
    nnBuyin,
    nnCashout,
    accountNN,
    cashOutRolling,
    realRolling,
    nnRolling,
    ccRolling,
    nnBuyinChips,
    nnReturn,
    rollerSub,
    rollerAdd,
    monthlyRows
  ] = await Promise.all([
    getNNChipsBuyin(),
    getNNChipsCashout(),
    getAccountNNChips(),
    getTotalCashOutRolling(),
    getTotalRealRolling(),
    getNNChipsRolling(),
    getCCChipsRolling(),
    getNNBuyin(),
    getNNReturn(),
    getRollerNNSubtract(),
    getRollerNNAdd(),
    pool.execute(
      'SELECT SUM(NN_CHIPS) AS NNChipsMonthlySettle FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=4 AND RESET=0'
    ).then(([r]) => r)
  ]);

  return (
    rowNum(nnBuyin, 'NNChipsBuyin') -
    rowNum(nnCashout, 'NNChipsCashout') -
    rowNum(accountNN, 'TOTAL_NN') +
    rowNum(cashOutRolling, 'TOTAL_CASHOUT') -
    rowNum(realRolling, 'TOTAL_REAL_ROLLING') +
    rowNum(nnRolling, 'NNChipsRolling') +
    rowNum(ccRolling, 'CCChipsRolling') +
    rowNum(nnBuyinChips, 'NNBuyin') -
    rowNum(nnReturn, 'NNReturn') -
    rowNum(rollerSub, 'ROLLER_NN_SUBTRACT') +
    rowNum(rollerAdd, 'ROLLER_NN_ADD') -
    rowNum(monthlyRows, 'NNChipsMonthlySettle')
  );
}

/** Same formula as views/dashboard.ejs ccChipsBalance */
async function computeCcChipsBalance() {
  const [
    ccBuyin,
    ccCashout,
    realRolling,
    ccRolling,
    nnRolling,
    ccReturnAccount,
    ccBuyinGame,
    ccBuyinJ,
    ccReturnJ,
    rollerSub,
    rollerAdd,
    monthlyRows
  ] = await Promise.all([
    getCCChipsBuyin(),
    getCCChipsCashout(),
    getTotalRealRolling(),
    getCCChipsRolling(),
    getNNChipsRolling(),
    getAccountCCChipsReturn(),
    getCCChipsBuyinGame(),
    getCCBuyin(),
    getCCReturn(),
    getRollerCCSubtract(),
    getRollerCCAdd(),
    pool.execute(
      'SELECT SUM(CC_CHIPS) AS CCChipsMonthlySettle FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=4 AND RESET=0'
    ).then(([r]) => r)
  ]);

  return (
    rowNum(ccBuyin, 'CCChipsBuyin') -
    rowNum(ccCashout, 'CCChipsCashout') +
    rowNum(realRolling, 'TOTAL_REAL_ROLLING') -
    rowNum(ccRolling, 'CCChipsRolling') -
    rowNum(nnRolling, 'NNChipsRolling') +
    rowNum(ccReturnAccount, 'CC_CHIPS_RETURN') -
    rowNum(ccBuyinGame, 'TOTAL_CC') +
    rowNum(ccBuyinJ, 'CCBuyin') -
    rowNum(ccReturnJ, 'CCReturn') -
    rowNum(rollerSub, 'ROLLER_CC_SUBTRACT') +
    rowNum(rollerAdd, 'ROLLER_CC_ADD') -
    rowNum(monthlyRows, 'CCChipsMonthlySettle')
  );
}

/** Same as views/dashboard.ejs cashBalance (cashInTotal - cashOutTotal + mxCashNet) */
const SQL_MX_CASH_NET = `
SELECT
  COALESCE(SUM(
    CASE
      WHEN r.ID IS NOT NULL THEN COALESCE(r.MARGIN_RETURN, 0)
      WHEN in_ccy.CODE = 'PHP' AND ex_ccy.CODE <> 'PHP' THEN COALESCE(d.AMOUNT_IN, 0)
      WHEN ex_ccy.CODE = 'PHP' AND in_ccy.CODE <> 'PHP' THEN -COALESCE(d.EXCHANGE_AMOUNT, 0)
      ELSE 0
    END
  ), 0) AS MX_CASH_NET
FROM money_exchange_transaction d
LEFT JOIN currency_master in_ccy ON in_ccy.ID = d.IN_CURRENCY_ID
LEFT JOIN currency_master ex_ccy ON ex_ccy.ID = d.EXCHANGE_CURRENCY_ID
LEFT JOIN money_exchange_transaction r
  ON r.SOURCE_DEPOSIT_ID = d.ID
  AND r.TRANS_TYPE = 2
  AND r.ACTIVE = 1
WHERE d.ACTIVE = 1 AND d.TRANS_TYPE = 1
`;

async function computeCashBalance() {
  const results = await Promise.all([
    pool.execute('SELECT SUM(AMOUNT) AS CASH_DEPOSIT FROM junket_capital WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_DEPOSIT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=2 AND account_ledger.TRANSACTION_ID=1 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS SETTLEMENT_DEPOSIT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=5 AND account_ledger.TRANSACTION_ID=1 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute('SELECT SUM(TOTAL_CHIPS) AS TotalChipsCashout FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2'),
    pool.execute('SELECT SUM(NN_CHIPS) AS TOTAL_NN_CASH FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=1 AND TRANSACTION=1'),
    pool.execute('SELECT SUM(CC_CHIPS) AS CC_CHIPS_BUYIN_CASH_ONLY FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=1 AND TRANSACTION=1'),
    pool.execute("SELECT COALESCE(SUM(AMOUNT),0) AS TOTAL FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=1 AND SOURCE_TYPE='GUEST'"),
    pool.execute("SELECT COALESCE(SUM(AMOUNT),0) AS TOTAL FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=2 AND SOURCE_TYPE='GUEST'"),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_CASH FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=3 AND account_ledger.TRANSACTION_ID=11 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute('SELECT SUM(rm.AMOUNT) AS RETURN_MONEY FROM junket_return_money rm WHERE rm.ACTIVE=1'),
    pool.execute('SELECT SUM(CC_CHIPS) AS CCChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute('SELECT SUM(AMOUNT) AS CASH_WITHDRAW FROM junket_capital WHERE ACTIVE=1 AND TRANSACTION_ID=2'),
    pool.execute(sqlJunketExpenseTotal()),
    pool.execute('SELECT SUM(NN_CHIPS) AS NNChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1'),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_WITHDRAW FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=2 AND account_ledger.TRANSACTION_DESC='ACCOUNT DETAILS' AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_CASHOUT FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=2 ${SQL_DASHBOARD_GAME_CASHOUT_FILTER}`),
    pool.execute(`SELECT SUM(NN_CHIPS + CC_CHIPS) AS ROLLER_TIP_CASHIN FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=2 ${SQL_ROLLER_TIP_CASHOUT_ONLY}`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_SETTLEMENT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=5 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_DEDUCT_SERVICES FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=2 AND account_ledger.TRANSACTION_DESC='SERVICES' AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS TOTAL_ISSUE_RECORD FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=3 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute("SELECT COALESCE(SUM(AMOUNT),0) AS TOTAL FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=1 AND SOURCE_TYPE='JUNKET'"),
    pool.execute("SELECT COALESCE(SUM(AMOUNT),0) AS TOTAL FROM game_services WHERE ACTIVE=1 AND TRANSACTION_ID=2 AND SOURCE_TYPE='JUNKET'"),
    pool.execute(`SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_TRANSFER FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=1 AND account_ledger.TRANSFER=1 AND account.ACTIVE=1 AND agent.ACTIVE=1`),
    pool.execute('SELECT SUM(AMOUNT) AS MANUAL_BALANCING FROM manual_balancing'),
    pool.execute('SELECT SUM(AMOUNT) AS JUNKET_LOSS FROM junket_loss WHERE ACTIVE=1'),
    pool.execute(SQL_MX_CASH_NET),
    pool.execute('SELECT COALESCE(SUM(AMOUNT), 0) AS TIP_SETTLEMENT FROM tip_settlement WHERE ACTIVE = 1')
  ]);

  const cashIn =
    rowNum(results[0][0], 'CASH_DEPOSIT') +
    rowNum(results[1][0], 'ACCOUNT_DEPOSIT') +
    rowNum(results[2][0], 'SETTLEMENT_DEPOSIT') +
    rowNum(results[3][0], 'TotalChipsCashout') +
    rowNum(results[4][0], 'TOTAL_NN_CASH') +
    rowNum(results[5][0], 'CC_CHIPS_BUYIN_CASH_ONLY') +
    rowNum(results[6][0], 'TOTAL') +
    rowNum(results[7][0], 'TOTAL') +
    rowNum(results[8][0], 'MARKER_RETURN_CASH') +
    rowNum(results[9][0], 'RETURN_MONEY') +
    rowNum(results[16][0], 'ROLLER_TIP_CASHIN');

  const cashOut =
    rowNum(results[10][0], 'CCChipsBuyin') +
    rowNum(results[11][0], 'CASH_WITHDRAW') +
    rowNum(results[12][0], 'JUNKET_EXPENSE') +
    rowNum(results[13][0], 'NNChipsBuyin') +
    rowNum(results[14][0], 'ACCOUNT_WITHDRAW') +
    rowNum(results[15][0], 'TOTAL_CASHOUT') +
    rowNum(results[17][0], 'ACCOUNT_SETTLEMENT') +
    rowNum(results[18][0], 'ACCOUNT_DEDUCT_SERVICES') +
    rowNum(results[19][0], 'TOTAL_ISSUE_RECORD') +
    rowNum(results[20][0], 'TOTAL') +
    rowNum(results[21][0], 'TOTAL') +
    rowNum(results[22][0], 'ACCOUNT_TRANSFER') +
    rowNum(results[23][0], 'MANUAL_BALANCING') +
    rowNum(results[24][0], 'JUNKET_LOSS') +
    rowNum(results[26][0], 'TIP_SETTLEMENT');

  const mx = rowNum(results[25][0], 'MX_CASH_NET');
  return cashIn - cashOut + mx;
}

/** Cash + NN + CC chips balances (same as dashboard house balance components). */
async function computeHouseBalance() {
  const [cashBalance, nnChipsBalance, ccChipsBalance] = await Promise.all([
    computeCashBalance(),
    computeNnChipsBalance(),
    computeCcChipsBalance()
  ]);
  return {
    cashBalance,
    nnChipsBalance,
    ccChipsBalance,
    houseBalance: cashBalance + nnChipsBalance + ccChipsBalance
  };
}

module.exports = {
  getNNChipsBuyin,
  getNNChipsCashout,
  getAccountNNChips,
  getTotalCashOutRolling,
  getTotalRealRolling,
  getCCChipsBuyin,
  getCCChipsCashout,
  getNNChipsRolling,
  getCCChipsRolling,
  getRollerNNSubtract,
  getRollerNNAdd,
  getRollerCCSubtract,
  getRollerCCAdd,
  getNNBuyin,
  getNNReturn,
  getAccountCCChipsReturn,
  getCCChipsBuyinGame,
  getCCBuyin,
  getCCReturn,
  computeNnChipsBalance,
  computeCcChipsBalance,
  computeCashBalance,
  computeHouseBalance
};
