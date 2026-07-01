$(document).ready(function () {
	if (!$('#modal-dash-hotel').length) return;

	var dataTable;
	var hotelDateStart = null;
	var hotelDateEnd = null;
	var flatpickrReady = false;
	var t = window.fnbHotelTranslations || {};

	function formatDateForDisplay(value) {
		if (!value) return '-';
		var d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		var pad = function (n) { return String(n).padStart(2, '0'); };
		var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
	}

	function paymentLabel(transactionId) {
		switch (parseInt(transactionId, 10)) {
			case 1: return 'Cash';
			case 2: return 'Deposit';
			case 3: return 'Settle';
			default: return '-';
		}
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function cellText(value) {
		return $('<div>').html(value == null ? '' : String(value)).text().trim();
	}

	function parseRowDate(value) {
		var d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}

	function isHotelServiceType(serviceType) {
		var raw = String(serviceType || '').trim().toLowerCase();
		return raw === 'hotel' || raw.indexOf('hotel') !== -1;
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

	$.fn.dataTable.ext.search.push(function (settings, data) {
		if (!settings || !settings.nTable || settings.nTable.id !== 'dash-hotel-table') return true;
		if (!hotelDateStart || !hotelDateEnd) return true;
		var rawDate = data && data[0] && data[0].display !== undefined ? data[0].display : data[0];
		var rowDate = parseRowDate(cellText(rawDate));
		if (!rowDate) return true;
		var start = new Date(hotelDateStart.getFullYear(), hotelDateStart.getMonth(), hotelDateStart.getDate(), 0, 0, 0, 0);
		var end = new Date(hotelDateEnd.getFullYear(), hotelDateEnd.getMonth(), hotelDateEnd.getDate(), 23, 59, 59, 999);
		return rowDate >= start && rowDate <= end;
	});

	function initializeDataTable() {
		if ($.fn.DataTable.isDataTable('#dash-hotel-table')) {
			$('#dash-hotel-table').DataTable().destroy();
		}

		dataTable = $('#dash-hotel-table').DataTable({
			pageLength: 10,
			lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
			searching: true,
			ordering: true,
			info: true,
			paging: true,
			order: [[0, 'desc']],
			columnDefs: [
				{
					targets: '_all',
					createdCell: function (cell, _cellData, rowMeta) {
						if (rowMeta.col !== 5) $(cell).addClass('text-center');
					}
				},
				{
					targets: [0],
					render: function (data) {
						if (typeof data === 'object' && data && data.display !== undefined) return data.display;
						return data;
					}
				},
				{
					targets: [9],
					orderable: false,
					searchable: false
				}
			],
			language: {
				search: t.search || 'Search:',
				lengthMenu: t.lengthMenu || 'Show _MENU_ entries',
				info: t.showing_entries || 'Showing _START_ to _END_ of _TOTAL_ entries',
				infoEmpty: t.infoEmpty || 'Showing 0 to 0 of 0 entries',
				infoFiltered: t.infoFiltered || '(filtered from _MAX_ total entries)',
				paginate: {
					previous: t.previous || 'Previous',
					next: t.next || 'Next'
				},
				emptyTable: t.no_data_available || 'No data available in table'
			}
		});
	}

	function buildActionHtml(service) {
		var hasGameId = !!service.GAME_ID;
		var isGameSettled = hasGameId && service.game_settled === 1;
		var canEdit = !hasGameId;
		var canDelete = !hasGameId;
		var safeRemarks = (service.REMARKS || '').replace(/"/g, '&quot;');

		if (canEdit && canDelete) {
			return [
				'<div class="btn-group">',
				'<button type="button" class="btn btn-sm bg-info-subtle edit-service-btn"',
				' data-id="', service.IDNo, '"',
				' data-source="', escapeHtml(service.SOURCE_TYPE || ''), '"',
				' data-agent="', service.AGENT_ID || '', '"',
				' data-service="', escapeHtml(service.SERVICE_TYPE || ''), '"',
				' data-amount="', service.AMOUNT, '"',
				' data-remarks="', safeRemarks, '"',
				' data-transaction="', service.TRANSACTION_ID, '"',
				' title="Edit"><i class="fa fa-pencil-alt"></i></button>',
				'<button type="button" class="btn btn-sm bg-danger-subtle delete-service-btn"',
				' data-id="', service.IDNo, '"',
				' title="Delete"><i class="fa fa-trash"></i></button>',
				'</div>'
			].join('');
		}
		if (hasGameId && isGameSettled) {
			return '<span class="badge bg-success-subtle text-success fw-semibold px-3 py-2">Settled</span>';
		}
		if (hasGameId && !isGameSettled) {
			return '<button type="button" class="btn btn-sm bg-warning-subtle text-warning gamebook-notice-btn" title="Edit in Gamebook"><i class="fa fa-info-circle"></i></button>';
		}
		return '';
	}

	function reloadData() {
		if (!dataTable) return;

		$.ajax({
			url: '/fnb-hotel/data',
			method: 'GET',
			success: function (services) {
				dataTable.clear();

				(services || []).forEach(function (service) {
					if (!isHotelServiceType(service.SERVICE_TYPE)) return;

					var amt = Number(service.AMOUNT) || 0;
					var hasDecimals = amt % 1 !== 0;
					var formattedAmt = hasDecimals
						? amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
						: amt.toLocaleString('en-US');
					var isJunketSource = service.SOURCE_TYPE === 'JUNKET';
					var isSettle = parseInt(service.TRANSACTION_ID, 10) === 3;
					var displayAmt = isJunketSource
						? (window.fmtOut ? window.fmtOut(amt) : '(' + formattedAmt + ')')
						: formattedAmt;
					var sourceClass = isJunketSource ? 'text-danger' : (isSettle ? 'text-primary' : '');
					var amountClass = isJunketSource ? 'text-danger' : (isSettle ? 'text-primary' : '');
					var displaySource = isJunketSource ? 'OUT' : (service.SOURCE_TYPE === 'GUEST' ? 'IN' : (service.SOURCE_TYPE || '-'));
					var rawDate = service.ENCODED_DT ? new Date(service.ENCODED_DT).getTime() : 0;

					dataTable.row.add([
						{ display: formatDateForDisplay(service.ENCODED_DT), '@data-order': String(rawDate) },
						'<span class="' + sourceClass + '">' + escapeHtml(displaySource) + '</span>',
						escapeHtml(service.agent_name || '-'),
						service.GAME_ID ? escapeHtml(String(service.GAME_ID)) : '-',
						escapeHtml(service.SERVICE_TYPE || ''),
						'<span class="' + amountClass + '">' + displayAmt + '</span>',
						paymentLabel(service.TRANSACTION_ID),
						window.RemarksEditor
							? window.RemarksEditor.renderCell(service.REMARKS || '', { source: 'game_services', recordId: service.IDNo })
							: escapeHtml(service.REMARKS || '-'),
						escapeHtml(service.encoded_by_name || '-'),
						buildActionHtml(service)
					]);
				});

				dataTable.draw();
			},
			error: function (_xhr, _status, error) {
				console.error('Error loading dashboard Hotel data:', error);
			}
		});
	}

	function initDateRangePicker() {
		if (flatpickrReady || typeof flatpickr !== 'function') return;
		var range = getDefaultDateRange();
		hotelDateStart = range.startAt || range.start || null;
		hotelDateEnd = range.endAt || range.end || null;

		flatpickr('#dash-hotel-daterange', {
			mode: 'range',
			defaultDate: hotelDateStart && hotelDateEnd ? [hotelDateStart, hotelDateEnd] : undefined,
			showMonths: 2,
			onClose: function (selectedDates) {
				if (!selectedDates || selectedDates.length === 0) {
					hotelDateStart = null;
					hotelDateEnd = null;
				} else if (selectedDates.length === 2) {
					hotelDateStart = selectedDates[0];
					hotelDateEnd = selectedDates[1];
				}
				if (dataTable) dataTable.draw();
			}
		});
		flatpickrReady = true;
	}

	if (typeof window.registerDashServiceReload === 'function') {
		window.registerDashServiceReload(reloadData);
	}

	$('#modal-dash-hotel').on('show.bs.modal', function () {
		initDateRangePicker();
		if (!dataTable) initializeDataTable();
		reloadData();
	});

	$('#btn-dash-hotel-new-record').on('click', function () {
		window.__dashServicePresetType = 'Hotel';
	});

	$(document).on('click', '#modal-dash-hotel .edit-service-btn', function () {
		var $btn = $(this);
		var id = $btn.data('id');
		var sourceType = $btn.data('source');
		var agentId = $btn.data('agent');
		var serviceType = $btn.data('service');
		var amount = parseFloat($btn.data('amount')) || 0;
		var remarks = $btn.data('remarks') || '';
		var transactionId = $btn.data('transaction');

		$('#edit-services-id').val(id);
		$('#edit-transaction-type').val(sourceType).trigger('change');
		$('#edit-services-amount').val(amount.toLocaleString('en-US'));
		$('#edit-services-remarks').val(remarks);
		if (transactionId) {
			$('input[name="edit-services-transaction"][value="' + transactionId + '"]').prop('checked', true);
		}
		if (agentId) {
			$('#modal-services-edit-record').data('pendingAgentId', agentId);
		}

		window.populateServiceCategorySelect($('#edit-services-type'), serviceType).then(function () {
			$('#modal-services-edit-record').modal('show');
		});
	});

	$(document).on('click', '#modal-dash-hotel .delete-service-btn', function () {
		var id = $(this).data('id');
		SwalConfirm.fire({
			title: t.delete_confirmation || 'Delete Service Record?',
			message: 'This action cannot be undone.',
			confirmButtonText: t.yes_delete || 'Yes, delete',
			confirmButtonColor: '#d33'
		}).then(function (result) {
			if (!result.isConfirmed) return;
			$.ajax({
				url: '/fnb-hotel/service/' + id,
				method: 'DELETE',
				success: function () {
					Swal.fire({
						icon: 'success',
						title: t.deleted || 'Deleted',
						text: t.service_deleted || 'Service record has been deleted.',
						timer: 1500,
						showConfirmButton: false
					}).then(function () {
						if (typeof window.reloadFnbHotelData === 'function') {
							window.reloadFnbHotelData();
						} else {
							reloadData();
						}
					});
				},
				error: function (xhr) {
					Swal.fire({
						icon: 'error',
						title: t.error || 'Error',
						text: xhr.responseJSON && xhr.responseJSON.error ? xhr.responseJSON.error : (t.failed_to_delete || 'Failed to delete service record.')
					});
				}
			});
		});
	});

	$(document).on('click', '#modal-dash-hotel .gamebook-notice-btn', function () {
		var $row = $(this).closest('tr');
		var agentName = $row.find('td').eq(2).text().trim() || '-';
		var gameId = $row.find('td').eq(3).text().trim() || '-';
		Swal.fire({
			icon: 'info',
			title: 'Edit from Gamebook',
			html: '<p>This service is linked to a game. Please proceed to <strong>Gamebook</strong> to edit this record.</p><hr><p class="mb-1"><strong>Agent:</strong> ' + escapeHtml(agentName) + '</p><p class="mb-0"><strong>Game ID:</strong> ' + escapeHtml(gameId) + '</p>',
			confirmButtonText: 'OK'
		});
	});
});
