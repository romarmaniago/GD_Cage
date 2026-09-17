var game_group_id;
var DEFAULT_GAME_GROUP_NAME = 'main';

function escapeGameGroupInline(value) {
	if (value === undefined || value === null) return '';
	return value.toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isDefaultGameGroupName(name) {
	return String(name || '').trim().toLowerCase() === DEFAULT_GAME_GROUP_NAME;
}

var gameGroupDataTable;

function reloadGameGroupData() {
	if (!gameGroupDataTable) return;
	$.ajax({
		url: '/game_group_data',
		method: 'GET',
		success: function (data) {
			gameGroupDataTable.clear();
			(data || []).forEach(function (row) {
				var escapedName = escapeGameGroupInline(row.NAME);
				var btn;
				if (isDefaultGameGroupName(row.NAME)) {
					btn = '<span class="game-group-default-label">Default</span>';
				} else {
					btn = '<div class="btn-group">' +
						'<button type="button" onclick="editGameGroup(' + row.IDNo + ', \'' + escapedName + '\')" class="btn btn-sm btn-alt-secondary js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">' +
						'<i class="fa fa-pencil-alt"></i></button>' +
						'<button type="button" onclick="archiveGameGroup(' + row.IDNo + ')" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Delete" data-bs-original-title="Delete">' +
						'<i class="fa fa-trash-alt"></i></button></div>';
				}
				gameGroupDataTable.row.add([row.NAME, btn]).draw();
			});
			refreshAssignGameGroupSelectIfOpen();
		},
		error: function (xhr, status, error) {
			console.error('Error fetching game group data:', error);
		}
	});
}

function refreshAssignGameGroupSelectIfOpen() {
	var $assignModal = $('#modal-assign-game-group');
	if (!$assignModal.length || !$assignModal.hasClass('show')) return;
	var $select = $('#assign_game_group_select');
	var currentVal = $select.val();
	if (typeof window.loadAssignGameGroupSelect === 'function') {
		window.loadAssignGameGroupSelect(currentVal || null);
	}
}

function initGameGroupDataTable() {
	if (!$('#game-group-tbl').length) return;
	if ($.fn.DataTable.isDataTable('#game-group-tbl')) {
		$('#game-group-tbl').DataTable().destroy();
	}

	gameGroupDataTable = $('#game-group-tbl').DataTable({
		searching: false,
		lengthChange: false,
		info: false,
		paging: false,
		ordering: false,
		columnDefs: [{
			createdCell: function (cell) {
				$(cell).addClass('text-center');
			},
			targets: [1]
		}]
	});

	reloadGameGroupData();
}

function openGameGroupManageModal() {
	var $modal = $('#modal-manage-game-groups');
	if (!$modal.length) return;
	$modal.appendTo('body');
	var modal = bootstrap.Modal.getOrCreateInstance($modal[0]);
	modal.show();
}

$(document).ready(function () {
	$('#modal-manage-game-groups').on('shown.bs.modal', function () {
		initGameGroupDataTable();
	});

	$('#add_game_group').on('submit', function (event) {
		event.preventDefault();
		var formData = $(this).serialize();
		$.ajax({
			url: '/add_game_group',
			type: 'POST',
			data: formData,
			success: function () {
				$('#modal-new-game-group').modal('hide');
				$('#add_game_group')[0].reset();
				reloadGameGroupData();
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Error adding group';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		});
	});

	$('#edit_game_group').on('submit', function (event) {
		event.preventDefault();
		var formData = $(this).serialize();
		$.ajax({
			url: '/game_group/' + game_group_id,
			type: 'PUT',
			data: formData,
			success: function () {
				$('#modal-edit-game-group').modal('hide');
				reloadGameGroupData();
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Error updating group';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		});
	});
});

function addGameGroup() {
	var $modal = $('#modal-new-game-group').appendTo('body');
	$modal.modal('show');
}

function editGameGroup(id, name) {
	var $modal = $('#modal-edit-game-group').appendTo('body');
	$('#txtGameGroupName').val(name || '');
	game_group_id = id;
	$modal.modal('show');
}

function archiveGameGroup(id) {
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
			url: '/game_group/remove/' + id,
			type: 'PUT',
			success: function () {
				reloadGameGroupData();
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Error deleting group';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		});
	});
}
