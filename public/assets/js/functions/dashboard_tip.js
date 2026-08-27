$(document).ready(function () {
	if (!$('#modal-dash-tip').length) return;

	var tipTable;
	var tipDateStart = null;
	var tipDateEnd = null;
	var flatpickrReady = false;
	var tipSplitDateRange = null;
	var tipInResetting = false;
	var tipRollerHistory = [];
	var tipAutocompleteInstances = [];
	var i18n = window.tipSettlementI18n || {};
	var tipInI18n = window.tipInI18n || {};
	var tipInEditId = null;
	var tipSettlementEditId = null;
	var tipSettlementEditBaseAmount = 0;

	function tipHtmlEscape(value) {
		return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
		});
	}

	function getTipActionsI18n() {
		return window.tipActionsI18n || {};
	}

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

	function renderTipTransactionCell(value, amount, type) {
		var label = String(value == null ? '' : value).trim();
		var numericAmount = Number(amount) || 0;
		if (type === 'sort' || type === 'filter') return label;
		if (!label) return '';
		var normalized = label.toLowerCase();
		if (normalized === 'out' || normalized === 'settlement' || normalized === 'settle') return 'OUT';
		if (normalized === 'roller tip') return 'Roller Tip';
		if (normalized === 'dealer tip') return 'Dealer Tip';
		if (normalized === 'in') return 'IN';
		if (numericAmount < 0) return 'OUT';
		if (numericAmount > 0) return 'IN';
		return label;
	}

	function cellText(value) {
		return $('<div>').html(value == null ? '' : String(value)).text().trim();
	}

	function parseRowDate(value) {
		var text = String(value || '').trim();
		if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
			return ymdToLocalDate(text.slice(0, 10));
		}
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

	function tipApiEndDate(endYmd) {
		if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
		var parts = String(endYmd).slice(0, 10).split('-').map(Number);
		var lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
		if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
			return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
		}
		return String(endYmd).slice(0, 10);
	}

	function ymdToLocalDate(ymd) {
		if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
		var parts = String(ymd).slice(0, 10).split('-').map(Number);
		return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
	}

	function setTipFilterDatesFromApi(startYmd, endYmd) {
		var startDate = ymdToLocalDate(startYmd);
		var endExpanded = tipApiEndDate(endYmd);
		var endDate = ymdToLocalDate(endExpanded);
		if (!startDate || !endDate) return;
		if (startDate > endDate) {
			var swap = startDate;
			startDate = endDate;
			endDate = swap;
		}
		tipDateStart = startDate;
		tipDateEnd = endDate;
		if (tipTable) tipTable.draw();
	}

	function applyTipFilterDraw() {
		if (tipTable) tipTable.draw();
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

		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
			var rangeEl = document.getElementById('dash-tip-daterange');
			if (rangeEl && rangeEl._flatpickr) {
				window.MonthEndCutoffRange.fitRangePickerInstance(rangeEl._flatpickr);
			}
		}
		if (tipSplitDateRange && typeof tipSplitDateRange.fitWidths === 'function') {
			tipSplitDateRange.fitWidths();
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

	function initTipSplitDateRange() {
		if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
			tipSplitDateRange = { fitWidths: function () {} };
			return;
		}

		tipSplitDateRange = window.SplitDateRange.attach({
			rangePickerId: 'dash-tip-daterange',
			startId: 'dash-tip-start-date',
			endId: 'dash-tip-end-date',
			splitWrapperId: 'dash-tip-split-daterange-wrapper',
			independent: true,
			invalidDateMessage: 'Invalid date range.',
			onRangeApplied: function (range) {
				if (!range || !range.start || !range.end) return;
				setTipFilterDatesFromApi(range.start, range.end);
			}
		});
	}

	function initDateRangePicker() {
		if (flatpickrReady || typeof flatpickr !== 'function') return;
		var range = getDefaultDateRange();
		tipDateStart = range.startAt || range.start || range.startDate || null;
		tipDateEnd = range.endAt || range.end || range.endDate || null;

		function bindMonthNameHooks(instance) {
			if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
				window.setupFlatpickrMonthNameRangeSelect(instance);
			}
		}

		initTipSplitDateRange();

		flatpickr('#dash-tip-daterange', {
			mode: 'range',
			defaultDate: tipDateStart && tipDateEnd ? [tipDateStart, tipDateEnd] : undefined,
			showMonths: 3,
			onReady: function (selectedDates, dateStr, instance) {
				bindMonthNameHooks(instance);
				if (selectedDates && selectedDates.length === 2) {
					tipDateStart = selectedDates[0];
					tipDateEnd = selectedDates[1];
				}
			},
			onOpen: function (selectedDates, dateStr, instance) { bindMonthNameHooks(instance); },
			onMonthChange: function (selectedDates, dateStr, instance) {
				if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
					window.styleFlatpickrMonthNameClickable(instance);
				}
			},
			onChange: function (selectedDates) {
				if (selectedDates.length === 2) {
					tipDateStart = selectedDates[0];
					tipDateEnd = selectedDates[1];
					applyTipFilterDraw();
				}
			},
			onClose: function (selectedDates) {
				if (!selectedDates || selectedDates.length === 0) {
					tipDateStart = null;
					tipDateEnd = null;
				} else if (selectedDates.length === 2) {
					tipDateStart = selectedDates[0];
					tipDateEnd = selectedDates[1];
				}
				applyTipFilterDraw();
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

	function getProgramDateValue(inputId) {
		var el = document.getElementById(inputId);
		if (!el) return '';
		if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates[0]) {
			return formatProgramDateYmd(el._flatpickr.selectedDates[0]);
		}
		return String(el.value || '').trim().slice(0, 10);
	}

	function ensureProgramDatePicker(inputId, defaultDate) {
		var el = document.getElementById(inputId);
		if (!el) return;
		var dateVal = defaultDate || getProgramDateValue(inputId) || todayProgramDateValue();
		if (typeof flatpickr === 'undefined') {
			el.value = dateVal;
			return;
		}
		if (el._flatpickr) {
			try { el._flatpickr.destroy(); } catch (e) {}
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

	function showBsModal(modalId) {
		var modalEl = document.getElementById(modalId);
		if (modalEl && window.bootstrap && bootstrap.Modal) {
			bootstrap.Modal.getOrCreateInstance(modalEl).show();
		}
	}

	function hideBsModal(modalId) {
		var modalEl = document.getElementById(modalId);
		if (modalEl && window.bootstrap && bootstrap.Modal) {
			var instance = bootstrap.Modal.getInstance(modalEl);
			if (instance) instance.hide();
		}
	}

	function initTipSelect2($sel) {
		if (!$sel.length || typeof $sel.select2 !== 'function') return;
		if ($sel.data('select2')) {
			try { $sel.select2('destroy'); } catch (e) {}
		}
		$sel.select2({
			placeholder: $sel.data('placeholder') || 'Choose',
			allowClear: false,
			dropdownParent: $('#modal-tip-in')
		});
	}

	function loadTipInAccounts() {
		var $sel = $('#tip-in-modal-account');
		var placeholder = $sel.data('placeholder') || 'Choose account';
		return $.getJSON('/account_data').then(function (rows) {
			if ($sel.data('select2')) {
				try { $sel.select2('destroy'); } catch (e) {}
			}
			$sel.empty().append($('<option/>', { value: '', text: placeholder }));
			(rows || []).forEach(function (a) {
				var id = a.account_id;
				if (id == null) return;
				var parts = [a.agent_code, a.agent_name].filter(Boolean);
				$sel.append($('<option/>', {
					value: String(id),
					text: parts.length ? parts.join(' - ') : 'Account #' + id,
					'data-agent-id': a.agent_id != null ? String(a.agent_id) : ''
				}));
			});
			initTipSelect2($sel);
		});
	}

	function loadTipInGuests(agentId) {
		var $sel = $('#tip-in-modal-guest');
		var placeholder = $sel.data('placeholder') || 'Choose guest';
		var url = agentId
			? '/guest_data?agentId=' + encodeURIComponent(agentId)
			: '/guest_data?all=1';

		return $.getJSON(url).then(function (rows) {
			if ($sel.data('select2')) {
				try { $sel.select2('destroy'); } catch (e) {}
			}
			$sel.empty().append($('<option/>', { value: '', text: placeholder }));
			(rows || []).forEach(function (g) {
				var id = g.guest_id;
				if (id == null) return;
				var name = (g.guest_name || '').toString().trim() || ('Guest #' + id);
				$sel.append($('<option/>', { value: String(id), text: name }));
			});
			initTipSelect2($sel);
		});
	}

	function fetchTipRollerHistory(accountId) {
		var url = '/tip_roller_history';
		if (accountId) url += '?accountId=' + encodeURIComponent(accountId);
		return $.getJSON(url).then(function (data) {
			tipRollerHistory = Array.isArray(data && data.history) ? data.history : [];
			return tipRollerHistory;
		});
	}

	function refreshTipAutocompletes() {
		var AC = window.CreditGuarantorAutocomplete;
		if (!AC) return;
		if (!tipAutocompleteInstances.length) {
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
		AC.refreshGroup(tipAutocompleteInstances);
	}

	function clearSelect2Value($sel) {
		if ($sel.data('select2')) $sel.val('').trigger('change');
		else $sel.val('');
	}

	function resetTipInModal() {
		tipInResetting = true;
		clearSelect2Value($('#tip-in-modal-account'));
		clearSelect2Value($('#tip-in-modal-guest'));
		$('#tip-in-modal-amount, #tip-in-modal-status, #tip-in-modal-name, #tip-in-modal-remarks')
			.val('')
			.removeClass('is-invalid');
		ensureProgramDatePicker('tip-in-modal-program-date', todayProgramDateValue());
		$('#tip-in-modal-program-date').removeClass('is-invalid');
		tipInResetting = false;
	}

	function openTipInModal() {
		tipInEditId = null;
		setTipInModalTitle(false);
		resetTipInModal();
		showBsModal('modal-tip-in');
		$.when(loadTipInAccounts(), loadTipInGuests(null), fetchTipRollerHistory(null)).fail(function () {
			Swal.fire('Error', 'Failed to load account or guest list.', 'error');
		}).always(refreshTipAutocompletes);
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

	function resetTipSettlementModal() {
		$('#tip-settlement-modal-amount, #tip-settlement-modal-status, #tip-settlement-modal-name, #tip-settlement-modal-remarks')
			.val('')
			.removeClass('is-invalid');
		ensureProgramDatePicker('tip-settlement-modal-program-date', todayProgramDateValue());
		$('#tip-settlement-modal-program-date').removeClass('is-invalid');
	}

	function openTipSettlementModal() {
		tipSettlementEditId = null;
		tipSettlementEditBaseAmount = 0;
		setTipSettlementModalTitle(false);
		resetTipSettlementModal();
		var availableText = ($('#dash-tip-available-balance').text() || '').replace(/,/g, '').trim();
		$('#tip-settlement-modal-balance').text(formatMoney(Number(availableText) || 0));
		var modalEl = document.getElementById('modal-tip-settlement');
		if (modalEl && window.bootstrap && bootstrap.Modal) {
			bootstrap.Modal.getOrCreateInstance(modalEl).show();
		}
		setTimeout(function () {
			$('#tip-settlement-modal-amount').trigger('focus');
		}, 200);
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
		var programDate = getProgramDateValue('tip-in-modal-program-date');

		$amountInput.add($statusInput).add($nameInput).add($programDateInput).removeClass('is-invalid');

		if (!programDate || !/^\d{4}-\d{2}-\d{2}$/.test(programDate)) {
			$programDateInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Missing Program Date', text: tipInI18n.missingProgramDate || 'Please select a program date.' });
			return;
		}
		if (Number.isNaN(amount)) {
			$amountInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Invalid Amount', text: tipInI18n.invalidAmount || 'Enter a valid amount greater than zero.' });
			return;
		}
		if (!statusVal) {
			$statusInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Missing Status', text: tipInI18n.missingStatus || 'Please enter the tip status (Roller or GM).' });
			return;
		}
		if (!nameVal) {
			$nameInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Missing Name', text: tipInI18n.missingName || 'Please enter the name.' });
			return;
		}

		$btn.prop('disabled', true);
		var isEdit = tipInEditId != null;
		var payload = {
			txtAmount: $amountInput.val(),
			txtAccountId: ($('#tip-in-modal-account').val() || '').toString().trim(),
			txtGuestId: ($('#tip-in-modal-guest').val() || '').toString().trim(),
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
				if (resp && resp.availableBalance != null) updateAvailableBalance(resp.availableBalance);
				hideBsModal('modal-tip-in');
				tipInEditId = null;
				resetTipInModal();
				return refreshDashTip();
			})
			.then(function () {
				Swal.fire({
					icon: 'success',
					title: 'Saved',
					text: isEdit
						? (tipInI18n.updated || 'Updated successfully.')
						: (tipInI18n.saved || 'Roller tip saved successfully.'),
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
		var programDate = getProgramDateValue('tip-settlement-modal-program-date');
		var availableText = ($('#dash-tip-available-balance').text() || '').replace(/,/g, '').trim();
		var isEdit = tipSettlementEditId != null;
		var available = (Number(availableText) || 0) + (isEdit ? tipSettlementEditBaseAmount : 0);

		$amountInput.add($statusInput).add($nameInput).add($programDateInput).removeClass('is-invalid');

		if (!programDate || !/^\d{4}-\d{2}-\d{2}$/.test(programDate)) {
			$programDateInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Missing Program Date', text: i18n.missingProgramDate || 'Please select a program date.' });
			return;
		}
		if (Number.isNaN(amount)) {
			$amountInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Invalid Amount', text: i18n.invalidAmount || 'Enter a valid settlement amount greater than zero.' });
			return;
		}
		if (amount > available) {
			$amountInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Invalid Amount', text: i18n.exceedsBalance || 'Settlement amount cannot exceed available roller tip balance.' });
			return;
		}
		if (!statusVal) {
			$statusInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Missing Status', text: i18n.missingStatus || 'Please enter the tip status (Roller or GM).' });
			return;
		}
		if (!nameVal) {
			$nameInput.addClass('is-invalid');
			Swal.fire({ icon: 'warning', title: 'Missing Name', text: i18n.missingName || 'Please enter the name.' });
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
				if (resp && resp.availableBalance != null) updateAvailableBalance(resp.availableBalance);
				hideBsModal('modal-tip-settlement');
				tipSettlementEditId = null;
				tipSettlementEditBaseAmount = 0;
				resetTipSettlementModal();
				return refreshDashTip();
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

	function setTipInModalTitle(isEdit) {
		var $label = $('#modal-tip-in-label');
		if (!$label.data('default-title')) $label.data('default-title', $.trim($label.text()));
		$label.text(isEdit ? (tipInI18n.editTitle || 'Edit Tip') : ($label.data('default-title') || 'Tip In'));
	}

	function setTipSettlementModalTitle(isEdit) {
		var $label = $('#modal-tip-settlement-label');
		if (!$label.data('default-title')) $label.data('default-title', $.trim($label.text()));
		$label.text(isEdit ? (i18n.editTitle || 'Edit Tip') : ($label.data('default-title') || 'Tip Settlement'));
	}

	function renderTipActions(row) {
		if (!row || !row.EDIT_ID) return '';
		var actI18n = getTipActionsI18n();
		var kind = row.ROW_KIND === 'tip_settlement' ? 'tip_settlement' : 'tip';
		var viewOnly = window.PermissionViewOnly && typeof window.PermissionViewOnly.isViewOnly === 'function' &&
			window.PermissionViewOnly.isViewOnly();
		var canEdit = row.CAN_EDIT !== false && !viewOnly;
		var attrs = ' data-tip-kind="' + kind + '" data-tip-id="' + row.EDIT_ID + '"';
		var html = '<div class="tip-action-btns">';
		html += '<button type="button" class="btn btn-sm btn-alt-secondary tip-receipt-btn"' + attrs +
			' title="' + tipHtmlEscape(actI18n.receiptTitle || 'Receipt') + '"><i class="fa fa-receipt"></i></button>';
		if (canEdit) {
			html += '<button type="button" class="btn btn-sm btn-alt-primary tip-edit-btn" data-view-only-disable' + attrs +
				' title="' + tipHtmlEscape(actI18n.editTitle || 'Edit') + '"><i class="fa fa-pencil-alt"></i></button>';
			html += '<button type="button" class="btn btn-sm btn-alt-danger tip-delete-btn" data-view-only-disable' + attrs +
				' title="' + tipHtmlEscape(actI18n.deleteTitle || 'Delete') + '"><i class="fa fa-trash-alt"></i></button>';
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

	function openTipInEditModal(row) {
		if (!row || !row.EDIT_ID) return;
		tipInEditId = row.EDIT_ID;
		setTipInModalTitle(true);
		resetTipInModal();
		showBsModal('modal-tip-in');

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
					ensureProgramDatePicker('tip-in-modal-program-date', String(row.EDIT_PROGRAM_DATE).slice(0, 10));
				}
				refreshTipAutocompletes();
			});
	}

	function openTipSettlementEditModal(row) {
		if (!row || !row.EDIT_ID) return;
		tipSettlementEditId = row.EDIT_ID;
		tipSettlementEditBaseAmount = Number(row.EDIT_AMOUNT) || 0;
		setTipSettlementModalTitle(true);
		resetTipSettlementModal();

		var availableText = ($('#dash-tip-available-balance').text() || '').replace(/,/g, '').trim();
		var available = (Number(availableText) || 0) + tipSettlementEditBaseAmount;
		$('#tip-settlement-modal-balance').text(formatMoney(available));

		$('#tip-settlement-modal-amount').val(formatMoney(tipSettlementEditBaseAmount));
		$('#tip-settlement-modal-status').val(row.EDIT_STATUS && row.EDIT_STATUS !== '—' ? row.EDIT_STATUS : '');
		$('#tip-settlement-modal-name').val(row.EDIT_NAME && row.EDIT_NAME !== '—' ? row.EDIT_NAME : '');
		$('#tip-settlement-modal-remarks').val(row.EDIT_REMARKS || '');
		if (row.EDIT_PROGRAM_DATE) {
			ensureProgramDatePicker('tip-settlement-modal-program-date', String(row.EDIT_PROGRAM_DATE).slice(0, 10));
		}
		showBsModal('modal-tip-settlement');
		fetchTipRollerHistory(null).always(refreshTipAutocompletes);
	}

	function handleTipEditClick() {
		var row = getTipRowFromButton(this);
		if (!row) return;
		if (row.ROW_KIND === 'tip_settlement') openTipSettlementEditModal(row);
		else openTipInEditModal(row);
	}

	function handleTipDeleteClick() {
		var row = getTipRowFromButton(this);
		if (!row || !row.EDIT_ID) return;
		var actI18n = getTipActionsI18n();
		var kind = row.ROW_KIND === 'tip_settlement' ? 'tip_settlement' : 'tip';
		var url = kind === 'tip_settlement'
			? '/tip_settlement/remove/' + row.EDIT_ID
			: '/tip/remove/' + row.EDIT_ID;

		Swal.fire({
			icon: 'warning',
			title: actI18n.deleteConfirm || 'Delete this record?',
			text: actI18n.deleteConfirmText || 'This cannot be undone.',
			showCancelButton: true,
			confirmButtonText: actI18n.yes || 'Yes',
			cancelButtonText: actI18n.cancel || 'Cancel',
			confirmButtonColor: '#dc3545'
		}).then(function (result) {
			if (!result.isConfirmed) return;
			$.ajax({ url: url, method: 'PUT' })
				.done(function (resp) {
					if (resp && resp.availableBalance != null) updateAvailableBalance(resp.availableBalance);
					refreshDashTip();
					Swal.fire({
						icon: 'success', title: 'Deleted',
						text: actI18n.deleted || 'Deleted successfully.',
						timer: 1600, showConfirmButton: false
					});
				})
				.fail(function (xhr) {
					var message = xhr.responseJSON && xhr.responseJSON.message
						? xhr.responseJSON.message : 'Failed to delete record.';
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
		var actI18n = getTipActionsI18n();
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
					: (actI18n.loadReceiptError || 'Unable to load receipt.');
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
				if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Copy failed', text: message });
			},
			restore: function () { $btn.prop('disabled', false).html(originalHtml); }
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

	$('#dash-tip-table tbody').on('click', '.tip-edit-btn', handleTipEditClick);
	$('#dash-tip-table tbody').on('click', '.tip-delete-btn', handleTipDeleteClick);
	$('#dash-tip-table tbody').on('click', '.tip-receipt-btn', handleTipReceiptClick);
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
		if (tipSplitDateRange && typeof tipSplitDateRange.fitWidths === 'function') {
			tipSplitDateRange.fitWidths();
		}
	});

	$('#btn-dash-tip-in-open').on('click', openTipInModal);
	$('#btn-dash-tip-settlement-open').on('click', openTipSettlementModal);
	$('#tip-in-modal-account').on('change', onTipInAccountChange);
	$('#form-tip-in').on('submit', submitTipIn);
	$('#form-tip-settlement').on('submit', submitTipSettlement);
	$('#tip-in-modal-amount').on('input', function () {
		var formatted = formatSettlementAmountInput(this.value);
		if (this.value !== formatted) this.value = formatted;
	});
	$('#tip-settlement-modal-amount').on('input', function () {
		var formatted = formatSettlementAmountInput(this.value);
		if (this.value !== formatted) this.value = formatted;
	});
});
