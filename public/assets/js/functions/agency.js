var agency_id;
let allAgents = [];
let selectedAgencyId = null;
let currentAgencyAccounts = [];
let selectedAgentId = null;
let currentGuestRows = [];
let currentAgencyGuestRows = [];
let currentAllGuestRows = [];
let guestSearchQuery = '';
let transferGuestCurrentAgentId = null;

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
      refreshGuestPanels();
    },
    error: function () {
      currentAgencyAccounts = [];
      selectedAgentId = null;
      renderAgentPanel([]);
      currentGuestRows = [];
      currentAgencyGuestRows = [];
      applyGuestPanelView();
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
  loadAllGuestsForSearch();

  syncAgentPanelTransferButton();

  $('#guest-panel-search').on('input', function () {
    guestSearchQuery = $(this).val();
    applyGuestPanelView();
  });

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
        text: 'Select a LINE first to export LINE and guests.',
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
        text: 'Select a LINE first.',
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
    $('#guest_membership_input').val('');
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
        refreshGuestPanels();
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
        refreshGuestPanels();
        loadAgentStats(selectedAgentId);
      }, 180);
    }
  });

  $('#add_guest_form').on('submit', function (e) {
    e.preventDefault();
    const $form = $(this);
    const $btn = $('#btn-save-guest-table');
    const membershipError = typeof window.validateGuestMembershipNo === 'function'
      ? window.validateGuestMembershipNo($('#guest_membership_input').val())
      : '';
    if (membershipError) {
      Swal.fire({
        icon: 'warning',
        title: 'Invalid Membership No',
        text: membershipError,
        confirmButtonText: 'OK'
      });
      return;
    }
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
        refreshGuestPanels();
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

  $('#transfer_guest_agency_id').on('change', function () {
    const agencyId = parseInt($(this).val(), 10);
    loadTransferGuestAgentOptions(agencyId, transferGuestCurrentAgentId);
  });

  $('#btn-open-transfer-from-edit-guest').on('click', function () {
    const guestId = parseInt($('#edit_guest_id').val(), 10);
    if (!guestId) return;
    $('#modal-edit-guest-table').modal('hide');
    openTransferGuestModal(guestId);
  });

  $('#transfer_guest_form').on('submit', function (e) {
    e.preventDefault();
    const guestId = parseInt($('#transfer_guest_id').val(), 10);
    const targetAgentId = parseInt($('#transfer_guest_agent_id').val(), 10);
    const $btn = $('#btn-transfer-guest-table');

    if (!guestId || !targetAgentId) {
      Swal.fire({
        icon: 'warning',
        title: 'Selection required',
        text: 'Select a target agency and LINE.',
        confirmButtonText: 'OK'
      });
      return;
    }

    $btn.prop('disabled', true).text('Transferring...');
    $.ajax({
      url: '/guest/' + encodeURIComponent(guestId) + '/transfer',
      type: 'PUT',
      contentType: 'application/json',
      data: JSON.stringify({ targetAgentId: targetAgentId }),
      success: function (res) {
        $('#modal-transfer-guest-table').modal('hide');
        const toAgency = res?.to?.agency_name || '';
        const toLine = [res?.to?.agent_code, res?.to?.agent_name].filter(Boolean).join(' · ');
        Swal.fire({
          icon: 'success',
          title: 'Transferred',
          text: 'Guest moved to ' + [toAgency, toLine].filter(Boolean).join(' · ') + '.',
          confirmButtonText: 'OK'
        });
        refreshGuestPanels();
      },
      error: function (xhr) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: xhr.responseJSON?.error || 'Failed to transfer guest.',
          confirmButtonText: 'OK'
        });
      },
      complete: function () {
        $btn.prop('disabled', false).text('Transfer');
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
        refreshGuestPanels();
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
          text: 'LINE updated successfully!',
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
        class="btn btn-sm agency-icon-btn"
        onclick="handleEditAgencyFromRow(${row.IDNo}, this)"
        data-bs-toggle="tooltip"
        title="Edit LINE">
        <i class="fa fa-pen"></i>
      </button>
      <button type="button"
        class="btn btn-sm agency-icon-btn agency-icon-btn-danger"
        onclick="checkPermissionToDeleteAgency(${row.IDNo})"
        data-bs-toggle="tooltip"
        title="Archive">
        <i class="fa fa-trash"></i>
      </button>
    ` : `
      <button type="button" class="btn btn-sm agency-icon-btn" disabled title="Edit">
        <i class="fa fa-pen"></i>
      </button>
      <button type="button" class="btn btn-sm agency-icon-btn agency-icon-btn-danger" disabled title="Archive">
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

  applyAgencySearchHighlights(getGuestSearchMatchSets().matchedAgencyIds);

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
  currentGuestRows = [];

  syncAgentPanelTransferButton();

  refreshSelectedAgencyPanels();
  loadLineStats(selectedAgencyId);
  loadAgentStats(null);
}

function renderAgentPanel(accounts, options) {
  const opts = options || {};
  const searching = !!opts.searching;
  const matchedAgentIds = opts.matchedAgentIds || null;
  const showAgencyHint = !!opts.showAgencyHint;
  const $empty = $('#agent-panel-empty');
  const $list = $('#agent-list');
  const byAgent = {};

  const sourceRows = Array.isArray(opts.overrideAgents) && opts.overrideAgents.length
    ? opts.overrideAgents
    : (accounts || []);

  sourceRows.forEach(function (row) {
    const id = String(row.agent_id || '');
    if (!id) return;
    if (!byAgent[id]) {
      byAgent[id] = {
        agent_id: row.agent_id,
        agent_name: row.agent_name || '',
        agent_code: row.agent_code || '',
        agency_id: row.agency_id || null,
        agency_name: row.agency_name || ''
      };
    }
  });

  let agents = Object.values(byAgent);
  if (searching && matchedAgentIds && matchedAgentIds.size) {
    agents = agents.filter(function (agent) {
      return matchedAgentIds.has(String(agent.agent_id));
    });
  }

  if (!selectedAgencyId && !searching) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text('Select LINE to load LINE list.');
    return;
  }

  if (agents.length === 0) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text(
      searching ? 'No LINE matched your search.' : 'No LINE under this agency.'
    );
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
    const agencyHint = (showAgencyHint && agent.agency_name)
      ? '<span class="panel-list-agency-hint">' + String(agent.agency_name).toUpperCase() + '</span>'
      : '';
    const isMatch = searching && matchedAgentIds && matchedAgentIds.has(String(agent.agent_id));
    const isDim = searching && matchedAgentIds && !matchedAgentIds.has(String(agent.agent_id));
    const isSelected = selectedAgentId && String(agent.agent_id) === String(selectedAgentId);
    const itemClasses = [
      'panel-list-item',
      isSelected ? 'is-active' : '',
      isMatch ? 'is-search-match' : '',
      isDim ? 'is-search-dim' : ''
    ].filter(Boolean).join(' ');
    return `
      <div class="${itemClasses}" data-agent-id="${agent.agent_id}">
        <a href="#" class="panel-list-agent-link" onclick="selectAgentInPanel(${agent.agent_id}, this); return false;">${line}${agencyHint}</a>
        <div class="panel-row-actions">
          <button
            type="button"
            class="btn btn-sm agency-icon-btn"
            title="New Game"
            onclick="openAddGameForAgent(${agent.agent_id}, this)">
            <i class="fa fa-plus"></i>
          </button>
          <button
            type="button"
            class="btn btn-sm agency-icon-btn"
            title="Edit LINE"
            onclick="editAgentFromPanel(${agent.agent_id}, this)">
            <i class="fa fa-pen"></i>
          </button>
          <button
            type="button"
            class="btn btn-sm agency-icon-btn"
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

  if (!selectedAgencyId) {
    const agentGuest = currentAllGuestRows.find(function (row) {
      return String(row.agent_id) === String(selectedAgentId);
    });
    if (agentGuest && agentGuest.agency_id) {
      selectedAgencyId = parseInt(agentGuest.agency_id, 10);
      $('.agency-card').removeClass('is-selected');
      $('.agency-card[data-id="' + selectedAgencyId + '"]').addClass('is-selected');
      $('#txtAgencyLine').val(selectedAgencyId);
      setSelectedLineLabel(agentGuest.agency_name || '');
      $.ajax({
        url: '/account_data?agencyId=' + encodeURIComponent(selectedAgencyId),
        method: 'GET',
        success: function (rows) {
          currentAgencyAccounts = Array.isArray(rows) ? rows : [];
          applyGuestSearchReactions();
          $('#agent-list .panel-list-item[data-agent-id="' + selectedAgentId + '"]').addClass('is-active');
        }
      });
      loadLineStats(selectedAgencyId);
    }
  }

  const selected = currentAgencyAccounts.find(function (row) {
    return String(row.agent_id) === String(selectedAgentId);
  });
  setSelectedAgentLabel(selected ? selected.agent_code : '', selected ? selected.agent_name : '');
  if (!isGuestSearchActive()) {
    loadGuestsForSelectedAgent();
  }
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

function normalizeGuestSearchText(value) {
  return String(value || '').toLowerCase().trim();
}

function isGuestSearchActive() {
  return normalizeGuestSearchText(guestSearchQuery).length > 0;
}

function getGuestSearchableText(row) {
  const name = row.guest_name || row.NAME || '';
  const membershipNo = String(row.membership_no || row.MEMBERSHIP_NO || '').trim();
  const agentCode = row.agent_code || '';
  const agentName = row.agent_name || '';
  const agencyName = row.agency_name || '';
  const remarks = row.guest_remarks || row.REMARKS || '';
  const displayLabel = membershipNo
    ? (membershipNo + '-' + String(name).toUpperCase())
    : String(name).toUpperCase();
  return normalizeGuestSearchText([
    membershipNo,
    name,
    displayLabel,
    agentCode,
    agentName,
    agencyName,
    remarks
  ].join(' '));
}

function filterGuestRows(rows, query) {
  const normalizedQuery = normalizeGuestSearchText(query);
  if (!normalizedQuery) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter(function (row) {
    return getGuestSearchableText(row).indexOf(normalizedQuery) !== -1;
  });
}

function getGuestSearchMatchSets() {
  if (!isGuestSearchActive()) {
    return { matchedAgencyIds: null, matchedAgentIds: null, matches: [] };
  }
  const matches = filterGuestRows(currentAllGuestRows, guestSearchQuery);
  const matchedAgencyIds = new Set();
  const matchedAgentIds = new Set();
  matches.forEach(function (row) {
    if (row.agency_id != null) matchedAgencyIds.add(String(row.agency_id));
    if (row.agent_id != null) matchedAgentIds.add(String(row.agent_id));
  });
  return { matchedAgencyIds: matchedAgencyIds, matchedAgentIds: matchedAgentIds, matches: matches };
}

function buildAgentsFromGuestRows(guestRows, agencyIdFilter) {
  const map = {};
  (guestRows || []).forEach(function (row) {
    const agentId = row.agent_id;
    if (!agentId) return;
    if (agencyIdFilter && String(row.agency_id) !== String(agencyIdFilter)) return;
    const key = String(agentId);
    if (!map[key]) {
      map[key] = {
        agent_id: row.agent_id,
        agent_code: row.agent_code || '',
        agent_name: row.agent_name || '',
        agency_id: row.agency_id || null,
        agency_name: row.agency_name || ''
      };
    }
  });
  return Object.values(map);
}

function applyAgencySearchHighlights(matchedAgencyIds) {
  const searching = isGuestSearchActive();
  $('.agency-card').each(function () {
    const $card = $(this);
    const id = String($card.data('id'));
    if (!searching) {
      $card.removeClass('is-search-match is-search-dim');
      return;
    }
    const isMatch = matchedAgencyIds && matchedAgencyIds.has(id);
    $card.toggleClass('is-search-match', !!isMatch);
    $card.toggleClass('is-search-dim', !isMatch);
  });
}

function applyGuestSearchReactions() {
  const searching = isGuestSearchActive();
  const matchSets = getGuestSearchMatchSets();

  applyAgencySearchHighlights(matchSets.matchedAgencyIds);
  applyGuestSearchLineStats();

  if (!searching) {
    if (selectedAgencyId) {
      renderAgentPanel(currentAgencyAccounts);
    } else {
      renderAgentPanel([]);
    }
    return;
  }

  if (selectedAgencyId) {
    renderAgentPanel(currentAgencyAccounts, {
      searching: true,
      matchedAgentIds: matchSets.matchedAgentIds
    });
    return;
  }

  renderAgentPanel([], {
    searching: true,
    matchedAgentIds: matchSets.matchedAgentIds,
    overrideAgents: buildAgentsFromGuestRows(matchSets.matches),
    showAgencyHint: true
  });
}

function sumGuestSearchMetrics(matches) {
  let totalRolling = 0;
  let totalWinloss = 0;
  let totalCommission = 0;
  (matches || []).forEach(function (row) {
    totalRolling += Number(row.total_rolling) || 0;
    totalWinloss += Number(row.total_winloss) || 0;
    totalCommission += Number(row.total_commission) || 0;
  });
  return {
    total_rolling: totalRolling,
    total_winloss: totalWinloss,
    total_commission: totalCommission
  };
}

function getSearchScopedAgentIds(matchSets) {
  const matches = matchSets.matches || [];
  if (selectedAgencyId) {
    return buildAgentsFromGuestRows(matches, selectedAgencyId).map(function (agent) {
      return String(agent.agent_id);
    });
  }
  return Array.from(matchSets.matchedAgentIds || []);
}

function applyGuestSearchLineStats() {
  if (!isGuestSearchActive()) {
    if (selectedAgentId) {
      loadAgentStats(selectedAgentId);
      return;
    }
    loadLineStats(selectedAgencyId || undefined);
    return;
  }

  const matchSets = getGuestSearchMatchSets();
  const matches = matchSets.matches || [];
  const metrics = sumGuestSearchMetrics(matches);
  const agencyIds = Array.from(matchSets.matchedAgencyIds || []);
  const scopedAgentIds = getSearchScopedAgentIds(matchSets);
  const isSingleScope = !!selectedAgencyId || agencyIds.length <= 1;

  function renderSearchLineStats(balanceCredit) {
    renderLineStats({
      total_line: agencyIds.length,
      total_agent: scopedAgentIds.length,
      total_rolling: metrics.total_rolling,
      total_winloss: metrics.total_winloss,
      total_commission: metrics.total_commission,
      total_balance: Number(balanceCredit?.total_balance) || 0,
      total_credit: Number(balanceCredit?.total_credit) || 0
    }, isSingleScope);
    $('#line-stat-row').removeClass('d-none');
    $('#agent-stat-row').addClass('d-none');
  }

  if (!scopedAgentIds.length) {
    renderSearchLineStats({ total_balance: 0, total_credit: 0 });
    return;
  }

  const query = { agentIds: scopedAgentIds.join(',') };
  if (selectedAgencyId) {
    query.agencyId = selectedAgencyId;
  }

  $.ajax({
    url: '/agency_line_stats?' + $.param(query),
    method: 'GET',
    success: function (stats) {
      renderSearchLineStats(stats);
    },
    error: function () {
      renderSearchLineStats({ total_balance: 0, total_credit: 0 });
    }
  });
}

function getGuestRowById(guestId) {
  const id = String(guestId);
  return currentAllGuestRows.find(function (row) {
    return String(row.guest_id) === id;
  }) || currentAgencyGuestRows.find(function (row) {
    return String(row.guest_id) === id;
  }) || currentGuestRows.find(function (row) {
    return String(row.guest_id) === id;
  });
}

function applyGuestPanelView() {
  const searching = isGuestSearchActive();
  const rows = searching
    ? filterGuestRows(currentAllGuestRows, guestSearchQuery)
    : currentGuestRows;
  renderGuestPanel(rows, { searching: searching });
  applyGuestSearchReactions();
}

function loadAllGuestsForSearch() {
  $.ajax({
    url: '/guest_data?all=1',
    method: 'GET',
    success: function (rows) {
      currentAllGuestRows = Array.isArray(rows) ? rows : [];
      applyGuestPanelView();
    },
    error: function () {
      currentAllGuestRows = [];
      applyGuestPanelView();
    }
  });
}

function loadGuestsForAgency() {
  if (!selectedAgencyId) {
    currentAgencyGuestRows = [];
    applyGuestPanelView();
    return;
  }
  $.ajax({
    url: '/guest_data?agencyId=' + encodeURIComponent(selectedAgencyId),
    method: 'GET',
    success: function (rows) {
      currentAgencyGuestRows = Array.isArray(rows) ? rows : [];
      applyGuestPanelView();
    },
    error: function () {
      currentAgencyGuestRows = [];
      applyGuestPanelView();
    }
  });
}

function loadGuestsForSelectedAgent() {
  if (!selectedAgentId) {
    currentGuestRows = [];
    applyGuestPanelView();
    return;
  }
  $.ajax({
    url: '/guest_data?agentId=' + encodeURIComponent(selectedAgentId),
    method: 'GET',
    success: function (rows) {
      currentGuestRows = Array.isArray(rows) ? rows : [];
      applyGuestPanelView();
    },
    error: function () {
      currentGuestRows = [];
      applyGuestPanelView();
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Failed to load guests for this LINE.',
        confirmButtonText: 'OK'
      });
    }
  });
}

function refreshGuestPanels() {
  loadAllGuestsForSearch();
  loadGuestsForAgency();
  if (selectedAgentId) {
    loadGuestsForSelectedAgent();
  } else {
    currentGuestRows = [];
    applyGuestPanelView();
  }
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
      text: 'LINE edit is not available for this row.',
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

function renderGuestPanel(guests, options) {
  const opts = options || {};
  const searching = !!opts.searching;
  const $empty = $('#guest-panel-empty');
  const $list = $('#guest-list');
  const rows = Array.isArray(guests) ? guests : [];

  if (!selectedAgencyId && !searching) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text('Search guests or select a LINE to view guests.');
    return;
  }

  if (!searching && !selectedAgentId) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text('Select LINE to load guest list.');
    return;
  }

  if (rows.length === 0) {
    $list.addClass('d-none').empty();
    $empty.removeClass('d-none').text(
      searching ? 'No guest found matching your search.' : 'No guest found under this LINE.'
    );
    return;
  }

  const htmlRows = rows.map(function (row) {
    const permissions = parseInt($('#user-role').data('permissions'), 10);
    const name = row.guest_name || row.NAME || '-';
    const membershipNo = String(row.membership_no || row.MEMBERSHIP_NO || '').trim();
    const remarks = String(row.guest_remarks || row.REMARKS || '').trim();
    const games = formatLineStatNumber(row.total_games || row.games || 0);
    const rolling = formatLineStatNumber(row.total_rolling || row.rolling || 0);
    const winloss = formatLineStatNumber(row.total_winloss || row.winloss || 0);
    const commission = formatLineStatNumber(row.total_commission || row.commission || 0);
    const safeName = String(name).toUpperCase();
    const displayMembershipNo = membershipNo || '—';
    const agentCode = String(row.agent_code || '').trim().toUpperCase();
    const agentName = String(row.agent_name || '').trim().toUpperCase();
    const agentLineLabel = agentCode && agentName
      ? (agentCode + ' · ' + agentName)
      : (agentCode || agentName || '');
    const agencyName = String(row.agency_name || '').trim().toUpperCase();
    const lineHintParts = searching
      ? [agencyName, agentLineLabel].filter(Boolean)
      : (agentLineLabel ? [agentLineLabel] : []);
    const lineHint = lineHintParts.join(' · ');
    const guestNameHtml = permissions !== 2
      ? `<button
          type="button"
          class="btn btn-link p-0 agency-guest-remarks-link"
          title="${remarks ? 'View / Edit Remarks' : 'Add Remarks'}"
          onclick="openGuestRemarks(${row.guest_id || 0})">${safeName}</button>`
      : (remarks
          ? `<button
              type="button"
              class="btn btn-link p-0 agency-guest-remarks-link"
              title="View Remarks"
              onclick="openGuestRemarks(${row.guest_id || 0})">${safeName}</button>`
          : safeName);
    const guestCellHtml = searching && lineHint
      ? `<div>${guestNameHtml}</div><div class="agency-guest-line-hint text-muted">${lineHint}</div>`
      : guestNameHtml;
    const editButtonHtml = permissions !== 2 ? `
          <button
            type="button"
            class="btn btn-link p-0 me-2 agency-guest-plus-btn"
            title="Edit Guest"
            onclick="openEditGuestModal(${row.guest_id || 0})">
            <i class="fa fa-pen"></i>
          </button>
          <button
            type="button"
            class="btn btn-link p-0 me-2 agency-guest-plus-btn"
            title="Change LINE"
            onclick="openTransferGuestModal(${row.guest_id || 0})">
            <i class="fa fa-exchange-alt"></i>
          </button>
    ` : '';
    return `
      <tr>
        <td class="agency-guest-col">${guestCellHtml}</td>
        <td class="agency-guest-membership-col">${displayMembershipNo}</td>
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
          
            <th class="agency-guest-col">Guest</th>
            <th class="agency-guest-membership-col">Membership #</th>
            <th>Games</th>
            <th>Rolling</th>
            <th>Winloss</th>
            <th>Commission</th>
              <th style="width: 96px;"></th>
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
  const target = getGuestRowById(numericGuestId);
  if (!target || !numericGuestId) return;

  const remarks = String(target.guest_remarks || target.REMARKS || '').trim();
  const guestName = String(target.guest_name || target.NAME || '').trim();

  if (window.RemarksEditor && window.RemarksEditor.canEdit()) {
    window.RemarksEditor.openEditor(remarks, function (newVal) {
      window.RemarksEditor.patchRemarks('guest', numericGuestId, newVal, {
        onSuccess: function () {
          target.guest_remarks = newVal;
          target.REMARKS = newVal;
          if (window.Swal) {
            window.Swal.fire({ icon: 'success', title: 'Saved', text: 'Guest remarks updated.', timer: 1500, showConfirmButton: false });
          }
        },
        onError: function (err) {
          if (window.Swal) {
            window.Swal.fire({ icon: 'error', title: 'Error', text: (err && err.message) || 'Could not update remarks.' });
          }
        }
      });
    });
    return;
  }

  Swal.fire({
    icon: 'info',
    title: guestName || 'Remarks',
    text: remarks || 'No remarks.',
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

  const target = getGuestRowById(numericGuestId);

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
  $('#edit_guest_membership_input').val(target.membership_no || target.MEMBERSHIP_NO || '');
  $('#edit_guest_name_input').val(target.guest_name || target.NAME || '');
  $('#edit_guest_remarks_input').val(target.guest_remarks || target.REMARKS || '');
  $('#modal-edit-guest-table').modal('show');
}

function buildGuestLineLabel(agencyName, agentCode, agentName) {
  const agency = String(agencyName || '').trim().toUpperCase();
  const code = String(agentCode || '').trim().toUpperCase();
  const name = String(agentName || '').trim().toUpperCase();
  const line = code && name ? (code + ' · ' + name) : (code || name || '');
  if (agency && line) return agency + ' · ' + line;
  return agency || line || '-';
}

function populateTransferGuestAgencies(selectedAgencyId, done) {
  function fillOptions(rows) {
    const $agencySelect = $('#transfer_guest_agency_id');
    $agencySelect.html('<option value="">Select LINE</option>');
    (rows || []).forEach(function (row) {
      const id = row.IDNo;
      const name = String(row.AGENCY || '').trim();
      if (!id || !name) return;
      $agencySelect.append(
        $('<option></option>').val(id).text(name.toUpperCase())
      );
    });
    if (selectedAgencyId) {
      $agencySelect.val(String(selectedAgencyId));
    }
    if (typeof done === 'function') done();
  }

  if (Array.isArray(allAgents) && allAgents.length) {
    fillOptions(allAgents);
    return;
  }

  $.ajax({
    url: '/agency_data',
    method: 'GET',
    success: function (rows) {
      allAgents = Array.isArray(rows) ? rows : [];
      fillOptions(allAgents);
    },
    error: function () {
      fillOptions([]);
      if (typeof done === 'function') done();
    }
  });
}

function loadTransferGuestAgentOptions(agencyId, currentAgentId) {
  const $agentSelect = $('#transfer_guest_agent_id');
  $agentSelect.prop('disabled', true).html('<option value="">Loading...</option>');

  if (!agencyId) {
    $agentSelect.html('<option value="">Select Agent</option>').prop('disabled', true);
    return;
  }

  $.ajax({
    url: '/account_data?agencyId=' + encodeURIComponent(agencyId),
    method: 'GET',
    success: function (rows) {
      const byAgent = {};
      (rows || []).forEach(function (row) {
        const id = String(row.agent_id || '');
        if (!id || byAgent[id]) return;
        byAgent[id] = {
          agent_id: row.agent_id,
          agent_code: row.agent_code || '',
          agent_name: row.agent_name || ''
        };
      });
      const agents = Object.values(byAgent);
      if (!agents.length) {
        $agentSelect.html('<option value="">No Agent under this LINE</option>').prop('disabled', true);
        return;
      }
      let html = '<option value="">Select Agent</option>';
      agents.forEach(function (agent) {
        if (String(agent.agent_id) === String(currentAgentId)) return;
        const code = String(agent.agent_code || '').toUpperCase();
        const name = String(agent.agent_name || '').toUpperCase();
        const label = code && name ? (code + ' · ' + name) : (code || name || ('LINE ' + agent.agent_id));
        html += '<option value="' + agent.agent_id + '">' + label + '</option>';
      });
      $agentSelect.html(html).prop('disabled', false);
    },
    error: function () {
      $agentSelect.html('<option value="">Failed to load LINE list</option>').prop('disabled', true);
    }
  });
}

function openTransferGuestModal(guestId) {
  const permissions = parseInt($('#user-role').data('permissions'), 10);
  if (permissions === 2) {
    Swal.fire({
      icon: 'warning',
      title: 'Not allowed',
      text: 'You cannot transfer guests.',
      confirmButtonText: 'OK'
    });
    return;
  }

  const numericGuestId = parseInt(guestId, 10);
  const target = getGuestRowById(numericGuestId);
  if (!target) {
    Swal.fire({
      icon: 'warning',
      title: 'Not found',
      text: 'Guest record is not available.',
      confirmButtonText: 'OK'
    });
    return;
  }

  const membershipNo = String(target.membership_no || target.MEMBERSHIP_NO || '').trim();
  const guestName = String(target.guest_name || target.NAME || '').trim().toUpperCase();
  const displayGuest = membershipNo ? (membershipNo + '-' + guestName) : guestName;
  transferGuestCurrentAgentId = target.agent_id || null;

  $('#transfer_guest_id').val(target.guest_id || '');
  $('#transfer_guest_display').val(displayGuest);
  $('#transfer_guest_current_line').val(
    buildGuestLineLabel(target.agency_name, target.agent_code, target.agent_name)
  );
  populateTransferGuestAgencies(target.agency_id || '', function () {
    loadTransferGuestAgentOptions(parseInt(target.agency_id, 10) || null, transferGuestCurrentAgentId);
    $('#modal-transfer-guest-table').modal('show');
  });
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
      $('#availableNN').text(nn.toLocaleString('en-US'));
      $('#availableCC').text(cc.toLocaleString('en-US'));
    },
    error: function () {
      $('#availableNN').text('0');
      $('#availableCC').text('0');
    }
  });
}

function resolveAccountForGuest(guestId, callback) {
  const numericGuestId = parseInt(guestId, 10);
  const guest = getGuestRowById(numericGuestId);

  if (!guest || !numericGuestId) {
    callback(null, 'Guest record is not available.');
    return;
  }

  const agentId = guest.agent_id;
  if (!agentId) {
    callback(null, 'Guest is not linked to a LINE.');
    return;
  }

  function pickAccountRow(rows) {
    return (rows || []).find(function (row) {
      return String(row.agent_id) === String(agentId) && row.account_id;
    });
  }

  const localMatch = pickAccountRow(currentAgencyAccounts);
  if (localMatch) {
    callback(localMatch, null, guest);
    return;
  }

  const agencyId = guest.agency_id;
  if (!agencyId) {
    callback(null, 'Unable to resolve agency for this guest.');
    return;
  }

  $.ajax({
    url: '/account_data?agencyId=' + encodeURIComponent(agencyId),
    method: 'GET',
    success: function (rows) {
      const match = pickAccountRow(rows);
      if (!match) {
        callback(null, 'No account is linked to this LINE yet.');
        return;
      }
      callback(match, null, guest);
    },
    error: function () {
      callback(null, 'Failed to load account for this guest.');
    }
  });
}

function openAddGameForGuest(guestId) {
  var numericGuestId = parseInt(guestId, 10);
  if (!numericGuestId) {
    Swal.fire({
      icon: 'warning',
      title: 'Selection required',
      text: 'Select a valid GUEST first.',
      confirmButtonText: 'OK'
    });
    return;
  }

  resolveAccountForGuest(numericGuestId, function (accountRow, errorMessage) {
    if (!accountRow) {
      Swal.fire({
        icon: 'warning',
        title: errorMessage && errorMessage.indexOf('No account') !== -1 ? 'No account found' : 'Unavailable',
        text: errorMessage || 'Unable to open Add Game.',
        confirmButtonText: 'OK'
      });
      return;
    }

    selectedAgentId = parseInt(accountRow.agent_id, 10);
    syncAgentPanelTransferButton();

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
      $('#total_balanceGuestGameList').val(safe.toLocaleString('en-US'));
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
  });
}

function openGuestGameHistory(guestId) {
  var numericGuestId = parseInt(guestId, 10);
  if (!numericGuestId) {
    Swal.fire({
      icon: 'warning',
      title: 'Selection required',
      text: 'Select a valid GUEST first.',
      confirmButtonText: 'OK'
    });
    return;
  }

  resolveAccountForGuest(numericGuestId, function (accountRow, errorMessage) {
    if (!accountRow) {
      Swal.fire({
        icon: 'warning',
        title: errorMessage && errorMessage.indexOf('No account') !== -1 ? 'No account found' : 'Unavailable',
        text: errorMessage || 'Unable to open game history.',
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
  });
}

function openAddGameForSelectedAgent() {
  if (!selectedAgentId) {
    Swal.fire({
      icon: 'warning',
      title: 'Selection required',
      text: 'Select LINE first.',
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
    $('#total_balanceGuestGameList').val(openingBalance.toLocaleString('en-US'));
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