(function () {
	'use strict';

	function formatAmtHtml(n) {
		var v = Math.round(Number(n) || 0);
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

	function updateBalanceDisplay(category, value, format) {
		var html = format === 'neg' ? formatNegHtml(value) : formatAmtHtml(value);
		document.querySelectorAll('.dash-service-balance[data-category="' + category + '"]').forEach(function (el) {
			el.innerHTML = html;
		});
	}

	window.refreshDashServiceBalances = function () {
		return fetch('/dashboard/service_expense_balances', { credentials: 'same-origin' })
			.then(function (res) {
				if (!res.ok) throw new Error('Failed to load service expense balances');
				return res.json();
			})
			.then(function (data) {
				updateBalanceDisplay('fnb', data.fnb, 'amt');
				updateBalanceDisplay('hotel', data.hotel, 'amt');
				updateBalanceDisplay('incidental', data.incidental, 'neg');
				updateBalanceDisplay('delivery', data.delivery, 'neg');
				return data;
			})
			.catch(function (err) {
				console.error('refreshDashServiceBalances:', err);
			});
	};
})();
