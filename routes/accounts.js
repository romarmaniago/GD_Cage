const express = require('express');
const router = express.Router();
const pool = require('../config/db');

const { checkSession, sessions } = require('./auth');
const { sendTelegramMessage, sendTelegramToAdditionalChats } = require('../utils/telegram');
const { guestPortalTransactionLogPreview, balanceCheckTelegramLogPreview } = require('../utils/telegramSendLog');
const { getAgentTelegramChatId } = require('../utils/agentTelegram');

const multer = require('multer');
const ExcelJS = require('exceljs');
const { applyCommaThousandsToNumericCells } = require('../utils/excelAmountFormat');
const path = require('path');
const fs = require('fs/promises');
const sharp = require('sharp');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const mapDirection = (txtTrans) => {
	switch (String(txtTrans)) {
		case '1':
			return 'DEPOSIT';
		case '2':
			return 'WITHDRAW';
		case '3':
			return 'CREDIT';
		case 'TRANSFER_OUT':
		case 'TRANSFER_IN':
			return txtTrans;
		default:
			return 'UNKNOWN';
	}
};

const getTransactionName = async (transactionId) => {
	if (!transactionId) return null;
	try {
		const [rows] = await pool.query('SELECT TRANSACTION FROM transaction_type WHERE IDNo = ?', [transactionId]);
		return rows[0]?.TRANSACTION || null;
	} catch (err) {
		console.error('Failed to fetch transaction name:', err);
		return null;
	}
};

/** Korean Telegram copy only when UI language is ko; English is the default (en / ja / zh). */
const isTelegramKorean = (req) => req && req.cookies && req.cookies.lang === 'ko';

const telegramCashTransactionTitle = (transaction, ko) => {
	if (ko) {
		if (transaction === 'DEPOSIT') return '어카운트 입금';
		if (transaction === 'WITHDRAW') return '어카운트 출금';
		if (transaction === 'CREDIT' || transaction === 'IOU CASH' || transaction === 'CREDIT CASH') return '크레딧';
	} else {
		if (transaction === 'DEPOSIT') return 'Account deposit';
		if (transaction === 'WITHDRAW') return 'Account withdrawal';
		if (transaction === 'CREDIT' || transaction === 'IOU CASH' || transaction === 'CREDIT CASH') return 'Credit';
	}
	return transaction;
};

const telegramAccountCashMessage = (req, opts) => {
	const ko = isTelegramKorean(req);
	const {
		transaction,
		guestAccountNum,
		guestName,
		displayWithdraw,
		amountForTelegram,
		txtTrans,
		txtRemarks,
		date_nowTG,
		updated_time
	} = opts;
	const L = ko
		? { account: '계정', amount: '금액', balance: '잔고', totalCredit: '총 크레딧', remarks: '비고', date: '날짜', time: '시간' }
		: { account: 'Account', amount: 'Amount', balance: 'Balance', totalCredit: 'Total credit', remarks: 'Remarks', date: 'Date', time: 'Time' };
	const title = telegramCashTransactionTitle(transaction, ko);
	const balanceLabel = String(txtTrans) === '3' ? L.totalCredit : L.balance;
	const remarksLine = txtRemarks ? `${L.remarks}: ${txtRemarks}\n` : '';
	return `Demo Cage\n\n* ${title} *\n\n${L.account}: ${guestAccountNum} - ${guestName}\n${L.amount}: ${parseFloat(Math.abs(displayWithdraw)).toLocaleString('en-US')}\n${balanceLabel}: ${parseFloat(amountForTelegram).toLocaleString('en-US')}\n${remarksLine}${L.date}: ${date_nowTG}\n${L.time}: ${updated_time}`;
};

const telegramBalanceCheckMessage = (req, AGENT_CODE, NAME, balanceFormatted, date_now, time_now) => {
	const ko = isTelegramKorean(req);
	const headline = ko ? '잔고 확인' : 'Balance check';
	const L = ko
		? { account: '계정', balance: '잔고', date: '날짜', time: '시간' }
		: { account: 'Account', balance: 'Balance', date: 'Date', time: 'Time' };
	return `Demo Cage\n\n* ${headline} *\n\n${L.account}: ${AGENT_CODE} - ${NAME}\n${L.balance}: ${balanceFormatted}\n\n${L.date}: ${date_now}\n${L.time}: ${time_now}`;
};

const telegramTransferFromMessage = (req, fromCode, fromName, toCode, toName, totalAmount, senderBalance, date_nowTG, updated_time) => {
	const ko = isTelegramKorean(req);
	const headline = ko ? '이체' : 'Transfer';
	const L = ko
		? { account: '계정', to: '받으신분', amount: '금액', balance: '잔고', date: '날짜', time: '시간' }
		: { account: 'Account', to: 'To', amount: 'Amount', balance: 'Balance', date: 'Date', time: 'Time' };
	return `Demo Cage\n\n* ${headline} *\n\n${L.account}: ${fromCode} - ${fromName}\n${L.to}: ${toCode} - ${toName}\n${L.amount}: -${totalAmount.toLocaleString('en-US')}\n${L.balance}: ${senderBalance.toLocaleString('en-US')}\n\n${L.date}: ${date_nowTG}\n${L.time}: ${updated_time}`;
};

const telegramTransferToMessage = (req, toCode, toName, fromCode, fromName, totalAmount, receiverBalance, date_nowTG, updated_time) => {
	const ko = isTelegramKorean(req);
	const headline = ko ? '이체' : 'Transfer';
	const L = ko
		? { to: '받으신분', from: '보내신분', amount: '금액', balance: '잔고', date: '날짜', time: '시간' }
		: { to: 'To', from: 'From', amount: 'Amount', balance: 'Balance', date: 'Date', time: 'Time' };
	return `Demo Cage\n\n* ${headline} *\n\n${L.to}: ${toCode} - ${toName}\n${L.from}: ${fromCode} - ${fromName}\n${L.amount}: ${totalAmount.toLocaleString('en-US')}\n${L.balance}: ${receiverBalance.toLocaleString('en-US')}\n\n${L.date}: ${date_nowTG}\n${L.time}: ${updated_time}`;
};

// Compute balance from ledger (shared) — excludes Credit/IOU (IOU CASH / CREDIT CASH)
const getCurrentBalance = async (accountId) => {
	const balanceQuery = `
		SELECT transaction_type.TRANSACTION, account_ledger.AMOUNT
		FROM account_ledger
		JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
		WHERE account_ledger.TRANSACTION_TYPE IN (2, 5, 3) AND account_ledger.ACCOUNT_ID = ? AND account_ledger.ACTIVE = 1
	`;
	const [rows] = await pool.query(balanceQuery, [accountId]);

	let deposit_amount = 0;
	let withdraw_amount = 0;
	let marker_redeem_amount = 0;
	let marker_return_deposit = 0;

	rows.forEach((row) => {
		const amount = parseFloat(row.AMOUNT) || 0;
		if (row.TRANSACTION === 'DEPOSIT') deposit_amount += amount;
		if (row.TRANSACTION === 'WITHDRAW') withdraw_amount += amount;
		if (row.TRANSACTION === 'MARKER REDEEM') marker_redeem_amount += amount;
		if (row.TRANSACTION === 'IOU RETURN DEPOSIT') marker_return_deposit += amount;
	});

	return deposit_amount + marker_redeem_amount - withdraw_amount - marker_return_deposit;
};

// Credit/IOU balance: TRANSACTION_ID (3,10) - (11,12,1), TRANSACTION_TYPE (3,4)
const getCreditBalance = async (accountId) => {
	const query = `
		SELECT 
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) -
			SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END) AS credit_balance
		FROM account_ledger
		WHERE account_ledger.ACTIVE = 1
		  AND account_ledger.TRANSACTION_TYPE IN (3, 4)
		  AND account_ledger.ACCOUNT_ID = ?
	`;
	const [[row]] = await pool.execute(query, [accountId]);
	return parseFloat(row?.credit_balance) || 0;
};

const recordHistory = async ({
	ledgerId = null,
	accountId,
	transactionId = null,
	transactionName = null,
	amount = 0,
	balanceBefore = null,
	balanceAfter = null,
	remarks = null,
	transferAccountId = null,
	direction = 'UNKNOWN',
	encodedBy = null,
	encodedDate = new Date()
}) => {
	const query = `
		INSERT INTO account_transaction_history
		(ledger_id, account_id, transaction_id, transaction_name, amount, balance_before, balance_after, remarks, transfer_account_id, direction, encoded_by, encoded_dt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`;

	try {
		await pool.query(query, [
			ledgerId,
			accountId,
			transactionId,
			transactionName,
			amount,
			balanceBefore,
			balanceAfter,
			remarks,
			transferAccountId,
			direction,
			encodedBy,
			encodedDate
		]);
	} catch (err) {
		// Do not block the main flow if history insert fails, but log for follow-up.
		console.error('account_transaction_history insert failed:', err);
	}
};

// Set up multer for multiple file uploads
const storage = multer.diskStorage({
	destination: 'PassportUpload/',
	filename: (req, file, cb) => {
		// Avoid encoding issues from original filenames; extension is normalized later to .webp.
		const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.upload`;
		cb(null, uniqueName);
	}
});

function collectMulterFiles(req) {
	const out = [];
	if (req.file) out.push(req.file);
	if (req.files) {
		if (Array.isArray(req.files)) out.push(...req.files);
		else {
			for (const k of Object.keys(req.files)) {
				const arr = req.files[k];
				if (Array.isArray(arr)) out.push(...arr);
			}
		}
	}
	return out;
}

async function convertPassportUploadsToWebp(req, res, next) {
	try {
		const files = collectMulterFiles(req);
		for (const f of files) {
			if (!f?.path) continue;
			const inPath = f.path;
			const dir = path.dirname(inPath);
			const base = path.basename(inPath, path.extname(inPath));
			const outName = `${base}.webp`;
			const outPath = path.join(dir, outName);

			await sharp(inPath)
				.rotate()
				.webp({ quality: 86 })
				.toFile(outPath);

			// Remove original upload bytes (jpg/png/gif/etc.)
			try {
				await fs.unlink(inPath);
			} catch (_) {
				/* ignore */
			}

			f.filename = outName;
			f.path = outPath;
			f.destination = dir;
			f.mimetype = 'image/webp';
		}
		next();
	} catch (err) {
		console.error('WebP conversion failed:', err);
		next(err);
	}
}


const uploadPassportImg = multer({
	storage: storage,
	limits: {
		fileSize: 5 * 1024 * 1024 // Limit file size to 5MB
	},
	fileFilter(req, file, cb) {
		const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
		if (!allowedTypes.includes(file.mimetype)) {
			return cb(new Error('File type not allowed'));
		}
		cb(null, true);
	}
});


router.get("/agency", checkSession, function (req, res) {

	const permissions = req.session.permissions;

	res.render("accounts/agency", {
		...sessions(req, 'agency'),
		permissions: permissions
	});
});

router.get("/agent", checkSession, function (req, res) {

	const permissions = req.session.permissions;

	res.render("accounts/agent", {
		...sessions(req, 'agent'),
		permissions: permissions
	});


});

router.get("/account_ledger", checkSession, function (req, res) {

	const permissions = req.session.permissions;

	res.render("accounts/account_ledger", {
		...sessions(req, 'account_ledger'),
		permissions: permissions
	});

});

// ADD AGENCY
router.post('/add_agency', async (req, res) => {
	try {
		const { txtAgency } = req.body;
		const date_now = new Date();

		const query = `INSERT INTO agency (AGENCY, ENCODED_BY, ENCODED_DT, ACTIVE) VALUES (?, ?, ?, ?)`;
		await pool.execute(query, [txtAgency, req.session.user_id, date_now, 1]);

		res.redirect('/agency');
	} catch (err) {
		console.error('Error inserting agency:', err);
		res.status(500).send('Error inserting agency');
	}
});

// GET AGENCY DATA
router.get('/agency_data', async (req, res) => {
	try {
		const query = `SELECT * FROM agency WHERE ACTIVE = 1 ORDER BY AGENCY ASC`;
		const [results] = await pool.execute(query);

		res.json(results);
	} catch (err) {
		console.error('Error fetching data:', err);
		res.status(500).send('Error fetching data');
	}
});

// Agency (LINE) page — summary cards: agents, rolling, win/loss, commission (scoped to one LINE or all)
router.get('/agency_line_stats', async (req, res) => {
	try {
		const agencyIdParam = req.query.agencyId;
		const agencyId = agencyIdParam !== undefined && agencyIdParam !== '' ? Number(agencyIdParam) : null;
		const hasAgencyFilter = agencyId !== null && !Number.isNaN(agencyId);
		const agencyFilter = hasAgencyFilter ? ' AND ag.AGENCY = ? ' : '';
		const agencyOnlyFilter = hasAgencyFilter ? ' AND a.IDNo = ? ' : '';

		const agentIds = String(req.query.agentIds || '')
			.split(',')
			.map((value) => parseInt(value, 10))
			.filter((value) => Number.isFinite(value) && value > 0);
		const hasAgentFilter = agentIds.length > 0;
		const agentFilter = hasAgentFilter ? ` AND ag.IDNo IN (${agentIds.map(() => '?').join(',')}) ` : '';

		const filterParams = hasAgencyFilter ? [agencyId] : [];
		const agentFilterParams = hasAgentFilter ? agentIds : [];
		const combinedParams = [...filterParams, ...agentFilterParams];

		const [[agentRow]] = await pool.execute(
			`SELECT COUNT(*) AS total_agent
			 FROM agent ag
			 WHERE ag.ACTIVE = 1
			 ${hasAgencyFilter ? 'AND ag.AGENCY = ?' : ''}
			 ${agentFilter}`,
			combinedParams
		);

		const [[lineRow]] = await pool.execute(
			hasAgentFilter
				? `SELECT COUNT(DISTINCT ag.AGENCY) AS total_line
				   FROM agent ag
				   WHERE ag.ACTIVE = 1
				   ${hasAgencyFilter ? 'AND ag.AGENCY = ?' : ''}
				   ${agentFilter}`
				: `SELECT COUNT(*) AS total_line
				   FROM agency a
				   WHERE a.ACTIVE = 1
				   ${agencyOnlyFilter}`,
			combinedParams
		);

		const [[guestRow]] = await pool.execute(
			`SELECT COUNT(*) AS total_guest
			 FROM account acc
			 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 WHERE acc.ACTIVE = 1
			   AND ag.ACTIVE = 1
			   ${agencyFilter}
			   ${agentFilter}`,
			combinedParams
		);

		const [gameRows] = await pool.execute(
			`SELECT
					gl.IDNo AS game_id,
					COALESCE(gl.COMMISSION_TYPE, 0) AS commission_type,
					COALESCE(gl.COMMISSION_PERCENTAGE, 0) AS commission_percentage,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 1 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS total_amount,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS total_cash_out_chips,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_cash_out_nn,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 3 THEN gr.AMOUNT ELSE 0 END), 0) AS total_rolling_amount,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 3 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_rolling_nn,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.AMOUNT ELSE 0 END), 0) AS total_rolling_real,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_rolling_nn_real,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.CC_CHIPS ELSE 0 END), 0) AS total_rolling_cc_real,
					COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 5 AND COALESCE(gr.ROLLER_TRANSACTION, 1) = 2 THEN gr.ROLLER_CC_CHIPS ELSE 0 END), 0) AS total_roller_return_cc
			 FROM game_list gl
			 INNER JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
			 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 LEFT JOIN game_record gr ON gr.GAME_ID = gl.IDNo AND gr.ACTIVE = 1
			 WHERE gl.ACTIVE IN (1, 2)
			   AND acc.ACTIVE = 1
			   AND ag.ACTIVE = 1
			 ${agencyFilter}
			 ${agentFilter}
			 GROUP BY gl.IDNo, gl.COMMISSION_TYPE, gl.COMMISSION_PERCENTAGE`,
			combinedParams
		);
		const [balanceRows] = await pool.execute(
			`SELECT
					COALESCE(SUM(led.total_balance), 0) AS total_balance
			 FROM account acc
			 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 LEFT JOIN (
				SELECT
					al.ACCOUNT_ID,
					SUM(CASE WHEN tt.TRANSACTION = 'DEPOSIT' THEN al.AMOUNT ELSE 0 END) +
					SUM(CASE WHEN tt.TRANSACTION = 'MARKER REDEEM' THEN al.AMOUNT ELSE 0 END) -
					SUM(CASE WHEN tt.TRANSACTION = 'WITHDRAW' THEN al.AMOUNT ELSE 0 END) -
					SUM(CASE WHEN tt.TRANSACTION = 'IOU RETURN DEPOSIT' THEN al.AMOUNT ELSE 0 END) AS total_balance
				FROM account_ledger al
				INNER JOIN transaction_type tt ON tt.IDNo = al.TRANSACTION_ID
				WHERE al.ACTIVE = 1
				  AND al.TRANSACTION_TYPE IN (2, 5, 3)
				GROUP BY ACCOUNT_ID
			 ) AS led ON led.ACCOUNT_ID = acc.IDNo
			 WHERE acc.ACTIVE = 1
			   AND ag.ACTIVE = 1
			   ${agencyFilter}
			   ${agentFilter}`,
			combinedParams
		);
		const [creditRows] = await pool.execute(
			`SELECT
					COALESCE(SUM(cred.credit_balance), 0) AS total_credit
			 FROM account acc
			 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 LEFT JOIN (
				SELECT
					al.ACCOUNT_ID,
					SUM(CASE WHEN al.TRANSACTION_ID IN (3, 10) THEN al.AMOUNT ELSE 0 END) -
					SUM(CASE WHEN al.TRANSACTION_ID IN (11, 12, 1) THEN al.AMOUNT ELSE 0 END) AS credit_balance
				FROM account_ledger al
				WHERE al.ACTIVE = 1
				  AND al.TRANSACTION_TYPE IN (3, 4)
				GROUP BY al.ACCOUNT_ID
			 ) AS cred ON cred.ACCOUNT_ID = acc.IDNo
			 WHERE acc.ACTIVE = 1
			   AND ag.ACTIVE = 1
			   ${agencyFilter}
			   ${agentFilter}`,
			combinedParams
		);

		let totalRolling = 0;
		let totalWinLoss = 0;
		let totalCommission = 0;

		for (const row of gameRows) {
			const totalRollingChips =
				(Number(row.total_rolling_nn) || 0) +
				(Number(row.total_roller_return_cc) || 0) +
				(Number(row.total_rolling_amount) || 0) +
				(Number(row.total_rolling_real) || 0) +
				(Number(row.total_rolling_nn_real) || 0) +
				(Number(row.total_rolling_cc_real) || 0) -
				(Number(row.total_cash_out_nn) || 0);

			const winLoss = (Number(row.total_amount) || 0) - (Number(row.total_cash_out_chips) || 0);
			const commissionRate = Number(row.commission_percentage) || 0;
			const commissionType = Number(row.commission_type) || 0;
			let net = 0;

			if (commissionType === 1 || commissionType === 3) {
				net = Math.round((totalRollingChips * commissionRate) / 100);
			} else if (commissionType === 2) {
				net = Math.round((winLoss * commissionRate) / 100);
			}

			totalRolling += totalRollingChips;
			totalWinLoss += winLoss;
			totalCommission += net;
		}

		res.json({
			total_line: Number(lineRow?.total_line ?? 0),
			total_agent: Number(agentRow?.total_agent ?? 0),
			total_guest: Number(guestRow?.total_guest ?? 0),
			total_rolling: totalRolling,
			total_winloss: totalWinLoss,
			total_commission: totalCommission,
			total_balance: Number(balanceRows?.[0]?.total_balance ?? 0),
			total_credit: Number(creditRows?.[0]?.total_credit ?? 0)
		});
	} catch (err) {
		console.error('Error in /agency_line_stats:', err);
		res.status(500).json({ error: 'Failed to load line statistics.' });
	}
});

// Agency page — selected AGENT summary cards
router.get('/agency_agent_stats', async (req, res) => {
	try {
		const agentId = Number(req.query.agentId);
		if (!agentId || Number.isNaN(agentId)) {
			return res.status(400).json({ error: 'Invalid agent id.' });
		}

		const [[guestRow]] = await pool.execute(
			`SELECT COUNT(*) AS total_guest
			 FROM guest
			 WHERE ACTIVE = 1 AND AGENT_ID = ?`,
			[agentId]
		);

		const [[gamesRow]] = await pool.execute(
			`SELECT COUNT(*) AS total_games
			 FROM game_list gl
			 INNER JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
			 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 WHERE gl.ACTIVE IN (1, 2)
			   AND acc.ACTIVE = 1
			   AND ag.ACTIVE = 1
			   AND ag.IDNo = ?`,
			[agentId]
		);

		const agentStats = await fetchAgentFinancialStats(agentId);

		return res.json({
			total_guest: Number(guestRow?.total_guest ?? 0),
			total_games: Number(gamesRow?.total_games ?? 0),
			total_rolling: agentStats.total_rolling,
			total_winloss: agentStats.total_winloss,
			total_commission: agentStats.total_commission,
			total_balance: agentStats.total_balance,
			total_credit: agentStats.total_credit
		});
	} catch (err) {
		console.error('Error in /agency_agent_stats:', err);
		return res.status(500).json({ error: 'Failed to load agent statistics.' });
	}
});

// OPTIONS FOR ACCOUNT TRANSFER BETWEEN AGENTS
router.get('/agency_transfer_options', async (req, res) => {
	try {
		const excludeAgencyId = Number(req.query.excludeAgencyId);
		if (!excludeAgencyId || Number.isNaN(excludeAgencyId)) {
			return res.status(400).json({ error: 'Invalid source agency id.' });
		}

		const [agencies] = await pool.execute(
			`SELECT IDNo AS agency_id, AGENCY AS agency_name
			 FROM agency
			 WHERE ACTIVE = 1 AND IDNo <> ?
			 ORDER BY AGENCY ASC`,
			[excludeAgencyId]
		);

		const [[countRow]] = await pool.execute(
			`SELECT COUNT(acc.IDNo) AS account_count
			 FROM account acc
			 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 WHERE acc.ACTIVE = 1
			   AND ag.ACTIVE = 1
			   AND ag.AGENCY = ?`,
			[excludeAgencyId]
		);

		return res.json({
			agencies,
			accountCount: Number(countRow?.account_count || 0)
		});
	} catch (error) {
		console.error('Error loading transfer agency options:', error);
		return res.status(500).json({ error: 'Error loading transfer options.' });
	}
});

// EDIT AGENCY
router.put('/agency/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const { txtAgency } = req.body;
		const date_now = new Date();

		const query = `UPDATE agency SET AGENCY = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query, [txtAgency, req.session.user_id, date_now, id]);

		res.send('Agency updated successfully');
	} catch (err) {
		console.error('Error updating agency:', err);
		res.status(500).send('Error updating agency');
	}
});

