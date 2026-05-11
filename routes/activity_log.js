const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET Activity Logs for Agents, Guests, Transactions, Junket Expenses, Users, User Roles, and Bookings
router.get('/activity_logs', async (req, res) => {
	try {
		// Get date range parameters
		const fromDate = req.query.fromDate || null;
		const toDate = req.query.toDate || null;
		
		// Build date filter condition with parameterized query
		let dateFilter = '';
		let queryParams = [];
		const hasDateFilter = fromDate && toDate;
		if (hasDateFilter) {
			dateFilter = `WHERE logs.action_time >= ? AND logs.action_time <= ?`;
			queryParams = [fromDate, toDate];
		}
		
		// When date filter is applied, remove LIMIT to show all records (DataTables will handle pagination)
		// Otherwise, use the original limit logic
		const limitClause = hasDateFilter ? '' : (req.query.all === '1' ? 'LIMIT 10000' : 'LIMIT 5');
		
		const query = `
	  SELECT * FROM (
		-- AGENCY (added)
		(SELECT a.IDNo AS related_id, CONCAT('Agent ', COALESCE(a.AGENCY, '')) AS name, 'added' AS action_type, a.ENCODED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'agency' AS source_table
		  FROM agency a LEFT JOIN user_info u ON a.ENCODED_BY = u.IDNo WHERE a.ENCODED_DT IS NOT NULL)
		UNION ALL
		(SELECT a.IDNo AS related_id, CONCAT('Agent ', COALESCE(a.AGENCY, '')) AS name, 'edited' AS action_type, a.EDITED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'agency' AS source_table
		  FROM agency a LEFT JOIN user_info u ON a.EDITED_BY = u.IDNo WHERE a.EDITED_DT IS NOT NULL AND a.ACTIVE = 1)
		UNION ALL
		(SELECT a.IDNo AS related_id, CONCAT('Agent ', COALESCE(a.AGENCY, '')) AS name, 'deleted' AS action_type, a.EDITED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'agency' AS source_table
		  FROM agency a LEFT JOIN user_info u ON a.EDITED_BY = u.IDNo WHERE a.ACTIVE = 0 AND a.EDITED_DT IS NOT NULL)
		-- GUEST
		UNION ALL
		(SELECT ag.IDNo AS related_id, COALESCE(ag.NAME, '') AS name, 'added' AS action_type, ag.ENCODED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Guest' AS source_table
		  FROM agent ag LEFT JOIN user_info u ON ag.ENCODED_BY = u.IDNo WHERE ag.ENCODED_DT IS NOT NULL)
		UNION ALL
		(SELECT ag.IDNo AS related_id, COALESCE(ag.NAME, '') AS name, 'edited' AS action_type, ag.EDITED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Guest' AS source_table
		  FROM agent ag LEFT JOIN user_info u ON ag.EDITED_BY = u.IDNo WHERE ag.EDITED_DT IS NOT NULL AND ag.ACTIVE = 1)
		UNION ALL
		(SELECT ag.IDNo AS related_id, COALESCE(ag.NAME, '') AS name, 'deleted' AS action_type, ag.EDITED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Guest' AS source_table
		  FROM agent ag LEFT JOIN user_info u ON ag.EDITED_BY = u.IDNo WHERE ag.ACTIVE = 0 AND ag.EDITED_DT IS NOT NULL)
		-- TRANSACTION (Deposit, Withdraw, IOU, Transfer)
		UNION ALL
		(SELECT al.IDNo AS related_id,
		  CASE
		    WHEN al.TRANSFER = 1 AND al.TRANSACTION_ID = 2 THEN CONCAT('Transfer From: ', COALESCE(ag.AGENT_CODE,''), ' (', COALESCE(ag.NAME,''), ') - Transfer To: ', COALESCE(transfer_ag.AGENT_CODE,''), ' (', COALESCE(transfer_ag.NAME,''), ')')
		    WHEN al.TRANSFER = 1 AND al.TRANSACTION_ID = 1 THEN CONCAT('Transfer From: ', COALESCE(ag.AGENT_CODE,''), ' (', COALESCE(ag.NAME,''), ') - Transfer To: ', COALESCE(transfer_ag.AGENT_CODE,''), ' (', COALESCE(transfer_ag.NAME,''), ')')
		    WHEN al.TRANSACTION_ID = 1 THEN CONCAT('Deposit: ', COALESCE(ag.AGENT_CODE, ''), ' (', COALESCE(ag.NAME, 'Unknown Guest'), ')')
		    WHEN al.TRANSACTION_ID = 2 THEN CONCAT('Withdraw: ', COALESCE(ag.AGENT_CODE, ''), ' (', COALESCE(ag.NAME, 'Unknown Guest'), ')')
		    WHEN al.TRANSACTION_ID = 3 THEN CONCAT('IOU - ', COALESCE(ag.NAME, 'Unknown Guest'), ' was Successful!')
		    ELSE CONCAT('Unknown - ', COALESCE(ag.NAME, 'Unknown Guest'), ' was Successful!')
		  END AS name,
		  CASE WHEN al.TRANSFER = 1 THEN 'transfer' WHEN al.TRANSACTION_ID = 1 THEN 'deposit' WHEN al.TRANSACTION_ID = 2 THEN 'withdraw' ELSE 'transaction' END AS action_type, al.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name,
		  al.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount, COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Account Transaction' AS source_table
		  FROM account_ledger al
		  JOIN account acc ON al.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
		  LEFT JOIN account transfer_acc ON transfer_acc.IDNo = al.TRANSFER_AGENT AND al.TRANSFER = 1
		  LEFT JOIN agent transfer_ag ON transfer_acc.AGENT_ID = transfer_ag.IDNo
		  WHERE al.ACTIVE = 1 AND al.TRANSACTION_ID IN (1, 2, 3) AND (al.TRANSFER != 1 OR al.TRANSFER IS NULL)
		  AND ((al.TRANSACTION_ID IN (1, 2) AND al.TRANSACTION_DESC = 'ACCOUNT DETAILS') OR al.TRANSACTION_ID = 3))
		-- TRANSFER - Source Account Entry (only process TRANSACTION_ID = 2 to avoid duplicates)
		UNION ALL
		(SELECT al.IDNo AS related_id,
		  CONCAT('Transfer From: ', COALESCE(ag.AGENT_CODE,''), ' (', COALESCE(ag.NAME,''), ') - Transfer To: ', COALESCE(transfer_ag.AGENT_CODE,''), ' (', COALESCE(transfer_ag.NAME,''), ')') AS name,
		  'transfer' AS action_type, al.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name,
		  al.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount, COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Account Transaction' AS source_table
		  FROM account_ledger al
		  JOIN account acc ON al.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
		  LEFT JOIN account transfer_acc ON transfer_acc.IDNo = al.TRANSFER_AGENT AND al.TRANSFER = 1
		  LEFT JOIN agent transfer_ag ON transfer_acc.AGENT_ID = transfer_ag.IDNo
		  WHERE al.ACTIVE = 1 AND al.TRANSFER = 1 AND al.TRANSACTION_ID = 2)
		-- TRANSFER - Destination Account Entry (only process TRANSACTION_ID = 2 to avoid duplicates)
		UNION ALL
		(SELECT al.IDNo AS related_id,
		  CONCAT('Transfer To: ', COALESCE(transfer_ag.AGENT_CODE,''), ' (', COALESCE(transfer_ag.NAME,''), ') - Transfer From: ', COALESCE(ag.AGENT_CODE,''), ' (', COALESCE(ag.NAME,''), ')') AS name,
		  'transfer' AS action_type, al.ENCODED_DT AS action_time,
		  COALESCE(transfer_ag.NAME, '') AS guest_name, COALESCE(transfer_ag.AGENT_CODE, '') AS account_name,
		  al.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount, COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Account Transaction' AS source_table
		  FROM account_ledger al
		  JOIN account acc ON al.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
		  LEFT JOIN account transfer_acc ON transfer_acc.IDNo = al.TRANSFER_AGENT AND al.TRANSFER = 1
		  LEFT JOIN agent transfer_ag ON transfer_acc.AGENT_ID = transfer_ag.IDNo
		  WHERE al.ACTIVE = 1 AND al.TRANSFER = 1 AND al.TRANSACTION_ID = 2)
		-- CREDIT RETURN TRANSACTIONS
		UNION ALL
		(SELECT al.IDNo AS related_id,
		  CONCAT(
		    CASE 
		      WHEN al.TRANSACTION_ID = 1 AND al.TRANSACTION_TYPE = 4 THEN 'Chips return thru credit'
		      WHEN al.TRANSACTION_ID = 11 AND al.TRANSACTION_TYPE = 3 THEN 'Credit return thru cash'
		      WHEN al.TRANSACTION_ID = 12 AND al.TRANSACTION_TYPE = 3 THEN 'Credit return thru deposit'
		      ELSE 'Credit Return'
		    END, ': ', COALESCE(ag.AGENT_CODE, ''), ' (', COALESCE(ag.NAME, 'Unknown Guest'), ')') AS name,
		  'credit_return' AS action_type, al.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name,
		  al.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount, COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Credit Return' AS source_table
		  FROM account_ledger al
		  JOIN account acc ON al.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo
		  WHERE al.ACTIVE = 1 AND (
		    (al.TRANSACTION_ID = 1 AND al.TRANSACTION_TYPE = 4) OR
		    (al.TRANSACTION_ID = 11 AND al.TRANSACTION_TYPE = 3) OR
		    (al.TRANSACTION_ID = 12 AND al.TRANSACTION_TYPE = 3)
		  ))
		-- JUNKET EXPENSE
		UNION ALL
		(SELECT j.IDNo AS related_id, CONCAT(COALESCE(ec.CATEGORY, 'Expense'), IFNULL(CONCAT(': ', NULLIF(TRIM(j.RECEIPT_NO), '')), ''), ' - ', COALESCE(j.DESCRIPTION, '')) AS name, 'expense_added' AS action_type, j.ENCODED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, j.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Junket Expense' AS source_table
		  FROM junket_house_expense j LEFT JOIN expense_category ec ON j.CATEGORY_ID = ec.IDNo LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo WHERE j.ACTIVE = 1 AND j.ENCODED_DT IS NOT NULL)
		UNION ALL
		(SELECT j.IDNo AS related_id, CONCAT(COALESCE(ec.CATEGORY, 'Expense'), IFNULL(CONCAT(': ', NULLIF(TRIM(j.RECEIPT_NO), '')), ''), ' - ', COALESCE(j.DESCRIPTION, '')) AS name, 'expense_edited' AS action_type, j.EDITED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, j.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Junket Expense' AS source_table
		  FROM junket_house_expense j LEFT JOIN expense_category ec ON j.CATEGORY_ID = ec.IDNo LEFT JOIN user_info u ON j.EDITED_BY = u.IDNo WHERE j.ACTIVE = 1 AND j.EDITED_DT IS NOT NULL)
		-- USER
		UNION ALL
		(SELECT ui.IDNo AS related_id, CONCAT('New User: ', COALESCE(ui.FIRSTNAME,''), ' ', COALESCE(ui.LASTNAME,''), ' (', COALESCE(ui.USERNAME,''), ')') AS name, 'user_added' AS action_type, ui.ENCODED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'User' AS source_table
		  FROM user_info ui LEFT JOIN user_info u ON ui.ENCODED_BY = u.IDNo WHERE ui.ENCODED_DT IS NOT NULL)
		UNION ALL
		(SELECT ui.IDNo AS related_id, CONCAT('Edited User: ', COALESCE(ui.USERNAME,'')) AS name, 'user_edited' AS action_type, ui.EDITED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'User' AS source_table
		  FROM user_info ui LEFT JOIN user_info u ON ui.EDITED_BY = u.IDNo WHERE ui.EDITED_DT IS NOT NULL)
		-- BOOKING
		UNION ALL
		(SELECT b.IDNo AS related_id, CONCAT('Booking #', COALESCE(b.CONFIRM_NUM,''), ' - ', COALESCE(b.GUEST_NAME,'')) AS name, 'booking_added' AS action_type, b.BOOKING_DATE AS action_time,
		  NULL AS guest_name, NULL AS account_name, b.TOTAL_AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'booking' AS source_table
		  FROM booking b LEFT JOIN user_info u ON b.BOOKED_BY = u.IDNo WHERE b.BOOKING_DATE IS NOT NULL)
		-- GAME_LIST (new game - includes initial buy-in amount)
		UNION ALL
		(SELECT gl.IDNo AS related_id, CONCAT('New Game: #', gl.IDNo, ' (', COALESCE(gl.GAME_TYPE,''), ') - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), ''), ' - Buy-in: ₱', FORMAT(COALESCE(buyin.initial_buyin, 0), 0)) AS name, 'game_added' AS action_type, gl.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name, COALESCE(buyin.initial_buyin, 0) AS amount, COALESCE(buyin.nn_buyin, 0) AS nn_amount, COALESCE(buyin.cc_buyin, 0) AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Game' AS source_table
		  FROM game_list gl
		  JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON gl.ENCODED_BY = u.IDNo
		  LEFT JOIN (SELECT r1.GAME_ID, (r1.NN_CHIPS + r1.CC_CHIPS) AS initial_buyin, r1.NN_CHIPS AS nn_buyin, r1.CC_CHIPS AS cc_buyin
		    FROM game_record r1
		    WHERE r1.CAGE_TYPE = 1 AND r1.ACTIVE = 1
		    AND r1.IDNo = (SELECT MIN(r2.IDNo) FROM game_record r2 WHERE r2.GAME_ID = r1.GAME_ID AND r2.CAGE_TYPE = 1 AND r2.ACTIVE = 1)) buyin ON buyin.GAME_ID = gl.IDNo
		  WHERE gl.ENCODED_DT IS NOT NULL)
		-- GAME_RECORD (buy-in CAGE_TYPE 1 - excludes initial buy-in, shown in New Game)
		UNION ALL
		(SELECT gr.GAME_ID AS related_id, CONCAT('Buy-in - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), ''), ' (₱', FORMAT(COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0), 0), ')') AS name, 'game_buyin' AS action_type, gr.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name, (COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0)) AS amount, COALESCE(gr.NN_CHIPS,0) AS nn_amount, COALESCE(gr.CC_CHIPS,0) AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Game' AS source_table
		  FROM game_record gr
		  JOIN game_list gl ON gr.GAME_ID = gl.IDNo
		  JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo
		  WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 1 AND gr.ENCODED_DT IS NOT NULL
		  AND gr.IDNo != (SELECT MIN(r.IDNo) FROM game_record r WHERE r.GAME_ID = gr.GAME_ID AND r.CAGE_TYPE = 1 AND r.ACTIVE = 1))
		-- GAME_RECORD (cash-out CAGE_TYPE 2)
		UNION ALL
		(SELECT gr.GAME_ID AS related_id, CONCAT('Cash Out - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), ''), ' (₱', FORMAT(COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0), 0), ')') AS name, 'game_cashout' AS action_type, gr.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name, (COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0)) AS amount, COALESCE(gr.NN_CHIPS,0) AS nn_amount, COALESCE(gr.CC_CHIPS,0) AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Game' AS source_table
		  FROM game_record gr
		  JOIN game_list gl ON gr.GAME_ID = gl.IDNo
		  JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo
		  WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 2 AND gr.ENCODED_DT IS NOT NULL)
		-- GAME_RECORD (rolling CAGE_TYPE 4 only - CAGE_TYPE 3 is same as Buy-in)
		UNION ALL
		(SELECT gr.GAME_ID AS related_id, CONCAT('Rolling - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), ''), ' (₱', FORMAT(COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0), 0), ')') AS name, 'game_rolling' AS action_type, gr.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name, (COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0)) AS amount, COALESCE(gr.NN_CHIPS,0) AS nn_amount, COALESCE(gr.CC_CHIPS,0) AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Game' AS source_table
		  FROM game_record gr
		  JOIN game_list gl ON gr.GAME_ID = gl.IDNo
		  JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo
		  WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 4 AND gr.ENCODED_DT IS NOT NULL)
		-- GAME_RECORD (roller chips CAGE_TYPE 5 - ROLLER_TRANSACTION 1=Add, 2=Return)
		UNION ALL
		(SELECT gr.GAME_ID AS related_id, CONCAT('Roller Chips - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), '')) AS name, 'roller_add' AS action_type, gr.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name, (COALESCE(gr.ROLLER_NN_CHIPS,0) + COALESCE(gr.ROLLER_CC_CHIPS,0)) AS amount, COALESCE(gr.ROLLER_NN_CHIPS,0) AS nn_amount, COALESCE(gr.ROLLER_CC_CHIPS,0) AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Game' AS source_table
		  FROM game_record gr
		  JOIN game_list gl ON gr.GAME_ID = gl.IDNo
		  JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo
		  WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 5 AND gr.ROLLER_TRANSACTION = 1 AND gr.ENCODED_DT IS NOT NULL)
		UNION ALL
		(SELECT gr.GAME_ID AS related_id, CONCAT('Roller Chips - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), '')) AS name, 'roller_return' AS action_type, gr.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, COALESCE(ag.AGENT_CODE, '') AS account_name, (COALESCE(gr.ROLLER_NN_CHIPS,0) + COALESCE(gr.ROLLER_CC_CHIPS,0)) AS amount, COALESCE(gr.ROLLER_NN_CHIPS,0) AS nn_amount, COALESCE(gr.ROLLER_CC_CHIPS,0) AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Game' AS source_table
		  FROM game_record gr
		  JOIN game_list gl ON gr.GAME_ID = gl.IDNo
		  JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo
		  LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo
		  WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 5 AND gr.ROLLER_TRANSACTION = 2 AND gr.ENCODED_DT IS NOT NULL)
		-- GAME_SERVICES (fnb, hotel, delivery)
		UNION ALL
		(SELECT COALESCE(gs.GAME_ID, -1) AS related_id, CONCAT(COALESCE(gs.SERVICE_TYPE,''), ' - ', COALESCE(ag.NAME,''), IF(gs.GAME_ID IS NOT NULL AND gs.GAME_ID > 0, CONCAT(' (Game #', gs.GAME_ID, ')'), CONCAT(' (', COALESCE(gs.SOURCE_TYPE, 'GUEST'), ')')), ' - ', COALESCE(gs.REMARKS,''), ' (₱', FORMAT(COALESCE(gs.AMOUNT,0), 0), ')') AS name, 'service_added' AS action_type, gs.ENCODED_DT AS action_time,
		  COALESCE(ag.NAME, '') AS guest_name, '' AS account_name, gs.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Services' AS source_table
		  FROM game_services gs
		  LEFT JOIN agent ag ON gs.AGENT_ID = ag.IDNo
		  LEFT JOIN user_info u ON gs.ENCODED_BY = u.IDNo
		  WHERE gs.ACTIVE = 1 AND gs.ENCODED_DT IS NOT NULL)
		-- JUNKET_TOTAL_CHIPS (chips buy-in, cashout, rolling)
		UNION ALL
		(SELECT j.IDNo AS related_id, CONCAT(CASE j.TRANSACTION_ID WHEN 1 THEN 'Buy-in' WHEN 2 THEN 'Cash-out' WHEN 3 THEN 'Rolling' ELSE 'Other' END, ': ₱', FORMAT(COALESCE(j.TOTAL_CHIPS,0), 0)) AS name, 'junket_chips_added' AS action_type, j.ENCODED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, j.TOTAL_CHIPS AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Junket Total Chips' AS source_table
		  FROM junket_total_chips j
		  LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo
		  WHERE j.ACTIVE = 1 AND j.ENCODED_DT IS NOT NULL)
		-- JUNKET_RETURN_MONEY (add)
		UNION ALL
		(SELECT rm.IDNo AS related_id, COALESCE(rm.DESCRIPTION,'') COLLATE utf8mb4_unicode_ci AS name, 'return_added' COLLATE utf8mb4_unicode_ci AS action_type, rm.ENCODED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, rm.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') COLLATE utf8mb4_unicode_ci AS encoded_by_name, 'Junket Return Money' COLLATE utf8mb4_unicode_ci AS source_table
		  FROM junket_return_money rm
		  LEFT JOIN user_info u ON rm.ENCODED_BY = u.IDNo
		  WHERE rm.ACTIVE = 1 AND rm.ENCODED_DT IS NOT NULL)
		-- JUNKET_RETURN_MONEY (edit)
		UNION ALL
		(SELECT rm.IDNo AS related_id, COALESCE(rm.DESCRIPTION,'') COLLATE utf8mb4_unicode_ci AS name, 'return_edited' COLLATE utf8mb4_unicode_ci AS action_type, rm.EDITED_DT AS action_time,
		  NULL AS guest_name, NULL AS account_name, rm.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') COLLATE utf8mb4_unicode_ci AS encoded_by_name, 'Junket Return Money' COLLATE utf8mb4_unicode_ci AS source_table
		  FROM junket_return_money rm
		  LEFT JOIN user_info u ON rm.EDITED_BY = u.IDNo
		  WHERE rm.ACTIVE = 1 AND rm.EDITED_DT IS NOT NULL)
		-- JUNKET_CAPITAL (add)
		UNION ALL
		(SELECT jc.IDNo AS related_id, CONCAT(CONCAT_WS(' - ', CASE jc.TRANSACTION_ID WHEN 1 THEN 'Cash-in' WHEN 2 THEN 'Cash-out' ELSE 'Capital' END, NULLIF(TRIM(COALESCE(jc.REMARKS,'')), '')), ' (₱', FORMAT(COALESCE(jc.AMOUNT,0), 0), ')') COLLATE utf8mb4_unicode_ci AS name, 'capital_added' COLLATE utf8mb4_unicode_ci AS action_type, jc.ENCODED_DT AS action_time,
		  COALESCE(jc.FULLNAME, '') COLLATE utf8mb4_unicode_ci AS guest_name, '' COLLATE utf8mb4_unicode_ci AS account_name, jc.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') COLLATE utf8mb4_unicode_ci AS encoded_by_name, 'Junket Capital' COLLATE utf8mb4_unicode_ci AS source_table
		  FROM junket_capital jc
		  LEFT JOIN user_info u ON jc.ENCODED_BY = u.IDNo
		  WHERE jc.ACTIVE = 1 AND jc.ENCODED_DT IS NOT NULL)
		-- JUNKET_CAPITAL (edit)
		UNION ALL
		(SELECT jc.IDNo AS related_id, CONCAT(CONCAT_WS(' - ', CASE jc.TRANSACTION_ID WHEN 1 THEN 'Cash-in' WHEN 2 THEN 'Cash-out' ELSE 'Capital' END, NULLIF(TRIM(COALESCE(jc.REMARKS,'')), '')), ' (₱', FORMAT(COALESCE(jc.AMOUNT,0), 0), ')') COLLATE utf8mb4_unicode_ci AS name, 'capital_edited' COLLATE utf8mb4_unicode_ci AS action_type, jc.EDITED_DT AS action_time,
		  COALESCE(jc.FULLNAME, '') COLLATE utf8mb4_unicode_ci AS guest_name, '' COLLATE utf8mb4_unicode_ci AS account_name, jc.AMOUNT AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') COLLATE utf8mb4_unicode_ci AS encoded_by_name, 'Junket Capital' COLLATE utf8mb4_unicode_ci AS source_table
		  FROM junket_capital jc
		  LEFT JOIN user_info u ON jc.EDITED_BY = u.IDNo
		  WHERE jc.ACTIVE = 1 AND jc.EDITED_DT IS NOT NULL)
		-- DAILY_SETTLEMENT (one row per settlement run; games listed in daily_settlement_games)
		UNION ALL
		(SELECT ds.IDNo AS related_id, CONCAT('Daily Settlement: ', DATE_FORMAT(ds.SETTLEMENT_DATE, '%M %e, %Y')) AS name, 'settlement_added' AS action_type, ds.RUN_AT AS action_time,
		  NULL AS guest_name, NULL AS account_name, NULL AS amount, NULL AS nn_amount, NULL AS cc_amount,
		  COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'Daily Settlement' AS source_table
		  FROM daily_settlement ds
		  LEFT JOIN user_info u ON ds.ENCODED_BY = u.IDNo
		  WHERE ds.ACTIVE = 1 AND ds.RUN_AT IS NOT NULL)
	  ) AS logs
	  ${dateFilter}
	  ORDER BY logs.action_time DESC
	  ${limitClause};
	`;
  
	  let results;
	  try {
	    const [rows] = await pool.query(query, queryParams);
	    results = rows;
	  } catch (queryError) {
	    const errMsg = queryError.sqlMessage || queryError.message || String(queryError);
	    console.warn("🔥 Activity logs main query failed:", errMsg, "- retrying without junket_return_money/junket_capital");
	    try {
	      const fallbackLimitClause = hasDateFilter ? '' : (req.query.all === '1' ? 'LIMIT 10000' : 'LIMIT 5');
	      const fallbackQueryParams = hasDateFilter ? [fromDate, toDate] : [];
	      const fallbackQuery = `
	        SELECT * FROM (
		  (SELECT a.IDNo AS related_id, CONCAT('Agent ', COALESCE(a.AGENCY, '')) AS name, 'added' AS action_type, a.ENCODED_DT AS action_time, NULL AS guest_name, NULL AS account_name, NULL AS amount, COALESCE(u.FIRSTNAME, 'N/A') AS encoded_by_name, 'agency' AS source_table FROM agency a LEFT JOIN user_info u ON a.ENCODED_BY = u.IDNo WHERE a.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT a.IDNo, CONCAT('Agent ', COALESCE(a.AGENCY, '')), 'edited', a.EDITED_DT, NULL, NULL, NULL, COALESCE(u.FIRSTNAME, 'N/A'), 'agency' FROM agency a LEFT JOIN user_info u ON a.EDITED_BY = u.IDNo WHERE a.EDITED_DT IS NOT NULL AND a.ACTIVE = 1)
		  UNION ALL (SELECT a.IDNo, CONCAT('Agent ', COALESCE(a.AGENCY, '')), 'deleted', a.EDITED_DT, NULL, NULL, NULL, COALESCE(u.FIRSTNAME, 'N/A'), 'agency' FROM agency a LEFT JOIN user_info u ON a.EDITED_BY = u.IDNo WHERE a.ACTIVE = 0 AND a.EDITED_DT IS NOT NULL)
		  UNION ALL (SELECT ag.IDNo, COALESCE(ag.NAME, ''), 'added', ag.ENCODED_DT, NULL, NULL, NULL, NULL, NULL, COALESCE(u.FIRSTNAME, 'N/A'), 'Guest' FROM agent ag LEFT JOIN user_info u ON ag.ENCODED_BY = u.IDNo WHERE ag.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT ag.IDNo, COALESCE(ag.NAME, ''), 'edited', ag.EDITED_DT, NULL, NULL, NULL, NULL, NULL, COALESCE(u.FIRSTNAME, 'N/A'), 'Guest' FROM agent ag LEFT JOIN user_info u ON ag.EDITED_BY = u.IDNo WHERE ag.EDITED_DT IS NOT NULL AND ag.ACTIVE = 1)
		  UNION ALL (SELECT ag.IDNo, COALESCE(ag.NAME, ''), 'deleted', ag.EDITED_DT, NULL, NULL, NULL, NULL, NULL, COALESCE(u.FIRSTNAME, 'N/A'), 'Guest' FROM agent ag LEFT JOIN user_info u ON ag.EDITED_BY = u.IDNo WHERE ag.ACTIVE = 0 AND ag.EDITED_DT IS NOT NULL)
		  UNION ALL (SELECT al.IDNo, CASE WHEN al.TRANSACTION_ID = 1 THEN CONCAT('Deposit: ', COALESCE(ag.AGENT_CODE, ''), ' (', COALESCE(ag.NAME, 'Unknown Guest'), ')') WHEN al.TRANSACTION_ID = 2 THEN CONCAT('Withdraw: ', COALESCE(ag.AGENT_CODE, ''), ' (', COALESCE(ag.NAME, 'Unknown Guest'), ')') WHEN al.TRANSACTION_ID = 3 THEN CONCAT('IOU - ', COALESCE(ag.NAME, 'Unknown Guest'), ' was Successful!') ELSE CONCAT('Unknown - ', COALESCE(ag.NAME, 'Unknown Guest'), ' was Successful!') END, CASE WHEN al.TRANSACTION_ID = 1 THEN 'deposit' WHEN al.TRANSACTION_ID = 2 THEN 'withdraw' ELSE 'transaction' END, al.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), al.AMOUNT, COALESCE(u.FIRSTNAME, 'N/A'), 'Account Transaction' FROM account_ledger al JOIN account acc ON al.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo LEFT JOIN account transfer_acc ON transfer_acc.IDNo = al.TRANSFER_AGENT AND al.TRANSFER = 1 LEFT JOIN agent transfer_ag ON transfer_acc.AGENT_ID = transfer_ag.IDNo WHERE al.ACTIVE = 1 AND al.TRANSACTION_ID IN (1, 2, 3) AND (al.TRANSFER != 1 OR al.TRANSFER IS NULL) AND ((al.TRANSACTION_ID IN (1, 2) AND al.TRANSACTION_DESC = 'ACCOUNT DETAILS') OR al.TRANSACTION_ID = 3))
		  UNION ALL (SELECT al.IDNo, CONCAT('Transfer From: ', COALESCE(ag.AGENT_CODE,''), ' (', COALESCE(ag.NAME,''), ') - Transfer To: ', COALESCE(transfer_ag.AGENT_CODE,''), ' (', COALESCE(transfer_ag.NAME,''), ')'), 'transfer', al.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), al.AMOUNT, COALESCE(u.FIRSTNAME, 'N/A'), 'Account Transaction' FROM account_ledger al JOIN account acc ON al.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo LEFT JOIN account transfer_acc ON transfer_acc.IDNo = al.TRANSFER_AGENT AND al.TRANSFER = 1 LEFT JOIN agent transfer_ag ON transfer_acc.AGENT_ID = transfer_ag.IDNo WHERE al.ACTIVE = 1 AND al.TRANSFER = 1 AND al.TRANSACTION_ID = 2)
		  UNION ALL (SELECT al.IDNo, CONCAT('Transfer To: ', COALESCE(transfer_ag.AGENT_CODE,''), ' (', COALESCE(transfer_ag.NAME,''), ') - Transfer From: ', COALESCE(ag.AGENT_CODE,''), ' (', COALESCE(ag.NAME,''), ')'), 'transfer', al.ENCODED_DT, COALESCE(transfer_ag.NAME, ''), COALESCE(transfer_ag.AGENT_CODE, ''), al.AMOUNT, COALESCE(u.FIRSTNAME, 'N/A'), 'Account Transaction' FROM account_ledger al JOIN account acc ON al.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo LEFT JOIN account transfer_acc ON transfer_acc.IDNo = al.TRANSFER_AGENT AND al.TRANSFER = 1 LEFT JOIN agent transfer_ag ON transfer_acc.AGENT_ID = transfer_ag.IDNo WHERE al.ACTIVE = 1 AND al.TRANSFER = 1 AND al.TRANSACTION_ID = 2)
		  UNION ALL (SELECT al.IDNo, CONCAT(CASE WHEN al.TRANSACTION_ID = 1 AND al.TRANSACTION_TYPE = 4 THEN 'Chips return thru credit' WHEN al.TRANSACTION_ID = 11 AND al.TRANSACTION_TYPE = 3 THEN 'Credit return thru cash' WHEN al.TRANSACTION_ID = 12 AND al.TRANSACTION_TYPE = 3 THEN 'Credit return thru deposit' ELSE 'Credit Return' END, ': ', COALESCE(ag.AGENT_CODE, ''), ' (', COALESCE(ag.NAME, 'Unknown Guest'), ')'), 'credit_return', al.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), al.AMOUNT, COALESCE(u.FIRSTNAME, 'N/A'), 'Credit Return' FROM account_ledger al JOIN account acc ON al.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON al.ENCODED_BY = u.IDNo WHERE al.ACTIVE = 1 AND ((al.TRANSACTION_ID = 1 AND al.TRANSACTION_TYPE = 4) OR (al.TRANSACTION_ID = 11 AND al.TRANSACTION_TYPE = 3) OR (al.TRANSACTION_ID = 12 AND al.TRANSACTION_TYPE = 3)))
		  UNION ALL (SELECT j.IDNo, CONCAT(COALESCE(ec.CATEGORY, 'Expense'), IFNULL(CONCAT(': ', NULLIF(TRIM(j.RECEIPT_NO), '')), ''), ' - ', COALESCE(j.DESCRIPTION, '')), 'expense_added', j.ENCODED_DT, NULL, NULL, j.AMOUNT, COALESCE(u.FIRSTNAME, 'N/A'), 'Junket Expense' FROM junket_house_expense j LEFT JOIN expense_category ec ON j.CATEGORY_ID = ec.IDNo LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo WHERE j.ACTIVE = 1 AND j.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT j.IDNo, CONCAT(COALESCE(ec.CATEGORY, 'Expense'), IFNULL(CONCAT(': , NULLIF(TRIM(j.RECEIPT_NO), '')), ''), ' - ', COALESCE(j.DESCRIPTION, '')), 'expense_edited', j.EDITED_DT, NULL, NULL, j.AMOUNT, COALESCE(u.FIRSTNAME, 'N/A'), 'Junket Expense' FROM junket_house_expense j LEFT JOIN expense_category ec ON j.CATEGORY_ID = ec.IDNo LEFT JOIN user_info u ON j.EDITED_BY = u.IDNo WHERE j.ACTIVE = 1 AND j.EDITED_DT IS NOT NULL)
		  UNION ALL (SELECT ui.IDNo, CONCAT('New User: ', COALESCE(ui.FIRSTNAME,''), ' ', COALESCE(ui.LASTNAME,''), ' (', COALESCE(ui.USERNAME,''), ')'), 'user_added', ui.ENCODED_DT, NULL, NULL, NULL, COALESCE(u.FIRSTNAME, 'N/A'), 'User' FROM user_info ui LEFT JOIN user_info u ON ui.ENCODED_BY = u.IDNo WHERE ui.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT ui.IDNo, CONCAT('Edited User: ', COALESCE(ui.USERNAME,'')), 'user_edited', ui.EDITED_DT, NULL, NULL, NULL, COALESCE(u.FIRSTNAME, 'N/A'), 'User' FROM user_info ui LEFT JOIN user_info u ON ui.EDITED_BY = u.IDNo WHERE ui.EDITED_DT IS NOT NULL)
		  UNION ALL (SELECT b.IDNo, CONCAT('Booking #', COALESCE(b.CONFIRM_NUM,''), ' - ', COALESCE(b.GUEST_NAME,'')), 'booking_added', b.BOOKING_DATE, NULL, NULL, b.TOTAL_AMOUNT, COALESCE(u.FIRSTNAME, 'N/A'), 'booking' FROM booking b LEFT JOIN user_info u ON b.BOOKED_BY = u.IDNo WHERE b.BOOKING_DATE IS NOT NULL)
		  UNION ALL (SELECT gl.IDNo, CONCAT('New Game: #', gl.IDNo, ' (', COALESCE(gl.GAME_TYPE,''), ') - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), ''), ' - Buy-in: ₱', FORMAT(COALESCE(buyin.initial_buyin, 0), 0)), 'game_added', gl.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), COALESCE(buyin.initial_buyin, 0), COALESCE(buyin.nn_buyin, 0), COALESCE(buyin.cc_buyin, 0), COALESCE(u.FIRSTNAME, 'N/A'), 'Game' FROM game_list gl JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON gl.ENCODED_BY = u.IDNo LEFT JOIN (SELECT r1.GAME_ID, (r1.NN_CHIPS + r1.CC_CHIPS) AS initial_buyin, r1.NN_CHIPS AS nn_buyin, r1.CC_CHIPS AS cc_buyin FROM game_record r1 WHERE r1.CAGE_TYPE = 1 AND r1.ACTIVE = 1 AND r1.IDNo = (SELECT MIN(r2.IDNo) FROM game_record r2 WHERE r2.GAME_ID = r1.GAME_ID AND r2.CAGE_TYPE = 1 AND r2.ACTIVE = 1)) buyin ON buyin.GAME_ID = gl.IDNo WHERE gl.ENCODED_DT IS NOT NULL AND (gl.ACTIVE IS NULL OR gl.ACTIVE NOT IN (1, 3)))
		  UNION ALL (SELECT gr.GAME_ID, CONCAT('Buy-in - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), ''), ' (₱', FORMAT(COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0), 0), ')'), 'game_buyin', gr.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), (COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0)), COALESCE(u.FIRSTNAME, 'N/A'), 'Game' FROM game_record gr JOIN game_list gl ON gr.GAME_ID = gl.IDNo JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 1 AND gr.ENCODED_DT IS NOT NULL AND gr.IDNo != (SELECT MIN(r.IDNo) FROM game_record r WHERE r.GAME_ID = gr.GAME_ID AND r.CAGE_TYPE = 1 AND r.ACTIVE = 1))
		  UNION ALL (SELECT gr.GAME_ID, CONCAT('Cash Out - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), ''), ' (₱', FORMAT(COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0), 0), ')'), 'game_cashout', gr.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), (COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0)), COALESCE(u.FIRSTNAME, 'N/A'), 'Game' FROM game_record gr JOIN game_list gl ON gr.GAME_ID = gl.IDNo JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 2 AND gr.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT gr.GAME_ID, CONCAT('Rolling - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), ''), ' (₱', FORMAT(COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0), 0), ')'), 'game_rolling', gr.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), (COALESCE(gr.NN_CHIPS,0) + COALESCE(gr.CC_CHIPS,0)), COALESCE(u.FIRSTNAME, 'N/A'), 'Game' FROM game_record gr JOIN game_list gl ON gr.GAME_ID = gl.IDNo JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 4 AND gr.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT gr.GAME_ID, CONCAT('Roller Chips - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), '')), 'roller_add', gr.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), (COALESCE(gr.ROLLER_NN_CHIPS,0) + COALESCE(gr.ROLLER_CC_CHIPS,0)), COALESCE(u.FIRSTNAME, 'N/A'), 'Game' FROM game_record gr JOIN game_list gl ON gr.GAME_ID = gl.IDNo JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 5 AND gr.ROLLER_TRANSACTION = 1 AND gr.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT gr.GAME_ID, CONCAT('Roller Chips - Game #', gl.IDNo, ' - ', COALESCE(ag.AGENT_CODE,''), IFNULL(CONCAT(' (', NULLIF(TRIM(ag.NAME), ''), ')'), '')), 'roller_return', gr.ENCODED_DT, COALESCE(ag.NAME, ''), COALESCE(ag.AGENT_CODE, ''), (COALESCE(gr.ROLLER_NN_CHIPS,0) + COALESCE(gr.ROLLER_CC_CHIPS,0)), COALESCE(u.FIRSTNAME, 'N/A'), 'Game' FROM game_record gr JOIN game_list gl ON gr.GAME_ID = gl.IDNo JOIN account acc ON gl.ACCOUNT_ID = acc.IDNo LEFT JOIN agent ag ON acc.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON gr.ENCODED_BY = u.IDNo WHERE gr.ACTIVE = 1 AND gr.CAGE_TYPE = 5 AND gr.ROLLER_TRANSACTION = 2 AND gr.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT COALESCE(gs.GAME_ID, -1), CONCAT(COALESCE(gs.SERVICE_TYPE,''), ' - ', COALESCE(ag.NAME,''), IF(gs.GAME_ID IS NOT NULL AND gs.GAME_ID > 0, CONCAT(' (Game #', gs.GAME_ID, ')'), CONCAT(' (', COALESCE(gs.SOURCE_TYPE, 'GUEST'), ')')), ' - ', COALESCE(gs.REMARKS,''), ' (₱', FORMAT(COALESCE(gs.AMOUNT,0), 0), ')'), 'service_added', gs.ENCODED_DT, COALESCE(ag.NAME, ''), '', gs.AMOUNT, COALESCE(u.FIRSTNAME, 'N/A'), 'Services' FROM game_services gs LEFT JOIN agent ag ON gs.AGENT_ID = ag.IDNo LEFT JOIN user_info u ON gs.ENCODED_BY = u.IDNo WHERE gs.ACTIVE = 1 AND gs.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT j.IDNo, CONCAT(CASE j.TRANSACTION_ID WHEN 1 THEN 'Buy-in' WHEN 2 THEN 'Cash-out' WHEN 3 THEN 'Rolling' ELSE 'Other' END, ': ₱', FORMAT(COALESCE(j.TOTAL_CHIPS,0), 0)), 'junket_chips_added', j.ENCODED_DT, NULL, NULL, j.TOTAL_CHIPS, COALESCE(u.FIRSTNAME, 'N/A'), 'Junket Total Chips' FROM junket_total_chips j LEFT JOIN user_info u ON j.ENCODED_BY = u.IDNo WHERE j.ACTIVE = 1 AND j.ENCODED_DT IS NOT NULL)
		  UNION ALL (SELECT ds.IDNo, CONCAT('Daily Settlement: ', DATE_FORMAT(ds.SETTLEMENT_DATE, '%M %e, %Y')), 'settlement_added', ds.RUN_AT, NULL, NULL, NULL, NULL, NULL, COALESCE(u.FIRSTNAME, 'N/A'), 'Daily Settlement' FROM daily_settlement ds LEFT JOIN user_info u ON ds.ENCODED_BY = u.IDNo WHERE ds.ACTIVE = 1 AND ds.RUN_AT IS NOT NULL)
		) AS logs ${dateFilter} ORDER BY logs.action_time DESC ${fallbackLimitClause}`;
	      const [rows] = await pool.query(fallbackQuery, fallbackQueryParams);
	      results = rows;
	    } catch (fallbackErr) {
	      throw queryError;
	    }
	  }
	  res.json(results);
	} catch (error) {
	  console.error("🔥 ERROR fetching activity logs:", error);
	  console.error("🔥 SQL Message:", error.sqlMessage);
	  if (!res.headersSent) {
		res.status(500).json({ message: "Server Error", error: error.sqlMessage || error.message });
	  }
	}
});

module.exports = router;
