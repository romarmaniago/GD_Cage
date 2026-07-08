const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { buildTableExportXlsx, sendTableExportResponse } = require('../utils/ExcelExportService');
const { sendTelegramMessage, sendTelegramToAdditionalChats } = require('../utils/telegram');
const { getAgentTelegramChatId } = require('../utils/agentTelegram');

const validTransactionIds = [1, 2, 3];
const validSourceTypes = ['JUNKET', 'GUEST'];

const LEGACY_SERVICE_TYPE_TO_CATEGORY = {
	fnb: 'F & B',
	hotel: 'Hotel',
	delivery: 'Delivery'
};

async function resolveActiveServiceCategory(serviceType) {
	const raw = (serviceType || '').trim();
	if (!raw) return null;

	const [rows] = await pool.execute(
		'SELECT CATEGORY FROM services_category WHERE ACTIVE = 1 AND LOWER(TRIM(CATEGORY)) = LOWER(TRIM(?)) LIMIT 1',
		[raw]
	);
	if (rows.length) return rows[0].CATEGORY;

	const legacyName = LEGACY_SERVICE_TYPE_TO_CATEGORY[raw.toLowerCase()];
	if (!legacyName) return null;

	const [legacyRows] = await pool.execute(
		'SELECT CATEGORY FROM services_category WHERE ACTIVE = 1 AND LOWER(TRIM(CATEGORY)) = LOWER(TRIM(?)) LIMIT 1',
		[legacyName]
	);
	return legacyRows[0]?.CATEGORY || null;
}

/** Client omits ENCODED BY (index 7) and ACTION (last column). */
router.post('/fnb-hotel/export_xlsx', checkSession, async function (req, res) {
	try {
		const { headers, rows, filename } = req.body || {};
		const result = await buildTableExportXlsx({
			profileKey: 'fnbHotel',
			sheetName: 'F&B Hotel',
			headers,
			rows,
			filename: filename || 'FnbHotel-export.xlsx'
		});
		return sendTableExportResponse(res, result);
	} catch (err) {
		if (err.status === 400) return res.status(400).json({ error: err.message });
		console.error('fnb-hotel/export_xlsx:', err);
		return res.status(500).json({ error: 'Export failed' });
	}
});