// ARCHIVE AGENCY (Super Admin only)
router.put('/agency/remove/:id', async (req, res) => {
	try {
		const permissions = req.session?.permissions;
		if (permissions !== 0) {
			return res.status(403).json({ success: false, message: 'Only Super Admin can delete agencies.' });
		}

		const id = parseInt(req.params.id);
		const date_now = new Date();

		const query = `UPDATE agency SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query, [0, req.session.user_id, date_now, id]);

		res.send('Agency updated successfully');
	} catch (err) {
		console.error('Error updating agency:', err);
		res.status(500).send('Error updating agency');
	}
});


// ADD AGENT
router.post(
	'/add_agent',
	uploadPassportImg.fields([{ name: 'photo', maxCount: 1 }, { name: 'passportImage', maxCount: 1 }]),
	convertPassportUploadsToWebp,
	async (req, res) => {
	// API key check for Passport Scanner app (no session)
	const apiKey = req.headers['x-api-key'];
	const validApiKey = process.env.SCANNER_API_KEY;
	const hasValidApiKey = validApiKey && apiKey === validApiKey;
  
	if (!req.session?.user_id && !hasValidApiKey) {
	  return res.status(401).json({ error: 'Unauthorized' });
	}
  
	try {
		const { txtAgencyLine, txtAgenctCode, txtName, txtRemarks, txtTelegram, txtContact, txtDocumentType, txtCountryCode, txtPassportNo, txtNationality, txtDateOfBirth, txtExpiryDate, txtGender, txtMrzLine } = req.body;
		const date_now = new Date();
		const faceFile = req.files?.photo?.[0];
		const passportFile = req.files?.passportImage?.[0];
		const photoPath = faceFile ? faceFile.filename : null;
		const passportImagePath = passportFile ? passportFile.filename : (faceFile ? faceFile.filename : null);

		const insertAgentQuery = `
			INSERT INTO agent (AGENCY, AGENT_CODE, NAME, CONTACTNo, TELEGRAM_ID, REMARKS, PHOTO, ENCODED_BY, ENCODED_DT)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
		const encodedBy = req.session?.user_id ?? 1; // 1 = fallback when no session (e.g. passport scanner from mobile)
		const agentParams = [
			txtAgencyLine ?? '',
			txtAgenctCode ?? '',
			txtName ?? '',
			txtContact ?? '',
			txtTelegram ?? '',
			txtRemarks ?? '',
			photoPath ?? null,
			encodedBy,
			date_now
		];

		const [agentResult] = await pool.execute(insertAgentQuery, agentParams);
		const agent_id = agentResult.insertId;

		const insertAccountQuery = `
			INSERT INTO account (AGENT_ID, GUESTNo, MEMBERSHIPNo, ENCODED_BY, ENCODED_DT)
			VALUES (?, ?, ?, ?, ?)`;
		await pool.execute(insertAccountQuery, [agent_id, '', '', encodedBy, date_now]);

		// Insert passport details only when coming from passport scanner (has passport image or passport number)
		const hasPassportData = passportImagePath || (txtPassportNo && String(txtPassportNo).trim());
		if (hasPassportData) {
			const dobVal = txtDateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(String(txtDateOfBirth).trim()) ? txtDateOfBirth.trim() : null;
			const expiryVal = txtExpiryDate && /^\d{4}-\d{2}-\d{2}$/.test(String(txtExpiryDate).trim()) ? txtExpiryDate.trim() : null;
			try {
				await pool.execute(
					`INSERT INTO agent_passport (AGENT_ID, DOCUMENT_TYPE, COUNTRY_CODE, PASSPORT_NO, FULL_NAME, NATIONALITY, DATE_OF_BIRTH, EXPIRY_DATE, GENDER, MRZ_LINE, PASSPORT_IMAGE, ENCODED_BY, ENCODED_DT)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[agent_id, txtDocumentType ?? null, txtCountryCode ?? null, txtPassportNo ?? null, txtName ?? null, txtNationality ?? null, dobVal, expiryVal, txtGender ?? null, txtMrzLine ?? null, passportImagePath ?? null, encodedBy, date_now]
				);
			} catch (passportErr) {
				console.warn('⚠ agent_passport insert skipped (table may not exist):', passportErr.message);
			}
		}

		const isApiRequest = req.headers['x-api-key'] || req.headers['content-type']?.includes('multipart/form-data') && !req.session?.user_id;
		if (isApiRequest && !req.session?.user_id) {
		  return res.status(200).json({ success: true, agent_id });
		}
		res.redirect('/agent');
	} catch (err) {
		console.error('Error adding agent:', err);
		res.status(500).send('Error adding agent');
	}
});


// GET AGENT (optional ?profileIncomplete=1 — agents with no usable profile photo and/or no passport number on file)
router.get('/agent_data', async (req, res) => {
	try {
		const raw = String(req.query.profileIncomplete ?? '');
		const profileIncomplete = ['1', 'true', 'yes'].includes(raw.toLowerCase());

		let query = `
			SELECT *, agency.AGENCY AS agency_name, agency.IDNo AS agency_id,
			agent.AGENT_CODE AS agent_code, agent.IDNo AS agent_id, agent.ACTIVE AS active
			FROM agent
			JOIN agency ON agent.AGENCY = agency.IDNo
			WHERE agent.ACTIVE = 1`;

		if (profileIncomplete) {
			query += ` AND (
				(agent.PHOTO IS NULL OR TRIM(COALESCE(agent.PHOTO, '')) = '' OR LOWER(TRIM(agent.PHOTO)) = 'default.jpg')
				OR NOT EXISTS (
					SELECT 1 FROM agent_passport apx
					WHERE apx.AGENT_ID = agent.IDNo
					AND (
						(apx.PASSPORT_NO IS NOT NULL AND TRIM(apx.PASSPORT_NO) <> '')
						OR (apx.PASSPORT_IMAGE IS NOT NULL AND TRIM(apx.PASSPORT_IMAGE) <> '')
					)
				)
			)`;
		}

		const [results] = await pool.execute(query);
		res.json(results);
	} catch (error) {
		console.error('❌ Error fetching agent data:', error);
		res.status(500).send('Error fetching data');
	}
});


// GET AGENT DATA BY ID
router.get('/agent_data/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const query = `
			SELECT CONCAT_WS(" ", FIRSTNAME, MIDDLENAME, LASTNAME) AS agent_name,
				   agent.IDNo AS agent_id,
				   agency.AGENCY AS agency,
				   agency.IDNo AS agency_id
			FROM agent
			JOIN agency ON agent.AGENCY = agency.IDNo
			WHERE agent.IDNo = ? AND agent.ACTIVE = 1`;
		const [results] = await pool.execute(query, [id]);
		res.json(results);
	} catch (error) {
		console.error('❌ Error fetching agent by ID:', error);
		res.status(500).send('Error fetching data');
	}
});

function aggregateGuestDataRows(guestRows, gameRows, balanceCreditMap) {
	const resultMap = {};
	(guestRows || []).forEach((g) => {
		const key = String(g.guest_id);
		const balanceCredit = (balanceCreditMap && balanceCreditMap[key]) || {};
		resultMap[key] = {
			guest_id: g.guest_id,
			agent_id: g.agent_id,
			guest_name: g.guest_name,
			membership_no: g.membership_no,
			guest_remarks: g.guest_remarks,
			agent_code: g.agent_code || null,
			agent_name: g.agent_name || null,
			agency_id: g.agency_id || null,
			agency_name: g.agency_name || null,
			total_balance: Number(balanceCredit.total_balance) || 0,
			total_credit: Number(balanceCredit.total_credit) || 0,
			total_games: 0,
			total_rolling: 0,
			total_winloss: 0,
			total_commission: 0
		};
	});

	(gameRows || []).forEach((row) => {
		const guestKey = String(row.guest_id || '').trim();
		const bucket = resultMap[guestKey];
		if (!bucket) return;

		const totalRollingChips =
			(Number(row.total_rolling_nn) || 0) +
			(Number(row.total_roller_return_cc) || 0) +
			(Number(row.total_rolling_amount) || 0) +
			(Number(row.total_rolling_real) || 0) +
			(Number(row.total_rolling_nn_real) || 0) +
			(Number(row.total_rolling_cc_real) || 0) -
			(Number(row.total_cash_out_nn) || 0);

		const winLoss = (Number(row.total_amount) || 0) - (Number(row.total_cash_out_chips) || 0);
		const commissionRate = Number(row.commission_percentage) || 0;
		const commissionType = Number(row.commission_type) || 0;
		let net = 0;

		if (commissionType === 1 || commissionType === 3) {
			net = Math.round((totalRollingChips * commissionRate) / 100);
		} else if (commissionType === 2) {
			net = Math.round((winLoss * commissionRate) / 100);
		}

		bucket.total_games += 1;
		bucket.total_rolling += totalRollingChips;
		bucket.total_winloss += winLoss;
		bucket.total_commission += net;
	});

	return Object.values(resultMap);
}

function emptyFinancialStats() {
	return {
		total_balance: 0,
		total_credit: 0,
		total_rolling: 0,
		total_winloss: 0,
		total_commission: 0
	};
}

function addFinancialStats(target, source) {
	target.total_balance += Number(source?.total_balance) || 0;
	target.total_credit += Number(source?.total_credit) || 0;
	target.total_rolling += Number(source?.total_rolling) || 0;
	target.total_winloss += Number(source?.total_winloss) || 0;
	target.total_commission += Number(source?.total_commission) || 0;
}

function sumGameRowMetrics(gameRows) {
	const totals = emptyFinancialStats();
	for (const row of gameRows || []) {
		const totalRollingChips =
			(Number(row.total_rolling_nn) || 0) +
			(Number(row.total_roller_return_cc) || 0) +
			(Number(row.total_rolling_amount) || 0) +
			(Number(row.total_rolling_real) || 0) +
			(Number(row.total_rolling_nn_real) || 0) +
			(Number(row.total_rolling_cc_real) || 0) -
			(Number(row.total_cash_out_nn) || 0);

		const winLoss = (Number(row.total_amount) || 0) - (Number(row.total_cash_out_chips) || 0);
		const commissionRate = Number(row.commission_percentage) || 0;
		const commissionType = Number(row.commission_type) || 0;
		let net = 0;

		if (commissionType === 1 || commissionType === 3) {
			net = Math.round((totalRollingChips * commissionRate) / 100);
		} else if (commissionType === 2) {
			net = Math.round((winLoss * commissionRate) / 100);
		}

		totals.total_rolling += totalRollingChips;
		totals.total_winloss += winLoss;
		totals.total_commission += net;
	}
	return totals;
}

async function fetchAgencyLineFinancialStats(agencyId) {
	const [gameRows] = await pool.execute(
		`SELECT
				gl.IDNo AS game_id,
				COALESCE(gl.COMMISSION_TYPE, 0) AS commission_type,
				COALESCE(gl.COMMISSION_PERCENTAGE, 0) AS commission_percentage,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 1 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS total_amount,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS total_cash_out_chips,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_cash_out_nn,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 3 THEN gr.AMOUNT ELSE 0 END), 0) AS total_rolling_amount,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 3 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_rolling_nn,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.AMOUNT ELSE 0 END), 0) AS total_rolling_real,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_rolling_nn_real,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.CC_CHIPS ELSE 0 END), 0) AS total_rolling_cc_real,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 5 AND COALESCE(gr.ROLLER_TRANSACTION, 1) = 2 THEN gr.ROLLER_CC_CHIPS ELSE 0 END), 0) AS total_roller_return_cc
		 FROM game_list gl
		 INNER JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
		 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 LEFT JOIN game_record gr ON gr.GAME_ID = gl.IDNo AND gr.ACTIVE = 1
		 WHERE gl.ACTIVE IN (1, 2)
		   AND acc.ACTIVE = 1
		   AND ag.ACTIVE = 1
		   AND ag.AGENCY = ?
		 GROUP BY gl.IDNo, gl.COMMISSION_TYPE, gl.COMMISSION_PERCENTAGE`,
		[agencyId]
	);
	const [[balanceRow]] = await pool.execute(
		`SELECT
				COALESCE(SUM(led.total_balance), 0) AS total_balance
		 FROM account acc
		 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 LEFT JOIN (
			SELECT
				al.ACCOUNT_ID,
				SUM(CASE WHEN tt.TRANSACTION = 'DEPOSIT' THEN al.AMOUNT ELSE 0 END) +
				SUM(CASE WHEN tt.TRANSACTION = 'MARKER REDEEM' THEN al.AMOUNT ELSE 0 END) -
				SUM(CASE WHEN tt.TRANSACTION = 'WITHDRAW' THEN al.AMOUNT ELSE 0 END) -
				SUM(CASE WHEN tt.TRANSACTION = 'IOU RETURN DEPOSIT' THEN al.AMOUNT ELSE 0 END) AS total_balance
			FROM account_ledger al
			INNER JOIN transaction_type tt ON tt.IDNo = al.TRANSACTION_ID
			WHERE al.ACTIVE = 1
			  AND al.TRANSACTION_TYPE IN (2, 5, 3)
			GROUP BY ACCOUNT_ID
		 ) AS led ON led.ACCOUNT_ID = acc.IDNo
		 WHERE acc.ACTIVE = 1
		   AND ag.ACTIVE = 1
		   AND ag.AGENCY = ?`,
		[agencyId]
	);
	const [[creditRow]] = await pool.execute(
		`SELECT
				COALESCE(SUM(cred.credit_balance), 0) AS total_credit
		 FROM account acc
		 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 LEFT JOIN (
			SELECT
				al.ACCOUNT_ID,
				SUM(CASE WHEN al.TRANSACTION_ID IN (3, 10) THEN al.AMOUNT ELSE 0 END) -
				SUM(CASE WHEN al.TRANSACTION_ID IN (11, 12, 1) THEN al.AMOUNT ELSE 0 END) AS credit_balance
			FROM account_ledger al
			WHERE al.ACTIVE = 1
			  AND al.TRANSACTION_TYPE IN (3, 4)
			GROUP BY al.ACCOUNT_ID
		 ) AS cred ON cred.ACCOUNT_ID = acc.IDNo
		 WHERE acc.ACTIVE = 1
		   AND ag.ACTIVE = 1
		   AND ag.AGENCY = ?`,
		[agencyId]
	);

	const gameTotals = sumGameRowMetrics(gameRows);
	return {
		total_balance: Number(balanceRow?.total_balance ?? 0),
		total_credit: Number(creditRow?.total_credit ?? 0),
		total_rolling: gameTotals.total_rolling,
		total_winloss: gameTotals.total_winloss,
		total_commission: gameTotals.total_commission
	};
}

async function fetchAgentFinancialStats(agentId) {
	const [gameRows] = await pool.execute(
		`SELECT
				gl.IDNo AS game_id,
				COALESCE(gl.COMMISSION_TYPE, 0) AS commission_type,
				COALESCE(gl.COMMISSION_PERCENTAGE, 0) AS commission_percentage,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 1 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS total_amount,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS total_cash_out_chips,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_cash_out_nn,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 3 THEN gr.AMOUNT ELSE 0 END), 0) AS total_rolling_amount,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 3 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_rolling_nn,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.AMOUNT ELSE 0 END), 0) AS total_rolling_real,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_rolling_nn_real,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.CC_CHIPS ELSE 0 END), 0) AS total_rolling_cc_real,
				COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 5 AND COALESCE(gr.ROLLER_TRANSACTION, 1) = 2 THEN gr.ROLLER_CC_CHIPS ELSE 0 END), 0) AS total_roller_return_cc
		 FROM game_list gl
		 INNER JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
		 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 LEFT JOIN game_record gr ON gr.GAME_ID = gl.IDNo AND gr.ACTIVE = 1
		 WHERE gl.ACTIVE IN (1, 2)
		   AND acc.ACTIVE = 1
		   AND ag.ACTIVE = 1
		   AND ag.IDNo = ?
		 GROUP BY gl.IDNo, gl.COMMISSION_TYPE, gl.COMMISSION_PERCENTAGE`,
		[agentId]
	);
	const [[balanceRow]] = await pool.execute(
		`SELECT
				COALESCE(SUM(led.total_balance), 0) AS total_balance
		 FROM account acc
		 LEFT JOIN (
			SELECT
				al.ACCOUNT_ID,
				SUM(CASE WHEN tt.TRANSACTION = 'DEPOSIT' THEN al.AMOUNT ELSE 0 END) +
				SUM(CASE WHEN tt.TRANSACTION = 'MARKER REDEEM' THEN al.AMOUNT ELSE 0 END) -
				SUM(CASE WHEN tt.TRANSACTION = 'WITHDRAW' THEN al.AMOUNT ELSE 0 END) -
				SUM(CASE WHEN tt.TRANSACTION = 'IOU RETURN DEPOSIT' THEN al.AMOUNT ELSE 0 END) AS total_balance
			FROM account_ledger al
			INNER JOIN transaction_type tt ON tt.IDNo = al.TRANSACTION_ID
			WHERE al.ACTIVE = 1
			  AND al.TRANSACTION_TYPE IN (2, 5, 3)
			GROUP BY ACCOUNT_ID
		 ) AS led ON led.ACCOUNT_ID = acc.IDNo
		 WHERE acc.ACTIVE = 1
		   AND acc.AGENT_ID = ?`,
		[agentId]
	);
	const [[creditRow]] = await pool.execute(
		`SELECT
				COALESCE(SUM(cred.credit_balance), 0) AS total_credit
		 FROM account acc
		 LEFT JOIN (
			SELECT
				al.ACCOUNT_ID,
				SUM(CASE WHEN al.TRANSACTION_ID IN (3, 10) THEN al.AMOUNT ELSE 0 END) -
				SUM(CASE WHEN al.TRANSACTION_ID IN (11, 12, 1) THEN al.AMOUNT ELSE 0 END) AS credit_balance
			FROM account_ledger al
			WHERE al.ACTIVE = 1
			  AND al.TRANSACTION_TYPE IN (3, 4)
			GROUP BY al.ACCOUNT_ID
		 ) AS cred ON cred.ACCOUNT_ID = acc.IDNo
		 WHERE acc.ACTIVE = 1
		   AND acc.AGENT_ID = ?`,
		[agentId]
	);

	const gameTotals = sumGameRowMetrics(gameRows);
	return {
		total_balance: Number(balanceRow?.total_balance ?? 0),
		total_credit: Number(creditRow?.total_credit ?? 0),
		total_rolling: gameTotals.total_rolling,
		total_winloss: gameTotals.total_winloss,
		total_commission: gameTotals.total_commission
	};
}

async function fetchAgencyGuestStatsForExport(agencyId) {
	const guestSelect = `
		g.IDNo AS guest_id,
		g.AGENT_ID AS agent_id,
		g.NAME AS guest_name,
		g.MEMBERSHIP_NO AS membership_no,
		g.REMARKS AS guest_remarks,
		ag.AGENT_CODE AS agent_code,
		ag.NAME AS agent_name,
		ag.AGENCY AS agency_id,
		ay.AGENCY AS agency_name
	`;
	const guestQuery = `
		SELECT ${guestSelect}
		FROM guest g
		INNER JOIN agent ag ON ag.IDNo = g.AGENT_ID AND ag.ACTIVE = 1
		INNER JOIN agency ay ON ay.IDNo = ag.AGENCY AND ay.ACTIVE = 1
		WHERE ag.AGENCY = ? AND g.ACTIVE = 1
		ORDER BY ag.NAME ASC, ag.AGENT_CODE ASC, g.NAME ASC, g.IDNo ASC
	`;
	const gameQuery = GUEST_DATA_GAME_QUERY.replace('{{SCOPE_FILTER}}', 'ag.AGENCY = ?');
	const [guestRows] = await pool.execute(guestQuery, [agencyId]);
	if (!Array.isArray(guestRows) || guestRows.length === 0) {
		return [];
	}
	const [gameRows] = await pool.execute(gameQuery, [agencyId]);
	const guestIds = guestRows.map((row) => row.guest_id).filter(Boolean);
	const balanceCreditMap = await fetchGuestBalanceCreditMap(guestIds);
	return aggregateGuestDataRows(guestRows, gameRows, balanceCreditMap);
}

async function fetchGuestBalanceCreditMap(guestIds) {
	const map = {};
	if (!Array.isArray(guestIds) || guestIds.length === 0) {
		return map;
	}

	const placeholders = guestIds.map(() => '?').join(',');
	const params = guestIds;

	const [balanceRows] = await pool.execute(
		`SELECT gl.GUEST_ID AS guest_id,
			COALESCE(SUM(
				CASE
					WHEN tt.TRANSACTION IN ('DEPOSIT', 'MARKER REDEEM') THEN al.AMOUNT
					WHEN tt.TRANSACTION IN ('WITHDRAW', 'IOU RETURN DEPOSIT') THEN -al.AMOUNT
					ELSE 0
				END
			), 0) AS total_balance
		 FROM game_list gl
		 INNER JOIN account_ledger al ON al.GAME_ID = gl.IDNo
		   AND al.ACCOUNT_ID = gl.ACCOUNT_ID
		   AND al.ACTIVE = 1
		 INNER JOIN transaction_type tt ON tt.IDNo = al.TRANSACTION_ID
		 WHERE gl.GUEST_ID IN (${placeholders})
		   AND al.TRANSACTION_TYPE IN (2, 3, 5)
		 GROUP BY gl.GUEST_ID`,
		params
	);

	const [creditRows] = await pool.execute(
		`SELECT guest_id,
			COALESCE(SUM(game_credit_balance), 0) AS total_credit
		 FROM (
			SELECT gl.GUEST_ID AS guest_id,
				GREATEST(
					0,
					COALESCE(SUM(CASE WHEN al.TRANSACTION_ID IN (3, 10) THEN al.AMOUNT ELSE 0 END), 0) -
					COALESCE(SUM(CASE WHEN al.TRANSACTION_ID IN (11, 12, 1) THEN al.AMOUNT ELSE 0 END), 0)
				) AS game_credit_balance
			FROM game_list gl
			LEFT JOIN account_ledger al ON al.GAME_ID = gl.IDNo
			  AND al.ACCOUNT_ID = gl.ACCOUNT_ID
			  AND al.ACTIVE = 1
			  AND al.TRANSACTION_TYPE IN (3, 4)
			  AND (al.TRANSACTION_ID IN (3, 10, 11, 12, 1) OR al.TRANSACTION_TYPE = 4)
			WHERE gl.GUEST_ID IN (${placeholders})
			GROUP BY gl.IDNo, gl.GUEST_ID
		 ) AS game_credit
		 GROUP BY guest_id`,
		params
	);

	(balanceRows || []).forEach((row) => {
		const key = String(row.guest_id);
		if (!map[key]) map[key] = { total_balance: 0, total_credit: 0 };
		map[key].total_balance = Number(row.total_balance) || 0;
	});

	(creditRows || []).forEach((row) => {
		const key = String(row.guest_id);
		if (!map[key]) map[key] = { total_balance: 0, total_credit: 0 };
		map[key].total_credit = Number(row.total_credit) || 0;
	});

	return map;
}

const GUEST_DATA_GAME_QUERY = `
	SELECT
		gl.GUEST_ID AS guest_id,
		gl.IDNo AS game_id,
		COALESCE(gl.COMMISSION_TYPE, 0) AS commission_type,
		COALESCE(gl.COMMISSION_PERCENTAGE, 0) AS commission_percentage,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 1 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS total_amount,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS total_cash_out_chips,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_cash_out_nn,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 3 THEN gr.AMOUNT ELSE 0 END), 0) AS total_rolling_amount,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 3 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_rolling_nn,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.AMOUNT ELSE 0 END), 0) AS total_rolling_real,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.NN_CHIPS ELSE 0 END), 0) AS total_rolling_nn_real,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 4 THEN gr.CC_CHIPS ELSE 0 END), 0) AS total_rolling_cc_real,
		COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 5 AND COALESCE(gr.ROLLER_TRANSACTION, 1) = 2 THEN gr.ROLLER_CC_CHIPS ELSE 0 END), 0) AS total_roller_return_cc
	FROM game_list gl
	INNER JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
	INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID
	LEFT JOIN game_record gr ON gr.GAME_ID = gl.IDNo AND gr.ACTIVE = 1
	WHERE ag.ACTIVE = 1
	  AND acc.ACTIVE = 1
	  AND gl.ACTIVE IN (1, 2)
	  AND {{SCOPE_FILTER}}
	GROUP BY
		gl.GUEST_ID,
		gl.IDNo,
		gl.COMMISSION_TYPE,
		gl.COMMISSION_PERCENTAGE
