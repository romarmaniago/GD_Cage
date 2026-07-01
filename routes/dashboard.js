const express = require('express');
const path = require('path');
const router = express.Router();
const pool = require('../config/db');
const dashboardQueries = require('../utils/dashboardQueries');
const { SQL_EXCLUDE_DEALER_TIP_CASHOUT, SQL_DASHBOARD_GAME_CASHOUT_FILTER, SQL_ROLLER_TIP_CASHOUT_ONLY } = require('../utils/saveCashoutTips');

const { checkSession, sessions } = require('./auth');
const { sendTelegramMessage, sendTelegramToAdditionalChats } = require('../utils/telegram');
const { markerReturnTelegramLogPreview } = require('../utils/telegramSendLog');
const ExcelJS = require('exceljs');
const { applyCommaThousandsToNumericCells } = require('../utils/excelAmountFormat');
const {
	currentMonthKey,
	loadDashboardWlSharePct,
	upsertDashboardWlSharePct,
	normalizeSharePercentage,
	isValidMonthKey,
	DEFAULT_DASHBOARD_WL_SHARE_PCT
} = require('../utils/dashboardWlShare');
<<<<<<< Updated upstream
const { categorizeJunketExpenseTotals } = require('../utils/dashboardServiceBalance');
=======
>>>>>>> Stashed changes

function requireSuperAdmin(req, res, next) {
	const p = req.session.permissions;
	if (p !== 0 && p !== '0') {
		if (req.xhr || (req.headers.accept && String(req.headers.accept).includes('application/json'))) {
			return res.status(403).json({ success: false, error: 'Forbidden' });
		}
		return res.status(403).send('Forbidden');
	}
	next();
}

const superAdminOnly = [checkSession, requireSuperAdmin];

