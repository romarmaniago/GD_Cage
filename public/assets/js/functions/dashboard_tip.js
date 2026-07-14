$(document).ready(function () {
	if (!$('#modal-dash-tip').length) return;

	var tipTable;
	var tipDateStart = null;
	var tipDateEnd = null;
	var flatpickrReady = false;
	var tipInResetting = false;
	var tipRollerHistory = [];
	var tipAutocompleteInstances = [];
	var i18n = window.tipSettlementI18n || {};
	var tipInI18n = window.tipInI18n || {};

	function formatMoney(n) {
		return (Number(n) || 0).toLocaleString('en-US', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 2
		});
	}

	function formatSignedMoney(n) {
		var num = Number(n) || 0;
		if (num < 0) return '(' + formatMoney(Math.abs(num)) + ')';
		return formatMoney(num);
	}

	function renderAmountCell(value, type) {
		var n = value == null || value === '' ? 0 : Number(value) || 0;
		if (type === 'sort' || type === 'filter') return n;
		var cls = n < 0 ? 'tip-amount-negative' : '';
		return '<span class="' + cls + '">' + formatSignedMoney(n) + '</span>';
	}

	function cellText(value) {
		return $('<div>').html(value == null ? '' : String(value)).text().trim();
	}

	function parseRowDate(value) {
		var d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}

	function getDefaultDateRange() {
		if (window.MonthEndCutoffRange) {
			return window.MonthEndCutoffRange.getMonthEndCutoffRange();
		}
		var now = new Date();
		var y = now.getFullYear();
		var m = now.getMonth();
		return {
			startAt: new Date(y, m, 0),
			endAt: new Date(y, m + 1, 0)
		};
	}

	function updateAvailableBalance(amount) {
		var formatted = formatMoney(amount);
		$('#dash-tip-available-balance').text(formatted);
		$('#tip-settlement-modal-balance').text(formatted);
		$('#dash-tip-balance-value').text(formatted);
	}

	function fetchRollerBalance() {
		return $.get('/tip_roller_balance').then(function (data) {
			updateAvailableBalance(data && data.available != null ? data.available : 0);
			return data;
		});
	}

	$.fn.dataTable.ext.search.push(function (settings, data) {
		if (!settings || !settings.nTable || settings.nTable.id !== 'dash-tip-table') return true;
		if (!tipDateStart || !tipDateEnd) return true;
		var rawDate = data && data[0];
		var rowDate = parseRowDate(cellText(rawDate));
		if (!rowDate) return true;
		var start = new Date(tipDateStart.getFullYear(), tipDateStart.getMonth(), tipDateStart.getDate(), 0, 0, 0, 0);
		var end = new Date(tipDateEnd.getFullYear(), tipDateEnd.getMonth(), tipDateEnd.getDate(), 23, 59, 59, 999);
		return rowDate >= start && rowDate <= end;
	});

	function layoutDashTipControls() {
		var wrapper = document.getElementById('dash-tip-table_wrapper');
		var lengthWrap = document.getElementById('dash-tip-table_length');
		var filterWrap = document.getElementById('dash-tip-table_filter');
		var searchLabel = filterWrap ? filterWrap.querySelector('label') : null;
		var searchInput = searchLabel ? searchLabel.querySelector('input') : null;
		var controlsHighlight;
		var filterHighlight;

		if (!wrapper || !lengthWrap || !filterWrap || !searchLabel) return;

		controlsHighlight = wrapper.querySelector('.dash-tip-controls-highlight');
		if (!controlsHighlight) {
			controlsHighlight = document.createElement('div');
			controlsHighlight.className = 'dash-tip-controls-highlight';
			wrapper.insertBefore(controlsHighlight, wrapper.firstChild);
		}
		if (lengthWrap.parentElement !== controlsHighlight) {
			controlsHighlight.appendChild(lengthWrap);
		}
		if (filterWrap.parentElement !== controlsHighlight) {
			controlsHighlight.appendChild(filterWrap);
		}

		filterHighlight = filterWrap.querySelector('.dash-tip-filter-highlight');
		if (!filterHighlight) {
			filterHighlight = document.createElement('div');
			filterHighlight.className = 'dash-tip-filter-highlight';
			filterWrap.appendChild(filterHighlight);
		}
		if (searchLabel.parentElement !== filterHighlight) {
			filterHighlight.appendChild(searchLabel);
		}
		if (searchInput) {
			searchInput.setAttribute('placeholder', 'Search...');
			Array.prototype.slice.call(searchLabel.childNodes).forEach(function (node) {
				if (node.nodeType === 3) searchLabel.removeChild(node);
			});
		}

		Array.prototype.forEach.call(wrapper.children, function (row) {
			if (!row.classList || !row.classList.contains('row')) return;
			if (row.querySelector('table')) return;
			if (!row.querySelector('.dataTables_length, .dataTables_filter, .dataTables_info, .dataTables_paginate')) {
				row.classList.add('dash-tip-dt-top-row-empty');
			}
		});
	}

	function initializeDataTable() {
		if ($.fn.DataTable.isDataTable('#dash-tip-table')) {
			$('#dash-tip-table').DataTable().destroy();
		}

		tipTable = $('#dash-tip-table').DataTable({
			pageLength: 10,
			lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
			searching: true,
			ordering: true,
			info: true,
			paging: true,
			order: [[0, 'desc'], [1, 'desc']],
			drawCallback: function () {
				layoutDashTipControls();
			},
			initComplete: function () {
				layoutDashTipControls();
			},
			columns: [
				{
					data: 'PROGRAM_DATE',
					defaultContent: '',
					render: function (data, type) {
						if (!data) return '';
						if (type === 'sort' || type === 'filter') return String(data).slice(0, 10);
						if (window.moment) return moment(data).format('YYYY-MM-DD');
						return String(data).slice(0, 10);
					}
				},
				{
					data: 'ENCODED_DT',
					defaultContent: '',
					render: function (data, type) {
						if (!data) return '';
						if (type === 'sort' || type === 'filter') return data;
						if (window.moment) return moment(data).format('YYYY-MM-DD HH:mm');
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
				{ data: 'ROLLER_TRANSACTION', defaultContent: 'Roller Tip' },
				{
					data: 'ROLLER_AMOUNT',
					defaultContent: 0,
					render: function (data, type) {
						return renderAmountCell(data, type);
					}
				},
				{
					data: 'ROLLER_STATUS',
					defaultContent: '—',
					render: function (data) {
						return data != null && String(data).trim() !== '' ? String(data) : '—';
					}
				},
				{
					data: 'ROLLER_NAME',
					defaultContent: '—',
					render: function (data) {
						return data != null && String(data).trim() !== '' ? String(data) : '—';
					}
				},
				{ data: 'DEALER_TRANSACTION', defaultContent: 'Dealer Tip' },
				{
					data: 'DEALER_AMOUNT',
					defaultContent: 0,
					render: function (data, type) {
						return renderAmountCell(data, type);
					}
				},
				{
					data: 'DEALER_STATUS',
					defaultContent: '—',
					render: function (data) {
						return data != null && String(data).trim() !== '' ? String(data) : '—';
					}
				},
				{
					data: 'DEALER_NAME',
					defaultContent: '—',
					render: function (data) {
						return data != null && String(data).trim() !== '' ? String(data) : '—';
					}
				}
			],
			language: {
				search: 'Search:',
				lengthMenu: 'Show _MENU_ entries',
				info: 'Showing _START_ to _END_ of _TOTAL_ entries',
				infoEmpty: 'Showing 0 to 0 of 0 entries',
				infoFiltered: '(filtered from _MAX_ total entries)',
				paginate: {
					previous: 'Previous',
					next: 'Next'
				},
				emptyTable: 'No data available in table'
			}
		});
	}

	function reloadTipData() {
		if (!tipTable) return;
		return $.get('/tip_data').then(function (rows) {
			tipTable.clear().rows.add(rows || []).draw();
		});
	}

	function refreshDashTip() {
		return $.when(fetchRollerBalance(), reloadTipData());
	}

	window.reloadDashTipData = refreshDashTip;

	function initDateRangePicker() {
		if (flatpickrReady || typeof flatpickr !== 'function') return;
		var range = getDefaultDateRange();
		tipDateStart = range.startAt || range.start || null;
		tipDateEnd = range.endAt || range.end || null;

		flatpickr('#dash-tip-daterange', {
			mode: 'range',
			defaultDate: tipDateStart && tipDateEnd ? [tipDateStart, tipDateEnd] : undefined,
			showMonths: 2,
			onClose: function (selectedDates) {
				if (!selectedDates || selectedDates.length === 0) {
					tipDateStart = null;
					tipDateEnd = null;
				} else if (selectedDates.length === 2) {
					tipDateStart = selectedDates[0];
					tipDateEnd = selectedDates[1];
				}
				if (tipTable) tipTable.draw();
			}
		});
		flatpickrReady = true;
	}

	function parseSettlementAmount(raw) {
		var clean = String(raw || '').replace(/,/g, '').trim();
		if (clean === '') return NaN;
		var n = Number(clean);
		return Number.isFinite(n) && n > 0 ? n : NaN;
	}

	function formatSettlementAmountInput(raw) {
		var digits = String(raw || '').replace(/,/g, '').replace(/[^\d]/g, '');
		if (!digits) return '';
		return formatMoney(Number(digits));
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

	function ensureTipProgramDatePicker(inputId, defaultDate) {
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
		flatpickr(el, {
			enableTime: false,
			dateFormat: 'Y-m-d',
			altInput: true,
			altFormat: 'M j, Y',
			defaultDate: dateVal,
			allowInput: true,
			disableMobile: true,
			closeOnSelect: true
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
		if (!tipAutocompleteInstances.length) {
			initTipAutocompletes();
		}
		if (window.CreditGuarantorAutocomplete) {
			window.CreditGuarantorAutocomplete.refreshGroup(tipAutocompleteInstances);
		}
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
		ensureTipProgramDatePicker('tip-in-modal-program-date', todayProgramDateValue());
		$('#tip-in-modal-program-date').removeClass('is-invalid');
		tipInResetting = false;
	}

	function openTipInModal() {
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

	function submitTipIn(event) {
		if (event) event.preventDefault();

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
				text: tipInI18n.missingProgramDate || 'Please select a program date.'
			});
			return;
		}

		if (Number.isNaN(amount)) {
			$amountInput.addClass('is-invalid');
			Swal.fire({
				icon: 'warning',
				title: 'Invalid Amount',
				text: tipInI18n.invalidAmount || 'Enter a valid amount greater than zero.'
			});
			return;
		}

		if (!statusVal) {
			$statusInput.addClass('is-invalid');
			Swal.fire({
				icon: 'warning',
				title: 'Missing Status',
				text: tipInI18n.missingStatus || 'Please enter the tip status (Roller or GM).'
			});
			return;
		}

		if (!nameVal) {
			$nameInput.addClass('is-invalid');
			Swal.fire({
				icon: 'warning',
				title: 'Missing Name',
				text: tipInI18n.missingName || 'Please enter the name.'
			});
			return;
		}

		$btn.prop('disabled', true);
		$.post('/tip_in', {
			txtAmount: $amountInput.val(),
			txtAccountId: accountVal,
			txtGuestId: guestVal,
			txtTipStatus: statusVal,
			txtRollerName: nameVal,
			txtProgramDate: programDate,
			txtRemarks: ($('#tip-in-modal-remarks').val() || '').toString().trim()
		})
			.done(function (resp) {
				if (resp && resp.availableBalance != null) {
					updateAvailableBalance(resp.availableBalance);
				}
				var modalEl = document.getElementById('modal-tip-in');
				if (modalEl && window.bootstrap && bootstrap.Modal) {
					var instance = bootstrap.Modal.getInstance(modalEl);
					if (instance) instance.hide();
				}
				resetTipInModal();
				return refreshDashTip();
			})
			.then(function () {
				Swal.fire({
					icon: 'success',
					title: 'Saved',
					text: tipInI18n.saved || 'Roller tip saved successfully.',
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

	function resetTipSettlementModal() {
		$('#tip-settlement-modal-amount, #tip-settlement-modal-status, #tip-settlement-modal-name, #tip-settlement-modal-remarks')
			.val('')
			.removeClass('is-invalid');
		ensureTipProgramDatePicker('tip-settlement-modal-program-date', todayProgramDateValue());
		$('#tip-settlement-modal-program-date').removeClass('is-invalid');
	}

	function openTipSettlementModal() {
		resetTipSettlementModal();
		var availableText = ($('#dash-tip-available-balance').text() || '').replace(/,/g, '').trim();
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

	function submitTipSettlement(event) {
		if (event) event.preventDefault();

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

		var availableText = ($('#dash-tip-available-balance').text() || '').replace(/,/g, '').trim();
		var available = Number(availableText) || 0;

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
		$.post('/tip_settlement', {
			txtAmount: $amountInput.val(),
			txtTipStatus: statusVal,
			txtRollerName: nameVal,
			txtProgramDate: programDate,
			txtRemarks: ($('#tip-settlement-modal-remarks').val() || '').toString().trim()
		})
			.done(function (resp) {
				if (resp && resp.availableBalance != null) {
					updateAvailableBalance(resp.availableBalance);
				}
				var modalEl = document.getElementById('modal-tip-settlement');
				if (modalEl && window.bootstrap && bootstrap.Modal) {
					var instance = bootstrap.Modal.getInstance(modalEl);
					if (instance) instance.hide();
				}
				resetTipSettlementModal();
				return refreshDashTip();
			})
			.then(function () {
				Swal.fire({
					icon: 'success',
					title: 'Saved',
					text: i18n.saved || 'Tip settlement saved successfully.',
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

	$('#modal-dash-tip').on('show.bs.modal', function () {
		initDateRangePicker();
		if (!tipTable) initializeDataTable();
		else layoutDashTipControls();
		refreshDashTip().fail(function () {
			Swal.fire('Error', 'Failed to load tip records.', 'error');
		});
	});
	$('#modal-dash-tip').on('shown.bs.modal', function () {
		layoutDashTipControls();
	});

	$('#btn-dash-tip-in-open').on('click', openTipInModal);
	$('#btn-dash-tip-settlement-open').on('click', openTipSettlementModal);
	$('#form-tip-in').on('submit', submitTipIn);
	$('#form-tip-settlement').on('submit', submitTipSettlement);
	$('#tip-in-modal-account').on('change', onTipInAccountChange);
	$('#tip-in-modal-amount, #tip-settlement-modal-amount').on('input', function () {
		var formatted = formatSettlementAmountInput(this.value);
		if (this.value !== formatted) this.value = formatted;
	});
});
