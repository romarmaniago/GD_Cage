(function () {
	'use strict';

	function formatSignedHtml(n) {
		var v = Math.round(Number(n) || 0);
		if (!v) return '0';
		if (v < 0) {
			return '<span class="text-dash-neg">(' + Math.abs(v).toLocaleString('en-US') + ')</span>';
		}
		return v.toLocaleString('en-US');
	}

	function updateBalanceDisplay(category, value) {
		document.querySelectorAll('.dash-service-balance[data-category="' + category + '"]').forEach(function (el) {
			el.innerHTML = formatSignedHtml(value);
		});
	}

	window.isDashJunketExpense = function (service) {
		if (!service || service.SOURCE_TYPE !== 'JUNKET') return false;
		var tx = parseInt(service.TRANSACTION_ID, 10);
		return tx === 1 || tx === 2;
	};

	window.refreshDashServiceBalances = function () {
		return fetch('/dashboard/service_expense_balances', { credentials: 'same-origin' })
			.then(function (res) {
				if (!res.ok) throw new Error('Failed to load service expense balances');
				return res.json();
			})
			.then(function (data) {
				updateBalanceDisplay('fnb', data.fnb);
				updateBalanceDisplay('hotel', data.hotel);
				updateBalanceDisplay('incidental', data.incidental);
				updateBalanceDisplay('delivery', data.delivery);
				return data;
			})
			.catch(function (err) {
				console.error('refreshDashServiceBalances:', err);
			});
	};

	document.addEventListener('DOMContentLoaded', function () {
		if (typeof window.refreshDashServiceBalances === 'function') {
			window.refreshDashServiceBalances();
		}
	});
})();
