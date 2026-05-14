const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession, sessions } = require('./auth');
const { ensureTelegramSendLogTable } = require('../utils/telegramSendLog');

//=============== TELEGRAM API =============
router.get('/telegramAPI/logs', checkSession, (req, res) => {
	res.redirect(302, '/telegramAPI#message-log');
});

function isYmd(s) {
	return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

router.get('/telegramAPI/logs-data', checkSession, async (req, res) => {
	try {
		await ensureTelegramSendLogTable();
		const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
		const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
		const { dateFrom: qFrom, dateTo: qTo } = req.query;
		const searchRaw = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 240) : '';

		let dateFrom = isYmd(qFrom) ? qFrom : null;
		let dateTo = isYmd(qTo) ? qTo : null;
		if (!dateFrom || !dateTo) {
			const n = new Date();
			const p = (x) => String(x).padStart(2, '0');
			const today = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
			dateFrom = dateTo = today;
		}
		if (dateFrom > dateTo) {
			const t = dateFrom;
			dateFrom = dateTo;
			dateTo = t;
		}

		const whereParts = ['DATE(created_at) >= ?', 'DATE(created_at) <= ?'];
		const params = [dateFrom, dateTo];

		if (searchRaw) {
			const like = `%${searchRaw}%`;
			whereParts.push(
				`(COALESCE(message_preview,'') LIKE ? OR COALESCE(chat_id,'') LIKE ? OR COALESCE(bot_user,'') LIKE ? OR COALESCE(status,'') LIKE ? OR COALESCE(error_category,'') LIKE ? OR COALESCE(error_message,'') LIKE ? OR COALESCE(message_kind,'') LIKE ? OR COALESCE(guest_account_code,'') LIKE ? OR COALESCE(guest_name,'') LIKE ?)`
			);
			for (let i = 0; i < 9; i++) params.push(like);
		}

		const whereSql = whereParts.join(' AND ');

		const [[countRow]] = await pool.execute(
			`SELECT COUNT(*) AS total FROM telegram_send_log WHERE ${whereSql}`,
			params
		);
		const total = countRow && countRow.total != null ? Number(countRow.total) : 0;

		// LIMIT/OFFSET as bound parameters triggers ER_WRONG_ARGUMENTS on some MySQL/MariaDB
		// builds with mysqld_stmt_execute; values are already clamped to safe integers.
		const [rows] = await pool.execute(
			`SELECT id, created_at, bot_user, message_kind, chat_id, status, error_category, error_message, message_preview, guest_account_code, guest_name, amount
			 FROM telegram_send_log WHERE ${whereSql} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
			params
		);

		res.json({ rows, total, limit, offset, dateFrom, dateTo, search: searchRaw });
	} catch (err) {
		console.error('telegramAPI/logs-data:', err);
		res.status(500).json({ error: 'Failed to load Telegram send log' });
	}
});

router.get("/telegramAPI", checkSession, function (req, res) {

	const permissions = req.session.permissions;

	res.render("telegram/telegram", {
		...sessions(req, 'telegramAPI'),
		permissions: permissions
	});

});
//Get TELEGRAM API
router.get('/telegramAPI_data', async (req, res) => {
	try {
		const [results] = await pool.execute('SELECT * FROM telegram_api WHERE ACTIVE = 1');
		res.json(results);
	} catch (error) {
		console.error('Error fetching Telegram API data:', error);
		res.status(500).send('Error fetching Telegram API data');
	}
});

// Get Telegram bot details (bot profile + admin chat ID) by USER type
router.get('/telegramAPI/details/:userType', checkSession, async (req, res) => {
	try {
		const userType = req.params.userType || 'GUEST';
		const [rows] = await pool.execute(
			'SELECT TELEGRAM_API, CHAT_ID FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
			[userType]
		);

		if (rows.length === 0) {
			return res.status(404).json({ message: `No active Telegram bot configured for ${userType}` });
		}

		const { TELEGRAM_API: token, CHAT_ID: chatId } = rows[0];
		if (!token) {
			return res.status(400).json({ message: `Telegram bot token is missing for ${userType}` });
		}

		try {
			const { default: fetch } = await import('node-fetch');
			const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
			const payload = await response.json();

			if (!payload.ok) {
				console.error('Telegram getMe failed:', payload);
				return res.status(502).json({ message: 'Failed to fetch bot details', details: payload });
			}

			return res.json({
				bot: payload.result,
				chatId: chatId || null
			});
		} catch (err) {
			console.error('Error fetching bot details:', err);
			return res.status(500).json({ message: 'Error fetching bot details' });
		}
	} catch (error) {
		console.error('Error retrieving Telegram bot settings:', error);
		return res.status(500).json({ message: 'Error retrieving Telegram bot settings' });
	}
});

// Get chat information from Telegram API by USER type
router.get('/telegramAPI/chat-info/:userType/:chatId', checkSession, async (req, res) => {
	try {
		const chatId = req.params.chatId;
		const userType = req.params.userType || 'GUEST';
		if (!chatId) {
			return res.status(400).json({ message: 'Chat ID is required' });
		}

		const [rows] = await pool.execute(
			'SELECT TELEGRAM_API FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
			[userType]
		);

		if (rows.length === 0 || !rows[0].TELEGRAM_API) {
			return res.status(404).json({ message: `No active Telegram bot configured for ${userType}` });
		}

		const token = rows[0].TELEGRAM_API;

		try {
			const { default: fetch } = await import('node-fetch');
			const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`);
			const payload = await response.json();

			if (!payload.ok) {
				// Don't log as error for "chat not found" - this is expected for invalid/missing chat IDs
				if (payload.error_code === 400 && payload.description && payload.description.includes('chat not found')) {
					// Silently return empty result - username will just not be displayed
					return res.json({ chat: null });
				}
				// Only log actual errors (not "chat not found")
				console.error('Telegram getChat failed:', payload);
				return res.status(502).json({ message: 'Failed to fetch chat details', details: payload });
			}

			return res.json({
				chat: payload.result
			});
		} catch (err) {
			console.error('Error fetching chat details:', err);
			return res.status(500).json({ message: 'Error fetching chat details' });
		}
	} catch (error) {
		console.error('Error retrieving Telegram bot settings:', error);
		return res.status(500).json({ message: 'Error retrieving Telegram bot settings' });
	}
});