`;

// GET GUEST DATA (by agent, agency, or all)
router.get('/guest_data', async (req, res) => {
	try {
		const agentId = parseInt(req.query.agentId, 10);
		const agencyId = parseInt(req.query.agencyId, 10);
		const allGuests = String(req.query.all || '') === '1';

		if (!agentId && !agencyId && !allGuests) {
			return res.json([]);
		}

		const guestSelect = `
			g.IDNo AS guest_id,
			g.AGENT_ID AS agent_id,
			g.NAME AS guest_name,
			g.MEMBERSHIP_NO AS membership_no,
			g.REMARKS AS guest_remarks,
			ag.AGENT_CODE AS agent_code,
			ag.NAME AS agent_name,
			ag.AGENCY AS agency_id,
			ay.AGENCY AS agency_name
		`;

		let guestQuery;
		let guestParams;
		let gameQuery;
		let gameParams;

		if (allGuests) {
			guestQuery = `
				SELECT ${guestSelect}
				FROM guest g
				INNER JOIN agent ag ON ag.IDNo = g.AGENT_ID AND ag.ACTIVE = 1
				INNER JOIN agency ay ON ay.IDNo = ag.AGENCY AND ay.ACTIVE = 1
				WHERE g.ACTIVE = 1
				ORDER BY g.IDNo DESC
			`;
			guestParams = [];
			gameQuery = GUEST_DATA_GAME_QUERY.replace('{{SCOPE_FILTER}}', '1=1');
			gameParams = [];
		} else if (agencyId) {
			guestQuery = `
				SELECT ${guestSelect}
				FROM guest g
				INNER JOIN agent ag ON ag.IDNo = g.AGENT_ID AND ag.ACTIVE = 1
				INNER JOIN agency ay ON ay.IDNo = ag.AGENCY AND ay.ACTIVE = 1
				WHERE ag.AGENCY = ? AND g.ACTIVE = 1
				ORDER BY g.IDNo DESC
			`;
			guestParams = [agencyId];
			gameQuery = GUEST_DATA_GAME_QUERY.replace('{{SCOPE_FILTER}}', 'ag.AGENCY = ?');
			gameParams = [agencyId];
		} else {
			guestQuery = `
				SELECT ${guestSelect}
				FROM guest g
				INNER JOIN agent ag ON ag.IDNo = g.AGENT_ID AND ag.ACTIVE = 1
				INNER JOIN agency ay ON ay.IDNo = ag.AGENCY AND ay.ACTIVE = 1
				WHERE g.AGENT_ID = ? AND g.ACTIVE = 1
				ORDER BY g.IDNo DESC
			`;
			guestParams = [agentId];
			gameQuery = GUEST_DATA_GAME_QUERY.replace('{{SCOPE_FILTER}}', 'ag.IDNo = ?');
			gameParams = [agentId];
		}

		const [guestRows] = await pool.execute(guestQuery, guestParams);

		if (!Array.isArray(guestRows) || guestRows.length === 0) {
			return res.json([]);
		}

		const [gameRows] = await pool.execute(gameQuery, gameParams);
		const guestIds = guestRows.map((row) => row.guest_id).filter(Boolean);
		const balanceCreditMap = await fetchGuestBalanceCreditMap(guestIds);

		return res.json(aggregateGuestDataRows(guestRows, gameRows, balanceCreditMap));
	} catch (err) {
		console.error('Error fetching guest_data:', err);
		return res.status(500).json({ error: 'Failed to load guest data.' });
	}
});

// ADD GUEST
router.post('/add_guest', async (req, res) => {
	const membershipNo = String(req.body.txtMembershipNo || '').trim();
	try {
		const agentId = parseInt(req.body.txtAgentId, 10);
		const guestName = String(req.body.txtGuestName || '').trim();
		const remarks = String(req.body.txtRemarks || '').trim();
		const encodedBy = req.session?.user_id || 1;
		const now = new Date();

		if (!agentId) {
			return res.status(400).json({ error: 'Agent is required.' });
		}
		if (!/^\d{8,10}$/.test(membershipNo)) {
			return res.status(400).json({ error: 'Membership No must be 8 to 10 digits only.' });
		}
		if (!guestName) {
			return res.status(400).json({ error: 'Guest name is required.' });
		}

		const [duplicateRows] = await pool.execute(
			`SELECT IDNo, NAME FROM guest WHERE MEMBERSHIP_NO = ? LIMIT 1`,
			[membershipNo]
		);
		if (duplicateRows.length) {
			const existingName = String(duplicateRows[0].NAME || '').trim() || 'another guest';
			return res.status(400).json({
				error: `Membership No ${membershipNo} is already used by "${existingName}".`
			});
		}

		const insertQuery = `
			INSERT INTO guest (AGENT_ID, NAME, MEMBERSHIP_NO, REMARKS, ACTIVE, ENCODED_BY, ENCODED_DT)
			VALUES (?, ?, ?, ?, 1, ?, ?)
		`;
		const [result] = await pool.execute(insertQuery, [agentId, guestName, membershipNo, remarks || null, encodedBy, now]);
		return res.json({ success: true, guest_id: result.insertId });
	} catch (err) {
		if (err && err.code === 'ER_DUP_ENTRY') {
			const sqlMsg = String(err.sqlMessage || '');
			if (sqlMsg.includes('idx_guest_membership_no') || sqlMsg.includes('MEMBERSHIP_NO')) {
				return res.status(400).json({
					error: `Membership No ${membershipNo} is already used.`
				});
			}
		}
		console.error('Error adding guest:', err);
		return res.status(500).json({ error: 'Failed to add guest.' });
	}
});

// PATCH GUEST REMARKS ONLY
router.patch('/guest/:id/remarks', async (req, res) => {
	try {
		if (req.session?.permissions === 2) {
			return res.status(403).json({ success: false, message: 'Not authorized to edit remarks.' });
		}
		const guestId = parseInt(req.params.id, 10);
		if (!guestId) {
			return res.status(400).json({ success: false, message: 'Guest is required.' });
		}
		const { updateRemarks } = require('../utils/remarksUpdate');
		const remarks = await updateRemarks('guest', guestId, req.body && req.body.remarks, req.session?.user_id);
		return res.json({ success: true, remarks });
	} catch (err) {
		const status = err.status || 500;
		if (status >= 500) console.error('Error updating guest remarks:', err);
		return res.status(status).json({ success: false, message: err.message || 'Failed to update remarks.' });
	}
});

// EDIT GUEST
router.put('/guest/:id', async (req, res) => {
	try {
		const guestId = parseInt(req.params.id, 10);
		const guestName = String(req.body.txtGuestName || '').trim();
		const remarks = String(req.body.txtRemarks || '').trim();
		const editedBy = req.session?.user_id || 1;
		const now = new Date();

		if (!guestId) {
			return res.status(400).json({ error: 'Guest is required.' });
		}
		if (!guestName) {
			return res.status(400).json({ error: 'Guest name is required.' });
		}

		const updateQuery = `
			UPDATE guest
			SET NAME = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?
			WHERE IDNo = ? AND ACTIVE = 1
		`;
		const [result] = await pool.execute(updateQuery, [guestName, remarks || null, editedBy, now, guestId]);

		if (!result.affectedRows) {
			return res.status(404).json({ error: 'Guest not found.' });
		}
		return res.json({ success: true });
	} catch (err) {
		console.error('Error updating guest:', err);
		return res.status(500).json({ error: 'Failed to update guest.' });
	}
});

// TRANSFER GUEST TO ANOTHER LINE (agency via agent)
router.put('/guest/:id/transfer', async (req, res) => {
	try {
		if (req.session?.permissions === 2) {
			return res.status(403).json({ error: 'Not authorized to transfer guests.' });
		}

		const guestId = parseInt(req.params.id, 10);
		const targetAgentId = parseInt(req.body.targetAgentId, 10);
		const editedBy = req.session?.user_id || 1;
		const now = new Date();

		if (!guestId) {
			return res.status(400).json({ error: 'Guest is required.' });
		}
		if (!targetAgentId) {
			return res.status(400).json({ error: 'Target LINE is required.' });
		}

		const [guestRows] = await pool.execute(
			`SELECT
				g.IDNo AS guest_id,
				g.AGENT_ID AS agent_id,
				g.NAME AS guest_name,
				g.MEMBERSHIP_NO AS membership_no,
				ag.AGENCY AS agency_id,
				src_agency.AGENCY AS agency_name,
				ag.AGENT_CODE AS agent_code,
				ag.NAME AS agent_name
			FROM guest g
			INNER JOIN agent ag ON ag.IDNo = g.AGENT_ID AND ag.ACTIVE = 1
			INNER JOIN agency src_agency ON src_agency.IDNo = ag.AGENCY AND src_agency.ACTIVE = 1
			WHERE g.IDNo = ? AND g.ACTIVE = 1
			LIMIT 1`,
			[guestId]
		);

		if (!guestRows.length) {
			return res.status(404).json({ error: 'Guest not found.' });
		}

		const guest = guestRows[0];
		if (Number(guest.agent_id) === targetAgentId) {
			return res.status(400).json({ error: 'Guest is already under this LINE.' });
		}

		const [targetRows] = await pool.execute(
			`SELECT
				ag.IDNo AS agent_id,
				ag.AGENCY AS agency_id,
				ag.AGENT_CODE AS agent_code,
				ag.NAME AS agent_name,
				ay.AGENCY AS agency_name
			FROM agent ag
			INNER JOIN agency ay ON ay.IDNo = ag.AGENCY AND ay.ACTIVE = 1
			WHERE ag.IDNo = ? AND ag.ACTIVE = 1
			LIMIT 1`,
			[targetAgentId]
		);

		if (!targetRows.length) {
			return res.status(404).json({ error: 'Target LINE not found.' });
		}

		const target = targetRows[0];
		const [updateResult] = await pool.execute(
			`UPDATE guest
			 SET AGENT_ID = ?, EDITED_BY = ?, EDITED_DT = ?
			 WHERE IDNo = ? AND ACTIVE = 1`,
			[targetAgentId, editedBy, now, guestId]
		);

		if (!updateResult.affectedRows) {
			return res.status(404).json({ error: 'Guest not found.' });
		}

		return res.json({
			success: true,
			guest_id: guestId,
			from: {
				agency_id: guest.agency_id,
				agency_name: guest.agency_name,
				agent_id: guest.agent_id,
				agent_code: guest.agent_code,
				agent_name: guest.agent_name
			},
			to: {
				agency_id: target.agency_id,
				agency_name: target.agency_name,
				agent_id: target.agent_id,
				agent_code: target.agent_code,
				agent_name: target.agent_name
			}
		});
	} catch (err) {
		console.error('Error transferring guest:', err);
		return res.status(500).json({ error: 'Failed to transfer guest.' });
	}
});


// EDIT AGENT (session or Passport Scanner x-api-key; optional face + passport images + agent_passport)
router.put(
	'/agent/:id',
	uploadPassportImg.fields([
		{ name: 'photo', maxCount: 1 },
		{ name: 'passportImage', maxCount: 1 },
	]),
	convertPassportUploadsToWebp,
	async (req, res) => {
		const apiKey = req.headers['x-api-key'];
		const validApiKey = process.env.SCANNER_API_KEY;
		const hasValidApiKey = validApiKey && apiKey === validApiKey;

		if (!req.session?.user_id && !hasValidApiKey) {
			return res.status(401).json({ error: 'Unauthorized' });
		}

		const editorId = req.session?.user_id ?? 1;

		try {
			const id = parseInt(req.params.id, 10);
			if (!id) {
				return res.status(400).json({ error: 'Invalid agent id' });
			}

			const {
				txtAgenctCode,
				txtName,
				txtRemarks,
				txtTelegram,
				txtContact,
				txtDocumentType,
				txtCountryCode,
				txtPassportNo,
				txtNationality,
				txtDateOfBirth,
				txtExpiryDate,
				txtGender,
				txtMrzLine,
			} = req.body;

			const date_now = new Date();
			const faceFile = req.files?.photo?.[0];
			const passportFile = req.files?.passportImage?.[0];
			const facePath = faceFile ? faceFile.filename : null;

			let query = `
			UPDATE agent SET AGENT_CODE = ?, NAME = ?, CONTACTNo = ?, TELEGRAM_ID = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?`;
			const params = [
				txtAgenctCode,
				txtName,
				txtContact,
				txtTelegram,
				txtRemarks,
				editorId,
				date_now,
			];

			if (facePath) {
				query += `, PHOTO = ?`;
				params.push(facePath);
			}

			query += ` WHERE IDNo = ?`;
			params.push(id);

			await pool.execute(query, params);

			const passportImagePath = passportFile ? passportFile.filename : null;
			const hasPassportData =
				passportImagePath || (txtPassportNo && String(txtPassportNo).trim());
			if (hasPassportData) {
				const dobVal =
					txtDateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(String(txtDateOfBirth).trim())
						? String(txtDateOfBirth).trim()
						: null;
				const expiryVal =
					txtExpiryDate && /^\d{4}-\d{2}-\d{2}$/.test(String(txtExpiryDate).trim())
						? String(txtExpiryDate).trim()
						: null;
				try {
					const [existing] = await pool.execute(
						'SELECT IDNo FROM agent_passport WHERE AGENT_ID = ? ORDER BY ENCODED_DT DESC LIMIT 1',
						[id]
					);
					if (existing && existing.length > 0) {
						const rowId = existing[0].IDNo;
						await pool.execute(
							`UPDATE agent_passport SET
								DOCUMENT_TYPE = ?, COUNTRY_CODE = ?, PASSPORT_NO = ?, FULL_NAME = ?, NATIONALITY = ?,
								DATE_OF_BIRTH = ?, EXPIRY_DATE = ?, GENDER = ?, MRZ_LINE = ?,
								PASSPORT_IMAGE = IFNULL(?, PASSPORT_IMAGE),
								ENCODED_BY = ?, ENCODED_DT = ?
							WHERE IDNo = ?`,
							[
								txtDocumentType ?? null,
								txtCountryCode ?? null,
								txtPassportNo ?? null,
								txtName ?? null,
								txtNationality ?? null,
								dobVal,
								expiryVal,
								txtGender ?? null,
								txtMrzLine ?? null,
								passportImagePath,
								editorId,
								date_now,
								rowId,
							]
						);
					} else {
						await pool.execute(
							`INSERT INTO agent_passport (AGENT_ID, DOCUMENT_TYPE, COUNTRY_CODE, PASSPORT_NO, FULL_NAME, NATIONALITY, DATE_OF_BIRTH, EXPIRY_DATE, GENDER, MRZ_LINE, PASSPORT_IMAGE, ENCODED_BY, ENCODED_DT)
							 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
							[
								id,
								txtDocumentType ?? null,
								txtCountryCode ?? null,
								txtPassportNo ?? null,
								txtName ?? null,
								txtNationality ?? null,
								dobVal,
								expiryVal,
								txtGender ?? null,
								txtMrzLine ?? null,
								passportImagePath ?? null,
								editorId,
								date_now,
							]
						);
					}
				} catch (passportErr) {
					console.warn('⚠ agent_passport update skipped (table may not exist):', passportErr.message);
				}
			}

			const isApiRequest = hasValidApiKey && !req.session?.user_id;
			if (isApiRequest) {
				return res.status(200).json({ success: true });
			}
			res.send('Agent updated successfully');
		} catch (error) {
			console.error('❌ Error updating agent:', error);
			res.status(500).send('Error updating agent');
		}
	}
);


