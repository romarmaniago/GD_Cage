let tipTable;
let tipInResetting = false;
let tipRollerHistory = [];
let tipAutocompleteInstances = [];
let tipInProgramDatePicker = null;
let tipSettlementProgramDatePicker = null;
let tipPageDateStart = null;
let tipPageDateEnd = null;
let tipPageSplitDateRange = null;
let tipInEditId = null;
let tipSettlementEditId = null;
let tipSettlementEditBaseAmount = 0;

function formatMoney(n) {
	return (Number(n) || 0).toLocaleString('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2
	});
}

function formatProgramDateYmd(date) {
	var d = date instanceof Date ? date : new Date(date);
	if (Number.isNaN(d.getTime())) return '';
	var y = d.getFullYear();
	var m = String(d.getMonth() + 1).padStart(2, '0');
	var day = String(d.getDate()).padStart(2, '0');
	return y + '-' + m + '-' + day;
}

function todayProgramDateValue() {
	return formatProgramDateYmd(new Date());
}

function getTipProgramDateValue(inputId) {
	var el = document.getElementById(inputId);
	if (!el) return '';
	if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates[0]) {
		return formatProgramDateYmd(el._flatpickr.selectedDates[0]);
	}
	return String(el.value || '').trim().slice(0, 10);
}

function ensureTipProgramDatePicker(inputId, pickerRefName, defaultDate) {
	var el = document.getElementById(inputId);
	if (!el) return;
	var dateVal = defaultDate || getTipProgramDateValue(inputId) || todayProgramDateValue();
	if (typeof flatpickr === 'undefined') {
		el.value = dateVal;
		return;
	}
	if (el._flatpickr) {
		try {
			el._flatpickr.destroy();
		} catch (e) {}
	}
	var picker = flatpickr(el, {
		enableTime: false,
		dateFormat: 'Y-m-d',
		altInput: true,
		altFormat: 'M j, Y',
		defaultDate: dateVal,
		allowInput: true,
		disableMobile: true,
		closeOnSelect: true
	});
	if (pickerRefName === 'tipIn') tipInProgramDatePicker = picker;
	if (pickerRefName === 'tipSettlement') tipSettlementProgramDatePicker = picker;
}

function parseSettlementAmount(raw) {
	const clean = String(raw || '').replace(/,/g, '').trim();
	if (clean === '') return NaN;
	const n = Number(clean);
	return Number.isFinite(n) && n > 0 ? n : NaN;
}

function formatSettlementAmountInput(raw) {
	const digits = String(raw || '').replace(/,/g, '').replace(/[^\d]/g, '');
	if (!digits) return '';
	return formatMoney(Number(digits));
}

function wireTipSettlementAmountInput() {
	$('#tip-settlement-modal-amount').on('input', function () {
		var formatted = formatSettlementAmountInput(this.value);
		if (this.value !== formatted) {
			this.value = formatted;
		}
	});
}

function wireTipInAmountInput() {
	$('#tip-in-modal-amount').on('input', function () {
		var formatted = formatSettlementAmountInput(this.value);
		if (this.value !== formatted) {
			this.value = formatted;
		}
	});
}

function initTipInAccountSelect() {
	var $sel = $('#tip-in-modal-account');
	if (!$sel.length || typeof $sel.select2 !== 'function') return;
	if ($sel.data('select2')) {
		try {
			$sel.select2('destroy');
		} catch (e) {}
	}
	$sel.select2({
		placeholder: $sel.data('placeholder') || 'Choose account',
		allowClear: false,
		dropdownParent: $('#modal-tip-in')
	});
}

function initTipInGuestSelect() {
	var $sel = $('#tip-in-modal-guest');
	if (!$sel.length || typeof $sel.select2 !== 'function') return;
	if ($sel.data('select2')) {
		try {
			$sel.select2('destroy');
		} catch (e) {}
	}
	$sel.select2({
		placeholder: $sel.data('placeholder') || 'Choose guest',
		allowClear: false,
		dropdownParent: $('#modal-tip-in')
	});
}

function loadTipInAccounts() {
	var $sel = $('#tip-in-modal-account');
	var placeholder = $sel.data('placeholder') || 'Choose account';
	return $.getJSON('/account_data')
		.then(function (rows) {
			if ($sel.data('select2')) {
				try {
					$sel.select2('destroy');
				} catch (e) {}
			}
			$sel.empty().append($('<option/>', { value: '', text: placeholder }));
			(rows || []).forEach(function (a) {
				var id = a.account_id;
				if (id == null) return;
				var parts = [a.agent_code, a.agent_name].filter(Boolean);
				var label = parts.length ? parts.join(' - ') : 'Account #' + id;
				$sel.append(
					$('<option/>', {
						value: String(id),
						text: label,
						'data-agent-id': a.agent_id != null ? String(a.agent_id) : ''
					})
				);
			});
			initTipInAccountSelect();
		});
}

function loadTipInGuests(agentId) {
	var $sel = $('#tip-in-modal-guest');
	var placeholder = $sel.data('placeholder') || 'Choose guest';
	var url = agentId
		? '/guest_data?agentId=' + encodeURIComponent(agentId)
		: '/guest_data?all=1';

	return $.getJSON(url)
		.then(function (rows) {
			if ($sel.data('select2')) {
				try {
					$sel.select2('destroy');
				} catch (e) {}
			}
			$sel.empty().append($('<option/>', { value: '', text: placeholder }));
			(rows || []).forEach(function (g) {
				var id = g.guest_id;
				if (id == null) return;
				var name = (g.guest_name || '').toString().trim() || ('Guest #' + id);
				$sel.append($('<option/>', { value: String(id), text: name }));
			});
			initTipInGuestSelect();
		});
}

