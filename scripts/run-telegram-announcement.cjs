/**
 * Spawns Streamlit for telegram_announcement.
 * Prefers telegram_announcement/.venv (see npm run dev:telegram:install) para walang clash
 * sa global FastAPI / lumang Starlette.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const announceDir = path.join(root, "telegram_announcement");

/**
 * Streamlit unang run: nagtatanong ng email sa terminal (marketing).
 * Kung walang ~/.streamlit/credentials.toml, nagha-hang ang concurrently.
 * Nililikha lang kung wala pa — blank email = skip.
 */
function ensureStreamlitNoEmailPrompt() {
  const dir = path.join(os.homedir(), ".streamlit");
  const file = path.join(dir, "credentials.toml");
  if (fs.existsSync(file)) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, "[general]\nemail = \"\"\n", "utf8");
  } catch (e) {
    console.warn("[telegram] Hindi makalikha ng ~/.streamlit/credentials.toml:", e.message);
  }
}

const app = path.join(announceDir, "app.py");
const isWin = process.platform === "win32";

const venvPython = isWin
  ? path.join(announceDir, ".venv", "Scripts", "python.exe")
  : path.join(announceDir, ".venv", "bin", "python3");

const streamlitArgs = ["-m", "streamlit", "run", app, "--browser.gatherUsageStats", "false"];

let cmd;
/** @type {string[]} */
let args;

if (fs.existsSync(venvPython)) {
  cmd = venvPython;
  args = streamlitArgs;
} else {
  console.warn(
    "[telegram] Walang telegram_announcement/.venv — gumagamit ng system Python. " +
      "Kung may ImportError (starlette), patakbuhin: npm run dev:telegram:install",
  );
  cmd = isWin ? "py" : "python3";
  args = isWin ? ["-3", ...streamlitArgs] : streamlitArgs;
}

ensureStreamlitNoEmailPrompt();

const child = spawn(cmd, args, {
  stdio: "inherit",
  cwd: announceDir,
  shell: false,
  env: {
    ...process.env,
    STREAMLIT_BROWSER_GATHER_USAGE_STATS: "false",
  },
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code === null ? 1 : code);
});
