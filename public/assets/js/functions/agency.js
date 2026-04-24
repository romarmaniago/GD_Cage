var agency_id;
let allAgents = [];
$(document).ready(function() {
  reloadData();


  $('#modal-new-agency form').on('submit', function (e) {
    e.preventDefault();
  
    const $form = $(this);
    const $btn = $('#submit-new-agency-btn');
    const formData = $form.serialize();
  
    $btn.prop('disabled', true).html(`
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Loading...
    `);
  
    $.ajax({
      url: '/add_agency',
      type: 'POST',
      data: formData,
      success: function (res) {
        Swal.fire({
          icon: 'success',
          title: 'Success!',
          text: 'Agency has been added.',
          confirmButtonText: 'OK'
        }).then(() => {
          $('#modal-new-agency').modal('hide');
          $form[0].reset();
          reloadData(); // Refresh the agency list
        });
      },
      error: function (xhr) {
        const error = xhr.responseJSON?.error || 'An error occurred.';
        console.error('Add agency error:', error);
  
        Swal.fire({
          icon: 'error',
          title: 'Error!',
          text: error,
          confirmButtonText: 'OK'
        });
      },
      complete: function () {
        $btn.prop('disabled', false).text($btn.data('label'));
      }
    });
  });
  

  // Form submission para sa pag-edit ng agency
  $('#edit_agency').submit(function(event) {
    event.preventDefault();

    var formData = $(this).serialize();
    $.ajax({
      url: '/agency/' + agency_id,
      type: 'PUT',
      data: formData,
      success: function(response) {
        Swal.fire({
          icon: 'success',
          title: 'Success!',
          text: 'Agent updated successfully!',
          confirmButtonText: 'OK'
        }).then(() => {
          reloadData();
          $('#modal-edit-agency').modal('hide');
        });
      },
      error: function(error) {
        console.error('Error updating agent:', error);
        Swal.fire({
          icon: 'error',
          title: 'Error!',
          text: error.responseJSON?.error || 'Error updating agency. Please try again.',
          confirmButtonText: 'OK'
        });
      }
    });
  });
});

// I-re-render ang data bilang grid
function reloadData() {
  $.ajax({
    url: '/agency_data',
    method: 'GET',
    success: function(data) {
      allAgents = data; // save globally
      renderPage(allAgents); // show first load

      $('#pagination-container').off('click').on('click', '.page-link', function (e) {
        e.preventDefault();
        const page = parseInt($(this).data('page'));
        renderPage(filteredAgents(), page); // ← use filtered data here
      });
    },
    error: function(xhr, status, error) {
      console.error('Error fetching data:', error);
    }
  });
}

function filteredAgents() {
  const keyword = $('#agentSearch').val().toLowerCase();
  return allAgents.filter(agent => agent.AGENCY.toLowerCase().includes(keyword));
}



