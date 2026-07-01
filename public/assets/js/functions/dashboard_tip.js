$(document).ready(function () {
	if (!$('#modal-dash-tip').length) return;

	var tipTable;
	var tipDateStart = null;
	var tipDateEnd = null;
	var flatpickrReady = false;
	var i18n = window.tipSettlementI18n || {};

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
			order: [[0, 'desc']],
			columns: [
				{
					data: 'TIP_DATETIME',
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

	function resetTipSettlementModal() {
		$('#tip-settlement-modal-amount, #tip-settlement-modal-status, #tip-settlement-modal-name, #tip-settlement-modal-remarks')
			.val('')
			.removeClass('is-invalid');
	}

	function openTipSettlementModal() {
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

	function submitTipSettlement(event) {
		if (event) event.preventDefault();

		var $amountInput = $('#tip-settlement-modal-amount');
		var $statusInput = $('#tip-settlement-modal-status');
		var $nameInput = $('#tip-settlement-modal-name');
		var $btn = $('#btn-tip-settlement-save');
		var amount = parseSettlementAmount($amountInput.val());
		var statusVal = ($statusInput.val() || '').toString().trim();
		var nameVal = ($nameInput.val() || '').toString().trim();

		$amountInput.removeClass('is-invalid');
		$statusInput.removeClass('is-invalid');
		$nameInput.removeClass('is-invalid');

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
		refreshDashTip().fail(function () {
			Swal.fire('Error', 'Failed to load tip records.', 'error');
		});
	});

	$('#btn-dash-tip-settlement-open').on('click', openTipSettlementModal);
	$('#form-tip-settlement').on('submit', submitTipSettlement);
	$('#tip-settlement-modal-amount').on('input', function () {
		var formatted = formatSettlementAmountInput(this.value);
		if (this.value !== formatted) this.value = formatted;
	});
});
