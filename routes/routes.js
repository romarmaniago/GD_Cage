const express = require('express');
const pageRouter = express.Router();
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const ExcelJS = require('exceljs');
const { applyCommaThousandsToNumericCells } = require('../utils/excelAmountFormat');

const mysql2 = require('mysql2/promise');
const pool = require('../config/db.js');
const dashboardQueries = require('../utils/dashboardQueries');

const bodyParser = require('body-parser');

const multer = require('multer');

const app = express();
const compression = require('compression');

const TelegramBot = require('node-telegram-bot-api');
const { sendTelegramToAdditionalChats, sendTelegramMessage } = require('../utils/telegram');
const { markerReturnTelegramLogPreview } = require('../utils/telegramSendLog');
const { allocateMarkerReturn, getMarkerReturnSourceDesc, getMarkerSourceBalances } = require('../utils/markerReturnAllocation');


app.use(bodyParser.urlencoded({
	extended: true
}));

// Wrapper object to maintain backward compatibility with callback-based code
// This allows existing callback-style queries to work with the promise-based pool
// mysql2 pool.query() supports both promises and callbacks
const connection = {
	query: (sql, params, callback) => {
		// If params is the callback (only sql and callback provided)
		if (typeof params === 'function') {
			callback = params;
			params = [];
		}
		
		// mysql2 pool.query() supports callbacks as third parameter even with promise wrapper
		// The promise is still returned but callback will be executed
		if (callback) {
			pool.query(sql, params || [], callback);
		} else {
			return pool.query(sql, params || []);
		}
	}
};

// Example Query Function (maintained for backward compatibility)
function queryDatabase(sql, params = []) {
	connection.query(sql, params, (err, results) => {
		if (err) {
			console.error('Query Error:', err.message);
			return;
		}
		console.log('Query Results:', results);
	});
}

// Example Usage
queryDatabase('SELECT 1 + 1 AS solution');


// Set up multer for multiple file uploads
const storage = multer.diskStorage({
	destination: 'PassportUpload/',
	filename: (req, file, cb) => {
		const uniqueName = `${Date.now()}-${file.originalname}`; // Unique filename
		cb(null, uniqueName);
	}
});


const uploadPassportImg = multer({
	storage: storage,
	limits: {
		fileSize: 5 * 1024 * 1024 // Limit file size to 5MB
	},
	fileFilter(req, file, cb) {
		const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
		if (!allowedTypes.includes(file.mimetype)) {
			return cb(new Error('File type not allowed'));
		}
		cb(null, true);
	}
});

// I-setup ang multer para sa multiple file uploads (para sa receipts)
const receiptStorage = multer.diskStorage({
	destination: 'ReceiptUpload/',
	filename: (req, file, cb) => {
		const uniqueName = `${Date.now()}-${file.originalname}`; // Gumawa ng unique filename
		cb(null, uniqueName);
	}
});

const uploadReceiptImg = multer({
	storage: receiptStorage,
	limits: {
		fileSize: 5 * 1024 * 1024 // Limit file size sa 5MB
	},
	fileFilter(req, file, cb) {
		const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
		if (!allowedTypes.includes(file.mimetype)) {
			return cb(new Error('File type not allowed'));
		}
		cb(null, true);
	}
});



app.set('view engine', 'ejs');

app.use(express.static('public'));


function generateMD5(input) {
	return crypto.createHash('md5').update(input).digest('hex');
}

const checkSession = (req, res, next) => {
	if (!req.session || !req.session.username) {
		res.redirect('/login');
	} else {
		next();
	}
};

function sessions(req, page) {
	return {
		username: req.session.username,
		firstname: req.session.firstname,
		lastname: req.session.lastname,
		user_id: req.session.user_id,
		currentPage: page
	};
}


pageRouter.get("/", function (req, res) {
	res.render("login");
});


pageRouter.get("/login", function (req, res) {
	res.render("login");
});

pageRouter.get("/", checkSession, function (req, res) {
	console.log("Session Data:", req.session); // Debugging line

	const permissions = req.session.permissions;

	if (permissions === undefined) {
		console.error("Permissions are undefined");
	}

	res.render("dashboard", { permissions });
});

pageRouter.get("/dashboard", checkSession, function (req, res) {
	console.log("Session Data:", req.session); // Debugging line

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
		 SUM(CASE WHEN TRANSACTION_ID = 3 AND RESET = 1 THEN NN_CHIPS ELSE 0 END) - 
		 SUM(CASE WHEN TRANSACTION_ID = 2 AND RESET = 1 THEN NN_CHIPS ELSE 0 END)) 
		 AS HouseRollingChips 
		FROM junket_total_chips 
		WHERE ACTIVE=1`;

	let sqlTotalRollingReset = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS RESET_ROLLING FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE IN (3,4) AND RESET=1';
	let sqlTotalCashOutRollingReset = 'SELECT SUM(NN_CHIPS) AS RESET_CASHOUT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND RESET=1';

	let sqlTotalCashOutReset = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS CASHOUT_RESET FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND RESET=1';
	let sqlWinLossReset = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS RESET_CASHIN FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND RESET=1';

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
			SUM(game_record.NN_CHIPS + game_record.CC_CHIPS) AS TOTAL_ROLLING,
			game_list.COMMISSION_PERCENTAGE AS percentage
		 FROM game_record
		 LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
		 WHERE game_list.ACTIVE IN (1, 2) 
		   AND game_list.COMMISSION_TYPE = 1 
		   AND game_record.CAGE_TYPE IN (3, 4) 
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
		let sqlNNChipsReturnDeposit = 'SELECT SUM(NN_CHIPS) AS NN_DEPOSIT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND TRANSACTION = 2';
		let sqlCageRolling = 'SELECT SUM(ROLLING_AMOUNT) AS ROLLING_AMOUNT FROM cage_rolling WHERE ACTIVE =1';
		let sqlNNChipsAccountMarker = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN_MARKER FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND TRANSACTION = 3';
		let sqlCCChipsBuyinGame = 'SELECT SUM(CC_CHIPS) AS TOTAL_CC FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION IN (1 , 2, 3)';
		let sqlNNChipsAccountCash = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN_CASH FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1 AND TRANSACTION = 1';
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
		AND account_ledger.TRANSACTION_DESC != "ACCOUNT DETAILS" 
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
	let sqlAccountCCChipsReturn = 'SELECT SUM(CC_CHIPS) AS CC_CHIPS_RETURN FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2';
	let sqlTotalCashOutRolling = 'SELECT SUM(NN_CHIPS) AS TOTAL_CASHOUT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2';
	let sqlTotalCashOut = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_CASHOUT FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2';

	let sqlWinLoss = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_CASHIN FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 1';

	let sqlCommisionRolling = `SELECT SUM(game_record.NN_CHIPS + game_record.CC_CHIPS) AS TOTAL_ROLLING, game_list.COMMISSION_PERCENTAGE AS percentage FROM game_record 
			LEFT JOIN game_list ON game_list.IDNo = game_record.GAME_ID
			WHERE game_list.ACTIVE IN (1,2) AND game_list.COMMISSION_TYPE = 1 AND game_record.CAGE_TYPE IN (3,4) AND SETTLED = 1 GROUP BY game_record.GAME_ID`;

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


	connection.query(sqlWinlossManual, (err, WinlossManualResult) => {
		if (err) throw err;

		connection.query(sqlTotalRollingManual, (err, TotalRollingManualResult) => {
			if (err) throw err;

			connection.query(sqlAccountTransfer, (err, AccountTransferResult) => {
				if (err) throw err;

				connection.query(sqlCCChipsBuyinGame, (err, CChipsBuyinGameResult) => {
					if (err) throw err;

					connection.query(sqlJunketCredit, (err, JunketCreditResult) => {
						if (err) throw err;

						connection.query(sqlJunketExpense, (err, JunketExpenseResult) => {
							if (err) throw err;
							connection.query(sqlJunketExpenseReset, (err, ResetExpenseResult) => {
								if (err) throw err;

								connection.query(sqlAccountMarkerReturn, (err, AccountMarkerReturnResult) => {
									if (err) throw err;
									connection.query(sqlChipsReturnMarker, (err, ChipsReturnMarkerResult) => {
										if (err) throw err;

										connection.query(sqlMArkerReturnDeposit, (err, MArkerReturnDepositResult) => {
											if (err) throw err;


											connection.query(sqlMArkerReturnCash, (err, MArkerReturnCashResult) => {
												if (err) throw err;

												connection.query(sqlSettlementDepositAmount, (err, SettlementDepositAmountResult) => {
													if (err) throw err;

													connection.query(sqlAccountSettlement, (err, AccountSettlementResult) => {
														if (err) throw err;

														connection.query(sqlNNChipsReturnDeposit, (err, NNChipsReturnDepositResult) => {
															if (err) throw err;

															connection.query(sqlCageRolling, (err, CageRollingResult) => {
																if (err) throw err;

																connection.query(sqlAccountCCChipsReturn, (err, AccountCCChipsReturnResult) => {
																	if (err) throw err;

																	connection.query(sqlNNChipsAccountMarker, (err, NNChipsAccountMarkerResult) => {
																		if (err) throw err;

																		connection.query(sqlAccountDeduct, (err, accountDeductResult) => {
																			if (err) throw err;

																			connection.query(sqlAccountWithdraw, (err, accountWithdrawResult) => {
																				if (err) throw err;

																				connection.query(sqlNNChipsAccountCash, (err, NNChipsAccountCashResult) => {
																					if (err) throw err;

																					connection.query(sqlNNChipsAccountDeposit, (err, NNChipsAccountDepositResult) => {
																						if (err) throw err;

																						connection.query(sqlCCChipsCashout, (err, CCChipsBuyinCashoutResult) => {
																							if (err) throw err;
																							connection.query(sqlHouseRollingReset, (err, HouseRollingResetResult) => {
																								if (err) throw err;

																								connection.query(sqlCCReturn, (err, CCBuyinReturnResult) => {
																									if (err) throw err;

																									connection.query(sqlNNChipsCashout, (err, NNChipsBuyinCashoutResult) => {
																										if (err) throw err;

																										connection.query(sqlNNReturn, (err, NNBuyinReturnResult) => {
																											if (err) throw err;

																											connection.query(sqlTotalChipsCashout, (err, TotalChipsBuyinCashoutResult) => {
																												if (err) throw err;

																												connection.query(sqlCCChipsRolling, (err, CCChipsRollingResult) => {
																													if (err) throw err;

																													connection.query(sqlNNChipsRolling, (err, NNChipsRollingResult) => {
																														if (err) throw err;

																														connection.query(sqlTotalChipsRolling, (err, TotalChipsRollingResult) => {
																															if (err) throw err;

																															connection.query(sqlCCChipsBuyin, (err, CCChipsBuyinResult) => {
																													if (err) throw err;

																													connection.query(sqlCCBuyin, (err, CCBuyinResult) => {
																														if (err) throw err;

																														connection.query(sqlNNChipsBuyin, (err, NNChipsBuyinResult) => {
																															if (err) throw err;

																															connection.query(sqlNNBuyin, (err, NNBuyinResult) => {
																																if (err) throw err;

																																connection.query(sqlTotalChipsBuyin, (err, TotalChipsBuyinResult) => {
																																	if (err) throw err;

																																	connection.query(sqlCashDeposit, (err, cashDepositResult) => {
																																		if (err) throw err;

																																		connection.query(sqlCashWithdraw, (err, cashWithdrawResult) => {
																																			if (err) throw err;

																																			connection.query(sqlAccountDeposit, (err, accountDepositResult) => {
																																				if (err) throw err;

																																				connection.query(sqlAccountCCChips, (err, accountCCChips) => {
																																					if (err) throw err;

																																					connection.query(sqlAccountNNChips, (err, accountNNChips) => {
																																						if (err) throw err;

																																						connection.query(sqlMarkerIssueGame, (err, markerIssueGame) => {
																																							if (err) throw err;

																																							connection.query(sqlMarkerIssueAccount, (err, markerIssueAccount) => {
																																								if (err) throw err;

																																								connection.query(sqlTotalRealRolling, (err, totalRealRolling) => {
																																									if (err) throw err;

																																									connection.query(sqlTotalRolling, (err, totalRolling) => {
																																										if (err) throw err;
																																										connection.query(sqlTotalRollingReset, (err, totalRollingReset) => {
																																											if (err) throw err;

																																											connection.query(sqlTotalCashOut, (err, totalCashOut) => {
																																												if (err) throw err;
																																												connection.query(sqlTotalCashOutReset, (err, totalCashOutReset) => {
																																													if (err) throw err;

																																													connection.query(sqlTotalCashOutRolling, (err, totalCashOutRolling) => {
																																														if (err) throw err;
																																														connection.query(sqlTotalCashOutRollingReset, (err, totalCashOutRollingReset) => {
																																															if (err) throw err;

																																															connection.query(sqlWinLoss, (err, totalWinLoss) => {
																																																if (err) throw err;
																																																connection.query(sqlWinLossReset, (err, totalWinLossReset) => {
																																																	if (err) throw err;

																																																	connection.query(sqlCommisionRolling, (err, totalCommisionRolling) => {
																																																		if (err) throw err;

																																																		connection.query(sqlCommisionCashout, (err, totalCommisionCashout) => {
																																																			if (err) throw err;

																																																			let totalCommission = 0;

																																																			for (let i = 0; i < totalCommisionRolling.length; i++) {
																																																				let cashout = 0;
																																																				if (totalCommisionCashout[i]) {
																																																					cashout = totalCommisionCashout[i].TOTAL_CASHOUT;
																																																				}

																																																				totalCommission += (totalCommisionRolling[i].TOTAL_ROLLING - cashout) * (totalCommisionRolling[i].percentage / 100);
																																																			}

																																																			connection.query(sqlCommissionReset, (err, CommissionResetResult) => {
																																																				if (err) throw err;

																																																				let totalCommissionReset = 0;

																																																				for (let i = 0; i < CommissionResetResult.length; i++) {
																																																					const { TOTAL_ROLLING, percentage, TOTAL_CASHOUT } = CommissionResetResult[i];

																																																					totalCommissionReset += (TOTAL_ROLLING - TOTAL_CASHOUT) * (percentage / 100);
																																																				}

																																																				connection.query(sqlSharedRolling, (err, totalSharedRolling) => {
																																																					if (err) throw err;

																																																					connection.query(sqlSharedCashoutCC, (err, totalSharedCashoutCC) => {
																																																						if (err) throw err;

																																																						connection.query(sqlSharedCashout, (err, totalSharedCashout) => {
																																																							if (err) throw err;

																																																							let totalShared = 0;

																																																							for (let j = 0; j < totalSharedRolling.length; j++) {
																																																								let cashout_shared = 0;
																																																								let cashout_cc_shared = 0;

																																																								if (totalSharedCashout[j]) {
																																																									cashout_shared = totalSharedCashout[j].TOTAL_CASHOUT;
																																																								}

																																																								// If there is a corresponding cashout CC value, use it
																																																								if (totalSharedCashoutCC[j]) {
																																																									cashout_cc_shared = totalSharedCashoutCC[j].TOTAL_CASHOUT_CC;
																																																								}

																																																								totalShared += (totalSharedRolling[j].TOTAL_ROLLING - cashout_shared - cashout_cc_shared) * (totalSharedRolling[j].percentage / 100);
																																																							}
																																																							//
																																																							connection.query(sqlSharedRollingReset, (err, totalSharedRollingReset) => {
																																																								if (err) throw err;

																																																								connection.query(sqlSharedCashoutCCReset, (err, totalSharedCashoutCCReset) => {
																																																									if (err) throw err;

																																																									connection.query(sqlSharedCashoutReset, (err, totalSharedCashoutReset) => {
																																																										if (err) throw err;

																																																										let totalSharedReset = 0;

																																																										for (let j = 0; j < totalSharedRollingReset.length; j++) {
																																																											let cashout_shared = 0;
																																																											let cashout_cc_shared = 0;

																																																											// Assign cashout_shared if it exists
																																																											if (totalSharedCashoutReset[j]) {
																																																												cashout_shared = totalSharedCashoutReset[j].TOTAL_CASHOUT;
																																																											}

																																																											// Assign cashout_cc_shared if it exists
																																																											if (totalSharedCashoutCCReset[j]) {
																																																												cashout_cc_shared = totalSharedCashoutCCReset[j].TOTAL_CASHOUT_CC;
																																																											}

																																																											totalSharedReset += (totalSharedRollingReset[j].TOTAL_ROLLING - cashout_shared - cashout_cc_shared) * (totalSharedRollingReset[j].percentage / 100);
																																																										}

																																																										connection.query(sqlWinLossLive, (err, results) => {
																																																											if (err) throw err;

																																																											let totalWinLossLiveResult = 0;

																																																											results.forEach(row => {
																																																												const cashinLive = row.CASHIN_LIVE || 0;
																																																												const cashoutLive = row.CASHOUT_LIVE || 0; // Assume CASHOUT_RESET from previous query refers to CASHOUT_LIVE here
																																																												const houseShare = row.houseshare || 0;

																																																												// Calculate the win/loss result
																																																												const winLossResult = (cashinLive - cashoutLive) * (houseShare / 100);
																																																												// Add to the total
																																																												totalWinLossLiveResult += winLossResult;
																																																											});

																																																											connection.query(sqlWinLossTelebet, (err, results) => {
																																																												if (err) throw err;

																																																												let totalWinLossTelebetResult = 0;

																																																												results.forEach(row => {
																																																													const cashinLive = row.CASHIN_TELEBET || 0;
																																																													const cashoutLive = row.CASHOUT_TELEBET || 0; // Assume CASHOUT_RESET from previous query refers to CASHOUT_LIVE here
																																																													const houseShare = row.houseshare || 0;

																																																													// Calculate the win/loss result
																																																													const winLossResult = (cashinLive - cashoutLive) * (houseShare / 100);
																																																													// Add to the total
																																																													totalWinLossLiveResult += winLossResult;
																																																												});

																																																												connection.query(sqlNNChipsBuyinCashDeposit, (err, sqlNNChipsBuyinCashDepositResult) => {
																																																													if (err) throw err;

																																																													connection.query(sqlCCChipsBuyinCashDeposit, (err, sqlCCChipsBuyinCashDepositResult) => {
																																																														if (err) throw err;

																																																														connection.query(sqlAgentCount, (err, sqlAgentCountResult) => {
																																																															if (err) throw err;

																																																															// Compute Commission Payment Total (same logic as Commission module)
																																																															const computeCommissionPayment = (callback) => {
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
																																																																	WHERE game_list.ACTIVE != 0 
																																																																		AND game_list.SETTLED = 1
																																																																		AND DATE(game_list.ENCODED_DT) BETWEEN ? AND ?
																																																																	ORDER BY game_list.IDNo ASC`;

																																																																connection.query(commissionQuery, [startStr, endStr], (err, games) => {
																																																																	if (err) return callback(err, 0);

																																																																	if (!games || games.length === 0) return callback(null, 0);

																																																																	let totalPayment = 0;
																																																																	let processed = 0;

																																																																	if (games.length === 0) return callback(null, 0);

																																																																	games.forEach((row) => {
																																																																		const gameId = row.game_list_id;
																																																																		const RollingRate = Number(row.COMMISSION_PERCENTAGE) || 0;
																																																																		const fb = Number(row.fnb || 0);
																																																																		const commissionType = Number(row.COMMISSION_TYPE);

																																																																		if (!gameId || !RollingRate) {
																																																																			processed++;
																																																																			if (processed === games.length) callback(null, totalPayment);
																																																																			return;
																																																																		}

																																																																		const recordQuery = `SELECT AMOUNT, NN_CHIPS, CC_CHIPS, CAGE_TYPE, ROLLER_TRANSACTION, ROLLER_CC_CHIPS FROM game_record WHERE ACTIVE != 0 AND GAME_ID = ? ORDER BY IDNo ASC`;
																																																																		connection.query(recordQuery, [gameId], (err, records) => {
																																																																			processed++;

																																																																			if (err || !records || records.length === 0) {
																																																																				if (processed === games.length) callback(null, totalPayment);
																																																																				return;
																																																																			}

																																																																			let total_nn_init = 0;
																																																																			let total_cc_init = 0;
																																																																			let total_nn = 0;
																																																																			let total_cc = 0;
																																																																			let total_cash_out_nn = 0;
																																																																			let total_cash_out_cc = 0;
																																																																			let total_rolling_nn = 0;
																																																																			let total_rolling_cc = 0;
																																																																			let total_rolling_real = 0;
																																																																			let total_rolling_nn_real = 0;
																																																																			let total_rolling_cc_real = 0;
																																																																			let total_roller_return_cc = 0;

																																																																			records.forEach((res) => {
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
																																																																			});

																																																																			const total_initial = total_nn_init + total_cc_init;
																																																																			const total_buy_in_chips = total_nn + total_cc;
																																																																			const total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
																																																																			const total_rolling_chips = total_rolling_nn + total_rolling_cc + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real + total_roller_return_cc - total_cash_out_nn;

																																																																			const total_amount = total_buy_in_chips + total_initial;
																																																																			const winlossValue = total_amount - total_cash_out_chips;

																																																																			let net = 0;
																																																																			if (commissionType === 1 || commissionType === 3) {
																																																																				net = Math.round((total_rolling_chips * RollingRate) / 100);
																																																																			} else if (commissionType === 2) {
																																																																				net = Math.round((winlossValue * RollingRate) / 100);
																																																																			}

																																																																			const paymentValue = Math.round(net - fb);
																																																																			totalPayment += paymentValue;

																																																																			if (processed === games.length) callback(null, totalPayment);
																																																																		});
																																																																	});
																																																																});
																																																															};

																																																															computeCommissionPayment((err, computedTotal) => {
																																																																let totalCommissionPayment = 0;
																																																																if (err) {
																																																																	console.error('Error computing commission payment:', err);
																																																																} else {
																																																																	totalCommissionPayment = computedTotal || 0;
																																																																}

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
																																																																sqlJunketCredit: JunketCreditResult,
																																																																sqlJunketExpense: JunketExpenseResult,
																																																																sqlJunketExpenseReset: ResetExpenseResult,

																																																																sqlAccountTransfer: AccountTransferResult,

																																																																sqlAccountMarkerReturn: AccountMarkerReturnResult,
																																																																sqlChipsReturnMarker: ChipsReturnMarkerResult,
																																																																sqlMArkerReturnDeposit: MArkerReturnDepositResult,
																																																																sqlMArkerReturnCash: MArkerReturnCashResult,
																																																																sqlSettlementDepositAmount: SettlementDepositAmountResult,
																																																																sqlAccountSettlement: AccountSettlementResult,
																																																																sqlNNChipsReturnDeposit: NNChipsReturnDepositResult,
																																																																sqlCageRolling: CageRollingResult,
																																																																sqlAccountCCChipsReturn: AccountCCChipsReturnResult,
																																																																sqlNNChipsAccountMarker: NNChipsAccountMarkerResult,
																																																																sqlNNChipsAccountCash: NNChipsAccountCashResult,
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
																																																																sqlCashDeposit: cashDepositResult,
																																																																sqlCashWithdraw: cashWithdrawResult,
																																																																sqlAccountDeposit: accountDepositResult,
																																																																sqlAccountWithdraw: accountWithdrawResult,
																																																																sqlAccountDeduct: accountDeductResult,
																																																																sqlAccountCCChips: accountCCChips,
																																																																sqlAccountNNChips: accountNNChips,
																																																																sqlMarkerIssueGame: markerIssueGame,
																																																																sqlMarkerIssueAccount: markerIssueAccount,
																																																																sqlTotalRealRolling: totalRealRolling,
																																																																sqlTotalRolling: totalRolling,
																																																																sqlTotalRollingReset: totalRollingReset,
																																																																sqlTotalCashOut: totalCashOut,
																																																																sqlTotalCashOutReset: totalCashOutReset,
																																																																sqlTotalCashOutRolling: totalCashOutRolling,
																																																																sqlTotalCashOutRollingReset: totalCashOutRollingReset,
																																																																sqlWinLoss: totalWinLoss,
																																																																sqlWinLossReset: totalWinLossReset,
																																																																sqlCommision: totalCommission,
																																																																sqlCommissionReset: totalCommissionReset,
																																																																sqlShared: totalShared,
																																																																sqlSharedReset: totalSharedReset,
																																																																sqlWinLossLive: totalWinLossLiveResult,
																																																																sqlWinLossTelebet: totalWinLossTelebetResult,
																																																																sqlNNChipsBuyinCashDeposit: sqlNNChipsBuyinCashDepositResult,
																																																																sqlCCChipsBuyinCashDeposit: sqlCCChipsBuyinCashDepositResult,
																																																																sqlAgentCount: sqlAgentCountResult,
																																																																sqlCommissionPayment: totalCommissionPayment || 0



																																																															});
																																																															});
																																																														});
																																																													});
																																																												});
																																																											});
																																																													});
																																																												});

																																																											});
																																																										});
																																																									});
																																																								});
																																																							});
																																																						});
																																																					});
																																																				});
																																																			});
																																																		});
																																																	});
																																																});
																																															});
																																														});
																																													});
																																												});
																																											});
																																										});
																																									});
																																								});
																																							});
																																						});
																																					});
																																				});
																																			});
																																		});
																																	});
																																});
																															});
																														});
																													});
																												});
																											});
																										});
																									});
																								});
																							});
																						});
																					});
																				});
																			});
																		});
																	});
																});
															});
														});
													});
												});
											});
										});
									});
								});
							});
						});
					});
				});
			});
		});
	});
	//query end
});

