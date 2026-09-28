/**
 * Telegram notice to an agent (and the additional chats) about a change on their account:
 * Company transfers and Agent Portal edits / deletes. Same layout as the other cage messages.
 * Respects the agent's Telegram on/off; never throws — the transaction is already saved.
 */
const pool = require('../config/db');
const { sendTelegramMessage, sendTelegramToAdditionalChats } = require('./telegram');
const { getAgentTelegramChatId } = require('./agentTelegram');
const { getAccountCashBalance } = require('./junketCapitalTransfer');

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** Telegram amount: money leaving the balance (or a negative figure) reads "(10,000)", like the ledger. */
function tgAmount(n, isOut = false) {
	const v = Number(n) || 0;
	return isOut || v < 0 ? `(${fmt(Math.abs(v))})` : fmt(v);
}

/**
 * @param {object} p
 * @param {number} p.accountId
 * @param {string} p.title     e.g. 'Transfer', 'Withdrawal (Edited)'
 * @param {string[]} p.lines   body lines between Account and Balance
 * @param {number} p.amount    logged amount
 */
async function sendAccountTelegramNotice({ accountId, title, lines, amount }) {
	try {
		const [rows] = await pool.execute(
			`SELECT agent.AGENT_CODE, agent.NAME, agent.TELEGRAM_ID,
			        COALESCE(agent.TELEGRAM_ENABLED, 1) AS TELEGRAM_ENABLED
			 FROM account
			 JOIN agent ON agent.IDNo = account.AGENT_ID
			 WHERE account.IDNo = ?
			 LIMIT 1`,
			[accountId]
		);
		if (!rows.length) return;

		const { AGENT_CODE, NAME } = rows[0];
		const balance = await getAccountCashBalance(pool, accountId);
		const now = new Date();
		const text =
			`GD Cage\n\n* ${title} *\n\nAccount: ${AGENT_CODE} - ${NAME}\n` +
			`${(lines || []).join('\n')}\nBalance: ${tgAmount(balance)}\n\n` +
			`Date: ${now.toLocaleDateString()}\nTime: ${now.toLocaleTimeString()}`;
		const opts = {
			logPreview: title,
			logMeta: { accountCode: AGENT_CODE, guestName: NAME, amount: Math.abs(Number(amount) || 0) }
		};

		const chatId = getAgentTelegramChatId(rows[0]);
		if (chatId) {
			try {
				await sendTelegramMessage(text, chatId, opts);
			} catch (err) {
				console.error('account notice → agent failed:', err.message || err);
			}
		}
		try {
			await sendTelegramToAdditionalChats(text, opts);
		} catch (err) {
			console.error('account notice → additional chats failed:', err.message || err);
		}
	} catch (err) {
		console.error('sendAccountTelegramNotice:', err.message || err);
	}
}

/** Account ← / → Company transfer. fromCompany = the account received the amount. */
function sendCompanyTransferTelegram({ accountId, fromCompany, amount }) {
	return sendAccountTelegramNotice({
		accountId,
		title: 'Transfer',
		lines: [fromCompany ? 'From: Company' : 'To: Company', `Amount: ${tgAmount(amount, !fromCompany)}`],
		amount
	});
}

/** A transaction on the account was edited (old → new amount). isOut = it took money from the balance. */
function sendLedgerEditedTelegram({ accountId, title, oldAmount, newAmount, isOut = false }) {
	return sendAccountTelegramNotice({
		accountId,
		title: `${title} (Edited)`,
		lines: [`Old amount: ${tgAmount(oldAmount, isOut)}`, `New amount: ${tgAmount(newAmount, isOut)}`],
		amount: newAmount
	});
}

/** A transaction on the account was deleted. isOut = it had taken money from the balance. */
function sendLedgerDeletedTelegram({ accountId, title, amount, isOut = false }) {
	return sendAccountTelegramNotice({
		accountId,
		title: `${title} (Deleted)`,
		lines: [`Amount: ${tgAmount(amount, isOut)}`],
		amount
	});
}

module.exports = {
	tgAmount,
	sendAccountTelegramNotice,
	sendCompanyTransferTelegram,
	sendLedgerEditedTelegram,
	sendLedgerDeletedTelegram
};
