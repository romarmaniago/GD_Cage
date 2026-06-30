var capital_category_id;

$(document).ready(function () {
    if ($.fn.DataTable.isDataTable('#capital-category-tbl')) {
        $('#capital-category-tbl').DataTable().destroy();
    }

    var dataTable = $('#capital-category-tbl').DataTable({
        columnDefs: [
            {
              createdCell: function(cell, cellData, rowData, rowIndex, colIndex) {
                  $(cell).addClass('text-center');
              }
            }
        ]
    });

    function reloadData() {
        $.ajax({
            url: '/capital_category_data',
            method: 'GET',
            success: function (data) {
                dataTable.clear();
                data.forEach(function (row) {
                    var status = '';
                    if (row.ACTIVE == 1) {
                        status = '<span class="badge bg-info">ACTIVE</span>';
                    } else {
                        status = '<span class="badge bg-danger">INACTIVE</span>';
                    }
                    var btn = `<div class="btn-group">
                        <button type="button" onclick="editCapitalCategory(${row.IDNo}, '${row.CATEGORY}')" class="btn btn-sm btn-alt-secondary js-bs-tooltip-enabled"
                        data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
                        <i class="fa fa-pencil-alt"></i>
                        </button>
                        <button type="button" onclick="archive_category(${row.IDNo})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
                        data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
                        <i class="fa fa-trash-alt"></i>
                        </button>
                    </div>`;

                    dataTable.row.add([row.CATEGORY, status, btn]).draw();
                });
            },
            error: function (xhr, status, error) {
                console.error('Error fetching data:', error);
            }
        });
    }

    reloadData();

    $('#edit_capital_category').submit(function(event) {
        event.preventDefault(); 
  
        var formData = $(this).serialize();
        $.ajax({
            url: '/capital_category/' + capital_category_id,
            type: 'PUT',
            data: formData,
            success: function(response) {
                reloadData();
                $('#modal-edit-capital-category').modal('hide');
            },
            error: function(error) {
                console.error('Error updating user role:', error);
            }
        });
    });
});


function addCapitalCategory() {
    $('#modal-new-capital-category').modal('show');
}

function editCapitalCategory(id, category ) {
    $('#modal-edit-capital-category').modal('show');
    $('#txtCategory').val(category);
  
    capital_category_id = id;
}

function archive_category(id){
    SwalConfirm.fire({
      title: 'Are you sure you want to delete this?',
      confirmButtonText: 'Yes'
  }).then((result) => {
      if (result.isConfirmed) {
        $.ajax({
          url: '/capital_category/remove/' + id,
          type: 'PUT',
          success: function(response) {
            window.location.reload();
          },
          error: function(error) {
              console.error('Error deleting category:', error);
          }
      });
      }
  })
  }
  