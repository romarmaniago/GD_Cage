/**
 * Server-side date/time display — YYYY-MM-DD HH:mm (24-hour, Asia/Manila).
 */
const DISPLAY_TIMEZONE = 'Asia/Manila';

function pad2(n) {
	return String(n).padStart(2, '0');
}

function toDate(input) {
	if (input == null || input === '') return null;
	const d = input instanceof Date ? input : new Date(input);
	return Number.isNaN(d.getTime()) ? null : d;
}

function formatPartsInTimezone(d, timeZone, includeTime) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		...(includeTime
			? { hour: '2-digit', minute: '2-digit', hour12: false }
			: {})
	}).formatToParts(d);

	const map = {};
	parts.forEach((p) => {
		if (p.type !== 'literal') map[p.type] = p.value;
	});

	const date = `${map.year}-${map.month}-${map.day}`;
	if (!includeTime) return date;
	return `${date} ${map.hour}:${map.minute}`;
}

function formatDateTimeDisplay(input, options = {}) {
	const d = toDate(input);
	if (!d) return options.fallback != null ? options.fallback : '';
	const timeZone = options.timeZone || DISPLAY_TIMEZONE;
	return formatPartsInTimezone(d, timeZone, !options.dateOnly);
}

function formatDateDisplay(input, fallback = '') {
	return formatDateTimeDisplay(input, { dateOnly: true, fallback });
}

function formatNowDisplay(options = {}) {
	return formatDateTimeDisplay(new Date(), options);
}

module.exports = {
	DISPLAY_TIMEZONE,
	formatDateTimeDisplay,
	formatDateDisplay,
	formatNowDisplay
};
