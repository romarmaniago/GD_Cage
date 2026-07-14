$(document).ready(function() {
	let dataTable;
	let currentFilter = 'all';
	const defaultDateRange = (window.MonthEndCutoffRange && window.MonthEndCutoffRange.getMonthEndCutoffRange()) || getCurrentMonthRange();
	let fnbHotelDateStart = defaultDateRange.startAt || defaultDateRange.start;
	let fnbHotelDateEnd = defaultDateRange.endAt || defaultDateRange.end;
	if (window.MonthEndCutoffRange && defaultDateRange.endDateApi) {
		const endParts = String(defaultDateRange.endDateApi).slice(0, 10).split('-').map(Number);
		fnbHotelDateEnd = new Date(endParts[0], endParts[1] - 1, endParts[2]);
	}
	let fnbHotelSplitOverrideRange = null;

	// Helpers (mirror the EJS helpers)
	function formatDateForDisplay(value) {
		if (!value) return '-';
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
	}

	function paymentLabel(transactionId) {
		switch (parseInt(transactionId, 10)) {
			case 1:
				return 'Cash';
			case 2:
				return 'Deposit';
			case 3:
				return 'Settle';
			default:
				return '-';
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

	function formatProgramDateForDisplay(value) {
		if (!value) return '-';
		const raw = String(value).slice(0, 10);
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
			const parts = raw.split('-').map(Number);
			return `${parts[1]}/${parts[2]}/${parts[0]}`;
		}
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
	}

	function formatYmdLocal(d) {
		const pad = (n) => String(n).padStart(2, '0');
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	}

	function parseFnbHotelDate(value) {
		const text = String(value || '').trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
			const parts = text.split('-').map(Number);
			return new Date(parts[0], parts[1] - 1, parts[2]);
		}
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}

	function getCurrentMonthRange() {
		if (window.MonthEndCutoffRange) {
			return window.MonthEndCutoffRange.getMonthEndCutoffRange();
		}
		const now = new Date();
		const y = now.getFullYear();
		const m = now.getMonth();
		const startAt = new Date(y, m, 0);
		const endAt = new Date(y, m + 1, 0);
		endAt.setDate(endAt.getDate() - 1);
		return { startAt, endAt };
	}

	$.fn.dataTable.ext.search.push(function (settings, data) {
		if (!settings || !settings.nTable || settings.nTable.id !== 'fnb-hotel-table') return true;
		if (currentFilter && currentFilter !== 'all') {
			var serviceType = cellText(data[4]);
			if (!window.matchesServiceCategory || !window.matchesServiceCategory(serviceType, currentFilter)) return false;
		}
		if (!fnbHotelDateStart || !fnbHotelDateEnd) return true;
		const rawProgram = data && data[0] && data[0].display !== undefined ? data[0].display : data[0];
		const rawEncoded = data && data[1] && data[1].display !== undefined ? data[1].display : data[1];
		const rowDate = parseFnbHotelDate(cellText(rawProgram)) || parseFnbHotelDate(cellText(rawEncoded));
		if (!rowDate) return true;
		const start = new Date(fnbHotelDateStart.getFullYear(), fnbHotelDateStart.getMonth(), fnbHotelDateStart.getDate(), 0, 0, 0, 0);
		const end = new Date(fnbHotelDateEnd.getFullYear(), fnbHotelDateEnd.getMonth(), fnbHotelDateEnd.getDate(), 23, 59, 59, 999);
		return rowDate >= start && rowDate <= end;
	});

	// Initialize DataTable
	function initializeDataTable() {
		if ($.fn.DataTable.isDataTable('#fnb-hotel-table')) {
			$('#fnb-hotel-table').DataTable().destroy();
		}

		const translations = window.fnbHotelTranslations || {};

		dataTable = $('#fnb-hotel-table').DataTable({
			pageLength: 10,
			lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
			searching: true,
			ordering: true,
			info: true,
			paging: true,
			order: [[0, 'desc']], // Sort by Program Date (descending)
			columnDefs: [
				{
					targets: '_all',
					createdCell: function (cell, _cellData, rowMeta) {
						if (rowMeta.col === 5 || rowMeta.col === 8) return;
						$(cell).addClass('text-center');
					}
				},
				{
					targets: [0, 1], // Program Date + Date: sort by data-order / @data-order
					render: function (data) {
						if (typeof data === 'object' && data && data.display !== undefined) return data.display;
						return data;
					}
				},
				{
					targets: [8], // Action column
					orderable: false,
					searchable: false,
					className: 'text-start'
				}
			],
			language: {
				search: "",
				searchPlaceholder: translations.search || "Search...",
				lengthMenu: translations.lengthMenu || "Show _MENU_ entries",
				info: translations.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries",
				infoEmpty: translations.infoEmpty || "Showing 0 to 0 of 0 entries",
				infoFiltered: translations.infoFiltered || "(filtered from _MAX_ total entries)",
				paginate: {
					previous: translations.previous || "Previous",
					next: translations.next || "Next"
				},
				emptyTable: translations.no_data_found || "No data available in table"
			}
		});

		// Apply initial filter to already-rendered rows
		updateFilter(currentFilter);
	}

	function updateFilter(filter) {
		if (!dataTable) return;

		currentFilter = filter || 'all';
		dataTable.column(4).search('').draw();
	}

	// Filter functionality (custom search uses currentFilter via ext.search)
	$('#fnb-hotel-filter').on('click', '.filter-link', function (event) {
		event.preventDefault();
		const selectedFilter = $(this).data('filter');
		if (!selectedFilter) return;

		$('#fnb-hotel-filter .filter-link').removeClass('active');
		$(this).addClass('active');
		updateFilter(selectedFilter);
	});

	window.addEventListener('fnbHotelFilterTabsUpdated', function (event) {
		const activeFilter = event && event.detail ? event.detail.activeFilter : 'all';
		updateFilter(activeFilter || 'all');
	});

	if (typeof window.renderFnbHotelFilterTabs === 'function') {
		window.renderFnbHotelFilterTabs();
	}

	// Reload data (similar pattern to manage_user.js)
	function reloadData() {
		if (!dataTable) return;

		$.ajax({
			url: '/fnb-hotel/data',
			method: 'GET',
			success: function(services) {
				dataTable.clear();

				services.forEach(function(service) {
					const amt = Number(service.AMOUNT) || 0;
					const hasDecimals = amt % 1 !== 0;
					const formattedAmt = hasDecimals
						? amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
						: amt.toLocaleString('en-US');
					const isJunketSource = service.SOURCE_TYPE === 'JUNKET';
					const isSettle = parseInt(service.TRANSACTION_ID, 10) === 3;
					const displayAmt = isJunketSource
						? (window.fmtOut ? window.fmtOut(amt) : '(' + formattedAmt + ')')
						: formattedAmt;
					const hasGameId = !!service.GAME_ID;
					const isGameSettled = hasGameId && service.game_settled === 1;
					const canEdit = !hasGameId;
					const canDelete = !hasGameId;

					const amountClass = isJunketSource ? 'text-danger' : (isSettle ? 'text-primary' : '');

					const agentCode = String(service.agent_code || '').trim();
					const agentName = String(service.agent_name || '').trim();
					const agentHtml = agentCode && agentName
						? escapeHtml(agentCode + ' (' + agentName + ')')
						: escapeHtml(agentCode || agentName || '-');
					const guestHtml = escapeHtml(String(service.guest_name || '').trim() || '-');
					const serviceTypeHtml = service.SERVICE_TYPE || '';
					const amountHtml = `<span class="${amountClass}">${displayAmt}</span>`;
					const paymentHtml = paymentLabel(service.TRANSACTION_ID);
					const remarksHtml = window.RemarksEditor
						? window.RemarksEditor.renderCell(service.REMARKS || '', {
							source: 'game_services',
							recordId: service.IDNo
						})
						: (service.REMARKS || '-');
					const programDateRaw = service.PROGRAM_DATE || '';
					const programDateDisplay = formatProgramDateForDisplay(programDateRaw);
					const programDateOrder = programDateRaw
						? String(programDateRaw).slice(0, 10)
						: (service.ENCODED_DT ? formatYmdLocal(new Date(service.ENCODED_DT)) : '');
					const programDateCellData = { display: programDateDisplay, '@data-order': programDateOrder };
					const rawDate = service.ENCODED_DT ? new Date(service.ENCODED_DT).getTime() : 0;
					const dateDisplay = formatDateForDisplay(service.ENCODED_DT);
					// Orthogonal data: display text for show, @data-order for correct date sort
					const dateCellData = { display: dateDisplay, '@data-order': String(rawDate) };

					const safeRemarks = (service.REMARKS || '').replace(/"/g, '&quot;');

					let actionHtml = '';
					if (canEdit && canDelete) {
						actionHtml = `
							<div class="btn-group">
								<button type="button"
									class="btn btn-sm bg-info-subtle edit-service-btn"
									data-id="${service.IDNo}"
									data-source="${escapeHtml(service.SOURCE_TYPE || '')}"
									data-agent="${service.AGENT_ID || ''}"
									data-guest="${service.GUEST_ID || ''}"
									data-service="${escapeHtml(service.SERVICE_TYPE || '')}"
									data-amount="${service.AMOUNT}"
									data-remarks="${safeRemarks}"
									data-transaction="${service.TRANSACTION_ID}"
									data-program-date="${escapeHtml(String(service.PROGRAM_DATE || '').slice(0, 10))}"
									title="Edit">
									<i class="fa fa-pencil-alt"></i>
								</button>
								<button type="button"
									class="btn btn-sm bg-danger-subtle delete-service-btn"
									data-id="${service.IDNo}"
									title="Delete">
									<i class="fa fa-trash"></i>
								</button>
							</div>`;
					} else if (hasGameId && isGameSettled) {
						actionHtml = `
							<span class="badge bg-success-subtle text-success fw-semibold px-3 py-2">
								Settled
							</span>`;
					} else if (hasGameId && !isGameSettled) {
						actionHtml = `
							<div class="btn-group">
								<button type="button"
									class="btn btn-sm bg-warning-subtle text-warning gamebook-notice-btn"
									title="Edit in Gamebook">
									<i class="fa fa-info-circle"></i>
								</button>
							</div>`;
					}

					dataTable.row.add([
						programDateCellData,
						dateCellData,
						agentHtml,
						guestHtml,
						serviceTypeHtml,
						amountHtml,
						paymentHtml,
						remarksHtml,
						actionHtml
					]);
				});

				dataTable.draw();
				// Re-apply current filter
				updateFilter(currentFilter);
			},
			error: function(xhr, status, error) {
				console.error('Error loading F&B / Hotel data:', error);
			}
		});
	}

	// Expose reload for other scripts (new/edit modals)
	window.reloadFnbHotelData = reloadData;

	function getFnbHotelExportFilename() {
		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const d = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
		return 'FnbHotel_' + d + '.xlsx';
	}

	function getFnbHotelTablePayload() {
		const dt = $('#fnb-hotel-table').DataTable();
		const actionColIndex = 8;
		const headers = [];
		$('#fnb-hotel-table thead tr:first th').each(function (i) {
			if (i === actionColIndex) return;
			headers.push($(this).text().trim());
		});
		const rows = [];
		dt.rows({ search: 'applied' }).every(function () {
			const cells = [];
			$(this.node())
				.find('td')
				.each(function (i) {
					if (i === actionColIndex) return;
					cells.push($(this).text().trim());
				});
			if (cells.length) rows.push(cells);
		});
		return { headers, rows };
	}

	function getFnbHotelPrintStyles() {
		return [
			'@page{size:landscape;margin:8mm;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'.print-wrap{width:100%;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
			'table{width:100%;border-collapse:collapse;font-size:10px;}',
			'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;text-align:left;}',
			'th{background:#d9e1f2;font-weight:700;}',
			'th:nth-child(6),td:nth-child(6){text-align:right;padding-right:14px;}'
		].join('');
	}

	function printFnbHotelTable() {
		if (!$.fn.DataTable.isDataTable('#fnb-hotel-table')) return;
		const payload = getFnbHotelTablePayload();
		const t = window.fnbHotelTranslations || {};
		if (payload.rows.length === 0) {
			if (window.Swal) {
				Swal.fire({
					icon: 'info',
					title: 'Print',
					text: t.no_data_available || 'No rows to print for the current filter.',
					confirmButtonColor: '#0d6efd'
				});
			} else {
				alert(t.no_data_available || 'No rows to print.');
			}
			return;
		}

		const headerHtml = payload.headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('');
		const rowsHtml = payload.rows.map((row) => {
			return '<tr>' + row.map((cell) => '<td>' + escapeHtml(cell) + '</td>').join('') + '</tr>';
		}).join('');
		const dateRange = getFnbHotelDateRangeLabel() || 'All dates';
		const iframe = document.createElement('iframe');
		iframe.style.position = 'fixed';
		iframe.style.right = '0';
		iframe.style.bottom = '0';
		iframe.style.width = '0';
		iframe.style.height = '0';
		iframe.style.border = '0';
		document.body.appendChild(iframe);

		const frameWindow = iframe.contentWindow;
		const frameDoc = frameWindow.document;
		frameDoc.open();
		frameDoc.write([
			'<!doctype html><html><head><title>F&B / Hotel</title><style>',
			getFnbHotelPrintStyles(),
			'</style></head><body><div class="print-wrap">',
			'<h2>F&B / Hotel</h2>',
			'<div class="subtitle">', escapeHtml(dateRange), '</div>',
			'<table><thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody></table>',
			'</div></body></html>'
		].join(''));
		frameDoc.close();

		const cleanup = function () {
			setTimeout(function () {
				if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
			}, 300);
		};
		frameWindow.onafterprint = cleanup;
		setTimeout(function () {
			frameWindow.focus();
			frameWindow.print();
			cleanup();
		}, 250);
	}

	$('#btn-fnb-hotel-export').on('click', function (e) {
		e.preventDefault();
		if (!$.fn.DataTable.isDataTable('#fnb-hotel-table')) return;
		const payload = getFnbHotelTablePayload();
		const headers = payload.headers;
		const rows = payload.rows;
		const t = window.fnbHotelTranslations || {};
		if (rows.length === 0) {
			if (window.Swal) {
				Swal.fire({
					icon: 'info',
					title: t.export_label || 'Export',
					text: t.no_data_available || 'No rows to export for the current filter.',
					confirmButtonColor: '#0d6efd'
				});
			} else {
				alert(t.no_data_available || 'No rows to export.');
			}
			return;
		}
		const outName = getFnbHotelExportFilename();
		const $btn = $(this);
		$btn.prop('disabled', true);
		fetch('/fnb-hotel/export_xlsx', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ headers: headers, rows: rows, filename: outName })
		})
			.then(function (res) {
				if (!res.ok) {
					return res.json().catch(function () { return {}; }).then(function (j) {
						throw new Error((j && j.error) ? j.error : 'Export failed');
					});
				}
				return res.blob();
			})
			.then(function (blob) {
				const link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = outName;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(link.href);
			})
			.catch(function (err) {
				if (window.Swal) {
					Swal.fire({
						icon: 'error',
						title: t.error || 'Error',
						text: err.message || 'Export failed',
						confirmButtonColor: '#0d6efd'
					});
				} else {
					alert(err.message || 'Export failed');
				}
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	});

	$('#btn-fnb-hotel-print').on('click', function (e) {
		e.preventDefault();
		printFnbHotelTable();
	});

	function getFnbHotelDateInput() {
		return document.getElementById('fnb-hotel-daterange');
	}

	function fnbHotelApiEndDate(endYmd) {
		if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
		const parts = String(endYmd).slice(0, 10).split('-').map(Number);
		const lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
		if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
			return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
		}
		return endYmd;
	}

	function fnbHotelExpandEndDate(dateValue) {
		if (!dateValue || !(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return dateValue;
		const expanded = fnbHotelApiEndDate(formatYmdLocal(dateValue));
		if (expanded === formatYmdLocal(dateValue)) return dateValue;
		const parts = String(expanded).slice(0, 10).split('-').map(Number);
		return new Date(parts[0], parts[1] - 1, parts[2]);
	}

	function getFnbHotelDateRangeLabel() {
		const el = getFnbHotelDateInput();
		if (el && el._flatpickr) {
			if (el._flatpickr.altInput && el._flatpickr.altInput.value) {
				return el._flatpickr.altInput.value.trim();
			}
			if (el._flatpickr.selectedDates && el._flatpickr.selectedDates.length === 2) {
				const a = el._flatpickr.selectedDates[0];
				const b = el._flatpickr.selectedDates[1];
				if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.formatDisplayDate === 'function') {
					return window.MonthEndCutoffRange.formatDisplayDate(a) + ' to ' + window.MonthEndCutoffRange.formatDisplayDate(b);
				}
			}
		}
		return ($('#fnb-hotel-daterange').val() || '').trim();
	}

	let fnbHotelDatePicker = null;
	const fnbHotelSplitDateRange = (window.SplitDateRange && SplitDateRange.attach({
		rangePickerId: 'fnb-hotel-daterange',
		startId: 'fnb-hotel-start-date',
		endId: 'fnb-hotel-end-date',
		splitWrapperId: 'fnb-hotel-split-daterange-wrapper',
		independent: true,
		invalidDateMessage: (window.fnbHotelTranslations && window.fnbHotelTranslations.invalid_date) || 'Invalid date range.',
		onRangeApplied: function (range) {
			if (!range || !range.startDate || !range.endDate) return;
			const startDate = range.startDate;
			const endDate = fnbHotelExpandEndDate(range.endDate);
			fnbHotelSplitOverrideRange = { start: startDate, end: endDate };
			applyFnbHotelDateFilter([startDate, endDate]);
		}
	})) || { syncFromRange: function () {}, isSyncing: function () { return false; } };

	function applyFnbHotelDateFilter(selectedDates) {
		if (fnbHotelSplitOverrideRange && fnbHotelSplitOverrideRange.start && fnbHotelSplitOverrideRange.end) {
			fnbHotelDateStart = fnbHotelSplitOverrideRange.start;
			fnbHotelDateEnd = fnbHotelSplitOverrideRange.end;
		} else if (!selectedDates || selectedDates.length === 0) {
			fnbHotelDateStart = null;
			fnbHotelDateEnd = null;
		} else if (selectedDates.length >= 1) {
			fnbHotelDateStart = selectedDates[0];
			fnbHotelDateEnd = fnbHotelExpandEndDate(selectedDates[selectedDates.length - 1]);
		}
		if (dataTable) dataTable.draw();
	}

	if (typeof flatpickr === 'function') {
		function jumpFnbHotelRangeToCurrentThreeMonths(instance) {
			if (!instance) return;
			const now = new Date();
			instance.jumpToDate(new Date(now.getFullYear(), now.getMonth() - 2, 1), false);
		}

		fnbHotelDatePicker = flatpickr('#fnb-hotel-daterange', {
			mode: 'range',
			showMonths: 3,
			onReady: function (_selectedDates, _dateStr, instance) {
				jumpFnbHotelRangeToCurrentThreeMonths(instance);
				if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
					window.setupFlatpickrMonthNameRangeSelect(instance);
				}
				if (_selectedDates && _selectedDates.length === 2) {
					applyFnbHotelDateFilter(_selectedDates);
				}
			},
			onOpen: function (_selectedDates, _dateStr, instance) {
				jumpFnbHotelRangeToCurrentThreeMonths(instance);
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
				fnbHotelSplitOverrideRange = null;
				if (selectedDates.length === 2) {
					applyFnbHotelDateFilter(selectedDates);
				}
			},
			onClose: function (selectedDates) {
				if (selectedDates.length === 2) {
					fnbHotelSplitOverrideRange = null;
					applyFnbHotelDateFilter(selectedDates);
				}
			}
		});
	}

	// Initialize DataTable then load rows (clickable remarks via RemarksEditor)
	initializeDataTable();
	reloadData();

	// Edit service button handlers
	$(document).on('click', '.edit-service-btn', function() {
		const $btn = $(this);
		const payload = {
			id: $btn.attr('data-id') || $btn.data('id'),
			sourceType: $btn.attr('data-source') || '',
			agentId: $btn.attr('data-agent') || '',
			guestId: $btn.attr('data-guest') || '',
			serviceType: $btn.attr('data-service') || '',
			amount: $btn.attr('data-amount') || $btn.data('amount') || 0,
			remarks: $btn.attr('data-remarks') || '',
			transactionId: $btn.attr('data-transaction') || '',
			programDate: String($btn.attr('data-program-date') || '').trim().slice(0, 10)
		};

		if (typeof window.openEditChargeModal === 'function') {
			window.openEditChargeModal(payload);
			return;
		}

		$('#edit-services-id').val(payload.id);
		$('#edit-services-amount').val((parseFloat(String(payload.amount).replace(/,/g, '')) || 0).toLocaleString('en-US'));
		$('#edit-services-remarks').val(payload.remarks);
		$('#edit-services-transaction-id').val(payload.transactionId || '');
		$('#modal-services-edit-record').modal('show');
	});

	// Delete service button handlers
	$(document).on('click', '.delete-service-btn', function() {
		const id = $(this).data('id');
		SwalConfirm.fire({
			title: 'Delete Service Record?',
			message: 'This action cannot be undone.',
			confirmButtonText: 'Yes, delete',
			confirmButtonColor: '#d33'
		}).then((result) => {
			if (result.isConfirmed) {
				$.ajax({
					url: `/fnb-hotel/service/${id}`,
					method: 'DELETE',
					success: function() {
						Swal.fire({
							icon: 'success',
							title: 'Deleted',
							text: 'Service record has been deleted.',
							timer: 1500,
							showConfirmButton: false
						}).then(() => {
							reloadData();
						});
					},
					error: function(xhr) {
						const errorMsg = xhr.responseJSON?.error || 'Failed to delete service record.';
						Swal.fire({
							icon: 'error',
							title: 'Error',
							text: errorMsg
						});
					}
				});
			}
		});
	});

	// Gamebook notice button handler
	$(document).on('click', '.gamebook-notice-btn', function() {
		const $row = $(this).closest('tr');
		const agentName = $row.find('td').eq(1).text().trim() || '-';
		const gameId = $row.find('td').eq(2).text().trim() || '-';

		const detailsHtml = `
			<p>This service is linked to a game. Please proceed to <strong>Gamebook</strong> to edit this record.</p>
			<hr>
			<p class="mb-1"><strong>Agent:</strong> ${agentName}</p>
			<p class="mb-0"><strong>Game ID:</strong> ${gameId}</p>
		`;

		Swal.fire({
			icon: 'info',
			title: 'Edit from Gamebook',
			html: detailsHtml,
			confirmButtonText: 'OK'
		});
	});
});