router.get("/dashboard", checkSession, async (req, res) => {
	console.log("Session Data:", req.session);

	const permissions = req.session.permissions;
	if (permissions === undefined) {
		console.error("Permissions are undefined");
		return res.status(500).send("Permissions are undefined");
	}

	let sqlWinlossManual = 'SELECT SUM(AMOUNT) AS WINLOSS FROM winloss WHERE RESET=1';
	let sqlTotalRollingManual = 'SELECT SUM(AMOUNT) AS TOTAL_ROLLING FROM total_rolling WHERE RESET=1';

	let sqlJunketExpenseReset = 'SELECT SUM(AMOUNT) AS RESET_EXPENSE FROM junket_house_expense WHERE ACTIVE =1 AND RESET=1';
	let sqlHouseRollingReset = `SELECT 
		(SUM(CASE WHEN TRANSACTION_ID = 1 AND RESET = 1 THEN NN_CHIPS ELSE 0 END) + 
		 SUM(CASE WHEN TRANSACTION_ID = 3 AND RESET = 1 THEN CC_CHIPS ELSE 0 END) - 
		 SUM(CASE WHEN TRANSACTION_ID = 2 AND RESET = 1 THEN NN_CHIPS ELSE 0 END)) 
		 AS HouseRollingChips 
		FROM junket_total_chips 
		WHERE ACTIVE=1`;

	let sqlTotalRollingReset = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS RESET_ROLLING FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE IN (3,4) AND RESET=1';
	let sqlTotalCashOutRollingReset = `SELECT SUM(NN_CHIPS) AS RESET_CASHOUT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND RESET=1 ${SQL_EXCLUDE_DEALER_TIP_CASHOUT}`;
	let sqlReturnRollerCCChips = 'SELECT SUM(ROLLER_CC_CHIPS) AS RETURN_ROLLER_CC FROM game_record WHERE ACTIVE = 1 AND ROLLER_TRANSACTION = 2 AND RESET=1';

	let sqlUnreturnedRollerChips = `
		SELECT COALESCE(SUM(GREATEST(0, balances.net_balance)), 0) AS TOTAL_UNRETURNED
		FROM (
			SELECT
				gr.GAME_ID,
				SUM(
					CASE
						WHEN COALESCE(gr.ROLLER_TRANSACTION, 1) = 1
							THEN COALESCE(gr.ROLLER_NN_CHIPS, 0) + COALESCE(gr.ROLLER_CC_CHIPS, 0)
						WHEN gr.ROLLER_TRANSACTION = 2
							THEN -(COALESCE(gr.ROLLER_NN_CHIPS, 0) + COALESCE(gr.ROLLER_CC_CHIPS, 0))
						ELSE 0
					END
				) AS net_balance
			FROM game_record gr
			INNER JOIN game_list gl ON gl.IDNo = gr.GAME_ID
			WHERE gr.CAGE_TYPE = 5
				AND gr.ACTIVE = 1
				AND gl.ACTIVE != 0
			GROUP BY gr.GAME_ID
		) balances
		WHERE balances.net_balance > 0
	`;

	let sqlTotalCashOutReset = `SELECT SUM(NN_CHIPS + CC_CHIPS) AS CASHOUT_RESET FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND RESET=1 ${SQL_EXCLUDE_DEALER_TIP_CASHOUT}`;
	let sqlWinLossReset = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS RESET_CASHIN FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND RESET=1';

	let sqlManualBalancing = 'SELECT SUM(AMOUNT) AS MANUAL_BALANCING FROM manual_balancing';

	let sqlWinLossLive = `SELECT 
    winloss.GAMEId,
    winloss.CASHIN_LIVE,
    winloss.houseshare,
    IFNULL(cashout.CASHOUT_LIVE, 0) AS CASHOUT_LIVE
FROM 
    (SELECT 
        game_record.GAME_ID AS GAMEId, 
        SUM(game_record.NN_CHIPS + game_record.CC_CHIPS) AS CASHIN_LIVE, 
        game_list.HOUSE_SHARE AS houseshare 
     FROM 
        game_record  
     LEFT JOIN 
        game_list ON game_list.IDNo = game_record.GAME_ID
     WHERE 
        game_list.ACTIVE IN (1, 2)
        AND game_list.GAME_TYPE = "LIVE"
        AND game_record.CAGE_TYPE = 1
        AND game_record.RESET = 1
        AND game_record.ACTIVE = 1 
     GROUP BY 
        game_record.GAME_ID) AS winloss
LEFT JOIN 
    (SELECT 
        game_record.GAME_ID,
        SUM(game_record.NN_CHIPS + game_record.CC_CHIPS) AS CASHOUT_LIVE
     FROM 
        game_record
     WHERE 
        game_record.ACTIVE = 1 
        AND game_record.CAGE_TYPE = 2 
        AND game_record.RESET = 1
     GROUP BY 
        game_record.GAME_ID) AS cashout 
ON 
    winloss.GAMEId = cashout.GAME_ID`;

	let sqlWinLossTelebet = `SELECT 
    winloss.GAMEId,
    winloss.CASHIN_TELEBET,
    winloss.houseshare,
    IFNULL(cashout.CASHOUT_TELEBET, 0) AS CASHOUT_TELEBET
FROM 
    (SELECT 
        game_record.GAME_ID AS GAMEId, 
        SUM(game_record.NN_CHIPS + game_record.CC_CHIPS) AS CASHIN_TELEBET, 
        game_list.HOUSE_SHARE AS houseshare 
     FROM 
        game_record  
     LEFT JOIN 
        game_list ON game_list.IDNo = game_record.GAME_ID
     WHERE 
        game_list.ACTIVE IN (1, 2)
        AND game_list.GAME_TYPE = "TELEBET"
        AND game_record.CAGE_TYPE = 1
        AND game_record.RESET = 1
        AND game_record.ACTIVE = 1 
     GROUP BY 
        game_record.GAME_ID) AS winloss
LEFT JOIN 
    (SELECT 
        game_record.GAME_ID,
        SUM(game_record.NN_CHIPS + game_record.CC_CHIPS) AS CASHOUT_TELEBET
     FROM 
        game_record
     WHERE 
        game_record.ACTIVE = 1 
        AND game_record.CAGE_TYPE = 2 
        AND game_record.RESET = 1
     GROUP BY 
        game_record.GAME_ID) AS cashout 
ON 
    winloss.GAMEId = cashout.GAME_ID`;

	let sqlCommissionReset = `SELECT 
		rolling.GAME_ID,
		rolling.TOTAL_ROLLING,
		rolling.percentage,
		IFNULL(cashout.TOTAL_CASHOUT, 0) AS TOTAL_CASHOUT
	FROM
		(SELECT 
			game_record.GAME_ID,
			SUM(
				CASE 
					WHEN game_record.CAGE_TYPE IN (3, 4) THEN game_record.NN_CHIPS + game_record.CC_CHIPS
					WHEN game_record.CAGE_TYPE = 5 AND game_record.ROLLER_TRANSACTION = 2 THEN game_record.ROLLER_CC_CHIPS
					ELSE 0
				END
			) AS TOTAL_ROLLING,
			game_list.COMMISSION_PERCENTAGE AS percentage
		 FROM game_record
		 LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
		 WHERE game_list.ACTIVE IN (1, 2) 
		   AND game_list.COMMISSION_TYPE = 1 
		   AND game_list.SETTLED = 1 
		   AND game_record.RESET = 1 
		   AND game_record.ACTIVE = 1
		 GROUP BY game_record.GAME_ID) AS rolling
	LEFT JOIN
		(SELECT 
			game_record.GAME_ID,
			SUM(game_record.NN_CHIPS) AS TOTAL_CASHOUT
		 FROM game_record
		 WHERE game_record.CAGE_TYPE = 2 
       AND game_record.RESET = 1 
	   AND game_record.ACTIVE = 1
		 GROUP BY game_record.GAME_ID) AS cashout
	ON rolling.GAME_ID = cashout.GAME_ID`;

	let sqlSharedRollingReset = `SELECT SUM(game_record.NN_CHIPS + game_record.CC_CHIPS) AS TOTAL_ROLLING, game_list.COMMISSION_PERCENTAGE AS percentage 
		FROM game_record 
		LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
		WHERE game_list.ACTIVE IN (1,2) AND game_list.COMMISSION_TYPE = 2 AND game_record.CAGE_TYPE = 1 AND SETTLED = 1 AND RESET = 1 AND game_record.ACTIVE = 1
		GROUP BY game_record.GAME_ID`;

	let sqlSharedCashoutReset = `SELECT SUM(game_record.NN_CHIPS) AS TOTAL_CASHOUT 
		FROM game_record 
		LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
		WHERE game_list.ACTIVE IN (1,2) AND game_list.COMMISSION_TYPE = 2 AND game_record.CAGE_TYPE = 2 AND SETTLED = 1 AND RESET = 1 AND game_record.ACTIVE = 1
		GROUP BY game_record.GAME_ID`;

	let sqlSharedCashoutCCReset = `SELECT SUM(game_record.CC_CHIPS) AS TOTAL_CASHOUT_CC 
		FROM game_record 
		LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
		WHERE game_list.ACTIVE IN (1,2) AND game_list.COMMISSION_TYPE = 2 AND game_record.CAGE_TYPE = 2 AND SETTLED = 1 AND RESET = 1 and game_record.ACTIVE = 1
		GROUP BY game_record.GAME_ID`;


	let sqlAgentCount = 'SELECT COUNT(*) AS TOTAL_AGENT FROM agent WHERE ACTIVE =1';
	let sqlJunketCredit = 'SELECT SUM(AMOUNT) AS JUNKET_CREDIT FROM junket_credit WHERE ACTIVE =1';
	let sqlJunketExpense = 'SELECT SUM(AMOUNT) AS JUNKET_EXPENSE FROM junket_house_expense WHERE ACTIVE =1';
	let sqlJunketLoss = 'SELECT SUM(AMOUNT) AS JUNKET_LOSS FROM junket_loss WHERE ACTIVE =1 AND GAME_ID IS NULL';
	let sqlJunketExpenseGoods = `
		SELECT SUM(jhe.AMOUNT) AS JUNKET_EXPENSE_GOODS
		FROM junket_house_expense jhe
		JOIN expense_category ec ON ec.IDNo = jhe.CATEGORY_ID
		WHERE jhe.ACTIVE = 1
			AND ec.TYPE = 1
	`;
	let sqlJunketExpenseNonGoods = `
		SELECT SUM(jhe.AMOUNT) AS JUNKET_EXPENSE_NON_GOODS
		FROM junket_house_expense jhe
		JOIN expense_category ec ON ec.IDNo = jhe.CATEGORY_ID
		WHERE jhe.ACTIVE = 1
			AND ec.TYPE = 2
	`;
	let sqlReturnMoney = `
		SELECT SUM(rm.AMOUNT) AS RETURN_MONEY
		FROM junket_return_money rm
		WHERE rm.ACTIVE = 1
	`;

	
	let sqlNNChipsReturnDeposit = 'SELECT SUM(NN_CHIPS) AS NN_DEPOSIT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND TRANSACTION = 2';
	let sqlCageRolling = 'SELECT SUM(ROLLING_AMOUNT) AS ROLLING_AMOUNT FROM cage_rolling WHERE ACTIVE =1';
	let sqlNNChipsAccountMarker = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN_MARKER FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND TRANSACTION = 3';
	let sqlCCChipsBuyinGame = 'SELECT SUM(CC_CHIPS) AS TOTAL_CC FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION IN (1 , 2, 3)';
	let sqlCCChipsBuyinGameReset = 'SELECT SUM(CC_CHIPS) AS TOTAL_CC FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION IN (1 , 2, 3) AND RESET=1';
	let sqlNNChipsAccountCash = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN_CASH FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION = 1';
	let sqlCCChipsAccountCash = 'SELECT SUM(CC_CHIPS) AS TOTAL_CC_CASH FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION = 1';
	let sqlNNChipsAccountDeposit = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN_DEPOSIT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION = 2';
	let sqlCCChipsCashout = 'SELECT  SUM(CC_CHIPS) AS CCChipsCashout FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
	let sqlCCReturn = 'SELECT  SUM(CC_CHIPS) AS CCReturn FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
	let sqlNNChipsCashout = 'SELECT  SUM(NN_CHIPS) AS NNChipsCashout FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
	let sqlNNReturn = 'SELECT  SUM(NN_CHIPS) AS NNReturn FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
	let sqlTotalChipsCashout = 'SELECT  SUM(TOTAL_CHIPS) AS TotalChipsCashout FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=2';
	let sqlCCChipsRolling = 'SELECT  SUM(CC_CHIPS) AS CCChipsRolling FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=3';
	let sqlNNChipsRolling = 'SELECT  SUM(NN_CHIPS) AS NNChipsRolling FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=3';
	let sqlTotalChipsRolling = 'SELECT  SUM(TOTAL_CHIPS) AS TotalChipsRolling FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=3';
	let sqlCCChipsBuyin = 'SELECT  SUM(CC_CHIPS) AS CCChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
	let sqlCCBuyin = 'SELECT  SUM(CC_CHIPS) AS CCBuyin FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
	let sqlNNChipsBuyin = 'SELECT  SUM(NN_CHIPS) AS NNChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
	let sqlNNBuyin = 'SELECT  SUM(NN_CHIPS) AS NNBuyin FROM junket_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
	let sqlAccountTransfer = `
	  SELECT 
		SUM(account_ledger.AMOUNT) AS ACCOUNT_TRANSFER
	  FROM 
		account_ledger
	  JOIN 
		account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN 
		agent ON agent.IDNo = account.AGENT_ID
	  WHERE 
		account_ledger.ACTIVE = 1 AND 
		account_ledger.TRANSACTION_ID = 1 AND 
		account_ledger.TRANSFER = 1 AND 
		account.ACTIVE = 1 AND 
		agent.ACTIVE = 1
	`;

	let sqlTotalChipsBuyin = 'SELECT  SUM(TOTAL_CHIPS) AS TotalChipsBuyin FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=1';
	let sqlCCChipsMonthlySettle = 'SELECT SUM(CC_CHIPS) AS CCChipsMonthlySettle FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=4 AND RESET=0';
	let sqlNNChipsMonthlySettle = 'SELECT SUM(NN_CHIPS) AS NNChipsMonthlySettle FROM junket_total_chips WHERE ACTIVE=1 AND TRANSACTION_ID=4 AND RESET=0';
	let sqlCashDeposit = 'SELECT  SUM(AMOUNT) AS CASH_DEPOSIT FROM junket_capital WHERE ACTIVE=1 AND TRANSACTION_ID=1';
	let sqlCashWithdraw = 'SELECT  SUM(AMOUNT) AS CASH_WITHDRAW FROM junket_capital WHERE ACTIVE=1 AND TRANSACTION_ID=2';
	let sqlAccountDeposit = `
	  SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_DEPOSIT
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_TYPE = 2 
		AND account_ledger.TRANSACTION_ID = 1 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlAccountDeduct = `
	  SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_DEDUCT
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_ID = 2 
		 AND account_ledger.TRANSACTION_DESC NOT IN ('ACCOUNT DETAILS', 'SERVICES')
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlAccountWithdraw = `
	  SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_WITHDRAW
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_ID = 2 
		AND account_ledger.TRANSACTION_DESC = "ACCOUNT DETAILS" 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlAccountServicesDeduct = `
	  SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_DEDUCT_SERVICES
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_ID = 2 
		AND account_ledger.TRANSACTION_DESC = "SERVICES" 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlAccountSettlement = `
	  SELECT SUM(account_ledger.AMOUNT) AS ACCOUNT_SETTLEMENT
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_TYPE = 5 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlSettlementDepositAmount = `
	  SELECT SUM(account_ledger.AMOUNT) AS SETTLEMENT_DEPOSIT
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_TYPE = 5 
		AND account_ledger.TRANSACTION_ID = 1 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlSettlementCashOutAmount = `
	  SELECT SUM(account_ledger.AMOUNT) AS SETTLEMENT_CASHOUT
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_TYPE = 5 
		AND account_ledger.TRANSACTION_ID = 5 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlMArkerReturnCash = `
	  SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_CASH
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_TYPE = 3 
		AND account_ledger.TRANSACTION_ID = 11 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlMArkerReturnDeposit = `
	  SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_DEPOSIT
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_TYPE = 3 
		AND account_ledger.TRANSACTION_ID = 12 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlChipsReturnMarker = `
	  SELECT SUM(NN_CHIPS + CC_CHIPS) AS CHIPS_RETURN_MARKER
	  FROM game_record 
	  WHERE CAGE_TYPE = 2 AND TRANSACTION = 4 AND ACTIVE = 1
	  -- No JOIN needed unless you also need agent/account details
	`;

	let sqlAccountMarkerReturn = `
	  SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_TYPE = 4 
		AND account_ledger.TRANSACTION_ID = 1 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlAccountCCChips = 'SELECT SUM(CC_CHIPS) AS TOTAL_CC FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1';
	let sqlAccountNNChips = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1';

	let sqlMarkerIssueGame = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_ISSUE_GAME FROM game_record WHERE ACTIVE =1 AND TRANSACTION = 3 AND CAGE_TYPE = 1';
	let sqlMarkerIssueAccount = `
	  SELECT SUM(account_ledger.AMOUNT) AS TOTAL_ISSUE_RECORD
	  FROM account_ledger
	  JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID
	  JOIN agent ON agent.IDNo = account.AGENT_ID
	  WHERE account_ledger.ACTIVE = 1 
		AND account_ledger.TRANSACTION_ID = 3 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1
	`;

	let sqlTotalRealRolling = 'SELECT SUM(CC_CHIPS) AS TOTAL_REAL_ROLLING FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 4';
	let sqlTotalRolling = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_ROLLING FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE IN (3,4)';
	let sqlAccountCCChipsReturn = `SELECT SUM(CC_CHIPS) AS CC_CHIPS_RETURN FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 ${SQL_EXCLUDE_DEALER_TIP_CASHOUT}`;
	let sqlTotalCashOutRolling = `SELECT SUM(NN_CHIPS) AS TOTAL_CASHOUT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 ${SQL_EXCLUDE_DEALER_TIP_CASHOUT}`;
	let sqlTotalCashOut = `SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_CASHOUT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 ${SQL_DASHBOARD_GAME_CASHOUT_FILTER}`;
	let sqlRollerTipCashOut = `SELECT SUM(NN_CHIPS + CC_CHIPS) AS ROLLER_TIP_CASHIN FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 2 ${SQL_ROLLER_TIP_CASHOUT_ONLY}`;
	let sqlTipSettlement = 'SELECT COALESCE(SUM(AMOUNT), 0) AS TIP_SETTLEMENT FROM tip_settlement WHERE ACTIVE = 1';
	let sqlRollerTipGross = 'SELECT COALESCE(SUM(AMOUNT), 0) AS ROLLER_TIP_GROSS FROM tip WHERE ACTIVE = 1 AND TIP_TYPE = 1';

	/* money_exchange_transaction — deposit: EXCHANGE_AMOUNT; return: RETURN_AMOUNT + MARGIN_RETURN */
	let sqlMxDepositExchangeAmount = 'SELECT SUM(EXCHANGE_AMOUNT) AS MX_DEPOSIT_EXCHANGE FROM money_exchange_transaction WHERE ACTIVE = 1 AND TRANS_TYPE = 1';
	let sqlMxReturnAmount = 'SELECT SUM(RETURN_AMOUNT) AS MX_RETURN_AMOUNT FROM money_exchange_transaction WHERE ACTIVE = 1 AND TRANS_TYPE = 2';
	let sqlMxMarginReturn = 'SELECT SUM(MARGIN_RETURN) AS MX_MARGIN_RETURN FROM money_exchange_transaction WHERE ACTIVE = 1 AND TRANS_TYPE = 2';
	// PHP-aware movement for cash balance:
	// - IN_CURRENCY = PHP  -> cash IN by AMOUNT_IN
	// - EXCHANGE_CURRENCY = PHP -> cash OUT by EXCHANGE_AMOUNT
	let sqlMxPhpDepositIn = `
		SELECT SUM(t.AMOUNT_IN) AS MX_PHP_DEPOSIT_IN
		FROM money_exchange_transaction t
		INNER JOIN currency_master c ON c.ID = t.IN_CURRENCY_ID
		WHERE t.ACTIVE = 1 AND t.TRANS_TYPE = 1 AND c.CODE = 'PHP'
	`;
	let sqlMxPhpDepositOut = `
		SELECT SUM(t.EXCHANGE_AMOUNT) AS MX_PHP_DEPOSIT_OUT
		FROM money_exchange_transaction t
		INNER JOIN currency_master c ON c.ID = t.EXCHANGE_CURRENCY_ID
		WHERE t.ACTIVE = 1 AND t.TRANS_TYPE = 1 AND c.CODE = 'PHP'
	`;
	// Net MX cash impact for dashboard:
	// - Pending deposit: include principal cash movement
	// - Returned deposit: include realized margin only
	let sqlMxCashNet = `
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

	let sqlCurrencyPending = `
		SELECT UPPER(c.CODE) AS CODE,
			COALESCE(SUM(
				CASE WHEN ret.ID IS NULL THEN COALESCE(d.EXCHANGE_AMOUNT, 0) ELSE 0 END
			), 0) AS PENDING
		FROM money_exchange_transaction d
		INNER JOIN currency_master c ON c.ID = d.EXCHANGE_CURRENCY_ID
		LEFT JOIN money_exchange_transaction ret
			ON ret.SOURCE_DEPOSIT_ID = d.ID AND ret.TRANS_TYPE = 2 AND ret.ACTIVE = 1
		WHERE d.ACTIVE = 1 AND d.TRANS_TYPE = 1
		GROUP BY c.CODE
	`;

	let sqlWinLoss = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_CASHIN FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1';
	
let sqlServiceCashGuest = `
	SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
	FROM game_services
	WHERE ACTIVE = 1 AND TRANSACTION_ID = 1 AND SOURCE_TYPE = 'GUEST'
	
`;
let sqlServiceDepositGuest = `
	SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
	FROM game_services
	WHERE ACTIVE = 1 AND TRANSACTION_ID = 2 AND SOURCE_TYPE = 'GUEST'
	
`;
let sqlServiceCashJunket = `
	SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
	FROM game_services
	WHERE ACTIVE = 1 AND TRANSACTION_ID = 1 AND SOURCE_TYPE = 'JUNKET'
	
`;
let sqlServiceDepositJunket = `
	SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
	FROM game_services
	WHERE ACTIVE = 1 AND TRANSACTION_ID = 2 AND SOURCE_TYPE = 'JUNKET'
	
`;
let sqlServiceSettle = `
	SELECT  SUM(game_services.AMOUNT) AS TOTAL
	FROM game_services
	JOIN game_list ON game_list.IDNo = game_services.GAME_ID
	WHERE game_services.ACTIVE = 1 AND game_services.TRANSACTION_ID = 3 AND game_list.SETTLED = 1
	
`;

	let sqlCommisionRolling = `SELECT 
			game_record.GAME_ID,
			SUM(
				CASE 
					WHEN game_record.CAGE_TYPE IN (3, 4) THEN game_record.NN_CHIPS + game_record.CC_CHIPS
					WHEN game_record.CAGE_TYPE = 5 AND game_record.ROLLER_TRANSACTION = 2 THEN game_record.ROLLER_CC_CHIPS
					ELSE 0
				END
			) AS TOTAL_ROLLING,
			game_list.COMMISSION_PERCENTAGE AS percentage
		FROM game_record
			LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
		WHERE game_list.ACTIVE IN (1,2)
			AND game_list.COMMISSION_TYPE = 1
			AND SETTLED = 1
		GROUP BY game_record.GAME_ID`;

	let sqlCommisionCashout = `SELECT SUM(game_record.NN_CHIPS + game_record.CC_CHIPS) AS TOTAL_CASHOUT FROM game_record 
			LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
			WHERE game_list.ACTIVE IN (1,2) AND game_list.COMMISSION_TYPE = 1 AND game_record.CAGE_TYPE = 2 AND SETTLED = 1 AND game_record.ACTIVE = 1 GROUP BY game_record.GAME_ID`;

	let sqlSharedRolling = `SELECT SUM(game_record.NN_CHIPS) AS TOTAL_ROLLING, game_list.COMMISSION_PERCENTAGE AS percentage FROM game_record 
			LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
			WHERE game_list.ACTIVE IN (1,2) AND game_list.COMMISSION_TYPE = 2 AND game_record.CAGE_TYPE IN (3,4) AND SETTLED = 1 GROUP BY game_record.GAME_ID`;

	let sqlSharedCashout = `SELECT SUM(game_record.NN_CHIPS) AS TOTAL_CASHOUT FROM game_record 
			LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
			WHERE game_list.ACTIVE IN (1,2) AND game_list.COMMISSION_TYPE = 2 AND game_record.CAGE_TYPE = 2 AND SETTLED = 1 GROUP BY game_record.GAME_ID`;

	let sqlSharedCashoutCC = `SELECT SUM(game_record.CC_CHIPS) AS TOTAL_CASHOUT_CC FROM game_record 
		LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
		WHERE game_list.ACTIVE IN (1,2) AND game_list.COMMISSION_TYPE = 2 AND game_record.CAGE_TYPE = 2 AND SETTLED = 1 GROUP BY game_record.GAME_ID`;

	let sqlNNChipsBuyinCashDeposit = `SELECT SUM(NN_CHIPS) AS NN_CHIPS_BUYIN_CASH_DEPOSIT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION IN (1,2)`;

	let sqlCCChipsBuyinCashDeposit = `SELECT SUM(CC_CHIPS) AS CC_CHIPS_BUYIN_CASH_DEPOSIT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION IN (1,2) `;

	// Cash-only buyins (TRANSACTION = 1 only) - excludes guest account buyins (TRANSACTION = 2)
	// These are used for Cash Balance calculation to avoid double-counting guest deposits
	let sqlNNChipsBuyinCashOnly = `SELECT SUM(NN_CHIPS) AS NN_CHIPS_BUYIN_CASH_ONLY FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION = 1`;

	let sqlCCChipsBuyinCashOnly = `SELECT SUM(CC_CHIPS) AS CC_CHIPS_BUYIN_CASH_ONLY FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION = 1`;

	// Guest account buyins (TRANSACTION = 2 only) - buyins using guest deposited money
	// These should NOT be counted in balance because the money is already counted in ACCOUNT_DEPOSIT
	let sqlNNChipsBuyinGuestAccount = `SELECT SUM(NN_CHIPS) AS NN_CHIPS_BUYIN_GUEST_ACCOUNT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION = 2`;

	let sqlCCChipsBuyinGuestAccount = `SELECT SUM(CC_CHIPS) AS CC_CHIPS_BUYIN_GUEST_ACCOUNT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION = 2`;

	// ROLLER CHIPS queries for CAGE_TYPE = 5
	// ROLLER_TRANSACTION = 1: Subtract (LESS) from balance
	// ROLLER_TRANSACTION = 2: Add to balance
	let sqlRollerNNSubtract = 'SELECT SUM(ROLLER_NN_CHIPS) AS ROLLER_NN_SUBTRACT FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 1';
	let sqlRollerNNAdd = 'SELECT SUM(ROLLER_NN_CHIPS) AS ROLLER_NN_ADD FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 2';
	let sqlRollerCCSubtract = 'SELECT SUM(ROLLER_CC_CHIPS) AS ROLLER_CC_SUBTRACT FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 1';
	let sqlRollerCCAdd = 'SELECT SUM(ROLLER_CC_CHIPS) AS ROLLER_CC_ADD FROM game_record WHERE ACTIVE = 1 AND CAGE_TYPE = 5 AND ROLLER_TRANSACTION = 2';

	try {


		const [WinlossManualResult] = await pool.execute(sqlWinlossManual);
		const [TotalRollingManualResult] = await pool.execute(sqlTotalRollingManual);
		const [AccountTransferResult] = await pool.execute(sqlAccountTransfer);
		const [CChipsBuyinGameResult] = await pool.execute(sqlCCChipsBuyinGame);
		const [CChipsBuyinGameResetResult] = await pool.execute(sqlCCChipsBuyinGameReset);
		const [JunketCreditResult] = await pool.execute(sqlJunketCredit);
		const [JunketExpenseResult] = await pool.execute(sqlJunketExpense);
		const [JunketLossResult] = await pool.execute(sqlJunketLoss);
		const [JunketExpenseGoodsResult] = await pool.execute(sqlJunketExpenseGoods);
		const [JunketExpenseNonGoodsResult] = await pool.execute(sqlJunketExpenseNonGoods);
		const [ReturnMoneyResult] = await pool.execute(sqlReturnMoney);
		const [ResetExpenseResult] = await pool.execute(sqlJunketExpenseReset);
		const [HouseRollingResetResult] = await pool.execute(sqlHouseRollingReset);
		const [TotalRollingResetResult] = await pool.execute(sqlTotalRollingReset);
		const [TotalCashOutResetResult] = await pool.execute(sqlTotalCashOutReset);
		const [TotalCashOutRollingResetResult] = await pool.execute(sqlTotalCashOutRollingReset);
		const [WinLossResetResult] = await pool.execute(sqlWinLossReset);
		const [AccountMarkerReturnResult] = await pool.execute(sqlAccountMarkerReturn);
		const [MxDepositExchangeAmountResult] = await pool.execute(sqlMxDepositExchangeAmount);
		const [MxReturnAmountResult] = await pool.execute(sqlMxReturnAmount);
		const [MxMarginReturnResult] = await pool.execute(sqlMxMarginReturn);
		const [MxPhpDepositInResult] = await pool.execute(sqlMxPhpDepositIn);
		const [MxPhpDepositOutResult] = await pool.execute(sqlMxPhpDepositOut);
		const [MxCashNetResult] = await pool.execute(sqlMxCashNet);
		const [CurrencyPendingResult] = await pool.execute(sqlCurrencyPending);
		const [ChipsReturnMarkerResult] = await pool.execute(sqlChipsReturnMarker);
		const [MArkerReturnDepositResult] = await pool.execute(sqlMArkerReturnDeposit);
		const [MArkerReturnCashResult] = await pool.execute(sqlMArkerReturnCash);
		const [SettlementDepositAmountResult] = await pool.execute(sqlSettlementDepositAmount);
		const [SettlementCashOutAmountResult] = await pool.execute(sqlSettlementCashOutAmount);
		const [AccountSettlementResult] = await pool.execute(sqlAccountSettlement);
		const [NNChipsReturnDepositResult] = await pool.execute(sqlNNChipsReturnDeposit);
		const [CageRollingResult] = await pool.execute(sqlCageRolling);
		const [AccountCCChipsReturnResult] = await pool.execute(sqlAccountCCChipsReturn);
		const [NNChipsAccountMarkerResult] = await pool.execute(sqlNNChipsAccountMarker);
		const [accountDeductResult] = await pool.execute(sqlAccountDeduct);
		const [accountWithdrawResult] = await pool.execute(sqlAccountWithdraw);
		const [accountServicesDeductResult] = await pool.execute(sqlAccountServicesDeduct);
		const [NNChipsAccountCashResult] = await pool.execute(sqlNNChipsAccountCash);
		const [CCChipsAccountCashResult] = await pool.execute(sqlCCChipsAccountCash);
		const [NNChipsAccountDepositResult] = await pool.execute(sqlNNChipsAccountDeposit);
		const [CCChipsBuyinCashoutResult] = await pool.execute(sqlCCChipsCashout);
		const [CCBuyinReturnResult] = await pool.execute(sqlCCReturn);
		const [NNChipsBuyinCashoutResult] = await pool.execute(sqlNNChipsCashout);
		const [NNBuyinReturnResult] = await pool.execute(sqlNNReturn);
		const [TotalChipsBuyinCashoutResult] = await pool.execute(sqlTotalChipsCashout);
		const [CCChipsRollingResult] = await pool.execute(sqlCCChipsRolling);
		const [NNChipsRollingResult] = await pool.execute(sqlNNChipsRolling);
		const [TotalChipsRollingResult] = await pool.execute(sqlTotalChipsRolling);
		const [CCChipsBuyinResult] = await pool.execute(sqlCCChipsBuyin);
		const [CCBuyinResult] = await pool.execute(sqlCCBuyin);
		const [NNChipsBuyinResult] = await pool.execute(sqlNNChipsBuyin);
		const [NNBuyinResult] = await pool.execute(sqlNNBuyin);
		const [TotalChipsBuyinResult] = await pool.execute(sqlTotalChipsBuyin);
		const [CCChipsMonthlySettleResult] = await pool.execute(sqlCCChipsMonthlySettle);
		const [NNChipsMonthlySettleResult] = await pool.execute(sqlNNChipsMonthlySettle);
		const [cashDepositResult] = await pool.execute(sqlCashDeposit);
		const [cashWithdrawResult] = await pool.execute(sqlCashWithdraw);
		const [accountDepositResult] = await pool.execute(sqlAccountDeposit);
		const [accountCCChips] = await pool.execute(sqlAccountCCChips);
		const [accountNNChips] = await pool.execute(sqlAccountNNChips);
		const [markerIssueGame] = await pool.execute(sqlMarkerIssueGame);
		const [markerIssueAccount] = await pool.execute(sqlMarkerIssueAccount);
		const [totalRealRolling] = await pool.execute(sqlTotalRealRolling);
		const [totalRolling] = await pool.execute(sqlTotalRolling);

		const [totalCashOutRolling] = await pool.execute(sqlTotalCashOutRolling);
		const [totalCashOut] = await pool.execute(sqlTotalCashOut);
		const [rollerTipCashOut] = await pool.execute(sqlRollerTipCashOut);
		const [tipSettlementResult] = await pool.execute(sqlTipSettlement);
		const [rollerTipGrossResult] = await pool.execute(sqlRollerTipGross);
		const [totalWinLoss] = await pool.execute(sqlWinLoss);
		const [serviceCashGuestResults] = await pool.execute(sqlServiceCashGuest);
		const [serviceDepositGuestResults] = await pool.execute(sqlServiceDepositGuest);
		const [serviceCashJunketResults] = await pool.execute(sqlServiceCashJunket);
		const [serviceDepositJunketResults] = await pool.execute(sqlServiceDepositJunket);
		const [serviceSettleResults] = await pool.execute(sqlServiceSettle);
		const [totalCommisionRolling] = await pool.execute(sqlCommisionRolling);
		
		const [manualBalancingResult] = await pool.execute(sqlManualBalancing);

		const [totalCommisionCashout] = await pool.execute(sqlCommisionCashout);
		// totalCommisionRolling ay inasume nang nakuha na (mula sa query ng sqlCommisionRolling)
		let totalCommission = 0;
		for (let i = 0; i < totalCommisionRolling.length; i++) {
			let cashout = 0;
			if (totalCommisionCashout[i]) {
				cashout = totalCommisionCashout[i].TOTAL_CASHOUT;
			}
			totalCommission += (totalCommisionRolling[i].TOTAL_ROLLING - cashout) * (totalCommisionRolling[i].percentage / 100);
		}

		// Kunin ang CommissionResetResult:
		const [CommissionResetResult] = await pool.execute(sqlCommissionReset);
		let totalCommissionReset = 0;
		for (let i = 0; i < CommissionResetResult.length; i++) {
			const { TOTAL_ROLLING, percentage, TOTAL_CASHOUT } = CommissionResetResult[i];
			totalCommissionReset += (TOTAL_ROLLING - TOTAL_CASHOUT) * (percentage / 100);
		}

		// Kunin ang mga resulta para sa shared rolling at cashout:
		const [totalSharedRolling] = await pool.execute(sqlSharedRolling);
		const [totalSharedCashoutCC] = await pool.execute(sqlSharedCashoutCC);
		const [totalSharedCashout] = await pool.execute(sqlSharedCashout);

		let totalShared = 0;
		for (let j = 0; j < totalSharedRolling.length; j++) {
			let cashout_shared = 0;
			let cashout_cc_shared = 0;
			if (totalSharedCashout[j]) {
				cashout_shared = totalSharedCashout[j].TOTAL_CASHOUT;
			}
			if (totalSharedCashoutCC[j]) {
				cashout_cc_shared = totalSharedCashoutCC[j].TOTAL_CASHOUT_CC;
			}
			totalShared += (totalSharedRolling[j].TOTAL_ROLLING - cashout_shared - cashout_cc_shared) *
				(totalSharedRolling[j].percentage / 100);
		}

		// Para sa shared reset:
		const [totalSharedRollingReset] = await pool.execute(sqlSharedRollingReset);
		const [totalSharedCashoutCCReset] = await pool.execute(sqlSharedCashoutCCReset);
		const [totalSharedCashoutReset] = await pool.execute(sqlSharedCashoutReset);

		let totalSharedReset = 0;
		for (let j = 0; j < totalSharedRollingReset.length; j++) {
			let cashout_shared = 0;
			let cashout_cc_shared = 0;
			if (totalSharedCashoutReset[j]) {
				cashout_shared = totalSharedCashoutReset[j].TOTAL_CASHOUT;
			}
			if (totalSharedCashoutCCReset[j]) {
				cashout_cc_shared = totalSharedCashoutCCReset[j].TOTAL_CASHOUT_CC;
			}
			totalSharedReset += (totalSharedRollingReset[j].TOTAL_ROLLING - cashout_shared - cashout_cc_shared) *
				(totalSharedRollingReset[j].percentage / 100);
		}

		// Compute Commission Settlement Total (same logic as Commission module - per-game calculation)
		// Settlement = NET commission (hindi binawas ang F&B)
		let totalCommissionSettlement = 0;
		try {
			const now = new Date();
			const start = new Date(now.getFullYear(), now.getMonth(), 1);
			const startStr = start.toISOString().slice(0, 10);
			const endStr = now.toISOString().slice(0, 10);

			const commissionQuery = `
				SELECT *, 
					game_list.IDNo AS game_list_id, 
					game_list.COMMISSION_PERCENTAGE,
					game_list.COMMISSION_TYPE,
					game_list.FNB AS fnb
				FROM game_list 
				WHERE game_list.ACTIVE IN (1, 2)
					AND game_list.SETTLED = 1
				ORDER BY game_list.IDNo ASC`;

			const [games] = await pool.execute(commissionQuery);

			if (games && games.length > 0) {
				for (const row of games) {
					const gameId = row.game_list_id;
					const RollingRate = Number(row.COMMISSION_PERCENTAGE) || 0;
					const fb = Number(row.fnb || 0);
					const commissionType = Number(row.COMMISSION_TYPE);

					if (!gameId || !RollingRate) continue;

					const recordQuery = `SELECT AMOUNT, NN_CHIPS, CC_CHIPS, CAGE_TYPE, ROLLER_TRANSACTION, ROLLER_CC_CHIPS FROM game_record WHERE ACTIVE != 0 AND RESET = 1 AND GAME_ID = ? ORDER BY IDNo ASC`;
					const [records] = await pool.execute(recordQuery, [gameId]);

					if (!records || records.length === 0) continue;

					let total_nn_init = 0;
					let total_cc_init = 0;
					let total_nn = 0;
					let total_cc = 0;
					let total_cash_out_nn = 0;
					let total_cash_out_cc = 0;
					let total_rolling_nn = 0;
					let total_rolling_cc = 0;
					let total_rolling = 0;
					let total_rolling_real = 0;
					let total_rolling_nn_real = 0;
					let total_rolling_cc_real = 0;
					let total_roller_return_cc = 0;

					for (const res of records) {
						const cageType = Number(res.CAGE_TYPE);

						if (cageType === 1 && (total_nn_init !== 0 || total_cc_init !== 0)) {
							total_nn += Number(res.NN_CHIPS) || 0;
							total_cc += Number(res.CC_CHIPS) || 0;
						}

						if (cageType === 1 && total_nn_init === 0 && total_cc_init === 0) {
							total_nn_init += Number(res.NN_CHIPS) || 0;
							total_cc_init += Number(res.CC_CHIPS) || 0;
						}

						if (cageType === 2) {
							total_cash_out_nn += Number(res.NN_CHIPS) || 0;
							total_cash_out_cc += Number(res.CC_CHIPS) || 0;
						}

						if (cageType === 3) {
							total_rolling += Number(res.AMOUNT) || 0;
							total_rolling_nn += Number(res.NN_CHIPS) || 0;
							total_rolling_cc += Number(res.CC_CHIPS) || 0;
						}

						if (cageType === 4) {
							total_rolling_real += Number(res.AMOUNT) || 0;
							total_rolling_nn_real += Number(res.NN_CHIPS) || 0;
							total_rolling_cc_real += Number(res.CC_CHIPS) || 0;
						}

						if (cageType === 5) {
							const rollerTransaction = parseInt(res.ROLLER_TRANSACTION, 10) || 1;
							if (rollerTransaction === 2) {
								total_roller_return_cc += Number(res.ROLLER_CC_CHIPS) || 0;
							}
						}
					}

					const total_initial = total_nn_init + total_cc_init;
					const total_buy_in_chips = total_nn + total_cc;
					const total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
					// TOTAL ROLLING: Follow same logic as game_list_data (reloadData function)
					// Formula: total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn
					// Note: CC chips from CAGE_TYPE == 3 (TOTAL ROLLING) should NOT be included
					// Note: CC chips from CAGE_TYPE == 4 (REAL ROLLING) SHOULD be included
					// Note: Buy-in amounts are NOT included here - they are separate from rolling transactions
					const totalRollingCCWithReturns = total_roller_return_cc;  // Only include roller return CC, exclude CC from CAGE_TYPE == 3
					const total_rolling_chips = total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;

					const total_amount = total_buy_in_chips + total_initial;
					const winlossValue = total_amount - total_cash_out_chips;

					let net = 0;
					if (commissionType === 1 || commissionType === 3) {
						net = Math.round((total_rolling_chips * RollingRate) / 100);
					} else if (commissionType === 2) {
						net = Math.round((winlossValue * RollingRate) / 100);
					}

					// Settlement: net commission bago bawas F&B
					const settlementValue = net;
					totalCommissionSettlement += settlementValue;
				}
			}
		} catch (err) {
			console.error('Error computing commission settlement:', err);
			totalCommissionSettlement = 0;
		}

		// Kunin ang resulta ng win-loss queries:
		const [winLossLiveResults] = await pool.execute(sqlWinLossLive);
		let totalWinLossLiveCalc = 0;
		winLossLiveResults.forEach(row => {
			const cashinLive = row.CASHIN_LIVE || 0;
			const cashoutLive = row.CASHOUT_LIVE || 0;
			const houseShare = row.houseshare || 0;
			totalWinLossLiveCalc += (cashinLive - cashoutLive) * (houseShare / 100);
		});

		const [winLossTelebetResults] = await pool.execute(sqlWinLossTelebet);
		let totalWinLossTelebetCalc = 0;
		winLossTelebetResults.forEach(row => {
			const cashinLive = row.CASHIN_TELEBET || 0;
			const cashoutLive = row.CASHOUT_TELEBET || 0;
			const houseShare = row.houseshare || 0;
			totalWinLossTelebetCalc += (cashinLive - cashoutLive) * (houseShare / 100);
		});

		// Kunin ang iba pang mga query results:
		const [NNChipsBuyinCashDepositResult] = await pool.execute(sqlNNChipsBuyinCashDeposit);
		const [CCChipsBuyinCashDepositResult] = await pool.execute(sqlCCChipsBuyinCashDeposit);
		const [NNChipsBuyinCashOnlyResult] = await pool.execute(sqlNNChipsBuyinCashOnly);
		const [CCChipsBuyinCashOnlyResult] = await pool.execute(sqlCCChipsBuyinCashOnly);
		const [NNChipsBuyinGuestAccountResult] = await pool.execute(sqlNNChipsBuyinGuestAccount);
		const [CCChipsBuyinGuestAccountResult] = await pool.execute(sqlCCChipsBuyinGuestAccount);
		const [RollerNNSubtractResult] = await pool.execute(sqlRollerNNSubtract);
		const [RollerNNAddResult] = await pool.execute(sqlRollerNNAdd);
		const [RollerCCSubtractResult] = await pool.execute(sqlRollerCCSubtract);
		const [RollerCCAddResult] = await pool.execute(sqlRollerCCAdd);
		const [ReturnRollerCCChipsResult] = await pool.execute(sqlReturnRollerCCChips);
		const [UnreturnedRollerChipsResult] = await pool.execute(sqlUnreturnedRollerChips);
		const [AgentCountResult] = await pool.execute(sqlAgentCount);

		const dashboardMonthKey = currentMonthKey();
		const dashboardWlSharePct = await loadDashboardWlSharePct(pool, dashboardMonthKey);

		res.render('dashboard', {

			username: req.session.username,
			firstname: req.session.firstname,
			lastname: req.session.lastname,
			user_id: req.session.user_id,
			currentPage: 'dashboard',
			permissions: permissions, // Pass permissions to the view

			sqlWinlossManual: WinlossManualResult,
			sqlTotalRollingManual: TotalRollingManualResult,

			sqlCCChipsBuyinGame: CChipsBuyinGameResult,
			sqlCCChipsBuyinGameReset: CChipsBuyinGameResetResult,
			sqlJunketCredit: JunketCreditResult,
			sqlJunketExpense: JunketExpenseResult,
			sqlJunketLoss: JunketLossResult,
			sqlJunketExpenseGoods: JunketExpenseGoodsResult,
			sqlJunketExpenseNonGoods: JunketExpenseNonGoodsResult,
			sqlReturnMoney: ReturnMoneyResult,
			sqlJunketExpenseReset: ResetExpenseResult,

			sqlAccountTransfer: AccountTransferResult,

			sqlAccountMarkerReturn: AccountMarkerReturnResult,
			sqlMxDepositExchangeAmount: MxDepositExchangeAmountResult,
			sqlMxReturnAmount: MxReturnAmountResult,
			sqlMxMarginReturn: MxMarginReturnResult,
			sqlMxPhpDepositIn: MxPhpDepositInResult,
			sqlMxPhpDepositOut: MxPhpDepositOutResult,
			sqlMxCashNet: MxCashNetResult,
			sqlCurrencyPending: CurrencyPendingResult,
			dashboardWlSharePct,
			dashboardWlShareDefault: DEFAULT_DASHBOARD_WL_SHARE_PCT,
			dashboardMonthKey,
			sqlChipsReturnMarker: ChipsReturnMarkerResult,
			sqlMArkerReturnDeposit: MArkerReturnDepositResult,
			sqlMArkerReturnCash: MArkerReturnCashResult,
			sqlSettlementDepositAmount: SettlementDepositAmountResult,
			sqlSettlementCashOutAmount: SettlementCashOutAmountResult,
			sqlAccountSettlement: AccountSettlementResult,
			sqlNNChipsReturnDeposit: NNChipsReturnDepositResult,
			sqlCageRolling: CageRollingResult,
			sqlAccountCCChipsReturn: AccountCCChipsReturnResult,
			sqlNNChipsAccountMarker: NNChipsAccountMarkerResult,
			sqlNNChipsAccountCash: NNChipsAccountCashResult,
			sqlCCChipsAccountCash: CCChipsAccountCashResult,
			sqlNNChipsAccountDeposit: NNChipsAccountDepositResult,
			sqlCCChipsCashout: CCChipsBuyinCashoutResult,
			sqlHouseRollingReset: HouseRollingResetResult,
			sqlCCReturn: CCBuyinReturnResult,
			sqlNNChipsCashout: NNChipsBuyinCashoutResult,
			sqlNNReturn: NNBuyinReturnResult,
			sqlTotalChipsCashout: TotalChipsBuyinCashoutResult,
			sqlCCChipsRolling: CCChipsRollingResult,
			sqlNNChipsRolling: NNChipsRollingResult,
			sqlTotalChipsRolling: TotalChipsRollingResult,
			sqlCCChipsBuyin: CCChipsBuyinResult,
			sqlCCBuyin: CCBuyinResult,
			sqlNNChipsBuyin: NNChipsBuyinResult,
			sqlNNBuyin: NNBuyinResult,
			sqlTotalChipsBuyin: TotalChipsBuyinResult,
			sqlCCChipsMonthlySettle: CCChipsMonthlySettleResult,
			sqlNNChipsMonthlySettle: NNChipsMonthlySettleResult,
			sqlCashDeposit: cashDepositResult,
			sqlCashWithdraw: cashWithdrawResult,
			sqlAccountDeposit: accountDepositResult,
			sqlAccountWithdraw: accountWithdrawResult,
			sqlAccountDeduct: accountDeductResult,
			sqlAccountServicesDeduct: accountServicesDeductResult,
			sqlAccountCCChips: accountCCChips,
			sqlAccountNNChips: accountNNChips,
			sqlMarkerIssueGame: markerIssueGame,
			sqlMarkerIssueAccount: markerIssueAccount,
			sqlTotalRealRolling: totalRealRolling,
			sqlTotalRolling: totalRolling,
			sqlTotalRollingReset: TotalRollingResetResult,
			sqlTotalCashOut: totalCashOut,
			sqlRollerTipCashOut: rollerTipCashOut,
			sqlTipSettlement: tipSettlementResult,
			sqlRollerTipGross: rollerTipGrossResult,
			sqlTotalCashOutReset: TotalCashOutResetResult,
			sqlTotalCashOutRolling: totalCashOutRolling,
			sqlTotalCashOutRollingReset: TotalCashOutRollingResetResult,
			sqlWinLoss: totalWinLoss,
			sqlWinLossReset: WinLossResetResult,
			sqlCommision: totalCommission,
			sqlCommissionReset: totalCommissionReset,
			sqlShared: totalShared,
			sqlSharedReset: totalSharedReset,
			sqlWinLossLive: totalWinLossLiveCalc,
			sqlWinLossTelebet: totalWinLossTelebetCalc,
			sqlNNChipsBuyinCashDeposit: NNChipsBuyinCashDepositResult,
			sqlCCChipsBuyinCashDeposit: CCChipsBuyinCashDepositResult,
			sqlNNChipsBuyinCashOnly: NNChipsBuyinCashOnlyResult,
			sqlCCChipsBuyinCashOnly: CCChipsBuyinCashOnlyResult,
			sqlNNChipsBuyinGuestAccount: NNChipsBuyinGuestAccountResult,
			sqlCCChipsBuyinGuestAccount: CCChipsBuyinGuestAccountResult,
			sqlRollerNNSubtract: RollerNNSubtractResult,
			sqlRollerNNAdd: RollerNNAddResult,
			sqlRollerCCSubtract: RollerCCSubtractResult,
			sqlRollerCCAdd: RollerCCAddResult,
			sqlReturnRollerCCChips: ReturnRollerCCChipsResult,
			sqlUnreturnedRollerChips: UnreturnedRollerChipsResult,
			sqlAgentCount: AgentCountResult,
			sqlServiceCashGuest: serviceCashGuestResults,
			sqlServiceDepositGuest: serviceDepositGuestResults,
			sqlServiceCashJunket: serviceCashJunketResults,
			sqlServiceDepositJunket: serviceDepositJunketResults,
			sqlServiceSettle: serviceSettleResults,
			// Dashboard Commission card should show Settlement (NET commission)
			sqlCommissionSettlement: totalCommissionSettlement || 0,
			sqlManualBalancing: manualBalancingResult || 0
		});

	} catch (err) {
		console.error(err);
		res.status(500).send(err.message);
	}
});


router.get('/account_dashboard', async (req, res) => {
	const agencyId = req.query.agencyId;
	console.log('Agency ID from query param:', agencyId);

	const creditBalanceSubquery = `
		SELECT 
			account_ledger.ACCOUNT_ID,
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) -
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END) AS credit_balance
		FROM account_ledger
		WHERE account_ledger.ACTIVE = 1
		  AND account_ledger.TRANSACTION_TYPE IN (3, 4)
		GROUP BY account_ledger.ACCOUNT_ID
	`;

	let baseQuery = `
		SELECT 
			account.*, 
			agency.AGENCY AS agency_name, 
			account.IDNo AS account_id, 
			agent.AGENT_CODE AS agent_code, 
			account.ACTIVE AS active, 
			agent.NAME AS agent_name, 
			agent.CONTACTNo AS agent_contact,
			agent.TELEGRAM_ID AS agent_telegram,
			agent.REMARKS AS agent_remarks,
			agent.IDNo AS agent_id,
			IFNULL(SUM(CASE
				WHEN tt.TRANSACTION IN ('DEPOSIT', 'MARKER REDEEM') THEN al.AMOUNT
				WHEN tt.TRANSACTION IN ('WITHDRAW', 'IOU RETURN DEPOSIT') THEN -al.AMOUNT
				ELSE 0
			END), 0) AS total_balance,
			COALESCE(MAX(cred.credit_balance), 0) AS credit_balance
		FROM 
			account 
		JOIN 
			agent ON agent.IDNo = account.AGENT_ID 
		JOIN 
			agency ON agency.IDNo = agent.AGENCY
		LEFT JOIN 
			account_ledger al ON account.IDNo = al.ACCOUNT_ID AND al.ACTIVE = 1 AND al.TRANSACTION_TYPE IN (2, 5, 3)
		LEFT JOIN 
			transaction_type tt ON tt.IDNo = al.TRANSACTION_ID
		LEFT JOIN 
			(${creditBalanceSubquery}) AS cred ON cred.ACCOUNT_ID = account.IDNo
		WHERE 
			account.ACTIVE = 1 
			AND agent.ACTIVE = 1
	`;

	if (agencyId) {
		baseQuery += ` AND agency.IDNo = ${pool.escape(agencyId)}`;
	}

	baseQuery += `
		GROUP BY 
			account.IDNo, 
			agency.AGENCY, 
			agent.AGENT_CODE, 
			agent.NAME, 
			account.ACTIVE
	`;

	try {
		const [results] = await pool.execute(baseQuery);
		res.json(results);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});


// ADD JUNKET CAPITAL
router.post('/add_junket_capital', async (req, res) => {
	try {
		const {
			txtFullname = null,
			txtAmount = "0",
			Remarks = null,
			optWithdrawDeposit = null,
			description = null
		} = req.body;

		let date_now = new Date();
		let txtAmount2 = parseFloat(String(txtAmount ?? '').replace(/,/g, ''));
		if (!Number.isFinite(txtAmount2) || txtAmount2 <= 0) {
			return res.status(400).send('Enter a valid amount greater than zero.');
		}

		const query = `
			INSERT INTO junket_capital(
				TRANSACTION_ID, FULLNAME, DESCRIPTION, AMOUNT, 
				REMARKS, ENCODED_BY, ENCODED_DT
			) VALUES (?, ?, ?, ?, ?, ?, ?)
		`;

		const [insertResult] = await pool.execute(query, [
			optWithdrawDeposit,
			txtFullname,
			description,
			txtAmount2,
			Remarks,
			req.session?.user_id ?? null,
			date_now
		]);

		const transactionConfig = {
			1: { category: 'Capital In', type: 1 },
			2: { category: 'Capital Out', type: 2 }
		}[parseInt(optWithdrawDeposit, 10)];

		if (transactionConfig) {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (
					TRANSACTION_ID,
					AMOUNT,
					CATEGORY,
					TYPE,
					REMARKS,
					ENCODED_BY,
					ENCODED_DT
				) VALUES (?, ?, ?, ?, ?, ?, ?)
			`;

			await pool.execute(cashTransactionQuery, [
				insertResult.insertId,
				txtAmount2.toString(),
				transactionConfig.category,
				transactionConfig.type,
				Remarks,
				req.session?.user_id ?? null,
				date_now
			]);
		}

		res.redirect('/dashboard');
	} catch (err) {
		console.error('Error inserting junket:', err);
		res.status(500).send('Error inserting junket');
	}
});