function resetTipInModal() {
	tipInResetting = true;
	var $accountSel = $('#tip-in-modal-account');
	var $guestSel = $('#tip-in-modal-guest');
	if ($accountSel.data('select2')) {
		$accountSel.val('').trigger('change');
	} else {
		$accountSel.val('');
	}
	if ($guestSel.data('select2')) {
		$guestSel.val('').trigger('change');
	} else {
		$guestSel.val('');
	}
	$('#tip-in-modal-amount, #tip-in-modal-status, #tip-in-modal-name, #tip-in-modal-remarks')
		.val('')
		.removeClass('is-invalid');
	ensureTipProgramDatePicker('tip-in-modal-program-date', 'tipIn', todayProgramDateValue());
	$('#tip-in-modal-program-date').removeClass('is-invalid');
	tipInResetting = false;
}

function setTipInModalTitle(isEdit) {
	var i18n = window.tipInI18n || {};
	var $label = $('#modal-tip-in-label');
	if (!$label.data('default-title')) {
		$label.data('default-title', $.trim($label.text()));
	}
	$label.text(isEdit ? (i18n.editTitle || 'Edit Tip') : ($label.data('default-title') || 'Tip In'));
}

function openTipInModal() {
	tipInEditId = null;
	setTipInModalTitle(false);
	resetTipInModal();
	var modalEl = document.getElementById('modal-tip-in');
	if (modalEl && window.bootstrap && bootstrap.Modal) {
		bootstrap.Modal.getOrCreateInstance(modalEl).show();
	}
	$.when(loadTipInAccounts(), loadTipInGuests(null), fetchTipRollerHistory(null)).fail(function () {
		Swal.fire('Error', 'Failed to load account or guest list.', 'error');
	}).always(function () {
		refreshTipAutocompletes();
	});
	setTimeout(function () {
		$('#tip-in-modal-amount').trigger('focus');
	}, 200);
}

function openTipInEditModal(row) {
	if (!row || !row.EDIT_ID) return;
	tipInEditId = row.EDIT_ID;
	setTipInModalTitle(true);
	resetTipInModal();

	var modalEl = document.getElementById('modal-tip-in');
	if (modalEl && window.bootstrap && bootstrap.Modal) {
		bootstrap.Modal.getOrCreateInstance(modalEl).show();
	}

	var accountId = row.EDIT_ACCOUNT_ID != null ? String(row.EDIT_ACCOUNT_ID) : '';
	var guestId = row.EDIT_GUEST_ID != null ? String(row.EDIT_GUEST_ID) : '';

	tipInResetting = true;
	$.when(loadTipInAccounts(), loadTipInGuests(null), fetchTipRollerHistory(accountId || null))
		.always(function () {
			var $accountSel = $('#tip-in-modal-account');
			if (accountId) {
				$accountSel.val(accountId);
				if ($accountSel.data('select2')) $accountSel.trigger('change.select2');
			}
			var agentId = ($accountSel.find('option:selected').data('agent-id') || '').toString().trim();
			$.when(loadTipInGuests(agentId || null)).always(function () {
				var $guestSel = $('#tip-in-modal-guest');
				if (guestId) {
					$guestSel.val(guestId);
					if ($guestSel.data('select2')) $guestSel.trigger('change.select2');
				}
				tipInResetting = false;
			});
			$('#tip-in-modal-amount').val(formatMoney(row.EDIT_AMOUNT));
			$('#tip-in-modal-status').val(row.EDIT_STATUS && row.EDIT_STATUS !== '—' ? row.EDIT_STATUS : '');
			$('#tip-in-modal-name').val(row.EDIT_NAME && row.EDIT_NAME !== '—' ? row.EDIT_NAME : '');
			$('#tip-in-modal-remarks').val(row.EDIT_REMARKS || '');
			if (row.EDIT_PROGRAM_DATE) {
				ensureTipProgramDatePicker('tip-in-modal-program-date', 'tipIn', String(row.EDIT_PROGRAM_DATE).slice(0, 10));
			}
			refreshTipAutocompletes();
		});
}

function onTipInAccountChange() {
	if (tipInResetting) return;
	var $accountSel = $('#tip-in-modal-account');
	var agentId = ($accountSel.find('option:selected').data('agent-id') || '').toString().trim();
	var accountId = ($accountSel.val() || '').toString().trim();
	loadTipInGuests(agentId || null).fail(function () {
		Swal.fire('Error', 'Failed to load guests.', 'error');
	});
	fetchTipRollerHistory(accountId || null).then(refreshTipAutocompletes);
}

function fetchTipRollerHistory(accountId) {
	var url = '/tip_roller_history';
	if (accountId) {
		url += '?accountId=' + encodeURIComponent(accountId);
	}
	return $.getJSON(url)
		.then(function (data) {
			tipRollerHistory = Array.isArray(data && data.history) ? data.history : [];
			return tipRollerHistory;
		});
}

function initTipAutocompletes() {
	var AC = window.CreditGuarantorAutocomplete;
	if (!AC) return;
	tipAutocompleteInstances = [
		AC.initTipFieldAutocomplete(document.getElementById('tip-in-modal-name'), {
			fieldType: 'name',
			getHistoryRows: function () { return tipRollerHistory; }
		}),
		AC.initTipFieldAutocomplete(document.getElementById('tip-in-modal-status'), {
			fieldType: 'status',
			getHistoryRows: function () { return tipRollerHistory; },
			defaults: ['Roller', 'GM']
		}),
		AC.initTipFieldAutocomplete(document.getElementById('tip-settlement-modal-name'), {
			fieldType: 'name',
			getHistoryRows: function () { return tipRollerHistory; }
		}),
		AC.initTipFieldAutocomplete(document.getElementById('tip-settlement-modal-status'), {
			fieldType: 'status',
			getHistoryRows: function () { return tipRollerHistory; },
			defaults: ['Roller', 'GM']
		})
	].filter(Boolean);
}

function refreshTipAutocompletes() {
	if (window.CreditGuarantorAutocomplete) {
		window.CreditGuarantorAutocomplete.refreshGroup(tipAutocompleteInstances);
	}
}

