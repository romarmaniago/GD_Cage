$(document).ready(function () {
	if (!$('#modal-dash-service-category').length) return;

	var dataTable;
	var dateStart = null;
	var dateEnd = null;
	var flatpickrReady = false;
	var activeCategoryKey = '';
	var activeCategoryLabel = '';
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

	function matchesActiveCategory(serviceType) {
		return typeof window.matchesServiceCategory === 'function'
			? window.matchesServiceCategory(serviceType, activeCategoryKey)
			: String(serviceType || '').trim().toLowerCase() === String(activeCategoryKey || '').trim().toLowerCase();
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
		if (!settings || !settings.nTable || settings.nTable.id !== 'dash-service-category-table') return true;
		if (!dateStart || !dateEnd) return true;
		var rawProgram = data && data[0] && data[0].display !== undefined ? data[0].display : data[0];
		var rawEncoded = data && data[1] && data[1].display !== undefined ? data[1].display : data[1];
		var rowDate = parseRowDate(cellText(rawProgram)) || parseRowDate(cellText(rawEncoded));
		if (!rowDate) return true;
		var start = new Date(dateStart.getFullYear(), dateStart.getMonth(), dateStart.getDate(), 0, 0, 0, 0);
		var end = new Date(dateEnd.getFullYear(), dateEnd.getMonth(), dateEnd.getDate(), 23, 59, 59, 999);
		return rowDate >= start && rowDate <= end;
	});

	function initializeDataTable() {
		if ($.fn.DataTable.isDataTable('#dash-service-category-table')) {
			$('#dash-service-category-table').DataTable().destroy();
		}

		dataTable = $('#dash-service-category-table').DataTable({
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
			return '<button type="button" class="btn btn-sm bg-warning-subtle text-warning gamebook-notice-btn" title="Edit in Gamebook"><i class="fa fa-info-circle"></i></button>';
		}
		return '';
	}

	function reloadData() {
		if (!dataTable || !activeCategoryKey) return;

		$.ajax({
			url: '/fnb-hotel/data',
			method: 'GET',
			success: function (services) {
				dataTable.clear();

				(services || []).forEach(function (service) {
					if (!matchesActiveCategory(service.SERVICE_TYPE)) return;

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
					var amountClass = isJunketSource ? 'text-danger' : (isSettle ? 'text-primary' : '');
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
						'<span class="' + amountClass + '">' + displayAmt + '</span>',
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
				console.error('Error loading dashboard service category data:', error);
			}
		});
	}

	function initDateRangePicker() {
		if (flatpickrReady || typeof flatpickr !== 'function') return;
		var range = getDefaultDateRange();
		dateStart = range.startAt || range.start || null;
		dateEnd = range.endAt || range.end || null;

		flatpickr('#dash-service-category-daterange', {
			mode: 'range',
			defaultDate: dateStart && dateEnd ? [dateStart, dateEnd] : undefined,
			showMonths: 2,
			onClose: function (selectedDates) {
				if (!selectedDates || selectedDates.length === 0) {
					dateStart = null;
					dateEnd = null;
				} else if (selectedDates.length === 2) {
					dateStart = selectedDates[0];
					dateEnd = selectedDates[1];
				}
				if (dataTable) dataTable.draw();
			}
		});
		flatpickrReady = true;
	}

	if (typeof window.registerDashServiceReload === 'function') {
		window.registerDashServiceReload(reloadData);
	}

	window.openDashServiceCategoryModal = function (categoryKey, categoryLabel, modalId) {
		activeCategoryKey = String(categoryKey || '').trim();
		activeCategoryLabel = String(categoryLabel || categoryKey || '').trim();
		var targetModalId = modalId || 'modal-dash-service-category';

		if (targetModalId !== 'modal-dash-service-category') {
			var legacyModal = document.getElementById(targetModalId);
			if (legacyModal && window.bootstrap && bootstrap.Modal) {
				bootstrap.Modal.getOrCreateInstance(legacyModal).show();
				return;
			}
		}

		$('#modal-dash-service-category-label').text(activeCategoryLabel || 'Service Category');
		var modalEl = document.getElementById('modal-dash-service-category');
		if (modalEl && window.bootstrap && bootstrap.Modal) {
			bootstrap.Modal.getOrCreateInstance(modalEl).show();
		}
	};

	$('#modal-dash-service-category').on('show.bs.modal', function () {
		initDateRangePicker();
		if (!dataTable) initializeDataTable();
		reloadData();
	});

	$('#btn-dash-service-category-new-record').on('click', function () {
		window.__dashServicePresetType = activeCategoryLabel || activeCategoryKey;
	});

	$(document).on('click', '#modal-dash-service-category .edit-service-btn', function () {
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

	$(document).on('click', '#modal-dash-service-category .delete-service-btn', function () {
		var id = $(this).data('id');
		SwalConfirm.fire({
			title: t.delete_confirmation || 'Delete Service Record?',
			message: t.delete_cancelled ? 'This action cannot be undone.' : 'This action cannot be undone.',
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

	$(document).on('click', '#modal-dash-service-category .gamebook-notice-btn', function () {
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