router.get('/junket_capital_data', async (req, res) => {
	try {
		const { start_date, end_date } = req.query;

		if (!start_date || !end_date) {
			return res.status(400).json({ error: 'start_date and end_date are required' });
		}

		// Define the query
		const query = `
        SELECT * FROM (
            SELECT 
                j.IDNo, 
                j.TRANSACTION_ID, 
                j.NN_CHIPS, 
				(j.NN_CHIPS + j.CC_CHIPS) AS TOTAL_CHIPS,  
                j.ACTIVE, 
                j.ENCODED_BY, 
                j.ENCODED_DT, 
                j.EDITED_BY, 
                j.EDITED_DT, 
                NULL AS CATEGORY_ID, 
                NULL AS CATEGORY,  
                COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME,  
                j.DESCRIPTION COLLATE utf8mb4_general_ci AS capital_description,   
                NULL AS capital_amount, 
                NULL AS ledger_amount, 
                NULL AS REMARKS, 
                NULL AS CAGE_TYPE,  
                NULL AS GAME_ID,
                NULL AS REMARKS_SOURCE
            FROM junket_total_chips j
            LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo 
            WHERE j.ACTIVE = 1 AND DATE(j.ENCODED_DT) BETWEEN ? AND ?

            UNION ALL 

            SELECT 
                k.IDNo, 
                k.TRANSACTION_ID, 
                NULL AS NN_CHIPS, 
                NULL AS TOTAL_CHIPS, 
                k.ACTIVE, 
                k.ENCODED_BY, 
                k.ENCODED_DT, 
                NULL AS EDITED_BY, 
                NULL AS EDITED_DT, 
                NULL AS CATEGORY_ID, 
                k.CATEGORY_ID AS CATEGORY,  
                COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME,  
                k.DESCRIPTION COLLATE utf8mb4_general_ci AS chips_description,   
                k.AMOUNT AS capital_amount, 
                NULL AS ledger_amount, 
                k.REMARKS, 
                NULL AS CAGE_TYPE,  
                NULL AS GAME_ID,
                'junket_capital' AS REMARKS_SOURCE
            FROM junket_capital k
            LEFT JOIN user_info u ON k.ENCODED_BY = u.IDNo 
            WHERE k.ACTIVE = 1 AND DATE(k.ENCODED_DT) BETWEEN ? AND ?

            UNION ALL 

            SELECT 
                al.IDNo, 
                al.TRANSACTION_ID, 
                NULL AS NN_CHIPS, 
                NULL AS TOTAL_CHIPS, 
                al.ACTIVE, 
                al.ENCODED_BY, 
                al.ENCODED_DT, 
                NULL AS EDITED_BY, 
                NULL AS EDITED_DT, 
                NULL AS CATEGORY_ID, 
                NULL AS CATEGORY,  
                COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME,  
                al.TRANSACTION_DESC COLLATE utf8mb4_general_ci AS comms_description,   
                NULL AS capital_amount, 
                al.AMOUNT AS ledger_amount, 
                al.REMARKS, 
                NULL AS CAGE_TYPE,  
                NULL AS GAME_ID,
                'account_ledger' AS REMARKS_SOURCE
            FROM account_ledger al
            LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo 
            WHERE al.ACTIVE = 1 AND DATE(al.ENCODED_DT) BETWEEN ? AND ?

            UNION ALL

            SELECT 
                je.IDNo, 
                NULL AS TRANSACTION_ID, 
                NULL AS NN_CHIPS, 
                NULL AS TOTAL_CHIPS, 
                je.ACTIVE, 
                je.ENCODED_BY, 
                je.ENCODED_DT, 
                NULL AS EDITED_BY, 
                NULL AS EDITED_DT, 
                je.CATEGORY_ID AS CATEGORY_ID, 
                CE.CATEGORY AS CATEGORY, 
                COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME,  
                je.CATEGORY_ID AS expense_description,  
                je.AMOUNT AS capital_amount,  
                NULL AS ledger_amount, 
                je.DESCRIPTION AS REMARKS, 
                NULL AS CAGE_TYPE,  
                NULL AS GAME_ID,
                'junket_house_expense' AS REMARKS_SOURCE
            FROM junket_house_expense je
            LEFT JOIN expense_category CE ON CE.IDNo = je.CATEGORY_ID
            LEFT JOIN user_info u ON je.ENCODED_BY = u.IDNo 
            WHERE je.ACTIVE = 1 AND DATE(je.ENCODED_DT) BETWEEN ? AND ?

            UNION ALL

            SELECT 
                gr.IDNo, 
                gr.TRANSACTION AS TRANSACTION_ID, 
                gr.NN_CHIPS, 
                gr.CC_CHIPS AS TOTAL_CHIPS, 
                gr.ACTIVE, 
                gr.ENCODED_BY, 
                gr.ENCODED_DT, 
                NULL AS EDITED_BY, 
                NULL AS EDITED_DT, 
                NULL AS CATEGORY_ID, 
                NULL AS CATEGORY, 
                COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME,  
                NULL AS capital_description, 
                (gr.NN_CHIPS + gr.CC_CHIPS) AS capital_amount,  
                NULL AS ledger_amount, 
                gr.REMARKS, 
                gr.CAGE_TYPE,  
                gr.GAME_ID,
                'game_record' AS REMARKS_SOURCE
            FROM game_record gr
            LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo 
            WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 1 AND gr.TRANSACTION IN (1, 2) AND DATE(gr.ENCODED_DT) BETWEEN ? AND ?
        ) AS full_result;
    `;

		const [results] = await pool.execute(query, [
			start_date, end_date,
			start_date, end_date,
			start_date, end_date,
			start_date, end_date,
			start_date, end_date
		]);

		res.json(results);
	} catch (err) {
		console.error('Error executing query:', err);
		res.status(500).json({ error: 'Database error' });
	}
});

