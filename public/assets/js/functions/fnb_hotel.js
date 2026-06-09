$(document).ready(function() {
	let dataTable;
	let currentFilter = 'all';
	const defaultDateRange = getCurrentMonthRange();
	let fnbHotelDateStart = defaultDateRange.start;
	let fnbHotelDateEnd = defaultDateRange.end;

	// Helpers (mirror the EJS helpers)
	function formatDateForDisplay(value) {
		if (!value) return '-';
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		const pad = (n) => String(n).padStart(2, '0');
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

	function parseFnbHotelDate(value) {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}

	function getCurrentMonthRange() {
		const now = new Date();
		return {
			start: new Date(now.getFullYear(), now.getMonth(), 1),
			end: new Date(now.getFullYear(), now.getMonth() + 1, 0)
		};
	}

	$.fn.dataTable.ext.search.push(function (settings, data) {
		if (!settings || !settings.nTable || settings.nTable.id !== 'fnb-hotel-table') return true;
		if (!fnbHotelDateStart || !fnbHotelDateEnd) return true;
		const rawDate = data && data[8] && data[8].display !== undefined ? data[8].display : data[8];
		const rowDate = parseFnbHotelDate(cellText(rawDate));
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
			order: [[8, 'desc']], // Sort by Date column (descending)
			columnDefs: [
				{
					createdCell: function (cell) {
						$(cell).addClass('text-center');
					}
				},
				{
					targets: [8], // Date column: sort by data-order / @data-order (timestamp)
					render: function (data) {
						if (typeof data === 'object' && data && data.display !== undefined) return data.display;
						return data;
					}
				},
				{
					targets: [9], // Action column
					orderable: false,
					searchable: false
				}
			],
			language: {
				search: translations.search || "Search:",
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

	// Filter functionality (use DataTables column search on Service Type column)
	const filterLinks = document.querySelectorAll('#fnb-hotel-filter .filter-link');

	function updateFilter(filter) {
		if (!dataTable) return;

		currentFilter = filter;

		const serviceTypeColumnIndex = 3; // 0-based index for \"Service Type\"

		if (filter === 'all') {
			// Clear column filter
			dataTable.column(serviceTypeColumnIndex).search('').draw();
		} else {
			// Exact match on service type text (fnb, hotel, delivery)
			const regex = '^' + filter + '$';
			dataTable
				.column(serviceTypeColumnIndex)
				.search(regex, true, false) // regex = true, smart = false
				.draw();
		}
	}

	// Filter link click handlers
	filterLinks.forEach((link) => {
		link.addEventListener('click', (event) => {
			event.preventDefault();
			const selectedFilter = link.dataset.filter;
			if (!selectedFilter) return;

			filterLinks.forEach((otherLink) => otherLink.classList.remove('active'));
			link.classList.add('active');
			updateFilter(selectedFilter);
		});
	});

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

					const sourceClass = isSettle ? 'text-primary' : '';
					const amountClass = isJunketSource ? 'text-danger' : (isSettle ? 'text-primary' : '');

					const sourceHtml = `<span class="${sourceClass}">${service.SOURCE_TYPE || '-'}</span>`;
					const agentHtml = service.SOURCE_TYPE === 'JUNKET'
						? '-'
						: (service.agent_name || 'Unknown');
					const gameIdHtml = service.GAME_ID ? service.GAME_ID : '-';
					const serviceTypeHtml = service.SERVICE_TYPE || '';
					const amountHtml = `<span class="${amountClass}">${displayAmt}</span>`;
					const paymentHtml = paymentLabel(service.TRANSACTION_ID);
					const remarksHtml = window.RemarksEditor
						? window.RemarksEditor.renderCell(service.REMARKS || '', {
							source: 'game_services',
							recordId: service.IDNo
						})
						: (service.REMARKS || '-');
					const encodedByHtml = service.encoded_by_name || '-';
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
									data-source="${service.SOURCE_TYPE}"
									data-agent="${service.AGENT_ID || ''}"
									data-service="${service.SERVICE_TYPE}"
									data-amount="${service.AMOUNT}"
									data-remarks="${safeRemarks}"
									data-transaction="${service.TRANSACTION_ID}"
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
							<button type="button"
								class="btn btn-sm bg-warning-subtle text-warning gamebook-notice-btn"
								title="Edit in Gamebook">
								<i class="fa fa-info-circle"></i>
							</button>`;
					}

					dataTable.row.add([
						sourceHtml,
						agentHtml,
						gameIdHtml,
						serviceTypeHtml,
						amountHtml,
						paymentHtml,
						remarksHtml,
						encodedByHtml,
						dateCellData,
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

	function getFnbHotelTablePayload(includeEncodedBy) {
		const dt = $('#fnb-hotel-table').DataTable();
		const actionColIndex = 9;
		const encodedByColIndex = 7;
		const headers = [];
		$('#fnb-hotel-table thead tr:first th').each(function (i) {
			if (i === actionColIndex) return;
			if (!includeEncodedBy && i === encodedByColIndex) return;
			headers.push($(this).text().trim());
		});
		const rows = [];
		dt.rows({ search: 'applied' }).every(function () {
			const cells = [];
			$(this.node())
				.find('td')
				.each(function (i) {
					if (i === actionColIndex) return;
					if (!includeEncodedBy && i === encodedByColIndex) return;
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
			'th:nth-child(5),td:nth-child(5){text-align:right;padding-right:14px;}'
		].join('');
	}

	function printFnbHotelTable() {
		if (!$.fn.DataTable.isDataTable('#fnb-hotel-table')) return;
		const payload = getFnbHotelTablePayload(true);
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
		const dateRange = $('#fnb-hotel-daterange').val() || 'All dates';
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
		const payload = getFnbHotelTablePayload(false);
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

	if (typeof flatpickr === 'function') {
		flatpickr('#fnb-hotel-daterange', {
			mode: 'range',
			dateFormat: 'Y-m-d',
			altInput: true,
			altFormat: 'M d, Y',
			defaultDate: [fnbHotelDateStart, fnbHotelDateEnd],
			showMonths: 3,
			onReady: function (_selectedDates, _dateStr, instance) {
				instance.changeMonth(-2, true);
			},
			onClose: function (selectedDates) {
				if (!selectedDates || selectedDates.length === 0) {
					fnbHotelDateStart = null;
					fnbHotelDateEnd = null;
				} else if (selectedDates.length === 2) {
					fnbHotelDateStart = selectedDates[0];
					fnbHotelDateEnd = selectedDates[1];
				}
				if (dataTable) dataTable.draw();
			}
		});
	}

	// Initialize DataTable (this will also call reloadData)
	initializeDataTable();

	// Edit service button handlers
	$(document).on('click', '.edit-service-btn', function() {
		const $btn = $(this);
		const id = $btn.data('id');
		const sourceType = $btn.data('source');
		const agentId = $btn.data('agent');
		const serviceType = $btn.data('service');
		const amount = parseFloat($btn.data('amount')) || 0;
		const remarks = $btn.data('remarks') || '';
		const transactionId = $btn.data('transaction');

		$('#edit-services-id').val(id);
		$('#edit-transaction-type').val(sourceType).trigger('change');
		$('#edit-services-type').val(serviceType);
		$('#edit-services-amount').val(amount.toLocaleString('en-US'));
		$('#edit-services-remarks').val(remarks);
		if (transactionId) {
			$(`input[name="edit-services-transaction"][value="${transactionId}"]`).prop('checked', true);
		}
		
		// Store agentId for later use after accounts are loaded
		if (sourceType === 'GUEST' && agentId) {
			$('#modal-services-edit-record').data('pendingAgentId', agentId);
		}
		
		$('#modal-services-edit-record').modal('show');
	});

	// Delete service button handlers
	$(document).on('click', '.delete-service-btn', function() {
		const id = $(this).data('id');
		Swal.fire({
			title: 'Delete Service Record?',
			text: 'This action cannot be undone.',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Yes, delete',
			cancelButtonText: 'Cancel',
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
