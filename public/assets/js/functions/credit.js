var credit_id;

$(document).ready(function() {
    if ($.fn.DataTable.isDataTable('#credit-tbl')) {
        $('#credit-tbl').DataTable().destroy();
    }

    var dataTable = $('#credit-tbl').DataTable({
        "order": [[6, 'desc']], // Set the first column (index 0) to be sorted in descending order
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
        url: '/junket_credit_data', // Endpoint to fetch data
        method: 'GET',
        success: function(data) {
          dataTable.clear();

          var total_credit = 0;
          data.forEach(function(row) {
            // var status = '';
            // if (row.ACTIVE.data[0] == 1) {
            //     status = '<span class="badge bg-info">ACTIVE</span>';
            // } else {
            //     status = '<span class="badge bg-danger">INACTIVE</span>';
            // }

            total_credit = total_credit + row.AMOUNT;

            var btn = `<div class="btn-group">
            <button type="button" onclick="edit_credit(${row.credit_id}, '${row.AMOUNT}', '${row.REMARKS}', '${row.STATUS_ID}' )" class="btn btn-sm btn-alt-secondary js-bs-tooltip-enabled"
              data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
              <i class="fa fa-pencil-alt"></i>
            </button>
            <button type="button" onclick="archive_credit(${row.credit_id})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
              data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
              <i class="fa fa-trash-alt"></i>
            </button>
          </div>`;
             var formattedDate = moment.utc(row.ENCODED_DT).utcOffset(8).format('MMMM DD, YYYY HH:mm:ss');
            var amountCell = window.fmtAmt ? window.fmtAmt(row.AMOUNT) : Number(row.AMOUNT || 0).toLocaleString('en-US');
            var remarksCell = window.RemarksEditor && row.credit_id
              ? window.RemarksEditor.renderCell(row.REMARKS || '', { source: 'junket_credit', recordId: row.credit_id })
              : `${row.REMARKS || ''}`;
            dataTable.row.add([`${row.AGENT_CODE}`, `${row.account_name}`, amountCell, `${row.STATUS}`, remarksCell, `${row.FIRSTNAME}`, formattedDate, btn]).draw();
          });
          $('.total_credit').text(`P${total_credit.toLocaleString('en-US')}`);
        },
        error: function(xhr, status, error) {
          console.error('Error fetching data:', error);
        }
      });
    }

    reloadData();

   $('#add_junket_credit').submit(function(event) {
    event.preventDefault();

    // Check if required fields are filled
    var isValid = true;
    $(this).find(':input[required]').each(function() {
        if ($(this).val() === '') {
            isValid = false;
            $(this).addClass('is-invalid'); // Optional: add a class for styling
        } else {
            $(this).removeClass('is-invalid'); // Remove error class if valid
        }
    });

    if (!isValid) {
        Swal.fire({
            icon: 'error',
            title: 'Inserting Error',
            text: 'Please fill in all required fields.',
        });
        return; // Stop the submission if validation fails
    }

    var formData = $(this).serialize();

    $.ajax({
        url: '/add_junket_credit',
        type: 'POST',
        data: formData,
        success: function(response) {
            Swal.fire({
                icon: 'success',
                title: 'Credit added successfully',
                confirmButtonText: 'OK',
                showConfirmButton: true
            }).then(function() {
                reloadData();
                $('#modal-new-credit').modal('hide');
                window.location.reload(); // Reload the page after closing the modal
            });
        },
        error: function(xhr, status, error) {
            console.error('Error adding junket credit:', error);
        }
    });
});


  
    $('#edit_junket_credit').submit(function(event) {
    event.preventDefault();

    var formData = $(this).serialize();
    $.ajax({
        url: '/junket_credit/' + credit_id,
        type: 'PUT',
        data: formData,
        success: function(response) {
            Swal.fire({
                icon: 'success',
                title: 'Credit updated successfully',
                confirmButtonText: 'OK',
                showConfirmButton: true
            }).then(function() {
                reloadData();
                $('#modal-edit-house-expense').modal('hide');
            });
        },
        error: function(error) {
            console.error('Error updating junket credit:', error);
        }
    });
});


});


function addCredit() {
    $('#modal-new-credit').modal('show');
    get_status();
    account_data();
}



function edit_credit(id, amount, remarks, status ) {
  $('#modal-edit-credit').modal('show');
  $('.txtAmount').val(amount);
  $('.remarks').val(remarks);

  credit_id = id;
  get_status_edit(status);

  console.log(status);

}

function archive_credit(id){
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
        url: '/junket_credit/remove/' + id,
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

function account_data() {
  $.ajax({
      url: '/account_data',
      method: 'GET',
      success: function(response) {
          var selectOptions = $('#txtAccountCode');
          selectOptions.empty(); 
          selectOptions.append($('<option>', {
            value: '',
            text: '--SELECT ACCOUNT--'
        }));
          response.forEach(function(option) {
              selectOptions.append($('<option>', {
                  value: option.account_id,
                  text: option.agent_code +' - '+ option.agent_name
              }));
          });
      },
      error: function(xhr, status, error) {
          console.error('Error fetching options:', error);
      }
  });
}

  

function get_status() {
    $.ajax({
        url: '/credit_status_data',
        method: 'GET',
        success: function(response) {
            var selectOptions = $('#txtStatus');
            selectOptions.empty(); 
            selectOptions.append($('<option>', {
              value: '',
              text: '--SELECT CREDIT STATUS--'
          }));
            response.forEach(function(option) {
                selectOptions.append($('<option>', {
                    value: option.IDNo,
                    text: option.STATUS 
                }));
            });
        },
        error: function(xhr, status, error) {
            console.error('Error fetching options:', error);
        }
    });
}

function get_status_edit(id) {
  $.ajax({
      url: '/credit_status_data',
      method: 'GET',
      success: function(response) {
          var selectOptions = $('.txtStatus');
          selectOptions.empty(); 
          selectOptions.append($('<option>', {
            selected: false,
            value: '',
            text: '--SELECT CREDIT STATUS--'
        }));
          response.forEach(function(option) {
              var selected = false;
              if(option.IDNo == id) {
                selected = true;
              }
              selectOptions.append($('<option>', {
                  selected: selected,
                  value: option.IDNo,
                  text: option.STATUS 
              }));
          });
      },
      error: function(xhr, status, error) {
          console.error('Error fetching options:', error);
      }
  });
}

$(document).ready(function () {
  $("input[data-type='number']").keyup(function (event) {
    // skip for arrow keys
    if (event.which >= 37 && event.which <= 40) {
      event.preventDefault();
    }
    var $this = $(this);
    var num = $this.val().replace(/,/gi, "");
    var num2 = num.split(/(?=(?:\d{3})+$)/).join(",");
    $this.val(num2);
  });
})

function onlyNumberKey(evt) {

  let ASCIICode = (evt.which) ? evt.which : evt.keyCode
  if (ASCIICode > 31 && (ASCIICode < 48 || ASCIICode > 57))
    return false;
  return true;
}