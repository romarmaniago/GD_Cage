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
		if (typeof window.fmtDtUtc8 === 'function') {
			return window.fmtDtUtc8(value, '-') || '-';
		}
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		const pad = (n) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
		if (typeof window.fmtDate === 'function') {
			return window.fmtDate(value, '-') || '-';
		}
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return '-';
		const pad = (n) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	function formatYmdLocal(d) {
		const pad = (n) => String(n).padStart(2, '0');
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	}

	function parseFnbHotelDate(value) {
		const text = String(value || '').trim();
		const ymd = text.slice(0, 10);
		if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
			const parts = ymd.split('-').map(Number);
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
	function isFnbHotelDefaultDateSortDesc(api) {
		const order = api.order();
		return !!(order.length && order[0][0] === 0 && order[0][1] === 'desc');
	}

	function initializeDataTable() {
		if ($.fn.DataTable.isDataTable('#fnb-hotel-table')) {
			$('#fnb-hotel-table').DataTable().destroy();
		}

		const translations = window.fnbHotelTranslations || {};

		dataTable = $('#fnb-hotel-table').DataTable({
			pageLength: 25,
			lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
			searching: true,
			ordering: true,
			info: true,
			paging: true,
			autoWidth: false,
			order: [[0, 'desc']], // Sort by Program Date (descending), then Date
			columnDefs: [
				{ targets: 0, orderData: [0, 1] },
				{
					targets: [0, 1], // Program Date + Date: sort by data-order / @data-order
					render: function (data) {
						if (typeof data === 'object' && data && data.display !== undefined) return data.display;
						return data;
					}
				},
				{ targets: 0, width: '8%' },
				{ targets: 1, width: '11%' },
				{ targets: 2, width: '18%' },
				{ targets: 3, width: '14%' },
				{ targets: 4, width: '9%' },
				{ targets: 5, width: '8%' },
				{ targets: 6, width: '7%', className: 'text-center' },
				{ targets: 7, width: '17%' },
				{
					targets: [8], // Action column
					width: '8%',
					orderable: false,
					searchable: false,
					className: 'text-center'
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
			},
			footerCallback: function () {
				updateFnbHotelTotal(this.api());
			},
			drawCallback: function () {
				// Paging stays newest-first (page 1 = latest entries), but within the page
				// the rows are shown oldest-to-newest so the latest entry sits at the bottom.
				if (isFnbHotelDefaultDateSortDesc(this.api())) {
					const $tbody = $(this).children('tbody');
					$tbody.append($tbody.children('tr').get().reverse());
				}
				if (window.RemarksEditor && typeof window.RemarksEditor.initCellTooltips === 'function') {
					window.RemarksEditor.initCellTooltips('#fnb-hotel-table');
				}
			}
		});

		// Apply initial filter to already-rendered rows
		updateFilter(currentFilter);
	}

	/**
	 * Footer Total: signed like the Amount column / dashboard Add Charge (JUNKET = outflow), over the
	 * filtered rows (date range, category tab, search). Settled rows are already in company capital.
	 */
	function updateFnbHotelTotal(api) {
		const $total = $('#fnb-hotel-total-amount');
		if (!$total.length || !api) return;
		let total = 0;
		api.rows({ search: 'applied' }).nodes().each(function (node) {
			if (!node || node.dataset.settled === '1') return;
			total += Number(node.dataset.signedAmount) || 0;
		});
		$total.html(typeof window.formatServiceChargeAmount === 'function'
			? window.formatServiceChargeAmount(total, 'GUEST')
			: total.toLocaleString('en-US'));
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
					const hasGameId = !!service.GAME_ID;
					const isGameSettled = hasGameId && service.game_settled === 1;
					const canEdit = !hasGameId;
					const canDelete = !hasGameId;

					const agentCode = String(service.agent_code || '').trim();
					const agentName = String(service.agent_name || '').trim();
					const agentHtml = agentCode && agentName
						? escapeHtml(agentCode + ' (' + agentName + ')')
						: escapeHtml(agentCode || agentName || '-');
					const guestHtml = escapeHtml(String(service.guest_name || '').trim() || '-');
					const serviceTypeHtml = service.SERVICE_TYPE || '';
					const amountHtml = typeof window.formatServiceChargeAmount === 'function'
						? window.formatServiceChargeAmount(amt, service.SOURCE_TYPE)
						: String(amt);
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

					const receiptBtn = (window.fnbHotelReceipt && window.fnbHotelReceipt.buttonHtml)
						? window.fnbHotelReceipt.buttonHtml(service)
						: '';

					// Add Charge → Settle: tinted, locked row (differs from the game "Settled" badge below).
					const isServiceSettled = (service.SERVICE_SETTLEMENT_ID != null && service.SERVICE_SETTLEMENT_ID !== '') ||
						(service.COMMISSION_SETTLEMENT_ID != null && service.COMMISSION_SETTLEMENT_ID !== '');

					let actionHtml = '';
					if (isServiceSettled) {
						actionHtml = `
							<div class="btn-group">
								${receiptBtn}
								<span class="junket-loss-settled-pill" title="Add Charge settled — locked"><i class="fa fa-lock" aria-hidden="true"></i>Settled</span>
							</div>`;
					} else if (canEdit && canDelete) {
						actionHtml = `
							<div class="btn-group">
								${receiptBtn}
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
									<i class="fa fa-trash-alt"></i>
								</button>
							</div>`;
					} else if (hasGameId && isGameSettled) {
						actionHtml = `
							<div class="btn-group">
								${receiptBtn}
								<span class="badge bg-success-subtle text-success fw-semibold px-3 py-2">
									Settled
								</span>
							</div>`;
					} else if (hasGameId && !isGameSettled) {
						actionHtml = `
							<div class="btn-group">
								${receiptBtn}
								<button type="button"
									class="btn btn-sm bg-warning-subtle text-warning gamebook-notice-btn"
									title="Edit in Gamebook">
									<i class="fa fa-info-circle"></i>
								</button>
							</div>`;
					} else {
						actionHtml = receiptBtn ? `<div class="btn-group">${receiptBtn}</div>` : '';
					}

					const addedRow = dataTable.row.add([
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
					const node = addedRow.node();
					if (node) {
						const isJunket = String(service.SOURCE_TYPE || '').toUpperCase() === 'JUNKET';
						node.dataset.signedAmount = String(isJunket ? -Math.abs(amt) : amt);
						node.dataset.settled = isServiceSettled ? '1' : '0';
						if (isServiceSettled) node.classList.add('is-settled');
					}
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

	/** The range exactly as the user picked it (YYYY-MM-DD), without the month-end expansion — for Settle. */
	window.fnbHotelGetDisplayRange = function () {
		let a = null;
		let b = null;
		if (fnbHotelSplitOverrideRange && fnbHotelSplitOverrideRange.displayStart) {
			a = fnbHotelSplitOverrideRange.displayStart;
			b = fnbHotelSplitOverrideRange.displayEnd;
		} else if (fnbHotelDatePicker && fnbHotelDatePicker.selectedDates && fnbHotelDatePicker.selectedDates.length) {
			a = fnbHotelDatePicker.selectedDates[0];
			b = fnbHotelDatePicker.selectedDates[fnbHotelDatePicker.selectedDates.length - 1];
		} else if (window.MonthEndCutoffRange) {
			const r = window.MonthEndCutoffRange.getMonthEndCutoffRange();
			return { fromDate: r.startDate, toDate: r.endDate };
		}
		if (!a || !b) return { fromDate: null, toDate: null };
		const from = formatYmdLocal(a);
		const to = formatYmdLocal(b);
		return from <= to ? { fromDate: from, toDate: to } : { fromDate: to, toDate: from };
	};

	function getFnbHotelExportFilename() {
		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		const d = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
		return 'FnbHotel_' + d + '.xlsx';
	}

	// Rows as shown on screen (filter + sort applied; the default date sort lists oldest-to-newest).
	// The table holds rendered cells, so text comes from each row's cells and the signed amount /
	// settled flag from the row's data attributes (set in reloadData).
	function getFnbHotelOutputRows() {
		const dt = $('#fnb-hotel-table').DataTable();
		const rows = [];
		dt.rows({ search: 'applied', order: 'applied' }).every(function () {
			const node = this.node();
			if (!node) return;
			const cells = $(node).find('td').map(function () { return $(this).text().trim(); }).get();
			if (!cells.length) return;
			rows.push({
				programDate: cells[0] || '',
				date: cells[1] || '',
				account: cells[2] || '',
				guest: cells[3] || '',
				type: cells[4] || '',
				payment: cells[6] || '',
				remarks: cells[7] === '—' ? '' : (cells[7] || ''),
				amount: Number(node.dataset.signedAmount) || 0,
				settled: node.dataset.settled === '1'
			});
		});
		if (isFnbHotelDefaultDateSortDesc(dt)) rows.reverse();
		return rows;
	}

	function getFnbHotelHeaders() {
		const headers = [];
		$('#fnb-hotel-table thead tr:first th').each(function (i) {
			if (i === 8) return; // Action
			headers.push($(this).text().trim());
		});
		return headers;
	}

	// Same rule as the table Total: settled rows are already in company capital, so they are left out.
	function getFnbHotelOutputTotal(rows) {
		return rows.reduce(function (sum, row) { return row.settled ? sum : sum + row.amount; }, 0);
	}

	// As shown on screen: negative "(x)", positive plain
	function fnbHotelAmountText(value) {
		const n = Number(value) || 0;
		const abs = Math.abs(n);
		const hasDecimals = abs % 1 !== 0;
		const formatted = abs.toLocaleString('en-US', {
			minimumFractionDigits: hasDecimals ? 2 : 0,
			maximumFractionDigits: hasDecimals ? 2 : 0
		});
		return n < 0 ? '(' + formatted + ')' : formatted;
	}

	function getFnbHotelPrintStyles() {
		return [
			'@page{size:landscape;margin:8mm;}',
			// print the header fill, settled tint and red amounts even with "Background graphics" off
			'*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'.print-wrap{width:100%;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
			// fixed, balanced column widths (see the <colgroup>); long text wraps inside its column
			'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11.5px;}',
			'th,td{border:1px solid #777;padding:4px 6px;vertical-align:middle;text-align:left;overflow-wrap:anywhere;}',
			'th{background:#d9e1f2;font-weight:700;}',
			'thead th{white-space:nowrap;font-size:10.5px;}',
			// dates, amount and payment stay on one line
			'td:nth-child(1),td:nth-child(2),td:nth-child(6),td:nth-child(7){white-space:nowrap;}',
			'td:nth-child(1),td:nth-child(2),td:nth-child(7){text-align:center;}',
			// Amount: digits line up — a "(x)" hangs its ")" past them, other values carry an invisible ")"
			'td:nth-child(6){text-align:right;font-variant-numeric:tabular-nums;}',
			'.neg{color:#dc3545;}',
			'.paren-pad{visibility:hidden;}',
			'tr.is-settled td{background:#e4f3e8;}',
			'tr.total-row td{font-weight:700;background:#f4f6fa;}',
			'thead th:nth-child(n){text-align:center;}'
		].join('');
	}

	function printFnbHotelTable() {
		if (!$.fn.DataTable.isDataTable('#fnb-hotel-table')) return;
		const rows = getFnbHotelOutputRows();
		const t = window.fnbHotelTranslations || {};
		if (rows.length === 0) {
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

		const amountHtml = function (value) {
			const text = fnbHotelAmountText(value);
			if (/^\(.*\)$/.test(text)) return '<span class="neg">' + escapeHtml(text) + '</span>';
			return escapeHtml(text) + '<span class="paren-pad">)</span>';
		};
		const headerHtml = getFnbHotelHeaders().map((h) => '<th>' + escapeHtml(h) + '</th>').join('');
		let rowsHtml = rows.map(function (row) {
			return '<tr' + (row.settled ? ' class="is-settled"' : '') + '>' +
				'<td>' + escapeHtml(row.programDate) + '</td>' +
				// the year is already in Program Date
				'<td>' + escapeHtml(row.date.replace(/^\d{4}-(\d{2}-\d{2}\s+\d{1,2}:\d{2}).*$/, '$1')) + '</td>' +
				'<td>' + escapeHtml(row.account) + '</td>' +
				'<td>' + escapeHtml(row.guest) + '</td>' +
				'<td>' + escapeHtml(row.type) + '</td>' +
				'<td>' + amountHtml(row.amount) + '</td>' +
				'<td>' + escapeHtml(row.payment) + '</td>' +
				'<td>' + escapeHtml(row.remarks) + '</td>' +
				'</tr>';
		}).join('');
		rowsHtml += '<tr class="total-row"><td colspan="5" style="text-align:center;">TOTAL</td>' +
			'<td>' + amountHtml(getFnbHotelOutputTotal(rows)) + '</td><td colspan="2"></td></tr>';

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
			'<!doctype html><html><head><title>Add Charge</title><style>',
			getFnbHotelPrintStyles(),
			'</style></head><body><div class="print-wrap">',
			'<h2>Add Charge</h2>',
			'<div class="subtitle">', escapeHtml(dateRange), '</div>',
			// Program Date | Date | Account # / Name | Guest | Type | Amount | Payment | Remarks
			'<table><colgroup><col style="width:9%"><col style="width:9%"><col style="width:20%"><col style="width:16%">',
			'<col style="width:9%"><col style="width:9%"><col style="width:7%"><col style="width:21%"></colgroup>',
			'<thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody></table>',
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
		const data = getFnbHotelOutputRows();
		const headers = getFnbHotelHeaders();
		const t = window.fnbHotelTranslations || {};
		if (data.length === 0) {
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
		// Real values for Excel: dates as dates, Amount as a signed number. The total is sent as-is
		// because it leaves settled rows out.
		const rows = data.map(function (row) {
			return [row.programDate, row.date, row.account, row.guest, row.type, row.amount, row.payment, row.remarks];
		});
		const totals = { 6: getFnbHotelOutputTotal(data) };
		const outName = getFnbHotelExportFilename();
		const $btn = $(this);
		$btn.prop('disabled', true);
		fetch('/fnb-hotel/export_xlsx', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ headers: headers, rows: rows, totals: totals, filename: outName })
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
			fnbHotelSplitOverrideRange = { start: startDate, end: endDate, displayStart: range.startDate, displayEnd: range.endDate };
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
		fnbHotelDatePicker = flatpickr('#fnb-hotel-daterange', {
			mode: 'range',
			showMonths: 3,
			onReady: function (_selectedDates, _dateStr, instance) {
				if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
					window.setupFlatpickrMonthNameRangeSelect(instance);
				}
				if (_selectedDates && _selectedDates.length === 2) {
					applyFnbHotelDateFilter(_selectedDates);
				}
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

// Amount digits line up right-to-left; the ")" of a negative hangs right (num_paren_align.js)
if (window.gdAlignParenNumbers) {
	window.gdAlignParenNumbers('.fnb-hotel-page', ['#fnb-hotel-table tbody td:nth-child(6)', '#fnb-hotel-total-amount']);
}