pageRouter.get("/agency", checkSession, function (req, res) {

	const permissions = req.session.permissions;

	res.render("accounts/agency", {
		...sessions(req, 'agency'),
		permissions: permissions
	});
});

pageRouter.get("/agent", checkSession, function (req, res) {

	const permissions = req.session.permissions;

	res.render("accounts/agent", {
		...sessions(req, 'agent'),
		permissions: permissions
	});


});

pageRouter.get("/account_ledger", checkSession, function (req, res) {

	const permissions = req.session.permissions;

	res.render("accounts/account_ledger", {
		...sessions(req, 'account_ledger'),
		permissions: permissions
	});

});
//=============== TELEGRAM API =============
pageRouter.get("/telegramAPI", function (req, res) {

	const permissions = req.session.permissions;

	res.render("telegram/telegram", {
		...sessions(req, 'telegramAPI'),
		permissions: permissions
	});

});
//=============== JUNKET =============
pageRouter.get("/capital", async function (req, res) {
	const cashBalance = await dashboardQueries.computeCashBalance();
	res.render("junket/capital", {
		...sessions(req, 'capital'),
		cashBalance
	});
});

pageRouter.get("/house_expense", function (req, res) {

	const permissions = req.session.permissions;

	res.render("junket/house_expense", {
		...sessions(req, 'house_expense'),
		permissions: permissions
	});
});

pageRouter.get("/booking", function (req, res) {

	const permissions = req.session.permissions;

	res.render("junket/booking", {
		...sessions(req, 'booking'),
		permissions: permissions
	});
});


pageRouter.get("/credit", function (req, res) {
	res.render("junket/credit", sessions(req, 'credit'));
});

pageRouter.get("/commission", function (req, res) {
	const data = sessions(req, 'commission');
	data.permissions = req.session.permissions;
	res.render("junket/commission", data);
});

pageRouter.get("/markerHistory", checkSession, async function (req, res) {
	const sqlMarkerIssueGame = 'SELECT SUM(NN_CHIPS + CC_CHIPS) AS TOTAL_ISSUE_GAME FROM game_record WHERE ACTIVE =1 AND TRANSACTION = 3 AND CAGE_TYPE = 1';
	const sqlMarkerIssueAccount = `SELECT SUM(account_ledger.AMOUNT) AS TOTAL_ISSUE_RECORD FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE = 1 AND account_ledger.TRANSACTION_ID = 3 AND account.ACTIVE = 1 AND agent.ACTIVE = 1`;
	const sqlNNChipsAccountMarker = 'SELECT SUM(NN_CHIPS) AS TOTAL_NN_MARKER FROM game_record WHERE ACTIVE =1 AND CAGE_TYPE = 2 AND TRANSACTION = 3';
	const sqlMArkerReturnCash = `SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_CASH FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE = 1 AND account_ledger.TRANSACTION_TYPE = 3 AND account_ledger.TRANSACTION_ID = 11 AND account.ACTIVE = 1 AND agent.ACTIVE = 1`;
	const sqlMArkerReturnDeposit = `SELECT SUM(account_ledger.AMOUNT) AS MARKER_RETURN_DEPOSIT FROM account_ledger JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID JOIN agent ON agent.IDNo = account.AGENT_ID WHERE account_ledger.ACTIVE = 1 AND account_ledger.TRANSACTION_TYPE = 3 AND account_ledger.TRANSACTION_ID = 12 AND account.ACTIVE = 1 AND agent.ACTIVE = 1`;
	const sqlChipsReturnMarker = `SELECT SUM(NN_CHIPS + CC_CHIPS) AS CHIPS_RETURN_MARKER FROM game_record WHERE CAGE_TYPE = 2 AND TRANSACTION = 4 AND ACTIVE = 1`;
	try {
		const [r1, r2, r3, r4, r5, r6] = await Promise.all([
			pool.execute(sqlMarkerIssueGame),
			pool.execute(sqlMarkerIssueAccount),
			pool.execute(sqlNNChipsAccountMarker),
			pool.execute(sqlMArkerReturnCash),
			pool.execute(sqlMArkerReturnDeposit),
			pool.execute(sqlChipsReturnMarker)
		]);
		const data = sessions(req, 'marker_history');
		data.permissions = req.session.permissions;
		data.sqlMarkerIssueGame = [r1[0][0] || { TOTAL_ISSUE_GAME: 0 }];
		data.sqlMarkerIssueAccount = [r2[0][0] || { TOTAL_ISSUE_RECORD: 0 }];
		data.sqlNNChipsAccountMarker = [r3[0][0] || { TOTAL_NN_MARKER: 0 }];
		data.sqlMArkerReturnCash = [r4[0][0] || { MARKER_RETURN_CASH: 0 }];
		data.sqlMArkerReturnDeposit = [r5[0][0] || { MARKER_RETURN_DEPOSIT: 0 }];
		data.sqlChipsReturnMarker = [r6[0][0] || { CHIPS_RETURN_MARKER: 0 }];
		res.render("marker/markerHistory", data);
	} catch (err) {
		console.error('markerHistory query error:', err);
		const data = sessions(req, 'marker_history');
		data.permissions = req.session.permissions;
		data.sqlMarkerIssueGame = [{ TOTAL_ISSUE_GAME: 0 }];
		data.sqlMarkerIssueAccount = [{ TOTAL_ISSUE_RECORD: 0 }];
		data.sqlNNChipsAccountMarker = [{ TOTAL_NN_MARKER: 0 }];
		data.sqlMArkerReturnCash = [{ MARKER_RETURN_CASH: 0 }];
		data.sqlMArkerReturnDeposit = [{ MARKER_RETURN_DEPOSIT: 0 }];
		data.sqlChipsReturnMarker = [{ CHIPS_RETURN_MARKER: 0 }];
		res.render("marker/markerHistory", data);
	}
});

pageRouter.get("/concierge", function (req, res) {
	res.render("junket/concierge", sessions(req, 'concierge'));
});

pageRouter.get("/main_cage", function (req, res) {
	res.render("junket/main_cage", sessions(req, 'main_cage'));
});

//========== USER ACCOUNTS ================
pageRouter.get("/user_roles", function (req, res) {
	const data = sessions(req, 'user_roles');
	data.permissions = req.session.permissions;
	res.render("user_accounts/user_roles", data);
});

pageRouter.get("/user_roles", checkSession, function (req, res) {
	const data = sessions(req, 'user_roles');
	data.permissions = req.session.permissions;
	res.render("user_accounts/user_roles", data);
});

pageRouter.get("/manage_users", checkSession, function (req, res) {
	const data = sessions(req, 'manage_users');
	data.permissions = req.session.permissions;
	res.render("user_accounts/manage_users", data);
});

// ======================= GAME STATISTICS ==================
// Pages and stats APIs live in routes/statistics.js (mounted before this file).

// ======================= ACTIVITY LOG ==================

pageRouter.get("/activity_log", checkSession, function (req, res) {
	const data = sessions(req, 'activity_log');
	data.permissions = req.session.permissions || 0;
	res.render("activity_log", data);
});

// ======================= GAME LIST ==================

pageRouter.get("/game_list", checkSession, function (req, res) {
	// Add permissions to the data object
	const data = sessions(req, 'game_list');
	data.permissions = req.session.permissions || 0; // Ensure permissions are included

	res.render("gamebook/game_list", data);
});


pageRouter.get("/game_list2", checkSession, function (req, res) {
	res.render("gamebook/game_list2", sessions(req, 'game_list'));
});

pageRouter.get("/game_record/:id", checkSession, function (req, res) {
	const pageId = parseInt(req.params.id);
	const query = `SELECT *
	FROM game_list  
	JOIN account ON game_list.ACCOUNT_ID = account.IDNo
	JOIN agent ON agent.IDNo = account.AGENT_ID
	JOIN agency ON agency.IDNo = agent.AGENCY
	WHERE game_list.ACTIVE != 0 AND game_list.IDNo = ?`;

	connection.query(query, [pageId], (error, results) => {
		if (error) {
			console.error('Error executing MySQL query: ' + error.stack);
			res.send('Error during login');
			return;
		}
		if (results) {
			res.render('gamebook/game_record', {
				username: req.session.username,
				firstname: req.session.firstname,
				lastname: req.session.lastname,
				user_id: req.session.user_id,
				page_id: pageId,
				reference: results[0].GAME_NO,
				currentPage: 'game_record'
			});
		}
	});

});

//LOGIN
pageRouter.post('/login', (req, res) => {
	const { username, password } = req.body;
	const query = 'SELECT * FROM user_info WHERE USERNAME = ? AND ACTIVE = 1';

	connection.query(query, [username], (error, results) => {
		if (error) {
			console.error('Error executing MySQL query: ' + error.stack);
			res.send('Error during login');
			return;
		}

		if (results.length > 0) {
			const user = results[0];
			const salt = user.SALT;
			const username1 = user.USERNAME;
			const hashedPassword = generateMD5(salt + password);

			const query1 = 'SELECT * FROM user_info WHERE USERNAME = ? AND PASSWORD = ? AND ACTIVE = 1';
			connection.query(query1, [username1, hashedPassword], (errors, result) => {
				if (errors) {
					console.error('Error executing MySQL query: ' + errors.stack);
					res.send('Error during login');
					return;
				}

				if (result.length > 0) {
					req.session.username = username;
					req.session.firstname = user.FIRSTNAME;
					req.session.lastname = user.LASTNAME;
					req.session.user_id = user.IDNo;
					req.session.permissions = user.PERMISSIONS;

					console.log("User Permissions:", req.session.permissions);

					// **Save session before redirect**
					req.session.save(err => {
						if (err) {
							console.error("Session save error:", err);
							res.redirect('/login?error=SessionError');
						} else {
							console.log("Redirecting to Dashboard...");
							res.redirect('/dashboard');
						}
					});

				} else {
					console.log("Login failed: Incorrect password");
					res.redirect('/login');
				}
			});
		} else {
			console.log("Login failed: User not found or inactive");
			res.redirect('/login');
		}
	});
});


pageRouter.post('/verify-password', (req, res) => {
	const { password } = req.body;

	const query = 'SELECT * FROM user_info WHERE PERMISSIONS = 11 AND ACTIVE = 1';
	connection.query(query, (error, results) => {
		if (error) {
			console.error('Error executing MySQL query: ' + error.stack);
			return res.status(500).json({ message: 'Error during password verification' });
		}

		if (results.length > 0) {
			const manager = results[0]; // Assume there's only one manager

			const salt = manager.SALT;
			const hashedPassword = generateMD5(salt + password);

			// Verify if the password matches the manager's password
			if (hashedPassword === manager.PASSWORD) {
				return res.json({ permissions: manager.PERMISSIONS });
			} else {
				return res.status(403).json({ message: 'Incorrect password' });
			}
		} else {
			return res.status(404).json({ message: 'Manager not found' });
		}
	});
});

pageRouter.post('/check-permission', (req, res) => {
	if (!req.session.permissions) {
		return res.status(401).json({ message: 'Not logged in' });
	}

	if (req.session.permissions === 11) {
		return res.json({ permissions: 11 });
	} else {
		return res.json({ permissions: req.session.permissions });
	}
});

//LOGOUT
pageRouter.get('/logout', (req, res) => {
	req.session.destroy();
	res.redirect('/login');
});

//============= POP UPS ====================
pageRouter.get("/cage_category", function (req, res) {
	res.render("popups/cage_category", sessions(req, 'cage_category'));
});

pageRouter.get("/capital_category", function (req, res) {
	res.render("popups/capital_category", sessions(req, 'capital_category'));
});

pageRouter.get("/concierge_category", function (req, res) {
	res.render("popups/concierge_category", sessions(req, 'concierge_category'));
});

pageRouter.get("/credit_status", function (req, res) {
	res.render("popups/credit_status", sessions(req, 'credit_status'));
});

pageRouter.get("/expense_category", function (req, res) {

	const permissions = req.session.permissions;

	res.render("popups/expense_category", {
		...sessions(req, 'expense_category'),
		permissions: permissions
	});

});

pageRouter.get("/Change_Game_No", function (req, res) {

	const permissions = req.session.permissions;

	res.render("popups/Change_Game_No", {
		...sessions(req, 'Change_Game_No'),
		permissions: permissions
	});

});


pageRouter.get('/game_list/logs', (req, res) => {
	const query = `
        SELECT game_number_logs.*, user_info.FIRSTNAME 
        FROM game_number_logs 
        JOIN user_info ON game_number_logs.ENCODED_BY = user_info.IDNo
        ORDER BY game_number_logs.ENCODED_DT DESC`; // ✅ Latest logs first

	connection.query(query, (error, results) => {
		if (error) {
			console.error('Error fetching game number logs:', error);
			return res.status(500).json({ success: false, message: 'Database error' });
		}

		res.json(results);
	});
});


pageRouter.get('/game_list/latest/game_number', (req, res) => {
	const query = `
        SELECT AUTO_INCREMENT 
        FROM information_schema.tables 
        WHERE table_name = 'game_list' 
        AND table_schema = DATABASE()`;

	connection.query(query, (error, result) => {
		if (error) {
			console.error('Error fetching game number:', error);
			return res.status(500).json({ success: false, message: 'Database error' });
		}

		if (result.length === 0 || !result[0].AUTO_INCREMENT) {
			return res.json({ success: false, message: 'No game number available' });
		}

		res.json({ success: true, gameNumber: result[0].AUTO_INCREMENT - 1 });
	});
});


pageRouter.post('/game_list/update_game_number', (req, res) => {
	console.log("Received request body:", req.body);

	const { newGameNo } = req.body;
	const encodedBy = req.session.user_id; // ✅ Get logged-in user ID

	if (!newGameNo || isNaN(newGameNo)) {
		return res.json({ success: false, message: 'Invalid Game Number. Please enter a valid number.' });
	}

	if (!encodedBy) {
		return res.json({ success: false, message: 'User session expired. Please log in again.' });
	}

	// Get the latest game number
	const fetchQuery = `SELECT IDNo FROM game_list ORDER BY IDNo DESC LIMIT 1`;

	connection.query(fetchQuery, (error, result) => {
		if (error) {
			console.error('Error fetching latest game number:', error);
			return res.status(500).json({ success: false, message: 'Database error' });
		}

		if (result.length === 0) {
			return res.json({ success: false, message: 'No game number available' });
		}

		const latestGameNo = result[0].IDNo;
		console.log("Latest game number:", latestGameNo);

		if (parseInt(newGameNo) <= latestGameNo) {
			return res.json({
				success: false,
				message: `Invalid input! You cannot enter a game number lower than ${latestGameNo}.`
			});
		}

		// ✅ Update AUTO_INCREMENT to match the new game number
		const autoIncrementQuery = `ALTER TABLE game_list AUTO_INCREMENT = ?`;
		const nextAutoIncrementValue = parseInt(newGameNo);

		connection.query(autoIncrementQuery, [nextAutoIncrementValue], (error, result) => {
			if (error) {
				console.error('Error setting AUTO_INCREMENT:', error);
				return res.status(500).json({ success: false, message: 'Database error while setting AUTO_INCREMENT' });
			}

			// ✅ Log the game number change
			const logQuery = `
                INSERT INTO game_number_logs (PREVIOUS_GAME_NUMBER, NEW_GAME_NUMBER, ENCODED_BY) 
                VALUES (?, ?, ?)`;

			connection.query(logQuery, [latestGameNo, newGameNo, encodedBy], (error, result) => {
				if (error) {
					console.error('Error logging game number change:', error);
				}
			});

			res.json({ success: true, message: `AUTO_INCREMENT updated to ${nextAutoIncrementValue}. Next game number will start from this.` });
		});
	});
});






pageRouter.get("/transaction_type", function (req, res) {
	res.render("popups/transaction_type", sessions(req, 'transaction_type'));
});

// ================= DENOMINATION =======================

pageRouter.get("/cash", function (req, res) {
	res.render("denomination/cash", sessions(req, 'cash'));
});

pageRouter.get("/cash_chips", function (req, res) {
	res.render("denomination/cash_chips", sessions(req, 'cash_chips'));
});

pageRouter.get("/non_negotiable_chips", function (req, res) {
	res.render("denomination/non_negotiable_chips", sessions(req, 'non_nego'));
});

//Add User Role
pageRouter.post('/add_user_role', (req, res) => {
	const {
		role
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO user_role (ROLE, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [role, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting user role:', err);
			res.status(500).send('Error inserting user');
			return;
		}

		res.redirect('/user_roles');
	});
});

