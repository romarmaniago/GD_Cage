/* Shared reload registry — must run before other dash service scripts' ready handlers */
(function () {
	if (typeof window.registerDashServiceReload === 'function') return;
	window.__dashServiceReloadFns = window.__dashServiceReloadFns || [];
	window.registerDashServiceReload = function (fn) {
		if (typeof fn !== 'function') return;
		window.__dashServiceReloadFns.push(fn);
		window.reloadFnbHotelData = function () {
			(window.__dashServiceReloadFns || []).forEach(function (reloadFn) { reloadFn(); });
			if (typeof window.refreshDashServiceBalances === 'function') {
				window.refreshDashServiceBalances();
			}
		};
	};
})();

$(document).ready(function () {
	if (!$('#modal-dash-service-category').length) return;

	var dataTable;
	var dateStart = null;
	var dateEnd = null;
	var flatpickrReady = false;
	var serviceCategorySplitDateRange = null;
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
		var raw = String(serviceType || '').trim();
		if (!raw) return false;
		var key = String(activeCategoryKey || '').trim();
		var label = String(activeCategoryLabel || '').trim();
		if (typeof window.matchesServiceCategory === 'function') {
			if (key && window.matchesServiceCategory(raw, key)) return true;
			if (label && window.matchesServiceCategory(raw, label)) return true;
		}
		var lower = raw.toLowerCase();
		if (key && lower === key.toLowerCase()) return true;
		if (label && lower === label.toLowerCase()) return true;
		return false;
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

	function getDashboardPeriodYmd() {
		if (typeof window.getDashPeriodYmd === 'function') {
			return window.getDashPeriodYmd();
		}
		var from = document.getElementById('dash-date-from');
		var to = document.getElementById('dash-date-to');
		var start = from ? String(from.value || '').trim().slice(0, 10) : '';
		var end = to ? String(to.value || '').trim().slice(0, 10) : '';
		if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
			return { start: start, end: end };
		}
		return null;
	}

	function extractRowIsoDate(cellData) {
		if (cellData == null) return '';
		if (typeof cellData === 'object') {
			var iso = cellData['@data-order'] || cellData.sort || cellData.filter || cellData._ || '';
			iso = String(iso || '').trim();
			if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
			if (/^\d+$/.test(iso)) {
				var fromTs = new Date(Number(iso));
				if (!Number.isNaN(fromTs.getTime())) return formatYmdLocal(fromTs);
			}
			if (cellData.display != null) return '';
		}
		return '';
	}

	$.fn.dataTable.ext.search.push(function (settings, data, dataIndex) {
		if (!settings || !settings.nTable || settings.nTable.id !== 'dash-service-category-table') return true;
		if (!dateStart || !dateEnd) return true;

		var iso = '';
		var rowData = settings.aoData && settings.aoData[dataIndex] ? settings.aoData[dataIndex]._aData : null;
		if (rowData) {
			iso = extractRowIsoDate(rowData[0]) || extractRowIsoDate(rowData[1]);
		}
		var rowDate = iso
			? parseRowDate(iso)
			: (parseRowDate(cellText(data && data[0] && data[0].display !== undefined ? data[0].display : data[0]))
				|| parseRowDate(cellText(data && data[1] && data[1].display !== undefined ? data[1].display : data[1])));
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
			window.bindDashServiceTableControls('dash-service-category-table', 'btn-dash-service-category-new-record');
		}
	}

	function buildActionHtml(service) {
		var hasGameId = !!service.GAME_ID;
		var isGameSettled = hasGameId && service.game_settled === 1;
		var canEdit = !hasGameId;
		var canDelete = !hasGameId;
		var safeRemarks = (service.REMARKS || '').replace(/"/g, '&quot;');
		var receiptBtn = (window.fnbHotelReceipt && window.fnbHotelReceipt.buttonHtml)
			? window.fnbHotelReceipt.buttonHtml(service)
			: '';

		if (canEdit && canDelete) {
			return [
				'<div class="btn-group">',
				receiptBtn,
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
				' title="Delete"><i class="fa fa-trash-alt"></i></button>',
				'</div>'
			].join('');
		}
		if (hasGameId && isGameSettled) {
			return '<div class="btn-group">' + receiptBtn + '<span class="badge bg-success-subtle text-success fw-semibold px-3 py-2">Settled</span></div>';
		}
		if (hasGameId && !isGameSettled) {
			return '<div class="btn-group">' + receiptBtn + '<button type="button" class="btn btn-sm bg-warning-subtle text-warning gamebook-notice-btn" title="Edit in Gamebook"><i class="fa fa-info-circle"></i></button></div>';
		}
		return receiptBtn ? '<div class="btn-group">' + receiptBtn + '</div>' : '';
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
						{ display: programDateDisplay, _: programDateOrder, sort: programDateOrder, filter: programDateOrder, '@data-order': programDateOrder },
						{ display: formatDateForDisplay(service.ENCODED_DT), _: String(rawDate), sort: String(rawDate), filter: formatYmdLocal(service.ENCODED_DT ? new Date(service.ENCODED_DT) : new Date(0)), '@data-order': String(rawDate) },
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
				console.error('Error loading dashboard service category data:', error);
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

	function setFilterDatesFromApi(startYmd, endYmd) {
		var startDate = ymdToLocalDate(startYmd);
		var endDate = ymdToLocalDate(apiEndDate(endYmd));
		if (!startDate || !endDate) return;
		if (startDate > endDate) {
			var swap = startDate;
			startDate = endDate;
			endDate = swap;
		}
		dateStart = startDate;
		dateEnd = endDate;
		var rangeEl = document.getElementById('dash-service-category-daterange');
		if (rangeEl && rangeEl._flatpickr) {
			try {
				rangeEl._flatpickr.setDate([startDate, endDate], false);
			} catch (err) { /* ignore */ }
		}
		if (dataTable) dataTable.draw();
	}

	function syncFilterDatesFromDashboard() {
		var period = getDashboardPeriodYmd();
		if (period) {
			setFilterDatesFromApi(period.start, period.end);
			return true;
		}
		return false;
	}

	function prepareModalAndReload() {
		initDateRangePicker();
		if (!syncFilterDatesFromDashboard() && (!dateStart || !dateEnd)) {
			var range = getDefaultDateRange();
			dateStart = range.startAt || range.start || null;
			dateEnd = range.endAt || range.end || null;
		}
		if (!dataTable) initializeDataTable();
		reloadData();
	}

	function initServiceCategorySplitDateRange() {
		if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
			serviceCategorySplitDateRange = { fitWidths: function () {} };
			return;
		}

		serviceCategorySplitDateRange = window.SplitDateRange.attach({
			rangePickerId: 'dash-service-category-daterange',
			startId: 'dash-service-category-start-date',
			endId: 'dash-service-category-end-date',
			splitWrapperId: 'dash-service-category-split-daterange-wrapper',
			independent: true,
			invalidDateMessage: 'Invalid date range.',
			onRangeApplied: function (range) {
				if (!range || !range.start || !range.end) return;
				setFilterDatesFromApi(range.start, range.end);
			}
		});
	}

	function initDateRangePicker() {
		if (flatpickrReady || typeof flatpickr !== 'function') return;
		var range = getDefaultDateRange();
		dateStart = range.startAt || range.start || null;
		dateEnd = range.endAt || range.end || null;

		initServiceCategorySplitDateRange();

		flatpickr('#dash-service-category-daterange', {
			mode: 'range',
			defaultDate: dateStart && dateEnd ? [dateStart, dateEnd] : undefined,
			showMonths: 2,
			onChange: function (selectedDates) {
				if (selectedDates.length === 2) {
					dateStart = selectedDates[0];
					dateEnd = selectedDates[1];
					if (dataTable) dataTable.draw();
				}
			},
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

	window.registerDashServiceReload(reloadData);

	window.openDashServiceCategoryModal = function (categoryKey, categoryLabel, modalId) {
		activeCategoryKey = String(categoryKey || '').trim();
		activeCategoryLabel = String(categoryLabel || categoryKey || '').trim();
		var targetModalId = modalId || 'modal-dash-service-category';
		var presetLabel = activeCategoryLabel || activeCategoryKey;
		window.__dashServiceActiveCategory = presetLabel;
		window.__dashServicePresetType = presetLabel;

		if (targetModalId !== 'modal-dash-service-category') {
			var legacyModal = document.getElementById(targetModalId);
			if (legacyModal && window.bootstrap && bootstrap.Modal) {
				var legacyPresets = {
					'modal-dash-fnb': 'F & B',
					'modal-dash-hotel': 'Hotel',
					'modal-dash-delivery': 'Delivery',
					'modal-dash-incidental': 'Incidental'
				};
				var legacyPreset = legacyPresets[targetModalId] || presetLabel;
				window.__dashServiceActiveCategory = legacyPreset;
				window.__dashServicePresetType = legacyPreset;
				bootstrap.Modal.getOrCreateInstance(legacyModal).show();
				return;
			}
		}

		$('#modal-dash-service-category-label').text(activeCategoryLabel || 'Service Category');
		$('#btn-dash-service-category-new-record').attr('data-service-preset', presetLabel);
		var modalEl = document.getElementById('modal-dash-service-category');
		if (!modalEl || !window.bootstrap || !bootstrap.Modal) return;

		var alreadyOpen = modalEl.classList.contains('show');
		bootstrap.Modal.getOrCreateInstance(modalEl).show();
		// show.bs.modal may not re-fire when already open — always load for the clicked category
		if (alreadyOpen) {
			prepareModalAndReload();
		}
	};

	$('#modal-dash-service-category').on('show.bs.modal', function () {
		var preset = activeCategoryLabel || activeCategoryKey;
		if (preset) {
			window.__dashServiceActiveCategory = preset;
			window.__dashServicePresetType = preset;
			$('#btn-dash-service-category-new-record').attr('data-service-preset', preset);
		}
		prepareModalAndReload();
	});

	$('#modal-dash-service-category').on('shown.bs.modal', function () {
		if (typeof window.layoutDashServiceTableControls === 'function') {
			window.layoutDashServiceTableControls('dash-service-category-table', 'btn-dash-service-category-new-record');
		}
		if (serviceCategorySplitDateRange && typeof serviceCategorySplitDateRange.fitWidths === 'function') {
			serviceCategorySplitDateRange.fitWidths();
		}
		if (dataTable) {
			try {
				dataTable.columns.adjust().draw(false);
			} catch (error) {
				console.error(error);
			}
		}
	});

	$(document).on('mousedown', '#btn-dash-service-category-new-record, .js-dash-service-add', function () {
		var fromAttr = $(this).attr('data-service-preset') || '';
		var preset = fromAttr || activeCategoryLabel || activeCategoryKey || window.__dashServiceActiveCategory || '';
		if (preset) {
			window.__dashServicePresetType = preset;
			window.__dashServiceActiveCategory = preset;
		}
	});

	$('#btn-dash-service-category-new-record').on('click', function () {
		var preset = $(this).attr('data-service-preset') || activeCategoryLabel || activeCategoryKey;
		if (preset) {
			window.__dashServicePresetType = preset;
			window.__dashServiceActiveCategory = preset;
		}
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
							if (typeof window.refreshDashServiceBalances === 'function') {
								window.refreshDashServiceBalances();
							}
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
