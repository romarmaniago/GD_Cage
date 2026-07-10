var SERVICE_CATEGORY_LEGACY_LABELS = {
	fnb: 'F & B',
	hotel: 'Hotel',
	delivery: 'Delivery',
	incidental: 'Incidental'
};

function serviceCategoryFilterKey(category) {
	return String(category || '').trim().toLowerCase();
}

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
		default: {
			var cat = String(category).trim().toLowerCase();
			var normalized = normalizeServiceCategoryLabel(serviceType).toLowerCase();
			return raw === cat || normalized === cat;
		}
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
	var editVal = $('#edit-services-type-value').val() || '';
	var newVal = '';
	if ($('#new-services-type').length) {
		newVal = $('#new-services-type').val() || '';
	} else if ($('#new-services-type-value').length) {
		newVal = $('#new-services-type-value').val() || '';
	}

	var tasks = [];
	if ($('#new-services-type').length) {
		tasks.push(populateServiceCategorySelect($('#new-services-type'), newVal));
	} else if (typeof window.populateNewServiceTypeCheckboxes === 'function') {
		tasks.push(window.populateNewServiceTypeCheckboxes(newVal));
	}
	if ($('#edit-services-type').length) {
		tasks.push(populateServiceCategorySelect($('#edit-services-type'), editVal));
	} else if ($('#edit-services-type-list').length && $('#edit-services-type-value').length) {
		// Edit modal now uses radio list; values refresh on next modal open.
	}
	return Promise.all(tasks);
};

window.refreshFnbHotelServiceTypeSelects = window.refreshServiceCategorySelects;

function renderFnbHotelFilterTabs() {
	var container = document.getElementById('fnb-hotel-filter-categories');
	if (!container) return Promise.resolve(null);

	var filterRoot = document.getElementById('fnb-hotel-filter');
	var activeEl = filterRoot ? filterRoot.querySelector('.filter-link.active') : null;
	var activeFilter = activeEl ? (activeEl.getAttribute('data-filter') || 'all') : 'all';

	return fetch('/services_category_data')
		.then(function (res) {
			if (!res.ok) throw new Error('Failed to load service categories');
			return res.json();
		})
		.then(function (rows) {
			var html = '';
			var keys = [];

			(rows || []).forEach(function (row) {
				var category = String(row.CATEGORY || '').trim();
				if (!category) return;
				var key = serviceCategoryFilterKey(category);
				keys.push(key);
				var isActive = activeFilter === key;
				html += '<a href="#" class="filter-link' + (isActive ? ' active' : '') + '" data-filter="' +
					escapeServiceCategoryOption(key) + '">' +
					escapeServiceCategoryOption(category) + '</a>';
			});

			container.innerHTML = html;

			if (activeFilter !== 'all' && keys.indexOf(activeFilter) === -1) {
				activeFilter = 'all';
				if (filterRoot) {
					filterRoot.querySelectorAll('.filter-link').forEach(function (link) {
						link.classList.toggle('active', link.getAttribute('data-filter') === 'all');
					});
				}
			} else if (activeFilter !== 'all') {
				var allLink = filterRoot ? filterRoot.querySelector('.filter-link[data-filter="all"]') : null;
				if (allLink) allLink.classList.remove('active');
			}

			window.dispatchEvent(new CustomEvent('fnbHotelFilterTabsUpdated', {
				detail: { activeFilter: activeFilter }
			}));
			return activeFilter;
		})
		.catch(function (err) {
			console.error('Error loading F&B / Hotel filter tabs:', err);
			container.innerHTML = '';
			return activeFilter;
		});
}

window.renderFnbHotelFilterTabs = renderFnbHotelFilterTabs;

window.refreshFnbHotelCategoryUi = function () {
	return Promise.all([
		window.refreshServiceCategorySelects(),
		renderFnbHotelFilterTabs()
	]).then(function () {
		if (typeof window.refreshDashServiceCategoryUi === 'function') {
			return window.refreshDashServiceCategoryUi();
		}
		return null;
	});
};
