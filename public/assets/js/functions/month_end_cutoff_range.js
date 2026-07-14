/**
 * Month-end cut-off default range for flatpickr range pickers.
 * Normal:  start = last day of previous month, end = 2nd-to-last day of current month
 * Rollover (last day of month): start = last day of current month, end = 2nd-to-last of next month
 * Display: MMM DD, YYYY (e.g. Jun 30, 2026) — no time component.
 * Value/API: YYYY-MM-DD (e.g. 2026-06-30)
 */
(function (global) {
	function pad2(n) {
		return String(n).padStart(2, '0');
	}

	var MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	var FP_RANGE_VALUE_FORMAT = 'Y-m-d';
	var FP_RANGE_DISPLAY_FORMAT = 'M j, Y';
	var LEGACY_ALT_FORMATS = ['M d, Y', 'F j, Y', 'm/d/Y', 'Y-m-d H:i', 'Y-m-d H:i:S', 'Y-M-d'];

	function monthIndexFromAbbr(abbr) {
		var key = String(abbr || '').toLowerCase();
		for (var i = 0; i < MONTH_ABBR.length; i++) {
			if (MONTH_ABBR[i].toLowerCase() === key) return i;
		}
		return -1;
	}

	function toIsoDate(d) {
		return pad2(d.getFullYear()) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
	}

	function formatDisplayDate(d) {
		return MONTH_ABBR[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
	}

	function expandApiEndDateToMonthEnd(endDateYmd) {
		if (!endDateYmd || !/^\d{4}-\d{2}-\d{2}/.test(String(endDateYmd))) {
			return endDateYmd;
		}
		var parts = String(endDateYmd).slice(0, 10).split('-').map(Number);
		var lastDay = new Date(parts[0], parts[1], 0);
		return toIsoDate(lastDay);
	}

	function getMonthEndCutoffRange(refDate) {
		var ref = refDate instanceof Date && !isNaN(refDate.getTime()) ? refDate : new Date();
		var y = ref.getFullYear();
		var m = ref.getMonth();
		var lastDayOfMonth = new Date(y, m + 1, 0).getDate();
		var isLastDayOfMonth = ref.getDate() === lastDayOfMonth;
		var startAt;
		var endAt;
		if (isLastDayOfMonth) {
			startAt = new Date(y, m + 1, 0);
			endAt = new Date(y, m + 2, 0);
			endAt.setDate(endAt.getDate() - 1);
		} else {
			startAt = new Date(y, m, 0);
			endAt = new Date(y, m + 1, 0);
			endAt.setDate(endAt.getDate() - 1);
		}
		var start = formatDisplayDate(startAt);
		var end = formatDisplayDate(endAt);
		var endDate = toIsoDate(endAt);
		return {
			startAt: startAt,
			endAt: endAt,
			defaultDate: [startAt, endAt],
			start: start,
			end: end,
			startDisplay: start,
			endDisplay: end,
			startDate: toIsoDate(startAt),
			endDate: endDate,
			endDateApi: expandApiEndDateToMonthEnd(endDate),
		};
	}

	function parseDisplayDate(value) {
		var s = String(value || '').trim();
		if (!s) return '';

		var mdy = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
		if (mdy) {
			var monthIdx = monthIndexFromAbbr(mdy[1]);
			if (monthIdx < 0) return '';
			return mdy[3] + '-' + pad2(monthIdx + 1) + '-' + pad2(parseInt(mdy[2], 10));
		}

		var ymdAbbr = s.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})$/);
		if (ymdAbbr) {
			monthIdx = monthIndexFromAbbr(ymdAbbr[2]);
			if (monthIdx < 0) return '';
			return ymdAbbr[1] + '-' + pad2(monthIdx + 1) + '-' + pad2(parseInt(ymdAbbr[3], 10));
		}

		if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
		if (s.indexOf('T') !== -1) return s.split('T')[0];

		var d = new Date(s);
		if (!isNaN(d.getTime())) return toIsoDate(d);
		return '';
	}

	function toApiDate(value) {
		if (value == null || value === '') return '';
		var parsed = parseDisplayDate(value);
		if (parsed) return parsed;
		return String(value).trim();
	}

	function parseRangeString(str) {
		if (!str) return { start: '', end: '' };
		var parts = String(str).split(/\s+to\s+/i);
		if (parts.length < 2) {
			return { start: (parts[0] || '').trim(), end: (parts[0] || '').trim() };
		}
		return { start: parts[0].trim(), end: parts[1].trim() };
	}

	function normalizeRangeForApi(start, end) {
		start = toApiDate(start);
		end = expandApiEndDateToMonthEnd(toApiDate(end));
		if (!start || !end) return { start: start, end: end };
		return { start: start + ' 00:00:00', end: end + ' 23:59:59' };
	}

	function parseRangeToApiDates(rangeStr) {
		var parsed = parseRangeString(rangeStr);
		var end = toApiDate(parsed.end);
		return {
			start: toApiDate(parsed.start),
			end: expandApiEndDateToMonthEnd(end),
		};
	}

	function resolveRangeFromPicker(dateRange, fpElOrSelector) {
		var fpEl = null;
		if (fpElOrSelector) {
			fpEl = typeof fpElOrSelector === 'string'
				? (typeof document !== 'undefined' ? document.getElementById(fpElOrSelector) : null)
				: fpElOrSelector;
		}
		var fp = fpEl && fpEl._flatpickr;
		var rangeStr = dateRange == null ? '' : String(dateRange).trim();

		if ((!rangeStr || !/\s+to\s+/i.test(rangeStr)) && fp && fp.selectedDates && fp.selectedDates.length === 2) {
			rangeStr = formatDisplayDate(fp.selectedDates[0]) + ' to ' + formatDisplayDate(fp.selectedDates[1]);
		}

		if (!rangeStr) {
			var fallback = getMonthEndCutoffRange();
			rangeStr = fallback.start + ' to ' + fallback.end;
		}

		var parsed = parseRangeString(rangeStr);
		var endDisplay = toApiDate(parsed.end);
		return {
			rangeStr: rangeStr,
			start: toApiDate(parsed.start),
			end: expandApiEndDateToMonthEnd(endDisplay),
			endDisplay: endDisplay,
		};
	}

	var RANGE_WRAP_SELECTORS = '.commission-daterange-wrap,.commission-panel-daterange-wrap,.daily-report-list-daterange-wrap,.hb-field-daterange-wrap,.house-expense-daterange-wrap,.fnb-hotel-daterange-wrap,.junket-loss-daterange-wrap,.additional-commission-daterange-wrap,.house-expense-split-daterange,[id$="-split-daterange-wrapper"],#daterange-wrapper';
	var DEFAULT_RANGE_SAMPLE = 'Jun 30, 2026 to Jul 30, 2026';
	var DEFAULT_SINGLE_DATE_SAMPLE = 'Sep 30, 2026';

	function getRangeWidthMeasurer() {
		var el = document.getElementById('fp-range-width-measurer');
		if (!el && typeof document !== 'undefined') {
			el = document.createElement('span');
			el.id = 'fp-range-width-measurer';
			el.setAttribute('aria-hidden', 'true');
			el.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;pointer-events:none;';
			document.body.appendChild(el);
		}
		return el;
	}

	function measureTextWidth(text, referenceEl) {
		var measurer = getRangeWidthMeasurer();
		if (!measurer) return 280;
		var style = referenceEl ? global.getComputedStyle(referenceEl) : null;
		measurer.style.fontFamily = style ? style.fontFamily : '';
		measurer.style.fontSize = style ? style.fontSize : '13px';
		measurer.style.fontWeight = style ? style.fontWeight : '';
		measurer.style.letterSpacing = style ? style.letterSpacing : '';
		measurer.textContent = text || DEFAULT_RANGE_SAMPLE;
		return measurer.offsetWidth;
	}

	function fitRangeInputWidth(inputEl) {
		if (!inputEl || inputEl.type === 'hidden') return;
		var text = (inputEl.value || '').trim();
		if (!text) text = (inputEl.getAttribute('placeholder') || '').trim();
		if (!text) text = DEFAULT_RANGE_SAMPLE;

		var pad = 32;
		var minW = measureTextWidth(DEFAULT_RANGE_SAMPLE, inputEl) + pad;
		var w = Math.max(measureTextWidth(text, inputEl) + pad, minW, 160);

		inputEl.classList.add('fp-auto-range-width');
		inputEl.style.width = w + 'px';
		inputEl.style.minWidth = minW + 'px';
		inputEl.style.maxWidth = 'none';

		var wrap = inputEl.closest(RANGE_WRAP_SELECTORS);
		if (wrap) {
			wrap.style.width = w + 'px';
			var fpWrap = wrap.querySelector('.flatpickr-wrapper');
			if (fpWrap) fpWrap.style.width = w + 'px';
		}
	}

	function fitRangePickerInstance(instance) {
		if (!instance) return;
		var visible = instance.altInput || instance.input;
		fitRangeInputWidth(visible);
	}

	function fitSingleDateInputWidth(inputEl) {
		if (!inputEl || inputEl.type === 'hidden') return;
		var text = (inputEl.value || '').trim();
		if (!text) text = (inputEl.getAttribute('placeholder') || '').trim();
		if (!text) text = DEFAULT_SINGLE_DATE_SAMPLE;

		var pad = 28;
		var minW = measureTextWidth(DEFAULT_SINGLE_DATE_SAMPLE, inputEl) + pad;
		var w = Math.max(measureTextWidth(text, inputEl) + pad, minW);

		inputEl.classList.add('fp-auto-range-width');
		inputEl.style.width = w + 'px';
		inputEl.style.minWidth = minW + 'px';
		inputEl.style.maxWidth = 'none';

		var fpWrap = inputEl.closest('.flatpickr-wrapper');
		if (fpWrap) fpWrap.style.width = w + 'px';
	}

	function fitSingleDatePickerInstance(instance) {
		if (!instance) return;
		var visible = instance.altInput || instance.input;
		fitSingleDateInputWidth(visible);
	}

	function chainRangeHook(config, hookName, fn) {
		var prev = config[hookName];
		config[hookName] = function () {
			var args = arguments;
			var ctx = this;
			var runFit = function () {
				try { fn.apply(ctx, args); } catch (e) { /* ignore */ }
			};
			if (typeof prev === 'function') {
				var result = prev.apply(ctx, args);
				runFit();
				return result;
			}
			runFit();
		};
	}

	function resizeAllRangePickers() {
		if (!global.flatpickr || !Array.isArray(global.flatpickr.instances)) return;
		global.flatpickr.instances.forEach(function (inst) {
			if (inst.config && inst.config.mode === 'range') {
				fitRangePickerInstance(inst);
			}
		});
	}

	function patchRangePickerConfig(config) {
		config = config || {};
		if (config.mode !== 'range') {
			return config;
		}
		var merged = Object.assign({}, config);

		if (!merged.skipRangeDisplayFormat) {
			merged.enableTime = false;
			delete merged.time_24hr;
			if (merged.altInput !== false) {
				merged.altInput = true;
				if (!merged.altFormat || LEGACY_ALT_FORMATS.indexOf(merged.altFormat) !== -1) {
					merged.altFormat = FP_RANGE_DISPLAY_FORMAT;
				}
			}
			if (!merged.dateFormat || ['Y-m-d', 'Y-m-d H:i', 'Y-m-d H:i:S'].indexOf(merged.dateFormat) !== -1) {
				merged.dateFormat = FP_RANGE_VALUE_FORMAT;
			}
		}

		if (!merged.skipMonthEndCutoff && merged.defaultDate === undefined) {
			var range = getMonthEndCutoffRange();
			merged.defaultDate = range.defaultDate;
		}

		if (!merged.skipAutoRangeWidth) {
			chainRangeHook(merged, 'onReady', function (selectedDates, dateStr, instance) {
				setTimeout(function () { fitRangePickerInstance(instance); }, 0);
			});
			chainRangeHook(merged, 'onChange', function (selectedDates, dateStr, instance) {
				fitRangePickerInstance(instance);
			});
			chainRangeHook(merged, 'onClose', function (selectedDates, dateStr, instance) {
				fitRangePickerInstance(instance);
			});
			chainRangeHook(merged, 'onValueUpdate', function (selectedDates, dateStr, instance) {
				fitRangePickerInstance(instance);
			});
		}

		return merged;
	}

	function installMonthEndCutoffHook() {
		var fp = global.flatpickr;
		if (!fp || fp.__fpMonthEndCutoffHook) {
			return !!fp;
		}
		var original = fp;
		function wrappedFlatpickr(selector, config) {
			return original(selector, patchRangePickerConfig(config));
		}
		Object.keys(original).forEach(function (key) {
			wrappedFlatpickr[key] = original[key];
		});
		wrappedFlatpickr.__fpMonthEndCutoffHook = true;
		wrappedFlatpickr.__fpMonthRangeHook = original.__fpMonthRangeHook;
		global.flatpickr = wrappedFlatpickr;
		return true;
	}

	var MonthEndCutoffRange = {
		MONTH_ABBR: MONTH_ABBR,
		FP_RANGE_VALUE_FORMAT: FP_RANGE_VALUE_FORMAT,
		FP_RANGE_DISPLAY_FORMAT: FP_RANGE_DISPLAY_FORMAT,
		RANGE_DISPLAY_FORMAT: FP_RANGE_DISPLAY_FORMAT,
		formatDisplayDate: formatDisplayDate,
		getMonthEndCutoffRange: getMonthEndCutoffRange,
		expandApiEndDateToMonthEnd: expandApiEndDateToMonthEnd,
		toApiDate: toApiDate,
		parseDisplayDate: parseDisplayDate,
		parseRangeString: parseRangeString,
		parseRangeToApiDates: parseRangeToApiDates,
		resolveRangeFromPicker: resolveRangeFromPicker,
		normalizeRangeForApi: normalizeRangeForApi,
		patchRangePickerConfig: patchRangePickerConfig,
		fitRangeInputWidth: fitRangeInputWidth,
		fitRangePickerInstance: fitRangePickerInstance,
		fitSingleDateInputWidth: fitSingleDateInputWidth,
		fitSingleDatePickerInstance: fitSingleDatePickerInstance,
		resizeAllRangePickers: resizeAllRangePickers,
	};

	global.MonthEndCutoffRange = MonthEndCutoffRange;
	global.getMonthEndCutoffRange = getMonthEndCutoffRange;
	global.parseToYmd = function (str) {
		return toApiDate(str) || '';
	};

	installMonthEndCutoffHook();
	if (typeof document !== 'undefined') {
		document.addEventListener('DOMContentLoaded', installMonthEndCutoffHook);
		document.addEventListener('DOMContentLoaded', function () {
			setTimeout(resizeAllRangePickers, 50);
			setTimeout(resizeAllRangePickers, 400);
			setTimeout(resizeAllRangePickers, 1200);
		});
		global.addEventListener('resize', function () {
			resizeAllRangePickers();
		});
		setTimeout(installMonthEndCutoffHook, 0);
		setTimeout(installMonthEndCutoffHook, 500);
	}
})(typeof window !== 'undefined' ? window : this);
