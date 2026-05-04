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

	let fpInstance = null;
	let rangeStart = defaultStart;
	let rangeEnd = defaultEnd;

	function fmt(n) {
		if (n == null || Number.isNaN(Number(n))) return '0';
		return Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
			`Casino share (${pct}%)`,
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

	function render(payload) {
		if (!$tbody || !$tfoot) return;
		const pct = payload.house_share_pct != null ? Number(payload.house_share_pct) : NaN;
		const thCasino = document.getElementById('bnpp-th-casino-share');
		if (thCasino && !Number.isNaN(pct)) {
			thCasino.textContent = `Casino share (${pct}%)`;
		}
		const list = payload.rows || [];
		const rows = list.map((r) => {
			const raw = r.settlement_label != null ? r.settlement_label : r.settlement_date;
			const label = formatDisplayDate(raw);
			return `<tr>
				<td>${label}</td>
				<td>${r.game_count}</td>
				<td>${fmt(r.win_loss)}</td>
				<td>${fmt(r.casino_share)}</td>
				<td>${fmt(r.commission)}</td>
				<td>${fmt(r.house_expenses_settled)}</td>
				<td>${fmt(r.grand_net_profit)}</td>
			</tr>`;
		});
		$tbody.innerHTML = rows.length
			? rows.join('')
			: '<tr><td colspan="7" class="text-center text-muted py-4">Walang data sa range.</td></tr>';

		const t = payload.range_totals || {};
		const cap = 'TOTAL';
		$tfoot.innerHTML = `<tr>
			<td>${cap}</td>
			<td>${t.game_count != null ? t.game_count : ''}</td>
			<td>${fmt(t.win_loss)}</td>
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
						'<tr><td colspan="7" class="text-center text-danger py-4">Failed to load data.</td></tr>';
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
				allowInput: false,
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
	});
})();
