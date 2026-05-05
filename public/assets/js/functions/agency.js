var agency_id;
let allAgents = [];
let selectedAgencyId = null;
let currentAgencyAccounts = [];
let selectedAgentId = null;
let currentGuestRows = [];

function formatLineStatNumber(value) {
  const numeric = Number(value) || 0;
  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function renderLineStats(stats, isSingleLineScope) {
  const payload = stats || {};
  $('#line-stat-total-line').text(formatLineStatNumber(payload.total_line));
  $('#line-stat-total-agent').text(formatLineStatNumber(payload.total_agent));
  $('#line-stat-total-rolling').text(formatLineStatNumber(payload.total_rolling));
  $('#line-stat-total-winloss').text(formatLineStatNumber(payload.total_winloss));
  $('#line-stat-total-commission').text(formatLineStatNumber(payload.total_commission));
  $('#line-stat-total-balance').text(formatLineStatNumber(payload.total_balance));
  $('#line-stat-total-credit').text(formatLineStatNumber(payload.total_credit));
  $('#line-stat-card-line').toggleClass('d-none', isSingleLineScope);
  $('#line-stat-card-agent').toggleClass('d-none', !isSingleLineScope);
}

function loadLineStats(agencyId) {
  const hasAgency = Number.isFinite(Number(agencyId));
  const endpoint = hasAgency
    ? '/agency_line_stats?agencyId=' + encodeURIComponent(agencyId)
    : '/agency_line_stats';

  $.ajax({
    url: endpoint,
    method: 'GET',
    success: function (stats) {
      renderLineStats(stats, hasAgency);
    },
    error: function () {
      renderLineStats({
        total_line: 0,
        total_agent: 0,
        total_rolling: 0,
        total_winloss: 0,
        total_commission: 0,
        total_balance: 0,
        total_credit: 0
      }, hasAgency);
    }
  });
}

function renderAgentStats(stats, isVisible) {
  const payload = stats || {};
  $('#agent-stat-total-guest').text(formatLineStatNumber(payload.total_guest));
  $('#agent-stat-total-games').text(formatLineStatNumber(payload.total_games));
  $('#agent-stat-total-rolling').text(formatLineStatNumber(payload.total_rolling));
  $('#agent-stat-total-winloss').text(formatLineStatNumber(payload.total_winloss));
  $('#agent-stat-total-commission').text(formatLineStatNumber(payload.total_commission));
  $('#agent-stat-total-balance').text(formatLineStatNumber(payload.total_balance));
  $('#agent-stat-total-credit').text(formatLineStatNumber(payload.total_credit));

  // When an AGENT is selected, show only agent summary cards.
  $('#line-stat-row').toggleClass('d-none', isVisible);
  $('#agent-stat-row').toggleClass('d-none', !isVisible);
}

function loadAgentStats(agentId) {
  const numericAgentId = Number(agentId);
  if (!Number.isFinite(numericAgentId) || numericAgentId <= 0) {
    renderAgentStats({
      total_guest: 0,
      total_games: 0,
      total_rolling: 0,
      total_winloss: 0,
      total_commission: 0,
      total_balance: 0,
      total_credit: 0
    }, false);
    return;
  }

  $.ajax({
    url: '/agency_agent_stats?agentId=' + encodeURIComponent(numericAgentId),
    method: 'GET',
    success: function (stats) {
      renderAgentStats(stats, true);
    },
    error: function () {
      renderAgentStats({
        total_guest: 0,
        total_games: 0,
        total_rolling: 0,
        total_winloss: 0,
        total_commission: 0,
        total_balance: 0,
        total_credit: 0
      }, true);
    }
  });
}

function renderSelectionSummary() {
  const hasLine = !!selectedAgencyId;
  const hasAgent = !!selectedAgentId;
  $('#selection-summary-row').toggleClass('d-none', !hasLine && !hasAgent);
  $('#selected-line-chip').toggleClass('d-none', !hasLine);
  $('#selected-agent-chip').toggleClass('d-none', !hasAgent);
}

function setSelectedLineLabel(lineName) {
  $('#selected-line-name').text((lineName || '-').toUpperCase());
  renderSelectionSummary();
}

function setSelectedAgentLabel(agentCode, agentName) {
  const code = (agentCode || '').toUpperCase().trim();
  const name = (agentName || '').toUpperCase().trim();
  const label = code && name ? (code + ' · ' + name) : (code || name || '-');
  $('#selected-agent-name').text(label);
  renderSelectionSummary();
}

function refreshSelectedAgencyPanels() {
  if (!selectedAgencyId) return;
  $.ajax({
    url: '/account_data?agencyId=' + encodeURIComponent(selectedAgencyId),
    method: 'GET',
    success: function (rows) {
      currentAgencyAccounts = Array.isArray(rows) ? rows : [];
      renderAgentPanel(currentAgencyAccounts);
      // Keep GUEST panel empty for now (guest add/list flow to be added next).
      renderGuestPanel([]);
    },
    error: function () {
      currentAgencyAccounts = [];
      selectedAgentId = null;
      renderAgentPanel([]);
      renderGuestPanel([]);
    }
  });
}

function syncAgentPanelTransferButton() {
  var per = parseInt($('#user-role').data('permissions'), 10);
  var $btnTransfer = $('#btn-agent-panel-transfer');
  var $btnAgentExport = $('#btn-agent-panel-export');
  var $btnAddGuest = $('#btn-agent-panel-add-guest');
  var $btnGuestPanelAdd = $('#btn-guest-panel-add');
  var $btnLineExport = $('#btn-line-panel-export');
  if (!$btnTransfer.length && !$btnAgentExport.length && !$btnAddGuest.length && !$btnGuestPanelAdd.length && !$btnLineExport.length) return;
  var noSelectedAgency = !selectedAgencyId;
  var noSelectedAgent = !selectedAgentId;

  if (per === 2) {
    $btnTransfer.prop('disabled', true);
    $btnAgentExport.prop('disabled', true);
    $btnAddGuest.prop('disabled', true);
    $btnGuestPanelAdd.prop('disabled', true);
    $btnLineExport.prop('disabled', true);
    return;
  }

  $btnTransfer.prop('disabled', noSelectedAgency);
  $btnAgentExport.prop('disabled', noSelectedAgency);
  $btnAddGuest.prop('disabled', noSelectedAgency);
  $btnGuestPanelAdd.prop('disabled', noSelectedAgent);
  $btnLineExport.prop('disabled', false);
}

$(document).ready(function() {
  reloadData();
  loadLineStats();

  syncAgentPanelTransferButton();

  $('#btn-agent-panel-transfer').on('click', function () {
    openTransferForSelectedAgency();
  });

  $('#btn-line-panel-export').on('click', function () {
    var $btn = $('#btn-line-panel-export');
    $btn.prop('disabled', true);
    fetch('/agency/export_line_agent_matrix_xlsx', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json' }
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            throw new Error((j && j.error) ? j.error : 'Export failed');
          });
        }
        var cd = res.headers.get('Content-Disposition');
        var d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var filename = 'Line-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.xlsx';
        if (cd) {
          var m = /filename="([^"]+)"/i.exec(cd) || /filename=([^;]+)/i.exec(cd);
          if (m) filename = m[1].trim().replace(/^["']|["']$/g, '');
        }
        return res.blob().then(function (blob) {
          return { blob: blob, filename: filename };
        });
      })
      .then(function (o) {
        var link = document.createElement('a');
        link.href = URL.createObjectURL(o.blob);
        link.download = o.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      })
      .catch(function (err) {
        console.error('LINE export:', err);
        Swal.fire({ icon: 'error', title: 'Export', text: err.message || 'Export failed.' });
      })
      .finally(function () {
        $btn.prop('disabled', false);
        syncAgentPanelTransferButton();
      });
  });

  $('#btn-agent-panel-export').on('click', function () {
    if (!selectedAgencyId) {
      Swal.fire({
        icon: 'warning',
        title: 'No LINE selected',
        text: 'Select a LINE first to export agents and guests.',
        confirmButtonText: 'OK'
      });
      return;
    }
    var $btn = $('#btn-agent-panel-export');
    $btn.prop('disabled', true);
    fetch('/agency/export_agent_guest_matrix_xlsx', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ agencyId: selectedAgencyId })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            throw new Error((j && j.error) ? j.error : 'Export failed');
          });
        }
        var cd = res.headers.get('Content-Disposition');
        var d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var filename = 'Agent-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.xlsx';
        if (cd) {
          var m = /filename="([^"]+)"/i.exec(cd) || /filename=([^;]+)/i.exec(cd);
          if (m) filename = m[1].trim().replace(/^["']|["']$/g, '');
        }
        return res.blob().then(function (blob) {
          return { blob: blob, filename: filename };
        });
      })
      .then(function (o) {
        var link = document.createElement('a');
        link.href = URL.createObjectURL(o.blob);
        link.download = o.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      })
      .catch(function (err) {
        console.error('AGENT export:', err);
        Swal.fire({ icon: 'error', title: 'Export', text: err.message || 'Export failed.' });
      })
      .finally(function () {
        syncAgentPanelTransferButton();
      });
  });

  $('#btn-agent-panel-add-guest').on('click', function (e) {
    if (!selectedAgencyId) {
      e.preventDefault();
      Swal.fire({
        icon: 'warning',
        title: 'No agency selected',
        text: 'Select an AGENCY/LINE first.',
        confirmButtonText: 'OK'
      });
    }
  });

  $('#btn-guest-panel-add').on('click', function () {
    if (!selectedAgencyId || !selectedAgentId) {
      Swal.fire({
        icon: 'warning',
        title: 'Selection required',
        text: 'Select AGENCY/LINE and AGENT first.',
        confirmButtonText: 'OK'
      });
      return;
    }
    const selected = currentAgencyAccounts.find(function (row) {
      return String(row.agent_id) === String(selectedAgentId);
    });
    const label = selected
      ? ((selected.agent_code || '').toUpperCase() + ' · ' + (selected.agent_name || '').toUpperCase())
      : '-';
    $('#guest_agent_id').val(selectedAgentId);
    $('#guest_agent_display').text(label);
    $('#guest_name_input').val('');
    $('#guest_remarks_input').val('');
    $('#modal-add-guest-table').modal('show');
  });

  $(document).on('agency:new-game-saved', function () {
    if (selectedAgencyId) {
      refreshSelectedAgencyPanels();
      loadLineStats(selectedAgencyId);
    } else {
      loadLineStats();
    }
    if (selectedAgentId) {
      setTimeout(function () {
        loadGuestsForSelectedAgent();
        loadAgentStats(selectedAgentId);
      }, 180);
    }
  });

  $(document).on('agency:account-transaction-saved', function () {
    if (selectedAgencyId) {
      refreshSelectedAgencyPanels();
      loadLineStats(selectedAgencyId);
    } else {
      loadLineStats();
    }

    if (selectedAgentId) {
      setTimeout(function () {
        loadGuestsForSelectedAgent();
        loadAgentStats(selectedAgentId);
      }, 180);
    }
  });

  $('#add_guest_form').on('submit', function (e) {
    e.preventDefault();
    const $form = $(this);
    const $btn = $('#btn-save-guest-table');
    const payload = $form.serialize();

    $btn.prop('disabled', true).text('Saving...');
    $.ajax({
      url: '/add_guest',
      type: 'POST',
      data: payload,
      success: function () {
        $('#modal-add-guest-table').modal('hide');
        Swal.fire({
          icon: 'success',
          title: 'Success',
          text: 'Guest has been added.',
          confirmButtonText: 'OK'
        });
        loadGuestsForSelectedAgent();
      },
      error: function (xhr) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: xhr.responseJSON?.error || 'Failed to add guest.',
          confirmButtonText: 'OK'
        });
      },
      complete: function () {
        $btn.prop('disabled', false).text('Save');
      }
    });
  });

  $('#edit_guest_form').on('submit', function (e) {
    e.preventDefault();
    const guestId = parseInt($('#edit_guest_id').val(), 10);
    const payload = $(this).serialize();
    const $btn = $('#btn-update-guest-table');

    if (!guestId) {
      Swal.fire({
        icon: 'warning',
        title: 'Invalid guest',
        text: 'Unable to update this guest.',
        confirmButtonText: 'OK'
      });
      return;
    }

    $btn.prop('disabled', true).text('Updating...');
    $.ajax({
      url: '/guest/' + encodeURIComponent(guestId),
      type: 'PUT',
      data: payload,
      success: function () {
        $('#modal-edit-guest-table').modal('hide');
        Swal.fire({
          icon: 'success',
          title: 'Success',
          text: 'Guest has been updated.',
          confirmButtonText: 'OK'
        });
        loadGuestsForSelectedAgent();
      },
      error: function (xhr) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: xhr.responseJSON?.error || 'Failed to update guest.',
          confirmButtonText: 'OK'
        });
      },
      complete: function () {
        $btn.prop('disabled', false).text('Update');
      }
    });
  });

  $(document).on('guest:created', function (_e, payload) {
    var agencyFromSave = payload && payload.agencyId ? parseInt(payload.agencyId, 10) : null;
    if (!selectedAgencyId) return;
    if (agencyFromSave && agencyFromSave !== selectedAgencyId) return;
    refreshSelectedAgencyPanels();
  });

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
        renderPage(allAgents, page);
      });
    },
    error: function(xhr, status, error) {
      console.error('Error fetching data:', error);
    }
  });
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

  currentPageData.forEach(function(row) {
    const permissions = parseInt($('#user-role').data('permissions'));
    const actionsHtml = permissions !== 2 ? `
      <button type="button"
        class="btn btn-outline-primary btn-sm"
        onclick="handleEditAgencyFromRow(${row.IDNo}, this)"
        data-bs-toggle="tooltip"
        title="Edit Line">
        <i class="fa fa-pen"></i>
      </button>
      <button type="button"
        class="btn btn-outline-danger btn-sm"
        onclick="checkPermissionToDeleteAgency(${row.IDNo})"
        data-bs-toggle="tooltip"
        title="Archive">
        <i class="fa fa-trash"></i>
      </button>
    ` : `
      <button type="button" class="btn btn-outline-secondary btn-sm" disabled title="Edit">
        <i class="fa fa-pen"></i>
      </button>
      <button type="button" class="btn btn-outline-danger btn-sm" disabled title="Archive">
        <i class="fa fa-trash"></i>
      </button>
    `;

    const cardHtml = `
    <div class="agency-card agency-list-item text-center" data-id="${row.IDNo}">
      <!-- Idagdag ang hidden input para sa memo -->
      <input type="hidden" class="hidden-memo" value="${row.REMARKS || ''}">

      <div class="agency-row-actions">
        ${actionsHtml}
      </div>

      <div class="agency-card-body py-3 px-2">
        <a 
          href="#" 
          onclick="selectAgencyLine(${row.IDNo}, this); return false;" 
          class="agency-name text-uppercase"
        >
          ${row.AGENCY}
        </a>
      </div>
    </div>
`;


  


  

    agencyGrid.append(cardHtml);
  });

  // Tooltip reset
  $('[data-bs-toggle="tooltip"]').tooltip();

  syncAgentPanelTransferButton();

  const $pager = $('#pagination-container');

  // Pagination para lang sa LINE list kapag mahigit sa isang page (default 30 kada page).
  // Itago kapag isa lang ang page para hindi lumabas ang pointless na "1".
  if (totalPages <= 1 || data.length === 0) {
    pagination.empty();
    $pager.addClass('d-none');
    return;
  }

  $pager.removeClass('d-none');

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