// REMOVE AGENT (Super Admin only)
router.put('/agent/remove/:id', async (req, res) => {
	try {
		const permissions = req.session?.permissions;
		if (permissions !== 0) {
			return res.status(403).json({ success: false, message: 'Only Super Admin can delete agents.' });
		}

		const id = parseInt(req.params.id);
		const date_now = new Date();

		const queryAgent = `UPDATE agent SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		const queryAccount = `UPDATE account SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE AGENT_ID = ?`;

		await pool.execute(queryAgent, [0, req.session.user_id, date_now, id]);
		await pool.execute(queryAccount, [0, req.session.user_id, date_now, id]);

		console.log('✅ Agent and account archived successfully');
		res.send('Updated successfully');
	} catch (error) {
		console.error('❌ Error removing agent:', error);
		res.status(500).send('Error removing agent');
	}
});


//GET ACCOUNT
router.get('/account_data', async (req, res) => {
	try {
		const agencyIdParam = req.query.agencyId;
		const agencyId = agencyIdParam !== undefined && agencyIdParam !== '' ? Number(agencyIdParam) : null;
		const hasAgencyFilter = agencyId !== null && !Number.isNaN(agencyId);

		const ledgerTotalsSubquery = `
			SELECT 
				al.ACCOUNT_ID,
				SUM(
					CASE
						WHEN tt.TRANSACTION IN ('DEPOSIT', 'MARKER REDEEM') THEN al.AMOUNT
						WHEN tt.TRANSACTION IN ('WITHDRAW', 'IOU RETURN DEPOSIT') THEN -al.AMOUNT
						ELSE 0
					END
				) AS total_balance
			FROM account_ledger al
			LEFT JOIN transaction_type tt ON tt.IDNo = al.TRANSACTION_ID
			WHERE al.ACTIVE = 1
			  AND al.TRANSACTION_TYPE IN (2, 3, 5)
			GROUP BY al.ACCOUNT_ID
		`;

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

		const latestGameSubquery = `
			SELECT ACCOUNT_ID, MAX(ENCODED_DT) AS LATEST_GAME_DATE
			FROM game_list
			GROUP BY ACCOUNT_ID
		`;

		let baseQuery = `
			SELECT 
				acc.IDNo AS account_id,
				acc.AGENT_ID AS AGENT_ID,
				ag.IDNo AS agent_id,
				ag.AGENT_CODE AS agent_code,
				ag.NAME AS agent_name,
				ag.CONTACTNo AS agent_contact,
				ag.TELEGRAM_ID AS agent_telegram,
				COALESCE(ag.TELEGRAM_ENABLED, 1) AS telegram_enabled,
				ag.REMARKS AS agent_remarks,
				ag.PHOTO AS PASSPORTPHOTO,
				CAST(acc.ACTIVE AS UNSIGNED) AS active,
				CAST(ag.ACTIVE AS UNSIGNED) AS agent_active,
				agency.AGENCY AS agency_name,
				agency.IDNo AS agency_id,
				COALESCE(led.total_balance, 0) AS total_balance,
				COALESCE(led.total_balance, 0) AS total_ledger_amount,
				COALESCE(cred.credit_balance, 0) AS credit_balance,
				lg.LATEST_GAME_DATE
			FROM account acc
			JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			JOIN agency ON agency.IDNo = ag.AGENCY
			LEFT JOIN (${ledgerTotalsSubquery}) AS led ON led.ACCOUNT_ID = acc.IDNo
			LEFT JOIN (${creditBalanceSubquery}) AS cred ON cred.ACCOUNT_ID = acc.IDNo
			LEFT JOIN (${latestGameSubquery}) AS lg ON lg.ACCOUNT_ID = acc.IDNo
			WHERE acc.ACTIVE = 1
			  AND ag.ACTIVE = 1
		`;

		const params = [];

		if (hasAgencyFilter) {
			baseQuery += ` AND agency.IDNo = ?`;
			params.push(agencyId);
		}

		baseQuery += ` ORDER BY ag.NAME ASC`;

		const [results] = await pool.execute(baseQuery, params);
		res.json(results);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});

// Toggle Telegram notifications for an agent (per TELEGRAM_ID on agent record)
router.put('/agent/:id/telegram-enabled', checkSession, async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ error: 'Invalid agent id' });
		}
		const enabled = req.body.enabled === true || req.body.enabled === 1 || req.body.enabled === '1';
		await pool.execute(
			'UPDATE agent SET TELEGRAM_ENABLED = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1',
			[enabled ? 1 : 0, req.session.user_id, new Date(), id]
		);
		res.json({ success: true, agent_id: id, enabled });
	} catch (err) {
		console.error('Error updating agent telegram enabled:', err);
		res.status(500).json({ error: 'Failed to update Telegram notification status' });
	}
});

// Get agency name by ID (for modal title)
router.get('/agency_data/:id', async (req, res) => {
	const agencyId = parseInt(req.params.id);

	const query = `SELECT IDNo AS agency_id, AGENCY AS agency_name FROM agency WHERE IDNo = ?`;

	try {
		const [results] = await pool.execute(query, [agencyId]);

		if (results.length === 0) {
			return res.status(404).json({ error: 'Agency not found' });
		}

		res.json(results);
	} catch (err) {
		console.error('❌ Error in /agency_data/:id:', err);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});



// EDIT ACCOUNT
router.put('/account/:id', async (req, res) => {
	const id = parseInt(req.params.id);
	const { txtGuestNo, txtMembershipNo } = req.body;
	const date_now = new Date();

	// Helper: compute current balance from ledger (excludes Credit/IOU)
	const getCurrentBalance = async (accountId) => {
		const balanceQuery = `
			SELECT transaction_type.TRANSACTION, account_ledger.AMOUNT
			FROM account_ledger
			JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
			WHERE account_ledger.TRANSACTION_TYPE IN (2, 5, 3) AND account_ledger.ACCOUNT_ID = ? AND account_ledger.ACTIVE = 1
		`;
		const [rows] = await pool.query(balanceQuery, [accountId]);

		let deposit_amount = 0;
		let withdraw_amount = 0;
		let marker_redeem_amount = 0;
		let marker_return_deposit = 0;

		rows.forEach((row) => {
			const amount = parseFloat(row.AMOUNT) || 0;
			if (row.TRANSACTION === 'DEPOSIT') deposit_amount += amount;
			if (row.TRANSACTION === 'WITHDRAW') withdraw_amount += amount;
			if (row.TRANSACTION === 'MARKER REDEEM') marker_redeem_amount += amount;
			if (row.TRANSACTION === 'IOU RETURN DEPOSIT') marker_return_deposit += amount;
		});

		return deposit_amount + marker_redeem_amount - withdraw_amount - marker_return_deposit;
	};

	const query = `UPDATE account SET GUESTNo = ?, MEMBERSHIPNo = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;

	try {
		await pool.execute(query, [txtGuestNo, txtMembershipNo, req.session.user_id, date_now, id]);
		res.send('Account updated successfully');
	} catch (err) {
		console.error('Error updating account:', err);
		res.status(500).send('Error updating account');
	}
});

// REMOVE ACCOUNT
router.put('/account/remove/:id', async (req, res) => {
	const id = parseInt(req.params.id);
	const date_now = new Date();

	const query = `UPDATE account SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;

	try {
		await pool.execute(query, [0, req.session.user_id, date_now, id]);
		res.send('Agency updated successfully');
	} catch (err) {
		console.error('Error updating agency:', err);
		res.status(500).send('Error updating agency');
	}
});

// TRANSFER ALL ACTIVE ACCOUNTS FROM ONE AGENCY TO ANOTHER
router.post('/account/transfer-agency', async (req, res) => {
	let connection;
	try {
		const fromAgencyId = Number(req.body.fromAgencyId);
		const toAgencyId = Number(req.body.toAgencyId);
		const accountIdsInput = req.body.accountIds;
		const accountIdsRaw = Array.isArray(accountIdsInput)
			? accountIdsInput
			: (accountIdsInput ? [accountIdsInput] : []);
		const accountIds = accountIdsRaw
			.map((id) => Number(id))
			.filter((id) => Number.isInteger(id) && id > 0);

		if (!fromAgencyId || !toAgencyId || Number.isNaN(fromAgencyId) || Number.isNaN(toAgencyId)) {
			return res.status(400).json({ error: 'Invalid agency selection.' });
		}
		if (fromAgencyId === toAgencyId) {
			return res.status(400).json({ error: 'Source and target agency must be different.' });
		}
		if (accountIds.length === 0) {
			return res.status(400).json({ error: 'Please select at least one account.' });
		}

		const [agencyRows] = await pool.execute(
			`SELECT IDNo, AGENCY
			 FROM agency
			 WHERE ACTIVE = 1 AND IDNo IN (?, ?)`,
			[fromAgencyId, toAgencyId]
		);

		if (agencyRows.length !== 2) {
			return res.status(404).json({ error: 'Source or target agency not found.' });
		}

		const placeholders = accountIds.map(() => '?').join(', ');
		const [[countRow]] = await pool.execute(
			`SELECT COUNT(acc.IDNo) AS account_count
			 FROM account acc
			 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
			 WHERE acc.ACTIVE = 1
			   AND ag.ACTIVE = 1
			   AND ag.AGENCY = ?
			   AND acc.IDNo IN (${placeholders})`,
			[fromAgencyId, ...accountIds]
		);
		const accountCount = Number(countRow?.account_count || 0);
		if (accountCount <= 0) {
			return res.status(400).json({ error: 'Selected accounts are not valid for this agency.' });
		}

		connection = await pool.getConnection();
		await connection.beginTransaction();

		const dateNow = new Date();
		const [updateResult] = await connection.execute(
			`UPDATE agent ag
			 SET ag.AGENCY = ?, ag.EDITED_BY = ?, ag.EDITED_DT = ?
			 WHERE ag.ACTIVE = 1
			   AND ag.AGENCY = ?
			   AND EXISTS (
				   SELECT 1
				   FROM account acc
				   WHERE acc.AGENT_ID = ag.IDNo
				     AND acc.ACTIVE = 1
				     AND acc.IDNo IN (${placeholders})
			   )`,
			[toAgencyId, req.session.user_id, dateNow, fromAgencyId, ...accountIds]
		);

		await connection.commit();

		return res.json({
			success: true,
			message: `${accountCount} account(s) transferred successfully.`,
			updatedAgents: Number(updateResult?.affectedRows || 0)
		});
	} catch (error) {
		if (connection) {
			try {
				await connection.rollback();
			} catch (rollbackError) {
				console.error('Rollback failed in transfer-agency:', rollbackError);
			}
		}
		console.error('Error transferring accounts between agencies:', error);
		return res.status(500).json({ error: 'Failed to transfer accounts.' });
	} finally {
		if (connection) connection.release();
	}
});

// ADD ACCOUNT DETAILS 
router.post('/add_account_details', async (req, res) => {
	const {
		txtAccountId,
		txtTrans,
		txtAmount,
		txtRemarks,
		sendToTelegram, // Added to handle checkbox value
		totalBalanceGuest
	} = req.body;
	let date_now = new Date();

	const amountRaw = (txtAmount || '0').split(',').join('');
	const amountNumber = parseFloat(amountRaw) || 0;
	let txtAmountNum = amountRaw;
	const balanceBefore = await getCurrentBalance(txtAccountId);

	const [[accountRow]] = await pool.query('SELECT AGENT_ID FROM account WHERE IDNo = ?', [txtAccountId]);
	const agentId = accountRow?.AGENT_ID ?? null;

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
			const balanceAfter = await getCurrentBalance(txtAccountId);

			await recordHistory({
				ledgerId: insertResult.insertId,
				accountId: parseInt(txtAccountId, 10),
				transactionId: parseInt(txtTrans, 10),
				transactionName: transaction,
				amount: amountNumber,
				balanceBefore,
				balanceAfter,
				remarks: txtRemarks || null,
				direction: mapDirection(txtTrans),
				encodedBy: req.session.user_id,
				encodedDate: date_now
			});

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
                SELECT agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
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
			let totalBalanceGuest = parseFloat(req.body.totalBalanceGuest.replace(/,/g, '')) || 0; // Ensure it's a number
			

			// Determine balance for display based on transaction type
			let totalBalance;
			let amountForTelegram;
			if (txtTrans === '1') { // Deposit
				totalBalance = totalBalanceGuest + amountNumber;
				amountForTelegram = totalBalance;
			} else if (txtTrans === '2') { // Withdraw
				totalBalance = totalBalanceGuest - amountNumber;
				amountForTelegram = totalBalance;
			} else if (txtTrans === '3') { // Credit: use total credit (not total balance)
				amountForTelegram = await getCreditBalance(txtAccountId);
				totalBalance = amountForTelegram;
			}

			// Adjust for display
			const displayWithdraw = (txtTrans === '2') ? -amountNumber : amountNumber;

			const cashConfig = {
				'1': { category: 'Account Deposit', type: 1 },
				'2': { category: 'Account Withdraw', type: 2 },
				'3': { category: 'Account Credit', type: 2 }
			}[txtTrans];

			if (cashConfig) {
				const cashTransactionQuery = `
					INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`;

				await pool.execute(cashTransactionQuery, [
					insertResult.insertId,
					agentId,
					amountNumber.toString(),
					cashConfig.category,
					cashConfig.type,
					txtRemarks || null,
					req.session.user_id,
					date_now
				]);
			}

			if (guestAccountNumResults.length > 0 && guestNameResults.length > 0) {
				const telegramId =
					telegramIdResults.length > 0 ? getAgentTelegramChatId(telegramIdResults[0]) : null;
				const guestAccountNum = guestAccountNumResults[0].AGENT_CODE;
				const guestName = guestNameResults[0].NAME;

				// Reformat the amount with commas
				const formattedAmount = amountNumber.toLocaleString('en-US');

				// Translate transaction type to Korean (DB: IOU CASH or CREDIT CASH for Credit)
				const translateTransaction = (trans) => {
					if (trans === 'DEPOSIT') return '어카운트 입금';
					if (trans === 'WITHDRAW') return '어카운트 출금';
					if (trans === 'CREDIT' || trans === 'IOU CASH' || trans === 'CREDIT CASH') return '크레딧';
					return trans;
				};

				const translatedTransaction = translateTransaction(transaction);

				// Build remarks line if remarks exist
				const remarksLine = txtRemarks ? `비고: ${txtRemarks}\n` : '';

				const balanceLabel = (txtTrans === '3') ? '총 크레딧' : '잔고';
				const text = `Demo Cage\n\n* ${translatedTransaction} *\n\n계정: ${guestAccountNum} - ${guestName}\n금액: ${parseFloat(Math.abs(displayWithdraw)).toLocaleString('en-US')}\n${balanceLabel}: ${parseFloat(amountForTelegram).toLocaleString('en-US')}\n${remarksLine}\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

				const telegramLogPreview = guestPortalTransactionLogPreview(transaction, {
					transactionDesc: transacDesc
				});
				const telegramSendOpts = {
					logPreview: telegramLogPreview,
					logMeta: {
						accountCode: guestAccountNum,
						guestName: guestName,
						amount: Math.abs(Number(displayWithdraw) || 0)
					}
				};

				let telegramError = null;

				if (sendToTelegram) {
					// Send to agent (only when TELEGRAM_ID exists)
					if (telegramId && telegramId !== null && telegramId !== '') {
						try {
							await sendTelegramMessage(text, telegramId, telegramSendOpts);
						} catch (telegramErr) {
							const errorMsg = telegramErr.message || '';
							let specificError = '';
							if (errorMsg.includes('chat not found')) {
								specificError = `Wrong or Invalid Telegram Chat ID for account: ${guestAccountNum} - ${guestName}. The user may not have started a conversation with the bot. Please ask them to send /start to the bot first.`;
							} else if (errorMsg.includes('Bad Request')) {
								specificError = `Wrong Telegram Chat ID format for account: ${guestAccountNum} - ${guestName}. The Chat ID may be incorrect or invalid.`;
							} else if (errorMsg.includes('Forbidden')) {
								specificError = `Telegram message blocked for account: ${guestAccountNum} - ${guestName}. The user may have blocked the bot.`;
							} else if (errorMsg.includes('Unauthorized')) {
								specificError = `Telegram bot authorization failed for account: ${guestAccountNum} - ${guestName}. Please check bot configuration.`;
							} else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
								specificError = `Telegram connection timeout for account: ${guestAccountNum} - ${guestName}. Please try again later.`;
							} else if (errorMsg.includes('network') || errorMsg.includes('ECONN')) {
								specificError = `Telegram network error for account: ${guestAccountNum} - ${guestName}. Please check internet connection.`;
							} else {
								specificError = `Failed to send Telegram message to account: ${guestAccountNum} - ${guestName}. Error: ${errorMsg}`;
							}
							telegramError = specificError;
							console.error('Error sending Telegram message (transaction still saved):', telegramErr.message);
						}
					} else {
						console.warn('Telegram ID is missing or invalid for account:', guestAccountNum, '-', guestName);
					}

					// Send to additional chats - always (even when guest has no TELEGRAM_ID)
					try {
						await sendTelegramToAdditionalChats(text, telegramSendOpts);
					} catch (telegramErr) {
						telegramError = telegramError || `Failed to send to additional chats: ${telegramErr.message}`;
						console.error('Error sending to additional chats:', telegramErr.message);
					}
				}

				// Return error if Telegram failed, otherwise success
				if (telegramError) {
					return res.status(200).json({
						success: true,
						message: 'Transaction completed successfully, but Telegram notification failed.',
						error: telegramError
					});
				}

				res.send('Form submitted and message sent successfully!');
			} else {
				res.status(404).send('Account or guest info not found.');
			}
		} else {
			res.status(404).send('Transaction not found.');
		}
	} catch (error) {
		console.error('Error executing query or sending message:', error);
		res.status(500).send('Error processing request.');
	}
});