router.get('/fnb-hotel', checkSession, async (req, res) => {
		const permissions = req.session.permissions;

		try {
			const [gameServices] = await pool.query(`
				SELECT 
					gs.IDNo,
					agent.NAME AS agent_name,
					gs.GAME_ID,
					gs.SERVICE_TYPE,
					gs.SOURCE_TYPE,
					gs.AMOUNT,
					gs.REMARKS,
					gs.ENCODED_BY,
					gs.TRANSACTION_ID,
					gs.AGENT_ID,
					user_info.FIRSTNAME AS encoded_by_name,
					gs.ENCODED_DT,
					game_list.SETTLED AS game_settled
				FROM game_services gs
				LEFT JOIN agent ON agent.IDNo = gs.AGENT_ID
				LEFT JOIN user_info ON user_info.IDNo = gs.ENCODED_BY
				LEFT JOIN game_list ON game_list.IDNo = gs.GAME_ID
				WHERE gs.ACTIVE = 1
				ORDER BY gs.ENCODED_DT DESC
			`);

			res.render('junket/fnb_hotel', {
				...sessions(req, 'fnb-hotel'),
				permissions,
				gameServices
			});
		} catch (err) {
			console.error('Error loading F&B / Hotel data:', err);
			res.status(500).send('Internal Server Error');
		}
	});

	// JSON endpoint for reloading F&B / Hotel table data (used by DataTables)
	router.get('/fnb-hotel/data', checkSession, async (req, res) => {
		try {
			const [rows] = await pool.query(`
				SELECT 
					gs.IDNo,
					agent.NAME AS agent_name,
					gs.GAME_ID,
					gs.SERVICE_TYPE,
					gs.SOURCE_TYPE,
					gs.AMOUNT,
					gs.REMARKS,
					gs.ENCODED_BY,
					gs.TRANSACTION_ID,
					gs.AGENT_ID,
					user_info.FIRSTNAME AS encoded_by_name,
					gs.ENCODED_DT,
					game_list.SETTLED AS game_settled
				FROM game_services gs
				LEFT JOIN agent ON agent.IDNo = gs.AGENT_ID
				LEFT JOIN user_info ON user_info.IDNo = gs.ENCODED_BY
				LEFT JOIN game_list ON game_list.IDNo = gs.GAME_ID
				WHERE gs.ACTIVE = 1
				ORDER BY gs.ENCODED_DT DESC
			`);

			res.json(rows);
		} catch (err) {
			console.error('Error loading F&B / Hotel data (JSON):', err);
			res.status(500).json({ error: 'Failed to load F&B / Hotel data.' });
		}
	});

	router.get('/fnb-hotel/accounts', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.query(`
			SELECT 
				a.IDNo AS account_id,
				a.AGENT_ID AS agent_id,
				agent.NAME AS agent_name,
				agent.AGENT_CODE AS agent_code,
					(
						SELECT IFNULL(SUM(CASE 
							WHEN TRANSACTION_ID = 2 THEN AMOUNT 
							WHEN TRANSACTION_ID = 1 THEN -AMOUNT 
							ELSE 0 
						END), 0)
						FROM account_ledger al
						WHERE al.ACTIVE = 1 AND al.ACCOUNT_ID = a.IDNo
					) AS balance
			FROM account a
			LEFT JOIN agent ON agent.IDNo = a.AGENT_ID
			WHERE a.ACTIVE = 1
			ORDER BY agent.NAME ASC, a.IDNo DESC
		`);

		res.json(rows);
	} catch (err) {
		console.error('Error fetching F&B / Hotel accounts list:', err);
		res.status(500).json({ error: 'Failed to load accounts.' });
	}
});

