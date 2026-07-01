var SERVICE_CATEGORY_LEGACY_LABELS = {
	fnb: 'F & B',
	hotel: 'Hotel',
	delivery: 'Delivery',
	incidental: 'Incidental'
};

function escapeServiceCategoryOption(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function normalizeServiceCategoryLabel(value) {
	var raw = String(value || '').trim();
	if (!raw) return '';
	return SERVICE_CATEGORY_LEGACY_LABELS[raw.toLowerCase()] || raw;
}

function matchesServiceCategory(serviceType, category) {
	var raw = String(serviceType || '').trim().toLowerCase();
	if (!raw || !category) return false;

	switch (String(category).toLowerCase()) {
		case 'fnb':
			if (raw === 'fnb' || raw === 'f & b') return true;
			var compact = raw.replace(/\s+/g, '').replace(/&/g, '');
			return compact === 'fb' || compact === 'fnb' || raw.indexOf('f&b') !== -1 || raw.indexOf('f & b') !== -1;
		case 'hotel':
			return raw === 'hotel' || raw.indexOf('hotel') !== -1;
		case 'delivery':
			if (raw === 'incidental' || raw.indexOf('incidental') !== -1) return false;
			return raw === 'delivery' || raw.indexOf('delivery') !== -1;
		case 'incidental':
			return raw === 'incidental' || raw.indexOf('incidental') !== -1;
		default:
			return raw.indexOf(String(category).toLowerCase()) !== -1;
	}
}

function populateServiceCategorySelect($select, selectedValue) {
	if (!$select || !$select.length) {
		return Promise.resolve();
	}

	var placeholder = $select.attr('data-placeholder') || 'Select service';
	var selected = normalizeServiceCategoryLabel(selectedValue || '');

	return fetch('/services_category_data')
		.then(function (res) {
			if (!res.ok) throw new Error('Failed to load service categories');
			return res.json();
		})
		.then(function (rows) {
			var html = '<option value="" disabled' + (selected ? '' : ' selected') + '>' +
				escapeServiceCategoryOption(placeholder) + '</option>';
			var hasSelected = false;

			(rows || []).forEach(function (row) {
				var category = String(row.CATEGORY || '').trim();
				if (!category) return;
				var isSelected = selected && selected.toLowerCase() === category.toLowerCase();
				if (isSelected) hasSelected = true;
				html += '<option value="' + escapeServiceCategoryOption(category) + '"' +
					(isSelected ? ' selected' : '') + '>' +
					escapeServiceCategoryOption(category) + '</option>';
			});

			if (selected && !hasSelected) {
				html += '<option value="' + escapeServiceCategoryOption(selected) + '" selected>' +
					escapeServiceCategoryOption(selected) + ' (legacy)</option>';
			}

			$select.html(html);
		})
		.catch(function (err) {
			console.error('Error loading service categories:', err);
			$select.html(
				'<option value="" selected disabled>' + escapeServiceCategoryOption(placeholder) + '</option>'
			);
		});
}

window.populateServiceCategorySelect = populateServiceCategorySelect;
window.populateFnbHotelServiceTypeSelect = populateServiceCategorySelect;
window.matchesServiceCategory = matchesServiceCategory;

window.refreshServiceCategorySelects = function () {
	var newVal = $('#new-services-type').val() || '';
	var editVal = $('#edit-services-type').val() || '';
	return Promise.all([
		populateServiceCategorySelect($('#new-services-type'), newVal),
		populateServiceCategorySelect($('#edit-services-type'), editVal)
	]);
};

window.refreshFnbHotelServiceTypeSelects = window.refreshServiceCategorySelects;