// FETCH CASH TRANSACTIONS (TYPE 1 = Cash-in, TYPE 2 = Cash-out)
router.get('/cash_transaction_data', async (req, res) => {
	try {
		const { start_date, end_date, type, category } = req.query;

		if (!start_date || !end_date) {
			return res.status(400).json({ error: 'start_date and end_date are required' });
		}

		const conditions = ['DATE(ct.ENCODED_DT) BETWEEN ? AND ?'];
		const params = [start_date, end_date];

		if (type) {
			const typeValue = parseInt(type, 10);
			if (!Number.isNaN(typeValue)) {
				conditions.push('ct.TYPE = ?');
				params.push(typeValue);
			}
		}

		if (category) {
			conditions.push('ct.CATEGORY = ?');
			params.push(category);
		}

		const query = `
			SELECT
				ct.IDNo,
				ct.TRANSACTION_ID,
				ct.AMOUNT,
				ct.CATEGORY,
				ct.TYPE,
				ct.REMARKS,
				ct.ENCODED_BY,
				ct.ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME,
				COALESCE(agent.NAME, '-') AS AGENT_NAME,
				gs.TRANSACTION_ID AS SERVICE_TRANSACTION_ID,
				gs.SOURCE_TYPE AS SERVICE_SOURCE_TYPE
			FROM cash_transaction ct
			LEFT JOIN user_info u ON ct.ENCODED_BY = u.IDNo
			LEFT JOIN agent ON ct.AGENT_ID = agent.IDNo
			LEFT JOIN game_services gs ON gs.IDNo = ct.TRANSACTION_ID AND ct.CATEGORY IN ('fnb', 'hotel', 'delivery')
			LEFT JOIN game_list gl ON gl.IDNo = gs.GAME_ID
			WHERE ${conditions.join(' AND ')}
				AND ct.ACTIVE = 1
				AND (gs.IDNo IS NULL OR gs.TRANSACTION_ID != 3 OR (gs.TRANSACTION_ID = 3 AND gl.SETTLED = 1))
			ORDER BY ct.ENCODED_DT DESC
		`;
		const [results] = await pool.execute(query, params);

		res.json(results);
	} catch (error) {
		console.error('Error fetching cash transactions:', error);
		res.status(500).json({ error: 'Database error' });
	}
});

// Detailed CASH-IN breakdown built directly from source tables
router.get('/cash_in_details', async (req, res) => {
	try {
		const { start_date, end_date } = req.query;

		if (!start_date || !end_date) {
			return res.status(400).json({ error: 'start_date and end_date are required' });
		}

		const dateParams = [start_date, end_date];

		// 1. Capital In (junket_capital)
		const [capitalRowsRaw] = await pool.execute(
			`
			SELECT 
				jc.IDNo,
				jc.AMOUNT,
				jc.FULLNAME AS AGENT_NAME,
				jc.REMARKS,
				jc.ENCODED_BY,
				jc.ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM junket_capital jc
			LEFT JOIN user_info u ON jc.ENCODED_BY = u.IDNo
			WHERE jc.ACTIVE = 1
				AND jc.TRANSACTION_ID = 1
				AND DATE(jc.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const capitalRows = capitalRowsRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Capital In',
			TYPE: 1,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'junket_capital'
		}));

		// 2. Account deposits (ACCOUNT_DEPOSIT)
		const [accountDepositRaw] = await pool.execute(
			`
			SELECT
				al.IDNo,
				al.AMOUNT,
				al.REMARKS,
				al.ENCODED_BY,
				al.ENCODED_DT,
				al.TRANSACTION_ID,
				al.TRANSACTION_TYPE,
				al.TRANSACTION_DESC,
				ag.NAME AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM account_ledger al
			JOIN account acc ON acc.IDNo = al.ACCOUNT_ID
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
			WHERE al.ACTIVE = 1
				AND al.TRANSACTION_TYPE = 2
				AND al.TRANSACTION_ID = 1
				AND acc.ACTIVE = 1
				AND ag.ACTIVE = 1
				AND DATE(al.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const accountDepositRows = accountDepositRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Account Deposit',
			TYPE: 1,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'account_ledger'
		}));

		// 3. Settlement deposits (SETTLEMENT_DEPOSIT -> Commission Deposit)
		const [settlementDepositRaw] = await pool.execute(
			`
			SELECT
				al.IDNo,
				al.GAME_ID,
				al.AMOUNT,
				al.REMARKS,
				al.ENCODED_BY,
				al.ENCODED_DT,
				ag.NAME AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME,
				(
					SELECT ct.REMARKS
					FROM cash_transaction ct
					WHERE ct.ACTIVE = 1
						AND ct.TYPE = 1
						AND ct.CATEGORY = 'Commission Deposit'
						AND (
							(al.GAME_ID IS NOT NULL AND al.GAME_ID != 0 AND ct.TRANSACTION_ID = al.GAME_ID)
							OR (
								(al.GAME_ID IS NULL OR al.GAME_ID = 0)
								AND ABS(TIMESTAMPDIFF(SECOND, ct.ENCODED_DT, al.ENCODED_DT)) <= 5
								AND ABS(CAST(ct.AMOUNT AS DECIMAL(18,2)) - CAST(al.AMOUNT AS DECIMAL(18,2))) < 0.02
							)
						)
					ORDER BY ct.IDNo DESC
					LIMIT 1
				) AS cash_txn_remarks
			FROM account_ledger al
			JOIN account acc ON acc.IDNo = al.ACCOUNT_ID
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
			WHERE al.ACTIVE = 1
				AND al.TRANSACTION_TYPE = 5
				AND al.TRANSACTION_ID = 1
				AND acc.ACTIVE = 1
				AND ag.ACTIVE = 1
				AND DATE(al.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const settlementDepositRows = settlementDepositRaw.map((row) => {
			const gid = row.GAME_ID != null && Number(row.GAME_ID) > 0 ? row.GAME_ID : null;
			const ledgerRem = row.REMARKS && String(row.REMARKS).trim();
			const fromCash = row.cash_txn_remarks && String(row.cash_txn_remarks).trim();
			let remarks = '';
			if (gid) {
				remarks = `Game - ${gid}${ledgerRem ? ` | ${ledgerRem}` : ''}`;
			} else if (fromCash) {
				remarks = fromCash;
			} else {
				remarks = ledgerRem || '';
			}
			return {
				IDNo: row.IDNo,
				TRANSACTION_ID: row.IDNo,
				AMOUNT: row.AMOUNT,
				CATEGORY: 'Commission Deposit',
				TYPE: 1,
				REMARKS: remarks,
				ENCODED_BY: row.ENCODED_BY,
				ENCODED_DT: row.ENCODED_DT,
				ENCODED_BY_NAME: row.ENCODED_BY_NAME,
				AGENT_NAME: row.AGENT_NAME || '-',
				SERVICE_TRANSACTION_ID: null,
				SERVICE_SOURCE_TYPE: null,
				REMARKS_SOURCE: 'account_ledger',
				REMARKS_EDIT: ledgerRem || fromCash || ''
			};
		});

		// 4. Chips cash-out to casino (TotalChipsCashout)
		const [chipsCashoutRaw] = await pool.execute(
			`
			SELECT
				j.IDNo,
				j.TOTAL_CHIPS AS AMOUNT,
				j.DESCRIPTION AS REMARKS,
				j.ENCODED_BY,
				j.ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM junket_total_chips j
			LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo
			WHERE j.ACTIVE = 1
				AND j.TRANSACTION_ID = 2
				AND DATE(j.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const chipsCashoutRows = chipsCashoutRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Chips Cash-out to Casino',
			TYPE: 1,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'junket_total_chips'
		}));

		// 5. Game cash buy-ins (NN/CC cash-only)
		const [gameBuyinRaw] = await pool.execute(
			`
			SELECT
				gr.IDNo,
				gr.GAME_ID,
				gr.REMARKS,
				(COALESCE(gr.NN_CHIPS, 0) + COALESCE(gr.CC_CHIPS, 0)) AS AMOUNT,
				gr.ENCODED_BY,
				gr.ENCODED_DT,
				ag.NAME AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM game_record gr
			JOIN game_list gl ON gl.IDNo = gr.GAME_ID
			JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo
			WHERE gr.ACTIVE = 1
				AND gr.CAGE_TYPE = 1
				AND gr.TRANSACTION = 1
				AND DATE(gr.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const gameBuyinRows = gameBuyinRaw.map((row) => {
			const gameRemarks = row.REMARKS && String(row.REMARKS).trim();
			const displayRemarks = gameRemarks || (row.GAME_ID ? `Game - ${row.GAME_ID}` : '');
			return {
				IDNo: row.IDNo,
				TRANSACTION_ID: row.GAME_ID,
				AMOUNT: row.AMOUNT,
				CATEGORY: 'Game buy-in',
				TYPE: 1,
				REMARKS: displayRemarks,
				ENCODED_BY: row.ENCODED_BY,
				ENCODED_DT: row.ENCODED_DT,
				ENCODED_BY_NAME: row.ENCODED_BY_NAME,
				AGENT_NAME: row.AGENT_NAME || '-',
				SERVICE_TRANSACTION_ID: null,
				SERVICE_SOURCE_TYPE: null,
				REMARKS_SOURCE: 'game_record',
				REMARKS_EDIT: gameRemarks || ''
			};
		});

		// 6. Guest services (ServiceCashGuest + ServiceDepositGuest)
		const [guestServicesRaw] = await pool.execute(
			`
			SELECT
				gs.IDNo,
				gs.AMOUNT,
				gs.SERVICE_TYPE,
				gs.REMARKS,
				gs.ENCODED_BY,
				gs.ENCODED_DT,
				gs.TRANSACTION_ID AS SERVICE_TRANSACTION_ID,
				gs.SOURCE_TYPE AS SERVICE_SOURCE_TYPE,
				COALESCE(ag.NAME, '-') AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM game_services gs
			LEFT JOIN agent ag ON gs.AGENT_ID = ag.IDNo
			LEFT JOIN user_info u ON gs.ENCODED_BY = u.IDNo
			WHERE gs.ACTIVE = 1
				AND gs.SOURCE_TYPE = 'GUEST'
				AND gs.TRANSACTION_ID IN (1, 2)
				AND DATE(gs.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const guestServiceRows = guestServicesRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: row.SERVICE_TYPE || '',
			TYPE: 1,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: row.SERVICE_TRANSACTION_ID,
			SERVICE_SOURCE_TYPE: row.SERVICE_SOURCE_TYPE,
			REMARKS_SOURCE: 'game_services'
		}));

		// 7. Marker return cash (MARKER_RETURN_CASH)
		const [markerReturnRaw] = await pool.execute(
			`
			SELECT
				al.IDNo,
				al.AMOUNT,
				al.REMARKS,
				al.ENCODED_BY,
				al.ENCODED_DT,
				ag.NAME AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM account_ledger al
			JOIN account acc ON acc.IDNo = al.ACCOUNT_ID
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
			WHERE al.ACTIVE = 1
				AND al.TRANSACTION_TYPE = 3
				AND al.TRANSACTION_ID = 11
				AND acc.ACTIVE = 1
				AND ag.ACTIVE = 1
				AND DATE(al.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const markerReturnRows = markerReturnRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Marker Return Cash',
			TYPE: 1,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'account_ledger'
		}));

		// 8. Return money (RETURN_MONEY)
		const [returnMoneyRaw] = await pool.execute(
			`
			SELECT
				rm.IDNo,
				rm.AMOUNT,
				rm.DESCRIPTION AS REMARKS,
				rm.ENCODED_BY,
				rm.ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM junket_return_money rm
			LEFT JOIN user_info u ON rm.ENCODED_BY = u.IDNo
			WHERE rm.ACTIVE = 1
				AND DATE(rm.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const returnMoneyRows = returnMoneyRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Return Money',
			TYPE: 1,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'junket_return_money'
		}));

		const allRows = [
			...capitalRows,
			...accountDepositRows,
			...settlementDepositRows,
			...chipsCashoutRows,
			...gameBuyinRows,
			...guestServiceRows,
			...markerReturnRows,
			...returnMoneyRows
		];

		allRows.sort((a, b) => {
			const aTime = a.ENCODED_DT ? new Date(a.ENCODED_DT).getTime() : 0;
			const bTime = b.ENCODED_DT ? new Date(b.ENCODED_DT).getTime() : 0;
			return bTime - aTime;
		});

		res.json(allRows);
	} catch (error) {
		console.error('Error fetching cash-in details:', error);
		res.status(500).json({ error: 'Database error' });
	}
});

