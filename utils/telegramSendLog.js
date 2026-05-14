const pool = require('../config/db');

let tableEnsured = false;
let ensurePromise = null;

function previewText(text, maxLen = 280) {
  if (text == null) return null;
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
}

/**
 * INTERNAL = config / app (missing token, etc.)
 * NETWORK = transport, DNS, timeout, connection reset
 * TELEGRAM = Telegram HTTP API returned an error or client-side rejection of delivery
 */
function classifyTelegramError(error) {
  if (!error) return 'INTERNAL';
  const msg = (error.message || String(error)).toLowerCase();
  const code = error.code || '';

  if (error.name === 'AbortError') return 'NETWORK';
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED', 'EPIPE'].includes(code)) {
    return 'NETWORK';
  }
  if (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('socket hang up') ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('getaddrinfo')
  ) {
    return 'NETWORK';
  }
  if (msg.includes('telegram api error:')) return 'TELEGRAM';
  if (msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('chat not found') || msg.includes('bad request')) {
    return 'TELEGRAM';
  }
  return 'TELEGRAM';
}

// ---------------------------------------------------------------------------
// One-line previews for message_preview (guest portal + marker returns)
// ---------------------------------------------------------------------------

/** Short handle for message log (matches Telegram-style lowercase username when real @ is unknown) */
function guestMessageLogHandle(name) {
  const n = String(name || '').trim();
  if (!n) return 'guest';
  const first = n.split(/\s+/)[0];
  const slug = first.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  return slug || 'guest';
}

function guestLogAmountDisplay(n) {
  return Math.abs(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Guest portal cash ledger — short label only. Account/guest/amount are stored in
 * dedicated columns (guest_account_code, guest_name, amount), not appended here.
 * @param {string} transactionDbName - transaction_type.TRANSACTION
 * @param {{ transactionDesc?: string }} [opts]
 */
function guestPortalTransactionLogPreview(transactionDbName, opts = {}) {
  const t = String(transactionDbName || '').toUpperCase();
  const descRaw = String(opts.transactionDesc || '').trim();
  const desc = descRaw.toUpperCase();
  if (t === 'DEPOSIT') return 'Account Deposit';
  if (t === 'WITHDRAW') return 'Account Withdrawal';
  if (t === 'CREDIT' || t === 'IOU CASH' || t === 'CREDIT CASH') {
    // Preserve caller-provided descriptions verbatim; default to 'Account Details' so labels render in Title Case.
    const suffix = desc && desc !== 'ACCOUNT DETAILS' ? descRaw : 'Account Details';
    return t === 'IOU CASH' ? `IOU Cash - ${suffix}` : `Credit Cash - ${suffix}`;
  }
  return 'Account Update';
}

/** Guest portal / cage-initiated balance check — short label; balance goes in `amount` column. */
function balanceCheckTelegramLogPreview() {
  return 'Balance check';
}

/**
 * Junket house expense (employee bot) — short `message_preview`; amount + encoder in structured columns.
 * @param {'add'|'edit'|'delete'} action
 */
function junketExpenseTelegramLogPreview(action) {
  const a = String(action || 'add').toLowerCase();
  if (a === 'edit') return 'Junket Expense (Edit)';
  if (a === 'delete') return 'Junket Expense (Deleted)';
  return 'Junket Expense';
}

/**
 * Marker / junket credit return — short label only. Account/guest/amount stored separately.
 * @param {string|number} optTransType - ledger TRANSACTION_ID: 11 cash, 12 deposit
 * @param {string} optReturnSource - 'credit' | 'buyin'
 */
function markerReturnTelegramLogPreview(optTransType, optReturnSource) {
  const isDeposit = String(optTransType) === '12';
  const src = String(optReturnSource || '');
  if (src === 'credit') {
    return isDeposit ? 'Junket Credit Return Thru Deposit' : 'Junket Credit Return Thru Cash';
  }
  if (src === 'buyin') {
    return isDeposit ? 'Game Credit Return Thru Deposit' : 'Game Credit Return Thru Cash';
  }
  return isDeposit ? 'IOU Return (Deposit)' : 'IOU Return (Cash)';
}

async function ensureTelegramSendLogTable() {
  if (tableEnsured) return;
  if (!ensurePromise) {
    ensurePromise = pool
      .query(
        `CREATE TABLE IF NOT EXISTS telegram_send_log (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          bot_user VARCHAR(32) NOT NULL,
          message_kind VARCHAR(16) NOT NULL DEFAULT 'text',
          chat_id VARCHAR(64) NOT NULL,
          guest_account_code VARCHAR(64) DEFAULT NULL,
          guest_name VARCHAR(128) DEFAULT NULL,
          message_preview VARCHAR(512) DEFAULT NULL,
          amount DECIMAL(15,2) DEFAULT NULL,
          status VARCHAR(16) NOT NULL,
          error_category VARCHAR(32) DEFAULT NULL,
          error_message TEXT,
          PRIMARY KEY (id),
          KEY idx_telegram_send_log_created (created_at),
          KEY idx_telegram_send_log_status (status),
          KEY idx_telegram_send_log_category (error_category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`
      )
      .then(() => {
        tableEnsured = true;
      })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

function toDecimalOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!isFinite(n)) return null;
  return n;
}

async function insertTelegramSendLog({
  botUser,
  messageKind = 'text',
  chatId,
  status,
  errorCategory = null,
  errorMessage = null,
  messagePreview = null,
  guestAccountCode = null,
  guestName = null,
  amount = null
}) {
  try {
    await ensureTelegramSendLogTable();
    await pool.execute(
      `INSERT INTO telegram_send_log
        (bot_user, message_kind, chat_id, guest_account_code, guest_name, message_preview, amount, status, error_category, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        botUser,
        messageKind,
        String(chatId),
        guestAccountCode != null && String(guestAccountCode).trim() !== '' ? String(guestAccountCode).trim().slice(0, 64) : null,
        guestName != null && String(guestName).trim() !== '' ? String(guestName).trim().slice(0, 128) : null,
        messagePreview,
        toDecimalOrNull(amount),
        status,
        errorCategory,
        errorMessage
      ]
    );
  } catch (e) {
    console.error('insertTelegramSendLog failed (non-fatal):', e.message);
  }
}

module.exports = {
  ensureTelegramSendLogTable,
  insertTelegramSendLog,
  previewText,
  classifyTelegramError,
  guestMessageLogHandle,
  guestLogAmountDisplay,
  guestPortalTransactionLogPreview,
  balanceCheckTelegramLogPreview,
  junketExpenseTelegramLogPreview,
  markerReturnTelegramLogPreview
};
