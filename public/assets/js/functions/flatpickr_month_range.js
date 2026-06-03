/**
 * Click a month name in a multi-month flatpickr range calendar to select that full month.
 * Auto-applies to all flatpickr instances in range mode.
 */
(function (global) {
	function flatpickrToDate(instance, value) {
		if (!value) return null;
		if (value instanceof Date && !isNaN(value.getTime())) {
			return new Date(value.getTime());
		}
		if (typeof instance.parseDate === 'function') {
			var parsed = instance.parseDate(value, instance.config.dateFormat);
			if (parsed instanceof Date && !isNaN(parsed.getTime())) {
				return parsed;
			}
		}
		var fallback = new Date(value);
		return isNaN(fallback.getTime()) ? null : fallback;
	}

	function clampDateRangeToFlatpickrLimits(instance, start, end) {
		var s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
		var e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
		var minD = flatpickrToDate(instance, instance.config.minDate);
		var maxD = flatpickrToDate(instance, instance.config.maxDate);
		if (minD) {
			minD = new Date(minD.getFullYear(), minD.getMonth(), minD.getDate());
			if (s < minD) s = minD;
		}
		if (maxD) {
			maxD = new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate());
			if (e > maxD) e = maxD;
		}
		if (s > e) return null;
		return [s, e];
	}

	function selectEntireFlatpickrMonth(instance, panelIndex) {
		if (!instance || panelIndex < 0) return;
		var anchor = new Date(instance.currentYear, instance.currentMonth + panelIndex, 1);
		var monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
		var monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
		var clamped = clampDateRangeToFlatpickrLimits(instance, monthStart, monthEnd);
		if (!clamped) return;
		instance.setDate(clamped, true);
		instance.close();
	}

	function bindFlatpickrMonthNameRangeSelect(instance) {
		if (!instance || !instance.calendarContainer || instance.config.mode !== 'range') {
			return;
		}
		var container = instance.calendarContainer;
		if (container.dataset.monthRangeSelectBound === '1') {
			return;
		}
		container.dataset.monthRangeSelectBound = '1';
		container.addEventListener('click', function (e) {
			var target = e.target;
			if (!target || !target.classList || !target.classList.contains('cur-month')) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			var monthEl = target.closest('.flatpickr-month');
			if (!monthEl) return;
			var panels = container.querySelectorAll('.flatpickr-month');
			var panelIndex = Array.prototype.indexOf.call(panels, monthEl);
			selectEntireFlatpickrMonth(instance, panelIndex);
		});
	}

	function styleFlatpickrMonthNameClickable(instance) {
		if (!instance || !instance.calendarContainer || instance.config.mode !== 'range') {
			return;
		}
		instance.calendarContainer.querySelectorAll('.cur-month').forEach(function (el) {
			el.style.cursor = 'pointer';
			if (!el.getAttribute('title')) {
				el.setAttribute('title', 'Select entire month');
			}
		});
	}

	function setupFlatpickrMonthNameRangeSelect(instance) {
		bindFlatpickrMonthNameRangeSelect(instance);
		styleFlatpickrMonthNameClickable(instance);
	}

	function patchFlatpickrConfig(config) {
		config = config || {};
		if (config.mode !== 'range') {
			return config;
		}
		var userOnReady = config.onReady;
		var userOnOpen = config.onOpen;
		return Object.assign({}, config, {
			onReady: function (selectedDates, dateStr, instance) {
				setupFlatpickrMonthNameRangeSelect(instance);
				if (typeof userOnReady === 'function') {
					userOnReady.call(this, selectedDates, dateStr, instance);
				}
			},
			onOpen: function (selectedDates, dateStr, instance) {
				if (typeof userOnOpen === 'function') {
					userOnOpen.call(this, selectedDates, dateStr, instance);
				}
				setupFlatpickrMonthNameRangeSelect(instance);
			}
		});
	}

	function installFlatpickrMonthRangeHook() {
		var fp = global.flatpickr;
		if (!fp || fp.__fpMonthRangeHook) {
			return !!fp;
		}
		var original = fp;
		function wrappedFlatpickr(selector, config) {
			return original(selector, patchFlatpickrConfig(config));
		}
		Object.keys(original).forEach(function (key) {
			wrappedFlatpickr[key] = original[key];
		});
		wrappedFlatpickr.__fpMonthRangeHook = true;
		global.flatpickr = wrappedFlatpickr;
		return true;
	}

	global.bindFlatpickrMonthNameRangeSelect = bindFlatpickrMonthNameRangeSelect;
	global.setupFlatpickrMonthNameRangeSelect = setupFlatpickrMonthNameRangeSelect;
	global.styleFlatpickrMonthNameClickable = styleFlatpickrMonthNameClickable;

	installFlatpickrMonthRangeHook();
	if (typeof document !== 'undefined') {
		document.addEventListener('DOMContentLoaded', installFlatpickrMonthRangeHook);
		setTimeout(installFlatpickrMonthRangeHook, 0);
		setTimeout(installFlatpickrMonthRangeHook, 500);
	}
})(typeof window !== 'undefined' ? window : this);