function submitTipIn(event) {
	if (event) event.preventDefault();

	var i18n = window.tipInI18n || {};
	var $amountInput = $('#tip-in-modal-amount');
	var $statusInput = $('#tip-in-modal-status');
	var $nameInput = $('#tip-in-modal-name');
	var $programDateInput = $('#tip-in-modal-program-date');
	var $btn = $('#btn-tip-in-save');
	var amount = parseSettlementAmount($amountInput.val());
	var statusVal = ($statusInput.val() || '').toString().trim();
	var nameVal = ($nameInput.val() || '').toString().trim();
	var accountVal = ($('#tip-in-modal-account').val() || '').toString().trim();
	var guestVal = ($('#tip-in-modal-guest').val() || '').toString().trim();
	var programDate = getTipProgramDateValue('tip-in-modal-program-date');

	$amountInput.removeClass('is-invalid');
	$statusInput.removeClass('is-invalid');
	$nameInput.removeClass('is-invalid');
	$programDateInput.removeClass('is-invalid');

	if (!programDate || !/^\d{4}-\d{2}-\d{2}$/.test(programDate)) {
		$programDateInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Missing Program Date',
			text: i18n.missingProgramDate || 'Please select a program date.'
		});
		return;
	}

	if (Number.isNaN(amount)) {
		$amountInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Invalid Amount',
			text: i18n.invalidAmount || 'Enter a valid amount greater than zero.'
		});
		return;
	}

	if (!statusVal) {
		$statusInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Missing Status',
			text: i18n.missingStatus || 'Please enter the tip status (Roller or GM).'
		});
		return;
	}

	if (!nameVal) {
		$nameInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Missing Name',
			text: i18n.missingName || 'Please enter the name.'
		});
		return;
	}

	$btn.prop('disabled', true);
	var isEdit = tipInEditId != null;
	var payload = {
		txtAmount: $amountInput.val(),
		txtAccountId: accountVal,
		txtGuestId: guestVal,
		txtTipStatus: statusVal,
		txtRollerName: nameVal,
		txtProgramDate: programDate,
		txtRemarks: ($('#tip-in-modal-remarks').val() || '').toString().trim()
	};
	var request = isEdit
		? $.ajax({ url: '/tip_in/' + tipInEditId, method: 'PUT', data: payload })
		: $.post('/tip_in', payload);
	request
		.done(function (resp) {
			if (resp && resp.availableBalance != null) {
				updateRollerAvailableBalance(resp.availableBalance);
			}
			var modalEl = document.getElementById('modal-tip-in');
			if (modalEl && window.bootstrap && bootstrap.Modal) {
				bootstrap.Modal.getInstance(modalEl).hide();
			}
			tipInEditId = null;
			resetTipInModal();
			return refreshTipPage();
		})
		.then(function () {
			Swal.fire({
				icon: 'success',
				title: 'Saved',
				text: isEdit
					? (i18n.updated || 'Updated successfully.')
					: (i18n.saved || 'Roller tip saved successfully.'),
				timer: 1800,
				showConfirmButton: false
			});
		})
		.fail(function (xhr) {
			var message = xhr.responseJSON && xhr.responseJSON.message
				? xhr.responseJSON.message
				: 'Failed to save roller tip.';
			Swal.fire({ icon: 'error', title: 'Error', text: message });
		})
		.always(function () {
			$btn.prop('disabled', false);
		});
}

function formatSignedMoney(n) {
	const num = Number(n) || 0;
	if (num < 0) {
		return '(' + formatMoney(Math.abs(num)) + ')';
	}
	return formatMoney(num);
}

function renderAmountCell(value, type) {
	const n = value == null || value === '' ? 0 : Number(value) || 0;
	if (type === 'sort' || type === 'filter') return n;
	const cls = n < 0 ? 'tip-amount-negative' : '';
	return '<span class="' + cls + '">' + formatSignedMoney(n) + '</span>';
}

function renderTipTransactionCell(value, amount, type) {
	const label = String(value == null ? '' : value).trim();
	const numericAmount = Number(amount) || 0;
	if (type === 'sort' || type === 'filter') return label;
	if (!label) return '';
	const normalized = label.toLowerCase();
	if (normalized === 'out' || normalized === 'settlement' || normalized === 'settle') return 'OUT';
	if (normalized === 'roller tip') return 'Roller Tip';
	if (normalized === 'dealer tip') return 'Dealer Tip';
	if (normalized === 'in') return 'IN';
	if (numericAmount < 0) return 'OUT';
	if (numericAmount > 0) return 'IN';
	return label;
}

function getTipPageDefaultDateRange() {
	if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function') {
		return window.MonthEndCutoffRange.getMonthEndCutoffRange();
	}
	const now = new Date();
	const y = now.getFullYear();
	const m = now.getMonth();
	return {
		startAt: new Date(y, m, 0),
		endAt: new Date(y, m + 1, 0)
	};
}

function tipPageApiEndDate(endYmd) {
	if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
	const parts = String(endYmd).slice(0, 10).split('-').map(Number);
	const lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
	if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
		return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
	}
	return String(endYmd).slice(0, 10);
}

