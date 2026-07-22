var services_category_id;

function escapeForInline(value) {
	if (value === undefined || value === null) return '';
	return value.toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

var servicesCategoryDataTable;

function refreshFnbHotelServiceTypeDropdowns() {
	if (typeof window.refreshFnbHotelCategoryUi === 'function') {
		window.refreshFnbHotelCategoryUi();
		return;
	}
	if (typeof window.refreshServiceCategorySelects === 'function') {
		window.refreshServiceCategorySelects();
	}
	if (typeof window.renderFnbHotelFilterTabs === 'function') {
		window.renderFnbHotelFilterTabs();
	}
	if (typeof window.refreshDashServiceCategoryUi === 'function') {
		window.refreshDashServiceCategoryUi();
	}
}

function reloadServicesCategoryData() {
	if (!servicesCategoryDataTable) return;
	$.ajax({
		url: '/services_category_data',
		method: 'GET',
		success: function (data) {
			servicesCategoryDataTable.clear();
			(data || []).forEach(function (row) {
				var activeText = window.servicesCategoryTranslations?.active || 'ACTIVE';
				var inactiveText = window.servicesCategoryTranslations?.inactive || 'INACTIVE';
				var status = row.ACTIVE == 1
					? '<span class="css-blue">' + activeText + '</span>'
					: '<span class="css-red">' + inactiveText + '</span>';
				var escapedCategory = escapeForInline(row.CATEGORY);
				var btn = '<div class="btn-group">' +
					'<button type="button" onclick="editServicesCategory(' + row.IDNo + ', \'' + escapedCategory + '\')" class="btn btn-sm btn-alt-secondary js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">' +
					'<i class="fa fa-pencil-alt"></i></button>' +
					'<button type="button" onclick="archiveServicesCategory(' + row.IDNo + ')" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">' +
					'<i class="fa fa-trash-alt"></i></button></div>';
				servicesCategoryDataTable.row.add([row.CATEGORY, status, btn]).draw();
			});
			refreshFnbHotelServiceTypeDropdowns();
			try {
				localStorage.setItem('dashServiceCategoriesUpdated', String(Date.now()));
			} catch (e) { /* ignore */ }
		},
		error: function (xhr, status, error) {
			console.error('Error fetching services category data:', error);
		}
	});
}

function openServicesCategoryModal() {
	var $modal = $('#modal-manage-services-category');
	if (!$modal.length) return;
	$modal.appendTo('body');
	var modal = bootstrap.Modal.getOrCreateInstance($modal[0]);
	modal.show();
}

function applyServicesCategoryControlsLayout() {
	var wrapper = document.getElementById('services-category-tbl_wrapper');
	var lengthWrap = document.getElementById('services-category-tbl_length');
	var filterWrap = document.getElementById('services-category-tbl_filter');
	var searchLabel = filterWrap ? filterWrap.querySelector('label') : null;
	var searchInput = searchLabel ? searchLabel.querySelector('input') : null;
	var addBtn = document.getElementById('btn-add-services-category');
	var controlsHighlight;
	var filterHighlight;
	var searchPlaceholder = (window.servicesCategoryTranslations && window.servicesCategoryTranslations.search)
		? String(window.servicesCategoryTranslations.search).replace(/\s*:?\s*$/, '') + '...'
		: 'Search...';

	if (!wrapper || !lengthWrap || !filterWrap || !searchLabel) return;

	controlsHighlight = wrapper.querySelector('.services-category-controls-highlight');
	if (!controlsHighlight) {
		controlsHighlight = document.createElement('div');
		controlsHighlight.className = 'services-category-controls-highlight';
		wrapper.insertBefore(controlsHighlight, wrapper.firstChild);
	}
	if (lengthWrap.parentElement !== controlsHighlight) {
		controlsHighlight.appendChild(lengthWrap);
	}
	if (filterWrap.parentElement !== controlsHighlight) {
		controlsHighlight.appendChild(filterWrap);
	}

	filterHighlight = filterWrap.querySelector('.services-category-filter-highlight');
	if (!filterHighlight) {
		filterHighlight = document.createElement('div');
		filterHighlight.className = 'services-category-filter-highlight';
		filterWrap.appendChild(filterHighlight);
	}

	if (addBtn && (addBtn.parentElement !== filterHighlight || filterHighlight.firstElementChild !== addBtn)) {
		filterHighlight.insertBefore(addBtn, filterHighlight.firstChild);
	}
	if (searchLabel.parentElement !== filterHighlight) {
		filterHighlight.appendChild(searchLabel);
	}
	if (searchInput) {
		searchInput.setAttribute('placeholder', searchPlaceholder);
		Array.prototype.slice.call(searchLabel.childNodes).forEach(function (node) {
			if (node.nodeType === 3) searchLabel.removeChild(node);
		});
	}
	if (addBtn) addBtn.classList.remove('d-none');
}

function initServicesCategoryDataTable() {
	if (!$('#services-category-tbl').length) return;
	if ($.fn.DataTable.isDataTable('#services-category-tbl')) {
		$('#services-category-tbl').DataTable().destroy();
	}

	servicesCategoryDataTable = $('#services-category-tbl').DataTable({
		columnDefs: [{
			createdCell: function (cell) {
				$(cell).addClass('text-center');
			},
			targets: [1, 2]
		}],
		language: {
			search: (window.servicesCategoryTranslations?.search || 'Search:'),
			info: (window.servicesCategoryTranslations?.showing_entries || 'Showing _START_ to _END_ of _TOTAL_ entries'),
			paginate: {
				previous: (window.servicesCategoryTranslations?.previous || 'Previous'),
				next: (window.servicesCategoryTranslations?.next || 'Next')
			}
		},
		drawCallback: function () {
			applyServicesCategoryControlsLayout();
		}
	});

	applyServicesCategoryControlsLayout();
	reloadServicesCategoryData();
}

$(document).ready(function () {
	if (!$('#services-category-tbl').length) return;

	initServicesCategoryDataTable();

	$('#modal-manage-services-category').on('shown.bs.modal', function () {
		if (servicesCategoryDataTable) {
			servicesCategoryDataTable.columns.adjust().draw(false);
		}
		applyServicesCategoryControlsLayout();
		reloadServicesCategoryData();
	});

	$('#add_services_category').on('submit', function (event) {
		event.preventDefault();
		var formData = $(this).serialize();
		$.ajax({
			url: '/add_services_category',
			type: 'POST',
			data: formData,
			success: function () {
				$('#modal-new-services-category').modal('hide');
				$('#add_services_category')[0].reset();
				reloadServicesCategoryData();
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Error adding services category';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		});
	});

	$('#edit_services_category').on('submit', function (event) {
		event.preventDefault();
		var formData = $(this).serialize();
		$.ajax({
			url: '/services_category/' + services_category_id,
			type: 'PUT',
			data: formData,
			success: function () {
				$('#modal-edit-services-category').modal('hide');
				reloadServicesCategoryData();
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Error updating services category';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		});
	});
});

function addServicesCategory() {
	var $modal = $('#modal-new-services-category').appendTo('body');
	$modal.modal('show');
}

function editServicesCategory(id, category) {
	var $modal = $('#modal-edit-services-category').appendTo('body');
	$('#txtServicesCategory').val(category || '');
	services_category_id = id;
	$modal.modal('show');
}

function archiveServicesCategory(id) {
	Swal.fire({
		title: 'Are you sure you want to delete this?',
		icon: 'warning',
		showCancelButton: true,
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		confirmButtonText: 'Yes'
	}).then(function (result) {
		if (!result.isConfirmed) return;
		$.ajax({
			url: '/services_category/remove/' + id,
			type: 'PUT',
			success: function () {
				reloadServicesCategoryData();
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Error deleting services category';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		});
	});
}
