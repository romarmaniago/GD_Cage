var concierge_id;

$(document).ready(function() {
    if ($.fn.DataTable.isDataTable('#concierge-tbl')) {
        $('#concierge-tbl').DataTable().destroy();
    }

    var dataTable = $('#concierge-tbl').DataTable({
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
        url: '/junket_concierge_data', // Endpoint to fetch data
        method: 'GET',
        success: function(data) {
          dataTable.clear();

          var total_in = 0;
          var total_out = 0;

          data.forEach(function(row) {

            if(row.TRANSACTION_ID == '1') {
              total_in = total_in + row.AMOUNT;
            }
  
            if(row.TRANSACTION_ID == '2') {
              total_out = total_out + row.AMOUNT;
            }


            var status = '';
            if (row.ACTIVE == 1) {
                status = '<span class="badge bg-info">ACTIVE</span>';
            } else {
                status = '<span class="badge bg-danger">INACTIVE</span>';
            }

            var btn = `<div class="btn-group">
            <button type="button" onclick="edit_concierge(${row.junket_concierge_id}, '${row.CONCIERGE_ID}', '${row.TRANSACTION_ID}', '${row.DATE_TIME}', '${row.DESCRIPTION}', '${row.AMOUNT}' )" class="btn btn-sm btn-alt-secondary js-bs-tooltip-enabled"
              data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
              <i class="fa fa-pencil-alt"></i>
            </button>
            <button type="button" onclick="archive_concierge(${row.junket_concierge_id})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
              data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
              <i class="fa fa-trash-alt"></i>
            </button>
          </div>`;

            var amountCell = parseInt(row.TRANSACTION_ID, 10) === 2
              ? (window.fmtOut ? window.fmtOut(row.AMOUNT) : row.AMOUNT)
              : (window.fmtAmt ? window.fmtAmt(row.AMOUNT) : Number(row.AMOUNT || 0).toLocaleString('en-US'));
            dataTable.row.add([`${moment(row.DATE_TIME).format('YYYY-MM-DD')}`, `${row.CATEGORY}`, `${row.DESCRIPTION}`, `${row.TRANSACTION}`, amountCell, status, btn]).draw();
          });

          $('.total_deposit').text(`P${total_in.toLocaleString('en-US')}`);
          $('.total_withdraw').text(`P${total_out.toLocaleString('en-US')}`);
          $('.total_balance').text('P'+(total_in - total_out).toLocaleString('en-US'));
        },
        error: function(xhr, status, error) {
          console.error('Error fetching data:', error);
        }
      });
    }

    reloadData();

    $('#add_junket_concierge').submit(function(event) {
      event.preventDefault(); 

      var formData = $(this).serialize();

        $.ajax({
          url: '/add_junket_concierge',
          type: 'POST',
          data: formData,
          // processData: false, 
          // contentType: false,
          success: function(response) {
              reloadData();
              $('#modal-new-concierge').modal('hide');
          },
          error: function(xhr, status, error) {
            var errorMessage = xhr.responseJSON.error;
            // if(errorMessage == 'password') {
            //   Swal.fire({
            //     icon: "error",
            //     title: "Oops...",
            //     text: "Password not match!",
            //   });
            // } else {
              console.error('Error updating user role:', error);
            // }
          }
       });
      // }
  });

  
    $('#edit_junket_concierge').submit(function(event) {
      event.preventDefault(); 

      var formData = $(this).serialize();
      $.ajax({
          url: '/junket_concierge/' + concierge_id,
          type: 'PUT',
          data: formData,
          success: function(response) {
              reloadData();
              $('#modal-edit-concierge').modal('hide');
          },
          error: function(error) {
              console.error('Error updating user role:', error);
          }
      });
  });

});


function addConcierge() {
    $('#modal-new-concierge').modal('show');
    $('.txtDateTime').val();
    $('.txtDescription').val();
    $('.txtAmount').val();
  
    concierge_data();
    get_transaction();
}

function edit_concierge(id, concierge, transaction_id, date_time, description, amount ) {
  $('#modal-edit-concierge').modal('show');
  $('.txtDateTime').val(moment(date_time).format('YYYY-MM-DD'));
  $('.txtDescription').val(description);
  $('.txtAmount').val(amount);

  concierge_id = id;

  edit_concierge_data(concierge);
  edit_get_transaction(transaction_id);
}

function archive_concierge(id){
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
        url: '/junket_concierge/remove/' + id,
        type: 'PUT',
        success: function(response) {
          window.location.reload();
        },
        error: function(error) {
            console.error('Error deleting junket:', error);
        }
    });
    }
})
}

function concierge_data() {
  $.ajax({
      url: '/concierge_category_data',
      method: 'GET',
      success: function(response) {
          var selectOptions = $('#txtCategory');
          selectOptions.empty(); 
          selectOptions.append($('<option>', {
            value: '',
            text: '--SELECT CONCIERGE CATEGORY--'
        }));
          response.forEach(function(option) {
              selectOptions.append($('<option>', {
                  value: option.IDNo,
                  text: option.CATEGORY
              }));
          });
      },
      error: function(xhr, status, error) {
          console.error('Error fetching options:', error);
      }
  });
}

function get_transaction() {
    $.ajax({
        url: '/transaction_type_data',
        method: 'GET',
        success: function(response) {
            var selectOptions = $('#txtTransaction');
            selectOptions.empty(); 
            selectOptions.append($('<option>', {
              value: '',
              text: '--SELECT TRANSACTION TYPE--'
          }));
            response.forEach(function(option) {
                selectOptions.append($('<option>', {
                    value: option.IDNo,
                    text: option.TRANSACTION 
                }));
            });
        },
        error: function(xhr, status, error) {
            console.error('Error fetching options:', error);
        }
    });
  }

function edit_concierge_data(id) {
  $.ajax({
      url: '/concierge_category_data',
      method: 'GET',
      success: function(response) {
          var selectOptions = $('.txtCategory');
          selectOptions.empty(); 
          selectOptions.append($('<option>', {
              selected: false,
              value: '',
              text: '--SELECT CONCIERGE CATEGORY--'
          }));
          response.forEach(function(option) {
              var selected = false;
              if(option.IDNo == id) {
                selected = true;
              }
              selectOptions.append($('<option>', {
                selected: selected,
                value: option.IDNo,
                text: option.CATEGORY
              }));
          });
      },
      error: function(xhr, status, error) {
          console.error('Error fetching options:', error);
      }
  });
}


function edit_get_transaction(id) {
    $.ajax({
        url: '/transaction_type_data',
        method: 'GET',
        success: function(response) {
            var selectOptions = $('.txtTransaction');
            selectOptions.empty(); 
            selectOptions.append($('<option>', {
                selected: false,
                value: '',
                text: '--SELECT TRANSACTION TYPE--'
            }));
            response.forEach(function(option) {
                var selected = false;
                if(option.IDNo == id) {
                  selected = true;
                }
                selectOptions.append($('<option>', {
                  selected: selected,
                  value: option.IDNo,
                  text: option.TRANSACTION 
                }));
            });
        },
        error: function(xhr, status, error) {
            console.error('Error fetching options:', error);
        }
    });
  }