function tipPageYmdToLocalDate(ymd) {
	if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
	const parts = String(ymd).slice(0, 10).split('-').map(Number);
	return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function setTipPageFilterDatesFromSelectedDates(selectedDates) {
	if (!selectedDates || selectedDates.length === 0) {
		tipPageDateStart = null;
		tipPageDateEnd = null;
		return;
	}
	if (selectedDates.length === 1) {
		tipPageDateStart = selectedDates[0];
		tipPageDateEnd = selectedDates[0];
		return;
	}
	let start = selectedDates[0];
	let end = selectedDates[1];
	if (start > end) {
		const swap = start;
		start = end;
		end = swap;
	}
	tipPageDateStart = start;
	const endYmd = formatProgramDateYmd(end);
	const expanded = tipPageApiEndDate(endYmd);
	tipPageDateEnd = expanded !== endYmd ? tipPageYmdToLocalDate(expanded) : end;
}

function setTipPageFilterDatesFromApi(startYmd, endYmd) {
	let startDate = tipPageYmdToLocalDate(startYmd);
	let endDate = tipPageYmdToLocalDate(tipPageApiEndDate(endYmd));
	if (!startDate || !endDate) return;
	if (startDate > endDate) {
		const swap = startDate;
		startDate = endDate;
		endDate = swap;
	}
	tipPageDateStart = startDate;
	tipPageDateEnd = endDate;
}

function applyTipPageDateFilterDraw() {
	if ($.fn.DataTable.isDataTable('#tip-tbl')) {
		$('#tip-tbl').DataTable().draw();
	}
}

function updateTipAmountTotals(api) {
	const rollerTotal = api
		.column(7, { search: 'applied' })
		.data()
		.reduce(function (sum, val) {
			return sum + (Number(val) || 0);
		}, 0);

	const dealerTotal = api
		.column(11, { search: 'applied' })
		.data()
		.reduce(function (sum, val) {
			return sum + (Number(val) || 0);
		}, 0);

	$(api.column(7).footer()).html(
		'<span class="' + (rollerTotal < 0 ? 'tip-amount-negative tip-roller-total' : 'tip-roller-total') + '">' + formatSignedMoney(rollerTotal) + '</span>'
	);
	$(api.column(11).footer()).html(
		'<span class="tip-dealer-total">' + formatMoney(dealerTotal) + '</span>'
	);
}

function updateRollerAvailableBalance(amount) {
	$('#tip-roller-available-balance').text(formatMoney(amount));
	$('#tip-settlement-modal-balance').text(formatMoney(amount));
}

function fetchRollerBalance() {
	return $.get('/tip_roller_balance')
		.then(function (data) {
			updateRollerAvailableBalance(data && data.available != null ? data.available : 0);
			return data;
		});
}

function fetchTipData() {
	return $.get('/tip_data')
		.then(function (rows) {
			tipTable.clear().rows.add(rows || []).draw();
		});
}

function refreshTipPage() {
	return $.when(fetchRollerBalance(), fetchTipData());
}

function initTipPageSplitDateRange() {
	if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
		tipPageSplitDateRange = { fitWidths: function () {} };
		return;
	}
	tipPageSplitDateRange = window.SplitDateRange.attach({
		rangePickerId: 'tip-daterange',
		startId: 'tip-start-date',
		endId: 'tip-end-date',
		splitWrapperId: 'tip-split-daterange-wrapper',
		independent: true,
		invalidDateMessage: 'Invalid date range.',
		onRangeApplied: function (range) {
			if (!range || !range.start || !range.end) return;
			setTipPageFilterDatesFromApi(range.start, range.end);
			applyTipPageDateFilterDraw();
		}
	});
}

function initTipPageDateRangePicker() {
	if (!$('#tip-daterange').length || typeof flatpickr === 'undefined') return;
	const el = document.getElementById('tip-daterange');
	if (el && el._flatpickr) return;

	const range = getTipPageDefaultDateRange();
	const start = range.startAt || range.start || range.startDate || null;
	const end = range.endAt || range.end || range.endDate || null;
	setTipPageFilterDatesFromSelectedDates(start && end ? [start, end] : []);

	initTipPageSplitDateRange();

	flatpickr('#tip-daterange', {
		mode: 'range',
		defaultDate: start && end ? [start, end] : undefined,
		showMonths: 3,
		onReady: function (selectedDates, _dateStr, instance) {
			if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
				window.setupFlatpickrMonthNameRangeSelect(instance);
			}
			setTipPageFilterDatesFromSelectedDates(selectedDates);
			applyTipPageDateFilterDraw();
		},
		onOpen: function (_selectedDates, _dateStr, instance) {
			if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
				window.setupFlatpickrMonthNameRangeSelect(instance);
			}
		},
		onMonthChange: function (_selectedDates, _dateStr, instance) {
			if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
				window.styleFlatpickrMonthNameClickable(instance);
			}
		},
		onChange: function (selectedDates) {
			if (selectedDates.length === 2) {
				setTipPageFilterDatesFromSelectedDates(selectedDates);
				applyTipPageDateFilterDraw();
			}
		}
	});
}

function resetTipSettlementModal() {
	$('#tip-settlement-modal-amount, #tip-settlement-modal-status, #tip-settlement-modal-name, #tip-settlement-modal-remarks')
		.val('')
		.removeClass('is-invalid');
	ensureTipProgramDatePicker('tip-settlement-modal-program-date', 'tipSettlement', todayProgramDateValue());
	$('#tip-settlement-modal-program-date').removeClass('is-invalid');
}

function setTipSettlementModalTitle(isEdit) {
	var i18n = window.tipSettlementI18n || {};
	var $label = $('#modal-tip-settlement-label');
	if (!$label.data('default-title')) {
		$label.data('default-title', $.trim($label.text()));
	}
	$label.text(isEdit ? (i18n.editTitle || 'Edit Tip') : ($label.data('default-title') || 'Tip Settlement'));
}

function openTipSettlementModal() {
	tipSettlementEditId = null;
	tipSettlementEditBaseAmount = 0;
	setTipSettlementModalTitle(false);
	resetTipSettlementModal();
	var availableText = ($('#tip-roller-available-balance').text() || '').replace(/,/g, '').trim();
	$('#tip-settlement-modal-balance').text(formatMoney(Number(availableText) || 0));
	var modalEl = document.getElementById('modal-tip-settlement');
	if (modalEl && window.bootstrap && bootstrap.Modal) {
		bootstrap.Modal.getOrCreateInstance(modalEl).show();
	}
	fetchTipRollerHistory(null).always(function () {
		refreshTipAutocompletes();
	});
	setTimeout(function () {
		$('#tip-settlement-modal-amount').trigger('focus');
	}, 200);
}