function renderPage(data, page = 1, perPage = 30) {
  const agencyGrid = $('#agency-grid');
  const pagination = $('#pagination-container .pagination');
  agencyGrid.empty();
  pagination.empty();

  const totalPages = Math.ceil(data.length / perPage);
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const currentPageData = data.slice(start, end);

  const permissions = parseInt($('#user-role').data('permissions'));

  currentPageData.forEach(function(row) {
    let btn = '';

    if (permissions !== 2) {
      btn = `
        <div class="btn-group">
          <button type="button" onclick="edit_agency(${row.IDNo}, '${row.AGENCY}','${row.REMARKS}')"
            class="action-btn edit-btn me-1" 
            data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
            <i class="fa fa-pen"></i>
          </button>
          <button type="button" onclick="checkPermissionToDeleteAgency(${row.IDNo})"
            class="action-btn delete-btn"
            data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
            <i class="fa fa-trash"></i>
          </button>
        </div>
      `;
    } else {
      btn = `
        <div class="btn-group">
          <button type="button" class="btn btn-sm btn-light btn-icon me-1" disabled
            data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
            <i class="fa fa-pencil-alt"></i>
          </button>
          <button type="button" class="btn btn-sm btn-danger btn-icon" disabled
            data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
            <i class="fa fa-trash-alt"></i>
          </button>
        </div>
      `;
    }

    const cardHtml = `
  <div class="col-lg-2 col-md-3 col-sm-4 col-6 mb-3">
    <div class="agency-card text-center position-relative" data-id="${row.IDNo}">
      <!-- Idagdag ang hidden input para sa memo -->
      <input type="hidden" class="hidden-memo" value="${row.REMARKS || ''}">
    
      <div class="position-absolute top-0 end-0 m-1">
        <input 
          class="form-check-input select-agent-checkbox d-none" 
          type="checkbox" 
          value="${row.IDNo}" 
          id="agent-${row.IDNo}"
          onchange="toggleBookmarkColor(${row.IDNo})"
        >
        <label for="agent-${row.IDNo}">
          <svg 
            class="icon-32"
            id="bookmark-icon-${row.IDNo}"
            width="32" 
            height="32"
            viewBox="0 0 24 24" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            style="filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.3));"
          >
            <path 
              opacity="0.4" 
              d="M11.9912 18.6215L5.49945 21.864C5.00921 22.1302 4.39768 21.9525 4.12348 21.4643C4.0434 21.3108 4.00106 21.1402 4 20.9668V13.7087C4 14.4283 4.40573 14.8725 5.47299 15.37L11.9912 18.6215Z" 
              fill="currentColor"
            />
            <path 
              fill-rule="evenodd" 
              clip-rule="evenodd" 
              d="M8.89526 2H15.0695C17.7773 2 19.9735 3.06605 20 5.79337V20.9668C19.9989 21.1374 19.9565 21.3051 19.8765 21.4554C19.7479 21.7007 19.5259 21.8827 19.2615 21.9598C18.997 22.0368 18.7128 22.0023 18.4741 21.8641L11.9912 18.6215L5.47299 15.3701C4.40573 14.8726 4 14.4284 4 13.7088V5.79337C4 3.06605 6.19625 2 8.89526 2ZM8.22492 9.62227H15.7486C16.1822 9.62227 16.5336 9.26828 16.5336 8.83162C16.5336 8.39495 16.1822 8.04096 15.7486 8.04096H8.22492C7.79137 8.04096 7.43991 8.39495 7.43991 8.83162C7.43991 9.26828 7.79137 9.62227 8.22492 9.62227Z" 
              fill="currentColor"
            />
          </svg>
        </label>
      </div>

      <div class="agency-card-body py-3 px-2">
        <a 
          href="#" 
          onclick="openAccountLedgerModal(${row.IDNo})" 
          class="agency-name text-uppercase"
        >
          ${row.AGENCY}
        </a>
        <div class="agent-actions mt-2 d-none">
          ${btn}
        </div>
      </div>
    </div>
  </div>
`;


  


  

    agencyGrid.append(cardHtml);
  });

  // Tooltip reset
  $('[data-bs-toggle="tooltip"]').tooltip();

  // Pagination buttons
  for (let i = 1; i <= totalPages; i++) {
    const activeClass = i === page ? 'active' : '';
    pagination.append(`
      <li class="page-item ${activeClass}">
        <a class="page-link" href="#" data-page="${i}">${i}</a>
      </li>
    `);
  }
}

$('#agentSearch').on('input', function () {
  const val = $(this).val();
  $('#clearSearchBtn').toggleClass('d-none', val === '');
  renderPage(filteredAgents());
});

$('#clearSearchBtn').on('click', function () {
  $('#agentSearch').val('');
  $(this).addClass('d-none');
  renderPage(allAgents);
});



// 🔄 Outside loop: Bind checkbox and button handlers once only
$(document).on('change', '.select-agent-checkbox', function () {
  const selected = $('.select-agent-checkbox:checked');
  $('#bulkEditBtn, #bulkDeleteBtn').toggleClass('d-none', selected.length === 0);
});

function getSelectedAgentIds() {
  return $('.select-agent-checkbox:checked').map(function () {
    return $(this).val();
  }).get();
}

$('#bulkEditBtn').on('click', function () {
  const ids = getSelectedAgentIds();

  if (ids.length === 1) {
    const selectedCard = $(`#agent-${ids[0]}`).closest('.agency-card');
    const agencyName = selectedCard.find('.agency-name').text().trim();
    // Kunin ang value mula sa hidden input
    const memo = selectedCard.find('.hidden-memo').val() || '';
    edit_agency(ids[0], agencyName, memo);
  } else {
    Swal.fire('Please select only 1 agent to edit.');
  }
});

$('#bulkDeleteBtn').on('click', function () {
  const ids = getSelectedAgentIds();
  if (ids.length === 0) return;
  promptDeleteAgentsWithTransferOption(ids);
});


