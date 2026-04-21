const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const multer = require('multer');
const { sendTelegramToEmployees } = require('../utils/telegram');
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

router.get("/house_expense", checkSession, async function (req, res) {
	try {
		const permissions = req.session.permissions;

		// Get expense settlement info (default date and settled dates)
		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		let defaultSettlementDate = todayStr;
		let lastSettlementDateStr = null;

		// Default = first day after latest active settlement (any month). Month-scoped MAX breaks on the 1st.
		try {
			const [rows] = await pool.execute(
				'SELECT MAX(SETTLEMENT_DATE) AS last_settlement FROM expense_daily_settlement WHERE ACTIVE = 1'
			);
			const lastSettlement = rows[0] && rows[0].last_settlement;
			if (lastSettlement) {
				const last = lastSettlement instanceof Date ? lastSettlement : new Date(String(lastSettlement).slice(0, 10) + 'T12:00:00Z');
				lastSettlementDateStr = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
				const nextDate = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
				defaultSettlementDate = `${nextDate.getFullYear()}-${pad(nextDate.getMonth() + 1)}-${pad(nextDate.getDate())}`;
			}
		} catch (e) {
			// keep defaultSettlementDate = todayStr
		}

		let settledDatesForMonth = [];
		try {
			const earliestAllowed = new Date(now.getFullYear() - 1, 0, 1);
			const earliestStr = `${earliestAllowed.getFullYear()}-${pad(earliestAllowed.getMonth() + 1)}-${pad(earliestAllowed.getDate())}`;
			const upperBoundStr =
				lastSettlementDateStr && lastSettlementDateStr > todayStr ? lastSettlementDateStr : todayStr;
			const [settledRows] = await pool.execute(
				'SELECT DISTINCT SETTLEMENT_DATE FROM expense_daily_settlement WHERE ACTIVE = 1 AND SETTLEMENT_DATE BETWEEN ? AND ? ORDER BY SETTLEMENT_DATE',
				[earliestStr, upperBoundStr]
			);
			settledDatesForMonth = (settledRows || []).map(r => {
				const d = r.SETTLEMENT_DATE;
				if (!d) return null;
				const x = d instanceof Date ? d : new Date(String(d).slice(0, 10) + 'T12:00:00Z');
				return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
			}).filter(Boolean);
		} catch (e) {
			// keep settledDatesForMonth = []
		}

		res.render("junket/house_expense", {
			...sessions(req, 'house_expense'),
			permissions: permissions,
			defaultSettlementDate: defaultSettlementDate,
			maxSettlementDate: defaultSettlementDate,
			settledDatesForMonth: settledDatesForMonth,
			todayStr: todayStr
		});
	} catch (err) {
		console.error('Error loading house_expense page:', err);
		res.status(500).send('Error loading page');
	}
});


router.get("/expense_category", checkSession, function (req, res) {

	const permissions = req.session.permissions;

	res.render("popups/expense_category", {
		...sessions(req, 'expense_category'),
		permissions: permissions
	});

});

