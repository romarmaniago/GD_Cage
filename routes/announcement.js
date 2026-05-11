const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const multer = require('multer');

const { checkSession, sessions } = require('./auth');
const { sendTelegramMessage, sendTelegramPhoto } = require('../utils/telegram');

// Set up multer for announcement image uploads (memory storage - no file saved to disk)
const uploadAnnouncementImg = multer({
	storage: multer.memoryStorage(), // Store file in memory, not on disk
	fileFilter(req, file, cb) {
		const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/jpg'];
		if (!allowedTypes.includes(file.mimetype)) {
			return cb(new Error('File type not allowed. Only JPG, PNG, and GIF are allowed.'));
		}
		cb(null, true);
	}
});

// Eligible agents for announcement (active + Telegram ID)
router.get('/announcement/agents', checkSession, async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT IDNo, AGENT_CODE, NAME, TELEGRAM_ID
			 FROM agent
			 WHERE ACTIVE = 1 AND TELEGRAM_ID IS NOT NULL AND TELEGRAM_ID != ""
			 ORDER BY AGENT_CODE ASC, NAME ASC`
		);
		res.json({ success: true, agents: rows });
	} catch (error) {
		console.error('Error listing announcement agents:', error);
		res.status(500).json({ success: false, error: error.message || 'Failed to load agents' });
	}
});

// POST route to create and send announcement
router.post("/announcement/create", checkSession, (req, res, next) => {
	uploadAnnouncementImg.single('picture')(req, res, (err) => {
		if (err) {
			if (err instanceof multer.MulterError) {
				if (err.code === 'LIMIT_FILE_SIZE') {
					return res.status(400).json({
						success: false,
						error: 'File too large. Maximum size is 10MB.'
					});
				}
				return res.status(400).json({
					success: false,
					error: 'File upload error: ' + err.message
				});
			}
			return res.status(400).json({
				success: false,
				error: err.message || 'File upload error'
			});
		}
		next();
	});
}, async (req, res) => {
	try {
		const { message, agent_ids: agentIdsRaw } = req.body;
		const pictureFile = req.file;
		const messageText = message ? message.trim() : '';

		// At least one of message or picture must be provided
		if (!messageText && !pictureFile) {
			return res.status(400).json({ 
				success: false, 
				error: 'Please provide either a message or a picture' 
			});
		}

		let selectedIds = [];
		if (agentIdsRaw) {
			try {
				const parsed = JSON.parse(agentIdsRaw);
				if (Array.isArray(parsed)) {
					selectedIds = [...new Set(
						parsed.map((id) => parseInt(String(id), 10)).filter((n) => Number.isInteger(n) && n > 0)
					)];
				}
			} catch (_) {
				// ignore invalid JSON
			}
		}

		if (selectedIds.length === 0) {
			return res.status(400).json({
				success: false,
				error: 'Please select at least one agent'
			});
		}

		const [agents] = await pool.query(
			`SELECT IDNo, AGENT_CODE, NAME, TELEGRAM_ID FROM agent
			 WHERE ACTIVE = 1 AND TELEGRAM_ID IS NOT NULL AND TELEGRAM_ID != ""
			 AND IDNo IN (?)`,
			[selectedIds]
		);

		const seenTelegramIds = new Set();
		const uniqueAgents = agents.filter((agent) => {
			const telegramId = String(agent.TELEGRAM_ID).trim();
			if (!telegramId || seenTelegramIds.has(telegramId)) return false;
			seenTelegramIds.add(telegramId);
			return true;
		});

		if (uniqueAgents.length === 0) {
			return res.status(400).json({
				success: false,
				error: 'No eligible agents match your selection'
			});
		}

		let successCount = 0;
		let failCount = 0;
		const errors = [];

		// Send announcement to each agent with timeout
		const sendPromises = uniqueAgents.map(async (agent) => {
			try {
				// Add timeout wrapper (30 seconds per agent)
				const sendPromise = pictureFile 
					? sendTelegramPhoto(pictureFile.buffer, pictureFile.originalname, messageText || '', agent.TELEGRAM_ID)
					: sendTelegramMessage(messageText, agent.TELEGRAM_ID);
				
				const timeoutPromise = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Timeout: Telegram API took too long')), 30000)
				);
				
				await Promise.race([sendPromise, timeoutPromise]);
				return { success: true, agent };
			} catch (error) {
				return { 
					success: false, 
					agent, 
					error: error.message || 'Unknown error' 
				};
			}
		});

		// Wait for all sends to complete (with overall timeout)
		const results = await Promise.allSettled(sendPromises);
		
		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				if (result.value.success) {
					successCount++;
				} else {
					failCount++;
					errors.push({
						agent: result.value.agent.NAME || result.value.agent.AGENT_CODE,
						error: result.value.error
					});
					console.error(`Failed to send announcement to agent ${result.value.agent.AGENT_CODE}:`, result.value.error);
				}
			} else {
				failCount++;
				const agent = uniqueAgents[index];
				errors.push({
					agent: agent.NAME || agent.AGENT_CODE,
					error: result.reason?.message || 'Promise rejected'
				});
				console.error(`Failed to send announcement to agent ${agent.AGENT_CODE}:`, result.reason);
			}
		});

		res.json({
			success: true,
			message: `Announcement sent to ${successCount} agent(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
			successCount,
			failCount,
			errors: failCount > 0 ? errors : undefined
		});

	} catch (error) {
		console.error('Error creating announcement:', error);
		res.status(500).json({ 
			success: false, 
			error: 'Failed to create announcement: ' + error.message 
		});
	}
});

module.exports = router;