//Get User Role
pageRouter.get('/user_role_data', (req, res) => {
	connection.query('SELECT * FROM user_role WHERE ACTIVE = 1', (error, results, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});

// UPDATE USER ROLE
pageRouter.put('/user_role/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		role
	} = req.body;
	let date_now = new Date();

	const query = `UPDATE user_role SET ROLE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [role, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating user role:', err);
			res.status(500).send('Error updating user role');
			return;
		}

		res.send('User role updated successfully');
	});
});

// ARCHIVE USER ROLE
pageRouter.put('/user_role/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE user_role SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating user role:', err);
			res.status(500).send('Error updating user role');
			return;
		}

		res.send('User role updated successfully');
	});
});

//Get Users
pageRouter.get('/users', (req, res) => {
	connection.query(`
		SELECT user_info.*, user_info.IDNo AS user_id,
			COALESCE(user_role.ROLE, IF(user_info.PERMISSIONS = 0, 'SuperAdmin', NULL)) AS role
		FROM user_info
		LEFT JOIN user_role ON user_role.IDNo = user_info.PERMISSIONS
		WHERE user_info.ACTIVE = 1
	`, (error, results, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});


//Add User
pageRouter.post('/add_user', (req, res) => {
	const {
		txtFirstName,
		txtLastName,
		txtUserName,
		txtPassword,
		txtPassword2,
		user_role,
		salt
	} = req.body;
	let date_now = new Date();

	if (txtPassword != txtPassword2) {
		res.status(500).json({
			error: 'password'
		});
	} else {
		const generated_pw = generateMD5(salt + txtPassword);
		const query = `INSERT INTO user_info (FIRSTNAME, LASTNAME, USERNAME, PASSWORD, SALT, PERMISSIONS, LAST_LOGIN, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		connection.query(query, [txtFirstName, txtLastName, txtUserName, generated_pw, salt, user_role, date_now, req.session.user_id, date_now], (err, result) => {
			if (err) {
				console.error('Error inserting user:', err);
				res.status(500).send('Error inserting user');
				return;
			}

			res.redirect('/users');
		});
	}
});

// UPDATE USER
pageRouter.put('/user/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtFirstName,
		txtLastName,
		txtUserName,
		user_role
	} = req.body;
	let date_now = new Date();

	const query = `UPDATE user_info SET FIRSTNAME = ?, LASTNAME = ?, USERNAME = ?, PERMISSIONS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtFirstName, txtLastName, txtUserName, user_role, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating user role:', err);
			res.status(500).send('Error updating user role');
			return;
		}

		res.send('User role updated successfully');
	});
});

// ARCHIVE USER
pageRouter.put('/user/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE user_info SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating user:', err);
			res.status(500).send('Error updating user');
			return;
		}

		res.send('User role removed successfully');
	});
});

// ADD AGENCY
pageRouter.post('/add_agency', (req, res) => {
	const {
		txtAgency
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO agency (AGENCY, ENCODED_BY, ENCODED_DT) VALUES ( ?, ?, ?)`;
	connection.query(query, [txtAgency, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting agency:', err);
			res.status(500).send('Error inserting agency');
			return;
		}

		res.redirect('/agency');
	});
});

//Get AGENCY
pageRouter.get('/agency_data', (req, res) => {
	connection.query('SELECT * FROM agency WHERE agency.ACTIVE = 1 ORDER BY AGENCY ASC', (error, results, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});

// EDIT AGENCY
pageRouter.put('/agency/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtAgency
	} = req.body;
	let date_now = new Date();

	const query = `UPDATE agency SET AGENCY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtAgency, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating agency:', err);
			res.status(500).send('Error updating agency');
			return;
		}

		res.send('Agency updated successfully');
	});
});

pageRouter.put('/agency/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE agency SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating agency:', err);
			res.status(500).send('Error updating agency');
			return;
		}

		res.send('Agency updated successfully');
	});
});

// ADD AGENT
// Your POST route for handling the file upload and agent creation
pageRouter.post('/add_agent', uploadPassportImg.single('photo'), (req, res) => {
	try {
		const { txtAgencyLine, txtAgenctCode, txtName, txtRemarks, txtTelegram, txtContact } = req.body;
		const date_now = new Date();

		// Check if a file was uploaded
		const photoPath = req.file ? req.file.filename : null; // Use the filename if uploaded, otherwise null

		const query = `INSERT INTO agent (AGENCY, AGENT_CODE, NAME, CONTACTNo,TELEGRAM_ID, REMARKS, PHOTO, ENCODED_BY, ENCODED_DT)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		const queryValues = [txtAgencyLine, txtAgenctCode, txtName, txtContact, txtTelegram, txtRemarks, photoPath, req.session.user_id, date_now];

		connection.query(query, queryValues, (err, result) => {
			if (err) {
				console.error('Error inserting agent:', err);
				return res.status(500).json({ error: 'Error inserting agent' });
			}

			const agent_id = result.insertId;

			const account = `INSERT INTO account (AGENT_ID, GUESTNo, MEMBERSHIPNo, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?)`;

			connection.query(account, [agent_id, '', '', req.session.user_id, date_now], (err, results2) => {
				if (err) {
					console.error('Error inserting account:', err);
					return res.status(500).json({ error: 'Error inserting account' });
				}

				res.redirect('/agent'); // Redirect after inserting both agent and account
			});
		});
	} catch (error) {
		console.error('Unexpected error:', error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});



// pageRouter.post('/add_agent', (req, res) => {
// 	const {
// 		txtAgencyLine,
// 		txtAgenctCode,
// 		txtName,
// 		txtRemarks,
// 		txtContact,
// 		txtTelegram
// 	} = req.body;
// 	let date_now = new Date();


// 	const query = `INSERT INTO agent (AGENCY, AGENT_CODE, NAME, CONTACTNo, TELEGRAM_ID, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
// 	connection.query(query, [txtAgencyLine, txtAgenctCode, txtName, txtContact, txtTelegram, txtRemarks, req.session.user_id, date_now], (err, result) => {
// 		if (err) {
// 			console.error('Error inserting agent:', err);
// 			res.status(500).send('Error inserting agent');
// 			return;
// 		}

// 		const agent_id = result.insertId;

// 		const account = `INSERT INTO account (AGENT_ID, GUESTNo, MEMBERSHIPNo, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?)`;

// 		connection.query(account, [agent_id, '', '', req.session.user_id, date_now], (err, results2) => {
// 			if (err) throw err;

// 			res.redirect('/agent');
// 		});


// 	});
// });

//GET AGENT
pageRouter.get('/agent_data', (req, res) => {
	connection.query('SELECT *, agency.AGENCY AS agency_name, agency.IDNo AS agency_id, agent.AGENT_CODE AS agent_code, agent.IDNo AS agent_id, agent.ACTIVE as active FROM agent JOIN agency ON agent.AGENCY = agency.IDNo WHERE agent.ACTIVE = 1', (error, results, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});

//GET AGENT DATA
pageRouter.get('/agent_data/:id', (req, res) => {
	const id = parseInt(req.params.id);

	connection.query('SELECT CONCAT_WS(" ", FIRSTNAME,  MIDDLENAME, LASTNAME) AS agent_name, agent.IDNo AS agent_id, agency.AGENCY AS agency, agency.IDNo AS agency_id FROM agent JOIN agency ON agent.AGENCY = agency.IDNo WHERE agent.IDNo = ' + id + ' AND agent.ACTIVE = 1', (error, results, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});

// EDIT AGENT

pageRouter.put('/agent/:id', uploadPassportImg.single('photo'), (req, res) => {
	const id = parseInt(req.params.id);
	const {

		txtAgenctCode,
		txtName,
		txtRemarks,
		txtTelegram,
		txtContact
	} = req.body;
	let date_now = new Date();

	// If a file was uploaded, update the photoPath, otherwise leave it unchanged
	let photoPath = req.file ? req.file.filename : null;

	// Dynamically build the query based on whether the photo is being updated
	let query = `UPDATE agent SET AGENT_CODE = ?, NAME = ?, CONTACTNo = ?, TELEGRAM_ID = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?`;
	let queryValues = [txtAgenctCode, txtName, txtContact, txtTelegram, txtRemarks, req.session.user_id, date_now];

	// If there is a new photo, add the PHOTO column to the update
	if (photoPath) {
		query += `, PHOTO = ?`;
		queryValues.push(photoPath);
	}

	// Add the WHERE condition to the query
	query += ` WHERE IDNo = ?`;
	queryValues.push(id);

	// Execute the query
	connection.query(query, queryValues, (err, result) => {
		if (err) {
			console.error('Error updating agent:', err);
			res.status(500).send('Error updating agent');
			return;
		}

		res.send('Agent updated successfully');
	});
});

// pageRouter.put('/agent/:id', (req, res) => {
// 	const id = parseInt(req.params.id);
// 	const {
// 		txtAgencyLine,
// 		txtAgenctCode,
// 		txtName,
// 		txtRemarks,
// 		// txtFirstname,
// 		// txtMiddleName,
// 		// txtLastname,
// 		txtContact,
// 		txtTelegram
// 	} = req.body;
// 	let date_now = new Date();

// 	const agency = txtAgencyLine.split('-');
// 	const account_code = agency[1] + '-' + txtAgenctCode;

// 	const query = `UPDATE agent SET  AGENCY = ?, AGENT_CODE = ?, NAME = ?, CONTACTNo = ?, TELEGRAM_ID = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
// 	connection.query(query, [agency[0], txtAgenctCode, txtName, txtContact, txtTelegram, txtRemarks, req.session.user_id, date_now, id], (err, result) => {
// 		if (err) {
// 			console.error('Error updating agent:', err);
// 			res.status(500).send('Error updating agent');
// 			return;
// 		}

// 		res.send('Agent updated successfully');
// 	});
// });

// REMOVE AGENT
// REMOVE AGENT
pageRouter.put('/agent/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const date_now = new Date();

	// Query for agent table
	const queryAgent = `UPDATE agent SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	// Query for account table
	const queryAccount = `UPDATE account SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE AGENT_ID = ?`;

	connection.query(queryAgent, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('❌ Error updating agent:', err);
			return res.status(500).send('Error updating agent');
		}

		// Now update the related account(s)
		connection.query(queryAccount, [0, req.session.user_id, date_now, id], (err2, result2) => {
			if (err2) {
				console.error('❌ Error updating account:', err2);
				return res.status(500).send('Error updating account');
			}

			// Success!
			console.log('✅ Agent and account archived successfully');
			res.send('Updated successfully');
		});
	});
});


// ADD ACCOUNT
// pageRouter.post('/add_account', (req, res) => {
// 	const {
// 		agent_id,
// 		txtGuestNo,
// 		txtFirstname,
// 		txtMiddlename,
// 		txtLastname,
// 		txtMembershipNo
// 	} = req.body;
// 	let date_now = new Date();

// 	const query = `INSERT INTO account (AGENT_ID, GUESTNo, FIRSTNAME, MIDDLENAME, LASTNAME, MEMBERSHIPNo, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
// 	connection.query(query, [agent_id, txtGuestNo, txtFirstname, txtMiddlename, txtLastname, txtMembershipNo, req.session.user_id, date_now], (err, result) => {
// 		if (err) {
// 			console.error('Error inserting agent:', err);
// 			res.status(500).send('Error inserting agent');
// 			return;
// 		}

// 		res.redirect('/account_ledger');
// 	});
// });

pageRouter.get('/account_dashboard', (req, res) => {
    const agencyId = req.query.agencyId;
    console.log('Agency ID from query param:', agencyId);

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
        END), 0) AS total_balance
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
    WHERE 
        account.ACTIVE = 1 
        AND agent.ACTIVE = 1
    `;

    if (agencyId) {
        baseQuery += ` AND agency.IDNo = ${connection.escape(agencyId)}`;
    }

    baseQuery += `
    GROUP BY 
        account.IDNo, 
        agency.AGENCY, 
        agent.AGENT_CODE, 
        agent.NAME, 
        account.ACTIVE
    `;

    connection.query(baseQuery, (error, results) => {
        if (error) {
            console.error('Error fetching data:', error);
            res.status(500).send('Error fetching data');
            return;
        }
        res.json(results);
    });
});





//GET ACCOUNT
pageRouter.get('/account_data', (req, res) => {
	const agencyId = req.query.agencyId;
	console.log('Agency ID from query param:', agencyId); // <-- this should no longer be undefined

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
			END), 0) AS total_ledger_amount
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
		WHERE 
			account.ACTIVE = 1 AND agent.ACTIVE = 1
	`;

	// If agencyId is provided, add condition
	if (agencyId) {
		baseQuery += ` AND agency.IDNo = ${connection.escape(agencyId)}`;
	}

	baseQuery += `
		GROUP BY 
			account.IDNo, 
			agency.AGENCY, 
			agent.AGENT_CODE, 
			agent.NAME, 
			account.ACTIVE
	`;

	connection.query(baseQuery, (error, results) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});

// Get agency name by ID (for modal title)
pageRouter.get('/agency_data/:id', (req, res) => {
	const agencyId = parseInt(req.params.id);

	const query = `SELECT IDNo AS agency_id, AGENCY AS agency_name FROM agency WHERE IDNo = ?`;

	connection.query(query, [agencyId], (err, results) => {
		if (err) {
			console.error('❌ Error in /agency_data/:id:', err);
			return res.status(500).json({ error: 'Internal Server Error' });
		}

		if (results.length === 0) {
			return res.status(404).json({ error: 'Agency not found' });
		}

		res.json(results);
	});
});


// pageRouter.get('/account_data', (req, res) => {
// 	const query = `SELECT *, agency.AGENCY AS agency_name, account.IDNo AS account_id, agent.AGENT_CODE AS agent_code, account.ACTIVE as active,  agent.NAME AS agent_name
//   FROM account 
//   JOIN agent ON agent.IDNo = account.AGENT_ID
//   JOIN agency ON agency.IDNo = agent.AGENCY
//   WHERE account.ACTIVE = 1`;
// 	connection.query(query, (error, results, fields) => {
// 		if (error) {
// 			console.error('Error fetching data:', error);
// 			res.status(500).send('Error fetching data');
// 			return;
// 		}
// 		res.json(results);
// 	});
// });

// EDIT ACCOUNT
pageRouter.put('/account/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtGuestNo,
		txtMembershipNo
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE account SET  GUESTNo = ?, MEMBERSHIPNo = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtGuestNo, txtMembershipNo, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating account:', err);
			res.status(500).send('Error updating account');
			return;
		}

		res.send('Account updated successfully');
	});
});

// REMOVE ACCOUNT
pageRouter.put('/account/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE account SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating agency:', err);
			res.status(500).send('Error updating agency');
			return;
		}

		res.send('Agency updated successfully');
	});
});

// ADD CAGE CATEGORY
pageRouter.post('/add_cage_category', (req, res) => {
	const {
		txtCategory
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO cage_category(CATEGORY, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtCategory, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting Cage Category', err);
			res.status(500).send('Error inserting Cage Category');
			return;
		}
		res.redirect('/cage_category');
	});
});

// GET CAGE CATEGORY
pageRouter.get('/cage_category_data', (req, res) => {
	connection.query('SELECT * FROM cage_category WHERE ACTIVE=1 ORDER BY CATEGORY ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT CAGE CATEGORY
pageRouter.put('/cage_category/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtCategory
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE cage_category SET  CATEGORY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtCategory, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating cage category:', err);
			res.status(500).send('Error updating cage category');
			return;
		}

		res.send('Cage category updated successfully');
	});
});


// DELETE CAGE CATEGORY
pageRouter.put('/cage_category/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE cage_category SET  ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating cage category:', err);
			res.status(500).send('Error updating cage category');
			return;
		}

		res.send('Cage category updated successfully');
	});
});


// ADD CAPITAL CATEGORY
pageRouter.post('/add_capital_category', (req, res) => {
	const {
		txtCategory
	} = req.body;
	let date_now = new Date();



	const query = `INSERT INTO capital_category(CATEGORY, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtCategory, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting Capital Category', err);
			res.status(500).send('Error inserting Capital Category');
			return;
		}
		res.redirect('/capital_category');
	});
});

// GET CAPITAL CATEGORY
pageRouter.get('/capital_category_data', (req, res) => {
	connection.query('SELECT * FROM capital_category WHERE ACTIVE=1 ORDER BY CATEGORY ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT CAPITAL CATEGORY
pageRouter.put('/capital_category/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtCategory
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE capital_category SET  CATEGORY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtCategory, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating cage category:', err);
			res.status(500).send('Error updating cage category');
			return;
		}

		res.send('Capital category updated successfully');
	});
});


// DELETE CAPITAL CATEGORY
pageRouter.put('/capital_category/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE capital_category SET  ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating capital category:', err);
			res.status(500).send('Error updating capital category');
			return;
		}

		res.send('Capital category updated successfully');
	});
});


// ADD Concierge CATEGORY
pageRouter.post('/add_concierge_category', (req, res) => {
	const {
		txtCategory
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO concierge_category(CATEGORY, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtCategory, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting Concierge Category', err);
			res.status(500).send('Error inserting Concierge Category');
			return;
		}
		res.redirect('/concierge_category');
	});
});

// GET Concierge CATEGORY
pageRouter.get('/concierge_category_data', (req, res) => {
	connection.query('SELECT * FROM concierge_category WHERE ACTIVE=1 ORDER BY CATEGORY ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT Concierge CATEGORY
pageRouter.put('/concierge_category/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtCategory
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE concierge_category SET  CATEGORY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtCategory, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Concierge category:', err);
			res.status(500).send('Error updating Concierge category');
			return;
		}

		res.send('Concierge category updated successfully');
	});
});


// DELETE Concierge CATEGORY
pageRouter.put('/concierge_category/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE concierge_category SET  ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Concierge category:', err);
			res.status(500).send('Error updating Concierge category');
			return;
		}

		res.send('Concierge category updated successfully');
	});
});


// ADD CREDIT STATUS
pageRouter.post('/add_credit_status', (req, res) => {
	const {
		txtCreditStatus
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO credit_status(STATUS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtCreditStatus, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting Credit Status', err);
			res.status(500).send('Error inserting Credit Status');
			return;
		}
		res.redirect('/credit_status');
	});
});

// GET CREDIT STATUS
pageRouter.get('/credit_status_data', (req, res) => {
	connection.query('SELECT * FROM credit_status WHERE ACTIVE=1 ORDER BY STATUS ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT CREDIT STATUS
pageRouter.put('/credit_status/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtCreditStatus
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE credit_status SET  STATUS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtCreditStatus, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Credit Status:', err);
			res.status(500).send('Error updating Credit Status');
			return;
		}

		res.send('Credit Status updated successfully');
	});
});


// DELETE CREDIT STATUS
pageRouter.put('/credit_status/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE credit_status SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Credit Status:', err);
			res.status(500).send('Error updating Credit Status');
			return;
		}

		res.send('Credit Status updated successfully');
	});
});


// ADD EXPENSE CATEGORY
pageRouter.post('/add_expense_category', (req, res) => {
	const {
		txtCategory
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO expense_category(CATEGORY, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtCategory, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting Expense Category', err);
			res.status(500).send('Error inserting Expense Category');
			return;
		}
		res.redirect('/expense_category');
	});
});

// GET EXPENSE CATEGORY
pageRouter.get('/expense_category_data', (req, res) => {
	connection.query('SELECT * FROM expense_category WHERE ACTIVE=1 ORDER BY CATEGORY ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT EXPENSE CATEGORY
pageRouter.put('/expense_category/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtCategory
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE expense_category SET  CATEGORY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtCategory, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Expense category:', err);
			res.status(500).send('Error updating Expense category');
			return;
		}

		res.send('Expense category updated successfully');
	});
});


// DELETE EXPENSE CATEGORY
pageRouter.put('/expense_category/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE expense_category SET  ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Expense category:', err);
			res.status(500).send('Error updating Expense category');
			return;
		}

		res.send('Expense category updated successfully');
	});
});


// ADD TRASACTION TYPE
pageRouter.post('/add_transaction_type', (req, res) => {
	const {
		txtTransactionType
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO transaction_type(TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtTransactionType, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting Transaction Type', err);
			res.status(500).send('Error inserting Transaction Type');
			return;
		}
		res.redirect('/transaction_type');
	});
});

// GET TRASACTION TYPE
pageRouter.get('/transaction_type_data', (req, res) => {
	connection.query('SELECT * FROM transaction_type WHERE ACTIVE=1 ORDER BY TRANSACTION ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT TRASACTION TYPE
pageRouter.put('/transaction_type/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtTransactionType
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE transaction_type SET  TRANSACTION = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtTransactionType, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Transaction Type:', err);
			res.status(500).send('Error updating Transaction Type');
			return;
		}

		res.send('Transaction Type updated successfully');
	});
});


// DELETE TRASACTION TYPE
pageRouter.put('/transaction_type/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE transaction_type SET  ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Transaction Type:', err);
			res.status(500).send('Error updating Transaction Type');
			return;
		}

		res.send('Transaction Type updated successfully');
	});
});


// ADD CASH DENOMINATION
pageRouter.post('/add_cash', (req, res) => {
	const {
		txtDenomination
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO cash(DENOMINATION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtDenomination, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting cash', err);
			res.status(500).send('Error inserting cash');
			return;
		}
		res.redirect('/cash');
	});
});

// GET CASH DENOMINATION
pageRouter.get('/cash_data', (req, res) => {
	connection.query('SELECT * FROM cash WHERE ACTIVE=1 ORDER BY DENOMINATION ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT CASH DENOMINATION
pageRouter.put('/cash/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtDenomination,
		txtQTY
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE cash SET  DENOMINATION = ?, QTY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtDenomination, txtQTY, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating cash:', err);
			res.status(500).send('Error updating cash');
			return;
		}

		res.send('cash updated successfully');
	});
});


// DELETE CASH DENOMINATION
pageRouter.put('/cash/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE cash SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating cash:', err);
			res.status(500).send('Error updating cash');
			return;
		}

		res.send('cash updated successfully');
	});
});


// ADD CASH CHIPS DENOMINATION
pageRouter.post('/add_cash_chips', (req, res) => {
	const {
		txtDenomination
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO cash_chips(DENOMINATION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtDenomination, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting cash', err);
			res.status(500).send('Error inserting cash');
			return;
		}
		res.redirect('/cash_chips');
	});
});

// GET CASH CHIPS DENOMINATION
pageRouter.get('/cash_chips_data', (req, res) => {
	connection.query('SELECT * FROM cash_chips WHERE ACTIVE=1 ORDER BY DENOMINATION ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT CASH CHIPS DENOMINATION
pageRouter.put('/cash_chips/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtDenomination,
		txtQTY
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE cash_chips SET  DENOMINATION = ?, QTY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtDenomination, txtQTY, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating cash:', err);
			res.status(500).send('Error updating cash');
			return;
		}

		res.send('cash updated successfully');
	});
});


// DELETE CASH CHIPS DENOMINATION
pageRouter.put('/cash_chips/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE cash_chips SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating cash:', err);
			res.status(500).send('Error updating cash');
			return;
		}

		res.send('cash updated successfully');
	});
});


// ADD NON NEGOTIABLE DENOMINATION
pageRouter.post('/add_non_negotiable', (req, res) => {
	const {
		txtDenomination
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO non_negotiable(DENOMINATION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtDenomination, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting cash', err);
			res.status(500).send('Error inserting cash');
			return;
		}
		res.redirect('/non_negotiable_chips');
	});
});

// GET NON NEGOTIABLE DENOMINATION
pageRouter.get('/non_negotiable_data', (req, res) => {
	connection.query('SELECT * FROM non_negotiable WHERE ACTIVE=1 ORDER BY DENOMINATION ASC', (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT NON NEGOTIABLE DENOMINATION
pageRouter.put('/non_negotiable/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtDenomination,
		txtQTY
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE non_negotiable SET  DENOMINATION = ?, QTY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtDenomination, txtQTY, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Non negotiable:', err);
			res.status(500).send('Error updating Non negotiable');
			return;
		}

		res.send('Non negotiable updated successfully');
	});
});


// DELETE NON NEGOTIABLE DENOMINATION
pageRouter.put('/non_negotiable/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE non_negotiable SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Non negotiable:', err);
			res.status(500).send('Error updating Non negotiable');
			return;
		}

		res.send('Non negotiable updated successfully');
	});
});



// ADD JUNKET CAPITAL 
pageRouter.post('/add_junket_capital', (req, res) => {
	const {
		txtFullname,
		txtAmount,
		Remarks,
		optWithdrawDeposit,
		description // Get the description value from the form
	} = req.body;
	let date_now = new Date();
	let txtAmount2 = parseFloat(String(txtAmount ?? '').replace(/,/g, ''));
	if (!Number.isFinite(txtAmount2) || txtAmount2 <= 0) {
		return res.status(400).send('Enter a valid amount greater than zero.');
	}
	const query = `INSERT INTO junket_capital(TRANSACTION_ID, FULLNAME, DESCRIPTION, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
	connection.query(query, [optWithdrawDeposit, txtFullname, description, txtAmount2, Remarks, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket', err);
			res.status(500).send('Error inserting junket');
			return;
		}
		res.redirect('/dashboard');
	});
});