// Get agent/account info by account code — returns accountCode + name + accountId
// (accountId is account.IDNo; used by the telegram-log deeplinks that auto-open the
// Guest Portal modal on /dashboard via account_details(accountId, code, name).)
router.get('/telegramAPI/account-info/:accountCode', checkSession, async (req, res) => {
	try {
		const accountCode = String(req.params.accountCode || '').trim();
		if (!accountCode) return res.status(400).json({ account: null });

		const [rows] = await pool.execute(
			`SELECT agent.AGENT_CODE AS accountCode,
			        agent.NAME       AS name,
			        account.IDNo     AS accountId
			 FROM agent
			 LEFT JOIN account
			        ON account.AGENT_ID = agent.IDNo
			       AND account.ACTIVE = 1
			 WHERE agent.ACTIVE = 1 AND agent.AGENT_CODE = ?
			 ORDER BY account.IDNo DESC
			 LIMIT 1`,
			[accountCode]
		);

		if (!rows.length) return res.json({ account: null });
		return res.json({ account: rows[0] });
	} catch (err) {
		console.error('telegramAPI/account-info:', err);
		return res.status(500).json({ account: null });
	}
});

// --------------- Chat IDs (groups/channels) — must be before /telegramAPI/:id ---------------
function parseChatIds(raw) {
	if (raw == null || typeof raw !== 'string') return [];
	const trimmed = String(raw).trim();
	if (!trimmed) return [];
	return trimmed.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

// Get chat IDs by USER type (all use CHAT_ID column)
router.get('/telegramAPI/chat-ids/:userType', checkSession, async (req, res) => {
	try {
		const userType = req.params.userType || 'GUEST';
		const [rows] = await pool.execute(
			'SELECT CHAT_ID FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
			[userType]
		);
		const chatIds = rows.length && rows[0].CHAT_ID != null ? parseChatIds(rows[0].CHAT_ID) : [];
		res.json({ chatIds });
	} catch (err) {
		console.error('Error fetching chat IDs:', err);
		res.status(500).json({ error: 'Error fetching chat IDs' });
	}
});

// Update chat IDs by USER type (all use CHAT_ID column)
router.put('/telegramAPI/chat-ids/:userType', checkSession, async (req, res) => {
	try {
		const userType = req.params.userType || 'GUEST';
		let chatIds = req.body.chatIds;
		if (!Array.isArray(chatIds)) chatIds = [];
		const value = chatIds.map(s => String(s).trim()).filter(Boolean).join(',');
		await pool.execute(
			'UPDATE telegram_api SET CHAT_ID = ?, EDITED_BY = ?, EDITED_DT = ? WHERE ACTIVE = 1 AND USER = ?',
			[value || null, req.session.user_id, new Date(), userType]
		);
		res.json({ success: true, chatIds: value ? value.split(',') : [] });
	} catch (err) {
		console.error('Error updating chat IDs:', err);
		res.status(500).json({ error: 'Error updating chat IDs' });
	}
});

// Get agent-specific notification chat IDs (AGENT_CHATID column for GUEST)
router.get('/telegramAPI/agent-chat-ids', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.execute(
			'SELECT AGENT_CHATID FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
			['GUEST']
		);
		
		if (rows.length === 0 || !rows[0].AGENT_CHATID) {
			return res.json({ agentChatIds: [] });
		}
		
		const raw = String(rows[0].AGENT_CHATID).trim();
		if (!raw) {
			return res.json({ agentChatIds: [] });
		}
		
		// Parse JSON format: ["123456", "789012", ...] or comma-separated
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				// Array of chat IDs
				return res.json({ agentChatIds: parsed.filter(Boolean) });
			}
		} catch (e) {
			// Not JSON, try comma-separated format
			const chatIds = raw.split(',').map(s => s.trim()).filter(Boolean);
			return res.json({ agentChatIds: chatIds });
		}
		
		res.json({ agentChatIds: [] });
	} catch (err) {
		// If AGENT_CHATID column doesn't exist, return empty array
		console.warn('Error fetching agent chat IDs (AGENT_CHATID column may not exist):', err.message);
		res.json({ agentChatIds: [] });
	}
});

