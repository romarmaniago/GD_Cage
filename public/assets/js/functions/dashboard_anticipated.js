(function () {
	'use strict';

	var CARD_TOTAL_IDS = ['dash-wl-settlement', 'dash-casino-total', 'dash-grand-total'];
	var TOTAL_KEYS = ['wlSettlement', 'casinoTotal', 'grandTotal'];

	function getPanel() {
		return document.getElementById('dash-anticipated-panel');
	}

	function getDefaultRate(panel) {
		var rate = Number(panel && panel.dataset.wlDefault);
		return Number.isFinite(rate) ? rate : 65;
	}

	function getSavedRate(panel) {
		var rate = Number(panel && panel.dataset.wlRate);
		return Number.isFinite(rate) ? rate : getDefaultRate(panel);
	}

	function formatAmtHtml(n) {
		var v = Math.round(Number(n) || 0);
		if (v < 0) {
			return '<span class="text-dash-neg">(' + Math.abs(v).toLocaleString('en-US') + ')</span>';
		}
		return v.toLocaleString('en-US');
	}

	function formatAmtPlain(n) {
		var v = Math.round(Number(n) || 0);
		if (v < 0) return '(' + Math.abs(v).toLocaleString('en-US') + ')';
		return v.toLocaleString('en-US');
	}

	function formatMonthKey(monthKey) {
		var parts = String(monthKey || '').split('-');
		if (parts.length !== 2) return monthKey;
		return (+parts[1]) + '/' + parts[0];
	}

	function formatRateInput(rate) {
		return Number(rate).toFixed(2);
	}

	function formatRateLabel(rate) {
		return formatRateInput(rate) + '%';
	}

	function isValidRate(rate) {
		return Number.isFinite(rate) && rate >= 0 && rate <= 100;
	}

	function isValidMonthKey(monthKey) {
		return /^\d{4}-\d{2}$/.test(String(monthKey || '').trim());
	}

	function calcTotals(panel, pct) {
		var rate = Number(pct);
		if (!Number.isFinite(rate)) return null;

		var winLoss = Number(panel.dataset.winLoss) || 0;
		var serviceSettle = Number(panel.dataset.serviceSettle) || 0;
		var companyExpense = Number(panel.dataset.companyExpense) || 0;
		var wlSettlement = Math.round(winLoss * (rate / 100));

		return {
			wlSettlement: wlSettlement,
			casinoTotal: wlSettlement - serviceSettle,
			grandTotal: wlSettlement - serviceSettle - companyExpense
		};
	}

	function updateCardTotals(panel, pct) {
		var totals = calcTotals(panel, pct);
		if (!totals) return;

		CARD_TOTAL_IDS.forEach(function (id, index) {
			var el = document.getElementById(id);
			if (el) el.innerHTML = formatAmtHtml(totals[TOTAL_KEYS[index]]);
		});
	}

	function hideWlRateModal() {
		var modalEl = document.getElementById('modal-dash-wl-rate');
		if (!modalEl || !window.bootstrap || !bootstrap.Modal) return;
		var instance = bootstrap.Modal.getInstance(modalEl);
		if (instance) instance.hide();
	}

	function updateWlRateDisplay(rate) {
		var text = formatRateLabel(rate);
		var link = document.getElementById('dash-wl-rate-link');
		if (link) link.textContent = text;
		var display = document.getElementById('dash-wl-rate-display');
		if (display) display.textContent = text;

		var panel = getPanel();
		if (panel) panel.dataset.wlRate = String(rate);
	}

	function resetModalInput(input, rate) {
		input.value = formatRateInput(rate);
	}

	function warnInvalidRate() {
		if (window.Swal) {
			Swal.fire({ icon: 'warning', title: 'Invalid rate', text: 'W/L rate must be between 0 and 100.' });
		}
	}

	async function confirmSave(rate, previous, panel) {
		var monthKey = panel.dataset.monthKey || '';
		var winLoss = Number(panel.dataset.winLoss) || 0;
		var wlSettlement = Math.round(winLoss * (rate / 100));

		if (window.SwalConfirm && window.Swal) {
			var result = await SwalConfirm.fire({
				title: 'Confirm W/L Rate',
				rows: [
					['Month', formatMonthKey(monthKey)],
					['W/L', formatAmtPlain(winLoss), 'right'],
					['Previous Rate', formatRateLabel(previous)],
					['New Rate', formatRateLabel(rate)],
					['W/L Settlement', formatAmtPlain(wlSettlement), 'right']
				],
				message: 'Are you sure you want to save this W/L rate?',
				confirmButtonText: 'Yes, Save'
			});
			return !!result.isConfirmed;
		}

		return window.confirm('Save W/L rate?');
	}

	async function persistWlRate(rate, panel) {
		var res = await fetch('/dashboard/wl_share_percentage', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({
				month: panel.dataset.monthKey,
				share_percentage: rate
			})
		});
		var payload = await res.json().catch(function () { return {}; });
		if (!res.ok || !payload.success) {
			throw new Error(payload.error || 'Failed to save W/L rate.');
		}
		return payload.share_percentage != null ? Number(payload.share_percentage) : rate;
	}

	async function handleSave(input, panel, saveBtn) {
		var previous = getSavedRate(panel);
		var rate = Number(input.value);

		if (!isValidMonthKey(panel.dataset.monthKey)) return;
		if (!isValidRate(rate)) {
			warnInvalidRate();
			resetModalInput(input, previous);
			return;
		}

		if (Math.abs(rate - previous) < 0.0001) {
			hideWlRateModal();
			return;
		}

		if (!(await confirmSave(rate, previous, panel))) {
			resetModalInput(input, previous);
			return;
		}

		saveBtn.disabled = true;
		try {
			var saved = await persistWlRate(rate, panel);
			updateWlRateDisplay(saved);
			updateCardTotals(panel, saved);
			hideWlRateModal();
			if (window.Swal) {
				Swal.fire({ icon: 'success', title: 'Saved', timer: 900, showConfirmButton: false });
			}
		} catch (err) {
			console.error('handleSave wl rate:', err);
			resetModalInput(input, previous);
			if (window.Swal) {
				Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Failed to save W/L rate.' });
			}
		} finally {
			saveBtn.disabled = false;
		}
	}

	function bindWlRateModal() {
		var modal = document.getElementById('modal-dash-wl-rate');
		var input = document.getElementById('dash-wl-rate-modal-input');
		var saveBtn = document.getElementById('dash-wl-rate-modal-save');
		var panel = getPanel();

		if (!modal || !input || !saveBtn || !panel) return;

		modal.addEventListener('show.bs.modal', function () {
			resetModalInput(input, getSavedRate(panel));
		});

		input.addEventListener('keydown', function (event) {
			if (event.key === 'Enter') {
				event.preventDefault();
				saveBtn.click();
			}
		});

		saveBtn.addEventListener('click', function () {
			handleSave(input, panel, saveBtn);
		});
	}

	document.addEventListener('DOMContentLoaded', bindWlRateModal);
})();