// GET EXPENSE CATEGORY
router.get('/expense_category_data', async (req, res) => {
	try {
		const [result] = await pool.execute('SELECT * FROM expense_category WHERE ACTIVE = 1 ORDER BY CATEGORY ASC');
		res.json(result);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});


// ADD EXPENSE CATEGORY
router.post('/add_expense_category', async (req, res) => {
	const { txtCategory, txtType } = req.body;
	const date_now = new Date();

	const categoryType = parseInt(txtType, 10);
	const normalizedType = categoryType === 2 ? 2 : 1;
	const query = `INSERT INTO expense_category(CATEGORY, TYPE, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?, ?)`;

	try {
		await pool.execute(query, [txtCategory, normalizedType, req.session.user_id, date_now]);
		res.redirect('/expense_category');
	} catch (err) {
		console.error('Error inserting Expense Category:', err);
		res.status(500).send('Error inserting Expense Category');
	}
});

// EDIT EXPENSE CATEGORY
router.put('/expense_category/:id', async (req, res) => {
	const id = parseInt(req.params.id);
	const { txtCategory, txtType } = req.body;
	const date_now = new Date();

	const categoryType = parseInt(txtType, 10);
	const normalizedType = categoryType === 2 ? 2 : 1;

	const query = `UPDATE expense_category SET CATEGORY = ?, TYPE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;

	try {
		await pool.execute(query, [txtCategory, normalizedType, req.session.user_id, date_now, id]);
		res.send('Expense category updated successfully');
	} catch (err) {
		console.error('Error updating Expense category:', err);
		res.status(500).send('Error updating Expense category');
	}
});

// DELETE EXPENSE CATEGORY
router.put('/expense_category/remove/:id', async (req, res) => {
	const id = parseInt(req.params.id);
	const date_now = new Date();

	const query = `UPDATE expense_category SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;

	try {
		await pool.execute(query, [0, req.session.user_id, date_now, id]);
		res.send('Expense category updated successfully');
	} catch (err) {
		console.error('Error deleting Expense category:', err);
		res.status(500).send('Error deleting Expense category');
	}
});
// ADD JUNKET EXPENSE
router.post('/add_junket_house_expense', uploadReceiptImg.single('photo'), async (req, res) => {
	try {
		const {
			txtCategory,
			txtReceiptNo,
			txtDateandTime,
			txtDescription,
			txtAmount
		} = req.body;

		const date_now = new Date();
		const category = txtCategory || null;
		const receiptNo = txtReceiptNo || null;
		const dateTime = txtDateandTime || null;
		const description = txtDescription || null;
		const amount = txtAmount ? parseFloat(txtAmount.replace(/,/g, '')) : 0;
		const encodedBy = req.session?.user_id || null;
		const receiptFileName = req.file ? req.file.filename : null;

		const query = `
			INSERT INTO junket_house_expense 
			(CATEGORY_ID, RECEIPT_NO, DATE_TIME, DESCRIPTION, AMOUNT, PHOTO, ENCODED_BY, ENCODED_DT, DAILY_SETTLEMENT)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;

		// Determine DAILY_SETTLEMENT status based on latest settlement
		let dailySettlementStatus = 1; // Default: unsettled
		try {
			const todayStr = new Date().toISOString().slice(0, 10);
			const firstOfMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
			const [latestSettlement] = await pool.execute(
				`SELECT RUN_AT FROM expense_daily_settlement WHERE ACTIVE = 1 AND SETTLEMENT_DATE BETWEEN ? AND ? ORDER BY SETTLEMENT_DATE DESC, RUN_AT DESC LIMIT 1`,
				[firstOfMonth, todayStr]
			);
			
			if (latestSettlement.length > 0) {
				const settlementRunTime = latestSettlement[0].RUN_AT instanceof Date 
					? latestSettlement[0].RUN_AT 
					: new Date(latestSettlement[0].RUN_AT);
				const expenseCreatedAt = date_now instanceof Date ? date_now : new Date(date_now);
				
				// If expense created before settlement run, it's pending (should be in previous settlement)
				// Otherwise, mark as unsettled (will be in next settlement)
				if (expenseCreatedAt < settlementRunTime) {
					// This is a pending expense - should be added to previous settlement
					// For now, mark as unsettled and let settlement process handle it
					dailySettlementStatus = 1;
				} else {
					// New expense after settlement - mark as unsettled
					dailySettlementStatus = 1;
				}
			}
		} catch (e) {
			// If error, default to unsettled
			dailySettlementStatus = 1;
		}

		const [insertResult] = await pool.execute(query, [
			category,
			receiptNo,
			dateTime,
			description,
			amount,
			receiptFileName,
			encodedBy,
			date_now,
			dailySettlementStatus
		]);

		const [categoryRows] = await pool.execute('SELECT CATEGORY FROM expense_category WHERE IDNo = ? LIMIT 1', [
			category
		]);
		const expenseCategoryName = (categoryRows[0] && categoryRows[0].CATEGORY) ? categoryRows[0].CATEGORY : '-';

		const cashTransactionQuery = `
			INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`;

		await pool.execute(cashTransactionQuery, [
			insertResult.insertId,
			null,
			amount.toString(),
			'Expenses',
			2,
			expenseCategoryName,
			encodedBy,
			date_now
		]);

		// Get encoded by user name
		const [userRows] = await pool.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [encodedBy]);
		const encodedByName = userRows.length > 0 
			? (userRows[0].FIRSTNAME || 'Unknown')
			: 'Unknown';

		// Format date and time
		const dateFormatted = date_now.toLocaleDateString('en-US', { 
			year: 'numeric', 
			month: '2-digit', 
			day: '2-digit' 
		});
		const timeFormatted = date_now.toLocaleTimeString('en-US', { 
			hour: '2-digit', 
			minute: '2-digit' 
		});

		// Create Telegram message
		const telegramMessage = `Demo Cage\n\n* Junket Expense *\n\n` +
			`Category: ${expenseCategoryName}\n` +
			`Receipt No: ${receiptNo || 'N/A'}\n` +
			`Description: ${description || 'N/A'}\n` +
			`Amount: ₱${amount.toLocaleString()}\n\n` +
			`Encoded By: ${encodedByName}\n` +
			`Date: ${dateFormatted}\n` +
			`Time: ${timeFormatted}`;

		// Send Telegram notification to EMPLOYEE bot (CHAT_ID for USER = 'EMPLOYEE')
		try {
			await sendTelegramToEmployees(telegramMessage);
		} catch (telegramError) {
			console.error('Error sending Telegram notification:', telegramError);
			// Don't fail the request if Telegram fails
		}

		res.redirect('/house_expense');
	} catch (err) {
		console.error('Error inserting junket:', err);
		res.status(500).send('Error inserting junket');
	}
});


// GET JUNKET EXPENSE
// Settlement filter: date=current (unsettled), date=YYYY-MM-DD settled that day, or date >= next-day-after-last-settlement with no row → unsettled (local calendar)
router.get('/junket_house_expense_data', async (req, res) => {
	try {
		let { fromDate, toDate, date } = req.query;

		// If 'date' parameter is provided, use settlement filtering logic
		if (date !== undefined && date !== null && date !== '') {
			if (date === 'current') {
				// Show only unsettled expenses
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
						AND (e.DAILY_SETTLEMENT = 1 OR e.DAILY_SETTLEMENT IS NULL)
					
					UNION ALL
					
					SELECT 
						rm.IDNo,
						NULL AS CATEGORY_ID,
						CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS RECEIPT_NO,
						NULL AS DATE_TIME,
						rm.DESCRIPTION COLLATE utf8mb4_unicode_ci AS DESCRIPTION,
						rm.AMOUNT,
						CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS PHOTO,
						rm.ENCODED_BY,
						rm.ENCODED_DT,
						rm.EDITED_BY,
						rm.EDITED_DT,
						rm.ACTIVE,
						NULL AS RESET,
						0 AS EDIT_LOG_COUNT,
						rm.IDNo AS expense_id,
						NULL AS expense_category_id,
						'Return Money' COLLATE utf8mb4_unicode_ci AS expense_category,
						0 AS expense_type,
						COALESCE(u2.FIRSTNAME, CONCAT('User ID: ', rm.ENCODED_BY)) COLLATE utf8mb4_unicode_ci AS FIRSTNAME,
						'return_money' COLLATE utf8mb4_unicode_ci AS record_type
					FROM junket_return_money rm
					LEFT JOIN user_info u2 ON u2.IDNo = rm.ENCODED_BY AND u2.ACTIVE = 1
					WHERE rm.ACTIVE = 1
						AND (rm.DAILY_SETTLEMENT = 1 OR rm.DAILY_SETTLEMENT IS NULL)
					
					ORDER BY ENCODED_DT DESC
				`;
				const [result] = await pool.execute(query);
				const updatedResult = result.map(expense => ({
					...expense,
					photoUrl: expense.PHOTO ? '/ReceiptUpload/' + expense.PHOTO : null
				}));
				return res.json(updatedResult);
			}
			
			const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
			if (isValidDate(date)) {
				// Check if settlement exists for this date
				const [hasSettlement] = await pool.execute(
					'SELECT IDNo FROM expense_daily_settlement WHERE SETTLEMENT_DATE = ? AND ACTIVE = 1 LIMIT 1',
					[date]
				);
				
				if (hasSettlement.length > 0) {
					// Show expenses from this settlement
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
						JOIN expense_daily_settlement_items edsi ON edsi.EXPENSE_ID = e.IDNo AND edsi.EXPENSE_TYPE = 'expense'
						JOIN expense_daily_settlement eds ON edsi.DAILY_SETTLEMENT_ID = eds.IDNo AND eds.ACTIVE = 1
						WHERE e.ACTIVE = 1
							AND eds.SETTLEMENT_DATE = ?
						
						UNION ALL
						
						SELECT 
							rm.IDNo,
							NULL AS CATEGORY_ID,
							CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS RECEIPT_NO,
							NULL AS DATE_TIME,
							rm.DESCRIPTION COLLATE utf8mb4_unicode_ci AS DESCRIPTION,
							rm.AMOUNT,
							CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS PHOTO,
							rm.ENCODED_BY,
							rm.ENCODED_DT,
							rm.EDITED_BY,
							rm.EDITED_DT,
							rm.ACTIVE,
							NULL AS RESET,
							0 AS EDIT_LOG_COUNT,
							rm.IDNo AS expense_id,
							NULL AS expense_category_id,
							'Return Money' COLLATE utf8mb4_unicode_ci AS expense_category,
							0 AS expense_type,
							COALESCE(u2.FIRSTNAME, CONCAT('User ID: ', rm.ENCODED_BY)) COLLATE utf8mb4_unicode_ci AS FIRSTNAME,
							'return_money' COLLATE utf8mb4_unicode_ci AS record_type
						FROM junket_return_money rm
						LEFT JOIN user_info u2 ON u2.IDNo = rm.ENCODED_BY AND u2.ACTIVE = 1
						JOIN expense_daily_settlement_items edsi2 ON edsi2.EXPENSE_ID = rm.IDNo AND edsi2.EXPENSE_TYPE = 'return_money'
						JOIN expense_daily_settlement eds2 ON edsi2.DAILY_SETTLEMENT_ID = eds2.IDNo AND eds2.ACTIVE = 1
						WHERE rm.ACTIVE = 1
							AND eds2.SETTLEMENT_DATE = ?
						
						ORDER BY ENCODED_DT DESC
					`;
					const [result] = await pool.execute(query, [date, date]);
					const updatedResult = result.map(expense => ({
						...expense,
						photoUrl: expense.PHOTO ? '/ReceiptUpload/' + expense.PHOTO : null
					}));
					return res.json(updatedResult);
				}

				// Same "next settlement date" rule as Game Book / house_expense page (local calendar today).
				const nowLocal = new Date();
				const padL = (n) => String(n).padStart(2, '0');
				const todayStr = `${nowLocal.getFullYear()}-${padL(nowLocal.getMonth() + 1)}-${padL(nowLocal.getDate())}`;
				let defaultSettlementDate = todayStr;
				try {
					const [lastRows] = await pool.execute(
						'SELECT MAX(SETTLEMENT_DATE) AS last_settlement FROM expense_daily_settlement WHERE ACTIVE = 1'
					);
					const lastSettlement = lastRows[0] && lastRows[0].last_settlement;
					if (lastSettlement) {
						const last =
							lastSettlement instanceof Date
								? lastSettlement
								: new Date(String(lastSettlement).slice(0, 10) + 'T12:00:00Z');
						const nextDate = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
						defaultSettlementDate = `${nextDate.getFullYear()}-${padL(nextDate.getMonth() + 1)}-${padL(
							nextDate.getDate()
						)}`;
					}
				} catch (e) {
					// keep defaultSettlementDate = todayStr
				}

				if (date >= defaultSettlementDate) {
					// On or after next eligible settlement day: show all unsettled (missed day can be settled next calendar day).
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
							AND (e.DAILY_SETTLEMENT = 1 OR e.DAILY_SETTLEMENT IS NULL)
						
						UNION ALL
						
						SELECT 
							rm.IDNo,
							NULL AS CATEGORY_ID,
							CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS RECEIPT_NO,
							NULL AS DATE_TIME,
							rm.DESCRIPTION COLLATE utf8mb4_unicode_ci AS DESCRIPTION,
							rm.AMOUNT,
							CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS PHOTO,
							rm.ENCODED_BY,
							rm.ENCODED_DT,
							rm.EDITED_BY,
							rm.EDITED_DT,
							rm.ACTIVE,
							NULL AS RESET,
							0 AS EDIT_LOG_COUNT,
							rm.IDNo AS expense_id,
							NULL AS expense_category_id,
							'Return Money' COLLATE utf8mb4_unicode_ci AS expense_category,
							0 AS expense_type,
							COALESCE(u2.FIRSTNAME, CONCAT('User ID: ', rm.ENCODED_BY)) COLLATE utf8mb4_unicode_ci AS FIRSTNAME,
							'return_money' COLLATE utf8mb4_unicode_ci AS record_type
						FROM junket_return_money rm
						LEFT JOIN user_info u2 ON u2.IDNo = rm.ENCODED_BY AND u2.ACTIVE = 1
						WHERE rm.ACTIVE = 1
							AND (rm.DAILY_SETTLEMENT = 1 OR rm.DAILY_SETTLEMENT IS NULL)
						
						ORDER BY ENCODED_DT DESC
					`;
					const [result] = await pool.execute(query);
					const updatedResult = result.map(expense => ({
						...expense,
						photoUrl: expense.PHOTO ? '/ReceiptUpload/' + expense.PHOTO : null
					}));
					return res.json(updatedResult);
				}

				// Before next eligible settlement day and no row for this date: empty
				return res.json([]);
			}
		}

		// Date range mode: Filter by settlement date
		// Shows settled expenses within date range + unsettled expenses if toDate > last settlement date
		if (!fromDate || !toDate) {
			const currentDate = new Date();
			const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
			fromDate = firstDayOfMonth.toISOString().slice(0, 10);
			toDate = currentDate.toISOString().slice(0, 10);
		}

		const isValidDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date);
		if (!isValidDate(fromDate) || !isValidDate(toDate)) {
			return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
		}

		// Get last settlement date to determine if unsettled expenses should be shown
		let nextSettlementDateStr = null;
		let lastSettlementDateStr = null;
		let hasSettlement = false;
		try {
			const [lastSettlementRows] = await pool.execute(
				'SELECT MAX(CAST(SETTLEMENT_DATE AS DATE)) AS last_settlement FROM expense_daily_settlement WHERE ACTIVE = 1 AND CAST(SETTLEMENT_DATE AS DATE) <= CAST(? AS DATE)',
				[toDate]
			);
			if (lastSettlementRows[0] && lastSettlementRows[0].last_settlement) {
				hasSettlement = true;
				const lastSettlement = lastSettlementRows[0].last_settlement;
				let lastDate;
				if (lastSettlement instanceof Date) {
					const pad = (n) => String(n).padStart(2, '0');
					lastDate = `${lastSettlement.getFullYear()}-${pad(lastSettlement.getMonth() + 1)}-${pad(lastSettlement.getDate())}`;
				} else {
					lastDate = String(lastSettlement).slice(0, 10);
				}
				lastSettlementDateStr = lastDate;
				
				const last = new Date(lastDate + 'T12:00:00');
				const nextDate = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
				const pad = (n) => String(n).padStart(2, '0');
				nextSettlementDateStr = `${nextDate.getFullYear()}-${pad(nextDate.getMonth() + 1)}-${pad(nextDate.getDate())}`;
			}
		} catch (e) {
			// If error, don't show unsettled expenses
		}

		// Date range mode: Show expenses settled within date range + unsettled expenses if toDate > last settlement
		let query = `
			-- Expenses settled within the date range
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
			JOIN expense_daily_settlement_items edsi ON edsi.EXPENSE_ID = e.IDNo AND edsi.EXPENSE_TYPE = 'expense'
			JOIN expense_daily_settlement eds ON edsi.DAILY_SETTLEMENT_ID = eds.IDNo AND eds.ACTIVE = 1
			WHERE e.ACTIVE = 1
				AND eds.SETTLEMENT_DATE BETWEEN ? AND ?
			
			UNION ALL
			
			-- Return money settled within the date range
			SELECT 
				rm.IDNo,
				NULL AS CATEGORY_ID,
				CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS RECEIPT_NO,
				NULL AS DATE_TIME,
				rm.DESCRIPTION COLLATE utf8mb4_unicode_ci AS DESCRIPTION,
				rm.AMOUNT,
				CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS PHOTO,
				rm.ENCODED_BY,
				rm.ENCODED_DT,
				rm.EDITED_BY,
				rm.EDITED_DT,
				rm.ACTIVE,
				NULL AS RESET,
				0 AS EDIT_LOG_COUNT,
				rm.IDNo AS expense_id,
				NULL AS expense_category_id,
				'Return Money' COLLATE utf8mb4_unicode_ci AS expense_category,
				0 AS expense_type,
				COALESCE(u2.FIRSTNAME, CONCAT('User ID: ', rm.ENCODED_BY)) COLLATE utf8mb4_unicode_ci AS FIRSTNAME,
				'return_money' COLLATE utf8mb4_unicode_ci AS record_type
			FROM junket_return_money rm
			LEFT JOIN user_info u2 ON u2.IDNo = rm.ENCODED_BY AND u2.ACTIVE = 1
			JOIN expense_daily_settlement_items edsi2 ON edsi2.EXPENSE_ID = rm.IDNo AND edsi2.EXPENSE_TYPE = 'return_money'
			JOIN expense_daily_settlement eds2 ON edsi2.DAILY_SETTLEMENT_ID = eds2.IDNo AND eds2.ACTIVE = 1
			WHERE rm.ACTIVE = 1
				AND eds2.SETTLEMENT_DATE BETWEEN ? AND ?`;

		// Add unsettled expenses only if toDate > last settlement date
		if (hasSettlement && lastSettlementDateStr && toDate > lastSettlementDateStr) {
			query += `
			
			UNION ALL
			
			-- Unsettled expenses (for next settlement date)
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
				AND (e.DAILY_SETTLEMENT = 1 OR e.DAILY_SETTLEMENT IS NULL)
			
			UNION ALL
			
			-- Unsettled return money (for next settlement date)
			SELECT 
				rm.IDNo,
				NULL AS CATEGORY_ID,
				CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS RECEIPT_NO,
				NULL AS DATE_TIME,
				rm.DESCRIPTION COLLATE utf8mb4_unicode_ci AS DESCRIPTION,
				rm.AMOUNT,
				CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS PHOTO,
				rm.ENCODED_BY,
				rm.ENCODED_DT,
				rm.EDITED_BY,
				rm.EDITED_DT,
				rm.ACTIVE,
				NULL AS RESET,
				0 AS EDIT_LOG_COUNT,
				rm.IDNo AS expense_id,
				NULL AS expense_category_id,
				'Return Money' COLLATE utf8mb4_unicode_ci AS expense_category,
				0 AS expense_type,
				COALESCE(u2.FIRSTNAME, CONCAT('User ID: ', rm.ENCODED_BY)) COLLATE utf8mb4_unicode_ci AS FIRSTNAME,
				'return_money' COLLATE utf8mb4_unicode_ci AS record_type
			FROM junket_return_money rm
			LEFT JOIN user_info u2 ON u2.IDNo = rm.ENCODED_BY AND u2.ACTIVE = 1
			WHERE rm.ACTIVE = 1
				AND (rm.DAILY_SETTLEMENT = 1 OR rm.DAILY_SETTLEMENT IS NULL)`;
		}

		query += `
			
			ORDER BY ENCODED_DT DESC
		`;

		const [result] = await pool.execute(query, [fromDate, toDate, fromDate, toDate]);

		const updatedResult = result.map(expense => ({
			...expense,
			photoUrl: expense.PHOTO ? '/ReceiptUpload/' + expense.PHOTO : null
		}));

		res.json(updatedResult);
	} catch (err) {
		console.error('Error executing query:', err);
		res.status(500).json({ error: 'Internal Server Error', details: err.message });
	}
});

