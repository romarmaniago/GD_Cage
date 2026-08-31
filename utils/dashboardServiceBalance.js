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
		default: {
			const cat = String(category || '').trim().toLowerCase();
			return raw === cat;
		}
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

function sumCategoryAcrossRowSets(rowSets, category) {
	return (rowSets || []).reduce(
		(total, rows) => total + sumDepositsByCategory(rows || [], category),
		0
	);
}

function signedCategoryBalance(junketCashRows, junketDepositRows, guestCashRows, guestDepositRows, category) {
	const guestIn = sumCategoryAcrossRowSets([guestCashRows, guestDepositRows], category);
	// JUNKET service rows are a company outflow. Newer entries store AMOUNT as a
	// negative value; legacy rows stored it positive. Normalise each set to a
	// magnitude so the outflow always subtracts from the balance regardless of sign.
	const junketOut =
		Math.abs(sumDepositsByCategory(junketCashRows, category)) +
		Math.abs(sumDepositsByCategory(junketDepositRows, category));
	return guestIn - junketOut;
}

function categorizeSignedServiceTotals(junketCashRows, junketDepositRows, guestCashRows, guestDepositRows) {
	return {
		fnb: signedCategoryBalance(junketCashRows, junketDepositRows, guestCashRows, guestDepositRows, 'fnb'),
		hotel: signedCategoryBalance(junketCashRows, junketDepositRows, guestCashRows, guestDepositRows, 'hotel'),
		delivery: signedCategoryBalance(junketCashRows, junketDepositRows, guestCashRows, guestDepositRows, 'delivery'),
		incidental: signedCategoryBalance(junketCashRows, junketDepositRows, guestCashRows, guestDepositRows, 'incidental')
	};
}

function categorizeDisplayExpenseTotals(junketCashRows, junketDepositRows, guestCashRows, guestDepositRows) {
	return categorizeSignedServiceTotals(junketCashRows, junketDepositRows, guestCashRows, guestDepositRows);
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

function buildDashboardServiceCategoryBalances(categories, junketCashRows, junketDepositRows, guestCashRows, guestDepositRows) {
	return (categories || []).map((cat) => {
		const key = cat && cat.key != null ? cat.key : cat;
		const label = cat && cat.label != null ? cat.label : String(key || '');
		return {
			id: cat && cat.id != null ? cat.id : null,
			key,
			label,
			modalId: cat && cat.modalId ? cat.modalId : null,
			balance: signedCategoryBalance(
				junketCashRows,
				junketDepositRows,
				guestCashRows,
				guestDepositRows,
				key
			),
			junketOut: sumCategoryAcrossRowSets([junketCashRows, junketDepositRows], key)
		};
	});
}

function buildDashboardServiceExpensePayload(categories, junketCashRows, junketDepositRows, guestCashRows, guestDepositRows) {
	const rows = buildDashboardServiceCategoryBalances(
		categories,
		junketCashRows,
		junketDepositRows,
		guestCashRows,
		guestDepositRows
	);
	const legacy = categorizeDisplayExpenseTotals(
		junketCashRows,
		junketDepositRows,
		guestCashRows,
		guestDepositRows
	);
	const junketOutTotal = rows.reduce((sum, cat) => sum + (Number(cat.junketOut) || 0), 0);

	return {
		categories: rows,
		junketOutTotal,
		...legacy
	};
}

module.exports = {
	matchesServiceCategory,
	sumDepositsByCategory,
	categorizeDepositTotals,
	categorizeJunketExpenseTotals,
	categorizeDisplayExpenseTotals,
	categorizeSignedServiceTotals,
	buildDashboardServiceCategoryBalances,
	buildDashboardServiceExpensePayload
};
