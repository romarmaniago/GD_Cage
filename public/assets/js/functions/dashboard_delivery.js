$(document).ready(function () {
	if (!$('#modal-dash-delivery').length) return;

	var dataTable;
	var deliveryDateStart = null;
	var deliveryDateEnd = null;
	var flatpickrReady = false;
	var deliverySplitDateRange = null;
	var t = window.fnbHotelTranslations || {};

	function formatDateForDisplay(value) {
		if (!value) return '-';
		var d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
	}

	function formatYmdLocal(d) {
		var pad = function (n) { return String(n).padStart(2, '0'); };
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	}

	function formatProgramDateForDisplay(value) {
		if (!value) return '-';
		var raw = String(value).slice(0, 10);
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
			var parts = raw.split('-').map(Number);
			return parts[1] + '/' + parts[2] + '/' + parts[0];
		}
		var d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
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
		var text = String(value || '').trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
			var parts = text.split('-').map(Number);
			return new Date(parts[0], parts[1] - 1, parts[2]);
		}
		var d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}

	function isDeliveryServiceType(serviceType) {
		return typeof window.matchesServiceCategory === 'function'
			? window.matchesServiceCategory(serviceType, 'delivery')
			: (function () {
				var raw = String(serviceType || '').trim().toLowerCase();
				if (!raw) return false;
				if (raw === 'incidental' || raw.indexOf('incidental') !== -1) return false;
				return raw === 'delivery' || raw.indexOf('delivery') !== -1;
			})();
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
		if (!settings || !settings.nTable || settings.nTable.id !== 'dash-delivery-table') return true;
		if (!deliveryDateStart || !deliveryDateEnd) return true;
		var rawProgram = data && data[0] && data[0].display !== undefined ? data[0].display : data[0];
		var rawEncoded = data && data[1] && data[1].display !== undefined ? data[1].display : data[1];
		var rowDate = parseRowDate(cellText(rawProgram)) || parseRowDate(cellText(rawEncoded));
		if (!rowDate) return true;
		var start = new Date(deliveryDateStart.getFullYear(), deliveryDateStart.getMonth(), deliveryDateStart.getDate(), 0, 0, 0, 0);
		var end = new Date(deliveryDateEnd.getFullYear(), deliveryDateEnd.getMonth(), deliveryDateEnd.getDate(), 23, 59, 59, 999);
		return rowDate >= start && rowDate <= end;
	});

	function initializeDataTable() {
		if ($.fn.DataTable.isDataTable('#dash-delivery-table')) {
			$('#dash-delivery-table').DataTable().destroy();
		}

		dataTable = $('#dash-delivery-table').DataTable({
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
						if (rowMeta.col === 5 || rowMeta.col === 8) return;
						$(cell).addClass('text-center');
					}
				},
				{
					targets: [0, 1],
					render: function (data) {
						if (typeof data === 'object' && data && data.display !== undefined) return data.display;
						return data;
					}
				},
				{
					targets: [8],
					orderable: false,
					searchable: false
				}
			],
			language: {
				search: '',
				searchPlaceholder: t.search || 'Search...',
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

		if (typeof window.bindDashServiceTableControls === 'function') {
			window.bindDashServiceTableControls('dash-delivery-table', 'btn-dash-delivery-new-record');
		}
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
				' data-guest="', service.GUEST_ID || '', '"',
				' data-service="', escapeHtml(service.SERVICE_TYPE || ''), '"',
				' data-amount="', service.AMOUNT, '"',
				' data-remarks="', safeRemarks, '"',
				' data-transaction="', service.TRANSACTION_ID, '"',
				' data-program-date="', escapeHtml(String(service.PROGRAM_DATE || '').slice(0, 10)), '"',
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
			return '<div class="btn-group"><button type="button" class="btn btn-sm bg-warning-subtle text-warning gamebook-notice-btn" title="Edit in Gamebook"><i class="fa fa-info-circle"></i></button></div>';
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
					if (!isDeliveryServiceType(service.SERVICE_TYPE)) return;

					var amt = Number(service.AMOUNT) || 0;
					var amountHtml = typeof window.formatServiceChargeAmount === 'function'
						? window.formatServiceChargeAmount(amt, service.SOURCE_TYPE)
						: String(amt);
					var agentCode = String(service.agent_code || '').trim();
					var agentName = String(service.agent_name || '').trim();
					var agentHtml = agentCode && agentName
						? escapeHtml(agentCode + ' (' + agentName + ')')
						: escapeHtml(agentCode || agentName || '-');
					var guestHtml = escapeHtml(String(service.guest_name || '').trim() || '-');
					var programDateRaw = service.PROGRAM_DATE || '';
					var programDateDisplay = formatProgramDateForDisplay(programDateRaw);
					var programDateOrder = programDateRaw
						? String(programDateRaw).slice(0, 10)
						: (service.ENCODED_DT ? formatYmdLocal(new Date(service.ENCODED_DT)) : '');
					var rawDate = service.ENCODED_DT ? new Date(service.ENCODED_DT).getTime() : 0;

					dataTable.row.add([
						{ display: programDateDisplay, '@data-order': programDateOrder },
						{ display: formatDateForDisplay(service.ENCODED_DT), '@data-order': String(rawDate) },
						agentHtml,
						guestHtml,
						escapeHtml(service.SERVICE_TYPE || ''),
						amountHtml,
						paymentLabel(service.TRANSACTION_ID),
						window.RemarksEditor
							? window.RemarksEditor.renderCell(service.REMARKS || '', { source: 'game_services', recordId: service.IDNo })
							: escapeHtml(service.REMARKS || '-'),
						buildActionHtml(service)
					]);
				});

				dataTable.draw();
			},
			error: function (_xhr, _status, error) {
				console.error('Error loading dashboard Delivery data:', error);
			}
		});
	}

	function apiEndDate(endYmd) {
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

	function setDeliveryFilterDatesFromApi(startYmd, endYmd) {
		var startDate = ymdToLocalDate(startYmd);
		var endDate = ymdToLocalDate(apiEndDate(endYmd));
		if (!startDate || !endDate) return;
		if (startDate > endDate) {
			var swap = startDate;
			startDate = endDate;
			endDate = swap;
		}
		deliveryDateStart = startDate;
		deliveryDateEnd = endDate;
		if (dataTable) dataTable.draw();
	}

	function initDeliverySplitDateRange() {
		if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
			deliverySplitDateRange = { fitWidths: function () {} };
			return;
		}

		deliverySplitDateRange = window.SplitDateRange.attach({
			rangePickerId: 'dash-delivery-daterange',
			startId: 'dash-delivery-start-date',
			endId: 'dash-delivery-end-date',
			splitWrapperId: 'dash-delivery-split-daterange-wrapper',
			independent: true,
			invalidDateMessage: 'Invalid date range.',
			onRangeApplied: function (range) {
				if (!range || !range.start || !range.end) return;
				setDeliveryFilterDatesFromApi(range.start, range.end);
			}
		});
	}

	function initDateRangePicker() {
		if (flatpickrReady || typeof flatpickr !== 'function') return;
		var range = getDefaultDateRange();
		deliveryDateStart = range.startAt || range.start || null;
		deliveryDateEnd = range.endAt || range.end || null;

		initDeliverySplitDateRange();

		flatpickr('#dash-delivery-daterange', {
			mode: 'range',
			defaultDate: deliveryDateStart && deliveryDateEnd ? [deliveryDateStart, deliveryDateEnd] : undefined,
			showMonths: 2,
			onChange: function (selectedDates) {
				if (selectedDates.length === 2) {
					deliveryDateStart = selectedDates[0];
					deliveryDateEnd = selectedDates[1];
					if (dataTable) dataTable.draw();
				}
			},
			onClose: function (selectedDates) {
				if (!selectedDates || selectedDates.length === 0) {
					deliveryDateStart = null;
					deliveryDateEnd = null;
				} else if (selectedDates.length === 2) {
					deliveryDateStart = selectedDates[0];
					deliveryDateEnd = selectedDates[1];
				}
				if (dataTable) dataTable.draw();
			}
		});
		flatpickrReady = true;
	}

	if (typeof window.registerDashServiceReload === 'function') {
		window.registerDashServiceReload(reloadData);
	}

	$('#modal-dash-delivery').on('show.bs.modal', function () {
		initDateRangePicker();
		if (!dataTable) initializeDataTable();
		reloadData();
	});

	$('#modal-dash-delivery').on('shown.bs.modal', function () {
		if (typeof window.layoutDashServiceTableControls === 'function') {
			window.layoutDashServiceTableControls('dash-delivery-table', 'btn-dash-delivery-new-record');
		}
		if (deliverySplitDateRange && typeof deliverySplitDateRange.fitWidths === 'function') {
			deliverySplitDateRange.fitWidths();
		}
		if (dataTable) {
			try {
				dataTable.columns.adjust().draw(false);
			} catch (error) {
				console.error(error);
			}
		}
	});

	$('#btn-dash-delivery-new-record').on('click', function () {
		window.__dashServicePresetType = 'Delivery';
	});

	$(document).on('click', '#modal-dash-delivery .edit-service-btn', function () {
		var $btn = $(this);
		var payload = {
			id: $btn.attr('data-id') || $btn.data('id'),
			sourceType: $btn.attr('data-source') || '',
			agentId: $btn.attr('data-agent') || '',
			guestId: $btn.attr('data-guest') || '',
			serviceType: $btn.attr('data-service') || '',
			amount: $btn.attr('data-amount') || 0,
			remarks: $btn.attr('data-remarks') || '',
			transactionId: $btn.attr('data-transaction') || '',
			programDate: String($btn.attr('data-program-date') || '').trim().slice(0, 10)
		};
		if (typeof window.openEditChargeModal === 'function') {
			window.openEditChargeModal(payload);
		}
	});

	$(document).on('click', '#modal-dash-delivery .delete-service-btn', function () {
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

	$(document).on('click', '#modal-dash-delivery .gamebook-notice-btn', function () {
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
