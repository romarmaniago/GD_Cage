/**
 * Split [Start] to [End] date inputs.
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
		if (!el) return '';
		if (el._flatpickr && el._flatpickr.altInput && el._flatpickr.altInput.value) {
			return el._flatpickr.altInput.value.trim();
		}
		return (el.value || '').trim();
	}

	function fitWidths(startEl, endEl) {
		if (!global.MonthEndCutoffRange) return;
		if (startEl && startEl._flatpickr) {
			global.MonthEndCutoffRange.fitSingleDatePickerInstance(startEl._flatpickr);
		}
		if (endEl && endEl._flatpickr) {
			global.MonthEndCutoffRange.fitSingleDatePickerInstance(endEl._flatpickr);
		}
	}

	function attach(config) {
		config = config || {};
		var rangePickerId = config.rangePickerId;
		var startId = config.startId;
		var endId = config.endId;
		var invalidMsg = config.invalidDateMessage || 'Invalid date range.';
		var minDate = config.minDate || null;
		var independent = !!config.independent;

		var startEl = document.getElementById(startId);
		var endEl = document.getElementById(endId);
		if (!startEl || !endEl || typeof global.flatpickr !== 'function') {
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
		var pickersReady = 0;
		var initialized = false;

		if (!minDate) {
			var now = new Date();
			var pad = function (n) { return String(n).padStart(2, '0'); };
			var earliest = new Date(now.getFullYear() - 1, 0, 1);
			minDate = earliest.getFullYear() + '-' + pad(earliest.getMonth() + 1) + '-' + pad(earliest.getDate());
		}

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
			if (startEl._flatpickr) startEl._flatpickr.setDate(rangeEl._flatpickr.selectedDates[0], false);
			if (endEl._flatpickr) endEl._flatpickr.setDate(rangeEl._flatpickr.selectedDates[1], false);
			syncing = false;
			setTimeout(function () { fitWidths(startEl, endEl); }, 0);
		}

		function applySplit(showAlert) {
			if (!initialized || syncing) return false;

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
			fitWidths(startEl, endEl);
			applySplit(false);
		}

		function pickerReady(_selectedDates, _dateStr, instance) {
			if (instance && instance.altInput) {
				var ph = (instance.input && instance.input.getAttribute('placeholder')) || '';
				if (ph) instance.altInput.setAttribute('placeholder', ph);
			}
			pickersReady += 1;
			if (pickersReady < 2) return;
			initialized = true;
			fitWidths(startEl, endEl);
		}

		var fpConfig = {
			enableTime: false,
			altInput: true,
			altFormat: 'M j, Y',
			dateFormat: 'Y-m-d',
			minDate: minDate,
			onChange: onSplitChanged,
			onClose: function (_selectedDates, _dateStr, instance) {
				if (global.MonthEndCutoffRange) {
					global.MonthEndCutoffRange.fitSingleDatePickerInstance(instance);
				}
			}
		};

		global.flatpickr('#' + startId, Object.assign({}, fpConfig, {
			onReady: pickerReady
		}));
		global.flatpickr('#' + endId, Object.assign({}, fpConfig, {
			onReady: pickerReady
		}));

		function onKeydown(e) {
			if (e.key === 'Enter') {
				e.preventDefault();
				applySplit(true);
			}
		}
		startEl.addEventListener('keydown', onKeydown);
		endEl.addEventListener('keydown', onKeydown);

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