pageRouter.get('/junket_capital_data', (req, res) => {
	// Get the start_date and end_date from the query parameters
	const { start_date, end_date } = req.query;

	// Validate if start_date and end_date are provided
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
                NULL AS TOTAL_CHIPS, 
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
                NULL AS GAME_ID
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
                NULL AS GAME_ID
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
                NULL AS REMARKS, 
                NULL AS CAGE_TYPE,  
                NULL AS GAME_ID
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
                NULL AS GAME_ID
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
                gr.GAME_ID
            FROM game_record gr
            LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo 
            WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 1 AND gr.TRANSACTION IN (1, 2) AND DATE(gr.ENCODED_DT) BETWEEN ? AND ?
        ) AS full_result;
    `;

	// Execute the query
	connection.query(query, [start_date, end_date, start_date, end_date, start_date, end_date, start_date, end_date, start_date, end_date], (error, results) => {
		if (error) {
			console.error('Error executing query:', error);
			return res.status(500).json({ error: 'Database error' });
		}
		res.json(results);
	});
});



// EDIT JUNKET CAPITAL 
pageRouter.put('/junket_capital/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtTrans,
		txtCategory,
		txtFullname,
		txtDescription,
		txtAmount,
		Remarks
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE junket_capital SET FULLNAME = ?, AMOUNT = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtFullname, txtAmount, Remarks, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Junket:', err);
			res.status(500).send('Error updating Junket');
			return;
		}

		res.send('Junket updated successfully');
	});
});


// DELETE JUNKET CAPITAL AND TOTAL CHIPS
pageRouter.put('/junket_capital/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query1 = `UPDATE junket_capital SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query1, [0, req.session.user_id, date_now, id], (err, result) => {

		const query2 = `UPDATE junket_total_chips SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		connection.query(query2, [0, req.session.user_id, date_now, id], (err, result) => {
			if (err) {
				console.error('Error updating Junket:', err);
				res.status(500).send('Error updating Junket');
				return;
			}

			res.send('Junket updated successfully');
		});
	});
});

// START JUNKET EXPENSE
// ADD JUNKET EXPENSE
pageRouter.post('/add_junket_house_expense', uploadReceiptImg.single('photo'), (req, res) => {
	const {
		txtCategory,
		txtReceiptNo,
		txtDateandTime,
		txtDescription,
		txtAmount
	} = req.body;

	let date_now = new Date();
	let txtEXamount = txtAmount.split(',').join("");

	// Kunin ang filename ng na-upload na receipt image (ito ang isesave sa column na PHOTO)
	const receiptFileName = req.file ? req.file.filename : null;

	// I-update ang query para isama ang PHOTO column
	const query = `INSERT INTO junket_house_expense (CATEGORY_ID, RECEIPT_NO, DATE_TIME, DESCRIPTION, AMOUNT, PHOTO, ENCODED_BY, ENCODED_DT)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
	connection.query(query, [txtCategory, txtReceiptNo, txtDateandTime, txtDescription, txtEXamount, receiptFileName, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket', err);
			res.status(500).send('Error inserting junket');
			return;
		}
		res.redirect('/house_expense');
	});
});

// GET JUNKET EXPENSE
pageRouter.get('/junket_house_expense_data', (req, res) => {


	let { fromDate, toDate } = req.query;

	// Default dates if none provided
	if (!fromDate || !toDate) {
		const currentDate = new Date();
		const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
		fromDate = firstDayOfMonth.toISOString().slice(0, 10);
		toDate = currentDate.toISOString().slice(0, 10);
	}

	// Validate date format
	const isValidDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date);
	if (!isValidDate(fromDate) || !isValidDate(toDate)) {
		return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
	}



	const query = `
        SELECT 
            e.IDNo,
            e.CATEGORY_ID,
            e.RECEIPT_NO COLLATE utf8mb4_unicode_ci AS RECEIPT_NO,
            e.DATE_TIME,
            e.DESCRIPTION COLLATE utf8mb4_unicode_ci AS DESCRIPTION,
            e.AMOUNT,
            e.PHOTO COLLATE utf8mb4_unicode_ci AS PHOTO,
            e.ENCODED_BY,
            e.ENCODED_DT,
            e.EDITED_BY,
            e.EDITED_DT,
            e.ACTIVE,
            e.RESET,
            (SELECT COUNT(*) FROM junket_house_expense_edit_log el WHERE el.EXPENSE_ID = e.IDNo) AS EDIT_LOG_COUNT,
            e.IDNo AS expense_id,
            ec.IDNo AS expense_category_id,
            ec.CATEGORY COLLATE utf8mb4_unicode_ci AS expense_category,
            ec.TYPE AS expense_type,
            u.FIRSTNAME COLLATE utf8mb4_unicode_ci AS FIRSTNAME,
            'expense' COLLATE utf8mb4_unicode_ci AS record_type
        FROM junket_house_expense e
        JOIN expense_category ec ON ec.IDNo = e.CATEGORY_ID
        JOIN user_info u ON u.IDNo = e.ENCODED_BY
        WHERE e.ACTIVE = 1
          AND DATE(e.ENCODED_DT) BETWEEN ? AND ?
        
        ORDER BY ENCODED_DT DESC
    `;



	connection.query(query, [fromDate, toDate], (error, result) => {
		if (error) {
			console.error('Error executing query:', error);
			console.error('Query:', query);
			console.error('Parameters:', [fromDate, toDate]);
			return res.status(500).json({ error: 'Internal Server Error', details: error.message });
		}

		console.log(`[junket_house_expense_data] Found ${result.length} total records`);

		const updatedResult = result.map(expense => ({
			...expense,
			photoUrl: expense.PHOTO ? '/ReceiptUpload/' + expense.PHOTO : null
		}));

		res.json(updatedResult);
	});
});

function coerceJunketXlsxNumericCell(raw) {
	if (raw == null || raw === '') return '';
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

function houseExpenseExportBodyAlignment(header) {
	const h = String(header || '').toUpperCase().replace(/\s+/g, ' ').trim();
	if (h.includes('AMOUNT')) {
		return { vertical: 'middle', horizontal: 'right', indent: 1, wrapText: false };
	}
	return { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false };
}

function houseExpenseExportDisplayWidth(value) {
	return Array.from(String(value == null ? '' : value).replace(/\r?\n/g, ' ')).reduce((sum, ch) => {
		return sum + (ch.charCodeAt(0) > 255 ? 2 : 1);
	}, 0);
}

/** Client sends rows without ACTION (last column). */
pageRouter.post('/house_expense/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename } = req.body || {};
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
		const ws = workbook.addWorksheet('Junket Expenses', {
			views: [{ state: 'frozen', ySplit: 1 }]
		});

		const headerRow = ws.addRow(headers.map((h) => (h == null ? '' : String(h))));
		headerRow.height = 22;
		headerRow.eachCell((cell, colNumber) => {
			cell.font = { bold: true };
			cell.alignment = houseExpenseExportBodyAlignment(headers[colNumber - 1]);
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
				return coerceJunketXlsxNumericCell(v);
			});
			const dataRow = ws.addRow(padded);
			dataRow.eachCell((cell, colNumber) => {
				cell.border = thinBorder;
				cell.alignment = houseExpenseExportBodyAlignment(headers[colNumber - 1]);
			});
		});

		const colMaxLens = headers.map((h, c) => {
			const headerText = String(h == null ? '' : h);
			const upperHeader = headerText.toUpperCase();
			const isDescription = upperHeader.includes('DESCRIPTION');
			const isReceiptNo = upperHeader.includes('RECEIPT');
			const isDateTime = upperHeader.includes('DATE');
			let m = houseExpenseExportDisplayWidth(headerText);
			for (let ri = 0; ri < rows.length; ri++) {
				const row = rows[ri];
				if (!Array.isArray(row) || row[c] == null) continue;
				const L = houseExpenseExportDisplayWidth(row[c]);
				if (L > m) m = L;
			}
			const minWidth = isDescription ? 24 : (isReceiptNo || isDateTime ? 18 : 12);
			const maxWidth = isDescription ? 100 : 60;
			return Math.min(maxWidth, Math.max(minWidth, m + 4));
		});
		for (let i = 1; i <= ncol; i++) {
			const col = ws.getColumn(i);
			col.width = colMaxLens[i - 1];
		}

		applyCommaThousandsToNumericCells(ws);

		const buffer = await workbook.xlsx.writeBuffer();
		let outName = 'Junket_Expenses-export.xlsx';
		if (filename && typeof filename === 'string') {
			const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
			if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
			else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
		}
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('house_expense/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

/** 1-based column index for ROLLING RATE (Excel percent type = no green "number as text" warning). */
function commissionExportRollingRateCol1Based(headers) {
	for (let i = 0; i < (headers || []).length; i++) {
		const u = String(headers[i] || '').toUpperCase().replace(/\s+/g, ' ');
		if (u.includes('ROLLING') && u.includes('RATE')) return i + 1;
	}
	return 7;
}

function commissionExportBodyAlignment(header) {
	const h = String(header || '').toUpperCase().replace(/\s+/g, ' ').trim();
	if (h.includes('ACCOUNT NAME') || h.includes('DATE')) {
		return { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
	}
	if (h.includes('GAME') || h.includes('RANKING')) {
		return { vertical: 'middle', horizontal: 'center', wrapText: true };
	}
	return { vertical: 'middle', horizontal: 'right', indent: 1, wrapText: true };
}

/** Commission table export (all columns; no action column on page). */
pageRouter.post('/commission/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename } = req.body || {};
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
		const rollingRateCol1Based = commissionExportRollingRateCol1Based(headers);
		const thinBorder = {
			top: { style: 'thin', color: { argb: 'FF666666' } },
			left: { style: 'thin', color: { argb: 'FF666666' } },
			bottom: { style: 'thin', color: { argb: 'FF666666' } },
			right: { style: 'thin', color: { argb: 'FF666666' } }
		};

		const workbook = new ExcelJS.Workbook();
		const ws = workbook.addWorksheet('Commission', {
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
				if (i === rollingRateCol1Based - 1) {
					const s = String(v).trim();
					const m = s.match(/^([-+]?[\d,]*\.?\d+)\s*%$/);
					if (m) {
						const n = parseFloat(m[1].replace(/,/g, ''));
						if (Number.isFinite(n)) return n / 100;
					}
				}
				return coerceJunketXlsxNumericCell(v);
			});
			const dataRow = ws.addRow(padded);
			dataRow.eachCell((cell, colNumber) => {
				cell.border = thinBorder;
				cell.alignment = commissionExportBodyAlignment(headers[colNumber - 1]);
				if (colNumber === rollingRateCol1Based) {
					const orig = arr[colNumber - 1];
					const s = orig == null ? '' : String(orig).trim();
					if (/^[-+]?[\d,]*\.?\d+\s*%$/.test(s) && typeof cell.value === 'number') {
						cell.numFmt = '0.00%';
					}
				}
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
		}

		applyCommaThousandsToNumericCells(ws);

		const buffer = await workbook.xlsx.writeBuffer();
		let outName = 'Commission-export.xlsx';
		if (filename && typeof filename === 'string') {
			const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
			if (base && /\.xlsx$/i.test(base)) outName = base.slice(0, 180);
			else if (base) outName = base.replace(/\.+$/g, '').slice(0, 160) + '.xlsx';
		}
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('commission/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

// EDIT JUNKET EXPENSE (kasama ang file upload para sa PHOTO kung sakali nagkamali ang upload)
pageRouter.put('/junket_house_expense/:id', uploadReceiptImg.single('photo'), (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtCategory,
		txtReceiptNo,
		txtDateandTime,
		txtDescription,
		txtAmount
		// txtOfficerInCharge kung kinakailangan
	} = req.body;
	let date_now = new Date();
	let editXAmount = txtAmount.split(',').join("");
	const safeDateTime = txtDateandTime || null;

	// Kung may na-upload na bagong file, isama ito sa update query (PHOTO column)
	if (req.file) {
		const query = `UPDATE junket_house_expense 
                       SET CATEGORY_ID = ?, RECEIPT_NO = ?, DATE_TIME = ?, DESCRIPTION = ?, AMOUNT = ?, PHOTO = ?, EDITED_BY = ?, EDITED_DT = ? 
                       WHERE IDNo = ?`;
		connection.query(query, [txtCategory, txtReceiptNo, safeDateTime, txtDescription, editXAmount, req.file.filename, req.session.user_id, date_now, id], (err, result) => {
			if (err) {
				console.error('Error updating Junket:', err);
				res.status(500).send('Error updating Junket');
				return;
			}
			res.send('Junket updated successfully');
		});
	} else {
		// Kung walang bagong file, hindi babaguhin ang PHOTO column
		const query = `UPDATE junket_house_expense 
                       SET CATEGORY_ID = ?, RECEIPT_NO = ?, DATE_TIME = ?, DESCRIPTION = ?, AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? 
                       WHERE IDNo = ?`;
		connection.query(query, [txtCategory, txtReceiptNo, safeDateTime, txtDescription, editXAmount, req.session.user_id, date_now, id], (err, result) => {
			if (err) {
				console.error('Error updating Junket:', err);
				res.status(500).send('Error updating Junket');
				return;
			}
			res.send('Junket updated successfully');
		});
	}
});



// DELETE JUNKET EXPENSE
pageRouter.put('/junket_house_expense/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE junket_house_expense SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Junket:', err);
			res.status(500).send('Error updating Junket');
			return;
		}

		res.send('Junket updated successfully');
	});
});

// END JUNKET EXPENSE

// START CREDIT

// ADD JUNKET CREDIT
pageRouter.post('/add_junket_credit', (req, res) => {
	const {
		txtAccountCode,
		txtStatus,
		txtAmount,
		Remarks
	} = req.body;
	let date_now = new Date();
	let txtCREamount = txtAmount.split(',').join("");

	const query = `INSERT INTO junket_credit(ACCOUNT_ID, AMOUNT, REMARKS, STATUS_ID, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?)`;
	connection.query(query, [txtAccountCode, txtCREamount, Remarks, txtStatus, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket', err);
			res.status(500).send('Error inserting junket');
			return;
		}
		res.redirect('/house_expense');
	});
});

