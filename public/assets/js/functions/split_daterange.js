/**
 * Split [Start] to [End] date inputs — manual text entry (no calendar picker).
 * By default independent from the combined range picker (no two-way sync).
 * Pass independent: false to restore legacy sync with rangePickerId.
 */
(function (global) {
	function parseIsoDateLocal(value) {
		var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!m) return null;
		return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	}

	function getDisplayValue(el) {
		return el ? String(el.value || '').trim() : '';
	}

	function fitWidths(startEl, endEl) {
		if (!global.MonthEndCutoffRange) return;
		if (typeof global.MonthEndCutoffRange.fitSingleDateInputWidth === 'function') {
			if (startEl) global.MonthEndCutoffRange.fitSingleDateInputWidth(startEl);
			if (endEl) global.MonthEndCutoffRange.fitSingleDateInputWidth(endEl);
			return;
		}
	}

	function getWrapper(startEl, splitWrapperId) {
		if (splitWrapperId) {
			return document.getElementById(splitWrapperId);
		}
		return startEl ? startEl.closest('[id$="-split-daterange-wrapper"]') : null;
	}

	function getDefaultRange(startEl, splitWrapperId) {
		var wrap = getWrapper(startEl, splitWrapperId);
		if (!wrap) return { start: '', end: '' };
		return {
			start: String(wrap.getAttribute('data-range-start') || '').trim(),
			end: String(wrap.getAttribute('data-range-end') || '').trim()
		};
	}

	function normalizeManualDateInput(el) {
		if (!el || !global.MonthEndCutoffRange) return;
		var raw = getDisplayValue(el);
		if (!raw) return;
		var api = global.MonthEndCutoffRange.toApiDate(raw);
		if (!api) return;
		var parts = String(api).slice(0, 10).split('-').map(Number);
		var dt = new Date(parts[0], parts[1] - 1, parts[2]);
		if (isNaN(dt.getTime())) return;
		el.value = global.MonthEndCutoffRange.formatDisplayDate(dt);
	}

	function attach(config) {
		config = config || {};
		var rangePickerId = config.rangePickerId;
		var startId = config.startId;
		var endId = config.endId;
		var splitWrapperId = config.splitWrapperId;
		var invalidMsg = config.invalidDateMessage || 'Invalid date range.';
		var independent = !!config.independent;

		var startEl = document.getElementById(startId);
		var endEl = document.getElementById(endId);
		if (!startEl || !endEl) {
			return {
				syncFromRange: function () {},
				applySplit: function () { return false; },
				fitWidths: function () {},
				isSyncing: function () { return false; },
				setSyncing: function () {},
				getApiValues: function () { return { start: '', end: '' }; }
			};
		}

		var syncing = false;
		var initialized = false;

		function getRangeEl() {
			return rangePickerId ? document.getElementById(rangePickerId) : null;
		}

		function getApiValues() {
			var startDisplay = getDisplayValue(startEl);
			var endDisplay = getDisplayValue(endEl);
			if (!startDisplay || !endDisplay) return { start: '', end: '' };
			if (global.MonthEndCutoffRange) {
				return {
					start: global.MonthEndCutoffRange.toApiDate(startDisplay),
					end: global.MonthEndCutoffRange.toApiDate(endDisplay)
				};
			}
			return { start: startDisplay, end: endDisplay };
		}

		function syncFromRange() {
			if (independent || syncing) return;
			var rangeEl = getRangeEl();
			if (!rangeEl || !rangeEl._flatpickr || rangeEl._flatpickr.selectedDates.length < 2) return;

			syncing = true;
			var selected = rangeEl._flatpickr.selectedDates;
			if (global.MonthEndCutoffRange) {
				startEl.value = global.MonthEndCutoffRange.formatDisplayDate(selected[0]);
				endEl.value = global.MonthEndCutoffRange.formatDisplayDate(selected[1]);
			}
			syncing = false;
			setTimeout(function () { fitWidths(startEl, endEl); }, 0);
		}

		function applySplit(showAlert) {
			if (!initialized || syncing) return false;

			normalizeManualDateInput(startEl);
			normalizeManualDateInput(endEl);
			fitWidths(startEl, endEl);

			var api = getApiValues();
			if (!api.start || !api.end) return false;

			var startDate = parseIsoDateLocal(api.start);
			var endDate = parseIsoDateLocal(api.end);
			if (!startDate || !endDate || endDate < startDate) {
				if (showAlert !== false) alert(invalidMsg);
				return false;
			}

			if (independent) {
				if (typeof config.onRangeApplied === 'function') {
					config.onRangeApplied({
						start: api.start,
						end: api.end,
						startDate: startDate,
						endDate: endDate
					});
				}
				return true;
			}

			var rangeEl = getRangeEl();
			if (!rangeEl || !rangeEl._flatpickr) return false;

			syncing = true;
			rangeEl._flatpickr.setDate([startDate, endDate], true);
			if (global.MonthEndCutoffRange && typeof global.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
				global.MonthEndCutoffRange.fitRangePickerInstance(rangeEl._flatpickr);
			}
			syncing = false;
			if (typeof config.onRangeApplied === 'function') {
				config.onRangeApplied(rangeEl._flatpickr.selectedDates, rangeEl._flatpickr);
			}
			return true;
		}

		function onSplitChanged() {
			if (!initialized || syncing) return;
			applySplit(false);
		}

		function onBlur() {
			if (!initialized || syncing) return;
			normalizeManualDateInput(this);
			fitWidths(startEl, endEl);
			applySplit(false);
		}

		function onKeydown(e) {
			if (e.key === 'Enter') {
				e.preventDefault();
				normalizeManualDateInput(startEl);
				normalizeManualDateInput(endEl);
				fitWidths(startEl, endEl);
				applySplit(true);
			}
		}

		var defaults = getDefaultRange(startEl, splitWrapperId);
		if (!getDisplayValue(startEl) && defaults.start) startEl.value = defaults.start;
		if (!getDisplayValue(endEl) && defaults.end) endEl.value = defaults.end;

		startEl.setAttribute('inputmode', 'text');
		endEl.setAttribute('inputmode', 'text');
		startEl.removeAttribute('readonly');
		endEl.removeAttribute('readonly');

		startEl.addEventListener('blur', onBlur);
		endEl.addEventListener('blur', onBlur);
		startEl.addEventListener('change', onSplitChanged);
		endEl.addEventListener('change', onSplitChanged);
		startEl.addEventListener('keydown', onKeydown);
		endEl.addEventListener('keydown', onKeydown);

		initialized = true;
		fitWidths(startEl, endEl);

		return {
			syncFromRange: syncFromRange,
			applySplit: applySplit,
			fitWidths: function () { fitWidths(startEl, endEl); },
			isSyncing: function () { return syncing; },
			setSyncing: function (value) { syncing = !!value; },
			getApiValues: getApiValues
		};
	}

	global.SplitDateRange = { attach: attach };
})(typeof window !== 'undefined' ? window : this);
