/**
 * Guest Portal contact settings — the fixed Cage / Concierge / Company contact
 * numbers, Telegram usernames and channel link shown in the account "Info" modal
 * (Details section). Stored as key/value rows in `app_settings`.
 */

const pool = require('../config/db');

const KEY_PREFIX = 'guest_portal.';

// Known fields — all editable from the Telegram settings page, blank until set.
const FIELDS = [
	'channel_link',
	'cage_number',
	'concierge_number',
	'company_number',
	'cage_username',
	'concierge_username',
	'company_username'
];

let tableEnsured = false;
let ensurePromise = null;

async function ensureAppSettingsSchema() {
	if (tableEnsured) return;
	if (!ensurePromise) {
		ensurePromise = pool
			.query(
				`CREATE TABLE IF NOT EXISTS app_settings (
					SETTING_KEY VARCHAR(120) NOT NULL,
					SETTING_VALUE TEXT NULL,
					EDITED_BY INT NULL DEFAULT NULL,
					ENCODED_DT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
					EDITED_DT DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
					PRIMARY KEY (SETTING_KEY)
				) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
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

/** Returns { channel_link, cage_number, ... } — every field present, '' when unset. */
async function getGuestPortalContacts() {
	await ensureAppSettingsSchema();
	const keys = FIELDS.map((f) => KEY_PREFIX + f);
	const [rows] = await pool.query(
		`SELECT SETTING_KEY, SETTING_VALUE FROM app_settings WHERE SETTING_KEY IN (${keys.map(() => '?').join(',')})`,
		keys
	);
	const byKey = new Map(rows.map((r) => [r.SETTING_KEY, r.SETTING_VALUE]));
	const out = {};
	for (const field of FIELDS) {
		const v = byKey.get(KEY_PREFIX + field);
		out[field] = v == null ? '' : String(v);
	}
	return out;
}

/** Persists any subset of the known fields. Unknown keys are ignored. */
async function saveGuestPortalContacts(values, editedBy = null) {
	await ensureAppSettingsSchema();
	const input = values || {};
	for (const field of FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
		const raw = input[field];
		const value = raw == null ? '' : String(raw).trim().slice(0, 2000);
		await pool.execute(
			`INSERT INTO app_settings (SETTING_KEY, SETTING_VALUE, EDITED_BY)
			 VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE SETTING_VALUE = VALUES(SETTING_VALUE), EDITED_BY = VALUES(EDITED_BY)`,
			[KEY_PREFIX + field, value, editedBy]
		);
	}
	return getGuestPortalContacts();
}

module.exports = {
	ensureAppSettingsSchema,
	getGuestPortalContacts,
	saveGuestPortalContacts,
	GUEST_PORTAL_CONTACT_FIELDS: FIELDS.slice()
};
