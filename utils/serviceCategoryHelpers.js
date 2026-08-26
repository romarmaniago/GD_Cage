const LEGACY_DASHBOARD_KEYS = {
	'f & b': 'fnb',
	fnb: 'fnb',
	hotel: 'hotel',
	delivery: 'delivery',
	incidental: 'incidental'
};

const LEGACY_SERVICE_TYPE_TO_CATEGORY = {
	fnb: 'F & B',
	hotel: 'Hotel',
	delivery: 'Delivery',
	incidental: 'Incidental'
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

/**
 * Resolve a submitted service type to the canonical CATEGORY from services_category.
 * Accepts exact active labels and legacy keys (fnb, hotel, etc.).
 * @returns {Promise<string|null>} Active category label, or null if invalid/inactive.
 */
async function resolveActiveServiceCategory(pool, serviceType) {
	const raw = String(serviceType || '').trim();
	if (!raw) return null;

	const [rows] = await pool.execute(
		'SELECT CATEGORY FROM services_category WHERE ACTIVE = 1 AND LOWER(TRIM(CATEGORY)) = LOWER(TRIM(?)) LIMIT 1',
		[raw]
	);
	if (rows.length) return rows[0].CATEGORY;

	const legacyName = LEGACY_SERVICE_TYPE_TO_CATEGORY[raw.toLowerCase()];
	if (!legacyName) return null;

	const [legacyRows] = await pool.execute(
		'SELECT CATEGORY FROM services_category WHERE ACTIVE = 1 AND LOWER(TRIM(CATEGORY)) = LOWER(TRIM(?)) LIMIT 1',
		[legacyName]
	);
	return legacyRows[0]?.CATEGORY || null;
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
	LEGACY_SERVICE_TYPE_TO_CATEGORY,
	LEGACY_MODAL_IDS,
	serviceCategoryDashboardKey,
	resolveActiveServiceCategory,
	fetchActiveServiceCategories
};