router.post('/fnb-hotel/service', checkSession, async (req, res) => {
	try {
		const {
			account_id,
			agent_id,
			service_type,
			amount,
			remarks,
			transaction_id,
			game_id,
			source_type
		} = req.body;

		const parsedAccountId = parseInt(account_id, 10);
		const parsedAgentId = parseInt(agent_id, 10);
		const parsedGameId = parseInt(game_id, 10);
		const parsedTransactionId = parseInt(transaction_id, 10);
		const amt = parseFloat((amount || '0').toString().replace(/,/g, '')) || 0;
		const sourceType = (source_type || '').toString().trim().toUpperCase();
		const resolvedCategory = await resolveActiveServiceCategory(service_type);

		if (!resolvedCategory || !validTransactionIds.includes(parsedTransactionId) || !validSourceTypes.includes(sourceType)) {
			return res.status(400).json({ error: 'Invalid input' });
		}
		if (!parsedAccountId) {
			return res.status(400).json({ error: 'Account is required' });
		}

		const resolvedGameId = Number.isNaN(parsedGameId) ? null : parsedGameId;
		const resolvedAgentId = !Number.isNaN(parsedAgentId) ? parsedAgentId : null;
		if (resolvedAgentId === null) {
			return res.status(400).json({ error: 'Invalid account/agent' });
		}

		const encodedBy = req.session?.user_id || null;
		const now = new Date();

		const [insertResult] = await pool.execute(
			`INSERT INTO game_services (GAME_ID, SERVICE_TYPE, AMOUNT, REMARKS, TRANSACTION_ID, AGENT_ID, SOURCE_TYPE, ACTIVE, ENCODED_BY, ENCODED_DT)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			[resolvedGameId || null, resolvedCategory, amt, remarks || '', parsedTransactionId, resolvedAgentId, sourceType, encodedBy, now]
		);

		if (parsedTransactionId === 1 || parsedTransactionId === 2) {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;
			const cashType = sourceType === 'GUEST' ? 1 : 2;

			await pool.execute(cashTransactionQuery, [
				insertResult.insertId,
				resolvedAgentId,
				amt.toString(),
				resolvedCategory,
				cashType,
				remarks || '',
				encodedBy,
				now
			]);
		}

		if (parsedTransactionId === 2 && parsedAccountId) {
			await pool.execute(
				`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
				 VALUES (?, ?, 2, 2, 'SERVICES', ?, ?, ?)`,
				[parsedAccountId, resolvedGameId, amt, encodedBy, now]
			);

			if (sourceType === 'GUEST') {
				try {
					const [accountRows] = await pool.execute(
						`SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID,
						        COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
						 FROM account
						 JOIN agent ON agent.IDNo = account.AGENT_ID
						 WHERE account.ACTIVE = 1 AND account.IDNo = ?
						 LIMIT 1`,
						[parsedAccountId]
					);

					if (Array.isArray(accountRows) && accountRows.length > 0) {
						const { AGENT_CODE, NAME } = accountRows[0];
						const TELEGRAM_ID = getAgentTelegramChatId(accountRows[0]);

						if (TELEGRAM_ID) {
							const formattedAmount = amt.toLocaleString('en-US');
							const serviceLabel = resolvedCategory;
							const date_nowTG = now.toLocaleDateString();
							const updated_time = now.toLocaleTimeString();
							const remarksText = (remarks || '').trim();
							const serviceLine = remarksText
								? `서비스: ${serviceLabel} - ${remarksText}`
								: `서비스: ${serviceLabel}`;

							const text = `Demo Cage\n\n* 서비스 결제 *\n\n계정: ${AGENT_CODE} - ${NAME}\n${serviceLine}\n금액: ${formattedAmount} - 계좌출금\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

							await sendTelegramMessage(text, TELEGRAM_ID);
							await sendTelegramToAdditionalChats(text);
						}
					}
				} catch (telegramErr) {
					console.error('Failed to send Telegram message for F&B / Hotel service deposit:', telegramErr.message || telegramErr);
				}
			}
		}

		// JUNKET: notify additional chats (GUEST bot groups/channels) for any junket service
		if (sourceType === 'JUNKET') {
			try {
				const formattedAmount = amt.toLocaleString('en-US');
				const serviceLabel = resolvedCategory;
				const date_nowTG = now.toLocaleDateString();
				const updated_time = now.toLocaleTimeString();
				const remarksText = (remarks || '').trim();
				const serviceLine = remarksText
					? `서비스: ${serviceLabel} - ${remarksText}`
					: `서비스: ${serviceLabel}`;
				const gameLine = resolvedGameId ? `게임번호: ${resolvedGameId}\n` : '';

				const text = `Demo Cage\n\n* 서비스 결제 (정켓) *\n\n${gameLine}${serviceLine}\n금액: ${formattedAmount}\n\n날짜: ${date_nowTG}\n시간: ${updated_time}`;

				await sendTelegramToAdditionalChats(text);
			} catch (telegramErr) {
				console.error('Failed to send Telegram message for F&B / Hotel junket service:', telegramErr.message || telegramErr);
			}
		}

		return res.json({ success: true });
	} catch (err) {
		console.error('Error adding F&B / Hotel service record:', err);
		return res.status(500).json({ error: 'Failed to save the record.' });
	}
});