//ACCOUNT BUTTON CHECK BALANCE
router.post('/check_balance/:accountId', async (req, res) => {
	const { accountId } = req.params;

	try {
		// Get agent info for the account
		const [results] = await pool.query(`
			SELECT agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED,
			       agent.AGENT_CODE, agent.NAME
			FROM account
			JOIN agent ON agent.IDNo = account.AGENT_ID
			WHERE account.IDNo = ?
		`, [accountId]);

		if (results.length === 0) return res.json({ success: false });

		const { AGENT_CODE, NAME } = results[0];
		const TELEGRAM_ID = getAgentTelegramChatId(results[0]);

		// Calculate balance from ledger entries (excludes Credit/IOU)
		const [ledgerResults] = await pool.query(`
			SELECT transaction_type.TRANSACTION, account_ledger.AMOUNT
			FROM account_ledger
			JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
			WHERE account_ledger.TRANSACTION_TYPE IN (2, 5, 3) AND account_ledger.ACCOUNT_ID = ? AND account_ledger.ACTIVE = 1
		`, [accountId]);

		let deposit_amount = 0;
		let withdraw_amount = 0;
		let marker_redeem_amount = 0;
		let marker_return_deposit = 0;

		ledgerResults.forEach(row => {
			const amount = parseFloat(row.AMOUNT) || 0;
			if (row.TRANSACTION === 'DEPOSIT') deposit_amount += amount;
			if (row.TRANSACTION === 'WITHDRAW') withdraw_amount += amount;
			if (row.TRANSACTION === 'MARKER REDEEM') marker_redeem_amount += amount;
			if (row.TRANSACTION === 'IOU RETURN DEPOSIT') marker_return_deposit += amount;
		});

		const currentBalance = deposit_amount + marker_redeem_amount - withdraw_amount - marker_return_deposit;
		const balanceFormatted = currentBalance.toLocaleString(undefined, { maximumFractionDigits: 0 });

		let date_now = new Date().toLocaleDateString();
		let time_now = new Date().toLocaleTimeString();

		const message = `Demo Cage\n\n* 잔고 확인 *\n\n계정: ${AGENT_CODE} - ${NAME}\n잔고: ${balanceFormatted}\n\n날짜: ${date_now}\n시간: ${time_now}`;

		const telegramSendOpts = {
			logPreview: balanceCheckTelegramLogPreview(),
			logMeta: {
				accountCode: AGENT_CODE,
				guestName: NAME,
				amount: currentBalance
			}
		};

		let telegramError = null;

		// Send to agent (only when TELEGRAM_ID exists)
		if (TELEGRAM_ID && TELEGRAM_ID !== null && TELEGRAM_ID !== '') {
			try {
				await sendTelegramMessage(message, TELEGRAM_ID, telegramSendOpts);
			} catch (err) {
				const errorMsg = err.message || '';
				if (errorMsg.includes('chat not found')) {
					telegramError = `Wrong or Invalid Telegram Chat ID for account: ${AGENT_CODE} - ${NAME}. The user may not have started a conversation with the bot.`;
				} else if (errorMsg.includes('Bad Request')) {
					telegramError = `Wrong Telegram Chat ID format for account: ${AGENT_CODE} - ${NAME}.`;
				} else if (errorMsg.includes('Forbidden')) {
					telegramError = `Telegram message blocked for account: ${AGENT_CODE} - ${NAME}.`;
				} else {
					telegramError = `Failed to send to agent: ${errorMsg}`;
				}
				console.error('Check balance - send to agent failed:', err.message);
			}
		}

		// Send to additional chats - always (even when guest has no TELEGRAM_ID)
		try {
			await sendTelegramToAdditionalChats(message, telegramSendOpts);
		} catch (err) {
			telegramError = telegramError || `Failed to send to additional chats: ${err.message}`;
			console.error('Check balance - send to additional chats failed:', err.message);
		}

		if (telegramError) {
			return res.status(200).json({ success: true, message: 'Balance check sent to additional chats.', error: telegramError });
		}
		res.json({ success: true });
	} catch (err) {
		console.error('Balance check error:', err);
		res.status(500).json({ success: false });
	}
});