function openTipSettlementEditModal(row) {
	if (!row || !row.EDIT_ID) return;
	tipSettlementEditId = row.EDIT_ID;
	tipSettlementEditBaseAmount = Number(row.EDIT_AMOUNT) || 0;
	setTipSettlementModalTitle(true);
	resetTipSettlementModal();

	var availableText = ($('#tip-roller-available-balance').text() || '').replace(/,/g, '').trim();
	var available = (Number(availableText) || 0) + tipSettlementEditBaseAmount;
	$('#tip-settlement-modal-balance').text(formatMoney(available));

	$('#tip-settlement-modal-amount').val(formatMoney(tipSettlementEditBaseAmount));
	$('#tip-settlement-modal-status').val(row.EDIT_STATUS && row.EDIT_STATUS !== '—' ? row.EDIT_STATUS : '');
	$('#tip-settlement-modal-name').val(row.EDIT_NAME && row.EDIT_NAME !== '—' ? row.EDIT_NAME : '');
	$('#tip-settlement-modal-remarks').val(row.EDIT_REMARKS || '');
	if (row.EDIT_PROGRAM_DATE) {
		ensureTipProgramDatePicker('tip-settlement-modal-program-date', 'tipSettlement', String(row.EDIT_PROGRAM_DATE).slice(0, 10));
	}

	var modalEl = document.getElementById('modal-tip-settlement');
	if (modalEl && window.bootstrap && bootstrap.Modal) {
		bootstrap.Modal.getOrCreateInstance(modalEl).show();
	}
	fetchTipRollerHistory(null).always(function () {
		refreshTipAutocompletes();
	});
}

function submitTipSettlement(event) {
	if (event) event.preventDefault();

	var i18n = window.tipSettlementI18n || {};
	var $amountInput = $('#tip-settlement-modal-amount');
	var $statusInput = $('#tip-settlement-modal-status');
	var $nameInput = $('#tip-settlement-modal-name');
	var $programDateInput = $('#tip-settlement-modal-program-date');
	var $btn = $('#btn-tip-settlement-save');
	var amount = parseSettlementAmount($amountInput.val());
	var statusVal = ($statusInput.val() || '').toString().trim();
	var nameVal = ($nameInput.val() || '').toString().trim();
	var programDate = getTipProgramDateValue('tip-settlement-modal-program-date');

	$amountInput.removeClass('is-invalid');
	$statusInput.removeClass('is-invalid');
	$nameInput.removeClass('is-invalid');
	$programDateInput.removeClass('is-invalid');

	if (!programDate || !/^\d{4}-\d{2}-\d{2}$/.test(programDate)) {
		$programDateInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Missing Program Date',
			text: i18n.missingProgramDate || 'Please select a program date.'
		});
		return;
	}

	if (Number.isNaN(amount)) {
		$amountInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Invalid Amount',
			text: i18n.invalidAmount || 'Enter a valid settlement amount greater than zero.'
		});
		return;
	}

	var availableText = ($('#tip-roller-available-balance').text() || '').replace(/,/g, '').trim();
	var isEdit = tipSettlementEditId != null;
	var available = (Number(availableText) || 0) + (isEdit ? tipSettlementEditBaseAmount : 0);

	if (amount > available) {
		$amountInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Invalid Amount',
			text: i18n.exceedsBalance || 'Settlement amount cannot exceed available roller tip balance.'
		});
		return;
	}

	if (!statusVal) {
		$statusInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Missing Status',
			text: i18n.missingStatus || 'Please enter the tip status (Roller or GM).'
		});
		return;
	}

	if (!nameVal) {
		$nameInput.addClass('is-invalid');
		Swal.fire({
			icon: 'warning',
			title: 'Missing Name',
			text: i18n.missingName || 'Please enter the name.'
		});
		return;
	}

	$btn.prop('disabled', true);
	var settlementPayload = {
		txtAmount: $amountInput.val(),
		txtTipStatus: statusVal,
		txtRollerName: nameVal,
		txtProgramDate: programDate,
		txtRemarks: ($('#tip-settlement-modal-remarks').val() || '').toString().trim()
	};
	var settlementRequest = isEdit
		? $.ajax({ url: '/tip_settlement/' + tipSettlementEditId, method: 'PUT', data: settlementPayload })
		: $.post('/tip_settlement', settlementPayload);
	settlementRequest
		.done(function (resp) {
			if (resp && resp.availableBalance != null) {
				updateRollerAvailableBalance(resp.availableBalance);
			}
			var modalEl = document.getElementById('modal-tip-settlement');
			if (modalEl && window.bootstrap && bootstrap.Modal) {
				bootstrap.Modal.getInstance(modalEl).hide();
			}
			tipSettlementEditId = null;
			tipSettlementEditBaseAmount = 0;
			resetTipSettlementModal();
			return refreshTipPage();
		})
		.then(function () {
			Swal.fire({
				icon: 'success',
				title: 'Saved',
				text: isEdit
					? (i18n.updated || 'Updated successfully.')
					: (i18n.saved || 'Tip settlement saved successfully.'),
				timer: 1800,
				showConfirmButton: false
			});
		})
		.fail(function (xhr) {
			var message = xhr.responseJSON && xhr.responseJSON.message
				? xhr.responseJSON.message
				: 'Failed to save tip settlement.';
			Swal.fire({ icon: 'error', title: 'Error', text: message });
		})
		.always(function () {
			$btn.prop('disabled', false);
		});
}

/* ------------------------------------------------------------------ *
 * Row actions: Edit / Delete / Receipt
 * ------------------------------------------------------------------ */

function tipHtmlEscape(value) {
	return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
		return {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;'
		}[ch];
	});
}

function getTipActionsI18n() {
	return window.tipActionsI18n || {};
}

