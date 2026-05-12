(function () {
	function readNetProfitConfig() {
		const el = document.getElementById('net-profit-page');
		if (!el || !el.dataset) return {};
		return {
			todayStr: el.dataset.today || '',
			defaultRangeStart: el.dataset.rangeStart || '',
			defaultRangeEnd: el.dataset.rangeEnd || '',
			houseSharePct: el.dataset.houseSharePct || '',
		};
	}
	const cfg = readNetProfitConfig();
	const todayStr = cfg.todayStr || '';
	const defaultStart = cfg.defaultRangeStart || todayStr;
	const defaultEnd = cfg.defaultRangeEnd || todayStr;

	const $tbody = document.getElementById('bnpp-tbody');
	const $tfoot = document.getElementById('bnpp-tfoot');
	const $rangeInput = document.getElementById('bnpp-range');
	const $exportBtn = document.getElementById('bnpp-export-excel');
	const $printBtn = document.getElementById('bnpp-print');

	let fpInstance = null;
	let rangeStart = defaultStart;
	let rangeEnd = defaultEnd;

	function fmt(n) {
		if (n == null || Number.isNaN(Number(n))) return '0';
		return Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
	}

	function fmtPct(n) {
		if (n == null || Number.isNaN(Number(n))) return '';
		return `${fmt(n)}%`;
	}

	function formatPctInput(n) {
		if (n == null || Number.isNaN(Number(n))) return '';
		return String(Math.round(Number(n) * 10000) / 10000);
	}

	function escapeHtml(s) {
		const d = document.createElement('div');
		d.textContent = s == null ? '' : String(s);
		return d.innerHTML;
	}

	/** YYYY-MM-DD → e.g. Apr 01, 2026 (en-US) */
	function formatDisplayDate(iso) {
		if (iso == null || iso === '') return '';
		const s = String(iso).trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return escapeHtml(s);
		const y = parseInt(s.slice(0, 4), 10);
		const mo = parseInt(s.slice(5, 7), 10) - 1;
		const day = parseInt(s.slice(8, 10), 10);
		const dt = new Date(y, mo, day);
		if (Number.isNaN(dt.getTime())) return escapeHtml(s);
		return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
	}

	function buildQuery() {
		return `start=${encodeURIComponent(rangeStart)}&end=${encodeURIComponent(rangeEnd)}`;
	}

	function netProfitCurrentMonthDate() {
		if (/^\d{4}-\d{2}-\d{2}$/.test(todayStr)) {
			const y = parseInt(todayStr.slice(0, 4), 10);
			const mo = parseInt(todayStr.slice(5, 7), 10) - 1;
			const day = parseInt(todayStr.slice(8, 10), 10);
			const dt = new Date(y, mo, day);
			if (!Number.isNaN(dt.getTime())) return dt;
		}
		return new Date();
	}

	function jumpNetProfitRangeToCurrentThreeMonths(instance) {
		if (!instance) return;
		const current = netProfitCurrentMonthDate();
		instance.jumpToDate(new Date(current.getFullYear(), current.getMonth() - 2, 1), false);
	}

	function formatDisplayDatePlain(iso) {
		if (iso == null || iso === '') return '';
		const s = String(iso).trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(s).slice(0, 128);
		const y = parseInt(s.slice(0, 4), 10);
		const mo = parseInt(s.slice(5, 7), 10) - 1;
		const day = parseInt(s.slice(8, 10), 10);
		const dt = new Date(y, mo, day);
		if (Number.isNaN(dt.getTime())) return s;
		return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
	}

	function buildExportPayload(payload) {
		const pct =
			payload.house_share_pct != null && !Number.isNaN(Number(payload.house_share_pct))
				? Number(payload.house_share_pct)
				: 60;
		const headers = [
			'Date',
			'Games',
			'Win / loss',
			'Share Percentage',
			'Share',
			'Commission',
			'Expenses',
			'Net profit'
		];
		const rows = [];
		for (const r of payload.rows || []) {
			const raw = r.settlement_label != null ? r.settlement_label : r.settlement_date;
			rows.push([
				formatDisplayDatePlain(raw),
				r.game_count,
				r.win_loss,
				fmtPct(r.share_percentage != null ? r.share_percentage : pct),
				r.casino_share,
				r.commission,
				r.house_expenses_settled,
				r.grand_net_profit
			]);
		}
		const t = payload.range_totals || {};
		rows.push([
			'TOTAL',
			t.game_count != null ? t.game_count : '',
			t.win_loss,
			fmtPct(t.share_percentage != null ? t.share_percentage : pct),
			t.casino_share,
			t.commission,
			t.house_expenses_settled,
			t.grand_net_profit
		]);
		return { headers, rows };
	}

	async function exportToExcel() {
		if (!$exportBtn) return;
		const q = buildQuery();
		$exportBtn.disabled = true;
		try {
			const res = await fetch(`/net_profit_data?${q}`, { credentials: 'same-origin' });
			const payload = await res.json();
			if (!payload.success) throw new Error(payload.error || 'Request failed');
			const { headers, rows } = buildExportPayload(payload);
			const filename = `NetProfit_${rangeStart}_${rangeEnd}.xlsx`;
			const exportRes = await fetch('/net_profit/export_xlsx', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					headers,
					rows,
					filename,
					sheetName: 'Net profit'
				})
			});
			if (!exportRes.ok) {
				const j = await exportRes.json().catch(() => ({}));
				throw new Error(j.error || 'Export failed');
			}
			const blob = await exportRes.blob();
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(link.href);
		} catch (err) {
			console.error('exportToExcel:', err);
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'error', title: 'Export', text: err.message || 'Export failed.' });
			} else {
				alert(err.message || 'Export failed.');
			}
		} finally {
			$exportBtn.disabled = false;
		}
	}

	function getPrintStyles() {
		return [
			'@page{size:landscape;margin:10mm;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'.print-wrap{width:100%;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
			'table{width:100%;border-collapse:collapse;font-size:11px;}',
			'th,td{border:1px solid #777;padding:6px 8px;vertical-align:middle;}',
			'th{background:#d9e1f2;text-align:right;font-weight:700;}',
			'th:first-child,td:first-child{text-align:left;}',
			'td{text-align:right;}',
			'tbody tr:last-child td{font-weight:700;background:#fff3cd;}'
		].join('');
	}

	function printPayload(payload) {
		const { headers, rows } = buildExportPayload(payload);
		if (!(payload.rows || []).length) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'info', title: 'Print', text: 'No rows to print.' });
			} else {
				alert('No rows to print.');
			}
			return;
		}

		const headerHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
		const rowsHtml = rows.map((row) => {
			return `<tr>${row.map((cell, idx) => {
				const value = idx === 0 || idx === 3 ? cell : fmt(cell);
				return `<td>${escapeHtml(value)}</td>`;
			}).join('')}</tr>`;
		}).join('');
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
			'<!doctype html><html><head><title>Net Profit</title><style>',
			getPrintStyles(),
			'</style></head><body><div class="print-wrap">',
			'<h2>Net Profit</h2>',
			'<div class="subtitle">', escapeHtml(`${formatDisplayDatePlain(rangeStart)} to ${formatDisplayDatePlain(rangeEnd)}`), '</div>',
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

	function printNetProfit() {
		if (!$printBtn) return;
		const q = buildQuery();
		$printBtn.disabled = true;
		fetch(`/net_profit_data?${q}`, { credentials: 'same-origin' })
			.then((res) => res.json())
			.then((payload) => {
				if (!payload.success) throw new Error(payload.error || 'Request failed');
				printPayload(payload);
			})
			.catch((err) => {
				console.error('printNetProfit:', err);
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'error', title: 'Print', text: err.message || 'Print failed.' });
				} else {
					alert(err.message || 'Print failed.');
				}
			})
			.finally(() => {
				$printBtn.disabled = false;
			});
	}

	async function saveSharePercentage(input) {
		const settlementDate = input && input.dataset ? input.dataset.settlementDate : '';
		const sharePercentage = Number(input ? input.value : NaN);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) return;
		if (!Number.isFinite(sharePercentage) || sharePercentage < 0 || sharePercentage > 100) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'warning', title: 'Invalid percentage', text: 'Share percentage must be between 0 and 100.' });
			} else {
				alert('Share percentage must be between 0 and 100.');
			}
			return;
		}

		input.disabled = true;
		try {
			const res = await fetch('/net_profit/share_percentage', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					settlement_date: settlementDate,
					share_percentage: sharePercentage
				})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok || !payload.success) throw new Error(payload.error || 'Failed to save share percentage.');
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'success', title: 'Saved', timer: 900, showConfirmButton: false });
			}
			loadData();
		} catch (err) {
			console.error('saveSharePercentage:', err);
			input.disabled = false;
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Failed to save share percentage.' });
			} else {
				alert(err.message || 'Failed to save share percentage.');
			}
		}
	}

	function render(payload) {
		if (!$tbody || !$tfoot) return;
		const pct = payload.house_share_pct != null ? Number(payload.house_share_pct) : NaN;
		const list = payload.rows || [];
		const rows = list.map((r) => {
			const raw = r.settlement_label != null ? r.settlement_label : r.settlement_date;
			const label = formatDisplayDate(raw);
			const settlementDate = String(r.settlement_date || raw || '').slice(0, 10);
			const sharePct = r.share_percentage != null ? r.share_percentage : pct;
			return `<tr>
				<td>${label}</td>
				<td>${r.game_count}</td>
				<td>${fmt(r.win_loss)}</td>
				<td>
					<div class="d-inline-flex align-items-center justify-content-end gap-1">
						<input type="number" class="form-control form-control-sm bnpp-share-input" min="0" max="100" step="0.01" value="${escapeHtml(formatPctInput(sharePct))}" data-settlement-date="${escapeHtml(settlementDate)}" aria-label="Share percentage for ${escapeHtml(formatDisplayDatePlain(settlementDate))}">
						<span>%</span>
					</div>
				</td>
				<td>${fmt(r.casino_share)}</td>
				<td>${fmt(r.commission)}</td>
				<td>${fmt(r.house_expenses_settled)}</td>
				<td>${fmt(r.grand_net_profit)}</td>
			</tr>`;
		});
		$tbody.innerHTML = rows.length
			? rows.join('')
			: '<tr><td colspan="8" class="text-center text-muted py-4">Walang data sa range.</td></tr>';

		const t = payload.range_totals || {};
		const cap = 'TOTAL';
		$tfoot.innerHTML = `<tr>
			<td>${cap}</td>
			<td>${t.game_count != null ? t.game_count : ''}</td>
			<td>${fmt(t.win_loss)}</td>
			<td>${fmtPct(t.share_percentage != null ? t.share_percentage : pct)}</td>
			<td>${fmt(t.casino_share)}</td>
			<td>${fmt(t.commission)}</td>
			<td>${fmt(t.house_expenses_settled)}</td>
			<td>${fmt(t.grand_net_profit)}</td>
		</tr>`;
	}

	function loadData() {
		const q = buildQuery();
		fetch(`/net_profit_data?${q}`, { credentials: 'same-origin' })
			.then((r) => r.json())
			.then((payload) => {
				if (!payload.success) throw new Error(payload.error || 'Request failed');
				render(payload);
			})
			.catch((err) => {
				console.error(err);
				if ($tbody) {
					$tbody.innerHTML =
						'<tr><td colspan="8" class="text-center text-danger py-4">Failed to load data.</td></tr>';
				}
				if ($tfoot) $tfoot.innerHTML = '';
			});
	}

	document.addEventListener('DOMContentLoaded', function () {
		rangeStart = defaultStart;
		rangeEnd = defaultEnd;
		if (typeof flatpickr !== 'undefined' && $rangeInput) {
			fpInstance = flatpickr($rangeInput, {
				mode: 'range',
				dateFormat: 'Y-m-d',
				altInput: true,
				altFormat: 'M d, Y',
				altInputClass: 'form-control',
				locale: { rangeSeparator: ' to ' },
				defaultDate: [defaultStart, defaultEnd],
				showMonths: 3,
				allowInput: false,
				onReady: function (_selectedDates, _dateStr, instance) {
					jumpNetProfitRangeToCurrentThreeMonths(instance);
				},
				onOpen: function (_selectedDates, _dateStr, instance) {
					jumpNetProfitRangeToCurrentThreeMonths(instance);
				},
				onChange: function (selectedDates, _dateStr, instance) {
					if (selectedDates.length === 2) {
						rangeStart = instance.formatDate(selectedDates[0], 'Y-m-d');
						rangeEnd = instance.formatDate(selectedDates[1], 'Y-m-d');
						loadData();
					}
				},
			});
		}
		loadData();
		if ($exportBtn) {
			$exportBtn.addEventListener('click', function () {
				exportToExcel();
			});
		}
		if ($printBtn) {
			$printBtn.addEventListener('click', function () {
				printNetProfit();
			});
		}
		if ($tbody) {
			$tbody.addEventListener('change', function (event) {
				if (event.target && event.target.classList.contains('bnpp-share-input')) {
					saveSharePercentage(event.target);
				}
			});
			$tbody.addEventListener('keydown', function (event) {
				if (event.key === 'Enter' && event.target && event.target.classList.contains('bnpp-share-input')) {
					event.preventDefault();
					event.target.blur();
				}
			});
		}
	});
})();
