
var cage_id;

$(document).ready(function() {
    if ($.fn.DataTable.isDataTable('#cage-tbl')) {
        $('#cage-tbl').DataTable().destroy();
    }

    var dataTable = $('#cage-tbl').DataTable({
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
        url: '/junket_main_cage_data', // Endpoint to fetch data
        method: 'GET',
        success: function(data) {
          dataTable.clear();

          var total_deposit_buy = 0;
          var total_withdraw_buy = 0;
          var total_deposit_cash = 0;
          var total_withdraw_cash = 0;
          var total_deposit_rolling = 0;
          var total_withdraw_rolling = 0;

          data.forEach(function(row) {
            var status = '';
            if (row.ACTIVE == 1) {
                status = '<span class="badge bg-info">ACTIVE</span>';
            } else {
                status = '<span class="badge bg-danger">INACTIVE</span>';
            }

            if(row.CAGE_ID == 1 && row.TRANSACTION_ID == 1)  {
              total_deposit_buy = total_deposit_buy + row.AMOUNT;
            }

            if(row.CAGE_ID == 1 && row.TRANSACTION_ID == 2)  {
              total_withdraw_buy = total_withdraw_buy + row.AMOUNT;
            }

            if(row.CAGE_ID == 2 && row.TRANSACTION_ID == 1)  {
              total_deposit_cash = total_deposit_cash + row.AMOUNT;
            }

            if(row.CAGE_ID == 2 && row.TRANSACTION_ID == 2)  {
              total_withdraw_cash = total_withdraw_cash + row.AMOUNT;
            }

            if(row.CAGE_ID == 3 && row.TRANSACTION_ID == 1)  {
              total_deposit_rolling = total_deposit_rolling + row.AMOUNT;
            }

            if(row.CAGE_ID == 3 && row.TRANSACTION_ID == 2)  {
              total_withdraw_rolling = total_withdraw_rolling + row.AMOUNT;
            }

            var dateFormat = moment(row.DATE_TIME).format('YYYY-MM-DD');
            var dateFormatEdit = moment(row.DATE_TIME).format('YYYY-MM-DD');

            var btn = `<div class="btn-group">
            <button type="button" onclick="edit_cage(${row.junket_cage_id}, '${row.CAGE_ID}', '${dateFormatEdit}', '${row.TRANSACTION_ID}', '${row.AMOUNT}' )" class="btn btn-sm btn-alt-secondary js-bs-tooltip-enabled"
              data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
              <i class="fa fa-pencil-alt"></i>
            </button>
            <button type="button" onclick="archive_cage(${row.junket_cage_id})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
              data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
              <i class="fa fa-trash-alt"></i>
            </button>
          </div>`;

            var amountCell = parseInt(row.TRANSACTION_ID, 10) === 2
              ? (window.fmtOut ? window.fmtOut(row.AMOUNT) : row.AMOUNT)
              : (window.fmtAmt ? window.fmtAmt(row.AMOUNT) : Number(row.AMOUNT || 0).toLocaleString('en-US'));
            dataTable.row.add([`${row.CATEGORY}`, dateFormat, `${row.TRANSACTION}`, amountCell, status, btn]).draw();
          });

          $('.total_deposit_buy').text(`P${total_deposit_buy.toLocaleString('en-US')}`);
          $('.total_withdraw_buy').text(`P${total_withdraw_buy.toLocaleString('en-US')}`);
          $('.total_balance_buy').text('P'+(total_deposit_buy - total_withdraw_buy).toLocaleString('en-US'));
          $('.total_deposit_cash').text(`P${total_deposit_cash.toLocaleString('en-US')}`);
          $('.total_withdraw_cash').text(`P${total_withdraw_cash.toLocaleString('en-US')}`);
          $('.total_balance_cash').text('P'+(total_deposit_cash - total_withdraw_cash).toLocaleString('en-US'));
          $('.total_deposit_rolling').text(`P${total_deposit_rolling.toLocaleString('en-US')}`);
          $('.total_withdraw_rolling').text(`P${total_withdraw_rolling.toLocaleString('en-US')}`);
          $('.total_balance_rolling').text('P'+(total_deposit_rolling - total_withdraw_rolling).toLocaleString('en-US'));

        },
        error: function(xhr, status, error) {
          console.error('Error fetching data:', error);
        }
      });
    }

    reloadData();

    $('#add_junket_main_cage').submit(function(event) {
      event.preventDefault(); 

      var formData = $(this).serialize();

        $.ajax({
          url: '/add_junket_main_cage',
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

  
    $('#edit_junket_main_cage').submit(function(event) {
      event.preventDefault(); 

      var formData = $(this).serialize();
      $.ajax({
          url: '/junket_main_cage/' + cage_id,
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


function addMainCage() {
    $('#modal-new-main-cage').modal('show');
    $('.txtDateTime').val();
    $('.txtAmount').val();
    cage_category();
    get_transaction();
}

function edit_cage(id, cage, date_time, transaction, amount ) {
  $('#modal-edit-main-cage').modal('show');
  $('.txtDateTime').val(date_time);
  $('.txtAmount').val(amount);

  cage_id = id;

  edit_cage_category(cage);
  edit_get_transaction(transaction);
}

function archive_cage(id){
  SwalConfirm.fire({
    title: 'Are you sure you want to delete this?',
    confirmButtonText: 'Yes'
}).then((result) => {
    if (result.isConfirmed) {
      $.ajax({
        url: '/junket_main_cage/remove/' + id,
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

function cage_category() {
  $.ajax({
      url: '/cage_category_data',
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

function edit_cage_category(id) {
  $.ajax({
      url: '/cage_category_data',
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