// GET junket house expense edit history (junket_house_expense_edit_log)
router.get('/junket_house_expense/:id/edit_log', async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) {
			return res.status(400).json({ error: 'Invalid id' });
		}
		const [rows] = await pool.execute(
			`SELECT el.IDNo, el.EDITED_BY, el.EDITED_DT, el.CHANGES_TEXT,
				u.FIRSTNAME AS edited_by_name
			 FROM junket_house_expense_edit_log el
			 LEFT JOIN user_info u ON u.IDNo = el.EDITED_BY
			 WHERE el.EXPENSE_ID = ?
			 ORDER BY el.IDNo DESC`,
			[id]
		);
		res.json(rows);
	} catch (err) {
		console.error('junket_house_expense edit_log:', err);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

// EDIT JUNKET EXPENSE
router.put('/junket_house_expense/:id', uploadReceiptImg.single('photo'), async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const {
			txtCategory,
			txtReceiptNo,
			txtDateandTime,
			txtDescription,
			txtAmount
		} = req.body;

		const date_now = new Date();
		const editXAmount = parseFloat(txtAmount.replace(/,/g, ''));
		const safeDateTime = txtDateandTime || null;

		// Build diff text; store in junket_house_expense_edit_log (full history, one row per save with changes)
		const [oldRows] = await pool.execute(
			`SELECT e.CATEGORY_ID, e.RECEIPT_NO, e.DATE_TIME, e.DESCRIPTION, e.AMOUNT, e.PHOTO,
				ec.CATEGORY AS category_name
			 FROM junket_house_expense e
			 LEFT JOIN expense_category ec ON ec.IDNo = e.CATEGORY_ID
			 WHERE e.IDNo = ? LIMIT 1`,
			[id]
		);
		const old = oldRows[0];
		const oldAmount = old ? Number(old.AMOUNT) : null;
		let changesText = null;
		if (old) {
			const norm = (s) => (s == null || s === '' ? '' : String(s).trim());
			const ts = (v) => {
				if (v == null || v === '') return null;
				const d = v instanceof Date ? v : new Date(v);
				return isNaN(d.getTime()) ? null : d.getTime();
			};
			const amtEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

			const lines = [];
			const newCat = parseInt(txtCategory, 10);
			const oldCat = parseInt(old.CATEGORY_ID, 10);
			if (!Number.isNaN(newCat) && !Number.isNaN(oldCat) && newCat !== oldCat) {
				lines.push(`Category: ${old.category_name || 'N/A'}`);
			}
			if (norm(old.RECEIPT_NO) !== norm(txtReceiptNo)) {
				const v = norm(old.RECEIPT_NO) || 'N/A';
				lines.push(`Description: ${v}`);
			}
			if (norm(old.DESCRIPTION) !== norm(txtDescription)) {
				const v = norm(old.DESCRIPTION) || 'N/A';
				lines.push(`In-charge: ${v}`);
			}
			if (!amtEq(old.AMOUNT, editXAmount)) {
				lines.push(`Amount: ${Number(old.AMOUNT).toLocaleString('en-US')}`);
			}
			if (ts(old.DATE_TIME) !== ts(safeDateTime)) {
				let expStr = 'N/A';
				if (old.DATE_TIME != null) {
					const d =
						old.DATE_TIME instanceof Date ? old.DATE_TIME : new Date(old.DATE_TIME);
					expStr = isNaN(d.getTime()) ? String(old.DATE_TIME) : d.toLocaleString('en-PH');
				}
				lines.push(`Expense date: ${expStr}`);
			}
			if (req.file) {
				if (old.PHOTO) {
					lines.push(`Receipt image (before): ${old.PHOTO}`);
				} else {
					lines.push('Receipt image: added');
				}
			}

			if (lines.length > 0) {
				const [footerUserRows] = await pool.execute(
					'SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1',
					[req.session.user_id]
				);
				const saveByStr =
					footerUserRows[0]?.FIRSTNAME != null &&
					String(footerUserRows[0].FIRSTNAME).trim() !== ''
						? String(footerUserRows[0].FIRSTNAME)
						: `User ID: ${req.session.user_id}`;
				const saveDtStr = date_now.toLocaleString('en-PH');
				lines.push(`Edited by: ${saveByStr}`);
				lines.push(`Date: ${saveDtStr}`);
				changesText = lines.join('\n');
			}
		}

		let query = `
			UPDATE junket_house_expense 
			SET CATEGORY_ID = ?, RECEIPT_NO = ?, DATE_TIME = ?, DESCRIPTION = ?, AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ?
		`;
		const params = [txtCategory, txtReceiptNo, safeDateTime, txtDescription, editXAmount, req.session.user_id, date_now];

		if (req.file) {
			query += `, PHOTO = ?`;
			params.push(req.file.filename);
		}

		query += ` WHERE IDNo = ?`;
		params.push(id);

		await pool.execute(query, params);
		if (changesText) {
			await pool.execute(
				'INSERT INTO junket_house_expense_edit_log (EXPENSE_ID, EDITED_BY, EDITED_DT, CHANGES_TEXT) VALUES (?, ?, ?, ?)',
				[id, req.session.user_id, date_now, changesText]
			);
		}
		const [categoryRows] = await pool.execute('SELECT CATEGORY FROM expense_category WHERE IDNo = ? LIMIT 1', [
			txtCategory
		]);
		const expenseCategoryName = (categoryRows[0] && categoryRows[0].CATEGORY) ? categoryRows[0].CATEGORY : '-';

		const cashTransactionUpdateQuery = `
			UPDATE cash_transaction
			SET AMOUNT = ?, CATEGORY = ?, REMARKS = ?, ENCODED_BY = ?, ENCODED_DT = ?
			WHERE TRANSACTION_ID = ? AND CATEGORY = 'Expenses' AND ACTIVE = 1
		`;
		await pool.execute(cashTransactionUpdateQuery, [editXAmount.toString(), 'Expenses', expenseCategoryName, req.session.user_id, date_now, id]);

		// Telegram to Management: expense edited with details
		try {
			const [typeRow] = await pool.execute('SELECT TYPE FROM expense_category WHERE IDNo = ? LIMIT 1', [txtCategory]);
			const typeLabel = (typeRow[0] && typeRow[0].TYPE === 2) ? 'Non-goods / Services' : 'Goods / Services';
			const [userRows] = await pool.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [req.session.user_id]);
			const editedByName = userRows.length > 0 ? (userRows[0].FIRSTNAME || 'Unknown') : 'Unknown';
			const dateFormatted = date_now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
			const timeFormatted = date_now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			const beforeAmountLabel = oldAmount !== null ? `Before Amount: ₱${oldAmount.toLocaleString()}\n` : '';
			const editMsg =
				'Demo Cage\n\n✏️ * Junket Expense (EDIT) *\n\n' +
				`Name: ${expenseCategoryName}\n` +
				`Type: ${typeLabel}\n` +
				`Receipt #: ${txtReceiptNo || 'N/A'}\n` +
				`Description: ${txtDescription || 'N/A'}\n` +
				beforeAmountLabel +
				`New Amount: ₱${Number(editXAmount).toLocaleString()}\n` +
				`Edited By: ${editedByName}\n` +
				`Date & Time: ${dateFormatted} ${timeFormatted}`;
			await sendTelegramToEmployees(editMsg);
		} catch (telegramError) {
			console.error('Error sending Telegram (expense edit):', telegramError);
		}

		res.send('Junket updated successfully');
	} catch (err) {
		console.error('Error updating Junket:', err);
		res.status(500).send('Error updating Junket');
	}
});

