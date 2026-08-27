$(document).ready(function () {
	const t = window.agentWinlossReportTranslations || {};
	let agentWinlossTable = null;
	let currentGroupBy = 'game';
	let agentWinlossSplitOverrideRange = null;
	let agentWinlossSplitDateRange = null;

	function formatAmount(value) {
		return (Number(value) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
	}

	function formatCashOut(value) {
		const n = Number(value) || 0;
		if (n === 0) return '0';
		if (window.fmtOut) return window.fmtOut(n);
		return '<span class="text-dash-neg">(' + formatAmount(Math.abs(n)) + ')</span>';
	}

	function formatWinLoss(value) {
		const n = Number(value) || 0;
		if (n === 0) return '0';
		if (window.fmtSigned) return window.fmtSigned(n);
		if (n > 0) return '<span style="color:#16a34a;font-weight:600;">' + formatAmount(n) + '</span>';
		return '<span class="text-dash-neg">(' + formatAmount(Math.abs(n)) + ')</span>';
	}

	function formatRolling(value) {
		const n = Number(value) || 0;
		if (n === 0) return '0';
		if (n < 0) {
			if (window.fmtOut) return window.fmtOut(n);
			return '<span class="text-dash-neg">(' + formatAmount(Math.abs(n)) + ')</span>';
		}
		return formatAmount(n);
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function formatAgentDisplay(code, name, forSort) {
		const agentCode = String(code || '').trim();
		const agentName = String(name || '').trim();
		if (forSort) return [agentCode, agentName].filter(Boolean).join(' ').toLowerCase();
		if (agentCode && agentName) return escapeHtml(agentCode + ' (' + agentName + ')');
		return escapeHtml(agentCode || agentName || '-');
	}

	function agentColumn() {
		return {
			data: null,
			defaultContent: '-',
			render: function (data, type, row) {
				return formatAgentDisplay(row.agent_code, row.agent_name, type === 'sort' || type === 'type');
			}
		};
	}

	function toIsoDate(date) {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	function getDefaultRange() {
		if (window.MonthEndCutoffRange) {
			const r = window.MonthEndCutoffRange.getMonthEndCutoffRange();
			return { from: r.startDate, to: r.endDateApi || r.endDate };
		}
		const now = new Date();
		const prevLast = new Date(now.getFullYear(), now.getMonth(), 0);
		const endAt = new Date(now.getFullYear(), now.getMonth() + 1, 0);
		endAt.setDate(endAt.getDate() - 1);
		return { from: toIsoDate(prevLast), to: toIsoDate(endAt) };
	}

	function resolveDateRange() {
		if (agentWinlossSplitOverrideRange && agentWinlossSplitOverrideRange.fromDate && agentWinlossSplitOverrideRange.toDate) {
			return {
				from: agentWinlossSplitOverrideRange.fromDate,
				to: agentWinlossSplitOverrideRange.toDate
			};
		}

		const el = document.getElementById('agent-winloss-daterange');
		if (el && el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates.length >= 2) {
			const dates = el._flatpickr.selectedDates;
			return { from: toIsoDate(dates[0]), to: toIsoDate(dates[1]) };
		}

		const label = $('#agent-winloss-daterange').val();
		if (label && window.MonthEndCutoffRange) {
			const parsed = window.MonthEndCutoffRange.parseRangeToApiDates(label);
			if (parsed.start && parsed.end) return { from: parsed.start, to: parsed.end };
		}

		return getDefaultRange();
	}

	function updateTableHead(groupBy) {
		const $thead = $('#agent-winloss-report-tbl thead tr');
		const $tfoot = $('#agent-winloss-report-tbl tfoot tr');

		if (groupBy === 'day') {
			$thead.html(
				'<th>' + escapeHtml(t.program_date) + '</th>' +
				'<th>' + escapeHtml(t.agent_code_name) + '</th>' +
				'<th>' + escapeHtml(t.line) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.games) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.buy_in) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.cash_out) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.win_loss) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.rolling) + '</th>'
			);
			$tfoot.html(
				'<th colspan="3" class="text-end">' + escapeHtml(t.grand_total) + '</th>' +
				'<th id="agent-winloss-total-games" class="text-end">0</th>' +
				'<th id="agent-winloss-total-buyin" class="text-end">0</th>' +
				'<th id="agent-winloss-total-cashout" class="text-end">0</th>' +
				'<th id="agent-winloss-total-winloss" class="text-end">0</th>' +
				'<th id="agent-winloss-total-rolling" class="text-end">0</th>'
			);
			return;
		}

		if (groupBy === 'month') {
			$thead.html(
				'<th>' + escapeHtml(t.month) + '</th>' +
				'<th>' + escapeHtml(t.agent_code_name) + '</th>' +
				'<th>' + escapeHtml(t.line) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.games) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.buy_in) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.cash_out) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.win_loss) + '</th>' +
				'<th class="text-end">' + escapeHtml(t.rolling) + '</th>'
			);
			$tfoot.html(
				'<th colspan="3" class="text-end">' + escapeHtml(t.grand_total) + '</th>' +
				'<th id="agent-winloss-total-games" class="text-end">0</th>' +
				'<th id="agent-winloss-total-buyin" class="text-end">0</th>' +
				'<th id="agent-winloss-total-cashout" class="text-end">0</th>' +
				'<th id="agent-winloss-total-winloss" class="text-end">0</th>' +
				'<th id="agent-winloss-total-rolling" class="text-end">0</th>'
			);
			return;
		}

		$thead.html(
			'<th>' + escapeHtml(t.program_date) + '</th>' +
			'<th>' + escapeHtml(t.game_no) + '</th>' +
			'<th>' + escapeHtml(t.agent_code_name) + '</th>' +
			'<th>' + escapeHtml(t.line) + '</th>' +
			'<th>' + escapeHtml(t.guest) + '</th>' +
			'<th>' + escapeHtml(t.game_type) + '</th>' +
			'<th class="text-end">' + escapeHtml(t.buy_in) + '</th>' +
			'<th class="text-end">' + escapeHtml(t.cash_out) + '</th>' +
			'<th class="text-end">' + escapeHtml(t.win_loss) + '</th>' +
			'<th class="text-end">' + escapeHtml(t.rolling) + '</th>'
		);
		$tfoot.html(
			'<th colspan="6" class="text-end">' + escapeHtml(t.grand_total) + '</th>' +
			'<th id="agent-winloss-total-buyin" class="text-end">0</th>' +
			'<th id="agent-winloss-total-cashout" class="text-end">0</th>' +
			'<th id="agent-winloss-total-winloss" class="text-end">0</th>' +
			'<th id="agent-winloss-total-rolling" class="text-end">0</th>'
		);
	}

	function updateFooter(totals) {
		const total = totals || {};
		if (currentGroupBy === 'day' || currentGroupBy === 'month') {
			$('#agent-winloss-total-games').html(formatAmount(total.game_count));
		}
		$('#agent-winloss-total-buyin').html(formatAmount(total.buy_in));
		$('#agent-winloss-total-cashout').html(formatCashOut(total.cash_out));
		$('#agent-winloss-total-winloss').html(formatWinLoss(total.win_loss));
		$('#agent-winloss-total-rolling').html(formatRolling(total.rolling));
	}

	function getColumns(groupBy) {
		const amountCol = {
			data: 'buy_in',
			className: 'text-end',
			render: function (data, type) {
				if (type === 'sort' || type === 'type') return Number(data) || 0;
				return formatAmount(data);
			}
		};
		const cashOutCol = {
			data: 'cash_out',
			className: 'text-end',
			render: function (data, type) {
				if (type === 'sort' || type === 'type') return Number(data) || 0;
				return formatCashOut(data);
			}
		};
		const winLossCol = {
			data: 'win_loss',
			className: 'text-end',
			render: function (data, type) {
				if (type === 'sort' || type === 'type') return Number(data) || 0;
				return formatWinLoss(data);
			}
		};
		const rollingCol = {
			data: 'rolling',
			className: 'text-end',
			render: function (data, type) {
				if (type === 'sort' || type === 'type') return Number(data) || 0;
				return formatRolling(data);
			}
		};

		if (groupBy === 'day') {
			return [
				{ data: 'program_date', defaultContent: '' },
				agentColumn(),
				{ data: 'agency_name', defaultContent: '-', render: function (data) { return escapeHtml(data || '-'); } },
				{
					data: 'game_count',
					className: 'text-end',
					render: function (data, type) {
						if (type === 'sort' || type === 'type') return Number(data) || 0;
						return formatAmount(data);
					}
				},
				amountCol,
				cashOutCol,
				winLossCol,
				rollingCol
			];
		}

		if (groupBy === 'month') {
			return [
				{ data: 'program_month', defaultContent: '' },
				agentColumn(),
				{ data: 'agency_name', defaultContent: '-', render: function (data) { return escapeHtml(data || '-'); } },
				{
					data: 'game_count',
					className: 'text-end',
					render: function (data, type) {
						if (type === 'sort' || type === 'type') return Number(data) || 0;
						return formatAmount(data);
					}
				},
				amountCol,
				cashOutCol,
				winLossCol,
				rollingCol
			];
		}

		return [
			{ data: 'program_date', defaultContent: '' },
			{
				data: 'game_id',
				render: function (data) {
					if (!data) return '-';
					return '<a href="/game_list?game_id=' + encodeURIComponent(data) + '" target="_blank" rel="noopener">' + escapeHtml(data) + '</a>';
				}
			},
			agentColumn(),
			{ data: 'agency_name', defaultContent: '-', render: function (data) { return escapeHtml(data || '-'); } },
			{ data: 'guest_name', defaultContent: '-', render: function (data) { return escapeHtml(data || '-'); } },
			{ data: 'game_type', defaultContent: '-', render: function (data) { return escapeHtml(data || '-'); } },
			amountCol,
			cashOutCol,
			winLossCol,
			rollingCol
		];
	}

	function buildAjaxUrl() {
		const range = resolveDateRange();
		const params = new URLSearchParams({
			date_from: range.from,
			date_to: range.to,
			group_by: currentGroupBy
		});
		const agentId = $('#agent-winloss-agent-filter').val();
		if (agentId) params.set('agent_id', agentId);
		return '/agent_winloss_report/data?' + params.toString();
	}

	function layoutAgentWinlossControls() {
		const wrapper = document.getElementById('agent-winloss-report-tbl_wrapper');
		const lengthWrap = document.getElementById('agent-winloss-report-tbl_length');
		const filterWrap = document.getElementById('agent-winloss-report-tbl_filter');
		const searchLabel = filterWrap ? filterWrap.querySelector('label') : null;
		const dateRangeMount = document.getElementById('agent-winloss-daterange-mount');
		if (!wrapper || !lengthWrap || !filterWrap || !searchLabel) return;

		let controlsHighlight = wrapper.querySelector('.agent-winloss-controls-highlight');
		if (!controlsHighlight) {
			controlsHighlight = document.createElement('div');
			controlsHighlight.className = 'agent-winloss-controls-highlight';
			wrapper.insertBefore(controlsHighlight, wrapper.firstChild);
		}
		if (lengthWrap.parentElement !== controlsHighlight || controlsHighlight.firstElementChild !== lengthWrap) {
			controlsHighlight.insertBefore(lengthWrap, controlsHighlight.firstChild);
		}

		if (dateRangeMount) {
			if (dateRangeMount.parentElement !== controlsHighlight || lengthWrap.nextElementSibling !== dateRangeMount) {
				if (lengthWrap.nextSibling) {
					controlsHighlight.insertBefore(dateRangeMount, lengthWrap.nextSibling);
				} else {
					controlsHighlight.appendChild(dateRangeMount);
				}
			}
			dateRangeMount.classList.add('is-placed');
		}

		if (filterWrap.parentElement !== controlsHighlight) {
			controlsHighlight.appendChild(filterWrap);
		}

		let highlightBox = filterWrap.querySelector('.agent-winloss-filter-highlight');
		if (!highlightBox) {
			highlightBox = document.createElement('div');
			highlightBox.className = 'agent-winloss-filter-highlight';
			filterWrap.appendChild(highlightBox);
		}
		if (searchLabel.parentElement !== highlightBox) {
			highlightBox.appendChild(searchLabel);
		}

		Array.prototype.forEach.call(wrapper.children, function (row) {
			if (!row.classList || !row.classList.contains('row')) return;
			if (row.classList.contains('dt-row') || row.querySelector('table')) return;
			if (!row.querySelector('.dataTables_length, .dataTables_filter, .dataTables_info, .dataTables_paginate')) {
				row.classList.add('agent-winloss-dt-top-row-empty');
			}
		});
	}

	function getDateRangeLabel() {
		const el = document.getElementById('agent-winloss-daterange');
		if (el && el.value) return el.value;
		const range = resolveDateRange();
		return (range.from || '') + ' to ' + (range.to || '');
	}

	function getPrintPayload() {
		if (!agentWinlossTable) return { headers: [], rows: [] };
		const headers = [];
		$('#agent-winloss-report-tbl thead tr:first th').each(function () {
			headers.push($(this).text().trim());
		});
		const rows = [];
		agentWinlossTable.rows({ search: 'applied' }).every(function () {
			const cells = [];
			$(this.node()).find('td').each(function () {
				cells.push($(this).text().trim());
			});
			if (cells.length) rows.push(cells);
		});
		return { headers: headers, rows: rows };
	}

	function printReport() {
		if (!$.fn.DataTable.isDataTable('#agent-winloss-report-tbl')) return;
		const payload = getPrintPayload();
		if (!payload.rows.length) {
			if (window.Swal) {
				window.Swal.fire({
					icon: 'info',
					title: 'Print',
					text: t.no_data || 'No data found for the selected range.',
					confirmButtonColor: '#0d6efd'
				});
			}
			return;
		}

		const headerHtml = payload.headers.map(function (h) {
			return '<th>' + escapeHtml(h) + '</th>';
		}).join('');
		const rowsHtml = payload.rows.map(function (row) {
			return '<tr>' + row.map(function (cell) {
				return '<td>' + escapeHtml(cell) + '</td>';
			}).join('') + '</tr>';
		}).join('');
		const totals = {
			buy_in: $('#agent-winloss-total-buyin').text().trim(),
			cash_out: $('#agent-winloss-total-cashout').text().trim(),
			win_loss: $('#agent-winloss-total-winloss').text().trim(),
			rolling: $('#agent-winloss-total-rolling').text().trim()
		};
		const colCount = payload.headers.length;
		const totalColspan = Math.max(1, colCount - 4);
		const footerHtml = '<tr><th colspan="' + totalColspan + '" style="text-align:right;">' +
			escapeHtml(t.grand_total || 'Grand Total') + '</th>' +
			'<th style="text-align:right;">' + escapeHtml(totals.buy_in) + '</th>' +
			'<th style="text-align:right;">' + escapeHtml(totals.cash_out) + '</th>' +
			'<th style="text-align:right;">' + escapeHtml(totals.win_loss) + '</th>' +
			'<th style="text-align:right;">' + escapeHtml(totals.rolling) + '</th></tr>';

		const iframe = document.createElement('iframe');
		iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
		document.body.appendChild(iframe);
		const frameWindow = iframe.contentWindow;
		const frameDoc = frameWindow.document;
		frameDoc.open();
		frameDoc.write([
			'<!doctype html><html><head><title>', escapeHtml(t.title || 'Agent Win/Loss'), '</title>',
			'<style>',
			'@page{size:landscape;margin:8mm;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
			'table{width:100%;border-collapse:collapse;font-size:10px;}',
			'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;text-align:left;}',
			'th{background:#d9e1f2;font-weight:700;}',
			'tfoot th{background:#e8e8e8;}',
			'</style></head><body>',
			'<h2>', escapeHtml(t.title || 'Agent Win/Loss'), '</h2>',
			'<div class="subtitle">', escapeHtml(getDateRangeLabel()), '</div>',
			'<table><thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody>',
			'<tfoot>', footerHtml, '</tfoot></table>',
			'</body></html>'
		].join(''));
		frameDoc.close();

		const cleanup = function () {
			setTimeout(function () {
				if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
			}, 300);
		};
		frameWindow.onafterprint = cleanup;
		setTimeout(function () {
			frameWindow.focus();
			frameWindow.print();
			cleanup();
		}, 250);
	}

	function initTable() {
		if ($.fn.DataTable.isDataTable('#agent-winloss-report-tbl')) {
			$('#agent-winloss-report-tbl').DataTable().clear().destroy();
		}

		updateTableHead(currentGroupBy);

		agentWinlossTable = $('#agent-winloss-report-tbl').DataTable({
			processing: true,
			serverSide: false,
			pageLength: 25,
			lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
			order: currentGroupBy === 'month'
				? [[0, 'desc'], [1, 'asc']]
				: [[0, 'desc']],
			ajax: {
				url: buildAjaxUrl(),
				dataSrc: function (json) {
					updateFooter(json && json.totals ? json.totals : {});
					return (json && json.rows) ? json.rows : [];
				}
			},
			columns: getColumns(currentGroupBy),
			language: {
				search: '',
				searchPlaceholder: 'Search...',
				lengthMenu: 'Show _MENU_ entries',
				processing: t.loading || 'Loading report...',
				emptyTable: t.no_data || 'No data found for the selected range.',
				info: 'Showing _START_ to _END_ of _TOTAL_ entries',
				paginate: { previous: 'Previous', next: 'Next' }
			},
			initComplete: function () {
				layoutAgentWinlossControls();
			}
		});
	}

	function reloadTable() {
		if (!agentWinlossTable) {
			initTable();
			return;
		}
		agentWinlossTable.ajax.url(buildAjaxUrl()).load();
	}

	function rebuildTable(groupBy) {
		currentGroupBy = groupBy || 'game';
		initTable();
	}

	async function loadAgents() {
		try {
			const res = await fetch('/agent_winloss_report/agents');
			if (!res.ok) return;
			const agents = await res.json();
			const $select = $('#agent-winloss-agent-filter');
			if ($select.data('select2')) {
				try { $select.select2('destroy'); } catch (e) {}
			}
			$select.empty().append($('<option>', { value: '', text: '' }));
			agents.forEach(function (agent) {
				const label = [agent.agent_code, agent.agent_name].filter(Boolean).join(' - ');
				$select.append(
					$('<option>', {
						value: String(agent.agent_id),
						text: label || ('Agent #' + agent.agent_id)
					})
				);
			});
			initAgentFilterSelect2();
		} catch (err) {
			console.error('loadAgents:', err);
		}
	}

	function initAgentFilterSelect2() {
		const $sel = $('#agent-winloss-agent-filter');
		if (!$sel.length || typeof $sel.select2 !== 'function') return;
		if ($sel.data('select2')) {
			try { $sel.select2('destroy'); } catch (e) {}
		}
		$sel.select2({
			placeholder: $sel.data('placeholder') || t.all_agents || 'All Agents',
			allowClear: true,
			width: '300px'
		});
	}

	function initDateRangePicker() {
		if (typeof flatpickr === 'undefined') return;
		const defaults = getDefaultRange();
		flatpickr('#agent-winloss-daterange', {
			mode: 'range',
			dateFormat: 'Y-m-d',
			defaultDate: [defaults.from, defaults.to],
			onChange: function () {
				reloadTable();
			}
		});
	}

	function applyAgentWinlossSplitDateRange(range) {
		if (!range || !range.start || !range.end) return;
		let fromDate = range.start;
		let toDate = range.end;
		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.expandApiEndDateToMonthEnd === 'function') {
			toDate = window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(toDate);
		}
		if (fromDate > toDate) {
			const swap = fromDate;
			fromDate = toDate;
			toDate = swap;
		}
		agentWinlossSplitOverrideRange = { fromDate: fromDate, toDate: toDate };
		reloadTable();
	}

	function initSplitDateRange() {
		if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') return;
		agentWinlossSplitDateRange = window.SplitDateRange.attach({
			rangePickerId: 'agent-winloss-daterange',
			startId: 'agent-winloss-start-date',
			endId: 'agent-winloss-end-date',
			splitWrapperId: 'agent-winloss-split-daterange-wrapper',
			independent: true,
			invalidDateMessage: 'Invalid date range.',
			onRangeApplied: function (range) {
				applyAgentWinlossSplitDateRange(range);
			}
		});
	}

	async function exportReport() {
		const range = resolveDateRange();
		const body = {
			group_by: currentGroupBy,
			date_from: range.from,
			date_to: range.to,
			agent_id: $('#agent-winloss-agent-filter').val() || ''
		};

		try {
			const res = await fetch('/agent_winloss_report/export_xlsx', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error('Export failed');
			const blob = await res.blob();
			const disposition = res.headers.get('Content-Disposition') || '';
			const match = disposition.match(/filename="?([^"]+)"?/i);
			const filename = match ? match[1] : ('Agent-WinLoss-' + currentGroupBy + '.xlsx');
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		} catch (err) {
			console.error('exportReport:', err);
			if (window.Swal) {
				window.Swal.fire({ icon: 'error', title: t.export_error || 'Export failed' });
			}
		}
	}

	$('#agent-winloss-filter').on('click', '.filter-link', function (event) {
		event.preventDefault();
		const groupBy = $(this).data('group-by');
		if (!groupBy) return;
		$('#agent-winloss-filter .filter-link').removeClass('active');
		$(this).addClass('active');
		rebuildTable(groupBy);
	});

	$('#agent-winloss-agent-filter').on('change', reloadTable);
	$('#btn-agent-winloss-export').on('click', exportReport);
	$('#btn-agent-winloss-print').on('click', printReport);

	$(document).on('init.dt draw.dt', '#agent-winloss-report-tbl', layoutAgentWinlossControls);

	loadAgents().then(function () {
		initDateRangePicker();
		initSplitDateRange();
		initTable();
	});
});