// GET JUNKET CREDIT
pageRouter.get('/junket_credit_data', (req, res) => {
	const query = `SELECT *, junket_credit.IDNo AS credit_id, agent.NAME AS account_name, junket_credit.REMARKS AS REMARKS, junket_credit.ENCODED_DT AS ENCODED_DT , user_info.FIRSTNAME AS FIRSTNAME
  FROM junket_credit 
  JOIN account ON account.IDNo = junket_credit.ACCOUNT_ID
  JOIN agent ON agent.IDNo = account.AGENT_ID
  JOIN agency ON agency.IDNo = agent.AGENCY
  JOIN credit_status ON credit_status.IDNo = junket_credit.STATUS_ID
  JOIN user_info ON user_info.IDNo = junket_credit.ENCODED_BY
  WHERE junket_credit.ACTIVE=1 ORDER BY junket_credit.IDNo DESC`;
	connection.query(query, (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT JUNKET CREDIT
pageRouter.put('/junket_credit/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtStatus,
		txtAmount,
		Remarks,
	} = req.body;
	let date_now = new Date();
	let CreAmount = txtAmount.split(',').join("");

	const query = `UPDATE junket_credit SET AMOUNT = ?, REMARKS = ?, STATUS_ID = ?,  EDITED_BY = ?, ENCODED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [CreAmount, Remarks, txtStatus, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Junket:', err);
			res.status(500).send('Error updating Junket');
			return;
		}

		res.send('Junket updated successfully');
	});
});


// DELETE JUNKET CREDIT
pageRouter.put('/junket_credit/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE junket_credit SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Junket:', err);
			res.status(500).send('Error updating Junket');
			return;
		}

		res.send('Junket updated successfully');
	});
});

// END CREDIT



// ADD JUNKET CONCIERGE
pageRouter.post('/add_junket_concierge', (req, res) => {
	const {
		txtCategory,
		txtDateTime,
		txtDescription,
		txtTransaction,
		txtAmount
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO junket_concierge(CONCIERGE_ID, DATE_TIME, DESCRIPTION, TRANSACTION_ID, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
	connection.query(query, [txtCategory, txtDateTime, txtDescription, txtTransaction, txtAmount, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket', err);
			res.status(500).send('Error inserting junket');
			return;
		}
		res.redirect('/house_expense');
	});
});

// GET JUNKET CONCIERGE
pageRouter.get('/junket_concierge_data', (req, res) => {
	const query = `SELECT *, junket_concierge.IDNo AS junket_concierge_id
  FROM junket_concierge 
  JOIN concierge_category ON concierge_category.IDNo = junket_concierge.CONCIERGE_ID
  JOIN transaction_type ON transaction_type.IDNo = junket_concierge.TRANSACTION_ID
  WHERE junket_concierge.ACTIVE=1 ORDER BY junket_concierge.IDNo DESC`;
	connection.query(query, (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT JUNKET CONCIERGE
pageRouter.put('/junket_concierge/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtCategory,
		txtDateTime,
		txtDescription,
		txtTransaction,
		txtAmount
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE junket_concierge SET CONCIERGE_ID = ?, DATE_TIME = ?, DESCRIPTION = ?, TRANSACTION_ID = ?, AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtCategory, txtDateTime, txtDescription, txtTransaction, txtAmount, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Junket:', err);
			res.status(500).send('Error updating Junket');
			return;
		}

		res.send('Junket updated successfully');
	});
});


// DELETE JUNKET CONCIERGE
pageRouter.put('/junket_concierge/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE junket_concierge SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Junket:', err);
			res.status(500).send('Error updating Junket');
			return;
		}

		res.send('Junket updated successfully');
	});
});



// ADD JUNKET CAGE
pageRouter.post('/add_junket_main_cage', (req, res) => {
	const {
		txtCategory,
		txtDateTime,
		txtTransaction,
		txtAmount
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO junket_main_cage(CAGE_ID, DATE_TIME, TRANSACTION_ID, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?)`;
	connection.query(query, [txtCategory, txtDateTime, txtTransaction, txtAmount, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket', err);
			res.status(500).send('Error inserting junket');
			return;
		}
		res.redirect('/house_expense');
	});
});

// GET JUNKET CAGE
pageRouter.get('/junket_main_cage_data', (req, res) => {
	const query = `SELECT *, junket_main_cage.IDNo AS junket_cage_id
  FROM junket_main_cage 
  JOIN cage_category ON cage_category.IDNo = junket_main_cage.CAGE_ID
  JOIN transaction_type ON transaction_type.IDNo = junket_main_cage.TRANSACTION_ID
  WHERE junket_main_cage.ACTIVE=1 ORDER BY junket_main_cage.IDNo DESC`;
	connection.query(query, (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// EDIT JUNKET CAGE
pageRouter.put('/junket_main_cage/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtCategory,
		txtDateTime,
		txtTransaction,
		txtAmount
	} = req.body;
	let date_now = new Date();


	const query = `UPDATE junket_main_cage SET CAGE_ID = ?, DATE_TIME = ?, TRANSACTION_ID = ?, AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtCategory, txtDateTime, txtTransaction, txtAmount, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Junket:', err);
			res.status(500).send('Error updating Junket');
			return;
		}

		res.send('Junket updated successfully');
	});
});


// DELETE JUNKET CAGE
pageRouter.put('/junket_main_cage/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE junket_main_cage SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Junket:', err);
			res.status(500).send('Error updating Junket');
			return;
		}

		res.send('Junket updated successfully');
	});
});
// Pool is now imported from config/db.js
// ADD ACCOUNT DETAILS 
pageRouter.post('/add_account_details', async (req, res) => {
	const {
		txtAccountId,
		txtTrans,
		txtAmount,
		txtRemarks,
		sendToTelegram, // Added to handle checkbox value
		totalBalanceGuest
	} = req.body;
	let date_now = new Date();


	let txtAmountNum = txtAmount.split(',').join('');

	// Set transaction description
	let transacDesc = 'ACCOUNT DETAILS';


	const insertQuery = `INSERT INTO  account_ledger(ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

	try {
		const transactionType = (txtTrans === '1' || txtTrans === '2') ? 2 : 3;
		const [insertResult] = await pool.query(insertQuery, [txtAccountId, txtTrans, transactionType, transacDesc, txtAmountNum, txtRemarks, req.session.user_id, date_now]);

		const transactionQuery = `
            SELECT transaction_type.TRANSACTION
            FROM account_ledger
            JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
            WHERE account_ledger.IDNo = ?
        `;

		const [transactionResults] = await pool.query(transactionQuery, [insertResult.insertId]);

		if (transactionResults.length > 0) {
			const transaction = transactionResults[0].TRANSACTION;

			const guestAccountNumQuery = `
                SELECT agent.AGENT_CODE 
                FROM agent
                JOIN account ON account.AGENT_ID = agent.IDNo
                JOIN account_ledger ON account_ledger.ACCOUNT_ID = account.IDNo 
                WHERE account.ACTIVE = 1 
                AND account_ledger.ACCOUNT_ID = ?
            `;
			const [guestAccountNumResults] = await pool.query(guestAccountNumQuery, [txtAccountId]);

			const guestNameQuery = `
                SELECT agent.NAME 
                FROM agent
                JOIN account ON account.AGENT_ID = agent.IDNo
                JOIN account_ledger ON account_ledger.ACCOUNT_ID = account.IDNo 
                WHERE account.ACTIVE = 1 
                AND account_ledger.ACCOUNT_ID = ?
            `;
			const [guestNameResults] = await pool.query(guestNameQuery, [txtAccountId]);

			// Fetch the TELEGRAM_ID based on txtAccountId
			const telegramIdQuery = `
                SELECT agent.TELEGRAM_ID 
                FROM agent
                JOIN account ON account.AGENT_ID = agent.IDNo
                JOIN account_ledger ON account_ledger.ACCOUNT_ID = account.IDNo 
                WHERE account.ACTIVE = 1 
                AND account_ledger.ACCOUNT_ID = ?
            `;


			const [telegramIdResults] = await pool.query(telegramIdQuery, [txtAccountId]);

			let time_now = new Date();
			time_now.setHours(time_now.getHours());
			let updated_time = time_now.toLocaleTimeString();
			let date_nowTG = new Date().toLocaleDateString();

			// Assuming these are your inputs
			let totalBalanceGuest = parseFloat(req.body.totalBalanceGuest.replace(/,/g, '')) || 0; // Ensure it’s a number
			let txtAmountNum = parseFloat(req.body.txtAmount.replace(/,/g, '')); // Convert to number

			// Determine totalBalance based on transaction type
			let totalBalance;
			if (txtTrans === '1') { // Deposit
				totalBalance = totalBalanceGuest + txtAmountNum;
			} else if (txtTrans === '2') { // Withdraw
				totalBalance = totalBalanceGuest - txtAmountNum;
			} else if (txtTrans === '3') { // Other
				totalBalance = totalBalanceGuest + txtAmountNum;
			}

			// Adjust for display
			const displayWithdraw = (txtTrans === '2') ? -txtAmountNum : txtAmountNum;

			if (telegramIdResults.length > 0 && guestAccountNumResults.length > 0 && guestNameResults.length > 0) {
				const telegramId = telegramIdResults[0].TELEGRAM_ID;
				const guestAccountNum = guestAccountNumResults[0].AGENT_CODE;
				const guestName = guestNameResults[0].NAME;

				// Reformat the amount with commas
				const formattedAmount = parseFloat(txtAmountNum).toLocaleString('en-US');

				const text = `Demo Cage\n\nAccount #: ${guestAccountNum}\nGuest: ${guestName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nTransaction: ${transaction}\nCurrency: PHP\nRemarks: ${txtRemarks}\n\nAmount: ${parseFloat(displayWithdraw).toLocaleString('en-US')}\nAccount Balance: ${parseFloat(totalBalance).toLocaleString('en-US')}`;

				if (sendToTelegram) {
					// Send the message to the guest's Telegram ID
					await sendTelegramMessage(text, telegramId);
					// Send to all additional chat IDs (groups/channels) — supports comma-separated CHAT_ID
					await sendTelegramToAdditionalChats(text);
				}

				res.send('Form submitted and message sent successfully!');
			} else {
				res.status(404).send('Telegram ID not found.');
			}
		} else {
			res.status(404).send('Transaction not found.');
		}
	} catch (error) {
		console.error('Error executing query or sending message:', error);
		res.status(500).send('Error processing request.');
	}
});


// Telegram outbound messages use utils/telegram (GUEST bot, DB logging, retries).


//TELEGRAM API
//Get TELEGRAM API - REMOVED: This route has been moved to routes/telegramData.js
// Old route commented out to prevent route conflicts
/*
pageRouter.get('/telegramAPI_data', (req, res) => {
	connection.query('SELECT * FROM telegram_api WHERE ACTIVE = 1', (error, results, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});
*/

// EDIT TELEGRAM API - REMOVED: This route has been moved to routes/telegramData.js
// The new route uses /telegramAPI/:userType (e.g., /telegramAPI/GUEST) instead of /telegramAPI/:id
// Old route commented out to prevent route conflicts
/*
pageRouter.put('/telegramAPI/:id', (req, res) => {
	const id = parseInt(req.params.id);
	
	// Validate that id is a valid number
	if (isNaN(id) || id <= 0) {
		res.status(400).send('Invalid ID parameter');
		return;
	}
	
	const {
		txtTelegramAPI
	} = req.body;
	let date_now = new Date();

	const query = `UPDATE telegram_api SET TELEGRAM_API = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtTelegramAPI, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Telegram API:', err);
			res.status(500).send('Error updating Telegram API');
			return;
		}

		res.send('Telegram API updated successfully');
	});
});
*/

// CHECK BALANCE - Removed duplicate bot code
// Telegram bot is now handled in utils/telegram.js to avoid conflicts



// ADD ACCOUNT DETAILS TRANSFER

pageRouter.post('/add_account_details/transfer', async (req, res) => {
	const {
		txtAccountId,
		txtAccount,
		txtAmount,
		txtTransferToBalance,
		txtTransferFromBalance
	} = req.body;
	let date_now = new Date();
	let txtAmountNum = txtAmount.split(',').join('');

	let totalAmount = parseFloat(txtAmountNum) || 0;

	const query = `INSERT INTO account_ledger(ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, TRANSFER, TRANSFER_AGENT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

	try {
		// Insert transaction details for both accounts
		await pool.query(query, [txtAccountId, 2, 2, txtAmountNum, 1, txtAccount, req.session.user_id, date_now]);
		await pool.query(query, [txtAccount, 1, 2, txtAmountNum, 1, txtAccountId, req.session.user_id, date_now]);

		// Fetch Telegram IDs, AGENT_CODE, and NAME for the account from which the transfer is made
		const telegramIdQueryFrom = `
            SELECT agent.TELEGRAM_ID, agent.AGENT_CODE, agent.NAME
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.IDNo = ?
        `;
		const [telegramIdResultsFrom] = await pool.query(telegramIdQueryFrom, [txtAccountId]);

		// Fetch Telegram IDs, AGENT_CODE, and NAME for the account to which the transfer is made
		const telegramIdQueryTo = `
            SELECT agent.TELEGRAM_ID, agent.AGENT_CODE, agent.NAME
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.IDNo = ?
        `;
		const [telegramIdResultsTo] = await pool.query(telegramIdQueryTo, [txtAccount]);

		// Prepare and send messages for the account from which the transfer is made
		if (telegramIdResultsFrom.length > 0) {
			for (const resultFrom of telegramIdResultsFrom) {
				const { TELEGRAM_ID: TELEGRAM_ID_FROM, AGENT_CODE: AGENT_CODE_FROM, NAME: NAME_FROM } = resultFrom;

				const SenderCurrentBalance = txtTransferFromBalance - totalAmount;

				let time_now = new Date();
				time_now.setHours(time_now.getHours());
				let updated_time = time_now.toLocaleTimeString();
				let date_nowTG = new Date().toLocaleDateString();

				// Prepare message with "From" account details and "To" account details
				const textFrom = `Demo Cage\n\nTransfer Details:\n\nTransferred to Account: ${telegramIdResultsTo.length > 0 ? telegramIdResultsTo[0].AGENT_CODE : 'N/A'} - ${telegramIdResultsTo.length > 0 ? telegramIdResultsTo[0].NAME : 'N/A'}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nAmount Transferred: -${txtAmount}\nAccount Balance: ${parseFloat(SenderCurrentBalance).toLocaleString('en-US')}`;

				await sendTelegramMessage(textFrom, TELEGRAM_ID_FROM);
				await sendTelegramToAdditionalChats(textFrom);
			}
		}

		// Prepare and send messages for the account to which the transfer is made																												
		if (telegramIdResultsTo.length > 0) {
			for (const resultTo of telegramIdResultsTo) {
				const { TELEGRAM_ID: TELEGRAM_ID_TO, AGENT_CODE: AGENT_CODE_TO, NAME: NAME_TO } = resultTo;

				const ReceiverCurrentBalance = parseFloat(txtTransferToBalance) + parseFloat(totalAmount);

				let time_now = new Date();
				time_now.setHours(time_now.getHours());
				let updated_time = time_now.toLocaleTimeString();
				let date_nowTG = new Date().toLocaleDateString();

				// Prepare message with "From" account details and "To" account details
				const textTo = `Demo Cage\n\nTransfer Details:\n\nTransferred from Account: ${telegramIdResultsFrom.length > 0 ? telegramIdResultsFrom[0].AGENT_CODE : 'N/A'} - ${telegramIdResultsFrom.length > 0 ? telegramIdResultsFrom[0].NAME : 'N/A'}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nAmount Transferred: ${txtAmount}\nAccount Balance: ${parseFloat(ReceiverCurrentBalance).toLocaleString('en-US')}`;

				await sendTelegramMessage(textTo, TELEGRAM_ID_TO);
				await sendTelegramToAdditionalChats(textTo);
			}
		}

		res.redirect('/account_ledger');
	} catch (error) {
		console.error('Error inserting details or sending message:', error);
		res.status(500).send('Error processing request.');
	}
});


// GET ACCOUNT DETAILS
// pageRouter.get('/account_details_data/:id', (req, res) => {
// 	const id = parseInt(req.params.id);
// 	const query = `SELECT *, account_ledger.IDNo AS account_details_id, account_ledger.ENCODED_DT AS encoded_date FROM account_ledger 
//   JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
//   WHERE account_ledger.ACTIVE=1 AND account_ledger.ACCOUNT_ID= ? ORDER BY account_ledger.IDNo DESC`;
// 	connection.query(query, [id], (error, result, fields) => {
// 		if (error) {
// 			console.error('Error fetching data:', error);
// 			res.status(500).send('Error fetching data');
// 			return;
// 		}
// 		res.json(result);
// 	});
// });
pageRouter.get('/account_details_data/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const query = `SELECT *, account_ledger.IDNo AS account_details_id, account_ledger.ENCODED_DT AS encoded_date, agent.AGENT_CODE, agent.NAME
						FROM account_ledger 
						JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID 
						JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID 
						JOIN agent ON agent.IDNo = account.AGENT_ID 
					WHERE account_ledger.ACTIVE=1 AND account_ledger.ACCOUNT_ID = ? ORDER BY account_ledger.IDNo DESC`;
	connection.query(query, [id], (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});


// GET ACCOUNT DETAILS DEPOSIT
pageRouter.get('/account_details_data_deposit/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const query = `SELECT *, account_ledger.IDNo AS account_details_id, account_ledger.ENCODED_DT AS encoded_date 
					FROM account_ledger 
					JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
					WHERE account_ledger.ACTIVE = 1 
					AND account_ledger.TRANSACTION_TYPE IN (2, 5, 3) 
					AND account_ledger.ACCOUNT_ID = ? 
					ORDER BY account_ledger.IDNo DESC`;
	connection.query(query, [id], (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

// GET ACCOUNT DETAILS PASSPORTPHOTO

pageRouter.get('/account_passportphoto_data/:account_id', (req, res) => {
	const accountId = req.params.account_id;
	const query = `SELECT 
                        account.*, 
                        agent.NAME AS account_name, 
                    	agent.AGENT_CODE AS agent_code,
                        agent.PHOTO AS PASSPORTPHOTO 
                    FROM 
                        account 
                    LEFT JOIN 
                        agent ON agent.IDNo = account.AGENT_ID 
                    WHERE 
                        account.IDNo = ?
`;
	connection.query(query, [accountId], (error, result) => {
		if (error) {
			console.error('Error fetching account data:', error);
			res.status(500).send('Error fetching account data');
			return;
		}
		res.json(result); // Ensure this includes account_name
	});
});

// DELETE ACCOUNT DETAILS
pageRouter.put('/account_details/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE account_ledger SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating Details:', err);
			res.status(500).send('Error updating Details');
			return;
		}

		res.send('Details updated successfully');
	});
});

// ADD GAME LIST
pageRouter.post('/add_game_list', (req, res) => {
	const {
		txtAccountCode,
		txtGameNo,
		txtAmount,
		txtGameType,
		txtNN,
		txtCC,
		txtTransType,
		txtGuestId,
		txtCommisionType,
		txtCommisionRate,
		totalBalanceGuest1,
		txtProgramDate
	} = req.body;
	const rawGameDate = txtProgramDate == null ? '' : String(txtProgramDate).trim();
	let date_now = new Date();
	const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawGameDate);
	const dateTime = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(rawGameDate);
	if (dateOnly || dateTime) {
		const parts = rawGameDate.slice(0, 10).split('-').map((n) => parseInt(n, 10));
		const y = parts[0];
		const mo = parts[1];
		const d = parts[2];
		let hours = 0;
		let minutes = 0;
		let seconds = 0;
		let ms = 0;
		if (dateTime) {
			const tp = rawGameDate.slice(11).trim().split(':').map((n) => parseInt(n, 10));
			if (Number.isFinite(tp[0]) && Number.isFinite(tp[1])) {
				hours = tp[0];
				minutes = tp[1];
			}
		} else {
			const now = new Date();
			hours = now.getHours();
			minutes = now.getMinutes();
			seconds = now.getSeconds();
			ms = now.getMilliseconds();
		}
		const dt = new Date(y, mo - 1, d, hours, minutes, seconds, ms);
		if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) {
			date_now = dt;
		}
	}

	let txtNNamount = txtNN.split(',').join("");
	let txtCCamount = txtCC.split(',').join("");

	//TRANSACTION DETAILS
	let StartBuyinDESC = 'INITIAL BUY-IN';

	if (txtNNamount == '') {
		txtNNamount = 0;
	}

	if (txtCCamount == '') {
		txtCCamount = 0;
	}

	// Define the description based on the transaction type

	let initialMOP;
	if (txtTransType === '1') {  // 1 corresponds to Cash
		initialMOP = 'CASH';
	} else if (txtTransType === '2') {  // 2 corresponds to Deposit
		initialMOP = 'DEPOSIT';
	} else if (txtTransType === '3') {  // 3 corresponds to Marker
		initialMOP = 'IOU';
	} else {
		// Handle the case where no valid txtTransType is selected (optional)
		return res.status(400).send('Invalid transaction type');
	}


	const guestId = parseInt(txtGuestId, 10) || null;
	const query = `INSERT INTO game_list(ACCOUNT_ID, GUEST_ID, GAME_TYPE, INITIAL_MOP, GAME_NO, COMMISSION_TYPE, COMMISSION_PERCENTAGE, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
	connection.query(query, [txtAccountCode, guestId, txtGameType, initialMOP, txtGameNo, txtCommisionType, txtCommisionRate, req.session.user_id, date_now], async (err, result) => {
		if (err) {
			console.error('Error inserting into game_list:', err);
			res.status(500).send('Error inserting details');
			return;
		}

		const queries = []; // Array to hold the promises for account_ledger inserts


		const query2 = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		connection.query(query2, [result.insertId, date_now, 1, 0, txtNNamount, txtCCamount, txtTransType, req.session.user_id, date_now], (err) => {
			if (err) {
				console.error('Error inserting into game_record', err);
				res.status(500).send('Error inserting details');
				return;
			}

			const query3 = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
			connection.query(query3, [result.insertId, date_now, 3, 0, txtNNamount, txtCCamount, txtTransType, req.session.user_id, date_now], async (err) => {
				if (err) {
					console.error('Error inserting into game_record', err);
					res.status(500).send('Error inserting details');
					return;
				}

				if (txtTransType == 2) {
					const query4 = `INSERT INTO account_ledger (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
					queries.push(new Promise((resolve, reject) => {
						connection.query(query4, [txtAccountCode, 2, txtTransType, StartBuyinDESC, parseFloat(txtNNamount) + parseFloat(txtCCamount), req.session.user_id, date_now], (err) => {
							if (err) {
								console.error('Error inserting into account_ledger', err);
								reject('Error inserting details');
							} else {
								resolve();
							}
						});
					}));
				}

				if (txtTransType == 3) {
					const query5 = `INSERT INTO account_ledger (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?)`;
					queries.push(new Promise((resolve, reject) => {
						connection.query(query5, [txtAccountCode, 10, txtTransType, parseFloat(txtNNamount) + parseFloat(txtCCamount), req.session.user_id, date_now], (err) => {
							if (err) {
								console.error('Error inserting into another_table', err);
								reject('Error inserting details');
							} else {
								resolve();
							}
						});
					}));
				}

				try {
					await Promise.all(queries);

					// Fetch AGENT_CODE and NAME
					const agentQuery = `
						SELECT agent.AGENT_CODE, agent.NAME
						FROM agent
						JOIN account ON account.AGENT_ID = agent.IDNo
						WHERE account.ACTIVE = 1 AND account.IDNo = ?
					`;
					connection.query(agentQuery, [txtAccountCode], async (err, agentResults) => {
						if (err) {
							console.error('Error fetching agent details', err);
							res.status(500).send('Error fetching agent details');
							return;
						}

						if (agentResults.length > 0) {
							const agentCode = agentResults[0].AGENT_CODE;
							const agentName = agentResults[0].NAME;

							// Fetch TELEGRAM_ID
							const telegramIdQuery = `
								SELECT agent.TELEGRAM_ID 
								FROM agent
								JOIN account ON account.AGENT_ID = agent.IDNo
								WHERE account.ACTIVE = 1 AND account.IDNo = ?
							`;
							connection.query(telegramIdQuery, [txtAccountCode], async (err, telegramIdResults) => {
								if (err) {
									console.error('Error fetching telegram ID', err);
									res.status(500).send('Error fetching telegram ID');
									return;
								}

								let text = '';
								const totalAmount = parseFloat(txtNNamount) + parseFloat(txtCCamount);
								let time_now = new Date();
								time_now.setHours(time_now.getHours());
								let updated_time = time_now.toLocaleTimeString();
								let date_nowTG = new Date().toLocaleDateString();

								// Conditions for different txtTransType values
								if (txtTransType == 2) {
									const newTotalBalance = totalBalanceGuest1 - totalAmount;
									text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nGame Start \nGame #: ${result.insertId} - ${txtGameType} \nBuy-in: -${parseFloat(totalAmount).toLocaleString('en-US')}\nAccount Balance: ${parseFloat(newTotalBalance).toLocaleString('en-US')}`;

								} else if (txtTransType == 1) {
									text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nGame Start - Cash\nGame #: ${result.insertId} - ${txtGameType}\nBuy-in: ${parseFloat(totalAmount).toLocaleString('en-US')}`;

								} else if (txtTransType == 3) {
									text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nGame Start - IOU\nGame #: ${result.insertId} - ${txtGameType}\nBuy-in: ${parseFloat(totalAmount).toLocaleString('en-US')}`;
								}

								// Send Telegram message if text is set and telegramId is available
								if (text !== '' && telegramIdResults.length > 0) {
									const telegramId = telegramIdResults[0].TELEGRAM_ID;
									await sendTelegramMessage(text, telegramId); // Send to agent's Telegram ID
									await sendTelegramToAdditionalChats(text);
								} else if (telegramIdResults.length === 0) {
									console.error("No TELEGRAM_ID found for Account Code:", txtAccountCode);
								}
							});
						}
						else {
							console.error("No AGENT_CODE or NAME found for Account Code:", txtAccountCode);
						}


						res.redirect('/game_list');
					});
				} catch (error) {
					res.status(500).send(error);
				}
			});
		});
	});
});