// DELETE JUNKET EXPENSE
router.put('/junket_house_expense/remove/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const date_now = new Date();

		// Fetch expense details before delete for Telegram
		const [expRows] = await pool.execute(
			`SELECT e.CATEGORY_ID, e.RECEIPT_NO, e.DATE_TIME, e.DESCRIPTION, e.AMOUNT, e.ENCODED_BY, ec.CATEGORY, ec.TYPE
			 FROM junket_house_expense e
			 LEFT JOIN expense_category ec ON ec.IDNo = e.CATEGORY_ID
			 WHERE e.IDNo = ? LIMIT 1`,
			[id]
		);
		const exp = expRows[0];
		const categoryName = exp ? (exp.CATEGORY || 'N/A') : 'N/A';
		const typeLabel = exp && exp.TYPE === 2 ? 'Non-goods / Services' : 'Goods / Services';
		const receiptNo = exp ? (exp.RECEIPT_NO || 'N/A') : 'N/A';
		const desc = exp ? (exp.DESCRIPTION || 'N/A') : 'N/A';
		const amount = exp ? Number(exp.AMOUNT) : 0;
		const encodedById = exp ? exp.ENCODED_BY : null;
		let encodedByName = 'N/A';
		if (encodedById) {
			const [u] = await pool.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [encodedById]);
			encodedByName = u.length > 0 ? (u[0].FIRSTNAME || 'N/A') : 'N/A';
		}
		const [editedU] = await pool.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [req.session.user_id]);
		const editedByName = editedU.length > 0 ? (editedU[0].FIRSTNAME || 'Unknown') : 'Unknown';
		// Use actual delete time (date_now) instead of stored DATE_TIME
		const deleteDateFormatted = date_now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
		const deleteTimeFormatted = date_now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		const deleteDateTimeStr = `${deleteDateFormatted} ${deleteTimeFormatted}`;

		const query = `
			UPDATE junket_house_expense 
			SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? 
			WHERE IDNo = ?
		`;

		await pool.execute(query, [0, req.session.user_id, date_now, id]);
		await pool.execute(
			'UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND CATEGORY = ? AND ACTIVE = 1',
			[req.session.user_id, date_now, id, 'Expenses']
		);

		// Telegram to Management: expense deleted with details
		try {
			const deleteMsg =
				'Demo Cage\n\n🗑️ * Junket Expense (DELETED) *\n\n' +
				`Name: ${categoryName}\n` +
				`Type: ${typeLabel}\n` +
				`Receipt #: ${receiptNo}\n` +
				`Description: ${desc}\n` +
				`Amount: ₱${amount.toLocaleString()}\n` +
				`Encoded By: ${encodedByName}\n` +
				`Date & Time: ${deleteDateTimeStr}\n` +
				`Deleted By: ${editedByName}`;
			await sendTelegramToEmployees(deleteMsg);
		} catch (telegramError) {
			console.error('Error sending Telegram (expense delete):', telegramError);
		}

		res.send('Junket updated successfully');
	} catch (err) {
		console.error('Error updating Junket:', err);
		res.status(500).send('Error updating Junket');
	}
});

