var user_id;

$(document).ready(function () {
	if ($.fn.DataTable.isDataTable('#usersTable')) {
		$('#usersTable').DataTable().destroy();
	}

	var dataTable = $('#usersTable').DataTable({
		columnDefs: [{
			createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
				$(cell).addClass('text-center');
			}
		}],
		language: {
			search: (window.manageUsersTranslations?.search || "Search:"),
			info: (window.manageUsersTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
			paginate: {
				previous: (window.manageUsersTranslations?.previous || "Previous"),
				next: (window.manageUsersTranslations?.next || "Next")
			}
		}
	});

	function reloadData() {
		$.ajax({
			url: '/users', // Endpoint to fetch data
			method: 'GET',
			success: function (data) {
				dataTable.clear();
				data.forEach(function (row) {

					// ONLINE / OFFLINE based on USER_STATUS (1 = online, 0 = offline)
					var status = '';
					if (row.USER_STATUS === 1 || row.USER_STATUS === '1') {
						status = '<span class="css-online">ONLINE</span>';
					} else {
						status = '<span class="css-offline">OFFLINE</span>';
					}

					var isSuperAdmin = row.PERMISSIONS === 0 || row.PERMISSIONS === '0';
					var deleteBtn = isSuperAdmin ? '' : `<button type="button" class="btn btn-sm bg-danger-subtle js-bs-tooltip-enabled" onclick="archive_user(${row.user_id})"
              data-bs-toggle="tooltip" aria-label="Delete" data-bs-original-title="Delete">
              <i class="fa fa-trash"></i>
            </button>`;

					var btn = `<div class="btn-group">
              ${deleteBtn}
            <button type="button" class="btn btn-sm bg-info-subtle js-bs-tooltip-enabled" onclick="edit_user(${row.user_id}, '${row.FIRSTNAME}', '${row.LASTNAME}', '${row.USERNAME}', ${row.PERMISSIONS})"
              data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
              <i class="fa fa-pencil-alt"></i>
            </button>
            <button type="button" class="btn btn-sm bg-warning-subtle js-bs-tooltip-enabled" onclick="change_password(${row.user_id}, '${row.USERNAME}')"
              data-bs-toggle="tooltip" aria-label="Change Password" data-bs-original-title="Change Password">
              <i class="fa fa-key"></i>
            </button>
          </div>`;

					dataTable.row.add([row.LASTNAME, row.FIRSTNAME, row.USERNAME, row.role, status, btn]).draw();
				});
				// View-only: disable delete and edit buttons after table is populated
				if (window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly()) {
					window.PermissionViewOnly.disableForViewOnly('#usersTable .btn.bg-danger-subtle');
					window.PermissionViewOnly.disableForViewOnly('#usersTable .btn.bg-info-subtle');
					window.PermissionViewOnly.disableForViewOnly('#usersTable .btn.bg-warning-subtle');
				}
			},
			error: function (xhr, status, error) {
				console.error('Error fetching data:', error);
			}
		});
	}

	reloadData();


	$('#edit_user').submit(function (event) {
		event.preventDefault();

		var formData = $(this).serialize();
		var $btn = $(this).find('button[type="submit"]');
		$btn.prop('disabled', true);

		$.ajax({
			url: '/user/' + user_id,
			type: 'PUT',
			data: formData,
			success: function (response) {
				reloadData();
				$('#modal-edit_user').modal('hide');
				Swal.fire({
					icon: 'success',
					title: 'Successfully',
					text: 'User updated successfully.'
				});
			},
			error: function (xhr) {
				Swal.fire({
					icon: 'error',
					title: 'Error',
					text: 'Failed to update user. Please try again.'
				});
				console.error('Error updating user:', xhr);
			},
			complete: function () {
				$btn.prop('disabled', false);
			}
		});
	});

	function submitChangePassword() {
		var pwd = $('#change_password_new').val();
		var pwd2 = $('#change_password_confirm').val();

		if (!user_id) {
			Swal.fire({ icon: 'error', title: 'Error', text: 'No user selected.' });
			return;
		}
		if (!pwd || !pwd2) {
			Swal.fire({ icon: 'warning', title: 'Required', text: 'Please fill in both password fields.' });
			return;
		}
		if (pwd !== pwd2) {
			Swal.fire({ icon: 'error', title: 'Oops...', text: 'Password not match!' });
			return;
		}

		var $btn = $('#btn_save_change_password');
		$btn.prop('disabled', true);

		$.ajax({
			url: '/user/password/' + user_id,
			type: 'PUT',
			data: {
				txtPassword: pwd,
				txtPassword2: pwd2
			},
			success: function () {
				$('#modal-change_password').modal('hide');
				$('#form_change_password')[0].reset();
				Swal.fire({
					icon: 'success',
					title: 'Successfully',
					text: 'Password changed successfully.'
				});
			},
			error: function (xhr) {
				var errorMessage = xhr.responseJSON && xhr.responseJSON.error;
				if (errorMessage === 'password') {
					Swal.fire({ icon: 'error', title: 'Oops...', text: 'Password not match!' });
				} else {
					Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to change password. Please try again.' });
				}
			},
			complete: function () {
				$btn.prop('disabled', false);
			}
		});
	}

	$('#form_change_password').on('submit', function (event) {
		event.preventDefault();
		submitChangePassword();
	});

	$('#btn_save_change_password').on('click', submitChangePassword);

	$('#add_new_user').submit(function (event) {
		event.preventDefault();

		const salt = generateSalt(50);
		var formData = $(this).serialize();
		formData += '&salt=' + salt;

		$.ajax({
			url: '/add_user',
			type: 'POST',
			data: formData,
			// processData: false, 
			// contentType: false,
			success: function (response) {
				reloadData();
				$('#modal-new_user').modal('hide');
				Swal.fire({
					icon: "success",
					title: "Successfully",
					text: "User added successfully."
				});
			},
			error: function (xhr, status, error) {
				var errorMessage = xhr.responseJSON && xhr.responseJSON.error;
				if (errorMessage == 'password') {
					Swal.fire({
						icon: "error",
						title: "Oops...",
						text: "Password not match!",
					});
				} else if (errorMessage == 'username_exists') {
					Swal.fire({
						icon: "error",
						title: "Username taken",
						text: "This username already exists. Please choose another.",
					});
				} else {
					console.error('Error adding user:', error);
				}
			}
		});
		// }
	});

});