// // GET GAME LIST
// pageRouter.get('/game_list_data', (req, res) => {
// 	const query = `SELECT *, game_list.IDNo AS game_list_id, game_list.ACTIVE AS game_status, account.IDNo AS account_no, agent.AGENT_CODE AS agent_code, agent.NAME AS agent_name,  game_list.ENCODED_DT AS GAME_DATE_START FROM game_list
// 	JOIN account ON game_list.ACCOUNT_ID = account.IDNo
// 	JOIN agent ON agent.IDNo = account.AGENT_ID
// 	JOIN agency ON agency.IDNo = agent.AGENCY
//   	WHERE game_list.ACTIVE != 0 ORDER BY game_list.IDNo ASC`;
// 	connection.query(query, (error, result, fields) => {
// 		if (error) {
// 			console.error('Error fetching data:', error);
// 			res.status(500).send('Error fetching data');
// 			return;
// 		}
// 		res.json(result);
// 	});
// });

// GET /game_list_data — handled by routes/gamebook.js (PROGRAM_DATE + game start date range).



pageRouter.get('/commission_data', (req, res) => {
	console.log('Received request for /commission_data');

	// Get start and end from the query parameters
	let { start, end } = req.query;

	// Use default dates if start or end is not provided
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

	// Log start and end dates for debugging
	console.log('Start:', start, 'End:', end);

	// SQL query with date filtering
	const query = `
        SELECT *, 
            game_list.IDNo AS game_list_id, 
            game_list.ACTIVE AS game_status, 
            game_list.FNB AS fnb, 
            game_list.PAYMENT AS payment,  
            account.IDNo AS account_no, 
            agent.AGENT_CODE AS agent_code, 
            agent.NAME AS agent_name 
        FROM game_list 
        JOIN account ON game_list.ACCOUNT_ID = account.IDNo
        JOIN agent ON agent.IDNo = account.AGENT_ID
        JOIN agency ON agency.IDNo = agent.AGENCY
        WHERE game_list.ACTIVE != 0 
          AND DATE(game_list.ENCODED_DT) BETWEEN ? AND ?
        ORDER BY game_list.IDNo ASC`;

	// Log the SQL query and parameters for debugging
	console.log('Query:', query);
	console.log('Parameters:', [start, end]);

	// Execute the query with start and end dates
	connection.query(query, [start, end], (error, result) => {
		if (error) {
			console.error('Error executing query:', error);
			res.status(500).send('Internal Server Error');
			return;
		}
		console.log('Query successful. Returning data.');
		res.json(result);
	});
});








pageRouter.get('/game_list/:id/record', (req, res) => {
	const id = parseInt(req.params.id);
	const query = `SELECT AMOUNT,NN_CHIPS,CC_CHIPS, CAGE_TYPE FROM game_record 
  	WHERE ACTIVE != 0 AND GAME_ID = ? ORDER BY IDNo ASC`;
	connection.query(query, [id], (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});


// DELETE GAME LIST
pageRouter.put('/game_list/remove/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE game_list SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating GAME LIST:', err);
			res.status(500).send('Error updating GAME LIST');
			return;
		}

		res.send('GAME LIST updated successfully');
	});
});

// STATUS GAME LIST
pageRouter.put('/game_list/change_status/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		let date_now = new Date();

		const {
			txtStatus,
			txtGameId,
			txtAccountCode,
			txtCapital,
			txtFinalChips,
			txtTotalRolling,
			txtWinloss
		} = req.body;

		const formattedWinloss = parseFloat(txtWinloss) || 0;
		const adjustedWinloss = formattedWinloss > 0 ? -formattedWinloss : Math.abs(formattedWinloss);

		// Update the game list status
		const query = `UPDATE game_list SET ACTIVE = ?, GAME_ENDED = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		connection.query(query, [txtStatus, date_now, req.session.user_id, date_now, id], async (err, result) => {
			if (err) {
				console.error('Error updating game status:', err);
				return res.status(500).send('Error updating game status');
			}

			// Only send the message if txtStatus equals 1
			if (txtStatus === "1") {
				// Fetch AGENT_CODE and NAME
				const agentQuery = `
					SELECT agent.AGENT_CODE, agent.NAME
					FROM agent
					JOIN account ON account.AGENT_ID = agent.IDNo
					WHERE account.ACTIVE = 1 AND account.IDNo = ?
				`;
				const [agentResults] = await pool.query(agentQuery, [txtAccountCode]);

				if (agentResults.length > 0) {
					const agentCode = agentResults[0].AGENT_CODE;
					const agentName = agentResults[0].NAME;

					// Fetch TELEGRAM_ID
					const telegramIdQuery = `
						SELECT agent.TELEGRAM_ID 
						FROM agent
						JOIN account ON account.AGENT_ID = agent.IDNo
						WHERE account.ACTIVE = 1 AND account.IDNo = ?
					`;
					const [telegramIdResults] = await pool.query(telegramIdQuery, [txtAccountCode]);

					let time_now = new Date();
					let updated_time = time_now.toLocaleTimeString();
					let date_nowTG = new Date().toLocaleDateString();

					const text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nGame #: ${txtGameId}\nCapital: ${parseFloat(txtCapital).toLocaleString('en-US')}\nFinal Chips: ${parseFloat(txtFinalChips).toLocaleString('en-US')}\nWin/Loss: ${parseFloat(adjustedWinloss).toLocaleString('en-US')}\nTotal Rolling: ${parseFloat(txtTotalRolling).toLocaleString('en-US')}`;

					if (telegramIdResults.length > 0) {
						const telegramId = telegramIdResults[0].TELEGRAM_ID;
						await sendTelegramMessage(text, telegramId);
						await sendTelegramToAdditionalChats(text);
					} else {
						console.error("No TELEGRAM_ID found for Account Code:", txtAccountCode);
						await sendTelegramToAdditionalChats(text);
					}
				} else {
					console.error("No AGENT_CODE or NAME found for Account Code:", txtAccountCode);
				}
			}

			res.send('Game status updated successfully');
		});
	} catch (error) {
		console.error('Error processing request:', error);
		res.status(500).send('Error processing request');
	}
});


// ADD SETTLEMENT
pageRouter.post('/add_settlement', async (req, res) => {
	const {
		game_id_settle,
		txtAccountIDSettle,
		txtTransType,
		txtPayment,
		txtFNB,
		txtSettlementBalance
	} = req.body;

	// Validate required fields
	if (!game_id_settle || !txtAccountIDSettle || !txtTransType || !txtPayment || !txtFNB) {
		return res.status(400).json({ success: false, message: 'Missing required fields' });
	}

	// Remove commas from txtPayment and txtFNB
	let paymentValue = txtPayment.replace(/,/g, '');
	let fnbValue = txtFNB.replace(/,/g, '');
	let date_now = new Date();

	// TRANSACTION DETAILS
	let FNBDESC = 'COMMISSION';

	try {
		// Insert settlement details into account_ledger
		const insertQuery = `INSERT INTO account_ledger (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
		await pool.query(insertQuery, [txtAccountIDSettle, txtTransType, 5, FNBDESC, paymentValue, req.session.user_id, date_now]);

		// Update the settled status and FNB in the game_list table
		const updateQuery = `UPDATE game_list SET SETTLED = 1, FNB = ? WHERE IDNo = ?`;
		await pool.query(updateQuery, [fnbValue, game_id_settle]);

		// Fetch AGENT_CODE, NAME, and TELEGRAM_ID
		const agentQuery = `
            SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.ACTIVE = 1 AND account.IDNo = ?
        `;

		let time_now = new Date();
		time_now.setHours(time_now.getHours());
		let updated_time = time_now.toLocaleTimeString();
		let date_nowTG = new Date().toLocaleDateString();

		const [agentResults] = await pool.query(agentQuery, [txtAccountIDSettle]);

		if (agentResults.length > 0) {
			const agentCode = agentResults[0].AGENT_CODE;
			const agentName = agentResults[0].NAME;
			const telegramId = agentResults[0].TELEGRAM_ID;

			// Prepare the Telegram message
			let text;
			if (txtTransType == 1) {
				const currentBalance = parseFloat(txtSettlementBalance.replace(/,/g, '')) + parseFloat(paymentValue);
				text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nTransaction: ${game_id_settle} - Commission\nAmount: ${parseFloat(paymentValue).toLocaleString('en-US')}\nAccount Balance: ${parseFloat(currentBalance).toLocaleString('en-US')}`;
			} else {
				text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nTransaction: ${game_id_settle} - Commission\nAmount: ${parseFloat(paymentValue).toLocaleString('en-US')}`;
			}

			// Send the Telegram message
			if (telegramId) {
				await sendTelegramMessage(text, telegramId);
				await sendTelegramToAdditionalChats(text);
			} else {
				console.error("No TELEGRAM_ID found for Account ID:", txtAccountIDSettle);
			}
		} else {
			console.error("No AGENT_CODE or NAME found for Account ID:", txtAccountIDSettle);
		}

		// Send JSON success response
		res.json({ success: true, message: 'Settlement saved and status updated' });

	} catch (err) {
		console.error('Error processing settlement:', err);
		res.status(500).json({ success: false, message: 'Error processing settlement' });
	}
});

// pageRouter.get('/game_record_data/:record_id', (req, res) => {
//     const recordId = req.params.record_id;

//     const query = `SELECT * FROM game_list WHERE IDNo = ?`;
//     connection.query(query, [recordId], (err, result) => {
//         if (err) {
//             console.error('Error fetching data:', err);
//             return res.status(500).json({ success: false, message: 'Error fetching data' });
//         }
//         // Send the record data including the SETTLED status
//         res.json(result);
//     });
// });



// EDIT GAME LIST COMMISSION
pageRouter.put('/game_list/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const {
		txtExpense,
		txtActualAgent,
		txtRemarks,
		txtCashier,
		txtManager
	} = req.body;

	let date_now = new Date();

	const query = `UPDATE game_list SET EXPENSE = ?, ACTUAL_TO_AGENT = ?, REMARKS = ?, CASHIER = ?, MANAGER = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [txtExpense, txtActualAgent, txtRemarks, txtCashier, txtManager, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating GAME LIST:', err);
			res.status(500).send('Error updating GAME LIST');
			return;
		}

		res.send('GAME LIST updated successfully');
	});
});

// ADD GAME RECORD
pageRouter.post('/add_game_record', (req, res) => {
	const {
		game_id,
		txtTradingDate,
		txtCategory,
		txtAmount,
		txtRemarks
	} = req.body;
	let date_now = new Date();

	const query = `INSERT INTO  game_record(GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT,REMARKS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?,?, ?)`;
	connection.query(query, [game_id, date_now, txtCategory, txtAmount, txtRemarks, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting details', err);
			res.status(500).send('Error inserting details');
			return;
		}
		res.redirect('/game_record/' + game_id);
	});
});

// ADD GAME RECORD BUYIN
pageRouter.post('/game_list/add/buyin', async (req, res) => {
	const {
		game_id,
		txtAccountCode,
		txtTransType,
		txtNN,
		txtCC,
		totalBalanceGuest2,
		txtTotalAmountBuyin
	} = req.body;

	let date_now = new Date();

	// Remove commas from NN and CC
	let txtNNamount = txtNN.split(',').join("") || 0;
	let txtCCamount = txtCC.split(',').join("") || 0;

	let AddBuyinDESC = 'ADDITIONAL BUY-IN';

	// First insert into game_record table (CAGE_TYPE = 1)
	const query1 = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
	connection.query(query1, [game_id, date_now, 1, 0, txtNNamount, txtCCamount, txtTransType, req.session.user_id, date_now], (err, result1) => {
		if (err) {
			console.error('Error inserting into game_record', err);
			return res.status(500).send('Error inserting details');
		}

		// Second insert into game_record table (CAGE_TYPE = 3)
		const query2 = `INSERT INTO game_record (GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		connection.query(query2, [game_id, date_now, 3, 0, txtNNamount, txtCCamount, txtTransType, req.session.user_id, date_now], async (err, result2) => {
			if (err) {
				console.error('Error inserting into game_record', err);
				return res.status(500).send('Error inserting details');
			}

			let queries = [];
			let totalAmount = parseFloat(txtNNamount) + parseFloat(txtCCamount);

			// Insert into account_ledger if transaction type is 2 or 3
			if (txtTransType == 2) {
				const query3 = `INSERT INTO account_ledger (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
				queries.push(new Promise((resolve, reject) => {
					connection.query(query3, [txtAccountCode, 2, txtTransType, AddBuyinDESC, totalAmount, req.session.user_id, date_now], (err, result3) => {
						if (err) {
							reject('Error inserting details into account_ledger');
						} else {
							resolve();
						}
					});
				}));
			}

			if (txtTransType == 3) {
				const query4 = `INSERT INTO account_ledger (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?)`;
				queries.push(new Promise((resolve, reject) => {
					connection.query(query4, [txtAccountCode, 10, txtTransType, totalAmount, req.session.user_id, date_now], (err, result4) => {
						if (err) {
							reject('Error inserting details into account_ledger');
						} else {
							resolve();
						}
					});
				}));
			}

			try {
				await Promise.all(queries);

				// Fetch AGENT_CODE and NAME
				const agentQuery = `
					SELECT agent.AGENT_CODE, agent.NAME
					FROM agent
					JOIN account ON account.AGENT_ID = agent.IDNo
					WHERE account.ACTIVE = 1 AND account.IDNo = ?
				`;
				const [agentResults] = await pool.query(agentQuery, [txtAccountCode]);

				if (agentResults.length > 0) {
					const agentCode = agentResults[0].AGENT_CODE;
					const agentName = agentResults[0].NAME;

					// Fetch TELEGRAM_ID
					const telegramIdQuery = `
						SELECT agent.TELEGRAM_ID 
						FROM agent
						JOIN account ON account.AGENT_ID = agent.IDNo
						WHERE account.ACTIVE = 1 AND account.IDNo = ?
					`;
					const [telegramIdResults] = await pool.query(telegramIdQuery, [txtAccountCode]);

					let time_now = new Date();
					time_now.setHours(time_now.getHours());
					let updated_time = time_now.toLocaleTimeString();
					let date_nowTG = new Date().toLocaleDateString();

					// Calculate new TotalBalance after withdrawal
					const totalBuyin = parseFloat(txtTotalAmountBuyin.replace(/,/g, '')) + totalAmount;
					const newTotalBalance = totalBalanceGuest2 - totalAmount;

					// Conditions for different txtTransType values
					let text = '';
					if (txtTransType == 2) {
						text = `Demo Cage\n\nAccount: ${agentCode} (${agentName})\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nAdditional Buy-in\nGame #: ${game_id}\nBuy-in: ${parseFloat(totalAmount).toLocaleString('en-US')}\nTotal Buy-in: ${parseFloat(totalBuyin).toLocaleString('en-US')}\nAccount Balance: ${parseFloat(newTotalBalance).toLocaleString('en-US')}`;
					} else if (txtTransType == 1) {
						text = `Demo Cage\n\nAccount: ${agentCode} (${agentName})\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nAdditional Buy-in - Cash\nGame #: ${game_id}\nBuy-in: ${parseFloat(totalAmount).toLocaleString('en-US')}\nTotal Buy-in: ${parseFloat(totalBuyin).toLocaleString('en-US')}`;
					} else if (txtTransType == 3) {
						text = `Demo Cage\n\nAccount: ${agentCode} (${agentName})\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nAdditional Buy-in - IOU\nGame #: ${game_id}\nBuy-in: ${parseFloat(totalAmount).toLocaleString('en-US')}\nTotal Buy-in: ${parseFloat(totalBuyin).toLocaleString('en-US')}`;
					}

					// Send Telegram messages
					if (text !== '' && telegramIdResults.length > 0) {
						const telegramId = telegramIdResults[0].TELEGRAM_ID;
						await sendTelegramMessage(text, telegramId); // Send to agent's Telegram ID
						await sendTelegramToAdditionalChats(text);
					} else {
						console.error("No TELEGRAM_ID found for Account Code:", txtAccountCode);
					}
				}

				res.redirect('/game_list');
			} catch (error) {
				res.status(500).send(error);
			}
		});
	});
});

// ADD GAME RECORD CASH OUT
pageRouter.post('/game_list/add/cashout', (req, res) => {
	const {
		game_id,
		txtAccountCode,
		txtTransType,
		txtNN,
		txtCC,
		txttotal_balance_cashout

	} = req.body;
	let date_now = new Date();

	// Ensure at least one of txtNN or txtCC is provided and not empty
	if ((!txtNN || txtNN.trim() === '') && (!txtCC || txtCC.trim() === '')) {
		return res.status(400).send('At least one of NN Chips or CC Chips amounts is required.');
	}

	// Ensure txtTransType is provided and not empty
	if (!txtTransType || txtTransType.trim() === '') {
		return res.status(400).send('Transaction Type is required.');
	}

	// Remove commas and convert txtNN and txtCC to numerical values
	let txtNNamount = txtNN && txtNN.trim() !== '' ? txtNN.split(',').join("") : '0';
	let txtCCamount = txtCC && txtCC.trim() !== '' ? txtCC.split(',').join("") : '0';


	// Ensure that txtNNamount and txtCCamount are valid numbers
	if (isNaN(txtNNamount) || txtNNamount < 0) {
		return res.status(400).send('Invalid NN Chips amount.');
	}
	if (isNaN(txtCCamount) || txtCCamount < 0) {
		return res.status(400).send('Invalid CC Chips amount.');
	}

	// Convert to float values
	txtNNamount = parseFloat(txtNNamount);
	txtCCamount = parseFloat(txtCCamount);

	// Calculate chips returned and current balance after cash out
	let chipsReturn = txtNNamount + txtCCamount;
	let currentBalanceCashout = parseFloat(txttotal_balance_cashout) + chipsReturn; // Ensure txttotal_balance_cashout is parsed

	let CashOutDESC = 'Chips Returned'; //TRANSACTION DETAILS

	// Proceed with database insertion for game_record
	const query = `INSERT INTO game_record(GAME_ID, TRADING_DATE, CAGE_TYPE, AMOUNT, NN_CHIPS, CC_CHIPS, TRANSACTION, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
	connection.query(query, [game_id, date_now, 2, 0, txtNNamount, txtCCamount, txtTransType, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting game record', err);
			return res.status(500).send('Error inserting game record.');
		}

		// Proceed with database insertion for account_ledger
		const query2 = `INSERT INTO account_ledger(ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
		connection.query(query2, [txtAccountCode, 1, txtTransType, CashOutDESC, txtNNamount + txtCCamount, req.session.user_id, date_now], (err) => {
			if (err) {
				console.error('Error inserting account ledger details', err);
				return res.status(500).send('Error inserting account ledger details.');
			}

			let time_now = new Date();
			time_now.setHours(time_now.getHours());
			let updated_time = time_now.toLocaleTimeString();
			let date_nowTG = new Date().toLocaleDateString();

			// Send Telegram message based on txtTransType
			if (txtTransType == 2 || txtTransType == 1 || txtTransType == 4) {
				// Fetch AGENT_CODE and NAME for the Telegram message
				const agentQuery = `
        SELECT agent.AGENT_CODE, agent.NAME
        FROM agent
        JOIN account ON account.AGENT_ID = agent.IDNo
        WHERE account.ACTIVE = 1 AND account.IDNo = ?
    `;
				connection.query(agentQuery, [txtAccountCode], async (err, agentResults) => {
					if (err) {
						console.error('Error fetching agent details', err);
						return res.status(500).send('Error fetching agent details.');
					}

					if (agentResults.length > 0) {
						const agentCode = agentResults[0].AGENT_CODE;
						const agentName = agentResults[0].NAME;

						// Fetch TELEGRAM_ID
						const telegramIdQuery = `
                SELECT agent.TELEGRAM_ID 
                FROM agent
                JOIN account ON account.AGENT_ID = agent.IDNo
                WHERE account.ACTIVE = 1 AND account.IDNo = ?
            `;
						connection.query(telegramIdQuery, [txtAccountCode], async (err, telegramIdResults) => {
							if (err) {
								console.error('Error fetching telegram ID', err);
								return res.status(500).send('Error fetching telegram ID.');
							}

							let text = '';

							// Determine the message text based on txtTransType
							if (txtTransType == 2) {

								text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nChips Return\nGame #: ${game_id}\nChips Return: ${chipsReturn.toLocaleString('en-US')}\nAccount Balance: ${currentBalanceCashout.toLocaleString('en-US')}`;
							} else if (txtTransType == 1) {  // For Cash

								text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nChips Return - Cash\nGame #: ${game_id}\nChips Return: ${chipsReturn.toLocaleString('en-US')}`;
							} else if (txtTransType == 4) {  // For IOU

								text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nChips Return - IOU\nGame #: ${game_id}\nChips Return: ${chipsReturn.toLocaleString('en-US')}`;
							}

							// Send Telegram message if TELEGRAM_ID is found
							if (text !== '' && telegramIdResults.length > 0) {
								const telegramId = telegramIdResults[0].TELEGRAM_ID;
								await sendTelegramMessage(text, telegramId); // Send to agent's Telegram ID
								await sendTelegramToAdditionalChats(text);
							} else {
								console.error("No TELEGRAM_ID found for Account Code:", txtAccountCode);
							}
						});
					} else {
						console.error("No AGENT_CODE or NAME found for Account Code:", txtAccountCode);
					}
				});
			}

			res.redirect('/game_list');
		});

	});
});



