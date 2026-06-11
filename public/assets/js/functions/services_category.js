var services_category_id;

function escapeForInline(value) {
	if (value === undefined || value === null) return '';
	return value.toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

var servicesCategoryDataTable;

function refreshFnbHotelServiceTypeDropdowns() {
	if (typeof window.refreshFnbHotelServiceTypeSelects === 'function') {
		window.refreshFnbHotelServiceTypeSelects();
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
		}
	});

	reloadServicesCategoryData();
}

$(document).ready(function () {
	if (!$('#services-category-tbl').length) return;

	initServicesCategoryDataTable();

	$('#modal-manage-services-category').on('shown.bs.modal', function () {
		if (servicesCategoryDataTable) {
			servicesCategoryDataTable.columns.adjust().draw(false);
		}
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