function selectAgencyLine(agencyId, anchorEl) {
  selectedAgencyId = parseInt(agencyId, 10);
  selectedAgentId = null;

  $('.agency-card').removeClass('is-selected');
  $(anchorEl).closest('.agency-card').addClass('is-selected');

  $('#txtAgencyLine').val(selectedAgencyId);
  setSelectedLineLabel($(anchorEl).text().trim());
  setSelectedAgentLabel('', '');

  syncAgentPanelTransferButton();

  refreshSelectedAgencyPanels();
  loadLineStats(selectedAgencyId);
  loadAgentStats(null);
}

function renderAgentPanel(accounts) {
  const $empty = $('#agent-panel-empty');
  const $list = $('#agent-list');
  const byAgent = {};

  (accounts || []).forEach(function (row) {
    const id = String(row.agent_id || '');
    if (!id) return;
    if (!byAgent[id]) {
      byAgent[id] = {
        agent_id: row.agent_id,
        agent_name: row.agent_name || '',
        agent_code: row.agent_code || ''
      };
    }
  });

  const agents = Object.values(byAgent);
  if (agents.length === 0) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text('No agents under this agency.');
    return;
  }

  const html = agents.map(function (agent) {
    var code = (agent.agent_code || '').toUpperCase();
    var name = (agent.agent_name || '').toUpperCase();
    var line = '';
    if (code && name) {
      line = '<span class="panel-list-code">' + code + '</span><span class="panel-list-sep">·</span><span class="panel-list-name">' + name + '</span>';
    } else {
      line = '<span class="panel-list-name">' + (code || name || '—') + '</span>';
    }
    return `
      <div class="panel-list-item" data-agent-id="${agent.agent_id}">
        <a href="#" class="panel-list-agent-link" onclick="selectAgentInPanel(${agent.agent_id}, this); return false;">${line}</a>
        <div class="panel-row-actions">
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            title="New Game"
            onclick="openAddGameForAgent(${agent.agent_id}, this)">
            <i class="fa fa-plus"></i>
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            title="Edit Agent"
            onclick="editAgentFromPanel(${agent.agent_id}, this)">
            <i class="fa fa-pen"></i>
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            title="View Portal"
            onclick="viewAgentPortal(${agent.agent_id}, '${escapeJsString(agent.agent_code || '')}', '${escapeJsString(agent.agent_name || '')}', this)">
            <i class="fa fa-eye"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  $list.html(html).removeClass('d-none');
  $empty.addClass('d-none');
}

function selectAgentInPanel(agentId, anchorEl) {
  selectedAgentId = parseInt(agentId, 10);
  $('#agent-list .panel-list-item').removeClass('is-active');
  $(anchorEl).closest('.panel-list-item').addClass('is-active');
  const selected = currentAgencyAccounts.find(function (row) {
    return String(row.agent_id) === String(selectedAgentId);
  });
  setSelectedAgentLabel(selected ? selected.agent_code : '', selected ? selected.agent_name : '');
  loadGuestsForSelectedAgent();
  loadAgentStats(selectedAgentId);
  syncAgentPanelTransferButton();
}

function openAddGameForAgent(agentId, buttonEl) {
  selectedAgentId = parseInt(agentId, 10);
  $('#agent-list .panel-list-item').removeClass('is-active');
  $(buttonEl).closest('.panel-list-item').addClass('is-active');
  syncAgentPanelTransferButton();
  openAddGameForSelectedAgent();
}

function loadGuestsForSelectedAgent() {
  if (!selectedAgentId) {
    currentGuestRows = [];
    renderGuestPanel([]);
    return;
  }
  $.ajax({
    url: '/guest_data?agentId=' + encodeURIComponent(selectedAgentId),
    method: 'GET',
    success: function (rows) {
      currentGuestRows = Array.isArray(rows) ? rows : [];
      renderGuestPanel(currentGuestRows);
    },
    error: function () {
      currentGuestRows = [];
      renderGuestPanel([]);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Failed to load guests for this agent.',
        confirmButtonText: 'OK'
      });
    }
  });
}

function viewAgentPortal(agentId, agentCode, _agentName, buttonEl) {
  selectedAgentId = parseInt(agentId, 10);
  $('#agent-list .panel-list-item').removeClass('is-active');
  $(buttonEl).closest('.panel-list-item').addClass('is-active');

  if (!selectedAgencyId) {
    Swal.fire({
      icon: 'warning',
      title: 'No agency selected',
      text: 'Select an AGENCY/LINE first.',
      confirmButtonText: 'OK'
    });
    return;
  }

  const target = currentAgencyAccounts.find(function (row) {
    return String(row.agent_id) === String(selectedAgentId);
  });

  if (!target || !target.account_id || typeof window.account_details !== 'function') {
    Swal.fire({
      icon: 'warning',
      title: 'No guest record',
      text: 'No guest account found for this agent yet.',
      confirmButtonText: 'OK'
    });
    return;
  }

  window.account_details(
    target.account_id,
    target.agent_code || agentCode || '',
    target.agent_name || _agentName || ''
  );
}

function editAgentFromPanel(agentId, buttonEl) {
  selectedAgentId = parseInt(agentId, 10);
  $('#agent-list .panel-list-item').removeClass('is-active');
  $(buttonEl).closest('.panel-list-item').addClass('is-active');

  const target = currentAgencyAccounts.find(function (row) {
    return String(row.agent_id) === String(selectedAgentId);
  });

  if (!target || typeof window.edit_agent !== 'function') {
    Swal.fire({
      icon: 'warning',
      title: 'Unavailable',
      text: 'Agent edit is not available for this row.',
      confirmButtonText: 'OK'
    });
    return;
  }

  window.edit_agent(
    target.agent_id,
    target.agent_code || '',
    target.agent_name || '',
    target.agent_contact || '',
    target.agent_telegram || '',
    target.agent_remarks || ''
  );
}

function renderGuestPanel(guests) {
  const $empty = $('#guest-panel-empty');
  const $list = $('#guest-list');
  const rows = Array.isArray(guests) ? guests : [];

  if (!selectedAgencyId) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text('Open an agency to view guests.');
    return;
  }

  if (!selectedAgentId) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text('Select AGENT to load guest list.');
    return;
  }

  if (rows.length === 0) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text('No guest found under this agent.');
    return;
  }

  const htmlRows = rows.map(function (row) {
    const permissions = parseInt($('#user-role').data('permissions'), 10);
    const name = row.guest_name || row.NAME || '-';
    const remarks = String(row.guest_remarks || row.REMARKS || '').trim();
    const games = formatLineStatNumber(row.total_games || row.games || 0);
    const rolling = formatLineStatNumber(row.total_rolling || row.rolling || 0);
    const winloss = formatLineStatNumber(row.total_winloss || row.winloss || 0);
    const commission = formatLineStatNumber(row.total_commission || row.commission || 0);
    const safeName = String(name).toUpperCase();
    const guestNameHtml = remarks
      ? `<button
          type="button"
          class="btn btn-link p-0 agency-guest-remarks-link"
          title="View Remarks"
          onclick="openGuestRemarks(${row.guest_id || 0})">${safeName}</button>`
      : safeName;
    const editButtonHtml = permissions !== 2 ? `
          <button
            type="button"
            class="btn btn-link p-0 me-2 agency-guest-plus-btn"
            title="Edit Guest"
            onclick="openEditGuestModal(${row.guest_id || 0})">
            <i class="fa fa-pen"></i>
          </button>
    ` : '';
    return `
      <tr>
        <td>${guestNameHtml}</td>
        <td>${games}</td>
        <td>${rolling}</td>
        <td>${winloss}</td>
        <td>${commission}</td>
        <td>
          <button
            type="button"
            class="btn btn-link p-0 me-2 agency-guest-plus-btn"
            title="New Game"
            onclick="openAddGameForGuest(${row.guest_id || 0})">
            <i class="fa fa-plus"></i>
          </button>
          ${editButtonHtml}
          <button
            type="button"
            class="btn btn-link p-0 agency-guest-plus-btn"
            title="Game History"
            onclick="openGuestGameHistory(${row.guest_id || 0})">
            <i class="fa fa-history"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  const tableHtml = `
    <div class="table-responsive">
      <table class="table table-sm mb-0 agency-guest-table">
        <thead>
          <tr>
          
            <th>Guest</th>
            <th>Games</th>
            <th>Rolling</th>
            <th>Winloss</th>
            <th>Commission</th>
              <th style="width: 72px;"></th>
          </tr>
        </thead>
        <tbody>
          ${htmlRows}
        </tbody>
      </table>
    </div>
  `;

  $list.html(tableHtml).removeClass('d-none');
  $empty.addClass('d-none');
}

function openGuestRemarks(guestId) {
  const numericGuestId = parseInt(guestId, 10);
  const target = currentGuestRows.find(function (row) {
    return String(row.guest_id) === String(numericGuestId);
  });
  const remarks = String(target?.guest_remarks || target?.REMARKS || '').trim();

  if (!remarks) return;

  Swal.fire({
    icon: 'info',
    title: 'Remarks',
    text: remarks,
    confirmButtonText: 'OK'
  });
}

function openEditGuestModal(guestId) {
  const numericGuestId = parseInt(guestId, 10);
  if (!numericGuestId) {
    Swal.fire({
      icon: 'warning',
      title: 'Invalid guest',
      text: 'Unable to edit this guest.',
      confirmButtonText: 'OK'
    });
    return;
  }

  const target = currentGuestRows.find(function (row) {
    return String(row.guest_id) === String(numericGuestId);
  });

  if (!target) {
    Swal.fire({
      icon: 'warning',
      title: 'Not found',
      text: 'Guest record is not available.',
      confirmButtonText: 'OK'
    });
    return;
  }

  $('#edit_guest_id').val(target.guest_id || '');
  $('#edit_guest_name_input').val(target.guest_name || target.NAME || '');
  $('#edit_guest_remarks_input').val(target.guest_remarks || target.REMARKS || '');
  $('#modal-edit-guest-table').modal('show');
}

function handleEditAgencyFromRow(id, buttonEl) {
  const selectedRow = $(buttonEl).closest('.agency-card');
  const agencyName = selectedRow.find('.agency-name').text().trim();
  const memo = selectedRow.find('.hidden-memo').val() || '';
  edit_agency(id, agencyName, memo);
}

function fetchAndApplyAvailableChipsForNewGameModal() {
  $.ajax({
    url: '/game_list_available_chips',
    method: 'GET',
    success: function (payload) {
      var nn = Number(payload && payload.availableNN) || 0;
      var cc = Number(payload && payload.availableCC) || 0;
      $('#availableNN').text(nn.toLocaleString());
      $('#availableCC').text(cc.toLocaleString());
    },
    error: function () {
      $('#availableNN').text('0');
      $('#availableCC').text('0');
    }
  });
}

function openAddGameForGuest(guestId) {
  var numericGuestId = parseInt(guestId, 10);
  if (!selectedAgentId || !numericGuestId) {
    Swal.fire({
      icon: 'warning',
      title: 'Selection required',
      text: 'Select AGENT and valid GUEST first.',
      confirmButtonText: 'OK'
    });
    return;
  }

  var accountRow = currentAgencyAccounts.find(function (row) {
    return String(row.agent_id) === String(selectedAgentId) && row.account_id;
  });

  if (!accountRow || !accountRow.account_id) {
    Swal.fire({
      icon: 'warning',
      title: 'No account found',
      text: 'No account is linked to this agent yet.',
      confirmButtonText: 'OK'
    });
    return;
  }

  if (typeof window.addGameList !== 'function') {
    Swal.fire({
      icon: 'error',
      title: 'Unavailable',
      text: 'Add Game modal is not available right now.',
      confirmButtonText: 'OK'
    });
    return;
  }

  window.addGameList(accountRow.account_id);

  var accountIdText = String(accountRow.account_id);
  var guestIdText = String(numericGuestId);
  var openingBalance = Number(accountRow.total_balance || accountRow.total_ledger_amount || 0);

  function applyNewGameAvailableBalance(balance) {
    var safe = Number(balance) || 0;
    $('#total_balanceGuest1').val(safe);
    $('#total_balanceGuestGameList').val(safe.toLocaleString());
  }

  var applyDefaults = function (attempt) {
    var tryNo = attempt || 0;
    var $accountSelect = $('#txtTrans');
    var $guestSelect = $('#txtGuestGame');

    if (!$accountSelect.length || !$guestSelect.length) {
      if (tryNo < 15) setTimeout(function () { applyDefaults(tryNo + 1); }, 120);
      return;
    }

    if ($accountSelect.find('option[value="' + accountIdText + '"]').length === 0) {
      if (tryNo < 20) setTimeout(function () { applyDefaults(tryNo + 1); }, 120);
      return;
    }

    $accountSelect.val(accountIdText).trigger('change');
    $accountSelect.attr('data-readonly', '1');
    $accountSelect.attr('data-locked-value', accountIdText);
    applyNewGameAvailableBalance(openingBalance);
    fetchAndApplyAvailableChipsForNewGameModal();

    setTimeout(function () {
      if ($guestSelect.find('option[value="' + guestIdText + '"]').length > 0) {
        $guestSelect.val(guestIdText).trigger('change');
        $guestSelect.attr('data-readonly', '1');
        $guestSelect.attr('data-locked-value', guestIdText);
      } else if (tryNo < 20) {
        applyDefaults(tryNo + 1);
      }
    }, 140);
  };

  setTimeout(function () { applyDefaults(0); }, 120);
}

function openGuestGameHistory(guestId) {
  var numericGuestId = parseInt(guestId, 10);
  if (!selectedAgentId || !numericGuestId) {
    Swal.fire({
      icon: 'warning',
      title: 'Selection required',
      text: 'Select AGENT and valid GUEST first.',
      confirmButtonText: 'OK'
    });
    return;
  }

  var accountRow = currentAgencyAccounts.find(function (row) {
    return String(row.agent_id) === String(selectedAgentId) && String(row.guest_id || '') === String(numericGuestId) && row.account_id;
  }) || currentAgencyAccounts.find(function (row) {
    return String(row.agent_id) === String(selectedAgentId) && row.account_id;
  });

  if (!accountRow || !accountRow.account_id) {
    Swal.fire({
      icon: 'warning',
      title: 'No account found',
      text: 'No account is linked to this agent yet.',
      confirmButtonText: 'OK'
    });
    return;
  }

  if (typeof window.game_history !== 'function') {
    Swal.fire({
      icon: 'error',
      title: 'Unavailable',
      text: 'Game History modal is not available right now.',
      confirmButtonText: 'OK'
    });
    return;
  }

  window.game_history(accountRow.account_id, numericGuestId);
}

function openAddGameForSelectedAgent() {
  if (!selectedAgentId) {
    Swal.fire({
      icon: 'warning',
      title: 'Selection required',
      text: 'Select AGENT first.',
      confirmButtonText: 'OK'
    });
    return;
  }

  var accountRow = currentAgencyAccounts.find(function (row) {
    return String(row.agent_id) === String(selectedAgentId) && row.account_id;
  });

  if (!accountRow || !accountRow.account_id) {
    Swal.fire({
      icon: 'warning',
      title: 'No account found',
      text: 'No account is linked to this agent yet.',
      confirmButtonText: 'OK'
    });
    return;
  }

  if (typeof window.addGameList !== 'function') {
    Swal.fire({
      icon: 'error',
      title: 'Unavailable',
      text: 'Add Game modal is not available right now.',
      confirmButtonText: 'OK'
    });
    return;
  }

  window.addGameList(accountRow.account_id);

  var accountIdText = String(accountRow.account_id);
  var openingBalance = Number(accountRow.total_balance || accountRow.total_ledger_amount || 0);

  var applyDefaults = function (attempt) {
    var tryNo = attempt || 0;
    var $accountSelect = $('#txtTrans');
    if (!$accountSelect.length) {
      if (tryNo < 15) setTimeout(function () { applyDefaults(tryNo + 1); }, 120);
      return;
    }
    if ($accountSelect.find('option[value="' + accountIdText + '"]').length === 0) {
      if (tryNo < 20) setTimeout(function () { applyDefaults(tryNo + 1); }, 120);
      return;
    }
    $accountSelect.val(accountIdText).trigger('change');
    $accountSelect.attr('data-readonly', '1');
    $accountSelect.attr('data-locked-value', accountIdText);
    $('#total_balanceGuest1').val(openingBalance);
    $('#total_balanceGuestGameList').val(openingBalance.toLocaleString());
    fetchAndApplyAvailableChipsForNewGameModal();
  };

  setTimeout(function () { applyDefaults(0); }, 120);
}

function openTransferForSelectedAgency() {
  if (!selectedAgencyId) {
    Swal.fire({
      icon: 'warning',
      title: 'No agency selected',
      text: 'Select an AGENCY/LINE first.',
      confirmButtonText: 'OK'
    });
    return;
  }
  var $row = $('.agency-card.is-selected');
  var agencyName = $row.length ? $row.find('.agency-name').text().trim() : '';
  if (typeof window.openTransferAgencyModalForAgency === 'function') {
    window.openTransferAgencyModalForAgency(String(selectedAgencyId), agencyName || 'Agent', []);
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