// ADD GAME RECORD ROLLING
pageRouter.post('/game_list/add/rolling', (req, res) => {
	const {
		game_id,

		txtNN,
		txtCC
	} = req.body;
	let date_now = new Date();


	let txtNNamount = (txtNN || '0').split(',').join("");
	let txtCCamount = (txtCC || '0').split(',').join("");

	const query = `INSERT INTO  game_record(GAME_ID, TRADING_DATE, CAGE_TYPE, NN_CHIPS, CC_CHIPS, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?)`;
	connection.query(query, [game_id, date_now, 4, txtNNamount, txtCCamount, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting details', err);
			res.status(500).send('Error inserting details');
			return;
		}
		res.redirect('/game_list');
	});
});

// GET GAME RECORD
// pageRouter.get('/game_record_data/:id', (req, res) => {
// 	const id = parseInt(req.params.id);
// 	const query = `SELECT *, game_record.IDNo AS game_record_id, game_record.ENCODED_DT AS record_date FROM game_record 
// 	JOIN cage_category ON game_record.CAGE_TYPE = cage_category.IDNo
//   	WHERE game_record.ACTIVE != 0 AND game_record.GAME_ID = ? ORDER BY game_record.IDNo ASC`;
// 	connection.query(query, [id], (error, result, fields) => {
// 		if (error) {
// 			console.error('Error fetching data:', error);
// 			res.status(500).send('Error fetching data');
// 			return;
// 		}
// 		res.json(result);
// 	});
// });
// GET GAME RECORD
pageRouter.get('/game_record_data/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const query = `SELECT *, game_list.IDNo AS game_list_id, game_record.IDNo AS game_record_id, game_record.ENCODED_DT AS record_date, game_list.ACTIVE AS game_status, account.IDNo AS account_no, agent.AGENT_CODE AS agent_code, agent.NAME AS agent_name 
	  FROM game_list JOIN account ON game_list.ACCOUNT_ID = account.IDNo 
	  JOIN agent ON agent.IDNo = account.AGENT_ID 
	  JOIN agency ON agency.IDNo = agent.AGENCY 
	  JOIN game_record ON game_record.GAME_ID = game_list.IDNo 
	  WHERE game_record.ACTIVE != 0 AND game_list.ACTIVE != 0 AND  game_record.GAME_ID = ?
	  ORDER BY game_list.IDNo ASC`;
	connection.query(query, [id], (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});





// // DELETE GAME RECORD
// pageRouter.put('/game_record/remove/:id', (req, res) => {
// 	const id = parseInt(req.params.id);
// 	let date_now = new Date();

// 	const query = `UPDATE game_record SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
// 	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
// 		if (err) {
// 			console.error('Error updating GAME LIST:', err);
// 			res.status(500).send('Error updating GAME LIST');
// 			return;
// 		}

// 		res.send('GAME LIST updated successfully');
// 	});
// });
// REMOVED: Duplicate of gamebook.js PUT /game_record/remove/:id (gamebook handles it first)
// pageRouter.put('/game_record/remove/:id', ...) - old logic, no account_ledger/cash_transaction cleanup

//EXPORT ACCOUNT DETAILS

pageRouter.get('/export', async (req, res) => {
	const accountId = req.query.id; // Assuming `id` is passed as a query parameter
	let connection;

	try {
		// Get a connection from the pool
		connection = await pool.getConnection();

		// Perform the query
		const [rows] = await connection.query(`
		SELECT 
		  account_ledger.ENCODED_DT, 
		  transaction_type.TRANSACTION, 
		  account_ledger.AMOUNT, 
		  account_ledger.REMARKS  
		FROM account_ledger 
		JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
		WHERE account_ledger.ACTIVE=1 AND account_ledger.ACCOUNT_ID= ? 
		ORDER BY account_ledger.IDNo DESC`, [accountId]);

		// Create a new workbook and worksheet
		const workbook = new ExcelJS.Workbook();
		const worksheet = workbook.addWorksheet('Data');

		// Define the columns
		worksheet.columns = [{
			header: 'Date',
			key: 'ENCODED_DT',
			width: 20
		},
		{
			header: 'Transaction',
			key: 'TRANSACTION',
			width: 30
		},
		{
			header: 'Amount',
			key: 'AMOUNT',
			width: 15
		},
		{
			header: 'Remarks',
			key: 'REMARKS',
			width: 30
		},
		];

		// Add rows from the database query
		rows.forEach(row => {
			worksheet.addRow(row);
		});

		applyCommaThousandsToNumericCells(worksheet, { headerRows: 0 });

		// Write the workbook to a buffer
		const buffer = await workbook.xlsx.writeBuffer();

		const query1 = `SELECT NAME, AGENT_CODE FROM agent
	  JOIN account ON account.AGENT_ID = agent.IDNo
	  WHERE account.IDNo = ?`;

		let filename = 'Account Details - ';

		const [agents] = await connection.query(`
		SELECT NAME, AGENT_CODE FROM agent
	  JOIN account ON account.AGENT_ID = agent.IDNo
	  WHERE account.IDNo = ?`, [accountId]);

		if (agents && agents.length > 0) {
			const agent = agents[0];

			filename = 'Account Details - ' + agent.NAME + '(' + agent.AGENT_CODE + ')';
		}

		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename=' + filename + '.xlsx');

		res.send(buffer);
	} catch (error) {
		console.error('Error exporting data:', error);
		res.status(500).send('Error exporting data');
	} finally {
		// Release the connection back to the pool if it was established
		if (connection) {
			try {
				connection.release();
			} catch (err) {
				console.error('Error releasing the connection:', err);
			}
		}
	}
});




// ON GAME LIST
pageRouter.get('/on_game_list_data', (req, res) => {
	const query = `SELECT *, game_list.IDNo AS game_list_id, game_list.ACTIVE AS game_status, account.IDNo AS account_no, agent.AGENT_CODE AS agent_code, agent.NAME AS agent_name FROM game_list 
	JOIN account ON game_list.ACCOUNT_ID = account.IDNo
	JOIN agent ON agent.IDNo = account.AGENT_ID
	JOIN agency ON agency.IDNo = agent.AGENCY
  	WHERE game_list.ACTIVE !=1 ORDER BY game_list.IDNo ASC`;
	connection.query(query, (error, result, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(result);
	});
});

//MAIN CAGE ROLLING

pageRouter.post('/add_cage_rolling', (req, res) => {
	const {

		txtRollingAmount

	} = req.body;
	let date_now = new Date();


	const query = `INSERT INTO cage_rolling(ROLLING_AMOUNT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;
	connection.query(query, [txtRollingAmount, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket', err);
			res.status(500).send('Error inserting junket');
			return;
		}
		res.redirect('/dashboard');
	});
});

// START JUNKET TOTAL CHIPS
// ADD JUNKET TOTAL CHIPS 
pageRouter.post('/add_junket_total_chips', async (req, res) => {
	const {
		txtNNChips,
		txtCCChips,
		optBuyinReturn,
		typedescription // Ensure this field is included in the request body
	} = req.body;
	let date_now = new Date();

	const nnChipsStr = String(txtNNChips ?? '').replace(/,/g, ''); // Remove commas
	const ccChipsStr = String(txtCCChips ?? '').replace(/,/g, ''); // Remove commas

	const nnChips = isNaN(parseFloat(nnChipsStr)) ? 0 : parseFloat(nnChipsStr);
	const ccChips = isNaN(parseFloat(ccChipsStr)) ? 0 : parseFloat(ccChipsStr);

	const chipPositiveFinite = (a) => Number.isFinite(a) && a > 0;
	const chipNonNegativeFinite = (a) => Number.isFinite(a) && a >= 0;

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
	connection.query(query, [optBuyinReturn, typedescription, nnChips, ccChips, totalChips, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket total chips', err);
			res.status(500).send('Error inserting junket total chips');
			return;
		}
		res.redirect('/dashboard');
	});
});

// ADD JUNKET CC CHIPS 
pageRouter.post('/add_cc_chips', (req, res) => {
	const {

		txtCCChips,
		optBuyinReturn

	} = req.body;
	let date_now = new Date();

	let ccdescription;
	if (optBuyinReturn === '1') {
		ccdescription = 'ADD';
	} else if (optBuyinReturn === '2') {
		ccdescription = 'DEDUCT';
	}
	else {
		// Handle the case where no valid txtTransType is selected (optional)
		return res.status(400).send('Invalid transaction type');
	}

	const ccChipsStr = txtCCChips.replace(/,/g, ''); // Remove commas


	const ccChips = isNaN(parseFloat(ccChipsStr)) ? 0 : parseFloat(ccChipsStr);

	// Calculate the total chips by summing nnChips and ccChips
	const totalChips = ccChips;

	const query = `INSERT INTO junket_chips(TRANSACTION_ID, DESCRIPTION, CC_CHIPS, TOTAL_CHIPS, ENCODED_BY, ENCODED_DT) VALUES ( ?, ?, ?, ?, ?, ?)`;
	connection.query(query, [optBuyinReturn, ccdescription, ccChips, totalChips, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket CC chips', err);
			res.status(500).send('Error inserting junket CC chips');
			return;
		}
		res.redirect('/dashboard');
	});
});
// GET JUNKET CC CHIPS
pageRouter.get('/get_cc_chips', (req, res) => {
	const query = `
        SELECT 
    jtc.DESCRIPTION,  
    jtc.CC_CHIPS,  
    jtc.ENCODED_DT,
    ui.FIRSTNAME
FROM 
    junket_chips AS jtc
JOIN 
    user_info AS ui 
ON 
    ui.IDNo = jtc.ENCODED_BY
WHERE 
    jtc.CC_CHIPS IS NOT NULL AND jtc.CC_CHIPS <> ''
    `;

	connection.query(query, (err, results) => {
		if (err) {
			console.error('Error fetching data:', err);
			return res.status(500).json({ error: 'Error fetching data' });
		}
		// Return results as JSON array
		res.json(results);
	});
});



// ADD JUNKET NN CHIPS
pageRouter.post('/add_nn_chips', (req, res) => {
	const {
		txtNNChips,
		optBuyinReturn

	} = req.body;
	let date_now = new Date();

	let nndescription;
	if (optBuyinReturn === '1') {
		nndescription = 'ADD';
	} else if (optBuyinReturn === '2') {
		nndescription = 'DEDUCT';
	}
	else {
		// Handle the case where no valid txtTransType is selected (optional)
		return res.status(400).send('Invalid transaction type');
	}

	const nnChipsStr = txtNNChips.replace(/,/g, ''); // Remove commas


	const nnChips = isNaN(parseFloat(nnChipsStr)) ? 0 : parseFloat(nnChipsStr);


	// Calculate the total chips by summing nnChips and ccChips
	const totalChips = nnChips;

	const query = `INSERT INTO junket_chips(TRANSACTION_ID, DESCRIPTION, NN_CHIPS, TOTAL_CHIPS, ENCODED_BY, ENCODED_DT) VALUES ( ?, ?, ?, ?, ?, ?)`;
	connection.query(query, [optBuyinReturn, nndescription, nnChips, totalChips, req.session.user_id, date_now], (err, result) => {
		if (err) {
			console.error('Error inserting junket NN chips', err);
			res.status(500).send('Error inserting junket NN chips');
			return;
		}
		res.redirect('/dashboard');
	});
});

// GET JUNKET NN CHIPS
pageRouter.get('/get_nn_chips', (req, res) => {
	const query = `
        SELECT 
    jtc.DESCRIPTION,  
    jtc.NN_CHIPS,  
    jtc.ENCODED_DT,
    ui.FIRSTNAME
FROM 
    junket_chips AS jtc
JOIN 
    user_info AS ui 
ON 
    ui.IDNo = jtc.ENCODED_BY
WHERE 
    jtc.NN_CHIPS IS NOT NULL AND jtc.NN_CHIPS <> ''

    `;

	connection.query(query, (err, results) => {
		if (err) {
			console.error('Error fetching data:', err);
			return res.status(500).json({ error: 'Error fetching data' });
		}
		// Return results as JSON array
		res.json(results);
	});
});

// END JUNKET TOTAL CHIPS


// START MARKER
//GET MARKER DATA CASHOUT
pageRouter.get('/marker_data_cashout/:id', (req, res) => {
	const id = parseInt(req.params.id);
	const query = `SELECT account.IDNo AS ACCOUNT_ID, SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) - SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END) AS TOTAL_AMOUNT, agent.AGENT_CODE AS AGENT_CODE, agent.NAME AS AGENT_NAME FROM agent JOIN account ON agent.IDNo = account.AGENT_ID JOIN account_ledger ON account.IDNo = account_ledger.ACCOUNT_ID WHERE account_ledger.TRANSACTION_TYPE IN (3, 4) AND account_ledger.ACTIVE = 1 AND agent.ACTIVE = 1 AND account_ledger.ACCOUNT_ID = ? GROUP BY account.IDNo, agent.AGENT_CODE, agent.NAME HAVING TOTAL_AMOUNT <> 0`;


	connection.query(query, [id], (error, results, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});
//GET MARKER DATA
pageRouter.get('/marker_data', (req, res) => {
	const query = `SELECT account.IDNo AS ACCOUNT_ID, SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) - SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END) AS TOTAL_AMOUNT, agent.AGENT_CODE AS AGENT_CODE, agent.NAME AS AGENT_NAME FROM agent JOIN account ON agent.IDNo = account.AGENT_ID JOIN account_ledger ON account.IDNo = account_ledger.ACCOUNT_ID WHERE account_ledger.TRANSACTION_TYPE IN (3, 4) AND account_ledger.ACTIVE = 1 AND agent.ACTIVE = 1 GROUP BY account.IDNo, agent.AGENT_CODE, agent.NAME HAVING TOTAL_AMOUNT <> 0`;


	connection.query(query, (error, results, fields) => {
		if (error) {
			console.error('Error fetching data:', error);
			res.status(500).send('Error fetching data');
			return;
		}
		res.json(results);
	});
});

// GET MARKER DATA WITH BREAKDOWN (Credit 3-3 vs Buy-in 10-3 per account, minus returns 11,12,1)
pageRouter.get('/marker_data_breakdown', async (req, res) => {
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
pageRouter.post('/add_marker_settlement', async (req, res) => {
	const { txtAccountMarker, txtMarkerReturn, optTransType, optReturnSource, AgentBalance, remarks } = req.body;

	let date_now = new Date();
	let time_now = new Date();
	time_now.setHours(time_now.getHours());
	let updated_time = time_now.toLocaleTimeString();
	let date_nowTG = date_now.toLocaleDateString();
	const accountId = parseInt(txtAccountMarker, 10);
	const markerReturnRaw = String(txtMarkerReturn || '').replace(/,/g, '').trim();
	const markerReturn = parseFloat(markerReturnRaw);
	const transType = String(optTransType || '');
	const returnSource = String(optReturnSource || '');

	try {
		if (!Number.isInteger(accountId) || accountId <= 0) {
			return res.status(400).json({ error: 'Please select a valid account.' });
		}
		if (!['11', '12'].includes(transType)) {
			return res.status(400).json({ error: 'Please select a valid transaction type (Cash or Deposit).' });
		}
		if (!['credit', 'buyin', 'auto'].includes(returnSource)) {
			return res.status(400).json({ error: 'Please select where to deduct the return.' });
		}
		if (!Number.isFinite(markerReturn) || markerReturn <= 0) {
			return res.status(400).json({ error: 'Credit Return must be greater than zero.' });
		}

		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();

			const [accountRows] = await conn.query(
				'SELECT IDNo FROM account WHERE IDNo = ? AND ACTIVE = 1 FOR UPDATE',
				[accountId]
			);
			if (!accountRows.length) {
				await conn.rollback();
				return res.status(400).json({ error: 'Selected account is not active.' });
			}

			const sourceBalances = await getSourceBalances(conn, accountId);

			if (returnSource === 'auto') {
				const totalSourceBalance = sourceBalances.balanceCredit + sourceBalances.balanceBuyin;
				if (markerReturn > totalSourceBalance) {
					await conn.rollback();
					return res.status(400).json({ error: 'Return amount exceeded the total credit balance.' });
				}
			} else {
				const selectedSourceBalance = returnSource === 'credit'
					? sourceBalances.balanceCredit
					: sourceBalances.balanceBuyin;

				if (markerReturn > selectedSourceBalance) {
					const sourceBalanceLabel = returnSource === 'credit' ? 'Junket Credit Balance' : 'Game Credit Balance';
					await conn.rollback();
					return res.status(400).json({ error: `Return amount exceeded the ${sourceBalanceLabel}.` });
				}
			}

			if (transType === '12') {
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
                AND account_ledger.ACTIVE = 1
            `;

				const [balanceResults] = await conn.query(checkBalanceQuery, [accountId]);
				const balance = balanceResults[0]?.balance || 0;

				if (balance < markerReturn) {
					await conn.rollback();
					return res.status(400).json({ error: 'Insufficient balance for this deposit transaction.' });
				}
			}

			if (returnSource === 'auto') {
				await insertAutoSettlementRecords(conn, sourceBalances);
			} else {
				await insertSettlementRecord(conn);
			}
			await conn.commit();
		} catch (txnErr) {
			try { await conn.rollback(); } catch (rollbackErr) { }
			throw txnErr;
		} finally {
			conn.release();
		}

		const agentQuery = `
            SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.ACTIVE = 1 AND account.IDNo = ?
        `;

		const [agentResults] = await pool.query(agentQuery, [accountId]);

		if (agentResults.length > 0) {
			const { AGENT_CODE: agentCode, NAME: agentName, TELEGRAM_ID: telegramId } = agentResults[0];
			let text;

			// Safely parse AgentBalance
			const currentBalance = (parseFloat(String(AgentBalance || '0').replace(/,/g, '')) || 0) - markerReturn;

			if (transType === '12') {
				text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nTransaction: IOU RETURN\nAmount: ${parseFloat(markerReturn).toLocaleString('en-US')}\nAccount Balance: ${parseFloat(currentBalance).toLocaleString('en-US')}`;
			} else {
				text = `Demo Cage\n\nAccount: ${agentCode} - ${agentName}\nDate: ${date_nowTG}\nTime: ${updated_time}\n\nTransaction: IOU RETURN\nAmount: ${parseFloat(markerReturn).toLocaleString('en-US')}`;
			}

			const markerLogPreview = markerReturnTelegramLogPreview(transType, returnSource);
			const markerTelegramOpts = {
				logPreview: markerLogPreview,
				logMeta: {
					accountCode: agentCode,
					guestName: agentName,
					amount: Math.abs(Number(markerReturn) || 0)
				}
			};

			if (telegramId) {
				await sendTelegramMessage(text, telegramId, markerTelegramOpts);
				await sendTelegramToAdditionalChats(text, markerTelegramOpts);
			} else {
				console.error("No TELEGRAM_ID found for Account ID:", txtAccountMarker);
			}
		} else {
			console.error("No AGENT_CODE or NAME found for Account ID:", txtAccountMarker);
		}

		res.json({ success: true, message: 'Marker Return saved successfully' });
	} catch (err) {
		console.error('Error:', err);
		res.status(500).json({ success: false, message: 'Error processing the transaction' });
	}

	async function getSourceBalances(conn, selectedAccountId) {
		return getMarkerSourceBalances(conn, selectedAccountId);
	}

	async function insertSettlementRecord(conn, sourceOverride, amountOverride) {
		const source = sourceOverride || returnSource;
		const amount = amountOverride != null ? amountOverride : markerReturn;
		const returnSourceDesc = getMarkerReturnSourceDesc(source);
		const insertQuery = `
            INSERT INTO account_ledger (ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, ENCODED_BY, ENCODED_DT, REMARKS, TRANSACTION_DESC) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

		await conn.query(insertQuery, [accountId, transType, 3, amount, req.session.user_id, date_now, remarks || null, returnSourceDesc]);
	}

	async function insertAutoSettlementRecords(conn, sourceBalances) {
		const allocations = allocateMarkerReturn(
			sourceBalances.balanceCredit,
			sourceBalances.balanceBuyin,
			markerReturn
		);
		for (const allocation of allocations) {
			await insertSettlementRecord(conn, allocation.source, allocation.amount);
		}
	}
});