// ADD RETURN MONEY
router.post('/add_return_money', async (req, res) => {
	try {
		const {
			txtDescription,
			txtAmount
		} = req.body;

		const date_now = new Date();
		const description = txtDescription || null;
		// Remove commas and parse to float
		const amountStr = txtAmount ? String(txtAmount).replace(/,/g, '').trim() : '0';
		const amount = parseFloat(amountStr) || 0;
		const encodedBy = req.session?.user_id || null;

		const query = `
			INSERT INTO junket_return_money
			(DESCRIPTION, AMOUNT, ENCODED_BY, ENCODED_DT, DAILY_SETTLEMENT)
			VALUES (?, ?, ?, ?, ?)
		`;

		// Determine DAILY_SETTLEMENT status based on latest settlement
		let dailySettlementStatus = 1; // Default: unsettled
		try {
			const todayStr = new Date().toISOString().slice(0, 10);
			const firstOfMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
			const [latestSettlement] = await pool.execute(
				`SELECT RUN_AT FROM expense_daily_settlement WHERE ACTIVE = 1 AND SETTLEMENT_DATE BETWEEN ? AND ? ORDER BY SETTLEMENT_DATE DESC, RUN_AT DESC LIMIT 1`,
				[firstOfMonth, todayStr]
			);
			
			if (latestSettlement.length > 0) {
				const settlementRunTime = latestSettlement[0].RUN_AT instanceof Date 
					? latestSettlement[0].RUN_AT 
					: new Date(latestSettlement[0].RUN_AT);
				const returnMoneyCreatedAt = date_now instanceof Date ? date_now : new Date(date_now);
				
				// If return money created before settlement run, it's pending
				// Otherwise, mark as unsettled (will be in next settlement)
				if (returnMoneyCreatedAt < settlementRunTime) {
					dailySettlementStatus = 1;
				} else {
					dailySettlementStatus = 1;
				}
			}
		} catch (e) {
			// If error, default to unsettled
			dailySettlementStatus = 1;
		}

		const [insertResult] = await pool.execute(query, [
			description,
			amount,
			encodedBy,
			date_now,
			dailySettlementStatus
		]);

		// Telegram to Management: return money added with details
		try {
			const [userRows] = await pool.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [encodedBy]);
			const encodedByName = userRows.length > 0 ? (userRows[0].FIRSTNAME || 'Unknown') : 'Unknown';
			const dateFormatted = date_now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
			const timeFormatted = date_now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			const addReturnMsg =
				'Demo Cage\n\n💸 * Return Money (ADDED) *\n\n' +
				`Amount: ₱${amount.toLocaleString()}\n` +
				`Description: ${description || 'N/A'}\n` +
				`Encoded By: ${encodedByName}\n` +
				`Date & Time: ${dateFormatted} ${timeFormatted}`;
			await sendTelegramToEmployees(addReturnMsg);
		} catch (telegramError) {
			console.error('Error sending Telegram (return money add):', telegramError);
		}

		res.json({ success: true, message: 'Return money added successfully' });
	} catch (err) {
		console.error('Error inserting return money:', err);
		res.status(500).json({ error: 'Error inserting return money' });
	}
});