// Detailed CASH-OUT breakdown built directly from source tables
router.get('/cash_out_details', async (req, res) => {
	try {
		const { start_date, end_date } = req.query;

		if (!start_date || !end_date) {
			return res.status(400).json({ error: 'start_date and end_date are required' });
		}

		const dateParams = [start_date, end_date];

		// 1. Capital Out (junket_capital)
		const [capitalOutRaw] = await pool.execute(
			`
			SELECT 
				jc.IDNo,
				jc.AMOUNT,
				jc.FULLNAME AS AGENT_NAME,
				jc.REMARKS,
				jc.ENCODED_BY,
				jc.ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM junket_capital jc
			LEFT JOIN user_info u ON jc.ENCODED_BY = u.IDNo
			WHERE jc.ACTIVE = 1
				AND jc.TRANSACTION_ID = 2
				AND DATE(jc.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const capitalOutRows = capitalOutRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Capital Out',
			TYPE: 2,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'junket_capital'
		}));

		// 2. Chips Buy-in (junket_total_chips, TRANSACTION_ID = 1)
		const [chipsBuyinRaw] = await pool.execute(
			`
			SELECT
				j.IDNo,
				j.TOTAL_CHIPS AS AMOUNT,
				j.DESCRIPTION AS REMARKS,
				j.ENCODED_BY,
				j.ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM junket_total_chips j
			LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo
			WHERE j.ACTIVE = 1
				AND j.TRANSACTION_ID = 1
				AND DATE(j.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const chipsBuyinRows = chipsBuyinRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Chips Buy-in',
			TYPE: 2,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'junket_total_chips'
		}));

		// 3. Game Cash-out (game_record, CAGE_TYPE = 2)
		const [gameCashoutRaw] = await pool.execute(
			`
			SELECT
				gr.IDNo,
				gr.GAME_ID,
				gr.REMARKS,
				(COALESCE(gr.NN_CHIPS, 0) + COALESCE(gr.CC_CHIPS, 0)) AS AMOUNT,
				gr.ENCODED_BY,
				gr.ENCODED_DT,
				ag.NAME AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM game_record gr
			JOIN game_list gl ON gl.IDNo = gr.GAME_ID
			JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo
			WHERE gr.ACTIVE = 1
				AND gr.CAGE_TYPE = 2
				AND gr.TRANSACTION != 4
				AND DATE(gr.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const gameCashoutRows = gameCashoutRaw.map((row) => {
			const gameRemarks = row.REMARKS && String(row.REMARKS).trim();
			const displayRemarks = gameRemarks || (row.GAME_ID ? `Game - ${row.GAME_ID}` : '');
			return {
				IDNo: row.IDNo,
				TRANSACTION_ID: row.GAME_ID,
				AMOUNT: row.AMOUNT,
				CATEGORY: 'Game Cash-out',
				TYPE: 2,
				REMARKS: displayRemarks,
				ENCODED_BY: row.ENCODED_BY,
				ENCODED_DT: row.ENCODED_DT,
				ENCODED_BY_NAME: row.ENCODED_BY_NAME,
				AGENT_NAME: row.AGENT_NAME || '-',
				SERVICE_TRANSACTION_ID: null,
				SERVICE_SOURCE_TYPE: null,
				REMARKS_SOURCE: 'game_record',
				REMARKS_EDIT: gameRemarks || ''
			};
		});

		// 4. Account Withdraw (ACCOUNT_WITHDRAW)
		const [accountWithdrawRaw] = await pool.execute(
			`
			SELECT
				al.IDNo,
				al.AMOUNT,
				al.REMARKS,
				al.ENCODED_BY,
				al.ENCODED_DT,
				ag.NAME AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM account_ledger al
			JOIN account acc ON acc.IDNo = al.ACCOUNT_ID
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
			WHERE al.ACTIVE = 1
				AND al.TRANSACTION_ID = 2
				AND al.TRANSACTION_DESC = 'ACCOUNT DETAILS'
				AND acc.ACTIVE = 1
				AND ag.ACTIVE = 1
				AND DATE(al.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const accountWithdrawRows = accountWithdrawRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Account Withdraw',
			TYPE: 2,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'account_ledger'
		}));

		// 5. Account Credit (ACCOUNT_CREDIT from account_ledger)
		const [accountCreditRaw] = await pool.execute(
			`
			SELECT
				al.IDNo,
				al.AMOUNT,
				al.REMARKS,
				al.ENCODED_BY,
				al.ENCODED_DT,
				ag.NAME AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM account_ledger al
			JOIN account acc ON acc.IDNo = al.ACCOUNT_ID
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
			WHERE al.ACTIVE = 1
				AND al.TRANSACTION_TYPE = 3
				AND al.TRANSACTION_ID = 3
				AND acc.ACTIVE = 1
				AND ag.ACTIVE = 1
				AND DATE(al.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const accountCreditRows = accountCreditRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Account Credit',
			TYPE: 2,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'account_ledger'
		}));

		// 6. Commission Cash-out (ACCOUNT_SETTLEMENT, TRANSACTION_TYPE = 5, TRANSACTION_ID = 5)
		const [commissionCashoutRaw] = await pool.execute(
			`
			SELECT
				al.IDNo,
				al.AMOUNT,
				al.REMARKS,
				al.ENCODED_BY,
				al.ENCODED_DT,
				ag.NAME AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM account_ledger al
			JOIN account acc ON acc.IDNo = al.ACCOUNT_ID
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
			WHERE al.ACTIVE = 1
				AND al.TRANSACTION_TYPE = 5
				AND al.TRANSACTION_ID = 5
				AND acc.ACTIVE = 1
				AND ag.ACTIVE = 1
				AND DATE(al.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const commissionCashoutRows = commissionCashoutRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Commission Cash-out',
			TYPE: 2,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'account_ledger'
		}));

		// 7. Junket services (ServiceCashJunket + ServiceDepositJunket)
		const [junketServicesRaw] = await pool.execute(
			`
			SELECT
				gs.IDNo,
				gs.AMOUNT,
				gs.SERVICE_TYPE,
				gs.REMARKS,
				gs.ENCODED_BY,
				gs.ENCODED_DT,
				gs.TRANSACTION_ID AS SERVICE_TRANSACTION_ID,
				gs.SOURCE_TYPE AS SERVICE_SOURCE_TYPE,
				COALESCE(ag.NAME, '-') AS AGENT_NAME,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM game_services gs
			LEFT JOIN agent ag ON gs.AGENT_ID = ag.IDNo
			LEFT JOIN user_info u ON gs.ENCODED_BY = u.IDNo
			WHERE gs.ACTIVE = 1
				AND gs.SOURCE_TYPE = 'JUNKET'
				AND gs.TRANSACTION_ID IN (1, 2)
				AND DATE(gs.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const junketServiceRows = junketServicesRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: row.SERVICE_TYPE || '',
			TYPE: 2,
			REMARKS: row.REMARKS || '',
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: row.AGENT_NAME || '-',
			SERVICE_TRANSACTION_ID: row.SERVICE_TRANSACTION_ID,
			SERVICE_SOURCE_TYPE: row.SERVICE_SOURCE_TYPE,
			REMARKS_SOURCE: 'game_services'
		}));

		// 8. Expenses (junket_house_expense)
		const [expensesRaw] = await pool.execute(
			`
			SELECT
				jhe.IDNo,
				jhe.AMOUNT,
				jhe.DESCRIPTION AS REMARKS,
				jhe.ENCODED_BY,
				jhe.ENCODED_DT,
				COALESCE(ec.CATEGORY, '-') AS EXPENSE_CATEGORY,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM junket_house_expense jhe
			LEFT JOIN expense_category ec ON ec.IDNo = jhe.CATEGORY_ID
			LEFT JOIN user_info u ON jhe.ENCODED_BY = u.IDNo
			WHERE jhe.ACTIVE = 1
				AND DATE(jhe.ENCODED_DT) BETWEEN ? AND ?
			`,
			dateParams
		);

		const expenseRows = expensesRaw.map((row) => ({
			IDNo: row.IDNo,
			TRANSACTION_ID: row.IDNo,
			AMOUNT: row.AMOUNT,
			CATEGORY: 'Expenses',
			TYPE: 2,
			REMARKS: row.EXPENSE_CATEGORY
				? `${row.EXPENSE_CATEGORY}${row.REMARKS ? ' - ' + row.REMARKS : ''}`
				: (row.REMARKS || ''),
			ENCODED_BY: row.ENCODED_BY,
			ENCODED_DT: row.ENCODED_DT,
			ENCODED_BY_NAME: row.ENCODED_BY_NAME,
			AGENT_NAME: '-',
			SERVICE_TRANSACTION_ID: null,
			SERVICE_SOURCE_TYPE: null,
			REMARKS_SOURCE: 'junket_house_expense',
			REMARKS_EDIT: row.REMARKS || ''
		}));

		// 9. Tip Settlement (tip_settlement)
		const [tipSettlementRaw] = await pool.execute(
			`
			SELECT
				ts.IDNo,
				ts.AMOUNT,
				ts.REMARKS,
				ts.ROLLER_NAME,
				ts.TIP_STATUS,
				ts.ENCODED_BY,
				ts.SETTLEMENT_DATETIME AS ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM tip_settlement ts
			LEFT JOIN user_info u ON ts.ENCODED_BY = u.IDNo
			WHERE ts.ACTIVE = 1
				AND DATE(ts.SETTLEMENT_DATETIME) BETWEEN ? AND ?
			`,
			dateParams
		);

		const tipSettlementRows = tipSettlementRaw.map((row) => {
			const namePart = row.ROLLER_NAME ? String(row.ROLLER_NAME).trim() : '';
			const statusPart = row.TIP_STATUS ? String(row.TIP_STATUS).trim() : '';
			const remarksPart = row.REMARKS ? String(row.REMARKS).trim() : '';
			const detailParts = [namePart, statusPart, remarksPart].filter(Boolean);
			return {
				IDNo: row.IDNo,
				TRANSACTION_ID: row.IDNo,
				AMOUNT: row.AMOUNT,
				CATEGORY: 'Tip Settlement',
				TYPE: 2,
				REMARKS: detailParts.length ? detailParts.join(' - ') : 'Tip Settlement',
				ENCODED_BY: row.ENCODED_BY,
				ENCODED_DT: row.ENCODED_DT,
				ENCODED_BY_NAME: row.ENCODED_BY_NAME,
				AGENT_NAME: '-',
				SERVICE_TRANSACTION_ID: null,
				SERVICE_SOURCE_TYPE: null,
				REMARKS_SOURCE: 'tip_settlement',
				REMARKS_EDIT: remarksPart
			};
		});

		const allRows = [
			...capitalOutRows,
			...chipsBuyinRows,
			...gameCashoutRows,
			...accountWithdrawRows,
			...accountCreditRows,
			...commissionCashoutRows,
			...junketServiceRows,
			...expenseRows,
			...tipSettlementRows
		];

		allRows.sort((a, b) => {
			const aTime = a.ENCODED_DT ? new Date(a.ENCODED_DT).getTime() : 0;
			const bTime = b.ENCODED_DT ? new Date(b.ENCODED_DT).getTime() : 0;
			return bTime - aTime;
		});

		res.json(allRows);
	} catch (error) {
		console.error('Error fetching cash-out details:', error);
		res.status(500).json({ error: 'Database error' });
	}
});

// GET NN CHIPS HISTORY
router.get('/nn_chips_history', async (req, res) => {
	try {
		const { start_date, end_date } = req.query;

		if (!start_date || !end_date) {
			return res.status(400).json({ error: 'start_date and end_date are required' });
		}

		const query = `
			SELECT 
				j.IDNo,
				j.TRANSACTION_ID,
				j.NN_CHIPS,
				j.DESCRIPTION AS capital_description,
				NULL AS REMARKS,
				NULL AS GAME_ID,
				j.ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM junket_total_chips j
			LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo
			WHERE j.ACTIVE = 1 
				AND j.TRANSACTION_ID IN (1, 2, 3, 4)
				AND j.NN_CHIPS > 0
				AND DATE(j.ENCODED_DT) BETWEEN ? AND ?
			ORDER BY j.ENCODED_DT DESC
		`;

		const [results] = await pool.execute(query, [start_date, end_date]);

		res.json(results);
	} catch (err) {
		console.error('Error executing NN chips history query:', err);
		res.status(500).json({ error: 'Database error' });
	}
});

// GET CC CHIPS HISTORY
router.get('/cc_chips_history', async (req, res) => {
	try {
		const { start_date, end_date } = req.query;

		if (!start_date || !end_date) {
			return res.status(400).json({ error: 'start_date and end_date are required' });
		}

		// Query specifically for CC chips buy-in, cashout, and rolling from junket_total_chips
		const query = `
			SELECT 
				j.IDNo,
				j.TRANSACTION_ID,
				j.CC_CHIPS,
				j.DESCRIPTION AS capital_description,
				j.ENCODED_DT,
				COALESCE(u.FIRSTNAME, 'N/A') AS ENCODED_BY_NAME
			FROM junket_total_chips j
			LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo
			WHERE j.ACTIVE = 1 
				AND j.TRANSACTION_ID IN (1, 2, 3, 4)
				AND j.CC_CHIPS > 0
				AND DATE(j.ENCODED_DT) BETWEEN ? AND ?
			ORDER BY j.ENCODED_DT DESC
		`;

		const [results] = await pool.execute(query, [start_date, end_date]);

		res.json(results);
	} catch (err) {
		console.error('Error executing CC chips history query:', err);
		res.status(500).json({ error: 'Database error' });
	}
});

// GET month_settle for selected period (for "less" in Total Chips: subtract only if this period was settled)
router.get('/month_settle_for_period', async (req, res) => {
	try {
		let { start_date, end_date } = req.query;
		if (!start_date || !end_date) {
			return res.json({ nn_cashout: 0, cc_cashout: 0 });
		}
		// Normalize to YYYY-MM-DD for MySQL (in case of "Mar 31, 2026" etc.)
		const toYmd = (s) => {
			const d = new Date(s.trim());
			if (isNaN(d.getTime())) return null;
			return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
		};
		start_date = toYmd(start_date) || start_date;
		end_date = toYmd(end_date) || end_date;
		const [rows] = await pool.execute(
			`SELECT nn_cashout, cc_cashout FROM month_settle
			 WHERE active = 1 AND period_start <= ? AND period_end >= ?
			 LIMIT 1`,
			[end_date, start_date]
		);
		const row = rows[0] || {};
		res.json({
			nn_cashout: parseFloat(row.nn_cashout) || 0,
			cc_cashout: parseFloat(row.cc_cashout) || 0
		});
	} catch (err) {
		console.error('Error fetching month_settle for period:', err);
		res.status(500).json({ error: 'Database error', nn_cashout: 0, cc_cashout: 0 });
	}
});

// EDIT JUNKET CAPITAL
router.put('/junket_capital/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const {
			txtFullname,
			txtAmount,
			Remarks
		} = req.body;

		let date_now = new Date();

		const query = `
			UPDATE junket_capital 
			SET FULLNAME = ?, AMOUNT = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ? 
			WHERE IDNo = ?
		`;

		await pool.execute(query, [
			txtFullname,
			txtAmount,
			Remarks,
			req.session.user_id,
			date_now,
			id
		]);

		res.send('Junket updated successfully');
	} catch (err) {
		console.error('Error updating Junket:', err);
		res.status(500).send('Error updating Junket');
	}
});

// DELETE JUNKET CAPITAL AND TOTAL CHIPS
router.put('/junket_capital/remove/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		let date_now = new Date();

		const query1 = `UPDATE junket_capital SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query1, [0, req.session.user_id, date_now, id]);

		const query2 = `UPDATE junket_total_chips SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query2, [0, req.session.user_id, date_now, id]);

		await pool.execute(
			'UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1',
			[req.session.user_id, date_now, id]
		);

		res.send('Junket updated successfully');
	} catch (err) {
		console.error('Error updating Junket:', err);
		res.status(500).send('Error updating Junket');
	}
});



// ON GAME LIST
router.get('/on_game_list_data', async (req, res) => {
	try {
		const query = `SELECT *, game_list.IDNo AS game_list_id, game_list.ACTIVE AS game_status, account.IDNo AS account_no, agent.AGENT_CODE AS agent_code, agent.NAME AS agent_name 
			FROM game_list 
			JOIN account ON game_list.ACCOUNT_ID = account.IDNo
			JOIN agent ON agent.IDNo = account.AGENT_ID
			JOIN agency ON agency.IDNo = agent.AGENCY
			WHERE game_list.ACTIVE NOT IN (0, 1)
			ORDER BY game_list.IDNo ASC`;

		const [result] = await pool.execute(query);

		res.json(result);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});


// ADD JUNKET TOTAL CHIPS
router.post('/add_junket_total_chips', async (req, res) => {
	const { txtNNChips, txtCCChips, optBuyinReturn, typedescription } = req.body;
	let date_now = new Date();

	const nnChipsStr = String(txtNNChips ?? '').replace(/,/g, ''); // Remove commas
	const ccChipsStr = String(txtCCChips ?? '').replace(/,/g, ''); // Remove commas

	const nnChips = isNaN(parseFloat(nnChipsStr)) ? 0 : parseFloat(nnChipsStr);
	const ccChips = isNaN(parseFloat(ccChipsStr)) ? 0 : parseFloat(ccChipsStr);

	const chipPositiveFinite = (a) => Number.isFinite(a) && a > 0;
	const chipNonNegativeFinite = (a) => Number.isFinite(a) && a >= 0;

	// Buy-in (NN only): NN ≤ live Cash Balance
	if (String(optBuyinReturn) === '1') {
		if (ccChips !== 0) {
			return res.status(400).send('Buy-in allows NN chips only.');
		}
		if (!chipPositiveFinite(nnChips)) {
			return res.status(400).send('Enter a valid positive NN amount for buy-in.');
		}
		try {
			const cashBal = await dashboardQueries.computeCashBalance();
			if (nnChips > cashBal) {
				return res.status(400).send('NN chips buy-in exceeds current cash balance.');
			}
		} catch (buyErr) {
			console.error('Error validating junket chips buy-in cash balance', buyErr);
			return res.status(500).send('Could not validate cash balance.');
		}
	}

	// Rolling (CC only): CC ≤ NN balance and CC ≤ CC balance
	if (String(optBuyinReturn) === '3') {
		if (nnChips !== 0) {
			return res.status(400).send('Rolling allows CC chips only.');
		}
		if (!chipPositiveFinite(ccChips)) {
			return res.status(400).send('Enter a valid positive CC amount for rolling.');
		}
		try {
			const [nnBal, ccBal] = await Promise.all([
				dashboardQueries.computeNnChipsBalance(),
				dashboardQueries.computeCcChipsBalance()
			]);
			if (ccChips > nnBal) {
				return res.status(400).send('CC rolling exceeds current NN balance.');
			}
			if (ccChips > ccBal) {
				return res.status(400).send('CC rolling exceeds current CC balance.');
			}
		} catch (rollErr) {
			console.error('Error validating junket chips rolling balance', rollErr);
			return res.status(500).send('Could not validate chips balance.');
		}
	}

	// Chips cash-out: must not exceed live NN/CC balances (same formulas as dashboard)
	if (String(optBuyinReturn) === '2') {
		if (nnChips <= 0 && ccChips <= 0) {
			return res.status(400).send('Enter at least one chips amount for cash-out.');
		}
		if (!chipNonNegativeFinite(nnChips) || !chipNonNegativeFinite(ccChips)) {
			return res.status(400).send('Chips amounts must be valid non-negative numbers.');
		}
		try {
			const [nnBal, ccBal] = await Promise.all([
				dashboardQueries.computeNnChipsBalance(),
				dashboardQueries.computeCcChipsBalance()
			]);
			if (nnChips > nnBal) {
				return res.status(400).send('NN chips cash-out exceeds current NN balance.');
			}
			if (ccChips > ccBal) {
				return res.status(400).send('CC chips cash-out exceeds current CC balance.');
			}
		} catch (balErr) {
			console.error('Error validating junket chips cash-out balance', balErr);
			return res.status(500).send('Could not validate chips balance.');
		}
	}

	// Calculate the total chips by summing nnChips and ccChips
	const totalChips = nnChips + ccChips;

	const query = `INSERT INTO junket_total_chips(TRANSACTION_ID, DESCRIPTION, NN_CHIPS, CC_CHIPS, TOTAL_CHIPS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
	try {
		const [insertResult] = await pool.execute(query, [optBuyinReturn, typedescription, nnChips, ccChips, totalChips, req.session.user_id, date_now]);

		const cashConfig = {
			'1': { category: 'Chips Buy-in', type: 2 },
			'2': { category: 'Chips Cash-out to Casino', type: 1 }
		}[String(optBuyinReturn)];

		if (cashConfig) {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (
					TRANSACTION_ID,
					AMOUNT,
					CATEGORY,
					TYPE,
					REMARKS,
					ENCODED_BY,
					ENCODED_DT
				) VALUES (?, ?, ?, ?, ?, ?, ?)
			`;

			await pool.execute(cashTransactionQuery, [
				insertResult.insertId,
				totalChips.toString(),
				cashConfig.category,
				cashConfig.type,
				null,
				req.session.user_id,
				date_now
			]);
		}

		res.redirect('/dashboard');
	} catch (err) {
		console.error('Error inserting junket total chips', err);
		res.status(500).send('Error inserting junket total chips');
	}
});



// END JUNKET TOTAL CHIPS


// START MARKER
// GET MARKER DATA CASHOUT
router.get('/marker_data_cashout/:id', async (req, res) => {
	const id = parseInt(req.params.id);
	const query = `
		SELECT account.IDNo AS ACCOUNT_ID,
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) - 
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END) AS TOTAL_AMOUNT, 
			agent.AGENT_CODE AS AGENT_CODE, agent.NAME AS AGENT_NAME 
		FROM agent 
		JOIN account ON agent.IDNo = account.AGENT_ID 
		JOIN account_ledger ON account.IDNo = account_ledger.ACCOUNT_ID 
		WHERE account_ledger.TRANSACTION_TYPE IN (3, 4) 
		AND account_ledger.ACTIVE = 1 AND agent.ACTIVE = 1 AND account_ledger.ACCOUNT_ID = ? 
		GROUP BY account.IDNo, agent.AGENT_CODE, agent.NAME 
		HAVING TOTAL_AMOUNT <> 0`;

	try {
		const [results] = await pool.execute(query, [id]);
		res.json(results);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});

// GET MARKER DATA
router.get('/marker_data', async (req, res) => {
	const query = `
		SELECT account.IDNo AS ACCOUNT_ID,
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) - 
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END) AS TOTAL_AMOUNT, 
			agent.AGENT_CODE AS AGENT_CODE, agent.NAME AS AGENT_NAME 
		FROM agent 
		JOIN account ON agent.IDNo = account.AGENT_ID 
		JOIN account_ledger ON account.IDNo = account_ledger.ACCOUNT_ID 
		WHERE account_ledger.TRANSACTION_TYPE IN (3, 4) 
		AND account_ledger.ACTIVE = 1 
		AND account.ACTIVE = 1 
		AND agent.ACTIVE = 1 
		GROUP BY account.IDNo, agent.AGENT_CODE, agent.NAME 
		HAVING TOTAL_AMOUNT <> 0`;

	try {
		const [results] = await pool.execute(query);
		res.json(results);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});

// GET MARKER DATA WITH BREAKDOWN (Credit 3-3 vs Buy-in 10-3 per account, minus returns 11,12,1)
router.get('/marker_data_breakdown', async (req, res) => {
	const query = `
		SELECT inner_sub.ACCOUNT_ID, inner_sub.AGENT_CODE, inner_sub.AGENT_NAME,
			inner_sub.BALANCE_CREDIT,
			inner_sub.TOTAL_AMOUNT - inner_sub.BALANCE_CREDIT AS BALANCE_BUYIN,
			inner_sub.TOTAL_AMOUNT
		FROM (
			SELECT sub.ACCOUNT_ID, sub.AGENT_CODE, sub.AGENT_NAME,
				ROUND(
					GREATEST(
						0,
						sub.CREDIT_ISSUED -
						sub.RETURNS_TAGGED_CREDIT -
						COALESCE(sub.RETURNS_UNTAGGED * sub.CREDIT_ISSUED / NULLIF(sub.TOTAL_ISSUED, 0), 0)
					),
					0
				) AS BALANCE_CREDIT,
				ROUND(
					sub.TOTAL_ISSUED - sub.RETURNS_TAGGED_CREDIT - sub.RETURNS_TAGGED_BUYIN - sub.RETURNS_UNTAGGED,
					0
				) AS TOTAL_AMOUNT
			FROM (
				SELECT account.IDNo AS ACCOUNT_ID, agent.AGENT_CODE, agent.NAME AS AGENT_NAME,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID = 3 AND account_ledger.TRANSACTION_TYPE = 3 THEN account_ledger.AMOUNT ELSE 0 END) AS CREDIT_ISSUED,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID = 10 AND account_ledger.TRANSACTION_TYPE = 3 THEN account_ledger.AMOUNT ELSE 0 END) AS BUYIN_ISSUED,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) AND account_ledger.TRANSACTION_DESC = 'RETURN_SOURCE:CREDIT' THEN account_ledger.AMOUNT ELSE 0 END) AS RETURNS_TAGGED_CREDIT,
					SUM(CASE WHEN (account_ledger.TRANSACTION_ID IN (11, 12, 1) AND account_ledger.TRANSACTION_DESC = 'RETURN_SOURCE:BUYIN') OR (account_ledger.TRANSACTION_ID IN (11, 12) AND (account_ledger.TRANSACTION_DESC IS NULL OR TRIM(account_ledger.TRANSACTION_DESC) = '')) OR (account_ledger.TRANSACTION_ID = 1 AND account_ledger.TRANSACTION_TYPE = 4) THEN account_ledger.AMOUNT ELSE 0 END) AS RETURNS_TAGGED_BUYIN,
					SUM(CASE 
						WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1)
							AND NOT (account_ledger.TRANSACTION_ID = 1 AND account_ledger.TRANSACTION_TYPE = 4)
							AND (account_ledger.TRANSACTION_DESC IS NULL OR account_ledger.TRANSACTION_DESC NOT IN ('RETURN_SOURCE:CREDIT', 'RETURN_SOURCE:BUYIN'))
							AND NOT (account_ledger.TRANSACTION_ID IN (11, 12) AND (account_ledger.TRANSACTION_DESC IS NULL OR TRIM(account_ledger.TRANSACTION_DESC) = ''))
						THEN account_ledger.AMOUNT 
						ELSE 0 
					END) AS RETURNS_UNTAGGED,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) AS TOTAL_ISSUED
				FROM agent
				JOIN account ON agent.IDNo = account.AGENT_ID
				JOIN account_ledger ON account.IDNo = account_ledger.ACCOUNT_ID
				WHERE account_ledger.TRANSACTION_TYPE IN (3, 4) AND account_ledger.ACTIVE = 1 AND account.ACTIVE = 1 AND agent.ACTIVE = 1
				GROUP BY account.IDNo, agent.AGENT_CODE, agent.NAME
				HAVING (
					SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) -
					SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END)
				) <> 0
			) sub
		) inner_sub`;

	try {
		const [results] = await pool.execute(query);
		res.json(results);
	} catch (error) {
		console.error('Error fetching marker data breakdown:', error);
		res.status(500).send('Error fetching data');
	}
});

// ADD MARKER RETURN
router.post('/add_marker_settlement', async (req, res) => {
	const { txtAccountMarker, txtMarkerReturn, optTransType, optReturnSource, AgentBalance, remarks } = req.body;

	let date_now = new Date();
	let time_now = new Date();
	time_now.setHours(time_now.getHours());
	let updated_time = time_now.toLocaleTimeString();
	let date_nowTG = date_now.toLocaleDateString();
	let markerReturn = parseFloat(txtMarkerReturn.replace(/,/g, '')) || 0;

	try {
		if (!['credit', 'buyin'].includes(String(optReturnSource || ''))) {
			return res.status(400).json({ error: 'Please select where to deduct the return.' });
		}
		if (optTransType === '12') {
			// Total balance excludes Credit/IOU (IOU CASH / CREDIT CASH)
			const checkBalanceQuery = `
                SELECT 
                    SUM(CASE WHEN transaction_type.TRANSACTION IN ('DEPOSIT', 'MARKER REDEEM') THEN account_ledger.AMOUNT ELSE 0 END) -
                    SUM(CASE WHEN transaction_type.TRANSACTION IN ('WITHDRAW', 'IOU RETURN DEPOSIT') THEN account_ledger.AMOUNT ELSE 0 END)
                AS balance 
                FROM account_ledger 
                JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
                WHERE account_ledger.ACCOUNT_ID = ? 
                AND account_ledger.TRANSACTION_TYPE IN (2, 5, 3)
                AND account_ledger.ACTIVE = 1`;

			const [balanceResults] = await pool.execute(checkBalanceQuery, [txtAccountMarker]);
			const balance = balanceResults[0]?.balance || 0;

			if (balance < markerReturn) {
				return res.status(400).json({ error: 'Insufficient balance for this deposit transaction.' });
			}
		} else {
			if (markerReturn <= 0) {
				return res.status(400).json({ error: 'Marker return must be greater than zero for non-deposit transactions.' });
			}
		}

		await insertSettlementRecord();

		const agentQuery = `
            SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.ACTIVE = 1 AND account.IDNo = ?`;

		const [agentResults] = await pool.execute(agentQuery, [txtAccountMarker]);

		if (agentResults.length > 0) {
			const { AGENT_CODE: agentCode, NAME: agentName, TELEGRAM_ID: telegramId } = agentResults[0];
			let text;

			// Safely parse AgentBalance
			const currentBalance = parseFloat(AgentBalance.replace(/,/g, '')) - markerReturn;

			if (optTransType === '12') {
				text = `Demo Cage\n\n* 크레딧 리턴 *\n\n게임: ${agentCode} - ${agentName}\n금액: ${parseFloat(markerReturn).toLocaleString('en-US')} - 계좌출금\n잔고: ${parseFloat(currentBalance).toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
			} else {
				text = `Demo Cage\n\n* 크레딧 리턴 *\n\n게임: ${agentCode} - ${agentName}\n금액: ${parseFloat(markerReturn).toLocaleString('en-US')} - 현금\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;
			}

			const markerLogPreview = markerReturnTelegramLogPreview(optTransType, optReturnSource);
			const markerTelegramOpts = {
				logPreview: markerLogPreview,
				logMeta: {
					accountCode: agentCode,
					guestName: agentName,
					amount: Math.abs(Number(markerReturn) || 0)
				}
			};

			// Send to agent (only when TELEGRAM_ID exists)
			if (telegramId) {
				try {
					await sendTelegramMessage(text, telegramId, markerTelegramOpts);
				} catch (telegramError) {
					console.error('Failed to send Telegram message to agent:', telegramError.message);
				}
			} else {
				console.warn("No TELEGRAM_ID found for Account ID:", txtAccountMarker);
			}

			// Send to additional chats - always (even when guest has no TELEGRAM_ID)
			try {
				await sendTelegramToAdditionalChats(text, markerTelegramOpts);
			} catch (telegramError) {
				console.error('Failed to send Telegram message to additional chats:', telegramError.message);
			}
		} else {
			console.error("No AGENT_CODE or NAME found for Account ID:", txtAccountMarker);
		}

		res.json({ success: true, message: 'Marker Return saved successfully' });
	} catch (err) {
		console.error('Error:', err);
		res.status(500).json({ success: false, message: 'Error processing the transaction' });
	}

	async function insertSettlementRecord() {
		const returnSourceDesc = optReturnSource === 'credit' ? 'RETURN_SOURCE:CREDIT' : 'RETURN_SOURCE:BUYIN';
		const insertQuery = `
            INSERT INTO account_ledger (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, ENCODED_BY, ENCODED_DT, REMARKS, TRANSACTION_DESC) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

		await pool.execute(insertQuery, [txtAccountMarker, optTransType, 3, markerReturn, req.session.user_id, date_now, remarks || null, returnSourceDesc]);
	}
});

