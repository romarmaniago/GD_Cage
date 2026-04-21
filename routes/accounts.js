const express = require('express');
const router = express.Router();
const pool = require('../config/db');

const { checkSession, sessions } = require('./auth');
const { sendTelegramMessage, sendTelegramToAdditionalChats } = require('../utils/telegram');

const multer = require('multer');
const ExcelJS = require('exceljs');
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

// ARCHIVE AGENCY
router.put('/agency/remove/:id', async (req, res) => {
	try {
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


// GET AGENT
router.get('/agent_data', async (req, res) => {
	try {
		const query = `
			SELECT *, agency.AGENCY AS agency_name, agency.IDNo AS agency_id,
			agent.AGENT_CODE AS agent_code, agent.IDNo AS agent_id, agent.ACTIVE AS active
			FROM agent
			JOIN agency ON agent.AGENCY = agency.IDNo
			WHERE agent.ACTIVE = 1`;
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


// EDIT AGENT
router.put('/agent/:id', uploadPassportImg.single('photo'), convertPassportUploadsToWebp, async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const { txtAgenctCode, txtName, txtRemarks, txtTelegram, txtContact } = req.body;
		const date_now = new Date();
		const photoPath = req.file ? req.file.filename : null;

		let query = `
			UPDATE agent SET AGENT_CODE = ?, NAME = ?, CONTACTNo = ?, TELEGRAM_ID = ?, REMARKS = ?, EDITED_BY = ?, EDITED_DT = ?`;
		const params = [txtAgenctCode, txtName, txtContact, txtTelegram, txtRemarks, req.session.user_id, date_now];

		if (photoPath) {
			query += `, PHOTO = ?`;
			params.push(photoPath);
		}

		query += ` WHERE IDNo = ?`;
		params.push(id);

		await pool.execute(query, params);
		res.send('Agent updated successfully');
	} catch (error) {
		console.error('❌ Error updating agent:', error);
		res.status(500).send('Error updating agent');
	}
});


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
				const telegramId = telegramIdResults.length > 0 ? telegramIdResults[0].TELEGRAM_ID : null;
				const guestAccountNum = guestAccountNumResults[0].AGENT_CODE;
				const guestName = guestNameResults[0].NAME;

				// Reformat the amount with commas
				const formattedAmount = amountNumber.toLocaleString();

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
				const text = `Demo Cage\n\n* ${translatedTransaction} *\n\n계정: ${guestAccountNum} - ${guestName}\n금액: ${parseFloat(Math.abs(displayWithdraw)).toLocaleString()}\n${balanceLabel}: ${parseFloat(amountForTelegram).toLocaleString()}\n${remarksLine}\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

				let telegramError = null;

				if (sendToTelegram) {
					// Send to agent (only when TELEGRAM_ID exists)
					if (telegramId && telegramId !== null && telegramId !== '') {
						try {
							await sendTelegramMessage(text, telegramId);
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
						await sendTelegramToAdditionalChats(text);
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
			SELECT agent.TELEGRAM_ID, agent.AGENT_CODE, agent.NAME
			FROM account
			JOIN agent ON agent.IDNo = account.AGENT_ID
			WHERE account.IDNo = ?
		`, [accountId]);

		if (results.length === 0) return res.json({ success: false });

		const { TELEGRAM_ID, AGENT_CODE, NAME } = results[0];

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

		let telegramError = null;

		// Send to agent (only when TELEGRAM_ID exists)
		if (TELEGRAM_ID && TELEGRAM_ID !== null && TELEGRAM_ID !== '') {
			try {
				await sendTelegramMessage(message, TELEGRAM_ID);
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
			await sendTelegramToAdditionalChats(message);
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
            SELECT agent.TELEGRAM_ID, agent.AGENT_CODE, agent.NAME
            FROM agent
            JOIN account ON account.AGENT_ID = agent.IDNo
            WHERE account.IDNo = ?
        `;
		const [telegramIdResultsFrom] = await connection.execute(telegramIdQueryFrom, [txtAccountId]);

		// Fetch Telegram IDs, AGENT_CODE, and NAME for the account to which the transfer is made
		const telegramIdQueryTo = `
            SELECT agent.TELEGRAM_ID, agent.AGENT_CODE, agent.NAME
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
			const { TELEGRAM_ID: TELEGRAM_ID_FROM, AGENT_CODE: AGENT_CODE_FROM, NAME: NAME_FROM } = resultFrom;

			const SenderCurrentBalance = senderBalanceBefore - totalAmount;
			let time_now = new Date();
			time_now.setHours(time_now.getHours());
			let updated_time = time_now.toLocaleTimeString();
			let date_nowTG = new Date().toLocaleDateString();

			const textFrom = `Demo Cage\n\n* 이체 *\n\n계정: ${AGENT_CODE_FROM} - ${NAME_FROM}\n받으신분: ${telegramIdResultsTo.length > 0 ? telegramIdResultsTo[0].AGENT_CODE : 'N/A'} - ${telegramIdResultsTo.length > 0 ? telegramIdResultsTo[0].NAME : 'N/A'}\n금액: -${totalAmount.toLocaleString()}\n잔고: ${SenderCurrentBalance.toLocaleString()}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

			// Send to agent (only when TELEGRAM_ID exists)
			if (TELEGRAM_ID_FROM && TELEGRAM_ID_FROM !== null && TELEGRAM_ID_FROM !== '') {
				try {
					await sendTelegramMessage(textFrom, TELEGRAM_ID_FROM);
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
				await sendTelegramToAdditionalChats(textFrom);
			} catch (telegramError) {
				telegramErrors.push(`Failed to send sender message to additional chats: ${telegramError.message}`);
				console.error('Error sending to additional chats (sender):', telegramError.message);
			}
		}

		// Prepare and send messages for the account to which the transfer is made
		if (telegramIdResultsTo.length > 0) {
			const resultTo = telegramIdResultsTo[0];
			const { TELEGRAM_ID: TELEGRAM_ID_TO, AGENT_CODE: AGENT_CODE_TO, NAME: NAME_TO } = resultTo;

			const ReceiverCurrentBalance = receiverBalanceBefore + totalAmount;
			let time_now = new Date();
			time_now.setHours(time_now.getHours());
			let updated_time = time_now.toLocaleTimeString();
			let date_nowTG = new Date().toLocaleDateString();

			const textTo = `Demo Cage\n\n* 이체 *\n\n받으신분: ${AGENT_CODE_TO} - ${NAME_TO}\n보내신분: ${telegramIdResultsFrom.length > 0 ? telegramIdResultsFrom[0].AGENT_CODE : 'N/A'} - ${telegramIdResultsFrom.length > 0 ? telegramIdResultsFrom[0].NAME : 'N/A'}\n금액: ${totalAmount.toLocaleString()}\n잔고: ${ReceiverCurrentBalance.toLocaleString()}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

			// Send to agent (only when TELEGRAM_ID exists)
			if (TELEGRAM_ID_TO && TELEGRAM_ID_TO !== null && TELEGRAM_ID_TO !== '') {
				try {
					await sendTelegramMessage(textTo, TELEGRAM_ID_TO);
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
				await sendTelegramToAdditionalChats(textTo);
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
		
		// First, get all games for this account
		const gameQuery = `
			SELECT 
				game_list.*,
				game_list.IDNo AS game_list_id,
				game_list.ACTIVE AS game_status,
				account.IDNo AS account_no,
				agent.AGENT_CODE AS agent_code,
				agent.NAME AS agent_name,
				game_list.ENCODED_DT AS game_date_start,
				game_list.GAME_ENDED AS game_date_end
			FROM game_list
			JOIN account ON game_list.ACCOUNT_ID = account.IDNo
			JOIN agent ON agent.IDNo = account.AGENT_ID
			WHERE game_list.ACCOUNT_ID = ?
			  AND game_list.ACTIVE != 0
			ORDER BY game_list.ENCODED_DT DESC
		`;
		const [games] = await pool.execute(gameQuery, [id]);
		
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
				agent.REMARKS AS agent_remarks
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

// UPDATE ACCOUNT (AGENT) PHOTO from Guest Portal modal
router.post('/account/:accountId/update_photo', uploadPassportImg.single('photo'), convertPassportUploadsToWebp, async (req, res) => {
	try {
		const accountId = req.params.accountId;
		const file = req.file;
		if (!file) {
			return res.status(400).json({ error: 'No photo file' });
		}
		const [[row]] = await pool.query('SELECT AGENT_ID FROM account WHERE IDNo = ?', [accountId]);
		if (!row || row.AGENT_ID == null) {
			return res.status(404).json({ error: 'Account or agent not found' });
		}
		const date_now = new Date();
		await pool.execute(
			'UPDATE agent SET PHOTO = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
			[file.filename, req.session.user_id, date_now, row.AGENT_ID]
		);
		res.json({ success: true, photo: file.filename });
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

// Get Transfer Agent Name
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


// Export the router
module.exports = router; 