function renderTipActions(row) {
	if (!row || !row.EDIT_ID) return '';
	var i18n = getTipActionsI18n();
	var kind = row.ROW_KIND === 'tip_settlement' ? 'tip_settlement' : 'tip';
	var viewOnly = window.PermissionViewOnly && typeof window.PermissionViewOnly.isViewOnly === 'function' &&
		window.PermissionViewOnly.isViewOnly();
	var canEdit = row.CAN_EDIT !== false && !viewOnly;
	var attrs = ' data-tip-kind="' + kind + '" data-tip-id="' + row.EDIT_ID + '"';
	var html = '<div class="tip-action-btns">';
	html += '<button type="button" class="btn btn-sm btn-alt-secondary tip-receipt-btn"' + attrs +
		' title="' + tipHtmlEscape(i18n.receiptTitle || 'Receipt') + '"><i class="fa fa-receipt"></i></button>';
	if (canEdit) {
		html += '<button type="button" class="btn btn-sm btn-alt-primary tip-edit-btn" data-view-only-disable' + attrs +
			' title="' + tipHtmlEscape(i18n.editTitle || 'Edit') + '"><i class="fa fa-pencil-alt"></i></button>';
		html += '<button type="button" class="btn btn-sm btn-alt-danger tip-delete-btn" data-view-only-disable' + attrs +
			' title="' + tipHtmlEscape(i18n.deleteTitle || 'Delete') + '"><i class="fa fa-trash-alt"></i></button>';
	}
	html += '</div>';
	return html;
}

function getTipRowFromButton(btn) {
	if (!tipTable) return null;
	var tr = $(btn).closest('tr');
	if (!tr.length) return null;
	return tipTable.row(tr).data() || null;
}

function handleTipEditClick() {
	var row = getTipRowFromButton(this);
	if (!row) return;
	if (row.ROW_KIND === 'tip_settlement') {
		openTipSettlementEditModal(row);
	} else {
		openTipInEditModal(row);
	}
}

function handleTipDeleteClick() {
	var row = getTipRowFromButton(this);
	if (!row || !row.EDIT_ID) return;
	var i18n = getTipActionsI18n();
	var kind = row.ROW_KIND === 'tip_settlement' ? 'tip_settlement' : 'tip';
	var url = kind === 'tip_settlement'
		? '/tip_settlement/remove/' + row.EDIT_ID
		: '/tip/remove/' + row.EDIT_ID;

	Swal.fire({
		icon: 'warning',
		title: i18n.deleteConfirm || 'Delete this record?',
		text: i18n.deleteConfirmText || 'This cannot be undone.',
		showCancelButton: true,
		confirmButtonText: i18n.yes || 'Yes',
		cancelButtonText: i18n.cancel || 'Cancel',
		confirmButtonColor: '#dc3545'
	}).then(function (result) {
		if (!result.isConfirmed) return;
		$.ajax({ url: url, method: 'PUT' })
			.done(function (resp) {
				if (resp && resp.availableBalance != null) {
					updateRollerAvailableBalance(resp.availableBalance);
				}
				refreshTipPage();
				Swal.fire({
					icon: 'success',
					title: 'Deleted',
					text: i18n.deleted || 'Deleted successfully.',
					timer: 1600,
					showConfirmButton: false
				});
			})
			.fail(function (xhr) {
				var message = xhr.responseJSON && xhr.responseJSON.message
					? xhr.responseJSON.message
					: 'Failed to delete record.';
				Swal.fire({ icon: 'error', title: 'Error', text: message });
			});
	});
}

/* ---- Receipt slip ---- */

var tipReceiptHtml2CanvasPromise = null;

function loadTipReceiptHtml2Canvas() {
	if (typeof html2canvas !== 'undefined') return Promise.resolve();
	if (tipReceiptHtml2CanvasPromise) return tipReceiptHtml2CanvasPromise;
	tipReceiptHtml2CanvasPromise = new Promise(function (resolve, reject) {
		var script = document.createElement('script');
		script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
		script.onload = function () { resolve(); };
		script.onerror = function () {
			tipReceiptHtml2CanvasPromise = null;
			reject(new Error('Failed to load image copy library.'));
		};
		document.body.appendChild(script);
	});
	return tipReceiptHtml2CanvasPromise;
}

function tipReceiptDateTime(value) {
	if (!value) return '';
	if (window.moment) {
		var m = moment.utc(value).utcOffset(8);
		return m.isValid() ? m.format('YYYY-MM-DD HH:mm') : '';
	}
	return String(value).slice(0, 16).replace('T', ' ');
}

function tipReceiptHasValue(value) {
	if (value == null) return false;
	if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
	var s = String(value).trim();
	return s !== '' && s !== '—' && s !== '-';
}

function tipReceiptTextRow(label, value) {
	if (!tipReceiptHasValue(value)) return '';
	return '<tr><td class="trs-label">' + tipHtmlEscape(label) + '</td><td class="trs-value">' +
		tipHtmlEscape(String(value)) + '</td></tr>';
}

function tipReceiptAmountRow(label, value, withBorder, isSettlement) {
	var rowClass = withBorder === false ? '' : ' class="trs-total-row"';
	// Settlement amounts: red text wrapped in parentheses, e.g. (4,250).
	// All other amounts: plain black text.
	var num = Math.abs(Number(value) || 0);
	var display = isSettlement ? '(' + formatMoney(num) + ')' : formatMoney(num);
	var valueClass = isSettlement ? 'trs-value trs-amount-value' : 'trs-value trs-amount-black';
	return '<tr' + rowClass + '><td class="trs-label trs-total-label">' + tipHtmlEscape(label) +
		'</td><td class="' + valueClass + '">' + display + '</td></tr>';
}