// ADD ACCOUNT DETAILS TRANSFER

router.post('/add_account_details/transfer', async (req, res) => {
	const {
		txtAccountId,
		txtAccount,
		txtAmount,
		txtTransferToBalance,
		txtTransferFromBalance
	} = req.body;

	const date_now = new Date();

	// Normalize numeric inputs and default to 0 to avoid NaN in Telegram messages
	const normalizeNumber = (val) => {
		if (val === null || val === undefined) return 0;
		return parseFloat(String(val).split(',').join('')) || 0;
	};

	const totalAmount = normalizeNumber(txtAmount);
	const transferFromBalance = normalizeNumber(txtTransferFromBalance);
	const transferToBalance = normalizeNumber(txtTransferToBalance);

	const query = `INSERT INTO account_ledger(ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, AMOUNT, TRANSFER, TRANSFER_AGENT, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

	let connection;

	try {
		// Use a DB transaction so withdraw + deposit are all-or-nothing
		connection = await pool.getConnection();
		await connection.beginTransaction();

		// Fetch live balances to use in Telegram messages
		const senderBalanceBefore = await getCurrentBalance(txtAccountId);
		const receiverBalanceBefore = await getCurrentBalance(txtAccount);

		// Insert transaction details for both accounts within the transaction
		const [withdrawResult] = await connection.execute(query, [txtAccountId, 2, 2, totalAmount, 1, txtAccount, req.session.user_id, date_now]);
		const [depositResult] = await connection.execute(query, [txtAccount, 1, 2, totalAmount, 1, txtAccountId, req.session.user_id, date_now]);

		const transactionNameWithdraw = await getTransactionName(2);
		const transactionNameDeposit = await getTransactionName(1);
		const senderBalanceAfter = senderBalanceBefore - totalAmount;
		const receiverBalanceAfter = receiverBalanceBefore + totalAmount;

		await recordHistory({
			ledgerId: withdrawResult.insertId,
			accountId: parseInt(txtAccountId, 10),
			transactionId: 2,
			transactionName: transactionNameWithdraw,
			amount: totalAmount,
			balanceBefore: senderBalanceBefore,
			balanceAfter: senderBalanceAfter,
			remarks: `Transfer to account ${txtAccount}`,
			transferAccountId: parseInt(txtAccount, 10),
			direction: mapDirection('TRANSFER_OUT'),
			encodedBy: req.session.user_id,
			encodedDate: date_now
		});

		await recordHistory({
			ledgerId: depositResult.insertId,
			accountId: parseInt(txtAccount, 10),
			transactionId: 1,
			transactionName: transactionNameDeposit,
			amount: totalAmount,
			balanceBefore: receiverBalanceBefore,
			balanceAfter: receiverBalanceAfter,
			remarks: `Transfer from account ${txtAccountId}`,
			transferAccountId: parseInt(txtAccountId, 10),
			direction: mapDirection('TRANSFER_IN'),
			encodedBy: req.session.user_id,
			encodedDate: date_now
		});

		// Fetch Telegram IDs, AGENT_CODE, and NAME for the account from which the transfer is made
		const telegramIdQueryFrom = `
            SELECT agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED,
                   agent.AGENT_CODE, agent.NAME
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.IDNo = ?
        `;
		const [telegramIdResultsFrom] = await connection.execute(telegramIdQueryFrom, [txtAccountId]);

		// Fetch Telegram IDs, AGENT_CODE, and NAME for the account to which the transfer is made
		const telegramIdQueryTo = `
            SELECT agent.TELEGRAM_ID, COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED,
                   agent.AGENT_CODE, agent.NAME
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.IDNo = ?
        `;
		const [telegramIdResultsTo] = await connection.execute(telegramIdQueryTo, [txtAccount]);

		// Collect Telegram errors
		const telegramErrors = [];

		// Prepare and send messages for the account from which the transfer is made
		if (telegramIdResultsFrom.length > 0) {
			const resultFrom = telegramIdResultsFrom[0];
			const { AGENT_CODE: AGENT_CODE_FROM, NAME: NAME_FROM } = resultFrom;
			const TELEGRAM_ID_FROM = getAgentTelegramChatId(resultFrom);

			const SenderCurrentBalance = senderBalanceBefore - totalAmount;
			let time_now = new Date();
			time_now.setHours(time_now.getHours());
			let updated_time = time_now.toLocaleTimeString();
			let date_nowTG = new Date().toLocaleDateString();

			const textFrom = `Demo Cage\n\n* 이체 *\n\n계정: ${AGENT_CODE_FROM} - ${NAME_FROM}\n받으신분: ${telegramIdResultsTo.length > 0 ? telegramIdResultsTo[0].AGENT_CODE : 'N/A'} - ${telegramIdResultsTo.length > 0 ? telegramIdResultsTo[0].NAME : 'N/A'}\n금액: -${totalAmount.toLocaleString('en-US')}\n잔고: ${SenderCurrentBalance.toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

			const toCode =
				telegramIdResultsTo.length > 0 ? telegramIdResultsTo[0].AGENT_CODE : 'N/A';
			const logFromOpts = {
				logPreview: `Transfer Sent → ${toCode}`,
				logMeta: {
					accountCode: AGENT_CODE_FROM,
					guestName: NAME_FROM,
					amount: Math.abs(Number(totalAmount) || 0)
				}
			};

			// Send to agent (only when TELEGRAM_ID exists)
			if (TELEGRAM_ID_FROM && TELEGRAM_ID_FROM !== null && TELEGRAM_ID_FROM !== '') {
				try {
					await sendTelegramMessage(textFrom, TELEGRAM_ID_FROM, logFromOpts);
				} catch (telegramError) {
					const errorMsg = telegramError.message || '';
					let specificError = '';
					if (errorMsg.includes('chat not found')) specificError = `Wrong or Invalid Telegram Chat ID for sender: ${AGENT_CODE_FROM} - ${NAME_FROM}.`;
					else if (errorMsg.includes('Bad Request')) specificError = `Wrong Telegram Chat ID format for sender: ${AGENT_CODE_FROM} - ${NAME_FROM}.`;
					else if (errorMsg.includes('Forbidden')) specificError = `Telegram blocked for sender: ${AGENT_CODE_FROM} - ${NAME_FROM}.`;
					else specificError = `Failed to send to sender: ${errorMsg}`;
					telegramErrors.push(specificError);
					console.error('Error sending Telegram to sender:', telegramError.message);
				}
			} else {
				console.warn('Telegram ID missing for sender account', AGENT_CODE_FROM);
			}

			// Send to additional chats - always (even when sender has no TELEGRAM_ID)
			try {
				await sendTelegramToAdditionalChats(textFrom, logFromOpts);
			} catch (telegramError) {
				telegramErrors.push(`Failed to send sender message to additional chats: ${telegramError.message}`);
				console.error('Error sending to additional chats (sender):', telegramError.message);
			}
		}

		// Prepare and send messages for the account to which the transfer is made
		if (telegramIdResultsTo.length > 0) {
			const resultTo = telegramIdResultsTo[0];
			const { AGENT_CODE: AGENT_CODE_TO, NAME: NAME_TO } = resultTo;
			const TELEGRAM_ID_TO = getAgentTelegramChatId(resultTo);

			const ReceiverCurrentBalance = receiverBalanceBefore + totalAmount;
			let time_now = new Date();
			time_now.setHours(time_now.getHours());
			let updated_time = time_now.toLocaleTimeString();
			let date_nowTG = new Date().toLocaleDateString();

			const textTo = `Demo Cage\n\n* 이체 *\n\n받으신분: ${AGENT_CODE_TO} - ${NAME_TO}\n보내신분: ${telegramIdResultsFrom.length > 0 ? telegramIdResultsFrom[0].AGENT_CODE : 'N/A'} - ${telegramIdResultsFrom.length > 0 ? telegramIdResultsFrom[0].NAME : 'N/A'}\n금액: ${totalAmount.toLocaleString('en-US')}\n잔고: ${ReceiverCurrentBalance.toLocaleString('en-US')}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

			const fromCode =
				telegramIdResultsFrom.length > 0 ? telegramIdResultsFrom[0].AGENT_CODE : 'N/A';
			const logToOpts = {
				logPreview: `Transfer Received ← ${fromCode}`,
				logMeta: {
					accountCode: AGENT_CODE_TO,
					guestName: NAME_TO,
					amount: Math.abs(Number(totalAmount) || 0)
				}
			};

			// Send to agent (only when TELEGRAM_ID exists)
			if (TELEGRAM_ID_TO && TELEGRAM_ID_TO !== null && TELEGRAM_ID_TO !== '') {
				try {
					await sendTelegramMessage(textTo, TELEGRAM_ID_TO, logToOpts);
				} catch (telegramError) {
					const errorMsg = telegramError.message || '';
					let specificError = '';
					if (errorMsg.includes('chat not found')) specificError = `Wrong or Invalid Telegram Chat ID for receiver: ${AGENT_CODE_TO} - ${NAME_TO}.`;
					else if (errorMsg.includes('Bad Request')) specificError = `Wrong Telegram Chat ID format for receiver: ${AGENT_CODE_TO} - ${NAME_TO}.`;
					else if (errorMsg.includes('Forbidden')) specificError = `Telegram blocked for receiver: ${AGENT_CODE_TO} - ${NAME_TO}.`;
					else specificError = `Failed to send to receiver: ${errorMsg}`;
					telegramErrors.push(specificError);
					console.error('Error sending Telegram to receiver:', telegramError.message);
				}
			} else {
				console.warn('Telegram ID missing for receiver account', AGENT_CODE_TO);
			}

			// Send to additional chats - always (even when receiver has no TELEGRAM_ID)
			try {
				await sendTelegramToAdditionalChats(textTo, logToOpts);
			} catch (telegramError) {
				telegramErrors.push(`Failed to send receiver message to additional chats: ${telegramError.message}`);
				console.error('Error sending to additional chats (receiver):', telegramError.message);
			}
		}

		// Commit DB changes after all operations succeed
		await connection.commit();

		// Return JSON response (frontend will handle redirect)
		if (telegramErrors.length > 0) {
			return res.status(200).json({
				success: true,
				message: 'Transfer completed successfully, but there were Telegram notification errors.',
				errors: telegramErrors,
				redirect: '/account_ledger'
			});
		}

		// Return success JSON (frontend will handle redirect)
		return res.status(200).json({
			success: true,
			message: 'Transfer completed successfully.',
			redirect: '/account_ledger'
		});
	} catch (error) {
		if (connection) {
			try {
				await connection.rollback();
			} catch (rollbackError) {
				console.error('Error during rollback in transfer route:', rollbackError);
			}
		}

		console.error('Error inserting details or sending message:', error);
		return res.status(500).json({
			success: false,
			message: 'Error processing transfer.',
			error: error.message || String(error)
		});
	} finally {
		if (connection) {
			connection.release();
		}
	}
});

// ACTIVITY LOGS ACCOUNT MODAL LEDGER

router.get('/ledger/:id', async (req, res) => {
	try {
	  const ledgerId = parseInt(req.params.id);
	  const [rows] = await pool.execute(
		'SELECT ACCOUNT_ID FROM account_ledger WHERE IDNo = ? AND ACTIVE = 1',
		[ledgerId]
	  );
	  if (rows.length) {
		return res.json({ account_id: rows[0].ACCOUNT_ID });
	  } else {
		return res.status(404).json({ error: 'Ledger not found' });
	  }
	} catch (error) {
	  console.error('Error in /ledger/:id', error);
	  res.status(500).send('Server error');
	}
  });

// Transaction history (all or by account)
router.get('/account_transaction_history', async (req, res) => {
	const { accountId } = req.query;
	try {
		let query = `
			SELECT
				h.*,
				agent.NAME AS agent_name,
				agent.AGENT_CODE AS agent_code,
				COALESCE(CONCAT(ui.FIRSTNAME, ' ', ui.LASTNAME), ui.USERNAME, '') AS processed_by
			FROM account_transaction_history h
			JOIN account ON account.IDNo = h.account_id
			JOIN agent ON agent.IDNo = account.AGENT_ID
			LEFT JOIN user_info ui ON ui.IDNo = h.encoded_by
			WHERE 1 = 1
		`;
		const params = [];
		if (accountId) {
			query += ` AND h.account_id = ?`;
			params.push(accountId);
		}
		query += ` ORDER BY h.encoded_dt DESC`;

		const [rows] = await pool.execute(query, params);
		res.json(rows);
	} catch (error) {
		console.error('Error fetching transaction history:', error);
		res.status(500).json({ error: 'Error fetching transaction history' });
	}
});
  

router.get('/account_details_data/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const query = `
			SELECT *, account_ledger.IDNo AS account_details_id, account_ledger.ENCODED_DT AS encoded_date, 
				agent.AGENT_CODE, agent.NAME
			FROM account_ledger 
			JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID 
			JOIN account ON account.IDNo = account_ledger.ACCOUNT_ID 
			JOIN agent ON agent.IDNo = account.AGENT_ID 
			WHERE account_ledger.ACTIVE = 1 AND account_ledger.ACCOUNT_ID = ? 
			ORDER BY account_ledger.IDNo DESC
		`;
		const [result] = await pool.execute(query, [id]);
		res.json(result);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});



// GET ACCOUNT DETAILS DEPOSIT
router.get('/account_details_data_deposit/:id', async (req, res) => {
	try {
	  const id = parseInt(req.params.id);
	  const { startDate, endDate } = req.query;
  
	  let query = `
		SELECT *, 
		  account_ledger.IDNo AS account_details_id, 
		  account_ledger.ENCODED_DT AS encoded_date 
		FROM account_ledger 
		JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
		WHERE account_ledger.ACTIVE = 1 
		  AND account_ledger.TRANSACTION_TYPE IN (2, 5, 3) 
		  AND account_ledger.ACCOUNT_ID = ?
	  `;
  
	  const params = [id];
  
	  if (startDate && endDate) {
		query += ` AND DATE(account_ledger.ENCODED_DT) BETWEEN ? AND ? `;
		params.push(startDate, endDate);
	  }
  
	  query += ` ORDER BY account_ledger.IDNo DESC`;
  
	  const [result] = await pool.execute(query, params);
	  res.json(result);
	} catch (error) {
	  console.error('❌ Error fetching data:', error);
	  res.status(500).send('Error fetching data');
	}
  });

// GET ACCOUNT CREDIT/IOU BALANCE (formula: TRANSACTION_ID 3,10 minus 11,12,1; TRANSACTION_TYPE 3,4)
router.get('/account_credit_balance/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const query = `
			SELECT 
				SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) -
				SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END) AS credit_balance
			FROM account_ledger
			WHERE account_ledger.ACTIVE = 1
			  AND account_ledger.TRANSACTION_TYPE IN (3, 4)
			  AND account_ledger.ACCOUNT_ID = ?
		`;
		const [[row]] = await pool.execute(query, [id]);
		const credit_balance = parseFloat(row?.credit_balance) || 0;
		res.json({ credit_balance });
	} catch (error) {
		console.error('Error fetching account credit balance:', error);
		res.status(500).json({ credit_balance: 0 });
	}
});

// GET ACCOUNT GAME HISTORY
router.get('/account_game_history/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const guestId = parseInt(req.query.guestId, 10);
		const hasGuestFilter = Number.isInteger(guestId) && guestId > 0;
		
		// First, get all games for this account
		const gameQuery = `
			SELECT 
				game_list.*,
				game_list.IDNo AS game_list_id,
				game_list.ACTIVE AS game_status,
				account.IDNo AS account_no,
				agent.AGENT_CODE AS agent_code,
				agent.NAME AS agent_name,
				COALESCE(NULLIF(TRIM(guest.NAME), ''), '-') AS guest_name,
				game_list.ENCODED_DT AS game_date_start,
				game_list.GAME_ENDED AS game_date_end,
				COALESCE((
					SELECT SUM(gs.AMOUNT + COALESCE(gs.DELIVERY_FEE, 0))
					FROM game_services gs
					WHERE gs.GAME_ID = game_list.IDNo
					  AND gs.ACTIVE = 1
					  AND gs.TRANSACTION_ID = 3
				), 0) AS ADD_CHG
			FROM game_list
			JOIN account ON game_list.ACCOUNT_ID = account.IDNo
			JOIN agent ON agent.IDNo = account.AGENT_ID
			LEFT JOIN guest ON guest.IDNo = game_list.GUEST_ID
			WHERE game_list.ACCOUNT_ID = ?
			  ${hasGuestFilter ? 'AND game_list.GUEST_ID = ?' : ''}
			  AND game_list.ACTIVE != 0
			ORDER BY game_list.ENCODED_DT DESC
		`;
		const queryParams = hasGuestFilter ? [id, guestId] : [id];
		const [games] = await pool.execute(gameQuery, queryParams);
		
		// For each game, calculate totals using the same logic as game_list.js
		const gamesWithTotals = await Promise.all(games.map(async (game) => {
			// Get game records
			const recordQuery = `
				SELECT AMOUNT, NN_CHIPS, CC_CHIPS, ROLLER_NN_CHIPS, ROLLER_CC_CHIPS, ROLLER_TRANSACTION, CAGE_TYPE 
				FROM game_record
				WHERE ACTIVE != 0 AND GAME_ID = ?
				ORDER BY IDNo ASC
			`;
			const [records] = await pool.execute(recordQuery, [game.game_list_id]);
			
			// Initialize totals (same as game_list.js)
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
			let total_roller_nn = 0;
			let total_roller_cc = 0;
			let total_roller_return_cc = 0;
			
			// Process records (same logic as game_list.js)
			records.forEach((res) => {
				if (res.CAGE_TYPE == 1 && (total_nn_init != 0 || total_cc_init != 0)) {
					total_nn = total_nn + (Number(res.NN_CHIPS) || 0);
					total_cc = total_cc + (Number(res.CC_CHIPS) || 0);
				}
				
				if ((total_nn_init == 0 && total_cc_init == 0) && res.CAGE_TYPE == 1) {
					total_nn_init = total_nn_init + (Number(res.NN_CHIPS) || 0);
					total_cc_init = total_cc_init + (Number(res.CC_CHIPS) || 0);
				}
				
				if (res.CAGE_TYPE == 2) {
					total_cash_out_nn = total_cash_out_nn + (Number(res.NN_CHIPS) || 0);
					total_cash_out_cc = total_cash_out_cc + (Number(res.CC_CHIPS) || 0);
				}
				
				if (res.CAGE_TYPE == 3) {
					total_rolling = total_rolling + (Number(res.AMOUNT) || 0);
					total_rolling_nn = total_rolling_nn + (Number(res.NN_CHIPS) || 0);
					total_rolling_cc = total_rolling_cc + (Number(res.CC_CHIPS) || 0);
				}
				
				if (res.CAGE_TYPE == 4) {
					total_rolling_real = total_rolling_real + (Number(res.AMOUNT) || 0);
					total_rolling_nn_real = total_rolling_nn_real + (Number(res.NN_CHIPS) || 0);
					total_rolling_cc_real = total_rolling_cc_real + (Number(res.CC_CHIPS) || 0);
				}
				
				if (res.CAGE_TYPE == 5) {
					const rollerTransaction = res.ROLLER_TRANSACTION || 1;
					if (rollerTransaction == 1) {
						total_roller_nn = total_roller_nn + (Number(res.ROLLER_NN_CHIPS) || 0);
						total_roller_cc = total_roller_cc + (Number(res.ROLLER_CC_CHIPS) || 0);
					} else if (rollerTransaction == 2) {
						total_roller_nn = total_roller_nn - (Number(res.ROLLER_NN_CHIPS) || 0);
						total_roller_cc = total_roller_cc - (Number(res.ROLLER_CC_CHIPS) || 0);
						total_roller_return_cc += (Number(res.ROLLER_CC_CHIPS) || 0);
					}
				}
			});
			
			// Calculate totals (same as game_list.js)
			const total_initial = total_nn_init + total_cc_init;
			const total_buy_in_chips = total_nn + total_cc;
			const total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
			const totalRollingCCWithReturns = total_roller_return_cc;
			const total_rolling_chips = total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;
			const total_rolling_real_chips = total_rolling_real + total_rolling_nn_real + total_rolling_cc_real + total_roller_return_cc;
			const total_roller_chips = total_roller_nn + total_roller_cc;
			const total_amount = total_buy_in_chips + total_initial;
			const winloss = total_amount - total_cash_out_chips;
			
			// Calculate commission (net) - same logic as game_list.js
			let net = 0;
			if (game.COMMISSION_TYPE == 1 || game.COMMISSION_TYPE == 3) {
				net = Math.round((total_rolling_chips * game.COMMISSION_PERCENTAGE) / 100);
			} else if (game.COMMISSION_TYPE == 2) {
				net = Math.round((winloss * game.COMMISSION_PERCENTAGE) / 100);
			}
			
			// Return game with calculated values
			return {
				...game,
				BUY_IN: total_amount,
				CASH_OUT: total_cash_out_chips,
				ROLLING: total_rolling_real_chips,
				TOTAL_ROLLING: total_rolling_chips,
				COMMISSION: net,
				ADD_CHG: Number(game.ADD_CHG) || 0,
				TOTAL_SETTLE: net - (Number(game.ADD_CHG) || 0),
				ROLLER_CHIPS: total_roller_chips,
				WIN_LOSS: winloss
			};
		}));
		
		res.json(gamesWithTotals);
	} catch (error) {
		console.error('Error fetching game history:', error);
		res.status(500).send('Error fetching game history');
	}
});



// GET AGENT PASSPORT DETAILS (agent_passport table) by account_id
router.get('/account_passport_details/:account_id', async (req, res) => {
	try {
		const accountId = req.params.account_id;
		const [accountRows] = await pool.execute(
			'SELECT AGENT_ID FROM account WHERE IDNo = ?',
			[accountId]
		);
		if (!accountRows || accountRows.length === 0) {
			return res.status(404).json({ error: 'Account not found' });
		}
		const agentId = accountRows[0].AGENT_ID;
		if (!agentId) {
			return res.json(null);
		}
		const [rows] = await pool.execute(
			'SELECT * FROM agent_passport WHERE AGENT_ID = ? ORDER BY ENCODED_DT DESC LIMIT 1',
			[agentId]
		);
		res.json(rows && rows.length > 0 ? rows[0] : null);
	} catch (error) {
		console.error('Error fetching passport details:', error);
		res.status(500).json({ error: 'Error fetching passport details' });
	}
});

// GET ACCOUNT DETAILS PASSPORTPHOTO

router.get('/account_passportphoto_data/:account_id', async (req, res) => {
	try {
		const accountId = req.params.account_id;
		const query = `
			SELECT 
				account.*, 
				agent.NAME AS account_name, 
				agent.AGENT_CODE AS agent_code,
				agent.PHOTO AS PASSPORTPHOTO,
				agent.REMARKS AS agent_remarks,
				agent.CONTACTNo AS agent_contact,
				agent.TELEGRAM_ID AS agent_telegram
			FROM account 
			LEFT JOIN agent ON agent.IDNo = account.AGENT_ID 
			WHERE account.IDNo = ?
		`;
		const [result] = await pool.execute(query, [accountId]);
		res.json(result);
	} catch (error) {
		console.error('Error fetching account data:', error);
		res.status(500).send('Error fetching account data');
	}
});

// UPDATE AGENT REMARKS (Guest Portal — Transaction History header)
router.put('/account/:accountId/agent_remarks', async (req, res) => {
	try {
		const accountId = parseInt(req.params.accountId, 10);
		if (Number.isNaN(accountId)) {
			return res.status(400).json({ error: 'Invalid account id' });
		}
		const remarks = req.body && req.body.remarks != null ? String(req.body.remarks) : '';
		const date_now = new Date();
		const [[row]] = await pool.query('SELECT AGENT_ID FROM account WHERE IDNo = ?', [accountId]);
		if (!row || row.AGENT_ID == null) {
			return res.status(404).json({ error: 'Account or agent not found' });
		}
		await pool.execute(
			'UPDATE agent SET REMARKS = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[remarks, req.session.user_id, date_now, row.AGENT_ID]
		);
		res.json({ success: true });
	} catch (error) {
		console.error('Error updating agent remarks:', error);
		res.status(500).json({ error: 'Error updating agent remarks' });
	}
});

// UPDATE ACCOUNT (AGENT) PHOTO from Guest Portal modal (+ optional passport re-scan)
router.post(
	'/account/:accountId/update_photo',
	uploadPassportImg.fields([
		{ name: 'photo', maxCount: 1 },
		{ name: 'passportImage', maxCount: 1 },
	]),
	convertPassportUploadsToWebp,
	async (req, res) => {
	try {
		const accountId = req.params.accountId;
		const faceFile = req.files?.photo?.[0];
		if (!faceFile) {
			return res.status(400).json({ error: 'No photo file' });
		}
		const [[row]] = await pool.query('SELECT AGENT_ID FROM account WHERE IDNo = ?', [accountId]);
		if (!row || row.AGENT_ID == null) {
			return res.status(404).json({ error: 'Account or agent not found' });
		}
		const agentId = row.AGENT_ID;
		const date_now = new Date();
		const editorId = req.session?.user_id ?? 1;

		await pool.execute(
			'UPDATE agent SET PHOTO = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[faceFile.filename, editorId, date_now, agentId]
		);

		const passportFile = req.files?.passportImage?.[0];
		const {
			txtDocumentType,
			txtCountryCode,
			txtPassportNo,
			txtNationality,
			txtDateOfBirth,
			txtExpiryDate,
			txtGender,
			txtMrzLine,
			txtFullName,
		} = req.body;
		const passportImagePath = passportFile ? passportFile.filename : null;
		const hasPassportData =
			passportImagePath || (txtPassportNo && String(txtPassportNo).trim());
		if (hasPassportData) {
			const dobVal =
				txtDateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(String(txtDateOfBirth).trim())
					? String(txtDateOfBirth).trim()
					: null;
			const expiryVal =
				txtExpiryDate && /^\d{4}-\d{2}-\d{2}$/.test(String(txtExpiryDate).trim())
					? String(txtExpiryDate).trim()
					: null;
			try {
				const [existing] = await pool.execute(
					'SELECT IDNo FROM agent_passport WHERE AGENT_ID = ? ORDER BY ENCODED_DT DESC LIMIT 1',
					[agentId]
				);
				if (existing && existing.length > 0) {
					const rowId = existing[0].IDNo;
					await pool.execute(
						`UPDATE agent_passport SET
							DOCUMENT_TYPE = ?, COUNTRY_CODE = ?, PASSPORT_NO = ?, FULL_NAME = ?, NATIONALITY = ?,
							DATE_OF_BIRTH = ?, EXPIRY_DATE = ?, GENDER = ?, MRZ_LINE = ?,
							PASSPORT_IMAGE = IFNULL(?, PASSPORT_IMAGE),
							ENCODED_BY = ?, ENCODED_DT = ?
						WHERE IDNo = ?`,
						[
							txtDocumentType ?? null,
							txtCountryCode ?? null,
							txtPassportNo ?? null,
							txtFullName ?? null,
							txtNationality ?? null,
							dobVal,
							expiryVal,
							txtGender ?? null,
							txtMrzLine ?? null,
							passportImagePath,
							editorId,
							date_now,
							rowId,
						]
					);
				} else {
					await pool.execute(
						`INSERT INTO agent_passport (AGENT_ID, DOCUMENT_TYPE, COUNTRY_CODE, PASSPORT_NO, FULL_NAME, NATIONALITY, DATE_OF_BIRTH, EXPIRY_DATE, GENDER, MRZ_LINE, PASSPORT_IMAGE, ENCODED_BY, ENCODED_DT)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							agentId,
							txtDocumentType ?? null,
							txtCountryCode ?? null,
							txtPassportNo ?? null,
							txtFullName ?? null,
							txtNationality ?? null,
							dobVal,
							expiryVal,
							txtGender ?? null,
							txtMrzLine ?? null,
							passportImagePath ?? null,
							editorId,
							date_now,
						]
					);
				}
			} catch (passportErr) {
				console.warn('⚠ agent_passport update skipped (table may not exist):', passportErr.message);
			}
		}

		res.json({ success: true, photo: faceFile.filename, passportUpdated: !!hasPassportData });
	} catch (error) {
		console.error('Error updating account photo:', error);
		res.status(500).json({ error: 'Error updating photo' });
	}
});

