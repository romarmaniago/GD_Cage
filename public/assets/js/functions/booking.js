var booking_id;

// Function para buksan ang modal para sa bagong booking
function addBooking() {
    $('#modal-new-booking').modal('show');
  }
  
  // Utility function para makuha ang query parameter mula sa URL
  function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  }
  
  $(document).ready(function () {
    // Kunin ang booking ID na dapat i-highlight mula sa URL (hal., /booking?id=8)
    const highlightId = getQueryParam('id');
    console.log("Highlight ID from URL:", highlightId);
  
    // Siguraduhing na-destroy muna ang anumang existing DataTable instance
    if ($.fn.DataTable.isDataTable('#booking-tbl')) {
      $('#booking-tbl').DataTable().destroy();
    }
  
    // I-initialize ang DataTable. Tandaan: gagamit tayo ng object na ito sa pagre-load ng data.
    var dataTable = $('#booking-tbl').DataTable({
      responsive: true,
      ordering: true,
      pageLength: 10,
      // Itago ang booking ID column (na nasa index 0)
      columnDefs: [
        { targets: 0, visible: false, searchable: false },
        {
          targets: 11,
          render: function (data, type, row) {
            if (type !== 'display') return data;
            if (!window.RemarksEditor || !row[0]) return data || '';
            return window.RemarksEditor.renderCell(data || '', {
              source: 'booking',
              recordId: row[0]
            });
          }
        }
      ],
      // Order ayon sa Booking Date na nasa index 1 (dahil nadagdag na ang booking ID sa index 0)
      order: [[1, 'desc']],
      language: {
        search: (window.bookingTranslations?.search || "Search:"),
        info: (window.bookingTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
        paginate: {
          previous: (window.bookingTranslations?.previous || "Previous"),
          next: (window.bookingTranslations?.next || "Next")
        },
        emptyTable: (window.bookingTranslations?.no_data_found || "No data available in table")
      },
      // Sa createdRow, ilagay ang highlight kung magmamatch ang booking ID (data[0]) sa highlightId
      createdRow: function (row, data, dataIndex) {
        var rowId = data[0];
        console.log("Row ID:", rowId, "Highlight ID:", highlightId);
        if (highlightId && parseInt(rowId) === parseInt(highlightId)) {
          console.log("Highlighting row:", row);
          // Gamitin ang addClass para idagdag ang highlight, at hindi na muna diretso ang inline style
          $(row).addClass('highlight-row');
        }
      },
      // drawCallback: paglipat ng pahina, i-scroll sa highlighted row kung meron
      drawCallback: function (settings) {
        const api = this.api();
        const $currentRows = $(api.rows({ page: 'current' }).nodes());
        const $highlightRow = $currentRows.filter('.highlight-row');
        if ($highlightRow.length) {
          $('html, body').animate({
            scrollTop: $highlightRow.offset().top - 100
          }, 500);
        }
      }
    });
  
    // Function para i-load/muling i-reload ang booking data mula sa server
    function reloadData() {
      $.ajax({
        url: '/junket_booking_data', // Palitan ng tamang endpoint kung kinakailangan
        method: 'GET',
        success: function (data) {
          // Linisin muna ang DataTable bago idagdag ang mga bagong row
          dataTable.clear();
  
          // I-loop sa bawat row ng data
          data.forEach(function (row) {
            // Format ng booking date (kasama ang oras)
            var bookingDate = row.BOOKING_DATE ?
              moment(row.BOOKING_DATE).utcOffset(8).format('YYYY-MM-DD HH:mm') :
              moment().format('YYYY-MM-DD HH:mm');
  
            // Format ng check-in at check-out dates
            const checkInText = window.bookingTranslations?.check_in || 'Check-In';
            const checkOutText = window.bookingTranslations?.check_out || 'Check-Out';
            var checkInDateFormatted = (row.CHECK_IN && moment(row.CHECK_IN, moment.ISO_8601, true).isValid()) ?
            `<div style="text-align: center;">
                <div style="color: #00563F;">${moment(row.CHECK_IN).utcOffset(8).format('YYYY-MM-DD')}</div>
                <span class="badge" style="background-color: #00563F;">${checkInText}</span>
             </div>` : '-';
          
          var checkOutDateFormatted = (row.CHECK_OUT && moment(row.CHECK_OUT, moment.ISO_8601, true).isValid()) ?
            `<div style="text-align: center;">
                <div style="color: orange;">${moment(row.CHECK_OUT).utcOffset(8).format('YYYY-MM-DD')}</div>
                <span class="badge bg-warning">${checkOutText}</span>
             </div>` : '-';
          
  
            // Format fees at total amounts
            var hotelFee = row.HOTEL_FEE ? parseFloat(row.HOTEL_FEE).toLocaleString('en-US') : '0';
            var addFee = row.ADDT_FEE ? parseFloat(row.ADDT_FEE).toLocaleString('en-US') : '0';
            var totalAmount = row.TOTAL_AMOUNT ? parseFloat(row.TOTAL_AMOUNT).toLocaleString('en-US') : '0';
  
            // Payment Status badge
            const paidText = window.bookingTranslations?.paid || 'Paid';
            const unpaidText = window.bookingTranslations?.unpaid || 'Unpaid';
            const unknownText = window.bookingTranslations?.unknown || 'Unknown';
            var paymentStatusBadge;
            if (row.PAYMENT_STATUS === 'Paid') {
              paymentStatusBadge = `<span class="css-blue">${paidText}</span>`;
            } else if (row.PAYMENT_STATUS === 'Unpaid') {
              paymentStatusBadge = `<span class="css-red">${unpaidText}</span>`;
            } else {
              paymentStatusBadge = `<span class="badge bg-secondary">${unknownText}</span>`;
            }
  
            // Button options depende sa user permissions
            const permissions = parseInt($('#user-role').data('permissions'));
            var btn = '';
            if (permissions !== 2) {
              btn = `<center>
                        <div class="btn-group booking-action-group" role="group" aria-label="Booking actions">
                          <button type="button" class="btn btn-sm btn-primary booking-action-btn" title="${window.bookingTranslations?.check_in || 'Check-In'}" onclick="checkIn(${row.IDNo})">
                            <i class="fa fa-sign-in-alt"></i>
                          </button>
                          <button type="button" class="btn btn-sm btn-warning booking-action-btn" title="${window.bookingTranslations?.check_out || 'Check-Out'}" onclick="checkOut(${row.IDNo})">
                            <i class="fa fa-sign-out-alt"></i>
                          </button>
                          <button type="button" class="btn btn-sm btn-info booking-action-btn" title="${row.PAYMENT_STATUS === 'Paid' ? (window.bookingTranslations?.mark_booking_as?.replace('${newStatus}', window.bookingTranslations?.unpaid || 'Unpaid') || `Mark as ${window.bookingTranslations?.unpaid || 'Unpaid'}`) : (window.bookingTranslations?.mark_booking_as?.replace('${newStatus}', window.bookingTranslations?.paid || 'Paid') || `Mark as ${window.bookingTranslations?.paid || 'Paid'}`)}" onclick="togglePaymentStatus(${row.IDNo}, '${row.PAYMENT_STATUS}')">
                            <i class="fa fa-money-bill"></i>
                          </button>
                          <button type="button" class="btn btn-sm btn-secondary booking-action-btn" title="${window.bookingTranslations?.edit || 'Edit'}" onclick="editBooking(${row.IDNo}, '${row.CONFIRM_NUM.replace(/'/g, "\\'")}', '${row.CHECK_IN}', '${row.CHECK_OUT}', '${row.GUEST_NAME.replace(/'/g, "\\'")}', '${hotelFee}', '${addFee}', '${row.REMARKS.replace(/'/g, "\\'")}')">
                            <i class="fa fa-edit"></i>
                          </button>
                          <button type="button" class="btn btn-sm btn-danger booking-action-btn" title="${window.bookingTranslations?.archive || 'Archive'}" onclick="archiveBooking(${row.IDNo})">
                            <i class="fa fa-archive"></i>
                          </button>
                        </div>
                      </center>`;
            } else {
              btn = `<center>
                       <div class="btn-group booking-action-group" role="group" aria-label="Booking actions disabled">
                          <button type="button" class="btn btn-sm btn-alt-secondary booking-action-btn" style="background-color: #f0f1f7;" disabled>
                            <i class="fa fa-sign-in-alt"></i>
                          </button>
                          <button type="button" class="btn btn-sm btn-alt-secondary booking-action-btn" style="background-color: #f0f1f7;" disabled>
                            <i class="fa fa-sign-out-alt"></i>
                          </button>
                          <button type="button" class="btn btn-sm btn-alt-secondary booking-action-btn" style="background-color: #f0f1f7;" disabled>
                            <i class="fa fa-money-bill"></i>
                          </button>
                          <button type="button" class="btn btn-sm btn-alt-secondary booking-action-btn" style="background-color: #f0f1f7;" disabled>
                            <i class="fa fa-edit"></i>
                          </button>
                          <button type="button" class="btn btn-sm btn-alt-secondary booking-action-btn" style="background-color: #f0f1f7;" disabled>
                            <i class="fa fa-archive"></i>
                          </button>
                        </div>
                      </center>`;
            }
  
            // Idagdag ang row sa DataTable.
            // Isama natin ang booking ID (row.IDNo) bilang unang item (index 0)
            dataTable.row.add([
              row.IDNo,              // Index 0: Booking ID (hidden)
              bookingDate,           // Index 1: Booking Date
              row.CONFIRM_NUM,       // Index 2: Confirmation No.
              checkInDateFormatted,  // Index 3: Check-In Date
              checkOutDateFormatted, // Index 4: Check-Out Date
              row.ACCT_NUM,          // Index 5: Account No.
              row.GUEST_NAME,        // Index 6: Guest Name
              hotelFee,              // Index 7: Hotel Fee
              addFee,                // Index 8: Additional Fee
              totalAmount,           // Index 9: Total Amount
              paymentStatusBadge,    // Index 10: Payment Status
              row.REMARKS,           // Index 11: Remarks
              row.FIRSTNAME,         // Index 12: Encoded By
              btn                    // Index 13: Action buttons
            ]);
          });
  
          // I-draw ang DataTable matapos madagdag lahat ng rows
          dataTable.draw();
  
          // Pagkatapos mag-draw, kung ang highlighted row ay nasa ibang pahina, ilipat ang DataTable sa tamang page.
          if (highlightId) {
            var allData = dataTable.rows().data().toArray();
            var targetIndex = -1;
            for (var i = 0; i < allData.length; i++) {
              if (parseInt(allData[i][0]) === parseInt(highlightId)) {
                targetIndex = i;
                break;
              }
            }
            if (targetIndex >= 0) {
              var pageLength = dataTable.page.len();
              var targetPage = Math.floor(targetIndex / pageLength);
              console.log("Target row index:", targetIndex, "Target page:", targetPage);
              if (dataTable.page() !== targetPage) {
                dataTable.page(targetPage).draw(false);
              }
            }
          }
        },
        error: function (xhr, status, error) {
          console.error("Error fetching booking data:", error);
        }
      });
    }
  
    // Tawagin ang reloadData para mapopulate ang table
    reloadData();

 // Add new booking
$('#add_booking_form').submit(function (event) {
    event.preventDefault();

    const $form = $(this);
    const $btn = $form.find('button[type="submit"]');
    const originalHtml = $btn.html();

    // Show loading spinner
    const savingText = window.bookingTranslations?.saving || 'Saving';
    $btn.prop('disabled', true).html(`
        <span class="spinner-border spinner-border-sm me-1 text-white" role="status" aria-hidden="true"></span>
        <span class="text-white">${savingText}...</span>
    `);

    let isValid = true;
    $form.find(':input[required]').each(function () {
        if ($(this).val().trim() === '') {
            isValid = false;
            $(this).addClass('is-invalid');
        } else {
            $(this).removeClass('is-invalid');
        }
    });

    if (!isValid) {
        Swal.fire({
            icon: 'error',
            title: window.bookingTranslations?.inserting_error || 'Inserting Error',
            text: window.bookingTranslations?.fill_required_fields || 'Please fill in all required fields.',
        });
        $btn.prop('disabled', false).html(originalHtml);
        return;
    }

    const formData = $form.serialize();

    $.ajax({
        url: '/add_junket_booking',
        type: 'POST',
        data: formData,
        success: function (response) {
            Swal.fire({
                icon: 'success',
                title: window.bookingTranslations?.booking_added_successfully || 'Booking added successfully',
                confirmButtonText: window.bookingTranslations?.ok || 'OK'
            }).then(function () {
                $('#modal-new-booking').modal('hide');
                window.location.reload();
            });
        },
        error: function (xhr, status, error) {
            console.error('Error adding booking:', error);
            Swal.fire({
                icon: 'error',
                title: window.bookingTranslations?.error || 'Error',
                text: window.bookingTranslations?.error_saving || 'Something went wrong while saving.',
                confirmButtonText: window.bookingTranslations?.ok || 'OK'
            });
        },
        complete: function () {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });
});


// Handle form EDIT submission with loading spinner
$('#editBookingForm').on('submit', function (e) {
    e.preventDefault();

    const $form = $(this);
    const $btn = $form.find('button[type="submit"]');
    const originalHtml = $btn.html();

    // Show spinner and disable button
    const updatingText = window.bookingTranslations?.updating || 'Updating';
    $btn.prop('disabled', true).html(`
        <span class="spinner-border spinner-border-sm me-1 text-white" role="status" aria-hidden="true"></span>
        <span class="text-white">${updatingText}...</span>
    `);

    const formData = $form.serialize();

    $.ajax({
        url: '/update_junket_booking',
        method: 'POST',
        data: formData,
        success: function (response) {
            Swal.fire({
                icon: 'success',
                title: window.bookingTranslations?.updated_successfully || 'Updated Successfully',
                text: window.bookingTranslations?.booking_updated || 'The booking has been updated.',
                confirmButtonText: window.bookingTranslations?.ok || 'OK'
            }).then((result) => {
                if (result.isConfirmed) {
                    $('#modal-edit-booking').modal('hide');
                    window.location.reload();
                }
            });
        },
        error: function (xhr, status, error) {
            console.error('Error updating booking:', error);
            Swal.fire({
                icon: 'error',
                title: window.bookingTranslations?.update_failed || 'Update Failed',
                text: window.bookingTranslations?.error_updating || 'Something went wrong while updating.',
                confirmButtonText: window.bookingTranslations?.ok || 'OK'
            });
        },
        complete: function () {
            // Re-enable and restore button text
            $btn.prop('disabled', false).html(originalHtml);
        }
    });
});

});

//EDIT BOOKING
function editBooking(id, confirmNum, checkIn, checkOut, guestName, hotelFee, addFee, remarks) {
  
  // Show the modal
  $('#modal-edit-booking').modal('show');
  
  // Populate the modal fields with the existing booking data
  $('#bookingId').val(id);
  $('#confirmNum').val(confirmNum);
  $('#checkIn').val(checkIn);
  $('#checkOut').val(checkOut);
  $('#guestName').val(guestName);
  $('#hotelFee').val(hotelFee);  // Ensure hotelFee is populated
  $('#addFee').val(addFee);      // Ensure addFee is populated
  $('#remarks').val(remarks);
  
  // Calculate total based on populated fees
  calculateTotal();  // Call the function to calculate the total when opening the modal

}


//ARCHIVE BOOKING
function archiveBooking(id) {
  SwalConfirm.fire({
      title: window.bookingTranslations?.archive_confirmation || 'Are you sure you want to archive this booking?',
      confirmButtonText: window.bookingTranslations?.yes_archive || 'Yes, archive it!'
  }).then((result) => {
      if (result.isConfirmed) {
          $.ajax({
              url: '/remove_booking/' + id, // Endpoint for archiving booking
              type: 'PUT',
              success: function(response) {
                  Swal.fire({
                      icon: 'success',
                      title: window.bookingTranslations?.booking_archived_successfully || 'Booking archived successfully',
                      confirmButtonText: window.bookingTranslations?.ok || 'OK'
                  }).then(() => {
                      window.location.reload(); // Reload the page to reflect the changes
                  });
              },
              error: function(error) {
                  console.error('Error archiving booking:', error);
                  Swal.fire({
                      icon: 'error',
                      title: window.bookingTranslations?.error_archiving || 'Error archiving booking',
                      text: window.bookingTranslations?.error_archiving_booking || 'An error occurred while archiving the booking.',
                  });
              }
          });
      }
  });
}


//CHECK IN CONFIRMATION
function checkIn(bookingId) {
  SwalConfirm.fire({
      title: window.bookingTranslations?.check_in_confirmation || 'Are you sure?',
      message: window.bookingTranslations?.check_in_question || 'Do you want to check in this booking?',
      confirmButtonText: window.bookingTranslations?.yes_check_in || 'Yes, check in!',
      cancelButtonText: window.bookingTranslations?.no_cancel || 'No, cancel'
  }).then((result) => {
      if (result.isConfirmed) {
          const currentDateTime = moment().format('YYYY-MM-DD HH:mm:ss');
          $.ajax({
              url: `/check_in/${bookingId}`, // Endpoint for check-in
              method: 'PUT',
              data: { checkInDate: currentDateTime },
              success: function(response) {
                  Swal.fire({
                      icon: 'success',
                      title: window.bookingTranslations?.checked_in_successfully || 'Checked in successfully',
                      confirmButtonText: window.bookingTranslations?.ok || 'OK'
                  }).then(function() {
                      window.location.reload(); // Reload the page to refresh the data
                  });
              },
              error: function(xhr, status, error) {
                  console.error('Error during check-in:', error);
              }
          });
      }
  });
}
//CHECK OUT CONFIRMATION
function checkOut(bookingId) {
  SwalConfirm.fire({
      title: window.bookingTranslations?.check_in_confirmation || 'Are you sure?',
      message: window.bookingTranslations?.check_out_question || 'Do you want to check out this booking?',
      confirmButtonText: window.bookingTranslations?.yes_check_out || 'Yes, check out!',
      cancelButtonText: window.bookingTranslations?.no_cancel || 'No, cancel'
  }).then((result) => {
      if (result.isConfirmed) {
          const currentDateTime = moment().format('YYYY-MM-DD HH:mm:ss');
          $.ajax({
              url: `/check_out/${bookingId}`, // Endpoint for check-out
              method: 'PUT',
              data: { checkOutDate: currentDateTime },
              success: function(response) {
                  Swal.fire({
                      icon: 'success',
                      title: window.bookingTranslations?.checked_out_successfully || 'Checked out successfully',
                      confirmButtonText: window.bookingTranslations?.ok || 'OK'
                  }).then(function() {
                      window.location.reload(); // Reload the page to refresh the data
                  });
              },
              error: function(xhr, status, error) {
                  console.error('Error during check-out:', error);
              }
          });
      }
  });
}



// Toggle PAYMENT STATUS
function togglePaymentStatus(bookingId, currentStatus) {
    const paidText = window.bookingTranslations?.paid || 'Paid';
    const unpaidText = window.bookingTranslations?.unpaid || 'Unpaid';
    const newStatus = currentStatus === 'Paid' ? 'Unpaid' : 'Paid';
    const newStatusText = newStatus === 'Paid' ? paidText : unpaidText;
    SwalConfirm.fire({
      title: window.bookingTranslations?.update_payment_status || 'Update Payment Status',
      message: (window.bookingTranslations?.mark_booking_as || 'Do you want to mark this booking as ${newStatus}?').replace('${newStatus}', newStatusText),
      confirmButtonText: (window.bookingTranslations?.yes_mark_as || `Yes, mark as ${newStatus}`).replace('${newStatus}', newStatusText),
      cancelButtonText: window.bookingTranslations?.no_cancel || 'No, cancel'
    }).then((result) => {
      if (result.isConfirmed) {
        $.ajax({
          url: `/booking_payment_status_update/${bookingId}`, // Endpoint for toggling payment status
          method: 'PUT',
          data: { paymentStatus: newStatus },
          success: function(response) {
            Swal.fire({
              icon: 'success',
              title: (window.bookingTranslations?.marked_as_successfully || `Marked as ${newStatus} successfully`).replace('${newStatus}', newStatusText),
              confirmButtonText: window.bookingTranslations?.ok || 'OK'
            }).then(function() {
              window.location.reload(); // Reload the page to refresh the data
            });
          },
          error: function(xhr, status, error) {
            console.error('Error updating payment status:', error);
          }
        });
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


