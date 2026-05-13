const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Startup: Guest broadcast (Pyrogram) — tingnan telegram_announcement/.env at/o root .env (process.env).
 * Hindi nilolog ang buong api_hash / string session.
 */
function logTelegramMtprotoEnv() {
	const tag = '[telegram-mtproto]';
	const envPath = path.join(__dirname, '..', 'telegram_announcement', '.env');
	const sessionFile = path.join(__dirname, '..', 'telegram_announcement', 'broadcast_mtproto.session');

	console.log(`${tag} --- Guest broadcast (Pyrogram) env ---`);
	if (fs.existsSync(sessionFile)) {
		console.log(
			`${tag} broadcast_mtproto.session: present (numeric chat IDs can use persisted peer cache) ✓`,
		);
	} else {
		console.log(
			`${tag} broadcast_mtproto.session: missing → numeric IDs may fail unless you use @username; re-run export and keep the file`,
		);
	}

	let fromTa = {};
	if (fs.existsSync(envPath)) {
		try {
			fromTa = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
		} catch (e) {
			console.log(`${tag} telegram_announcement/.env — read error: ${e.message}`);
		}
	} else {
		console.log(
			`${tag} telegram_announcement/.env — walang file (OK kung naka-set sa root .env; optional duplicate dito)`,
		);
	}

	const pick = (key) => {
		const vTa = (fromTa[key] || '').trim();
		if (vTa) return { value: vTa, src: 'telegram_announcement/.env' };
		const vRoot = (process.env[key] || '').trim();
		if (vRoot) return { value: vRoot, src: 'root .env (process.env)' };
		return { value: '', src: null };
	};

	const id = pick('TELEGRAM_API_ID');
	const hash = pick('TELEGRAM_API_HASH');
	const sess = pick('TELEGRAM_STRING_SESSION');

	if (id.value) {
		const idOk = /^\d+$/.test(id.value);
		console.log(
			`${tag} TELEGRAM_API_ID: set (${id.value})${idOk ? ' ✓' : ' ⚠ dapat numeric'} ← ${id.src}`,
		);
	} else {
		console.log(`${tag} TELEGRAM_API_ID: missing`);
	}

	if (hash.value) {
		const h = hash.value;
		const masked =
			h.length > 10 ? `${h.slice(0, 4)}…${h.slice(-4)} (${h.length} chars)` : `**** (${h.length} chars)`;
		console.log(`${tag} TELEGRAM_API_HASH: set ${masked} ← ${hash.src}`);
	} else {
		console.log(`${tag} TELEGRAM_API_HASH: missing`);
	}

	if (sess.value) {
		console.log(
			`${tag} TELEGRAM_STRING_SESSION: set (${sess.value.length} chars) ← ${sess.src} ✓`,
		);
	} else {
		console.log(`${tag} TELEGRAM_STRING_SESSION: missing → npm run broadcast:export-session`);
	}

	if (id.value && hash.value && sess.value) {
		const taHasKeys =
			fs.existsSync(envPath) &&
			Object.keys(fromTa).some((k) =>
				['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_STRING_SESSION'].includes(k),
			);
		if (taHasKeys) {
			console.log(
				`${tag} Guest broadcast: keys mula sa telegram_announcement/.env (may override sa root kung pareho) ✓`,
			);
		} else {
			console.log(
				`${tag} Guest broadcast: Pyrogram gagamit ng root .env (GD_Cage/.env) — kumpleto ✓`,
			);
		}
	}

	console.log(`${tag} --- end ---`);
}

module.exports = { logTelegramMtprotoEnv };