// DELETE ACCOUNT DETAILS
router.put('/account_details/remove/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		let date_now = new Date();

		const query = `UPDATE account_ledger SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;
		await pool.execute(query, [0, req.session.user_id, date_now, id]);

		res.send('Details updated successfully');
	} catch (err) {
		console.error('Error updating Details:', err);
		res.status(500).send('Error updating Details');
	}
});

// Get Change Agent Name
router.get('/get-transfer-agent-name', async (req, res) => {
	const transferAgentId = req.query.transferAgentId;

	const sql = `
		SELECT agent.AGENT_CODE, agent.NAME AS transfer_agent_name 
		FROM account 
		JOIN agent ON account.AGENT_ID = agent.IDNo 
		WHERE account.IDNO = ?
	`;

	try {
		const [results] = await pool.execute(sql, [transferAgentId]);

		if (results.length > 0) {
			const { transfer_agent_name, AGENT_CODE } = results[0];
			res.json({ transfer_agent_name, agent_code: AGENT_CODE });
		} else {
			res.json({ transfer_agent_name: null, agent_code: null });
		}
	} catch (error) {
		console.error('Database error:', error);
		res.status(500).send('Server error');
	}
});

//EXPORT ACCOUNT DETAILS

router.get('/export', async (req, res) => {
	const accountId = req.query.id; // Assuming `id` is passed as a query parameter

	try {
		// Perform the query to fetch data from account_ledger table
		const [rows] = await pool.execute(`
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

		// Get agent details (name and code) to include in filename
		const [agents] = await pool.execute(`
		SELECT NAME, AGENT_CODE FROM agent
		JOIN account ON account.AGENT_ID = agent.IDNo
		WHERE account.IDNo = ?`, [accountId]);

		let filename = 'Account Details - ';

		if (agents.length > 0) {
			const agent = agents[0];

			filename = 'Account Details - ' + agent.NAME + '(' + agent.AGENT_CODE + ')';
		}

		// Set headers for file download
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename=' + filename + '.xlsx');

		// Send the buffer as the response to trigger file download
		res.send(buffer);
	} catch (error) {
		console.error('Error exporting data:', error);
		res.status(500).send('Error exporting data');
	}
});