// Select All toggle
$('#selectAllAgents').on('change', function () {
  const checked = $(this).is(':checked');
  $('.select-agent-checkbox').prop('checked', checked).trigger('change');
});

$(document).on('input', '#agentSearch', function () {
  const keyword = $(this).val().toLowerCase();
  $('.agency-card').each(function () {
    const name = $(this).find('.agency-name').text().toLowerCase();
    $(this).toggle(name.includes(keyword));
  });
});

// Ito ang function na magti-toggle ng kulay
function toggleBookmarkColor(idNo) {
  const checkbox = document.getElementById(`agent-${idNo}`);
  const icon = document.getElementById(`bookmark-icon-${idNo}`);

  if (checkbox.checked) {
    icon.classList.add('icon-primary');
  } else {
    icon.classList.remove('icon-primary');
  }
}


// Ipakita ang modal para sa pag-edit ng agency
function edit_agency(id, agency, memo) {
  $('#modal-edit-agency').modal('show');
  $('#agency').val(agency);
  $('#txtEditAgentMemo').val(memo);
  agency_id = id;
}
// Tingnan muna kung may permission bago mag-delete
function checkPermissionToDeleteAgency(id) {
  $.ajax({
    url: '/check-permission',
    type: 'POST',
    success: function(response) {
      if (response.permissions === 11) {
        archive_agency(id);
      } else {
        Swal.fire({
          title: 'Access Denied',
          text: 'Not allowed to delete this data.',
          icon: 'error',
          confirmButtonText: 'OK',
          confirmButtonColor: '#6f9c40'
        });
      }
    },
    error: function() {
      Swal.fire({
        title: 'Error',
        text: 'Unable to check permissions at this time.',
        icon: 'error',
        confirmButtonText: 'OK',
        confirmButtonColor: '#6f9c40'
      });
    }
  });
}

function performAgencyArchiveRemove(ids) {
  const numericIds = ids.map(function (id) { return parseInt(id, 10); }).filter(function (n) { return n > 0; });
  if (numericIds.length === 0) return;

  const requests = numericIds.map(function (id) {
    return $.ajax({
      url: '/agency/remove/' + id,
      type: 'PUT'
    });
  });

  Promise.all(requests)
    .then(function () {
      window.location.reload();
    })
    .catch(function (err) {
      console.error('Error archiving:', err);
      Swal.fire({
        title: 'Error',
        text: 'One or more agents could not be archived. Please try again.',
        icon: 'error',
        confirmButtonText: 'OK'
      });
    });
}

/**
 * Delete/archive flow: optional "Transfer accounts…" opens the same Change Agent modal (when one agent).
 */
function promptDeleteAgentsWithTransferOption(ids) {
  const count = ids.length;
  if (count === 0) return;

  const onlyOne = count === 1;
  const singleId = onlyOne ? parseInt(ids[0], 10) : null;
  const card = onlyOne ? $(`.agency-card[data-id="${singleId}"]`) : null;
  const agencyName = card && card.length ? card.find('.agency-name').text().trim() : '';

  Swal.fire({
    title: 'Are you sure you want to delete this agent?',
    html: onlyOne
      ? 'You can <strong>transfer guest accounts</strong> to another agent first, or delete this agent now.'
      : 'You are about to delete <strong>' + count + ' agents</strong>. To move accounts first, select <strong>one</strong> agent and use <strong>Transfer accounts…</strong>.',
    icon: 'warning',
    showCancelButton: true,
    showDenyButton: onlyOne,
    confirmButtonText: onlyOne ? 'Delete now' : 'Yes, delete all',
    denyButtonText: 'Transfer accounts…',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#d33',
    denyButtonColor: '#3085d6'
  }).then(function (result) {
    if (result.isConfirmed) {
      performAgencyArchiveRemove(ids);
    } else if (result.isDenied && onlyOne) {
      if (typeof window.openTransferAgencyModalForAgency === 'function') {
        window.openTransferAgencyModalForAgency(String(singleId), agencyName || 'Agent', [singleId]);
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Unavailable',
          text: 'Transfer could not be opened. Reload the page and try again.',
          confirmButtonText: 'OK'
        });
      }
    }
  });
}

// I-archive (delete) ang agency
function archive_agency(id) {
  promptDeleteAgentsWithTransferOption([id]);
}