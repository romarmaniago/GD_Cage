(function () {
	'use strict';

	var els = {};
	var currencyLabels = {
		USD: 'USD $',
		GCASH: 'GCASH'
	};

	function $(id) {
		return document.getElementById(id);
	}

	function cacheEls() {
		els.panel = $('dash-cage-cash-panel');
		els.usdTotal = $('dash-cage-usd-total');
		els.gcashTotal = $('dash-cage-gcash-total');
		els.diffValue = $('dash-cage-balance-diff-value');
		els.modal = $('modal-dash-cage-manual-cash');
		els.form = $('dash-cage-manual-cash-form');
		els.currencyInput = $('dash-cage-manual-cash-currency');
		els.modalTitle = $('modal-dash-cage-manual-cash-label');
		els.programDate = $('dash-cage-manual-cash-program-date');
		els.amountLabel = $('dash-cage-manual-cash-amount-label');
		els.amount = $('dash-cage-manual-cash-amount');
		els.remarks = $('dash-cage-manual-cash-remarks');
		els.historyBody = $('dash-cage-manual-cash-history-body');
		els.historyTable = $('dash-cage-manual-cash-history-tbl');
		els.editModal = $('modal-dash-cage-manual-cash-edit');
		els.editForm = $('dash-cage-manual-cash-edit-form');
		els.editId = $('dash-cage-manual-cash-edit-id');
		els.editAmount = $('dash-cage-manual-cash-edit-amount');
		els.editRemarks = $('dash-cage-manual-cash-edit-remarks');
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function escapeAttr(value) {
		return escapeHtml(value).replace(/`/g, '&#96;');
	}

	function formatYmd(date) {
		var d = date instanceof Date ? date : new Date(date);
		if (Number.isNaN(d.getTime())) return '';
		var pad = function (n) { return String(n).padStart(2, '0'); };
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	}

	function todayProgramDateValue() {
		return formatYmd(new Date());
	}

	function getProgramDateInputValue(el) {
		el = el || els.programDate;
		if (!el) return '';
		if (el._flatpickr && el._flatpickr.altInput) {
			return String(el._flatpickr.altInput.value || '').trim();
		}
		return String(el.value || '').trim();
	}

	function isValidDateParts(y, m, d) {
		var dt = new Date(y, m - 1, d);
		return (
			!Number.isNaN(dt.getTime()) &&
			dt.getFullYear() === y &&
			dt.getMonth() === m - 1 &&
			dt.getDate() === d
		);
	}

	function toIsoFromParts(y, m, d) {
		if (!isValidDateParts(y, m, d)) return '';
		return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
	}

	function parseManualDate(raw) {
		var text = String(raw || '').trim();
		if (!text) return '';

		var isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
		if (isoMatch) {
			return toIsoFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
		}

		var ymdMatch = text.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
		if (ymdMatch) {
			return toIsoFromParts(Number(ymdMatch[1]), Number(ymdMatch[2]), Number(ymdMatch[3]));
		}

		var slashMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
		if (slashMatch) {
			var a = Number(slashMatch[1]);
			var b = Number(slashMatch[2]);
			var y = Number(slashMatch[3]);
			if (a > 12) return toIsoFromParts(y, b, a);
			if (b > 12) return toIsoFromParts(y, a, b);
			return toIsoFromParts(y, a, b);
		}

		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.toApiDate === 'function') {
			var api = window.MonthEndCutoffRange.toApiDate(text);
			if (api) return String(api).slice(0, 10);
		}

		return '';
	}

	function formatDateInput(iso) {
		var match = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!match) return '';
		return match[1] + '/' + match[2] + '/' + match[3];
	}

	function getProgramDateValue(el) {
		el = el || els.programDate;
		if (!el) return '';
		var manual = parseManualDate(getProgramDateInputValue(el));
		if (manual) return manual;
		if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates[0]) {
			return formatYmd(el._flatpickr.selectedDates[0]);
		}
		return parseManualDate(el.value) || '';
	}

	function syncProgramDateInput(el) {
		el = el || els.programDate;
		if (!el) return '';
		var parsed = parseManualDate(getProgramDateInputValue(el));
		if (!parsed) return '';
		if (el._flatpickr) {
			el._flatpickr.setDate(parsed, false);
		} else {
			el.value = formatDateInput(parsed);
		}
		return parsed;
	}

	function reloadHistoryForProgramDate() {
		var currency = els.currencyInput ? els.currencyInput.value : '';
		var reportDate = syncProgramDateInput(els.programDate) || getProgramDateValue(els.programDate);
		if (currency && reportDate) {
			loadHistory(currency, reportDate);
		}
	}

	function ensureProgramDatePicker(defaultDate) {
		var el = els.programDate;
		if (!el) return;
		var dateVal = defaultDate || getProgramDateValue(el) || todayProgramDateValue();
		if (typeof flatpickr === 'undefined') {
			el.value = formatDateInput(dateVal) || dateVal;
			return;
		}
		if (el._flatpickr) {
			el._flatpickr.setDate(dateVal, false);
			return;
		}
		flatpickr(el, {
			enableTime: false,
			dateFormat: 'Y/m/d',
			defaultDate: dateVal,
			allowInput: true,
			disableMobile: true,
			closeOnSelect: true,
			onReady: function (_selectedDates, _dateStr, instance) {
				var input = instance.input;
				if (!input || input.dataset.boundCageCashDateBlur === '1') return;
				input.dataset.boundCageCashDateBlur = '1';
				input.addEventListener('blur', function () {
					syncProgramDateInput(input);
					reloadHistoryForProgramDate();
				});
			},
			onClose: function (_selectedDates, _dateStr, instance) {
				syncProgramDateInput(instance.input);
				reloadHistoryForProgramDate();
			},
			onChange: function () {
				reloadHistoryForProgramDate();
			}
		});
	}

	function formatReportDate(iso) {
		if (!iso) return '—';
		var parts = String(iso).split('-');
		if (parts.length !== 3) return iso;
		var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function formatSignedAmountInput(value) {
		var raw = String(value ?? '');
		var sign = '';
		if (raw.charAt(0) === '+' || raw.charAt(0) === '-') {
			sign = raw.charAt(0);
			raw = raw.slice(1);
		}
		var cleaned = raw.replace(/[^\d]/g, '');
		if (!cleaned) return sign || '';
		return sign + Number(cleaned).toLocaleString('en-US');
	}

	function parseSignedAmount(raw) {
		var cleaned = String(raw ?? '').replace(/,/g, '').trim();
		if (!cleaned || cleaned === '+' || cleaned === '-') return NaN;
		var n = Number(cleaned);
		return Number.isFinite(n) ? n : NaN;
	}

	function formatSignedAmountCell(value) {
		if (typeof window.formatServiceChargeAmount === 'function') {
			return window.formatServiceChargeAmount(value);
		}
		var n = Number(value) || 0;
		if (n > 0) return Math.abs(n).toLocaleString('en-US');
		if (n < 0) {
			return '<span class="text-danger" style="color:#dc3545 !important;">(' + Math.abs(n).toLocaleString('en-US') + ')</span>';
		}
		return '0';
	}

	function signedAmountInputFromNumber(value) {
		var n = Math.round(Number(value) || 0);
		if (n === 0) return '';
		var sign = n < 0 ? '-' : '+';
		return sign + Math.abs(n).toLocaleString('en-US');
	}

	function formatAmount(value) {
		var n = Number(value);
		if (!Number.isFinite(n) || n === 0) return '0';
		return Math.round(n).toLocaleString('en-US');
	}

	function formatAmtHtml(n) {
		var v = Math.round(Number(n) || 0);
		if (v < 0) {
			return '<span class="text-dash-neg">(' + Math.abs(v).toLocaleString('en-US') + ')</span>';
		}
		return v.toLocaleString('en-US');
	}

	function getModalInstance() {
		if (!els.modal || typeof bootstrap === 'undefined') return null;
		var instance = bootstrap.Modal.getOrCreateInstance(els.modal, { focus: false });
		if (instance._config) instance._config.focus = false;
		return instance;
	}

	function releaseParentFocusTrap() {
		var instance = getModalInstance();
		if (instance && instance._focustrap && typeof instance._focustrap.deactivate === 'function') {
			instance._focustrap.deactivate();
		}
	}

	function recalcDiff() {
		if (!els.panel || !els.diffValue) return;
		var php = Number(els.panel.dataset.phpBalance) || 0;
		var chips = Number(els.panel.dataset.chipsBalance) || 0;
		var house = Number(els.panel.dataset.houseBalance) || 0;
		// USD/GCASH are manual — exclude from The difference
		els.diffValue.innerHTML = formatAmtHtml(house - (php + chips));
	}

	function updateDashboardTotals(totals) {
		totals = totals || {};
		var usd = Number(totals.USD) || 0;
		var gcash = Number(totals.GCASH) || 0;
		if (els.usdTotal) els.usdTotal.innerHTML = formatAmtHtml(usd);
		if (els.gcashTotal) els.gcashTotal.innerHTML = formatAmtHtml(gcash);
		recalcDiff();
	}

	async function fetchTotals() {
		var res = await fetch('/cage_manual_cash_totals', { credentials: 'same-origin' });
		var data = await res.json().catch(function () { return {}; });
		if (!res.ok) throw new Error(data.message || 'Unable to load totals.');
		return data.totals || {};
	}

	async function refreshDashboardTotals() {
		try {
			// The Cage Balance card (incl. USD/GCASH) is period-independent — refresh it
			// via the house-balance loader, not the period summary.
			if (typeof window.dashboardHouseBalanceReload === 'function' && document.getElementById('dash-cage-cash-panel')) {
				await window.dashboardHouseBalanceReload();
				return;
			}
			updateDashboardTotals(await fetchTotals());
		} catch (err) {
			console.error('refreshDashboardTotals:', err);
		}
	}

	function renderRemarksCell(row) {
		var remarks = row.remarks != null ? String(row.remarks) : '';
		if (window.RemarksEditor) {
			return window.RemarksEditor.renderCell(remarks, {
				source: 'cage_manual_cash',
				recordId: row.id
			});
		}
		return remarks
			? '<span class="text-break">' + escapeHtml(remarks) + '</span>'
			: '<span class="text-muted">—</span>';
	}

	function renderActionCell(id, amount, remarks) {
		return '<div class="dash-beyond-chips-actions text-center">' +
			'<button type="button" class="btn btn-sm btn-outline-primary js-cage-manual-cash-edit me-1" data-id="' + escapeAttr(id) + '" data-amount="' + escapeAttr(amount) + '" data-remarks="' + escapeAttr(remarks || '') + '" title="Edit" aria-label="Edit">' +
			'<i class="fa fa-pencil-alt" aria-hidden="true"></i></button>' +
			'<button type="button" class="btn btn-sm btn-outline-danger js-cage-manual-cash-delete" data-id="' + escapeAttr(id) + '" title="Delete" aria-label="Delete">' +
			'<i class="fa fa-trash-alt" aria-hidden="true"></i></button></div>';
	}

	function renderHistory(payload) {
		if (!els.historyBody) return;
		var entries = Array.isArray(payload && payload.entries) ? payload.entries : [];
		if (!entries.length) {
			els.historyBody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-3">No entries for this date</td></tr>';
			return;
		}
		els.historyBody.innerHTML = entries.map(function (row) {
			return '<tr>' +
				'<td class="cage-manual-cash-col-date">' + escapeHtml(formatReportDate(row.report_date || row.encoded_dt)) + '</td>' +
				'<td class="cage-manual-cash-col-amount text-end">' + formatSignedAmountCell(row.amount) + '</td>' +
				'<td class="cage-manual-cash-col-remarks remarks-editor-td">' + renderRemarksCell(row) + '</td>' +
				'<td class="cage-manual-cash-col-action text-center js-cage-manual-cash-actions">' + renderActionCell(row.id, row.amount, row.remarks) + '</td>' +
				'</tr>';
		}).join('');
	}

	async function loadHistory(currency, reportDate) {
		if (!els.historyBody || !currency || !reportDate) return;
		els.historyBody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-3">Loading...</td></tr>';
		try {
			var q = new URLSearchParams({ currency: currency, report_date: reportDate });
			var res = await fetch('/cage_manual_cash_history?' + q, { credentials: 'same-origin' });
			var data = await res.json().catch(function () { return {}; });
			if (!res.ok) throw new Error(data.message || 'Unable to load history.');
			renderHistory(data);
		} catch (err) {
			console.error('loadHistory cage manual cash:', err);
			els.historyBody.innerHTML = '<tr><td colspan="4" class="text-danger text-center py-3">Unable to load history</td></tr>';
		}
	}

	function openModal(currency) {
		if (!els.modal || !currency) return;
		var label = currencyLabels[currency] || currency;
		var reportDate = todayProgramDateValue();

		if (els.modalTitle) els.modalTitle.textContent = label;
		if (els.currencyInput) els.currencyInput.value = currency;
		ensureProgramDatePicker(reportDate);
		if (els.amountLabel) els.amountLabel.textContent = 'Amount';
		if (els.amount) els.amount.value = '';
		if (els.remarks) els.remarks.value = '';

		getModalInstance().show();
		loadHistory(currency, reportDate);
		els.modal.addEventListener('shown.bs.modal', function () {
			if (els.amount) els.amount.focus();
		}, { once: true });
	}

	function openEditModal(id, amount, remarks) {
		if (!els.editModal || !els.editId || !els.editAmount || typeof bootstrap === 'undefined') return;
		els.editId.value = String(id);
		els.editAmount.value = signedAmountInputFromNumber(amount);
		if (els.editRemarks) els.editRemarks.value = remarks != null ? String(remarks) : '';
		releaseParentFocusTrap();
		var editInstance = bootstrap.Modal.getOrCreateInstance(els.editModal);
		els.editModal.addEventListener('shown.bs.modal', function () {
			els.editAmount.focus();
		}, { once: true });
		editInstance.show();
	}

	async function saveEntry(currency, reportDate, amount, remarks) {
		var res = await fetch('/add_cage_manual_cash', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ currency: currency, report_date: reportDate, amount: amount, remarks: remarks })
		});
		var data = await res.json().catch(function () { return {}; });
		if (!res.ok) throw new Error(data.message || 'Unable to save entry.');
	}

	async function updateEntry(id, amount, remarks) {
		var res = await fetch('/update_cage_manual_cash', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ id: id, amount: amount, remarks: remarks })
		});
		var data = await res.json().catch(function () { return {}; });
		if (!res.ok) throw new Error(data.message || 'Unable to update entry.');
	}

	async function deleteEntry(id) {
		var res = await fetch('/delete_cage_manual_cash', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ id: id })
		});
		var data = await res.json().catch(function () { return {}; });
		if (!res.ok) throw new Error(data.message || 'Unable to delete entry.');
	}

	async function refreshViews(currency, reportDate) {
		await Promise.all([
			loadHistory(currency, reportDate),
			refreshDashboardTotals()
		]);
	}

	async function promptDelete(id) {
		if (typeof Swal === 'undefined') return;
		var result = await Swal.fire({
			title: 'Delete entry?',
			text: 'This entry will be removed.',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Delete',
			cancelButtonText: 'Cancel',
			confirmButtonColor: '#dc3545',
			focusConfirm: false
		});
		if (!result.isConfirmed) return;

		var currency = els.currencyInput ? els.currencyInput.value : '';
		var reportDate = syncProgramDateInput(els.programDate) || getProgramDateValue(els.programDate);

		try {
			await deleteEntry(id);
			await refreshViews(currency, reportDate);
			Swal.fire({ icon: 'success', title: 'Deleted', timer: 1300, showConfirmButton: false });
		} catch (err) {
			console.error('promptDelete cage manual cash:', err);
			Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to delete entry.' });
		}
	}

	function bind() {
		cacheEls();
		if (!els.panel || !els.form) return;

		els.modal && els.modal.addEventListener('show.bs.modal', function () {
			ensureProgramDatePicker(todayProgramDateValue());
		});

		document.addEventListener('click', function (e) {
			var link = e.target.closest('.js-open-cage-manual-cash');
			if (!link) return;
			e.preventDefault();
			var currency = String(link.dataset.currency || '').trim().toUpperCase();
			if (!currency) return;
			openModal(currency);
		});

		els.amount && els.amount.addEventListener('input', function (e) {
			e.target.value = formatSignedAmountInput(e.target.value);
		});

		els.editAmount && els.editAmount.addEventListener('input', function (e) {
			e.target.value = formatSignedAmountInput(e.target.value);
		});

		els.historyTable && els.historyTable.addEventListener('click', function (e) {
			var editBtn = e.target.closest('.js-cage-manual-cash-edit');
			if (editBtn) {
				e.preventDefault();
				openEditModal(editBtn.dataset.id, editBtn.dataset.amount, editBtn.dataset.remarks);
				return;
			}
			var deleteBtn = e.target.closest('.js-cage-manual-cash-delete');
			if (deleteBtn) {
				e.preventDefault();
				promptDelete(deleteBtn.dataset.id);
			}
		});

		els.form.addEventListener('submit', async function (e) {
			e.preventDefault();
			var currency = els.currencyInput ? els.currencyInput.value : '';
			var reportDate = syncProgramDateInput(els.programDate) || getProgramDateValue(els.programDate);
			var amount = parseSignedAmount(els.amount ? els.amount.value : '');
			var remarks = String(els.remarks ? els.remarks.value : '').trim();
			var saveBtn = els.form.querySelector('[type="submit"]');

			if (!currency || !reportDate) {
				if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please select a program date.' });
				return;
			}
			if (Number.isNaN(amount) || amount === 0) {
				if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount (+ to add, - to deduct).' });
				return;
			}

			if (saveBtn) saveBtn.disabled = true;
			try {
				await saveEntry(currency, reportDate, amount, remarks);
				if (els.amount) els.amount.value = '';
				if (els.remarks) els.remarks.value = '';
				await refreshViews(currency, reportDate);
				if (window.Swal) Swal.fire({ icon: 'success', title: 'Saved', timer: 1300, showConfirmButton: false });
			} catch (err) {
				console.error('save cage manual cash:', err);
				if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to save entry.' });
			} finally {
				if (saveBtn) saveBtn.disabled = false;
			}
		});

		els.editForm && els.editForm.addEventListener('submit', async function (e) {
			e.preventDefault();
			var id = els.editId ? els.editId.value : '';
			var amount = parseSignedAmount(els.editAmount ? els.editAmount.value : '');
			var remarks = String(els.editRemarks ? els.editRemarks.value : '').trim();
			var saveBtn = els.editForm.querySelector('[type="submit"]');
			var currency = els.currencyInput ? els.currencyInput.value : '';
			var reportDate = syncProgramDateInput(els.programDate) || getProgramDateValue(els.programDate);

			if (!id) return;
			if (Number.isNaN(amount) || amount === 0) {
				if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount (+ to add, - to deduct).' });
				return;
			}

			if (saveBtn) saveBtn.disabled = true;
			try {
				await updateEntry(id, amount, remarks);
				if (els.editModal && typeof bootstrap !== 'undefined') {
					bootstrap.Modal.getOrCreateInstance(els.editModal).hide();
				}
				await refreshViews(currency, reportDate);
				if (window.Swal) Swal.fire({ icon: 'success', title: 'Updated', timer: 1300, showConfirmButton: false });
			} catch (err) {
				console.error('update cage manual cash:', err);
				if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to update entry.' });
			} finally {
				if (saveBtn) saveBtn.disabled = false;
			}
		});
	}

	document.addEventListener('DOMContentLoaded', bind);
})();