// EDIT RETURN MONEY
router.put('/edit_return_money/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const {
			txtDescription,
			txtAmount
		} = req.body;

		const date_now = new Date();
		const description = txtDescription || null;
		const amount = txtAmount ? parseFloat(txtAmount.replace(/,/g, '')) : 0;

		// Get previous amount before updating (for Telegram \"before amount\")
		const [oldRmRows] = await pool.execute(
			'SELECT AMOUNT FROM junket_return_money WHERE IDNo = ? LIMIT 1',
			[id]
		);
		const oldReturnAmount = oldRmRows.length > 0 ? Number(oldRmRows[0].AMOUNT) : null;

		const query = `
			UPDATE junket_return_money 
			SET DESCRIPTION = ?, AMOUNT = ?, EDITED_BY = ?, EDITED_DT = ?
			WHERE IDNo = ?
		`;

		await pool.execute(query, [
			description,
			amount,
			req.session.user_id,
			date_now,
			id
		]);

		// Telegram to Management: return money edited with details
		try {
			const [userRows] = await pool.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [req.session.user_id]);
			const editedByName = userRows.length > 0 ? (userRows[0].FIRSTNAME || 'Unknown') : 'Unknown';
			const dateFormatted = date_now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
			const timeFormatted = date_now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			const beforeAmountLabel = oldReturnAmount !== null ? `Before Amount: ₱${oldReturnAmount.toLocaleString()}\n` : '';
			const editReturnMsg =
				'Demo Cage\n\n✏️ * Return Money (EDIT) *\n\n' +
				beforeAmountLabel +
				`New Amount: ₱${amount.toLocaleString()}\n` +
				`Description: ${description || 'N/A'}\n` +
				`Edited By: ${editedByName}\n` +
				`Date & Time: ${dateFormatted} ${timeFormatted}`;
			await sendTelegramToEmployees(editReturnMsg);
		} catch (telegramError) {
			console.error('Error sending Telegram (return money edit):', telegramError);
		}

		res.json({ success: true, message: 'Return money updated successfully' });
	} catch (err) {
		console.error('Error updating return money:', err);
		res.status(500).json({ error: 'Error updating return money' });
	}
});

