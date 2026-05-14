/**
 * Pyrogram USER session → auth.logOut (revoke sa Telegram).
 * Kailangan: .env may TELEGRAM_API_ID + TELEGRAM_API_HASH, at file session o TELEGRAM_STRING_SESSION.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const td = path.join(root, "telegram_announcement");
const isWin = process.platform === "win32";
const venvPy = isWin
	? path.join(td, ".venv", "Scripts", "python.exe")
	: path.join(td, ".venv", "bin", "python3");
const script = path.join(td, "scripts", "logout_mtproto_session.py");

if (!fs.existsSync(venvPy)) {
	console.error("Walang .venv — patakbuhin muna: npm run dev:telegram:install");
	process.exit(1);
}
const r = spawnSync(venvPy, [script], { stdio: "inherit", cwd: td, encoding: "utf8" });
process.exit(r.status === null ? 1 : r.status);
