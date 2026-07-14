var role_id;

$(document).ready(function() {
    if ($.fn.DataTable.isDataTable('#userRoleTable')) {
        $('#userRoleTable').DataTable().destroy();
    }

    var dataTable = $('#userRoleTable').DataTable({
        columnDefs: [
            {
              createdCell: function(cell, cellData, rowData, rowIndex, colIndex) {
                  $(cell).addClass('text-center');
              }
            }
        ],
        language: {
            search: "",
            searchPlaceholder: (window.userRolesTranslations?.search || "Search").replace(/\s*:?\s*$/, "") + "...",
            info: (window.userRolesTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
            paginate: {
                previous: (window.userRolesTranslations?.previous || "Previous"),
                next: (window.userRolesTranslations?.next || "Next")
            }
        }
    });

    function reloadData() {
      $.ajax({
        url: '/user_role_data', // Endpoint to fetch data
        method: 'GET',
        success: function(data) {
          dataTable.clear();
          data.forEach(function(row) {

            var status = '';
            var activeText = window.userRolesTranslations?.active || 'ACTIVE';
            var inactiveText = window.userRolesTranslations?.inactive || 'INACTIVE';
            if (row.ACTIVE.data[0] == 1) {
                status = '<span class="css-blue">' + activeText + '</span>';
            } else {
                status = '<span class="css-red">' + inactiveText + '</span>';
            }
                // WITH DELETE FUNCTION ACTION
            var btn = `<div class="btn-group">
            <button type="button" onclick="edit_role(${row.IDNo}, '${row.ROLE}')" class="btn btn-sm bg-info-subtle js-bs-tooltip-enabled"
              data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
              <i class="fa fa-pencil-alt"></i>
            </button>
            <button type="button" onclick="archive_role(${row.IDNo})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
              data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
              <i class="fa fa-trash-alt"></i>
            </button>
          </div>`;
                
        //         // WITHOUT DELETE FUNCTION ACTION
        // var btn = `<div class="btn-group">
        //     <button type="button" onclick="edit_role(${row.IDNo}, '${row.ROLE}')" class="btn btn-sm bg-info-subtle js-bs-tooltip-enabled"
        //       data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
        //       <i class="fa fa-pencil-alt"></i>
        //     </button>
        //   </div>`;

            dataTable.row.add([row.ROLE,status,btn]).draw();
          });
          if (window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly()) {
            window.PermissionViewOnly.disableForViewOnly('#userRoleTable .btn-alt-danger');
            window.PermissionViewOnly.disableForViewOnly('#userRoleTable .btn.bg-info-subtle');
          }
        },
        error: function(xhr, status, error) {
          console.error('Error fetching data:', error);
        }
      });
    }

    reloadData();

  
    $('#update_role').submit(function(event) {
      event.preventDefault(); 

      var formData = $(this).serialize();
      $.ajax({
          url: '/user_role/' + role_id,
          type: 'PUT',
          data: formData,
          success: function(response) {
              reloadData();
              $('#modal-edit_user_role').modal('hide');
          },
          error: function(error) {
              console.error('Error updating user role:', error);
          }
      });
  });

});

function edit_role(id, role) {
  $('#modal-edit_user_role').modal('show');
  $('#role').val(role);
  role_id = id;
}

function archive_role(id){
  SwalConfirm.fire({
    title: 'Are you sure you want to delete this?',
    confirmButtonText: 'Yes'
}).then((result) => {
    if (result.isConfirmed) {
      $.ajax({
        url: '/user_role/remove/' + id,
        type: 'PUT',
        success: function(response) {
          window.location.reload();
        },
        error: function(error) {
            console.error('Error deleting user role:', error);
        }
    });
    }
})
}