// DELETE RETURN MONEY
router.put('/remove_return_money/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const date_now = new Date();

		// Fetch return money details before delete for Telegram
		const [rmRows] = await pool.execute(
			'SELECT DESCRIPTION, AMOUNT, ENCODED_BY, ENCODED_DT FROM junket_return_money WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
			[id]
		);
		const rm = rmRows[0];
		const desc = rm ? (rm.DESCRIPTION || 'N/A') : 'N/A';
		const amount = rm ? Number(rm.AMOUNT) : 0;
		let encodedByName = 'N/A';
		if (rm && rm.ENCODED_BY) {
			const [u] = await pool.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [rm.ENCODED_BY]);
			encodedByName = u.length > 0 ? (u[0].FIRSTNAME || 'N/A') : 'N/A';
		}
		const [editedU] = await pool.execute('SELECT FIRSTNAME FROM user_info WHERE IDNo = ? LIMIT 1', [req.session.user_id]);
		const editedByName = editedU.length > 0 ? (editedU[0].FIRSTNAME || 'Unknown') : 'Unknown';
		let dateTimeStr = 'N/A';
		if (rm && rm.ENCODED_DT) {
			const d = rm.ENCODED_DT instanceof Date ? rm.ENCODED_DT : new Date(rm.ENCODED_DT);
			dateTimeStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		}

		const query = `
			UPDATE junket_return_money 
			SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? 
			WHERE IDNo = ?
		`;

		await pool.execute(query, [0, req.session.user_id, date_now, id]);

		// Telegram to Management: return money deleted with details
		try {
			const deleteReturnMsg =
				'Demo Cage\n\n🗑️ * Return Money (DELETED) *\n\n' +
				`Amount: ₱${amount.toLocaleString()}\n` +
				`Description: ${desc}\n` +
				`Encoded By: ${encodedByName}\n` +
				`Date & Time: ${dateTimeStr}\n` +
				`Deleted By: ${editedByName}`;
			await sendTelegramToEmployees(deleteReturnMsg);
		} catch (telegramError) {
			console.error('Error sending Telegram (return money delete):', telegramError);
		}

		res.json({ success: true, message: 'Return money deleted successfully' });
	} catch (err) {
		console.error('Error deleting return money:', err);
		res.status(500).json({ error: 'Error deleting return money' });
	}
});

// ======================= EXPENSE DAILY SETTLEMENT ==================

