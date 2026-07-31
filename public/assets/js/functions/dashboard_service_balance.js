(function () {
	'use strict';

	var ROW_CONTAINER_IDS = ['dash-service-category-rows-main', 'dash-service-category-rows-anticipated'];

	function formatSignedHtml(n) {
		var v = Math.round(Number(n) || 0);
		if (!v) return '0';
		if (v < 0) {
			return '<span class="text-dash-neg">(' + Math.abs(v).toLocaleString('en-US') + ')</span>';
		}
		return v.toLocaleString('en-US');
	}

	function formatNegHtml(n) {
		var v = Math.round(Number(n) || 0);
		if (!v) return '0';
		return '<span class="text-dash-neg">(' + Math.abs(v).toLocaleString('en-US') + ')</span>';
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function buildCategoryRowHtml(cat) {
		var key = escapeHtml(cat.key);
		var label = escapeHtml(cat.label || cat.key || '');
		var modalId = escapeHtml(cat.modalId || 'modal-dash-service-category');
		return [
			'<div class="dash-kv dash-service-category-row" data-category="', key, '">',
			'<span class="dash-kv-label">',
			'<a href="#" class="js-open-dash-service-category" data-category="', key, '" data-label="', label, '" data-modal-id="', modalId, '">',
			label,
			'</a></span>',
			'<span class="dash-kv-value dash-service-balance" data-category="', key, '">',
			formatSignedHtml(cat.balance),
			'</span></div>'
		].join('');
	}

	function renderCategoryRows(categories) {
		var html = (categories || []).map(buildCategoryRowHtml).join('');
		ROW_CONTAINER_IDS.forEach(function (id) {
			var container = document.getElementById(id);
			if (container) container.innerHTML = html;
		});
	}

	function updateBalanceDisplay(category, value) {
		document.querySelectorAll('.dash-service-balance[data-category="' + category + '"]').forEach(function (el) {
			el.innerHTML = formatSignedHtml(value);
		});
	}

	window.getDashPeriodYmd = function () {
		var from = document.getElementById('dash-date-from');
		var to = document.getElementById('dash-date-to');
		var start = from ? String(from.value || '').trim().slice(0, 10) : '';
		var end = to ? String(to.value || '').trim().slice(0, 10) : '';
		if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
			return { start: start, end: end };
		}
		return null;
	};

	function updateCompanyExpenseTotal(junketOutTotal) {
		var panel = document.getElementById('dash-anticipated-panel');
		if (!panel) return;

		var base = Number(panel.dataset.companyExpenseBase) || 0;
		var total = base + (Number(junketOutTotal) || 0);
		panel.dataset.companyExpense = String(total);

		var totalEl = document.getElementById('dash-company-expense-total');
		if (totalEl) totalEl.innerHTML = formatNegHtml(total);

		var rate = Number(panel.dataset.wlRate);
		if (!Number.isFinite(rate)) rate = Number(panel.dataset.wlDefault) || 65;
		var winLoss = Number(panel.dataset.winLoss) || 0;
		var serviceSettle = Number(panel.dataset.serviceSettle) || 0;
		var wlSettlement = Math.round(winLoss * (rate / 100));
		var casinoTotal = wlSettlement - serviceSettle;
		var grandTotal = casinoTotal - total;

		var wlSettlementEl = document.getElementById('dash-wl-settlement');
		if (wlSettlementEl) wlSettlementEl.innerHTML = formatSignedHtml(wlSettlement);
		var casinoTotalEl = document.getElementById('dash-casino-total');
		if (casinoTotalEl) casinoTotalEl.innerHTML = formatSignedHtml(casinoTotal);
		var grandTotalEl = document.getElementById('dash-grand-total');
		if (grandTotalEl) grandTotalEl.innerHTML = formatSignedHtml(grandTotal);
	}

	window.isDashJunketExpense = function (service) {
		if (!service || service.SOURCE_TYPE !== 'JUNKET') return false;
		var tx = parseInt(service.TRANSACTION_ID, 10);
		return tx === 1 || tx === 2;
	};

	window.refreshDashServiceBalances = function () {
		// On dashboard, keep Add Charge / company totals in sync with the global date range.
		if (typeof window.dashboardPeriodReload === 'function' && document.getElementById('dash-date-from') && document.getElementById('dash-date-to')) {
			return Promise.resolve(window.dashboardPeriodReload());
		}

		return fetch('/dashboard/service_expense_balances', { credentials: 'same-origin' })
			.then(function (res) {
				if (!res.ok) throw new Error('Failed to load service expense balances');
				return res.json();
			})
			.then(function (data) {
				var categories = Array.isArray(data.categories) ? data.categories : [];
				if (categories.length) {
					renderCategoryRows(categories);
				} else {
					['fnb', 'hotel', 'incidental', 'delivery'].forEach(function (key) {
						if (Object.prototype.hasOwnProperty.call(data, key)) {
							updateBalanceDisplay(key, data[key]);
						}
					});
				}
				updateCompanyExpenseTotal(data.junketOutTotal);
				return data;
			})
			.catch(function (err) {
				console.error('refreshDashServiceBalances:', err);
			});
	};

	window.refreshDashServiceCategoryUi = function () {
		return window.refreshDashServiceBalances();
	};

	document.addEventListener('click', function (event) {
		var link = event.target.closest('.js-open-dash-service-category');
		if (!link) return;
		event.preventDefault();
		var categoryKey = link.getAttribute('data-category') || '';
		var categoryLabel = link.getAttribute('data-label') || categoryKey;
		var modalId = link.getAttribute('data-modal-id') || 'modal-dash-service-category';
		if (typeof window.openDashServiceCategoryModal === 'function') {
			window.openDashServiceCategoryModal(categoryKey, categoryLabel, modalId);
		}
	});

	document.addEventListener('DOMContentLoaded', function () {
		if (typeof window.refreshDashServiceBalances === 'function') {
			window.refreshDashServiceBalances();
		}
	});

	document.addEventListener('visibilitychange', function () {
		if (document.visibilityState === 'visible' && typeof window.refreshDashServiceBalances === 'function') {
			window.refreshDashServiceBalances();
		}
	});

	window.addEventListener('storage', function (event) {
		if (event.key === 'dashServiceCategoriesUpdated' && typeof window.refreshDashServiceBalances === 'function') {
			window.refreshDashServiceBalances();
		}
	});
})();