// GET MARKER TOTAL CREDITS ISSUE (for AJAX refresh after delete)
router.get('/marker_total_credits_issue', async (req, res) => {
	const sqlMarkerIssueGame = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_ISSUE_GAME FROM game_record WHERE ACTIVE=1 AND TRANSACTION=3 AND CAGE_TYPE=1';
	const sqlMarkerIssueAccount = `SELECT SUM(account_ledger.AMOUNT) AS TOTAL_ISSUE_RECORD FROM account_ledger JOIN account ON account.IDNo=account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo=account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_ID=3 AND account.ACTIVE=1 AND agent.ACTIVE=1`;
	const sqlNNChipsAccountMarker = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN_MARKER FROM game_record WHERE ACTIVE=1 AND CAGE_TYPE=2 AND TRANSACTION=3';
	const sqlMArkerReturnCash = `SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_CASH FROM account_ledger JOIN account ON account.IDNo=account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo=account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=3 AND account_ledger.TRANSACTION_ID=11 AND account.ACTIVE=1 AND agent.ACTIVE=1`;
	const sqlMArkerReturnDeposit = `SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_DEPOSIT FROM account_ledger JOIN account ON account.IDNo=account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo=account.AGENT_ID WHERE account_ledger.ACTIVE=1 AND account_ledger.TRANSACTION_TYPE=3 AND account_ledger.TRANSACTION_ID=12 AND account.ACTIVE=1 AND agent.ACTIVE=1`;
	const sqlChipsReturnMarker = `SELECT SUM(NN_CHIPS + CC_CHIPS) AS CHIPS_RETURN_MARKER FROM game_record WHERE CAGE_TYPE=2 AND TRANSACTION=4 AND ACTIVE=1`;

	try {
		const [[r1], [r2], [r3], [r4], [r5], [r6]] = await Promise.all([
			pool.execute(sqlMarkerIssueGame),
			pool.execute(sqlMarkerIssueAccount),
			pool.execute(sqlNNChipsAccountMarker),
			pool.execute(sqlMArkerReturnCash),
			pool.execute(sqlMArkerReturnDeposit),
			pool.execute(sqlChipsReturnMarker)
		]);
		const total = (parseFloat((r1[0] || {}).TOTAL_ISSUE_GAME) || 0) +
			(parseFloat((r2[0] || {}).TOTAL_ISSUE_RECORD) || 0) -
			(parseFloat((r3[0] || {}).TOTAL_NN_MARKER) || 0) -
			(parseFloat((r4[0] || {}).MARKER_RETURN_CASH) || 0) -
			(parseFloat((r5[0] || {}).MARKER_RETURN_DEPOSIT) || 0) -
			(parseFloat((r6[0] || {}).CHIPS_RETURN_MARKER) || 0);
		res.json({ total });
	} catch (err) {
		console.error('Error fetching marker total:', err);
		res.status(500).json({ total: 0 });
	}
});

// DELETE MARKER RECORD (soft delete) - Super Admin only
router.delete('/marker_record/:id', async (req, res) => {
	const permissions = req.session?.permissions;
	if (permissions !== 0) {
		return res.status(403).json({ success: false, message: 'Only Super Admin can delete marker records.' });
	}

	const id = parseInt(req.params.id);
	const date_now = new Date();

	try {
		const [rows] = await pool.execute(
			`SELECT IDNo, ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, ENCODED_DT 
			 FROM account_ledger 
			 WHERE IDNo = ? AND ACTIVE = 1 
			 AND (TRANSACTION_ID IN (3, 10, 11, 12) OR TRANSACTION_TYPE = 4)`,
			[id]
		);

		if (rows.length === 0) {
			return res.status(404).json({ success: false, message: 'Record not found or already deleted.' });
		}

		const rec = rows[0];
		const transId = parseInt(rec.TRANSACTION_ID, 10);
		const transType = parseInt(rec.TRANSACTION_TYPE, 10);
		const gameId = rec.GAME_ID;
		const accountId = rec.ACCOUNT_ID;
		const amount = parseFloat(rec.AMOUNT) || 0;
		const encodedDt = rec.ENCODED_DT;

		// 1. Always soft delete account_ledger
		await pool.execute(
			'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[req.session.user_id, date_now, id]
		);

		// 2. For Buy-in (TRANSACTION_ID 10): soft delete game_record (CAGE_TYPE 1 and 3)
		if (transId === 10 && gameId) {
			await pool.execute(
				`UPDATE game_record SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? 
				 WHERE GAME_ID = ? AND (NN_CHIPS + CC_CHIPS) = ? AND ENCODED_DT = ? AND CAGE_TYPE IN (1, 3) AND TRANSACTION = 3`,
				[req.session.user_id, date_now, gameId, amount, encodedDt]
			);
		}

		// 3. For Chips Return (TRANSACTION_TYPE 4): soft delete game_record (CAGE_TYPE 2, TRANSACTION 4)
		if (transType === 4 && transId === 1 && gameId) {
			await pool.execute(
				`UPDATE game_record SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? 
				 WHERE GAME_ID = ? AND (NN_CHIPS + CC_CHIPS) = ? AND CAGE_TYPE = 2 AND TRANSACTION = 4`,
				[req.session.user_id, date_now, gameId, amount, encodedDt]
			);
		}
		// If GAME_ID is NULL for chips return (legacy), only account_ledger is deleted

		res.json({ success: true, message: 'Record deleted successfully.' });
	} catch (err) {
		console.error('Error deleting marker record:', err);
		res.status(500).json({ success: false, message: 'Error deleting record.' });
	}
});

// PATCH MARKER REMARKS (account_ledger) — Super Admin only
router.patch('/marker_record/:id/remarks', async (req, res) => {
	const permissions = req.session?.permissions;
	if (permissions === 2) {
		return res.status(403).json({ success: false, message: 'Not authorized to edit remarks.' });
	}

	const id = parseInt(req.params.id, 10);
	if (isNaN(id)) {
		return res.status(400).json({ success: false, message: 'Invalid id.' });
	}

	let remarks = req.body && req.body.remarks != null ? String(req.body.remarks) : '';
	if (remarks.length > 500) remarks = remarks.slice(0, 500);
	const date_now = new Date();

	try {
		const [rows] = await pool.execute(
			`SELECT IDNo FROM account_ledger 
			 WHERE IDNo = ? AND ACTIVE = 1 
			 AND (TRANSACTION_ID IN (3, 10, 11, 12) OR TRANSACTION_TYPE = 4)`,
			[id]
		);

		if (rows.length === 0) {
			return res.status(404).json({ success: false, message: 'Record not found.' });
		}

		await pool.execute(
			'UPDATE account_ledger SET REMARKS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[remarks, req.session.user_id, date_now, id]
		);

		res.json({ success: true, message: 'Remarks updated.', remarks });
	} catch (err) {
		console.error('Error updating marker remarks:', err);
		res.status(500).json({ success: false, message: 'Error updating remarks.' });
	}
});

// GET MARKER HISTORY (all credit-related transactions, no filter)
router.get('/marker_history', async (req, res) => {
	const query = `
        SELECT account_ledger.*, 
       agent.NAME AS AGENT_NAME, 
       agent.AGENT_CODE AS AGENT_CODE,
       CONCAT(account_ledger.TRANSACTION_ID, '-', account_ledger.TRANSACTION_TYPE) AS TRANSACTION_INFO
		FROM account_ledger 
		JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID 
		JOIN agent ON agent.IDNo = account.AGENT_ID 
		WHERE account_ledger.ACTIVE = 1 
		AND (account_ledger.TRANSACTION_ID IN (3, 10, 11, 12) OR account_ledger.TRANSACTION_TYPE = 4)
		ORDER BY account_ledger.ENCODED_DT DESC, account_ledger.IDNo DESC`;

	try {
		const [results] = await pool.execute(query);
		res.json(results);
	} catch (err) {
		console.error('Error fetching marker history:', err);
		return res.status(500).json({ success: false, message: 'Error fetching marker history' });
	}
});

function coerceMarkerHistoryExportCell(raw) {
	if (raw == null || raw === '') return '';
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
	let s = String(raw).trim();
	s = s.replace(/^\u20B1\s*/, '').replace(/^PHP\s*/i, '').trim();
	if (/[a-zA-Z]/.test(s)) return s;
	if (/%/.test(s)) return s;
	const normalized = s.replace(/,/g, '');
	if (normalized === '' || normalized === '-' || normalized === '+') return s;
	if (!/^[-+]?(?:\d+\.\d+|\d+\.?|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)) return s;
	const n = Number(normalized);
	return Number.isFinite(n) ? n : s;
}