// GET expense settlement info (default date and settled dates)
router.get('/expense_settlement_info', async (req, res) => {
	try {
		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		let defaultSettlementDate = todayStr;
		let lastSettlementDateStr = null;

		try {
			const [rows] = await pool.execute(
				'SELECT MAX(SETTLEMENT_DATE) AS last_settlement FROM expense_daily_settlement WHERE ACTIVE = 1'
			);
			const lastSettlement = rows[0] && rows[0].last_settlement;
			if (lastSettlement) {
				const last = lastSettlement instanceof Date ? lastSettlement : new Date(String(lastSettlement).slice(0, 10) + 'T12:00:00Z');
				lastSettlementDateStr = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
				const nextDate = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
				defaultSettlementDate = `${nextDate.getFullYear()}-${pad(nextDate.getMonth() + 1)}-${pad(nextDate.getDate())}`;
			}
		} catch (e) {
			// keep defaultSettlementDate = todayStr
		}

		let settledDatesForMonth = [];
		try {
			const earliestAllowed = new Date(now.getFullYear() - 1, 0, 1);
			const earliestStr = `${earliestAllowed.getFullYear()}-${pad(earliestAllowed.getMonth() + 1)}-${pad(earliestAllowed.getDate())}`;
			const upperBoundStr =
				lastSettlementDateStr && lastSettlementDateStr > todayStr ? lastSettlementDateStr : todayStr;
			const [settledRows] = await pool.execute(
				'SELECT DISTINCT SETTLEMENT_DATE FROM expense_daily_settlement WHERE ACTIVE = 1 AND SETTLEMENT_DATE BETWEEN ? AND ? ORDER BY SETTLEMENT_DATE',
				[earliestStr, upperBoundStr]
			);
			settledDatesForMonth = (settledRows || []).map(r => {
				const d = r.SETTLEMENT_DATE;
				if (!d) return null;
				const x = d instanceof Date ? d : new Date(String(d).slice(0, 10) + 'T12:00:00Z');
				return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
			}).filter(Boolean);
		} catch (e) {
			// keep settledDatesForMonth = []
		}

		res.json({
			defaultSettlementDate,
			settledDatesForMonth
		});
	} catch (err) {
		console.error('Error fetching expense settlement info:', err);
		res.status(500).json({ error: 'Error fetching expense settlement info' });
	}
});

// POST run daily settlement for expenses (move all unsettled expenses into today's settlement)
router.post('/expense_daily_settlement/run', async (req, res) => {
	const encodedBy = req.session?.user_id;
	if (!encodedBy) {
		return res.status(401).json({ error: 'Not authenticated' });
	}
	const settlementDate = (req.body && req.body.settlement_date) 
		? req.body.settlement_date 
		: new Date().toISOString().slice(0, 10);

	const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
	if (!isValidDate(settlementDate)) {
		return res.status(400).json({ error: 'Invalid settlement_date. Use YYYY-MM-DD.' });
	}

	let connection;
	try {
		connection = await pool.getConnection();
		await connection.beginTransaction();

		// Check if settlement for this date already exists
		const [existing] = await connection.execute(
			'SELECT IDNo FROM expense_daily_settlement WHERE SETTLEMENT_DATE = ? AND ACTIVE = 1',
			[settlementDate]
		);
		if (existing.length > 0) {
			await connection.rollback();
			connection.release();
			return res.status(400).json({ error: 'Settlement for this date already exists.' });
		}

		// Create settlement record
		const [insertSettlement] = await connection.execute(
			`INSERT INTO expense_daily_settlement (SETTLEMENT_DATE, RUN_AT, ENCODED_BY, STATUS, ACTIVE)
			 VALUES (?, NOW(), ?, 'finalized', 1)`,
			[settlementDate, encodedBy]
		);
		const settlementId = insertSettlement.insertId;

		// Get all unsettled expenses (junket_house_expense)
		const [openExpenses] = await connection.execute(
			`SELECT IDNo FROM junket_house_expense 
			 WHERE ACTIVE = 1 AND (DAILY_SETTLEMENT = 1 OR DAILY_SETTLEMENT IS NULL)`
		);

		// Get all unsettled return money (junket_return_money)
		const [openReturnMoney] = await connection.execute(
			`SELECT IDNo FROM junket_return_money 
			 WHERE ACTIVE = 1 AND (DAILY_SETTLEMENT = 1 OR DAILY_SETTLEMENT IS NULL)`
		);

		// Bulk insert expense items
		if (openExpenses.length > 0) {
			const expensePlaceholders = openExpenses.map(() => '(?, ?, ?, NOW())').join(', ');
			const expenseParams = openExpenses.flatMap(row => [settlementId, row.IDNo, 'expense']);
			await connection.execute(
				`INSERT INTO expense_daily_settlement_items (DAILY_SETTLEMENT_ID, EXPENSE_ID, EXPENSE_TYPE, ADDED_AT) 
				 VALUES ${expensePlaceholders}`,
				expenseParams
			);
		}

		// Bulk insert return money items
		if (openReturnMoney.length > 0) {
			const returnMoneyPlaceholders = openReturnMoney.map(() => '(?, ?, ?, NOW())').join(', ');
			const returnMoneyParams = openReturnMoney.flatMap(row => [settlementId, row.IDNo, 'return_money']);
			await connection.execute(
				`INSERT INTO expense_daily_settlement_items (DAILY_SETTLEMENT_ID, EXPENSE_ID, EXPENSE_TYPE, ADDED_AT) 
				 VALUES ${returnMoneyPlaceholders}`,
				returnMoneyParams
			);
		}

		// Update expense status to settled
		if (openExpenses.length > 0) {
			await connection.execute(
				`UPDATE junket_house_expense SET DAILY_SETTLEMENT = 2 
				 WHERE ACTIVE = 1 AND (DAILY_SETTLEMENT = 1 OR DAILY_SETTLEMENT IS NULL)`
			);
		}

		// Update return money status to settled
		if (openReturnMoney.length > 0) {
			await connection.execute(
				`UPDATE junket_return_money SET DAILY_SETTLEMENT = 2 
				 WHERE ACTIVE = 1 AND (DAILY_SETTLEMENT = 1 OR DAILY_SETTLEMENT IS NULL)`
			);
		}

		await connection.commit();
		connection.release();
		res.json({
			success: true,
			settlement_date: settlementDate,
			settlement_id: settlementId,
			expense_count: openExpenses.length,
			return_money_count: openReturnMoney.length,
			total_count: openExpenses.length + openReturnMoney.length
		});
	} catch (err) {
		if (connection) {
			try { await connection.rollback(); } catch (_) {}
			connection.release();
		}
		console.error('Error running expense daily settlement:', err);
		res.status(500).json({ error: 'Error running expense daily settlement' });
	}
});

// Export the router
module.exports = router; 