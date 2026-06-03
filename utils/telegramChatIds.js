/**
 * Parse / serialize telegram_api CHAT_ID and AGENT_CHATID values.
 * Supports legacy comma-separated IDs (all enabled) and JSON:
 * [{"chatId":"123","enabled":true},{"chatId":"456","enabled":false}]
 */

function normalizeEntry(item) {
	if (item == null) return null;
	if (typeof item === 'string' || typeof item === 'number') {
		const chatId = String(item).trim();
		return chatId ? { chatId, enabled: true } : null;
	}
	if (typeof item === 'object') {
		const chatId = String(item.chatId ?? item.chat_id ?? '').trim();
		if (!chatId) return null;
		const enabled =
			item.enabled === false || item.enabled === 0 || item.enabled === '0' ? false : true;
		return { chatId, enabled };
	}
	return null;
}

function parseChatIdEntries(raw) {
	if (raw == null) return [];
	const trimmed = String(raw).trim();
	if (!trimmed) return [];

	if (trimmed.startsWith('[')) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				const out = [];
				const seen = new Set();
				for (const item of parsed) {
					const entry = normalizeEntry(item);
					if (entry && !seen.has(entry.chatId)) {
						seen.add(entry.chatId);
						out.push(entry);
					}
				}
				return out;
			}
		} catch (e) {
			/* fall through to legacy */
		}
	}

	return trimmed
		.split(/[\s,;]+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((chatId) => ({ chatId, enabled: true }));
}

function serializeChatIdEntries(entries) {
	if (!Array.isArray(entries) || entries.length === 0) return null;
	const normalized = [];
	const seen = new Set();
	for (const item of entries) {
		const entry = normalizeEntry(item);
		if (entry && !seen.has(entry.chatId)) {
			seen.add(entry.chatId);
			normalized.push(entry);
		}
	}
	if (!normalized.length) return null;
	return JSON.stringify(normalized);
}

function getEnabledChatIds(raw) {
	return parseChatIdEntries(raw)
		.filter((e) => e.enabled)
		.map((e) => e.chatId);
}

function validateChatIdsPayload(chatIds) {
	if (!Array.isArray(chatIds)) return [];
	const out = [];
	const seen = new Set();
	for (const item of chatIds) {
		const entry = normalizeEntry(item);
		if (entry && !seen.has(entry.chatId)) {
			seen.add(entry.chatId);
			out.push(entry);
		}
	}
	return out;
}

module.exports = {
	normalizeEntry,
	parseChatIdEntries,
	serializeChatIdEntries,
	getEnabledChatIds,
	validateChatIdsPayload
};
