function matchesServiceCategory(serviceType, category) {
	const raw = String(serviceType || '').trim().toLowerCase();
	if (!raw) return false;

	switch (category) {
		case 'fnb':
			if (raw === 'fnb' || raw === 'f & b') return true;
			{
				const compact = raw.replace(/\s+/g, '').replace(/&/g, '');
				return compact === 'fb' || compact === 'fnb' || raw.includes('f&b') || raw.includes('f & b');
			}
		case 'hotel':
			return raw === 'hotel' || raw.includes('hotel');
		case 'delivery':
			if (raw === 'incidental' || raw.includes('incidental')) return false;
			return raw === 'delivery' || raw.includes('delivery');
		case 'incidental':
			return raw === 'incidental' || raw.includes('incidental');
		default:
			return raw.includes(String(category || '').toLowerCase());
	}
}

function sumDepositsByCategory(rows, category) {
	if (!rows || !rows.length) return 0;
	return rows.reduce((sum, row) => {
		if (matchesServiceCategory(row.SERVICE_TYPE, category)) {
			return sum + (Number(row.TOTAL) || 0);
		}
		return sum;
	}, 0);
}

function categorizeDepositTotals(rows) {
	return {
		fnb: sumDepositsByCategory(rows, 'fnb'),
		hotel: sumDepositsByCategory(rows, 'hotel'),
		delivery: sumDepositsByCategory(rows, 'delivery'),
		incidental: sumDepositsByCategory(rows, 'incidental')
	};
}

function categorizeJunketExpenseTotals(cashRows, depositRows) {
	const deposit = categorizeDepositTotals(depositRows || []);
	const cash = categorizeDepositTotals(cashRows || []);
	return {
		fnb: deposit.fnb + cash.fnb,
		hotel: deposit.hotel + cash.hotel,
		delivery: deposit.delivery + cash.delivery,
		incidental: deposit.incidental + cash.incidental
	};
}

module.exports = {
	matchesServiceCategory,
	sumDepositsByCategory,
	categorizeDepositTotals,
	categorizeJunketExpenseTotals
};