function generateSalt(length) {
	const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let salt = '';
	for (let i = 0; i < length; i++) {
		salt += charset.charAt(Math.floor(Math.random() * charset.length));
	}

	return salt;
}

function change_password(id, username) {
	$('#modal-change_password').modal('show');
	$('#change_password_username').text(username);
	$('#form_change_password')[0].reset();
	user_id = id;
}

function edit_user(id, firstname, lastname, username, role) {
	$('#modal-edit_user').modal('show');

	get_user_role_edit(role);

	$('#firstname').val(firstname);
	$('#lastname').val(lastname);
	$('#username').val(username);
	user_id = id;

}

function archive_user(id) {
	Swal.fire({
		title: 'Are you sure you want to delete this?',
		icon: 'warning',
		showCancelButton: true,
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		confirmButtonText: 'Yes'
	}).then((result) => {
		if (result.isConfirmed) {
			$.ajax({
				url: '/user/remove/' + id,
				type: 'PUT',
				success: function (response) {
					window.location.reload();
				},
				error: function (error) {
					console.error('Error deleting user role:', error);
				}
			});
		}
	});
}

function get_user_role() {
	$.ajax({
		url: '/user_role_data',
		method: 'GET',
		success: function (response) {
			var selectOptions = $('#user_role');
			selectOptions.empty();
			response.forEach(function (option) {
				selectOptions.append($('<option>', {
					value: option.IDNo,
					text: option.ROLE
				}));
			});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

function get_user_role_edit(id) {
	$.ajax({
		url: '/user_role_data',
		method: 'GET',
		success: function (response) {
			var selectOptionsEdit = $('.edit_user_role');
			selectOptionsEdit.empty();
			selectOptionsEdit.append($('<option>', {
				selected: id == 0,
				value: 0,
				text: 'SuperAdmin'
			}));
			response.forEach(function (option) {
				var selected = false;
				if (option.IDNo == id) {
					selected = true;
				}
				selectOptionsEdit.append($('<option>', {
					selected: selected,
					value: option.IDNo,
					text: option.ROLE
				}));
			});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

function add_user_modal() {
	$('#modal-new_user').modal('show');
	get_user_role();
}