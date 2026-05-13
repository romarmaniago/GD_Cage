/**
 * Creates telegram_announcement/.venv and installs requirements.txt (one-time / after updates).
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dir = path.join(root, "telegram_announcement");
const req = path.join(dir, "requirements.txt");
const isWin = process.platform === "win32";
const venvDir = path.join(dir, ".venv");
const pyLauncher = isWin ? "py" : "python3";
const venvArgs = isWin ? ["-3", "-m", "venv", venvDir] : ["-m", "venv", venvDir];

if (!fs.existsSync(req)) {
  console.error("Missing:", req);
  process.exit(1);
}

if (fs.existsSync(venvDir)) {
  console.log("May .venv na — mag-i-install/upgrade lang ng requirements.");
} else {
  console.log("Creating venv at", venvDir);
  execFileSync(pyLauncher, venvArgs, { stdio: "inherit", cwd: root });
}

const pip = isWin
  ? path.join(venvDir, "Scripts", "pip.exe")
  : path.join(venvDir, "bin", "pip3");
if (!fs.existsSync(pip)) {
  console.error("pip not found after venv create:", pip);
  process.exit(1);
}

console.log("Installing Python deps…");
execFileSync(pip, ["install", "-r", req], { stdio: "inherit", cwd: root });
console.log("Done. Run: npm run dev:all");