function sanitizeMarkerExportSheetName(raw) {
	if (raw == null || typeof raw !== 'string') return '';
	let s = raw.trim().replace(/[\]\[\\\/\?\*:]/g, '');
	if (s.length > 31) s = s.slice(0, 31);
	return s;
}

router.post('/marker_history/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename, sheetName } = req.body || {};
		if (!Array.isArray(headers) || headers.length === 0) {
			return res.status(400).json({ error: 'Invalid headers' });
		}
		if (!Array.isArray(rows)) {
			return res.status(400).json({ error: 'Invalid rows' });
		}
		const MAX_ROWS = 10000;
		if (rows.length > MAX_ROWS) {
			return res.status(400).json({ error: 'Too many rows' });
		}
		const ncol = headers.length;
		const thinBorder = {
			top: { style: 'thin', color: { argb: 'FF666666' } },
			left: { style: 'thin', color: { argb: 'FF666666' } },
			bottom: { style: 'thin', color: { argb: 'FF666666' } },
			right: { style: 'thin', color: { argb: 'FF666666' } }
		};

		const workbook = new ExcelJS.Workbook();
		const sheetTitle = sanitizeMarkerExportSheetName(sheetName) || 'Credit History';
		const ws = workbook.addWorksheet(sheetTitle, {
			views: [{ state: 'frozen', ySplit: 1 }]
		});

		const headerRow = ws.addRow(headers.map((h) => (h == null ? '' : String(h))));
		headerRow.height = 22;
		headerRow.eachCell((cell) => {
			cell.font = { bold: true };
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			cell.border = thinBorder;
			cell.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FFD9E1F2' }
			};
		});

		rows.forEach((r) => {
			const arr = Array.isArray(r) ? r : [];
			const padded = Array.from({ length: ncol }, (_, i) => {
				const v = arr[i];
				if (v == null || v === '') return '';
				return coerceMarkerHistoryExportCell(v);
			});
			const dataRow = ws.addRow(padded);
			dataRow.eachCell((cell) => {
				cell.border = thinBorder;
				cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			});
		});

		const colMaxLens = headers.map((h, c) => {
			let m = String(h == null ? '' : h).length;
			for (let ri = 0; ri < rows.length; ri++) {
				const row = rows[ri];
				if (!Array.isArray(row) || row[c] == null) continue;
				const L = String(row[c]).length;
				if (L > m) m = L;
			}
			return Math.min(48, Math.max(10, m + 2));
		});
		for (let i = 1; i <= ncol; i++) {
			const col = ws.getColumn(i);
			col.width = colMaxLens[i - 1];
			col.alignment = { horizontal: 'center', vertical: 'middle' };
		}

		applyCommaThousandsToNumericCells(ws);

		const buffer = await workbook.xlsx.writeBuffer();
		let outName = 'CreditHistory-export.xlsx';
		if (filename && typeof filename === 'string') {
			const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
			if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
			else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
		}
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('marker_history/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});


//START DASHBOARD RESET AND HISTORY

router.get("/dashboard_history", function (req, res) {
	const data = sessions(req, 'dashboard_history');
	data.permissions = req.session.permissions;
	res.render("dashboard/dashboard_history", data);
});


// Reset Main Cage Balances
router.post('/reset-main-cage-balance', async (req, res) => {
	try {
		const monthSettleId = req.body?.month_settle_id;
		const hasSettleId =
			monthSettleId !== undefined && monthSettleId !== null && monthSettleId !== '';

		// Update all tables to mark records as settled (RESET = 0)
		// Only update active records that are currently unsettled (RESET = 1)
		// Kung may month_settle_id (galing sa /insert-dash-history), i-tag ang rows para sa undo
		// await pool.execute(`UPDATE junket_house_expense SET RESET = 0 WHERE RESET = 1 AND ACTIVE = 1`);
		if (hasSettleId) {
			await pool.execute(
				`UPDATE game_record SET RESET = 0, MONTH_SETTLE_ID = ? WHERE RESET = 1 AND ACTIVE = 1`,
				[monthSettleId]
			);
			await pool.execute(
				`UPDATE junket_total_chips
				 SET RESET = 0, MONTH_SETTLE_ID = ?
				 WHERE RESET = 1 AND ACTIVE = 1 AND TRANSACTION_ID <> 4`,
				[monthSettleId]
			);
		} else {
			await pool.execute(`UPDATE game_record SET RESET = 0 WHERE RESET = 1 AND ACTIVE = 1`);
			await pool.execute(`UPDATE junket_total_chips SET RESET = 0 WHERE RESET = 1 AND ACTIVE = 1 AND TRANSACTION_ID <> 4`);
		}
		// await pool.execute(`UPDATE winloss SET RESET = 0 WHERE RESET = 1 AND ACTIVE = 1`);
		// await pool.execute(`UPDATE total_rolling SET RESET = 0 WHERE RESET = 1 AND ACTIVE = 1`);

		res.json({ success: true });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Failed to reset main cage balance' });
	}
});

// Pre-check: can user settle? (for sidebar - show error on click before confirmation)
router.get('/monthly-settle-check', async (req, res) => {
	try {
		const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
		const today = new Date();
		const todayStr = today.toISOString().slice(0, 10);

		const [lastSettle] = await pool.execute(
			'SELECT period_end FROM month_settle WHERE active = 1 ORDER BY period_end DESC LIMIT 1'
		);

		let periodStartStr, periodEndStr, periodLabel;
		if (!lastSettle || lastSettle.length === 0) {
			const y = today.getFullYear(), m = today.getMonth();
			const prevY = m === 0 ? y - 1 : y, prevM = m === 0 ? 11 : m - 1;
			const lastDay = new Date(prevY, prevM + 1, 0).getDate();
			periodStartStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-01`;
			periodEndStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
			periodLabel = `${monthNames[prevM]} ${prevY}`;
		} else {
			const lastEnd = new Date(lastSettle[0].period_end);
			const nextY = lastEnd.getFullYear(), nextM = lastEnd.getMonth() + 1;
			const nextYear = nextM > 11 ? nextY + 1 : nextY, nextMonth = nextM > 11 ? 0 : nextM;
			const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();
			periodStartStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`;
			periodEndStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
			periodLabel = `${monthNames[nextMonth]} ${nextYear}`;
		}

		if (periodEndStr > todayStr) {
			return res.json({ canSettle: false, message: `Cannot settle ${periodLabel} yet - month has not ended.` });
		}
		const [existing] = await pool.execute(
			'SELECT id FROM month_settle WHERE active = 1 AND period_start = ? AND period_end = ? LIMIT 1',
			[periodStartStr, periodEndStr]
		);
		if (existing && existing.length > 0) {
			return res.json({ canSettle: false, message: `${periodLabel} has already been settled.` });
		}
		res.json({ canSettle: true, periodLabel });
	} catch (err) {
		console.error('monthly-settle-check:', err);
		res.status(500).json({ canSettle: false, message: 'Unable to check settle status.' });
	}
});

router.post('/dashboard/wl_share_percentage', superAdminOnly, async (req, res) => {
	try {
		const monthKey = String(req.body?.month || '').trim();
		const sharePercentage = normalizeSharePercentage(req.body?.share_percentage);

		if (!isValidMonthKey(monthKey)) {
			return res.status(400).json({ success: false, error: 'Invalid month' });
		}
		if (sharePercentage == null) {
			return res.status(400).json({ success: false, error: 'Share percentage must be between 0 and 100' });
		}

		const userId = req.session.user_id || null;
		await upsertDashboardWlSharePct(pool, monthKey, sharePercentage, userId);

		res.json({
			success: true,
			month: monthKey,
			share_percentage: sharePercentage
		});
	} catch (err) {
		console.error('dashboard/wl_share_percentage:', err);
		res.status(500).json({ success: false, error: 'Error saving W/L rate' });
	}
});

// Insert Dashboard History
router.post('/insert-dash-history', async (req, res) => {
	const {
		EXPENSE_HISTORY,
		TOTAL_ROLLING_HISTORY,
		HOUSE_ROLLING_HISTORY,
		WINLOSS_HISTORY,
		COMMISSION_HISTORY,
		NN_CASHOUT,
		CC_CASHOUT,
	} = req.body;

	const date_now = new Date();
	const normalizeNumber = (value) => {
		if (value === undefined || value === null || value === '') return 0;
		const num = Number(value);
		return Number.isFinite(num) ? num : 0;
	};

	// Determine period to settle: month AFTER last settlement (basta check last settlement date)
	const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const today = new Date();
	const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

	let periodStartStr, periodEndStr, periodLabel;

	const [lastSettle] = await pool.execute(
		'SELECT period_end FROM month_settle WHERE active = 1 ORDER BY period_end DESC LIMIT 1'
	);

	if (!lastSettle || lastSettle.length === 0) {
		// Walang settle pa: settle previous month
		const y = today.getFullYear();
		const m = today.getMonth();
		const prevY = m === 0 ? y - 1 : y;
		const prevM = m === 0 ? 11 : m - 1;
		const lastDay = new Date(prevY, prevM + 1, 0).getDate();
		periodStartStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-01`;
		periodEndStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
		periodLabel = `${monthNames[prevM]} ${prevY}`;
	} else {
		// May last settle: next = month after period_end
		const lastEnd = new Date(lastSettle[0].period_end);
		const nextY = lastEnd.getFullYear();
		const nextM = lastEnd.getMonth() + 1; // 0-indexed, so +1 = next month
		const nextYear = nextM > 11 ? nextY + 1 : nextY;
		const nextMonth = nextM > 11 ? 0 : nextM;
		const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();
		periodStartStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-01`;
		periodEndStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
		periodLabel = `${monthNames[nextMonth]} ${nextYear}`;
	}

	// Hindi pwedeng mag-settle ng future month (period dapat tapos na o current)
	if (periodEndStr > todayStr) {
		return res.status(400).json({
			success: false,
			message: `Cannot settle ${periodLabel} yet - month has not ended.`
		});
	}

	// Check kung na-settle na ang period na yan
	const [existing] = await pool.execute(
		'SELECT id FROM month_settle WHERE active = 1 AND period_start = ? AND period_end = ? LIMIT 1',
		[periodStartStr, periodEndStr]
	);
	if (existing && existing.length > 0) {
		return res.status(400).json({
			success: false,
			message: `${periodLabel} has already been settled.`
		});
	}

	let connection;
	try {
		connection = await pool.getConnection();
		await connection.beginTransaction();

		const chipsCashoutDesc = '<span class="css-red">Monthly Settle</span>';
		const nnCashout = normalizeNumber(NN_CASHOUT);
		const ccCashout = normalizeNumber(CC_CASHOUT);
		const totalChipsCashout = nnCashout + ccCashout;

		// Upsert-style settle by period:
		// - if inactive row exists for same period, reactivate/update it (para di tumama sa uq_period)
		// - else insert new row
		let monthSettleId;
		const [periodRows] = await connection.execute(
			`SELECT id, active
			 FROM month_settle
			 WHERE period_start = ? AND period_end = ?
			 LIMIT 1
			 FOR UPDATE`,
			[periodStartStr, periodEndStr]
		);

		if (periodRows && periodRows.length > 0) {
			const existingRow = periodRows[0];
			if (Number(existingRow.active) === 1) {
				throw new Error(`${periodLabel} has already been settled.`);
			}

			monthSettleId = Number(existingRow.id);
			await connection.execute(
				`UPDATE month_settle
				 SET
					active = 1,
					period_label = ?,
					nn_cashout = ?,
					cc_cashout = ?,
					total_rolling_history = ?,
					house_rolling_history = ?,
					winloss_history = ?,
					commission_history = ?,
					encoded_by = ?,
					encoded_dt = ?,
					edited_by = NULL,
					edited_dt = NULL
				 WHERE id = ?`,
				[
					periodLabel,
					nnCashout,
					ccCashout,
					normalizeNumber(TOTAL_ROLLING_HISTORY),
					normalizeNumber(HOUSE_ROLLING_HISTORY),
					normalizeNumber(WINLOSS_HISTORY),
					normalizeNumber(COMMISSION_HISTORY),
					req.session.user_id,
					date_now,
					monthSettleId
				]
			);
		} else {
			const [monthSettleResult] = await connection.execute(
				`INSERT INTO month_settle (period_start, period_end, period_label, nn_cashout, cc_cashout, total_rolling_history, house_rolling_history, winloss_history, commission_history, encoded_by, encoded_dt)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					periodStartStr,
					periodEndStr,
					periodLabel,
					nnCashout,
					ccCashout,
					normalizeNumber(TOTAL_ROLLING_HISTORY),
					normalizeNumber(HOUSE_ROLLING_HISTORY),
					normalizeNumber(WINLOSS_HISTORY),
					normalizeNumber(COMMISSION_HISTORY),
					req.session.user_id,
					date_now
				]
			);
			monthSettleId = monthSettleResult.insertId;
		}

		// Insert junket_total_chips as Chips Cashout (TRANSACTION_ID=4, RESET=0) — naka-link sa settlement batch
		await connection.execute(
			'INSERT INTO junket_total_chips(TRANSACTION_ID, DESCRIPTION, NN_CHIPS, CC_CHIPS, TOTAL_CHIPS, RESET, MONTH_SETTLE_ID, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
			[4, chipsCashoutDesc, nnCashout, ccCashout, totalChipsCashout, monthSettleId, req.session.user_id, date_now]
		);

		// Insert dash_history
		await connection.execute(
			`INSERT INTO dash_history (TOTAL_ROLLING_HISTORY, HOUSE_ROLLING_HISTORY, WINLOSS_HISTORY, COMMISSION_HISTORY, NN_CASHOUT, CC_CASHOUT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				normalizeNumber(TOTAL_ROLLING_HISTORY),
				normalizeNumber(HOUSE_ROLLING_HISTORY),
				normalizeNumber(WINLOSS_HISTORY),
				normalizeNumber(COMMISSION_HISTORY),
				nnCashout,
				ccCashout,
				req.session.user_id,
				date_now
			]
		);

		await connection.commit();
		res.json({ success: true, month_settle_id: monthSettleId });
	} catch (err) {
		if (connection) await connection.rollback();
		console.error('Error inserting data into dash_history', err);
		if (err && typeof err.message === 'string' && err.message.includes('has already been settled')) {
			return res.status(400).json({ success: false, message: err.message });
		}
		res.status(500).json({ success: false, message: 'Error inserting data into dash_history' });
	} finally {
		if (connection) connection.release();
	}
});



// Get Dashboard History (from month_settle - Monthly Settle data with Period Label)
router.get('/get-dashboard-history', async (req, res) => {
	const query = `
		SELECT 
			ms.id AS MONTH_SETTLE_ID,
			CASE 
				WHEN ms.id = (
					SELECT msl.id
					FROM month_settle msl
					WHERE msl.active = 1
					ORDER BY msl.encoded_dt DESC, msl.id DESC
					LIMIT 1
				) THEN 1
				ELSE 0
			END AS IS_LATEST_SETTLE,
			ms.period_label AS PERIOD_LABEL,
			ms.encoded_dt AS ENCODED_DT,
			ms.commission_history AS COMMISSION_HISTORY,
			ms.total_rolling_history AS TOTAL_ROLLING_HISTORY,
			ms.house_rolling_history AS HOUSE_ROLLING_HISTORY,
			ms.winloss_history AS WINLOSS_HISTORY,
			ms.nn_cashout AS NN_CASHOUT,
			ms.cc_cashout AS CC_CASHOUT,
			user_info.FIRSTNAME AS FIRSTNAME
		FROM month_settle ms
		JOIN user_info ON user_info.IDNo = ms.encoded_by
		WHERE ms.active = 1
		ORDER BY ms.encoded_dt DESC
	`;

	try {
		const [results] = await pool.execute(query);
		res.json(results);
	} catch (err) {
		console.error('Error fetching dashboard history data', err);
		res.status(500).json({ error: 'Error fetching data' });
	}
});

// Soft undo for one monthly settle batch
router.post('/undo-month-settle', async (req, res) => {
	const monthSettleId = Number(req.body?.month_settle_id);
	if (!Number.isInteger(monthSettleId) || monthSettleId <= 0) {
		return res.status(400).json({ success: false, message: 'Invalid month_settle_id' });
	}

	let connection;
	try {
		connection = await pool.getConnection();
		await connection.beginTransaction();

		const [settleRows] = await connection.execute(
			'SELECT id, active FROM month_settle WHERE id = ? LIMIT 1',
			[monthSettleId]
		);
		if (!settleRows || settleRows.length === 0) {
			await connection.rollback();
			return res.status(404).json({ success: false, message: 'Monthly settle record not found' });
		}
		if (Number(settleRows[0].active) === 0) {
			await connection.rollback();
			return res.status(400).json({ success: false, message: 'Monthly settle is already undone' });
		}
		const [latestRows] = await connection.execute(
			`SELECT id
			 FROM month_settle
			 WHERE active = 1
			 ORDER BY encoded_dt DESC, id DESC
			 LIMIT 1`
		);
		if (!latestRows || latestRows.length === 0 || Number(latestRows[0].id) !== monthSettleId) {
			await connection.rollback();
			return res.status(400).json({
				success: false,
				message: 'Only the latest monthly settle can be undone'
			});
		}

		// Re-open only rows linked to this specific settlement batch
		await connection.execute(
			`UPDATE game_record
			 SET RESET = 1, MONTH_SETTLE_ID = NULL
			 WHERE MONTH_SETTLE_ID = ? AND ACTIVE = 1`,
			[monthSettleId]
		);
		await connection.execute(
			`UPDATE junket_total_chips
			 SET RESET = 1, MONTH_SETTLE_ID = NULL
			 WHERE MONTH_SETTLE_ID = ? AND ACTIVE = 1 AND TRANSACTION_ID <> 4`,
			[monthSettleId]
		);
		await connection.execute(
			`UPDATE junket_total_chips
			 SET ACTIVE = 0, RESET = 1, MONTH_SETTLE_ID = NULL
			 WHERE MONTH_SETTLE_ID = ? AND ACTIVE = 1 AND TRANSACTION_ID = 4`,
			[monthSettleId]
		);

		// Soft delete month_settle itself
		await connection.execute(
			`UPDATE month_settle
			 SET active = 0, edited_by = ?, edited_dt = ?
			 WHERE id = ?`,
			[req.session.user_id, new Date(), monthSettleId]
		);

		await connection.commit();
		return res.json({ success: true });
	} catch (err) {
		if (connection) await connection.rollback();
		console.error('Error undoing monthly settle', err);
		return res.status(500).json({ success: false, message: 'Error undoing monthly settle' });
	} finally {
		if (connection) connection.release();
	}
});



// 	ACTIVITY LOGS - MOVED TO routes/activity_log.js
  


  


router.get('/get_winloss', async (req, res) => {
	const range = req.query.range;
	const weekOffset = req.query.weekOffset || 0; // Add support for week offset

	let totalCondition = '';
	let groupCondition = '';
	let groupBy = '';
	let labels = [];
	let groupKeys = [];
	
	// For comparison with previous period
	let prevTotalCondition = '';
	let prevGroupCondition = '';

	const currentYear = new Date().getFullYear();
	const currentMonth = new Date().getMonth(); // 0-based

	const offset = parseInt(req.query.offset) || 0;
	const isCurrentPeriod = offset === 0;

	let targetYearWeek = '';

	if (range === 'week') {
		const targetDate = new Date();
		targetDate.setDate(targetDate.getDate() + (offset * 7));
		const isoDate = targetDate.toISOString().slice(0, 10);
		targetYearWeek = `YEARWEEK('${isoDate}', 1)`;
		
		const prevDate = new Date(targetDate);
		prevDate.setDate(prevDate.getDate() - 7);
		const prevIsoDate = prevDate.toISOString().slice(0, 10);
		const prevYearWeek = `YEARWEEK('${prevIsoDate}', 1)`;

		totalCondition = `AND YEARWEEK(game_list.PROGRAM_DATE, 1) = ${targetYearWeek}`;
		groupCondition = totalCondition;
		prevTotalCondition = `AND YEARWEEK(game_list.PROGRAM_DATE, 1) = ${prevYearWeek}`;
		prevGroupCondition = prevTotalCondition;
		groupBy = 'DAYOFWEEK(game_list.PROGRAM_DATE)';
		labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
		groupKeys = [2, 3, 4, 5, 6, 7, 1];
	} else if (range === 'month') {
		totalCondition = `AND MONTH(game_list.PROGRAM_DATE) = ${currentMonth + 1} AND YEAR(game_list.PROGRAM_DATE) = ${currentYear}`;
		groupCondition = `AND YEAR(game_list.PROGRAM_DATE) = ${currentYear}`;
		prevTotalCondition = `AND MONTH(game_list.PROGRAM_DATE) = ${currentMonth} AND YEAR(game_list.PROGRAM_DATE) = ${currentYear}`;
		prevGroupCondition = `AND YEAR(game_list.PROGRAM_DATE) = ${currentYear}`;
		groupBy = 'MONTH(game_list.PROGRAM_DATE)';
		labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		groupKeys = Array.from({ length: 12 }, (_, i) => i + 1);
	} else if (range === 'year') {
		const startYear = currentYear - 5;
		const endYear = currentYear;
		totalCondition = `AND YEAR(game_list.PROGRAM_DATE) = ${currentYear}`;
		groupCondition = `AND YEAR(game_list.PROGRAM_DATE) BETWEEN ${startYear} AND ${endYear}`;
		prevTotalCondition = `AND YEAR(game_list.PROGRAM_DATE) = ${currentYear - 1}`;
		prevGroupCondition = `AND YEAR(game_list.PROGRAM_DATE) BETWEEN ${startYear - 1} AND ${endYear - 1}`;
		groupBy = 'YEAR(game_list.PROGRAM_DATE)';
		labels = Array.from({ length: 6 }, (_, i) => `${startYear + i}`);
		groupKeys = labels.map(Number);
	} else {
		return res.status(400).json({ message: 'Invalid range' });
	}

	const totalQuery = `
		SELECT
			SUM(CASE WHEN game_record.CAGE_TYPE = 1 THEN (game_record.NN_CHIPS + game_record.CC_CHIPS) ELSE 0 END) AS cashin,
			SUM(CASE WHEN game_record.CAGE_TYPE = 2 THEN (game_record.NN_CHIPS + game_record.CC_CHIPS) ELSE 0 END) AS cashout
		FROM game_record
		JOIN game_list ON game_record.GAME_ID = game_list.IDNo
		WHERE game_record.ACTIVE = 1
			AND game_list.ACTIVE != 0
			${totalCondition}
	`;
	
	const prevTotalQuery = `
		SELECT
			SUM(CASE WHEN game_record.CAGE_TYPE = 1 THEN (game_record.NN_CHIPS + game_record.CC_CHIPS) ELSE 0 END) AS cashin,
			SUM(CASE WHEN game_record.CAGE_TYPE = 2 THEN (game_record.NN_CHIPS + game_record.CC_CHIPS) ELSE 0 END) AS cashout
		FROM game_record
		JOIN game_list ON game_record.GAME_ID = game_list.IDNo
		WHERE game_record.ACTIVE = 1
			AND game_list.ACTIVE != 0
			${prevTotalCondition}
	`;

	const chartQuery = `
		SELECT 
			${groupBy} AS label,
			SUM(CASE WHEN game_record.CAGE_TYPE = 1 THEN (game_record.NN_CHIPS + game_record.CC_CHIPS) ELSE 0 END) AS cashin,
			SUM(CASE WHEN game_record.CAGE_TYPE = 2 THEN (game_record.NN_CHIPS + game_record.CC_CHIPS) ELSE 0 END) AS cashout
		FROM game_record
		JOIN game_list ON game_record.GAME_ID = game_list.IDNo
		WHERE game_record.ACTIVE = 1
			AND game_list.ACTIVE != 0
			${groupCondition}
		GROUP BY ${groupBy}
		ORDER BY ${groupBy}
	`;

	try {
		const [totalResult] = await pool.execute(totalQuery);
		const totalCashin = totalResult[0]?.cashin || 0;
		const totalCashout = totalResult[0]?.cashout || 0;
		const totalWinloss = totalCashin - totalCashout;
		
		// Get previous period data
		const [prevTotalResult] = await pool.execute(prevTotalQuery);
		const prevTotalCashin = prevTotalResult[0]?.cashin || 0;
		const prevTotalCashout = prevTotalResult[0]?.cashout || 0;
		const prevTotalWinloss = prevTotalCashin - prevTotalCashout;
		
		// Calculate percentage change
		const percentChange = prevTotalWinloss !== 0 
			? ((totalWinloss - prevTotalWinloss) / Math.abs(prevTotalWinloss)) * 100 
			: 0;

		const [chartResult] = await pool.execute(chartQuery);
		const dataMap = {};
		chartResult.forEach(row => {
			dataMap[row.label] = {
				cashin: row.cashin || 0,
				cashout: row.cashout || 0
			};
		});

		const net = groupKeys.map(key => {
			const record = dataMap[key] || { cashin: 0, cashout: 0 };
			return record.cashin - record.cashout;
		});

		res.json({
			winloss: totalWinloss,
			prevWinloss: prevTotalWinloss,
			percentChange: percentChange,
			chart: {
				data: net,
				labels
			}
		});
	} catch (err) {
		console.error("Error in get_winloss route:", err);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});


// GET WIN/LOSS DETAILS BY PROGRAM DATE
router.get('/get_winloss_settlement_details', async (req, res) => {
	const startDate = req.query.start_date;
	const endDate = req.query.end_date;

	if (!startDate || !endDate) {
		return res.status(400).json({ error: 'Start date and end date are required' });
	}

	try {
		const programDateQuery = `
			SELECT 
				game_list.PROGRAM_DATE AS program_date,
				SUM(CASE WHEN game_record.CAGE_TYPE = 1 THEN (game_record.NN_CHIPS + game_record.CC_CHIPS) ELSE 0 END) AS cashin,
				SUM(CASE WHEN game_record.CAGE_TYPE = 2 THEN (game_record.NN_CHIPS + game_record.CC_CHIPS) ELSE 0 END) AS cashout
			FROM game_list
			JOIN game_record ON game_list.IDNo = game_record.GAME_ID
			WHERE game_record.ACTIVE = 1
				AND game_list.ACTIVE != 0
				AND DATE(game_list.PROGRAM_DATE) BETWEEN ? AND ?
			GROUP BY game_list.PROGRAM_DATE
			ORDER BY game_list.PROGRAM_DATE DESC
		`;

		const [results] = await pool.execute(programDateQuery, [startDate, endDate]);
		res.json(results);
	} catch (err) {
		console.error("Error in get_winloss_settlement_details route:", err);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

function pad2(n) {
	return String(n).padStart(2, '0');
}

function isoDateOnly(d) {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function listDatesInclusive(fromStr, toStr) {
	const dates = [];
	const start = new Date(`${fromStr}T00:00:00`);
	const end = new Date(`${toStr}T00:00:00`);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return dates;
	for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
		dates.push(isoDateOnly(d));
	}
	return dates;
}

router.get('/dashboard_house_balances', checkSession, async (req, res) => {
	try {
		const balances = await dashboardQueries.computeHouseBalance();
		res.json(balances);
	} catch (err) {
		console.error('dashboard_house_balances:', err);
		res.status(500).json({ message: 'Error loading house balances.' });
	}
});

router.get('/dashboard/service_expense_balances', checkSession, async (req, res) => {
	try {
		const [depositRows] = await pool.execute(`
			SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
			FROM game_services
			WHERE ACTIVE = 1 AND TRANSACTION_ID = 2 AND SOURCE_TYPE = 'JUNKET'
			GROUP BY SERVICE_TYPE
		`);
		const [cashRows] = await pool.execute(`
			SELECT SERVICE_TYPE, SUM(AMOUNT) AS TOTAL
			FROM game_services
			WHERE ACTIVE = 1 AND TRANSACTION_ID = 1 AND SOURCE_TYPE = 'JUNKET'
			GROUP BY SERVICE_TYPE
		`);
		res.json(categorizeJunketExpenseTotals(cashRows || [], depositRows || []));
	} catch (err) {
		console.error('dashboard/service_expense_balances:', err);
		res.status(500).json({ error: 'Failed to load service expense balances.' });
	}
});

router.get('/dashboard_grid_data', checkSession, async (req, res) => {
	try {
		const now = new Date();
		const defaultFrom = isoDateOnly(new Date(now.getFullYear(), now.getMonth(), 1));
		const defaultTo = isoDateOnly(new Date(now.getFullYear(), now.getMonth() + 1, 0));
		const dateFrom = String(req.query.date_from || defaultFrom).trim();
		const dateTo = String(req.query.date_to || defaultTo).trim();

		const [tableRows] = await pool.execute(
			`SELECT IDNo AS id, TABLE_NAME AS table_name
			 FROM junket_tables WHERE ACTIVE = 1 ORDER BY IDNo ASC`
		);

		const [chipsRows] = await pool.execute(
			`SELECT
				DATE_FORMAT(j.ENCODED_DT, '%Y-%m-%d') AS report_date,
				SUM(CASE WHEN j.TRANSACTION_ID = 1 THEN COALESCE(j.NN_CHIPS, 0) ELSE 0 END) AS buy_in,
				SUM(CASE WHEN j.TRANSACTION_ID = 2 THEN COALESCE(j.NN_CHIPS, 0) ELSE 0 END) AS cash_out,
				SUM(CASE WHEN j.TRANSACTION_ID = 3 THEN COALESCE(j.CC_CHIPS, 0) ELSE 0 END) AS rolling
			 FROM junket_total_chips j
			 WHERE j.ACTIVE = 1
				AND j.ENCODED_DT IS NOT NULL
				AND DATE(j.ENCODED_DT) BETWEEN ? AND ?
			 GROUP BY DATE(j.ENCODED_DT)
			 ORDER BY DATE(j.ENCODED_DT) ASC`,
			[dateFrom, dateTo]
		);

		const [dailyRows] = await pool.execute(
			`SELECT
				DATE_FORMAT(dtr.REPORT_DATE, '%Y-%m-%d') AS report_date,
				jt.IDNo AS junket_table_id,
				jt.TABLE_NAME AS table_name,
				dtr.ROLLING_AMT AS rolling_amt,
				dtr.WINLOSS_AMT AS winloss_amt
			 FROM daily_table_reports dtr
			 INNER JOIN junket_tables jt ON jt.IDNo = dtr.JUNKET_TABLE_ID
			 WHERE dtr.ACTIVE = 1
				AND dtr.REPORT_DATE BETWEEN ? AND ?
			 ORDER BY dtr.REPORT_DATE ASC, jt.IDNo ASC`,
			[dateFrom, dateTo]
		);

		const chipsByDate = {};
		(chipsRows || []).forEach((row) => {
			chipsByDate[row.report_date] = row;
		});

		const dailyByDateTable = {};
		(dailyRows || []).forEach((row) => {
			if (!dailyByDateTable[row.report_date]) dailyByDateTable[row.report_date] = {};
			dailyByDateTable[row.report_date][row.junket_table_id] = row;
		});

		const casinoTable = (tableRows || []).find((t) => /casino/i.test(t.table_name)) || tableRows?.[0];
		const goldTable = (tableRows || []).find((t) => /gold\s*dragon/i.test(t.table_name))
			|| (tableRows && tableRows.length > 1 ? tableRows[1] : null);

		const rollingRows = [];
		const wlRows = [];
		let totalBuyIn = 0;
		let totalCashOut = 0;
		let totalRolling = 0;
		let totalBeyond = 0;
		let totalCasinoWl = 0;
		let totalGoldWl = 0;

		listDatesInclusive(dateFrom, dateTo).forEach((date) => {
			const chips = chipsByDate[date] || {};
			const buyIn = Number(chips.buy_in) || 0;
			const cashOut = Number(chips.cash_out) || 0;
			const rolling = Number(chips.rolling) || 0;

			const dayTables = dailyByDateTable[date] || {};
			const goldRow = goldTable ? dayTables[goldTable.id] : null;
			const beyond = goldRow ? Number(goldRow.rolling_amt) || 0 : 0;

			const casinoWl = buyIn - cashOut;
			const goldWl = goldRow ? Number(goldRow.winloss_amt) || 0 : casinoWl;

			rollingRows.push({
				date,
				buy_in: buyIn,
				cash_out: cashOut,
				rolling,
				beyond_chips: beyond
			});

			wlRows.push({
				date,
				casino: casinoWl,
				gold_dragon: goldWl
			});

			totalBuyIn += buyIn;
			totalCashOut += cashOut;
			totalRolling += rolling;
			totalBeyond += beyond;
			totalCasinoWl += casinoWl;
			totalGoldWl += goldWl;
		});

		const [onGameRows] = await pool.execute(
			`SELECT
				gl.IDNo AS game_id,
				account.IDNo AS account_id,
				gl.GAME_TYPE,
				agent.AGENT_CODE AS agent_code,
				agent.NAME AS agent_name,
				COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS guest_name,
				gr.CAGE_TYPE,
				gr.NN_CHIPS,
				gr.CC_CHIPS,
				gr.AMOUNT,
				gr.ROLLER_NN_CHIPS,
				gr.ROLLER_CC_CHIPS,
				gr.ROLLER_TRANSACTION
			 FROM game_list gl
			 INNER JOIN account ON gl.ACCOUNT_ID = account.IDNo
			 INNER JOIN agent ON agent.IDNo = account.AGENT_ID
			 LEFT JOIN guest g ON g.IDNo = gl.GUEST_ID
			 LEFT JOIN game_record gr ON gr.GAME_ID = gl.IDNo AND gr.ACTIVE = 1
			 WHERE gl.ACTIVE = 2
			 ORDER BY gl.IDNo ASC, gr.IDNo ASC`
		);

		let onGameBuyIn = 0;
		let onGameCashOut = 0;
		let onGameRolling = 0;
		const onGameMap = new Map();
		(onGameRows || []).forEach((r) => {
			const gameId = r.game_id;
			if (!onGameMap.has(gameId)) {
				onGameMap.set(gameId, {
					game_id: gameId,
					account_id: r.account_id,
					agent_code: r.agent_code || '',
					agent_name: r.agent_name || '',
					guest_name: r.guest_name || '-',
					game_type: r.GAME_TYPE || '',
					total_nn_init: 0,
					total_cc_init: 0,
					total_nn: 0,
					total_cc: 0,
					total_cash_out_nn: 0,
					total_cash_out_cc: 0,
					total_rolling_nn: 0,
					total_rolling_cc: 0,
					total_rolling_amount: 0,
					total_rolling_real: 0,
					total_rolling_nn_real: 0,
					total_rolling_cc_real: 0,
					total_roller_nn: 0,
					total_roller_cc: 0,
					total_roller_return_cc: 0
				});
			}

			const game = onGameMap.get(gameId);
			const ct = Number(r.CAGE_TYPE);
			const nn = Number(r.NN_CHIPS) || 0;
			const cc = Number(r.CC_CHIPS) || 0;
			const amt = Number(r.AMOUNT) || 0;

			if (ct === 1 && (game.total_nn_init !== 0 || game.total_cc_init !== 0)) {
				game.total_nn += nn;
				game.total_cc += cc;
			}
			if (ct === 1 && game.total_nn_init === 0 && game.total_cc_init === 0) {
				game.total_nn_init += nn;
				game.total_cc_init += cc;
			}
			if (ct === 2) {
				game.total_cash_out_nn += nn;
				game.total_cash_out_cc += cc;
			}
			if (ct === 3) {
				game.total_rolling_amount += amt;
				game.total_rolling_nn += nn;
				game.total_rolling_cc += cc;
			}
			if (ct === 4) {
				game.total_rolling_real += amt;
				game.total_rolling_nn_real += nn;
				game.total_rolling_cc_real += cc;
			}
			if (ct === 5 && (parseInt(r.ROLLER_TRANSACTION, 10) || 1) === 2) {
				game.total_roller_nn -= Number(r.ROLLER_NN_CHIPS) || 0;
				game.total_roller_cc -= Number(r.ROLLER_CC_CHIPS) || 0;
				game.total_roller_return_cc += Number(r.ROLLER_CC_CHIPS) || 0;
			} else if (ct === 5) {
				game.total_roller_nn += Number(r.ROLLER_NN_CHIPS) || 0;
				game.total_roller_cc += Number(r.ROLLER_CC_CHIPS) || 0;
			}
		});

		const onGameDetails = Array.from(onGameMap.values()).map((game) => {
			const totalInitial = game.total_nn_init + game.total_cc_init;
			const totalBuyInChips = game.total_nn + game.total_cc;
			const totalCashOutChips = game.total_cash_out_nn + game.total_cash_out_cc;
			const totalRollingChips =
				game.total_rolling_nn +
				game.total_roller_return_cc +
				game.total_rolling_amount +
				game.total_rolling_real +
				game.total_rolling_nn_real +
				game.total_rolling_cc_real -
				game.total_cash_out_nn;
			const totalRollerChips = game.total_roller_nn + game.total_roller_cc;
			const totalBuyIn = totalInitial + totalBuyInChips;
			const totalCashOut = totalCashOutChips;

			const detail = {
				game_id: game.game_id,
				account_id: game.account_id,
				agent_code: game.agent_code,
				agent_name: game.agent_name,
				guest_name: game.guest_name,
				game_type: game.game_type,
				buy_in: totalBuyIn,
				cash_out: totalCashOut,
				win_loss: totalBuyIn - totalCashOut,
				rolling: totalRollingChips,
				roller_chips: totalRollerChips
			};

			onGameBuyIn += detail.buy_in;
			onGameCashOut += detail.cash_out;
			onGameRolling += detail.rolling;

			return detail;
		});

		res.json({
			date_from: dateFrom,
			date_to: dateTo,
			tables: tableRows || [],
			rolling_rows: rollingRows,
			wl_rows: wlRows,
			totals: {
				buy_in: totalBuyIn,
				cash_out: totalCashOut,
				rolling: totalRolling,
				beyond_chips: totalBeyond,
				wl_total: totalCasinoWl,
				casino_wl: totalCasinoWl,
				gold_dragon_wl: totalGoldWl
			},
			on_game: {
				game_count: onGameDetails.length,
				buy_in: onGameBuyIn,
				cash_out: onGameCashOut,
				rolling: onGameRolling,
				games: onGameDetails
			}
		});
	} catch (err) {
		console.error('dashboard_grid_data:', err);
		res.status(500).json({ message: 'Error loading dashboard grid data.' });
	}
});

module.exports = router;