function buildTipReceiptSlipHtml(data) {
	data = data || {};
	var programDate = data.program_date ? String(data.program_date).slice(0, 10) : '';
	var rows =
		tipReceiptTextRow('PROGRAM DATE', programDate) +
		tipReceiptTextRow('ACCOUNT', data.account) +
		tipReceiptTextRow('NAME', data.name) +
		tipReceiptTextRow('GUEST', data.guest) +
		tipReceiptTextRow('GAME #', data.game_no) +
		tipReceiptTextRow('STATUS', data.status) +
		tipReceiptTextRow('NAME', data.person_name) +
		tipReceiptTextRow('REMARKS', data.remarks);

	if (data.from_game) {
		// Game-linked tip: show Roller and Dealer amounts separately, no single AMOUNT.
		rows +=
			tipReceiptAmountRow('ROLLER', data.roller_amount, true, false) +
			tipReceiptAmountRow('DEALER', data.dealer_amount, false, false);
	} else {
		rows += tipReceiptAmountRow('AMOUNT', data.amount, true, !!data.is_settlement);
	}

	return (
		'<div class="tip-receipt-slip">' +
		'<div class="tip-receipt-slip-body">' +
		'<p class="trs-brand">GOLDEN DRAGON</p>' +
		'<p class="trs-title">' + tipHtmlEscape(data.title || '* Tip *') + '</p>' +
		'<p class="trs-datetime">' + tipHtmlEscape(tipReceiptDateTime(data.created_dt)) + '</p>' +
		'<table class="trs-table"><tbody>' + rows + '</tbody></table>' +
		'</div>' +
		'<div class="tip-receipt-slip-actions">' +
		'<button type="button" class="btn tip-receipt-copy-btn js-copy-tip-receipt-image">Copy image</button>' +
		'<button type="button" class="btn tip-receipt-copy-btn js-copy-tip-receipt-text">Copy text</button>' +
		'</div>' +
		'</div>'
	);
}

function showTipReceiptModal() {
	var modalEl = document.getElementById('modal-tip-receipt');
	if (!modalEl) return;
	$('#modal-tip-receipt').appendTo('body');
	if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
		bootstrap.Modal.getOrCreateInstance(modalEl).show();
	}
}

function handleTipReceiptClick() {
	var row = getTipRowFromButton(this);
	if (!row || !row.EDIT_ID) return;
	var i18n = getTipActionsI18n();
	var kind = row.ROW_KIND === 'tip_settlement' ? 'tip_settlement' : 'tip';
	var url = kind === 'tip_settlement'
		? '/tip_settlement/' + row.EDIT_ID + '/receipt'
		: '/tip/' + row.EDIT_ID + '/receipt';

	$.getJSON(url)
		.done(function (data) {
			$('#tip-receipt-container').html(buildTipReceiptSlipHtml(data));
			showTipReceiptModal();
		})
		.fail(function (xhr) {
			var message = xhr.responseJSON && xhr.responseJSON.error
				? xhr.responseJSON.error
				: (i18n.loadReceiptError || 'Unable to load receipt.');
			Swal.fire({ icon: 'error', title: 'Error', text: message });
		});
}

function tipReceiptCopyUi($btn) {
	var originalHtml = $btn.html();
	$btn.prop('disabled', true)
		.html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');
	return {
		success: function (message) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'success', title: 'Copied!', text: message, timer: 1800, showConfirmButton: false });
			}
		},
		error: function (message) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'error', title: 'Copy failed', text: message });
			}
		},
		restore: function () {
			$btn.prop('disabled', false).html(originalHtml);
		}
	};
}

function copyTipReceiptImage($btn) {
	var slipBody = $btn.closest('.tip-receipt-slip').find('.tip-receipt-slip-body')[0];
	if (!slipBody) return;
	var ui = tipReceiptCopyUi($btn);
	var blobPromise = loadTipReceiptHtml2Canvas()
		.then(function () {
			return html2canvas(slipBody, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
		})
		.then(function (canvas) {
			return new Promise(function (resolve, reject) {
				canvas.toBlob(function (blob) {
					if (blob) resolve(blob);
					else reject(new Error('Failed to create receipt image.'));
				}, 'image/png');
			});
		});

	if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
		navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
			.then(function () { ui.success('Receipt image copied. You can paste it anywhere.'); })
			.catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt image.'); })
			.finally(function () { ui.restore(); });
	} else {
		blobPromise
			.then(function (blob) {
				var link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = 'tip-receipt.png';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				ui.success('Receipt image downloaded.');
			})
			.catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt image.'); })
			.finally(function () { ui.restore(); });
	}
}

function copyTipReceiptText($btn) {
	var slipBody = $btn.closest('.tip-receipt-slip').find('.tip-receipt-slip-body')[0];
	var text = slipBody && slipBody.innerText ? slipBody.innerText.trim() : '';
	var ui = tipReceiptCopyUi($btn);
	if (!text || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
		ui.error('Clipboard is not supported in this browser.');
		ui.restore();
		return;
	}
	navigator.clipboard.writeText(text)
		.then(function () { ui.success('Receipt text copied. You can paste it anywhere.'); })
		.catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt text.'); })
		.finally(function () { ui.restore(); });
}