// Update agent-specific notification chat IDs (AGENT_CHATID column for GUEST)
router.put('/telegramAPI/agent-chat-ids', checkSession, async (req, res) => {
	try {
		let agentChatIds = req.body.agentChatIds;
		if (!Array.isArray(agentChatIds)) {
			agentChatIds = [];
		}
		
		// Validate: just array of chat ID strings
		const validated = agentChatIds
			.map(item => {
				// Support both string and object format for backward compatibility
				if (typeof item === 'string') {
					return item.trim();
				} else if (item && item.chatId) {
					return String(item.chatId).trim();
				}
				return null;
			})
			.filter(Boolean);
		
		const value = validated.length > 0 ? JSON.stringify(validated) : null;
		
		await pool.execute(
			'UPDATE telegram_api SET AGENT_CHATID = ?, EDITED_BY = ?, EDITED_DT = ? WHERE ACTIVE = 1 AND USER = ?',
			[value, req.session.user_id, new Date(), 'GUEST']
		);
		
		res.json({ success: true, agentChatIds: validated });
	} catch (err) {
		console.error('Error updating agent chat IDs:', err);
		res.status(500).json({ error: 'Error updating agent chat IDs' });
	}
});

// EDIT TELEGRAM API by USER type
router.put('/telegramAPI/:userType', checkSession, async (req, res) => {
	const userType = req.params.userType || 'GUEST';
	const { txtTelegramAPI } = req.body;
	const date_now = new Date();

	// Allow blank/empty values to clear the token
	const telegramToken = txtTelegramAPI && typeof txtTelegramAPI === 'string' ? txtTelegramAPI.trim() : '';

	if (!req.session || !req.session.user_id) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const query = `
		UPDATE telegram_api 
		SET TELEGRAM_API = ?, EDITED_BY = ?, EDITED_DT = ? 
		WHERE USER = ? AND ACTIVE = 1
	`;

	try {
		const [result] = await pool.execute(query, [telegramToken, req.session.user_id, date_now, userType]);
		
		if (result.affectedRows === 0) {
			return res.status(404).json({ error: `No active Telegram API record found for user type: ${userType}` });
		}
		
		res.json({ message: 'Telegram API updated successfully' });
	} catch (err) {
		console.error('Error updating Telegram API:', err);
		res.status(500).json({ error: 'Error updating Telegram API', details: err.message });
	}
});

module.exports = router; 