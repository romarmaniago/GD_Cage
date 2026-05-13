const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { checkSession } = require('./auth');
const pool = require('../config/db');

/** GUEST bot token for Python: Bot API getChat → @username bago Pyrogram send (see send_broadcast_user.py). */
async function fetchGuestBotTokenForBroadcast() {
	try {
		const [rows] = await pool.execute(
			'SELECT TELEGRAM_API FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
			['GUEST']
		);
		if (rows.length && rows[0].TELEGRAM_API) {
			const t = String(rows[0].TELEGRAM_API).trim();
			return t || null;
		}
	} catch (e) {
		console.warn('[broadcast/guest] Could not load GUEST TELEGRAM_API:', e.message);
	}
	return null;
}

const uploadBroadcastImg = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024 },
	fileFilter(req, file, cb) {
		const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/jpg'];
		if (!allowedTypes.includes(file.mimetype)) {
			return cb(new Error('File type not allowed. Only JPG, PNG, and GIF are allowed.'));
		}
		cb(null, true);
	}
});

function parseBroadcastChatIds(raw) {
	let arr = [];
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const p = JSON.parse(raw);
			if (Array.isArray(p)) arr = p;
		} catch (_) {
			/* ignore */
		}
	}
	const out = [];
	const seen = new Set();
	for (const x of arr) {
		const s = String(x == null ? '' : x).trim();
		if (!s || s.length > 200) continue;
		if (seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

function resolveTelegramVenvPython() {
	const telegramDir = path.join(__dirname, '..', 'telegram_announcement');
	const isWin = process.platform === 'win32';
	const venvPy = isWin
		? path.join(telegramDir, '.venv', 'Scripts', 'python.exe')
		: path.join(telegramDir, '.venv', 'bin', 'python3');
	return { telegramDir, venvPy, exists: fs.existsSync(venvPy) };
}

/**
 * Guest broadcast: Pyrogram USER (MTProto), hindi Bot API.
 * Kailangan: telegram_announcement/.venv + .env may TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_STRING_SESSION
 */
router.post('/broadcast/guest', checkSession, (req, res, next) => {
	uploadBroadcastImg.single('picture')(req, res, (err) => {
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
	const { telegramDir, venvPy, exists: venvOk } = resolveTelegramVenvPython();
	const scriptPath = path.join(telegramDir, 'scripts', 'send_broadcast_user.py');

	if (!venvOk) {
		return res.status(500).json({
			success: false,
			error:
				'Missing telegram_announcement/.venv. Run: npm run dev:telegram:install'
		});
	}
	if (!fs.existsSync(scriptPath)) {
		return res.status(500).json({
			success: false,
			error: 'send_broadcast_user.py not found under telegram_announcement/scripts/'
		});
	}

	const { message, chat_ids: chatIdsRaw } = req.body;
	const pictureFile = req.file;
	const messageText = message ? String(message).trim() : '';

	if (!messageText && !pictureFile) {
		return res.status(400).json({
			success: false,
			error: 'Please provide either a message or a picture'
		});
	}

	const chatIds = parseBroadcastChatIds(chatIdsRaw);
	if (chatIds.length === 0) {
		return res.status(400).json({
			success: false,
			error: 'Please enter at least one guest chat ID'
		});
	}

	const guestBotToken = await fetchGuestBotTokenForBroadcast();

	const tmpBase = `bc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const inPath = path.join(os.tmpdir(), `${tmpBase}-in.json`);
	const outPath = path.join(os.tmpdir(), `${tmpBase}-out.json`);
	let imageTmp = null;

	try {
		if (pictureFile) {
			const safeName = (pictureFile.originalname || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
			imageTmp = path.join(os.tmpdir(), `${tmpBase}-${safeName}`);
			fs.writeFileSync(imageTmp, pictureFile.buffer);
		}

		const payload = {
			chat_ids: chatIds,
			message: messageText,
			image_path: imageTmp,
			...(guestBotToken ? { guest_bot_token: guestBotToken } : {})
		};
		fs.writeFileSync(inPath, JSON.stringify(payload), 'utf8');

		const spawnResult = spawnSync(venvPy, [scriptPath, inPath, outPath], {
			cwd: telegramDir,
			encoding: 'utf8',
			timeout: 10 * 60 * 1000,
			maxBuffer: 50 * 1024 * 1024,
			env: { ...process.env }
		});

		if (spawnResult.stderr) {
			console.error('[broadcast/guest] pyrogram stderr:', spawnResult.stderr.slice(0, 2000));
		}

		if (!fs.existsSync(outPath)) {
			const hint =
				spawnResult.error ||
				(spawnResult.status !== 0 ? `Python exited ${spawnResult.status}` : 'No output file');
			return res.status(500).json({
				success: false,
				error: `Broadcast runner failed: ${hint}`
			});
		}

		let data;
		try {
			data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
		} catch (e) {
			return res.status(500).json({
				success: false,
				error: 'Invalid JSON from broadcast script'
			});
		}

		if (data.success === false) {
			return res.status(500).json({
				success: false,
				error: data.error || 'Pyrogram broadcast not configured or failed'
			});
		}

		const successCount = data.successCount ?? 0;
		const failCount = data.failCount ?? 0;
		const errors = Array.isArray(data.errors) && data.errors.length ? data.errors : undefined;

		if (errors && errors.length) {
			console.error('[broadcast/guest] Pyrogram per-chat errors:', JSON.stringify(errors, null, 0).slice(0, 4000));
		}

		res.json({
			success: true,
			message: `Broadcast sent to ${successCount} chat(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
			successCount,
			failCount,
			errors
		});
	} catch (error) {
		console.error('Error guest broadcast:', error);
		res.status(500).json({
			success: false,
			error: error.message || 'Broadcast failed'
		});
	} finally {
		try {
			fs.unlinkSync(inPath);
		} catch (_) {
			/* ignore */
		}
		try {
			fs.unlinkSync(outPath);
		} catch (_) {
			/* ignore */
		}
		if (imageTmp) {
			try {
				fs.unlinkSync(imageTmp);
			} catch (_) {
				/* ignore */
			}
		}
	}
});

module.exports = router;
