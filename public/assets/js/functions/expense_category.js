
var expense_category_id;

function isMainExpenseCategory(row) {
    if (!row) return false;
    var p = row.PARENT_ID;
    return p == null || p === '' || Number(p) === 0;
}

function populateParentSelects(rows, selectedParentId, excludeId) {
    var mains = (rows || []).filter(function (r) {
        return isMainExpenseCategory(r) && String(r.IDNo) !== String(excludeId || '');
    });
    var options = '<option value="">— Main category (no parent) —</option>';
    mains.forEach(function (m) {
        var sel = selectedParentId != null && String(selectedParentId) === String(m.IDNo) ? ' selected' : '';
        options +=
            '<option value="' + m.IDNo + '"' + sel + '>' + (m.CATEGORY || '') + '</option>';
    });
    $('#txtParentNew, #txtParentEdit').html(options);
}

$(document).ready(function () {
    if ($.fn.DataTable.isDataTable('#expense-category-tbl')) {
        $('#expense-category-tbl').DataTable().destroy();
    }

    var dataTable = $('#expense-category-tbl').DataTable({
        columnDefs: [
            {
              createdCell: function(cell, cellData, rowData, rowIndex, colIndex) {
                  $(cell).addClass('text-center');
              }
            }
        ],
        language: {
            search: (window.expenseCategoryTranslations?.search || "Search:"),
            info: (window.expenseCategoryTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
            paginate: {
                previous: (window.expenseCategoryTranslations?.previous || "Previous"),
                next: (window.expenseCategoryTranslations?.next || "Next")
            }
        }
    });

    const goodsLabel = window.expenseCategoryTranslations?.goods_label || 'Goods / Consumables';
    const nonGoodsLabel = window.expenseCategoryTranslations?.non_goods_label || 'Non-goods / Services';
    const escapeForInline = (value) => {
        if (value === undefined || value === null) return '';
        return value.toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    };

    function reloadData() {
        $.ajax({
            url: '/expense_category_data',
            method: 'GET',
            success: function (data) {
                window.expenseCategoryRowsCache = data || [];
                populateParentSelects(data);
                dataTable.clear();
                data.forEach(function (row) {
                    var status = '';
                    var activeText = window.expenseCategoryTranslations?.active || 'ACTIVE';
                    var inactiveText = window.expenseCategoryTranslations?.inactive || 'INACTIVE';
                    if (row.ACTIVE == 1) {
                        status = '<span class="css-blue">' + activeText + '</span>';
                    } else {
                        status = '<span class="css-red">' + inactiveText + '</span>';
                    }
                    const parsedType = parseInt(row.TYPE, 10);
                    const typeValue = isNaN(parsedType) ? 1 : parsedType;
                    let typeLabel = goodsLabel;
                    if (typeValue === 2) {
                        typeLabel = nonGoodsLabel;
                    }
                    const escapedCategory = escapeForInline(row.CATEGORY);
                    const escapedType = escapeForInline(typeValue);
                    var parentLabel = '—';
                    if (row.PARENT_ID != null && row.PARENT_ID !== '' && Number(row.PARENT_ID) !== 0) {
                        var parentRow = (data || []).find(function (p) {
                            return String(p.IDNo) === String(row.PARENT_ID);
                        });
                        parentLabel = parentRow ? parentRow.CATEGORY : 'ID ' + row.PARENT_ID;
                    }
                    var btn = `<div class="btn-group">
                        <button type="button" onclick="editCreditStatus(${row.IDNo}, '${escapedCategory}', '${escapedType}', ${row.PARENT_ID != null && row.PARENT_ID !== '' ? row.PARENT_ID : 'null'})" class="btn btn-sm btn-alt-secondary js-bs-tooltip-enabled"
                        data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
                        <i class="fa fa-pencil-alt"></i>
                        </button>
                        <button type="button" onclick="archive_category(${row.IDNo})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
                        data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
                        <i class="fa fa-trash-alt"></i>
                        </button>
                    </div>`;

                    dataTable.row.add([row.CATEGORY, parentLabel, typeLabel, status, btn]).draw();
                });
                if (window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly()) {
                    window.PermissionViewOnly.disableForViewOnly('#expense-category-tbl .btn-alt-danger');
                    window.PermissionViewOnly.disableForViewOnly('#expense-category-tbl .btn-alt-secondary');
                }
            },
            error: function (xhr, status, error) {
                console.error('Error fetching data:', error);
            }
        });
    }

    reloadData();

    $('#edit_expense_category').submit(function(event) {
        event.preventDefault(); 
  
        var formData = $(this).serialize();
        $.ajax({
            url: '/expense_category/' + expense_category_id,
            type: 'PUT',
            data: formData,
            success: function(response) {
                reloadData();
                $('#modal-edit-expense-category').modal('hide');
            },
            error: function(error) {
                console.error('Error updating user role:', error);
            }
        });
    });
});


function addExpenseCategory() {
    if (window.expenseCategoryRowsCache) {
        populateParentSelects(window.expenseCategoryRowsCache, null, null);
    }
    $('#txtParentNew').val('');
    $('#modal-new-expense-category').modal('show');
}

function editCreditStatus(id, category, typeValue, parentId) {
    if (window.expenseCategoryRowsCache) {
        populateParentSelects(window.expenseCategoryRowsCache, parentId, id);
    }
    $('#modal-edit-expense-category').modal('show');
    $('#txtCategory').val(category);
    $('#txtType').val(typeValue || '1');
    $('#txtParentEdit').val(parentId != null && parentId !== '' && parentId !== 'null' ? String(parentId) : '');
    expense_category_id = id;
}

function archive_category(id){
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
          url: '/expense_category/remove/' + id,
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
  
