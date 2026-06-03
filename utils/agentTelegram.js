/**
 * Per-agent Telegram notification enable flag (agent.TELEGRAM_ENABLED).
 * When disabled, TELEGRAM_ID is kept but outbound messages are skipped.
 */

function isAgentTelegramEnabled(agentRow) {
	if (!agentRow) return false;
	const id = agentRow.TELEGRAM_ID ?? agentRow.telegramId ?? agentRow.agent_telegram;
	if (id == null || String(id).trim() === '') return false;
	const enabled = agentRow.TELEGRAM_ENABLED ?? agentRow.telegram_enabled;
	if (enabled === 0 || enabled === false || enabled === '0') return false;
	return true;
}

function getAgentTelegramChatId(agentRow) {
	if (!isAgentTelegramEnabled(agentRow)) return null;
	const id = agentRow.TELEGRAM_ID ?? agentRow.telegramId ?? agentRow.agent_telegram;
	return String(id).trim();
}

module.exports = {
	isAgentTelegramEnabled,
	getAgentTelegramChatId
};