/** Excel: row 1 = merged LINE name; row 2 = each agent (CODE · NAME); below = guest names per column. */
router.post('/agency/export_agent_guest_matrix_xlsx', checkSession, async function (req, res) {
	try {
		const agencyId = parseInt(req.body.agencyId, 10);
		if (!agencyId) {
			return res.status(400).json({ error: 'Select a LINE first.' });
		}

		const [agencyNameRows] = await pool.execute(
			`SELECT AGENCY FROM agency WHERE IDNo = ? AND ACTIVE = 1`,
			[agencyId]
		);
		const lineName = String(agencyNameRows[0]?.AGENCY ?? '')
			.trim()
			|| 'LINE ' + agencyId;

		const agentQuery = `
			SELECT DISTINCT ag.IDNo AS agent_id, ag.AGENT_CODE AS agent_code, ag.NAME AS agent_name
			FROM agent ag
			INNER JOIN account acc ON acc.AGENT_ID = ag.IDNo AND acc.ACTIVE = 1
			WHERE ag.AGENCY = ? AND ag.ACTIVE = 1
			ORDER BY ag.NAME ASC, ag.AGENT_CODE ASC, ag.IDNo ASC
		`;
		const [agentRows] = await pool.execute(agentQuery, [agencyId]);

		const guestQuery = `
			SELECT g.NAME AS guest_name
			FROM guest g
			WHERE g.AGENT_ID = ? AND g.ACTIVE = 1
			ORDER BY g.IDNo DESC
		`;

		const agentOrder = [];
		const agentMap = new Map();

		for (const r of agentRows || []) {
			const id = Number(r.agent_id);
			if (agentMap.has(id)) continue;
			const code = String(r.agent_code != null ? r.agent_code : '').trim();
			const name = String(r.agent_name != null ? r.agent_name : '').trim();
			const headerLabel =
				code && name
					? code.toUpperCase() + ' · ' + name.toUpperCase()
					: String(code || name || '').toUpperCase();
			agentMap.set(id, { headerLabel, guests: [] });
			agentOrder.push(id);
		}

		for (const aid of agentOrder) {
			const [gRows] = await pool.execute(guestQuery, [aid]);
			const bucket = agentMap.get(aid);
			for (const g of gRows || []) {
				const gn = String(g.guest_name != null ? g.guest_name : '').trim();
				if (gn) bucket.guests.push(gn);
			}
		}

		const workbook = new ExcelJS.Workbook();
		const ws = workbook.addWorksheet('AGENT', {
			views: [{ state: 'frozen', ySplit: 2 }]
		});
		const thinBorder = {
			top: { style: 'thin', color: { argb: 'FF666666' } },
			left: { style: 'thin', color: { argb: 'FF666666' } },
			bottom: { style: 'thin', color: { argb: 'FF666666' } },
			right: { style: 'thin', color: { argb: 'FF666666' } }
		};
		const lineTitleFill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFC6EFCE' }
		};

		function addLineTitleRow(ncol) {
			const n = Math.max(1, ncol);
			const lineRow = ws.addRow(Array(n).fill(''));
			lineRow.height = 24;
			lineRow.getCell(1).value = lineName;
			lineRow.getCell(1).font = { bold: true };
			lineRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			for (let c = 1; c <= n; c++) {
				const cell = lineRow.getCell(c);
				cell.fill = lineTitleFill;
				cell.border = thinBorder;
			}
			if (n > 1) {
				ws.mergeCells(1, 1, 1, n);
			}
		}

		if (agentOrder.length === 0) {
			addLineTitleRow(1);
			const msgRow = ws.addRow(['No agents for this LINE.']);
			msgRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			msgRow.getCell(1).border = thinBorder;
			ws.getColumn(1).width = Math.min(44, Math.max(12, String(lineName).length + 2, 28));
		} else {
			const headers = agentOrder.map((id) => agentMap.get(id).headerLabel);
			const ncol = headers.length;
			addLineTitleRow(ncol);

			const maxRows = Math.max(0, ...agentOrder.map((id) => agentMap.get(id).guests.length));

			const headerRow = ws.addRow(headers);
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

			for (let i = 0; i < maxRows; i++) {
				const rowVals = agentOrder.map((id) => agentMap.get(id).guests[i] || '');
				const dataRow = ws.addRow(rowVals);
				dataRow.eachCell((cell) => {
					cell.border = thinBorder;
					cell.alignment = { vertical: 'top', horizontal: 'center', wrapText: true };
				});
			}

			for (let c = 1; c <= ncol; c++) {
				let maxLen = Math.max(
					String(lineName).length,
					String(headers[c - 1] || '').length
				);
				const guests = agentMap.get(agentOrder[c - 1]).guests;
				for (let i = 0; i < guests.length; i++) {
					const L = String(guests[i] || '').length;
					if (L > maxLen) maxLen = L;
				}
				ws.getColumn(c).width = Math.min(44, Math.max(12, maxLen + 2));
			}
		}

		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const outName = `Agent-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;

		const buffer = await workbook.xlsx.writeBuffer();
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('agency/export_agent_guest_matrix_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

/** Excel: row 1 = each LINE (agency) name; below = agents under that line (CODE · NAME), one agent per row per column. */
router.post('/agency/export_line_agent_matrix_xlsx', checkSession, async function (req, res) {
	try {
		const query = `
			SELECT a.IDNo AS agency_id, a.AGENCY AS line_name,
				ag.IDNo AS agent_id, ag.AGENT_CODE AS agent_code, ag.NAME AS agent_name
			FROM agency a
			LEFT JOIN agent ag ON ag.AGENCY = a.IDNo AND ag.ACTIVE = 1
			WHERE a.ACTIVE = 1
			ORDER BY a.AGENCY ASC, ag.AGENT_CODE ASC, ag.IDNo ASC
		`;
		const [rows] = await pool.execute(query);

		const lineOrder = [];
		const lineMap = new Map();

		for (const r of rows || []) {
			const id = Number(r.agency_id);
			if (!lineMap.has(id)) {
				lineMap.set(id, {
					name: String(r.line_name != null ? r.line_name : '').trim(),
					agents: [],
					seen: new Set()
				});
				lineOrder.push(id);
			}
			if (r.agent_id != null) {
				const b = lineMap.get(id);
				const aid = Number(r.agent_id);
				if (b.seen.has(aid)) continue;
				b.seen.add(aid);
				const code = String(r.agent_code != null ? r.agent_code : '').trim();
				const name = String(r.agent_name != null ? r.agent_name : '').trim();
				const label =
					code && name
						? code.toUpperCase() + ' · ' + name.toUpperCase()
						: String(code || name || '').toUpperCase();
				b.agents.push(label);
			}
		}

		const workbook = new ExcelJS.Workbook();
		const ws = workbook.addWorksheet('LINE', {
			views: [{ state: 'frozen', ySplit: 1 }]
		});
		const thinBorder = {
			top: { style: 'thin', color: { argb: 'FF666666' } },
			left: { style: 'thin', color: { argb: 'FF666666' } },
			bottom: { style: 'thin', color: { argb: 'FF666666' } },
			right: { style: 'thin', color: { argb: 'FF666666' } }
		};

		if (lineOrder.length === 0) {
			const hr = ws.addRow(['No active LINE records.']);
			hr.getCell(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			hr.getCell(1).border = thinBorder;
		} else {
			const headers = lineOrder.map((lid) => lineMap.get(lid).name || 'LINE ' + lid);
			const maxRows = Math.max(0, ...lineOrder.map((lid) => lineMap.get(lid).agents.length));

			const headerRow = ws.addRow(headers);
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

			for (let i = 0; i < maxRows; i++) {
				const rowVals = lineOrder.map((lid) => lineMap.get(lid).agents[i] || '');
				const dataRow = ws.addRow(rowVals);
				dataRow.eachCell((cell) => {
					cell.border = thinBorder;
					cell.alignment = { vertical: 'top', horizontal: 'center', wrapText: true };
				});
			}

			const ncol = headers.length;
			for (let c = 1; c <= ncol; c++) {
				let maxLen = String(headers[c - 1] || '').length;
				const lid = lineOrder[c - 1];
				const agents = lineMap.get(lid).agents;
				for (let i = 0; i < agents.length; i++) {
					const L = String(agents[i] || '').length;
					if (L > maxLen) maxLen = L;
				}
				ws.getColumn(c).width = Math.min(44, Math.max(12, maxLen + 2));
			}
		}

		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const outName = `Line-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;

		const buffer = await workbook.xlsx.writeBuffer();
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('agency/export_line_agent_matrix_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

/** Excel: LINE totals, then each AGENT with totals, then each GUEST under that agent. */
router.post('/agency/export_line_stats_xlsx', checkSession, async function (req, res) {
	try {
		const agencyId = parseInt(req.body.agencyId, 10);
		if (!agencyId) {
			return res.status(400).json({ error: 'Select a LINE first.' });
		}

		const [agencyNameRows] = await pool.execute(
			`SELECT AGENCY FROM agency WHERE IDNo = ? AND ACTIVE = 1`,
			[agencyId]
		);
		const lineName = String(agencyNameRows[0]?.AGENCY ?? '')
			.trim()
			|| 'LINE ' + agencyId;

		const [agentRows] = await pool.execute(
			`SELECT ag.IDNo AS agent_id, ag.AGENT_CODE AS agent_code, ag.NAME AS agent_name
			 FROM agent ag
			 WHERE ag.AGENCY = ? AND ag.ACTIVE = 1
			 ORDER BY ag.NAME ASC, ag.AGENT_CODE ASC, ag.IDNo ASC`,
			[agencyId]
		);

		const lineStats = await fetchAgencyLineFinancialStats(agencyId);
		const guestStats = await fetchAgencyGuestStatsForExport(agencyId);
		const guestsByAgent = new Map();
		for (const guest of guestStats) {
			const agentId = Number(guest.agent_id);
			if (!guestsByAgent.has(agentId)) guestsByAgent.set(agentId, []);
			guestsByAgent.get(agentId).push(guest);
		}

		const workbook = new ExcelJS.Workbook();
		const ws = workbook.addWorksheet('LINE Stats', {
			views: [{ state: 'frozen', ySplit: 1 }]
		});
		const thinBorder = {
			top: { style: 'thin', color: { argb: 'FF666666' } },
			left: { style: 'thin', color: { argb: 'FF666666' } },
			bottom: { style: 'thin', color: { argb: 'FF666666' } },
			right: { style: 'thin', color: { argb: 'FF666666' } }
		};
		const headerFill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFD9E1F2' }
		};
		const lineFill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFC6EFCE' }
		};
		const agentFill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFE2EFDA' }
		};

		const headers = [
			'Level',
			'Name',
			'Total Balance',
			'Total Credit',
			'Total Winloss',
			'Total Rolling',
			'Total Commission'
		];
		const headerRow = ws.addRow(headers);
		headerRow.height = 22;
		headerRow.eachCell((cell) => {
			cell.font = { bold: true };
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			cell.border = thinBorder;
			cell.fill = headerFill;
		});

		function addStatsRow(level, name, stats, fill) {
			const row = ws.addRow([
				level,
				name,
				Number(stats.total_balance) || 0,
				Number(stats.total_credit) || 0,
				Number(stats.total_winloss) || 0,
				Number(stats.total_rolling) || 0,
				Number(stats.total_commission) || 0
			]);
			row.eachCell((cell, colNumber) => {
				cell.border = thinBorder;
				cell.alignment = {
					vertical: 'middle',
					horizontal: colNumber <= 2 ? 'left' : 'right',
					wrapText: true
				};
				if (fill) cell.fill = fill;
				if (colNumber === 1) cell.font = { bold: true };
			});
			if (level === 'LINE') row.font = { bold: true };
		}

		addStatsRow('LINE', lineName.toUpperCase(), lineStats, lineFill);

		for (const agent of agentRows || []) {
			const agentId = Number(agent.agent_id);
			const code = String(agent.agent_code != null ? agent.agent_code : '').trim();
			const name = String(agent.agent_name != null ? agent.agent_name : '').trim();
			const agentLabel =
				code && name
					? code.toUpperCase() + ' · ' + name.toUpperCase()
					: String(code || name || ('AGENT ' + agentId)).toUpperCase();

			const agentGuests = guestsByAgent.get(agentId) || [];
			const agentStats = await fetchAgentFinancialStats(agentId);

			addStatsRow('AGENT', agentLabel, agentStats, agentFill);

			for (const guest of agentGuests) {
				const guestName = String(guest.guest_name || '').trim().toUpperCase() || ('GUEST ' + guest.guest_id);
				addStatsRow('GUEST', guestName, guest, null);
			}
		}

		ws.getColumn(1).width = 10;
		ws.getColumn(2).width = 36;
		for (let c = 3; c <= 7; c++) {
			ws.getColumn(c).width = 16;
		}

		applyCommaThousandsToNumericCells(ws, { headerRows: 1 });

		const safeLine = lineName.replace(/[<>:"/\\|?*]+/g, '').trim() || 'LINE';
		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const outName = `${safeLine}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;

		const buffer = await workbook.xlsx.writeBuffer();
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="' + outName.replace(/"/g, '') + '"');
		return res.send(Buffer.from(buffer));
	} catch (err) {
		console.error('agency/export_line_stats_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});


// Export the router
module.exports = router; 