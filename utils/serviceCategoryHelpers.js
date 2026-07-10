const LEGACY_DASHBOARD_KEYS = {
	'f & b': 'fnb',
	fnb: 'fnb',
	hotel: 'hotel',
	delivery: 'delivery',
	incidental: 'incidental'
};

const LEGACY_MODAL_IDS = {
	fnb: 'modal-dash-fnb',
	hotel: 'modal-dash-hotel',
	delivery: 'modal-dash-delivery',
	incidental: 'modal-dash-incidental'
};

function serviceCategoryDashboardKey(category) {
	const raw = String(category || '').trim().toLowerCase();
	if (!raw) return '';
	return LEGACY_DASHBOARD_KEYS[raw] || raw;
}

async function fetchActiveServiceCategories(pool) {
	const [rows] = await pool.execute(
		'SELECT IDNo, CATEGORY FROM services_category WHERE ACTIVE = 1 ORDER BY CATEGORY ASC'
	);

	return (rows || [])
		.map((row) => {
			const label = String(row.CATEGORY || '').trim();
			if (!label) return null;
			return {
				id: row.IDNo,
				label,
				key: serviceCategoryDashboardKey(label),
				modalId: null
			};
		})
		.filter(Boolean)
		.map((cat) => ({
			...cat,
			modalId: LEGACY_MODAL_IDS[cat.key] || 'modal-dash-service-category'
		}));
}

module.exports = {
	LEGACY_DASHBOARD_KEYS,
	LEGACY_MODAL_IDS,
	serviceCategoryDashboardKey,
	fetchActiveServiceCategories
};
