/**
 * Month-end cut-off default range:
 * Start = last day of current month
 * End   = 2nd-to-last day of next month (display)
 * API end extends to last day of that month so month-end data is included.
 * Display: MMM DD, YYYY (e.g. Jun 30, 2026 to Jul 30, 2026)
 */
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n) {
	return String(n).padStart(2, '0');
}

function monthIndexFromAbbr(abbr) {
	return MONTH_ABBR.findIndex((m) => m.toLowerCase() === String(abbr || '').toLowerCase());
}

function toIsoDate(d) {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDisplayDate(d) {
	return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function expandApiEndDateToMonthEnd(endDateYmd) {
	if (!endDateYmd || !/^\d{4}-\d{2}-\d{2}/.test(String(endDateYmd))) {
		return endDateYmd;
	}
	const parts = String(endDateYmd).slice(0, 10).split('-').map(Number);
	const lastDay = new Date(parts[0], parts[1], 0);
	return toIsoDate(lastDay);
}

function getMonthEndCutoffRange(refDate) {
	const ref = refDate instanceof Date && !isNaN(refDate.getTime()) ? refDate : new Date();
	const y = ref.getFullYear();
	const m = ref.getMonth();
	const startAt = new Date(y, m + 1, 0);
	const endAt = new Date(y, m + 2, 0);
	endAt.setDate(endAt.getDate() - 1);
	const start = formatDisplayDate(startAt);
	const end = formatDisplayDate(endAt);
	const endDate = toIsoDate(endAt);
	return {
		startAt,
		endAt,
		defaultDate: [startAt, endAt],
		start,
		end,
		startDisplay: start,
		endDisplay: end,
		startDate: toIsoDate(startAt),
		endDate,
		endDateApi: expandApiEndDateToMonthEnd(endDate),
	};
}

function parseDisplayDate(value) {
	const s = String(value || '').trim();
	if (!s) return '';

	const mdy = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
	if (mdy) {
		const monthIdx = monthIndexFromAbbr(mdy[1]);
		if (monthIdx < 0) return '';
		return `${mdy[3]}-${pad2(monthIdx + 1)}-${pad2(parseInt(mdy[2], 10))}`;
	}

	const ymdAbbr = s.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})$/);
	if (ymdAbbr) {
		const monthIdx = monthIndexFromAbbr(ymdAbbr[2]);
		if (monthIdx < 0) return '';
		return `${ymdAbbr[1]}-${pad2(monthIdx + 1)}-${pad2(parseInt(ymdAbbr[3], 10))}`;
	}

	if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
	if (s.indexOf('T') !== -1) return s.split('T')[0];

	const d = new Date(s);
	if (!isNaN(d.getTime())) return toIsoDate(d);
	return '';
}

function toApiDate(value) {
	if (value == null || value === '') return '';
	const parsed = parseDisplayDate(value);
	if (parsed) return parsed;
	return String(value).trim();
}

function parseRangeString(str) {
	if (!str) return { start: '', end: '' };
	const parts = String(str).split(/\s+to\s+/i);
	if (parts.length < 2) {
		return { start: (parts[0] || '').trim(), end: (parts[0] || '').trim() };
	}
	return { start: parts[0].trim(), end: parts[1].trim() };
}

function parseRangeToApiDates(rangeStr) {
	const parsed = parseRangeString(rangeStr);
	const end = toApiDate(parsed.end);
	return {
		start: toApiDate(parsed.start),
		end: expandApiEndDateToMonthEnd(end),
	};
}

module.exports = {
	MONTH_ABBR,
	RANGE_DISPLAY_FORMAT: 'M j, Y',
	getMonthEndCutoffRange,
	expandApiEndDateToMonthEnd,
	toApiDate,
	formatDisplayDate,
	toIsoDate,
	parseDisplayDate,
	parseRangeString,
	parseRangeToApiDates,
};