pageRouter.get('/marker_total_credits_issue', async (req, res) => {
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

pageRouter.delete('/marker_record/:id', async (req, res) => {
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
		const amount = parseFloat(rec.AMOUNT) || 0;
		const encodedDt = rec.ENCODED_DT;

		await pool.execute(
			'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[req.session.user_id, date_now, id]
		);

		if (transId === 10 && gameId) {
			await pool.execute(
				`UPDATE game_record SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? 
				 WHERE GAME_ID = ? AND (NN_CHIPS + CC_CHIPS) = ? AND ENCODED_DT = ? AND CAGE_TYPE IN (1, 3) AND TRANSACTION = 3`,
				[req.session.user_id, date_now, gameId, amount, encodedDt]
			);
		}

		if (transType === 4 && transId === 1 && gameId) {
			await pool.execute(
				`UPDATE game_record SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? 
				 WHERE GAME_ID = ? AND (NN_CHIPS + CC_CHIPS) = ? AND CAGE_TYPE = 2 AND TRANSACTION = 4`,
				[req.session.user_id, date_now, gameId, amount, encodedDt]
			);
		}

		res.json({ success: true, message: 'Record deleted successfully.' });
	} catch (err) {
		console.error('Error deleting marker record:', err);
		res.status(500).json({ success: false, message: 'Error deleting record.' });
	}
});

pageRouter.patch('/marker_record/:id/remarks', async (req, res) => {
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

pageRouter.get('/marker_history', async (req, res) => {
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


//BOOKING


// ADD BOOKING
pageRouter.post('/add_junket_booking', (req, res) => {
	const {
		txtConfirmationNumber,
		txtCheckInDate,
		txtCheckOutDate,
		txtAccountNumber,
		txtGuestName,
		txtHotelFee,
		txtAddFee,
		txtTotalAmount,
		txtRemarks
	} = req.body;

	// Removing commas from fees and total amount if formatted with commas
	let hotelFee = txtHotelFee.split(',').join("");
	let addFee = txtAddFee.split(',').join("");
	let totalAmount = txtTotalAmount.split(',').join("");
	// Get the current date
	let date_now = new Date(); // Format to 'YYYY-MM-DD HH:MM:SS'

	const query = `
        INSERT INTO booking (CONFIRM_NUM, CHECK_IN, CHECK_OUT, ACCT_NUM, GUEST_NAME, HOTEL_FEE, ADDT_FEE, TOTAL_AMOUNT, REMARKS, BOOKED_BY, BOOKING_DATE)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

	connection.query(query, [
		txtConfirmationNumber,
		txtCheckInDate,
		txtCheckOutDate,
		txtAccountNumber,
		txtGuestName,
		hotelFee,
		addFee,
		totalAmount,
		txtRemarks,
		req.session.user_id,
		date_now // This sets the BOOKING_DATE field
	], (err, result) => {
		if (err) {
			console.error('Error inserting booking', err);
			res.status(500).send('Error inserting booking');
			return;
		}
		res.redirect('/booking');
	});
});


// GET Booking Data
pageRouter.get('/junket_booking_data', (req, res) => {
	const query = `
      			SELECT booking.*, user_info.FIRSTNAME AS FIRSTNAME FROM user_info 
				JOIN booking ON booking.BOOKED_BY = user_info.IDNo
   				WHERE booking.ACTIVE = 1
    `;

	connection.query(query, (error, results) => {
		if (error) {
			console.error('Error fetching booking data:', error);
			return res.status(500).json({ error: 'Error fetching booking data' });
		}

		res.status(200).json(results); // Return all active bookings
	});
});



// Check-In Route
pageRouter.put('/check_in/:id', (req, res) => {
	const bookingId = req.params.id;
	const checkInDate = req.body.checkInDate;

	connection.query('UPDATE booking SET CHECK_IN = ? WHERE IDNo = ?', [checkInDate, bookingId], (error, results) => {
		if (error) {
			console.error('Error during check-in:', error);
			return res.status(500).json({ error: 'Error during check-in' });
		}
		res.status(200).json({ message: 'Check-in successful' });
	});
});

// Check-Out Route
pageRouter.put('/check_out/:id', (req, res) => {
	const bookingId = req.params.id;
	const checkOutDate = req.body.checkOutDate;

	connection.query('UPDATE booking SET CHECK_OUT = ? WHERE IDNo = ?', [checkOutDate, bookingId], (error, results) => {
		if (error) {
			console.error('Error during check-out:', error);
			return res.status(500).json({ error: 'Error during check-out' });
		}
		res.status(200).json({ message: 'Check-out successful' });
	});
});

// UPDATE Payment Status
pageRouter.put('/booking_payment_status_update/:id', (req, res) => {
	const bookingId = req.params.id;
	const paymentStatus = req.body.paymentStatus;

	connection.query(
		'UPDATE booking SET PAYMENT_STATUS = ? WHERE IDNo = ?',
		[paymentStatus, bookingId],
		(error, results) => {
			if (error) {
				console.error('Error updating payment status:', error);
				return res.status(500).json({ error: 'Error updating payment status' });
			}
			res.status(200).json({ message: 'Payment status updated successfully' });
		}
	);
});


//UPDATE BOOKING
pageRouter.post('/update_junket_booking', (req, res) => {
	const { booking_id, confirm_num, check_in, check_out, guest_name, hotel_fee, add_fee, total_amount, remarks, edited_by } = req.body;

	// Removing commas from fees and total amount if formatted with commas
	let hotelFee = hotel_fee.split(',').join("");
	let addFee = add_fee.split(',').join("");
	let totalAmount = total_amount.split(',').join("");

	console.log('Request Body:', req.body); // To ensure all the data is coming through correctly

	const sql = `
    UPDATE booking SET 
    CONFIRM_NUM = ?, CHECK_IN = ?, CHECK_OUT = ?, 
    GUEST_NAME = ?, HOTEL_FEE = ?, ADDT_FEE = ?, 
    TOTAL_AMOUNT = ?, REMARKS = ?, EDITED_DT = NOW(), EDITED_BY = ?
    WHERE IDNo = ?`;

	connection.query(sql, [confirm_num, check_in, check_out, guest_name, hotelFee, addFee, totalAmount, remarks, req.session.user_id, booking_id], (err, result) => {
		if (err) {
			console.error('Database Error:', err);
			return res.status(500).json({ error: 'Database update failed', details: err.message });
		}
		res.json({ message: 'Booking updated successfully' });
	});
});


// ARCHIVE BOOKING
pageRouter.put('/remove_booking/:id', (req, res) => {
	const id = parseInt(req.params.id);
	let date_now = new Date();

	const query = `UPDATE booking SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
	connection.query(query, [0, req.session.user_id, date_now, id], (err, result) => {
		if (err) {
			console.error('Error updating booking:', err);
			res.status(500).send('Error updating booking');
			return;
		}

		res.send('Booking archived successfully');
	});
});

//START DASHBOARD RESET AND HISTORY

pageRouter.get("/dashboard_history", function (req, res) {
	const data = sessions(req, 'dashboard_history');
	data.permissions = req.session.permissions;
	res.render("dashboard/dashboard_history", data);
});


pageRouter.post('/reset-main-cage-balance', async (req, res) => {
	try {

		await connection.query(`UPDATE junket_house_expense SET RESET = 0`);

		await connection.query(`UPDATE game_record SET RESET = 0`);

		await connection.query(`UPDATE junket_total_chips SET RESET = 0`);

		await connection.query(`UPDATE winloss SET RESET = 0`);

		await connection.query(`UPDATE total_rolling SET RESET = 0`);



		res.json({ success: true });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ error: 'Failed to reset main cage balance' });
	}
});

pageRouter.post('/insert-dash-history', (req, res) => {
	const {
		EXPENSE_HISTORY,
		TOTAL_ROLLING_HISTORY,
		HOUSE_ROLLING_HISTORY,
		WINLOSS_HISTORY,
		
		COMMISSION_HISTORY,
	} = req.body;

	let date_now = new Date();

	// Correct the SQL query
	const query = `INSERT INTO dash_history (EXPENSE_HISTORY, TOTAL_ROLLING_HISTORY, HOUSE_ROLLING_HISTORY, WINLOSS_HISTORY, COMMISSION_HISTORY, ENCODED_BY, ENCODED_DT) 
                   VALUES (?, ?, ?, ?, ?, ?,?)`;

				   connection.query(query, [EXPENSE_HISTORY, TOTAL_ROLLING_HISTORY, HOUSE_ROLLING_HISTORY, WINLOSS_HISTORY, COMMISSION_HISTORY, req.session.user_id, date_now], (err, result) => {
					if (err) {
						console.error('Error inserting data into dash_history', err);
						return res.status(500).json({ success: false, message: 'Error inserting data into dash_history' });
					}
					res.json({ success: true }); // <-- This is missing!
				});
});



pageRouter.get('/get-dashboard-history', (req, res) => {
	const query = `SELECT dash_history.*, user_info.FIRSTNAME AS FIRSTNAME, dash_history.ACTIVE 
                FROM dash_history JOIN user_info 
                ON user_info.IDNo = dash_history.ENCODED_BY 
                WHERE dash_history.ACTIVE = 1 ORDER BY ENCODED_DT DESC`;

	connection.query(query, (err, results) => {
		if (err) {
			console.error('Error fetching dashboard history data', err);
			res.status(500).json({ error: 'Error fetching data' });
			return;
		}
		res.json(results);
	});
});

pageRouter.post('/delete-test-data', async (req, res) => {
	const tablesToDelete = [
		'account_ledger',
		'account_transaction_history',
		'cash_transaction',
		'junket_loss',
		'game_list',
		'game_record',
		'game_services',
		'junket_capital',
		'junket_house_expense',
		'junket_total_chips',
		'money_exchange_transaction',
		'manual_balancing',
		'tip',
		'tip_settlement',
		'multipurpose_ledger_exchange',
		'additional_commission',
		'junket_funds_ledger',
		'beyond_chips'

	];

	let dbConnection;
	try {
		dbConnection = await pool.getConnection();
		await dbConnection.beginTransaction();
		await dbConnection.query('SET FOREIGN_KEY_CHECKS = 0');

		for (const tableName of tablesToDelete) {
			await dbConnection.query(`DELETE FROM \`${tableName}\``);
		}

		await dbConnection.query('SET FOREIGN_KEY_CHECKS = 1');
		await dbConnection.commit();

		res.json({ success: true, deletedTables: tablesToDelete });
	} catch (err) {
		console.error('delete-test-data error:', err);

		if (dbConnection) {
			try {
				await dbConnection.query('SET FOREIGN_KEY_CHECKS = 1');
			} catch (fkErr) {
				console.error('Failed to re-enable foreign key checks:', fkErr);
			}

			try {
				await dbConnection.rollback();
			} catch (rollbackErr) {
				console.error('Failed to rollback delete-test-data transaction:', rollbackErr);
			}
		}

		return res.status(500).json({ success: false, error: 'Failed to delete test data' });
	} finally {
		if (dbConnection) dbConnection.release();
	}
});

// Route para kunin ang Change agent name
pageRouter.get('/get-transfer-agent-name', (req, res) => {
	const transferAgentId = req.query.transferAgentId;

	const sql = `
        SELECT agent.AGENT_CODE, agent.NAME AS transfer_agent_name 
        FROM account 
        JOIN agent ON account.AGENT_ID = agent.IDNo 
        WHERE account.IDNO = ?`;

	connection.query(sql, [transferAgentId], (error, results) => {
		if (error) {
			console.error('Database error:', error);
			return res.status(500).send('Server error');
		}

		if (results.length > 0) {
			const { transfer_agent_name, AGENT_CODE } = results[0];
			res.json({ transfer_agent_name, agent_code: AGENT_CODE });
		} else {
			res.json({ transfer_agent_name: null, agent_code: null });
		}
	});
});



// GET Activity Logs for Agents, Guests, Transactions, Junket Expenses, Users, User Roles, and Bookings
pageRouter.get('/activity_logs', async (req, res) => {
	const query = `
    SELECT * FROM (
        -- AGENT
        (SELECT CONCAT('Agent ', a.AGENCY) AS name, 'added' AS action_type, a.ENCODED_DT AS action_time 
         FROM agency a WHERE a.ENCODED_DT IS NOT NULL)
        UNION ALL
        (SELECT CONCAT('Agent ', a.AGENCY) AS name, 'edited' AS action_type, a.EDITED_DT AS action_time 
         FROM agency a WHERE a.EDITED_DT IS NOT NULL AND a.ACTIVE = 1)
        UNION ALL
        (SELECT CONCAT('Agent ', a.AGENCY) AS name, 'deleted' AS action_type, a.EDITED_DT AS action_time 
         FROM agency a WHERE a.ACTIVE = 0 AND a.EDITED_DT IS NOT NULL)

        -- GUEST
        UNION ALL
        (SELECT CONCAT('Guest ', ag.NAME) AS name, 'added' AS action_type, ag.ENCODED_DT AS action_time 
         FROM agent ag WHERE ag.ENCODED_DT IS NOT NULL)
        UNION ALL
        (SELECT CONCAT('Guest ', ag.NAME) AS name, 'edited' AS action_type, ag.EDITED_DT AS action_time 
         FROM agent ag WHERE ag.EDITED_DT IS NOT NULL AND ag.ACTIVE = 1)
        UNION ALL
        (SELECT CONCAT('Guest ', ag.NAME) AS name, 'deleted' AS action_type, ag.EDITED_DT AS action_time 
         FROM agent ag WHERE ag.ACTIVE = 0 AND ag.EDITED_DT IS NOT NULL)

        -- TRANSACTION
        UNION ALL
        (
            SELECT 
                CONCAT(
                    'Transaction: ', 
                    CASE 
                        WHEN al.TRANSACTION_ID = 1 THEN 'Deposit'
                        WHEN al.TRANSACTION_ID = 2 THEN 'Withdraw'
                        WHEN al.TRANSACTION_ID = 3 THEN 'IOU'
                        ELSE 'Unknown Transaction'
                    END, 
                    ' - ', 
                    COALESCE(ag.NAME, 'Unknown Guest'), 
                    ' (₱', FORMAT(al.AMOUNT, 0), ') was Successful!'
                ) AS name,
                'transaction' AS action_type,
                al.ENCODED_DT AS action_time
            FROM account_ledger al
            JOIN account acc ON al.ACCOUNT_ID = acc.IDNo
            LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
            WHERE al.ACTIVE = 1 AND al.TRANSACTION_ID IN (1, 2, 3)
        )

        -- JUNKET EXPENSE (ADDED)
        UNION ALL
        (
            SELECT 
                CONCAT(
                    'Junket Expense: ', 
                    DESCRIPTION, 
                    ' (₱', FORMAT(AMOUNT, 0), ') was added.'
                ) AS name,
                'expense_added' AS action_type,
                ENCODED_DT AS action_time
            FROM junket_house_expense
            WHERE ACTIVE = 1 AND ENCODED_DT IS NOT NULL
        )

        -- JUNKET EXPENSE (EDITED)
        UNION ALL
        (
            SELECT 
                CONCAT(
                    'Junket Expense: ', 
                    DESCRIPTION, 
                    ' (₱', FORMAT(AMOUNT, 0), ') was edited.'
                ) AS name,
                'expense_edited' AS action_type,
                EDITED_DT AS action_time
            FROM junket_house_expense
            WHERE ACTIVE = 1 AND EDITED_DT IS NOT NULL
        )

        -- USER ADDED
        UNION ALL
        (
            SELECT 
                CONCAT('New User Account: ', FIRSTNAME, ' ', LASTNAME, ', (Username: ', USERNAME, ') has been added.') AS name,
                'user_added' AS action_type,
                ENCODED_DT AS action_time
            FROM user_info
            WHERE ENCODED_DT IS NOT NULL
        )

        -- USER EDITED
        UNION ALL
        (
            SELECT 
                CONCAT('User ', FIRSTNAME, ' ', LASTNAME, ' (Username: ', USERNAME, ') was edited.') AS name,
                'user_edited' AS action_type,
                EDITED_DT AS action_time
            FROM user_info
            WHERE EDITED_DT IS NOT NULL
        )

        -- ROLE ADDED
        UNION ALL
        (
            SELECT 
                CONCAT('New Role Added: ', ROLE) AS name,
                'role_added' AS action_type,
                ENCODED_DT AS action_time
            FROM user_role
            WHERE ENCODED_DT IS NOT NULL
        )

        -- ROLE EDITED
        UNION ALL
        (
            SELECT 
                CONCAT('User Role: ', ROLE, ' was edited.') AS name,
                'role_edited' AS action_type,
                EDITED_DT AS action_time
            FROM user_role
            WHERE EDITED_DT IS NOT NULL
        )

        -- BOOKING ADDED
        UNION ALL
        (
            SELECT
                CONCAT(
                    'New Booking:<br>',
                    'Confirmation #', b.CONFIRM_NUM,
                    ' (Guest: ', b.GUEST_NAME, ') - Check In: ',
                    DATE_FORMAT(b.CHECK_IN, '%b %d, %Y'),
                    ' /<br>',
                    '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Check Out: ',
                    DATE_FORMAT(b.CHECK_OUT, '%b %d, %Y'),
                    ' was added.'
                ) AS name,
                'booking_added' AS action_type,
                b.BOOKING_DATE AS action_time
            FROM booking b
            WHERE b.BOOKING_DATE IS NOT NULL
        )
    ) AS logs
    ORDER BY logs.action_time DESC
    LIMIT 5
`;

    try {
        const [results] = await pool.query(query);
        res.json(results);
    } catch (error) {
        console.error("🔥 ERROR fetching activity logs:", error);
        res.status(500).json({ message: "Server Error", error: error.sqlMessage || error.message });
    }
});



pageRouter.get('/get_winloss', (req, res) => {
	const range = req.query.range;

	let totalCondition = '';
	let groupCondition = '';
	let groupBy = '';
	let labels = [];
	let groupKeys = [];

	const currentYear = new Date().getFullYear();
	const currentMonth = new Date().getMonth(); // 0-based

	if (range === 'week') {
		// Current week total and chart per day (Sun–Sat)
		totalCondition = "AND YEARWEEK(ENCODED_DT, 1) = YEARWEEK(CURDATE(), 1)";
		groupCondition = totalCondition;
		groupBy = "DAYOFWEEK(ENCODED_DT)";
		labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
		groupKeys = [ 2, 3, 4, 5, 6, 7, 1]; // MySQL: 1 = Sunday
	} else if (range === 'month') {
		// Current month total, chart per month (Jan–Dec)
		totalCondition = `AND MONTH(ENCODED_DT) = ${currentMonth + 1} AND YEAR(ENCODED_DT) = ${currentYear}`;
		groupCondition = `AND YEAR(ENCODED_DT) = ${currentYear}`;
		groupBy = "MONTH(ENCODED_DT)";
		labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		groupKeys = Array.from({ length: 12 }, (_, i) => i + 1); // 1–12
	} else if (range === 'year') {
		const startYear = currentYear - 5;
		const endYear = currentYear;
		totalCondition = `AND YEAR(ENCODED_DT) = ${currentYear}`;
		groupCondition = `AND YEAR(ENCODED_DT) BETWEEN ${startYear} AND ${endYear}`;
		groupBy = "YEAR(ENCODED_DT)";
		labels = Array.from({ length: 6 }, (_, i) => `${startYear + i}`);
		groupKeys = labels.map(Number);
	} else {
		return res.status(400).json({ message: 'Invalid range' });
	}

	// Query for total win/loss (top number)
	const totalQuery = `
		SELECT
			SUM(CASE WHEN CAGE_TYPE = 1 THEN (NN_CHIPS + CC_CHIPS) ELSE 0 END) AS cashin,
			SUM(CASE WHEN CAGE_TYPE = 2 THEN (NN_CHIPS + CC_CHIPS) ELSE 0 END) AS cashout
		FROM game_record
		WHERE ACTIVE = 1  ${totalCondition}
	`;

	// Query for chart data
	const chartQuery = `
		SELECT 
			${groupBy} AS label,
			SUM(CASE WHEN CAGE_TYPE = 1 THEN (NN_CHIPS + CC_CHIPS) ELSE 0 END) AS cashin,
			SUM(CASE WHEN CAGE_TYPE = 2 THEN (NN_CHIPS + CC_CHIPS) ELSE 0 END) AS cashout
		FROM game_record
		WHERE ACTIVE = 1  ${groupCondition}
		GROUP BY ${groupBy}
		ORDER BY ${groupBy}
	`;

	connection.query(totalQuery, (err, totalResult) => {
		if (err) {
			console.error("Total Win/Loss Query Error:", err);
			return res.status(500).json({ winloss: 0 });
		}

		const totalCashin = totalResult[0]?.cashin || 0;
		const totalCashout = totalResult[0]?.cashout || 0;
		const totalWinloss = totalCashin - totalCashout;

		connection.query(chartQuery, (err, chartResult) => {
			if (err) {
				console.error("Chart Data Query Error:", err);
				return res.status(500).json({ winloss: totalWinloss });
			}

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
				chart: {
					data: net,
					labels
				}
			});
		});
	});
});











module.exports = pageRouter;