// Update service (only for services without game_id)
router.put('/fnb-hotel/service/:id', checkSession, async (req, res) => {
	try {
		const serviceId = parseInt(req.params.id, 10);
		const {
			account_id,
			agent_id,
			service_type,
			amount,
			remarks,
			transaction_id,
			source_type
		} = req.body;

		if (Number.isNaN(serviceId)) {
			return res.status(400).json({ error: 'Invalid service ID' });
		}

		// Check if service exists and has no game_id
		const [[existingService]] = await pool.execute(
			`SELECT GAME_ID, TRANSACTION_ID, AMOUNT, AGENT_ID, SOURCE_TYPE FROM game_services WHERE IDNo = ? AND ACTIVE = 1`,
			[serviceId]
		);

		if (!existingService) {
			return res.status(404).json({ error: 'Service not found' });
		}

		if (existingService.GAME_ID) {
			return res.status(400).json({ error: 'Cannot edit service with game ID. Please edit from gamebook.' });
		}

		// Get existing account_id from agent
		let existingAccountId = null;
		if (existingService.AGENT_ID) {
			const [accountRows] = await pool.execute(
				`SELECT IDNo FROM account WHERE AGENT_ID = ? AND ACTIVE = 1 LIMIT 1`,
				[existingService.AGENT_ID]
			);
			if (accountRows.length > 0) {
				existingAccountId = accountRows[0].IDNo;
			}
		}

		const parsedAccountId = parseInt(account_id, 10);
		const parsedAgentId = parseInt(agent_id, 10);
		const parsedTransactionId = parseInt(transaction_id, 10);
		const amt = parseFloat((amount || '0').toString().replace(/,/g, '')) || 0;
		const sourceType = (source_type || '').toString().trim().toUpperCase();
		const resolvedCategory = await resolveActiveServiceCategory(service_type);

		if (!resolvedCategory || !validTransactionIds.includes(parsedTransactionId) || !validSourceTypes.includes(sourceType)) {
			return res.status(400).json({ error: 'Invalid input' });
		}
		if (!parsedAccountId) {
			return res.status(400).json({ error: 'Account is required' });
		}

		const resolvedAgentId = !Number.isNaN(parsedAgentId) ? parsedAgentId : null;
		if (resolvedAgentId === null) {
			return res.status(400).json({ error: 'Invalid account/agent' });
		}

		const updatedBy = req.session?.user_id || null;
		const now = new Date();

		// Soft delete old cash_transaction if exists
		if (existingService.TRANSACTION_ID === 1 || existingService.TRANSACTION_ID === 2) {
			await pool.execute(
				`UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1 LIMIT 1`,
				[updatedBy, now, serviceId]
			);
		}

		// Soft delete old account_ledger entry if was deposit (fnb_hotel: GAME_ID always NULL)
		const accountIdToDelete = existingAccountId || parsedAccountId;
		if (existingService.TRANSACTION_ID === 2 && accountIdToDelete) {
			const [ledgerRows] = await pool.execute(
				`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC = 'SERVICES' AND AMOUNT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
				[accountIdToDelete, existingService.AMOUNT]
			);
			if (ledgerRows.length > 0) {
				await pool.execute(
					'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
					[updatedBy, now, ledgerRows[0].IDNo]
				);
			}
		}

		// Update service
		await pool.execute(
			`UPDATE game_services 
			 SET SERVICE_TYPE = ?, AMOUNT = ?, REMARKS = ?, TRANSACTION_ID = ?, AGENT_ID = ?, SOURCE_TYPE = ?, UPDATED_BY = ?, UPDATED_DT = ?
			 WHERE IDNo = ?`,
			[resolvedCategory, amt, remarks || '', parsedTransactionId, resolvedAgentId, sourceType, updatedBy, now, serviceId]
		);

		// Create new cash_transaction if needed
		if (parsedTransactionId === 1 || parsedTransactionId === 2) {
			const cashTransactionQuery = `
				INSERT INTO cash_transaction (TRANSACTION_ID, AGENT_ID, AMOUNT, CATEGORY, TYPE, REMARKS, ENCODED_BY, ENCODED_DT)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`;
			const cashType = sourceType === 'GUEST' ? 1 : 2;

			await pool.execute(cashTransactionQuery, [
				serviceId,
				resolvedAgentId,
				amt.toString(),
				resolvedCategory,
				cashType,
				remarks || '',
				updatedBy,
				now
			]);
		}

		// Create new account_ledger entry if deposit (fnb_hotel update: no game_id - services without game)
		if (parsedTransactionId === 2 && parsedAccountId) {
			await pool.execute(
				`INSERT INTO account_ledger (ACCOUNT_ID, GAME_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC, AMOUNT, ENCODED_BY, ENCODED_DT)
				 VALUES (?, ?, 2, 2, 'SERVICES', ?, ?, ?)`,
				[parsedAccountId, null, amt, updatedBy, now]
			);
		}

		return res.json({ success: true });
	} catch (err) {
		console.error('Error updating F&B / Hotel service record:', err);
		return res.status(500).json({ error: 'Failed to update the record.' });
	}
});

// Delete service (only for services without game_id) - Soft delete only
router.delete('/fnb-hotel/service/:id', checkSession, async (req, res) => {
	try {
		const serviceId = parseInt(req.params.id, 10);

		if (Number.isNaN(serviceId)) {
			return res.status(400).json({ error: 'Invalid service ID' });
		}

		// Check if service exists and has no game_id (get fields needed for account_ledger cleanup)
		const [[existingService]] = await pool.execute(
			`SELECT GAME_ID, TRANSACTION_ID, AMOUNT, AGENT_ID, SOURCE_TYPE FROM game_services WHERE IDNo = ? AND ACTIVE = 1`,
			[serviceId]
		);

		if (!existingService) {
			return res.status(404).json({ error: 'Service not found' });
		}

		if (existingService.GAME_ID) {
			return res.status(400).json({ error: 'Cannot delete service with game ID. Please delete from gamebook.' });
		}

		const updatedBy = req.session?.user_id || null;
		const now = new Date();

		// Soft delete service - just set ACTIVE = 0
		await pool.execute(
			`UPDATE game_services SET ACTIVE = 0, UPDATED_BY = ?, UPDATED_DT = ? WHERE IDNo = ?`,
			[updatedBy, now, serviceId]
		);

		// Soft delete matching account_ledger when this was GUEST + deposit (fnb_hotel: GAME_ID always NULL)
		const transId = parseInt(existingService.TRANSACTION_ID, 10);
		if (transId === 2 && existingService.AGENT_ID) {
			const [accountRows] = await pool.execute(
				`SELECT IDNo FROM account WHERE AGENT_ID = ? AND ACTIVE = 1 LIMIT 1`,
				[existingService.AGENT_ID]
			);
			const accountId = (Array.isArray(accountRows) && accountRows.length > 0) ? accountRows[0].IDNo : null;
			if (accountId) {
				const [ledgerRows] = await pool.execute(
					`SELECT IDNo FROM account_ledger WHERE ACCOUNT_ID = ? AND GAME_ID IS NULL AND TRANSACTION_ID = 2 AND TRANSACTION_TYPE = 2 AND TRANSACTION_DESC = 'SERVICES' AND AMOUNT = ? AND ACTIVE = 1 ORDER BY IDNo DESC LIMIT 1`,
					[accountId, existingService.AMOUNT]
				);
				if (ledgerRows.length > 0) {
					await pool.execute(
						'UPDATE account_ledger SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?',
						[updatedBy, now, ledgerRows[0].IDNo]
					);
				}
			}
		}

		// Soft delete cash_transaction rows linked to this service (transaction_id 1 or 2 create them)
		if (transId === 1 || transId === 2) {
			await pool.execute(
				'UPDATE cash_transaction SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ? WHERE TRANSACTION_ID = ? AND ACTIVE = 1',
				[updatedBy, now, serviceId]
			);
		}

		return res.json({ success: true });
	} catch (err) {
		console.error('Error deleting F&B / Hotel service record:', err);
		return res.status(500).json({ error: 'Failed to delete the record.' });
	}
});

module.exports = router;