$(document).ready(function () {
	var i18nEl = document.getElementById('tip-settlement-i18n');
	if (i18nEl) {
		try {
			window.tipSettlementI18n = JSON.parse(i18nEl.textContent || '{}');
		} catch (e) {
			window.tipSettlementI18n = {};
		}
	}

	var tipInI18nEl = document.getElementById('tip-in-i18n');
	if (tipInI18nEl) {
		try {
			window.tipInI18n = JSON.parse(tipInI18nEl.textContent || '{}');
		} catch (e) {
			window.tipInI18n = {};
		}
	}

	var tipActionsI18nEl = document.getElementById('tip-actions-i18n');
	if (tipActionsI18nEl) {
		try {
			window.tipActionsI18n = JSON.parse(tipActionsI18nEl.textContent || '{}');
		} catch (e) {
			window.tipActionsI18n = {};
		}
	}

	$.fn.dataTable.ext.search.push(function (settings, data) {
		if (!settings || !settings.nTable || settings.nTable.id !== 'tip-tbl') return true;
		if (!tipPageDateStart || !tipPageDateEnd) return true;
		const rawDate = data && data[0];
		const rowDate = tipPageYmdToLocalDate(String(rawDate || '').trim().slice(0, 10));
		if (!rowDate) return true;
		const start = new Date(tipPageDateStart.getFullYear(), tipPageDateStart.getMonth(), tipPageDateStart.getDate(), 0, 0, 0, 0);
		const end = new Date(tipPageDateEnd.getFullYear(), tipPageDateEnd.getMonth(), tipPageDateEnd.getDate(), 23, 59, 59, 999);
		return rowDate >= start && rowDate <= end;
	});

	tipTable = $('#tip-tbl').DataTable({
		pageLength: 25,
		order: [[0, 'desc'], [1, 'desc']],
		orderCellsTop: true,
		footerCallback: function () {
			updateTipAmountTotals(this.api());
		},
		columns: [
			{
				data: 'PROGRAM_DATE',
				defaultContent: '',
				render: function (data, type) {
					if (!data) return '';
					if (type === 'sort' || type === 'filter') {
						return String(data).slice(0, 10);
					}
					if (window.moment) {
						return moment(data).format('YYYY-MM-DD');
					}
					return String(data).slice(0, 10);
				}
			},
			{
				data: 'ENCODED_DT',
				defaultContent: '',
				render: function (data, type) {
					if (!data) return '';
					if (type === 'sort' || type === 'filter') return data;
					if (window.moment) {
						return moment(data).format('YYYY-MM-DD HH:mm');
					}
					return String(data);
				}
			},
			{ data: 'ACCOUNT_DISPLAY', defaultContent: '-' },
			{
				data: 'GUEST_NAME',
				defaultContent: '-',
				render: function (data) {
					return data != null && String(data).trim() !== '' ? String(data) : '-';
				}
			},
			{
				data: 'GAME_NO',
				defaultContent: '-',
				render: function (data) {
					return data != null && data !== '' ? String(data) : '-';
				}
			},
			{
				data: 'REMARKS',
				className: 'remarks-editor-td',
				defaultContent: '—',
				render: function (data, type, row) {
					if (type === 'sort' || type === 'filter') {
						return data != null && data !== '—' ? String(data) : '';
					}
					if (window.RemarksEditor && row.REMARKS_SOURCE && row.REMARKS_RECORD_ID) {
						return window.RemarksEditor.renderCell(
							row.REMARKS_EDIT != null ? row.REMARKS_EDIT : '',
							{
								source: row.REMARKS_SOURCE,
								recordId: row.REMARKS_RECORD_ID,
								displayText: data != null && data !== '—' ? String(data) : ''
							}
						);
					}
					return data != null && String(data).trim() !== '' && data !== '—'
						? String(data)
						: '<span class="text-muted">—</span>';
				}
			},
			{
				data: 'ROLLER_TRANSACTION',
				className: 'tip-col-roller',
				defaultContent: 'Roller Tip',
				render: function (data, type, row) {
					return renderTipTransactionCell(data, row && row.ROLLER_AMOUNT, type);
				}
			},
			{
				data: 'ROLLER_AMOUNT',
				className: 'tip-col-roller',
				defaultContent: 0,
				render: function (data, type) {
					return renderAmountCell(data, type);
				}
			},
			{
				data: 'ROLLER_STATUS',
				className: 'tip-col-roller',
				defaultContent: '—',
				render: function (data) {
					return data != null && String(data).trim() !== '' ? String(data) : '—';
				}
			},
			{
				data: 'ROLLER_NAME',
				className: 'tip-col-roller',
				defaultContent: '—',
				render: function (data) {
					return data != null && String(data).trim() !== '' ? String(data) : '—';
				}
			},
			{
				data: 'DEALER_TRANSACTION',
				className: 'tip-col-dealer',
				defaultContent: 'Dealer Tip',
				render: function (data, type, row) {
					return renderTipTransactionCell(data, row && row.DEALER_AMOUNT, type);
				}
			},
			{
				data: 'DEALER_AMOUNT',
				className: 'tip-col-dealer',
				defaultContent: 0,
				render: function (data, type) {
					return renderAmountCell(data, type);
				}
			},
			{
				data: 'DEALER_STATUS',
				className: 'tip-col-dealer',
				defaultContent: '—',
				render: function (data) {
					return data != null && String(data).trim() !== '' ? String(data) : '—';
				}
			},
			{
				data: 'DEALER_NAME',
				className: 'tip-col-dealer',
				defaultContent: '—',
				render: function (data) {
					return data != null && String(data).trim() !== '' ? String(data) : '—';
				}
			},
			{
				data: null,
				className: 'tip-action-col',
				orderable: false,
				searchable: false,
				defaultContent: '',
				render: function (data, type, row) {
					if (type !== 'display') return '';
					return renderTipActions(row);
				}
			}
		]
	});

	refreshTipPage().fail(function () {
		Swal.fire('Error', 'Failed to load tip records.', 'error');
	});

	initTipPageDateRangePicker();

	initTipAutocompletes();
	fetchTipRollerHistory(null).always(function () {
		refreshTipAutocompletes();
	});

	$('#btn-tip-in-open').on('click', openTipInModal);
	$('#btn-tip-settlement-open').on('click', openTipSettlementModal);
	$('#tip-in-modal-account').on('change', onTipInAccountChange);
	$('#form-tip-in').on('submit', submitTipIn);
	$('#form-tip-settlement').on('submit', submitTipSettlement);

	$('#tip-tbl tbody').on('click', '.tip-edit-btn', handleTipEditClick);
	$('#tip-tbl tbody').on('click', '.tip-delete-btn', handleTipDeleteClick);
	$('#tip-tbl tbody').on('click', '.tip-receipt-btn', handleTipReceiptClick);
	$(document)
		.on('click', '.js-copy-tip-receipt-image', function () { copyTipReceiptImage($(this)); })
		.on('click', '.js-copy-tip-receipt-text', function () { copyTipReceiptText($(this)); })
		.on('shown.bs.modal', '#modal-tip-receipt', function () {
			$('body').addClass('tip-receipt-open');
			loadTipReceiptHtml2Canvas().catch(function () {});
		})
		.on('hidden.bs.modal', '#modal-tip-receipt', function () {
			$('body').removeClass('tip-receipt-open');
		});
	wireTipInAmountInput();
	wireTipSettlementAmountInput();
	if (tipPageSplitDateRange && typeof tipPageSplitDateRange.fitWidths === 'function') {
		tipPageSplitDateRange.fitWidths();
	}
});
