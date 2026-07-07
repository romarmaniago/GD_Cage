(function () {
  const TYPE_DEPOSIT = 1;
  const TYPE_CASHOUT = 2;

  function initAdditionalCommission() {
    const tableBody = document.querySelector('#additional-commission-tbl tbody');
    const addButton = document.getElementById('btn-add-additional-commission');
    const form = document.getElementById('additional-commission-form');
    const recordIdInput = document.getElementById('additional-commission-id');
    const modalTitle = document.getElementById('additional-commission-modal-title');
    const agentSelect = document.getElementById('additional-commission-agent');
    const typeCashOut = document.getElementById('additional-commission-type-cashout');
    const typeDeposit = document.getElementById('additional-commission-type-deposit');
    const amountInput = document.getElementById('additional-commission-amount');
    const remarksInput = document.getElementById('additional-commission-remarks');
    const saveButton = document.getElementById('additional-commission-save-btn');
    const addModalEl = document.getElementById('modal-additional-commission');
    const dashListModalEl = document.getElementById('modal-dash-additional-commission');

    if (!tableBody || !addButton || !form || !recordIdInput || !modalTitle || !agentSelect || !typeCashOut || !typeDeposit || !amountInput || !remarksInput || !saveButton || !addModalEl) {
      return;
    }

    let agents = [];
    let records = [];
    const sortState = { sortKey: 'date', sortDir: 'desc' };
    const tableHead = document.querySelector('#additional-commission-tbl thead');
    const addModal = bootstrap.Modal.getOrCreateInstance(addModalEl);

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatDateTime(value) {
      if (!value) return '';

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return escapeHtml(value);

      const pad = (num) => String(num).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatAmount(value) {
      const amount = Number(value) || 0;
      const formatted = Math.abs(amount).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      });
      return `(${formatted})`;
    }

    function sanitizeAmountInput(value) {
      return String(value || '').replace(/[^\d.]/g, '');
    }

    function formatAmountInput(value) {
      const cleaned = sanitizeAmountInput(value);
      if (!cleaned) return '';
      const parts = cleaned.split('.');
      const integerPart = parts[0] || '0';
      const decimalPart = parts.length > 1 ? parts[1].slice(0, 2) : '';
      const formattedInteger = Number(integerPart).toLocaleString('en-US');
      return decimalPart !== '' ? `${formattedInteger}.${decimalPart}` : formattedInteger;
    }

    function formatDashboardAmount(value) {
      const amount = Math.round(Number(value) || 0);
      return amount.toLocaleString('en-US');
    }

    function formatDashboardNegHtml(value) {
      const amount = Math.round(Number(value) || 0);
      if (!amount) return '0';
      return `<span class="text-dash-neg">(${Math.abs(amount).toLocaleString('en-US')})</span>`;
    }

    function parseDashboardAmount(value) {
      return Math.round(Number(String(value || '').replace(/,/g, '')) || 0);
    }

    function updateDashboardAdditionalCommissionTotal(total) {
      const mainTotalEl = document.getElementById('dash-additional-commission-total');
      const anticipatedEl = document.getElementById('dash-additional-commission-anticipated');
      const anticipatedPanel = document.getElementById('dash-anticipated-panel');
      const companyExpenseEl = document.querySelector('#dash-anticipated-panel .dash-kv.is-total .dash-kv-value');
      const grandTotalEl = document.getElementById('dash-grand-total');
      const cageBalanceTotalEl = document.getElementById('dash-cage-balance-total');
      const companyBalanceTotalEl = document.getElementById('dash-company-balance-total');

      if (mainTotalEl) mainTotalEl.innerHTML = formatDashboardNegHtml(total);
      if (anticipatedEl) anticipatedEl.innerHTML = formatDashboardNegHtml(total);

      if (!anticipatedPanel) return;

      const winLoss = Number(anticipatedPanel.dataset.winLoss) || 0;
      const serviceSettle = Number(anticipatedPanel.dataset.serviceSettle) || 0;
      const previousAdditional = Number(anticipatedPanel.dataset.additionalCommission) || 0;
      const nextAdditional = Math.round(Number(total) || 0);
      const previousCompanyExpense = Number(anticipatedPanel.dataset.companyExpense) || 0;
      const nextCompanyExpense = previousCompanyExpense - previousAdditional + nextAdditional;
      const additionalDelta = nextAdditional - previousAdditional;

      anticipatedPanel.dataset.additionalCommission = String(nextAdditional);
      anticipatedPanel.dataset.companyExpense = String(nextCompanyExpense);

      const rate = Number(anticipatedPanel.dataset.wlRate) || Number(anticipatedPanel.dataset.wlDefault) || 65;
      const wlSettlement = Math.round(winLoss * (rate / 100));
      const casinoTotal = wlSettlement - serviceSettle;
      const grandTotal = casinoTotal - nextCompanyExpense;

      if (companyExpenseEl) companyExpenseEl.innerHTML = formatDashboardNegHtml(nextCompanyExpense);
      if (grandTotalEl) grandTotalEl.textContent = formatDashboardAmount(grandTotal);

      if (additionalDelta && cageBalanceTotalEl) {
        const nextCageBalance = parseDashboardAmount(cageBalanceTotalEl.textContent) - additionalDelta;
        cageBalanceTotalEl.textContent = formatDashboardAmount(nextCageBalance);
      }
      if (additionalDelta && companyBalanceTotalEl) {
        const nextCompanyBalance = parseDashboardAmount(companyBalanceTotalEl.textContent) - additionalDelta;
        companyBalanceTotalEl.textContent = formatDashboardAmount(nextCompanyBalance);
      }
    }

    function initAccountSelect2() {
      const $agentSelect = window.jQuery ? window.jQuery('#additional-commission-agent') : null;
      if (!$agentSelect || typeof $agentSelect.select2 !== 'function') return;

      if ($agentSelect.data('select2')) {
        try {
          $agentSelect.select2('destroy');
        } catch (error) {
          console.error(error);
        }
      }

      $agentSelect.select2({
        placeholder: $agentSelect.attr('data-placeholder') || 'Select account',
        allowClear: false,
        dropdownParent: window.jQuery(addModalEl),
        width: '100%'
      });
    }

    function getRowType(row) {
      return Number(row.TYPE) === TYPE_DEPOSIT ? 'deposit' : (Number(row.TYPE) === TYPE_CASHOUT ? 'cashout' : '');
    }

    function getTypeLabel(type) {
      if (type === 'deposit') return 'Deposit';
      if (type === 'cashout') return 'Cash-out';
      return '';
    }

    function formatRowAmount(row) {
      const amount = Number(row.AMOUNT) || 0;
      if (!amount) return '';
      return formatAmount(amount);
    }

    function getSortValue(row, key) {
      if (!row) return '';
      if (key === 'date') return new Date(row.ENCODED_DT || 0).getTime();
      if (key === 'account') return String(row.account || '').toLowerCase();
      if (key === 'name') return String(row.name || '').toLowerCase();
      if (key === 'amount') return Number(row.AMOUNT) || 0;
      if (key === 'type') return Number(row.TYPE) || 0;
      if (key === 'remarks') return String(row.REMARKS || '').toLowerCase();
      return '';
    }

    function sortRecords(rows) {
      const list = (rows || []).slice();
      const key = sortState.sortKey || 'date';
      const dir = sortState.sortDir === 'asc' ? 'asc' : 'desc';

      list.sort((a, b) => {
        const av = getSortValue(a, key);
        const bv = getSortValue(b, key);
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;

        const dateDiff = new Date(b.ENCODED_DT || 0).getTime() - new Date(a.ENCODED_DT || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        return (Number(b.IDNo) || 0) - (Number(a.IDNo) || 0);
      });

      return list;
    }

    function syncSortHeaders() {
      if (!tableHead) return;

      tableHead.querySelectorAll('th.sortable-col').forEach((th) => {
        const thKey = th.dataset.sortKey;
        const active = thKey === sortState.sortKey;
        th.classList.toggle('is-sorted', active);
        th.setAttribute('aria-sort', active ? (sortState.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');

        const indicator = th.querySelector('.sort-indicator');
        if (indicator) {
          indicator.textContent = active ? (sortState.sortDir === 'asc' ? '▲' : '▼') : '-';
        }
      });
    }

    function renderRows(rows) {
      records = rows || [];

      if (!records.length) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No additional commission records found.</td></tr>';
        syncSortHeaders();
        return;
      }

      tableBody.innerHTML = sortRecords(records).map((row) => {
        const type = getRowType(row);
        const typeLabel = getTypeLabel(type);
        const amount = Number(row.AMOUNT) || 0;
        const amountClass = amount ? 'text-danger' : '';

        return `
        <tr>
          <td>${formatDateTime(row.ENCODED_DT)}</td>
          <td>${escapeHtml(row.account)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td class="text-end ${amountClass}">${formatRowAmount(row)}</td>
          <td>${escapeHtml(typeLabel)}</td>
          <td>${escapeHtml(row.REMARKS)}</td>
          <td class="text-center text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-additional-commission" data-id="${escapeHtml(row.IDNo)}" title="Edit">
              <i class="fa fa-pencil-alt"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger btn-delete-additional-commission" data-id="${escapeHtml(row.IDNo)}" title="Delete">
              <i class="fa fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
      }).join('');

      syncSortHeaders();
    }

    function loadAdditionalCommissionData() {
      return fetch('/additional_commission_data')
        .then((response) => {
          if (!response.ok) throw new Error('Failed to load additional commission records.');
          return response.json();
        })
        .then(renderRows)
        .catch((error) => {
          console.error(error);
          tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Failed to load records.</td></tr>';
        });
    }

    function loadAgents(selectedAgentId) {
      return fetch('/additional_commission_agents')
        .then((response) => {
          if (!response.ok) throw new Error('Failed to load accounts.');
          return response.json();
        })
        .then((rows) => {
          agents = rows || [];
          const $agentSelect = window.jQuery ? window.jQuery('#additional-commission-agent') : null;
          if ($agentSelect && $agentSelect.data('select2')) {
            try {
              $agentSelect.select2('destroy');
            } catch (error) {
              console.error(error);
            }
          }
          agentSelect.innerHTML = '<option value="">Select account</option>' + agents.map((agent) => (
            `<option value="${escapeHtml(agent.agent_id)}">${escapeHtml(agent.account)} - ${escapeHtml(agent.name)}</option>`
          )).join('');
          initAccountSelect2();
          if (selectedAgentId) {
            if (window.jQuery) {
              window.jQuery('#additional-commission-agent').val(String(selectedAgentId)).trigger('change');
            } else {
              agentSelect.value = String(selectedAgentId);
            }
          }
        });
    }

    function getSelectedType() {
      if (typeDeposit.checked) return TYPE_DEPOSIT;
      if (typeCashOut.checked) return TYPE_CASHOUT;
      return null;
    }

    function setSelectedType(typeValue) {
      typeCashOut.checked = Number(typeValue) === TYPE_CASHOUT;
      typeDeposit.checked = Number(typeValue) === TYPE_DEPOSIT;
    }

    function clearTypeSelection() {
      typeCashOut.checked = false;
      typeDeposit.checked = false;
    }

    function resetAdditionalCommissionForm() {
      recordIdInput.value = '';
      modalTitle.textContent = 'Add Additional Commission';
      form.reset();
      clearTypeSelection();
      amountInput.value = '';
      if (window.jQuery) {
        window.jQuery('#additional-commission-agent').val('').trigger('change');
      } else {
        agentSelect.value = '';
      }
    }

    function openAdditionalCommissionModal() {
      resetAdditionalCommissionForm();
      loadAgents()
        .catch((error) => {
          console.error(error);
          if (typeof Swal !== 'undefined') {
            Swal.fire('Error', 'Failed to load accounts.', 'error');
          }
        })
        .finally(() => {
          addModal.show();
        });
    }

    function openEditAdditionalCommissionModal(recordId) {
      const row = records.find((item) => String(item.IDNo) === String(recordId));
      if (!row) {
        if (typeof Swal !== 'undefined') {
          Swal.fire('Error', 'Record not found.', 'error');
        }
        return;
      }

      recordIdInput.value = String(row.IDNo);
      modalTitle.textContent = 'Edit Additional Commission';
      setSelectedType(row.TYPE);
      amountInput.value = formatAmountInput(String(row.AMOUNT || ''));
      remarksInput.value = row.REMARKS || '';

      loadAgents(row.AGENT_ID)
        .catch((error) => {
          console.error(error);
          if (typeof Swal !== 'undefined') {
            Swal.fire('Error', 'Failed to load accounts.', 'error');
          }
        })
        .finally(() => {
          addModal.show();
        });
    }

    function deleteAdditionalCommission(recordId) {
      const confirmDelete = () => fetch(`/additional_commission/${encodeURIComponent(recordId)}`, {
        method: 'DELETE'
      })
        .then((response) => {
          if (!response.ok) throw new Error('Failed to delete record.');
          return response.json().catch(() => ({}));
        })
        .then((payload) => {
          loadAdditionalCommissionData();
          if (payload && payload.total != null) {
            updateDashboardAdditionalCommissionTotal(payload.total);
          }
          if (typeof Swal !== 'undefined') {
            Swal.fire('Deleted', 'Record deleted successfully.', 'success');
          }
        })
        .catch((error) => {
          console.error(error);
          if (typeof Swal !== 'undefined') {
            Swal.fire('Error', 'Failed to delete record.', 'error');
          }
        });

      if (typeof Swal !== 'undefined') {
        Swal.fire({
          title: 'Delete record?',
          text: 'This action cannot be undone.',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Delete',
          confirmButtonColor: '#d33'
        }).then((result) => {
          if (result.isConfirmed) confirmDelete();
        });
        return;
      }

      if (window.confirm('Delete this record?')) {
        confirmDelete();
      }
    }

    window.loadAdditionalCommissionData = loadAdditionalCommissionData;

    if (!dashListModalEl) {
      loadAdditionalCommissionData();
    } else {
      window.openDashboardAdditionalCommissionModal = function () {
        bootstrap.Modal.getOrCreateInstance(dashListModalEl).show();
      };

      dashListModalEl.addEventListener('shown.bs.modal', function () {
        loadAdditionalCommissionData();
      });
    }

    addButton.addEventListener('click', openAdditionalCommissionModal);

    if (tableHead) {
      tableHead.addEventListener('click', function (event) {
        const th = event.target.closest('th.sortable-col');
        if (!th) return;

        const key = th.dataset.sortKey || 'date';
        if (sortState.sortKey === key) {
          sortState.sortDir = sortState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortState.sortKey = key;
          sortState.sortDir = (key === 'date' || key === 'amount') ? 'desc' : 'asc';
        }

        renderRows(records);
      });
    }

    tableBody.addEventListener('click', function (event) {
      const editBtn = event.target.closest('.btn-edit-additional-commission');
      const deleteBtn = event.target.closest('.btn-delete-additional-commission');

      if (editBtn) {
        openEditAdditionalCommissionModal(editBtn.dataset.id);
        return;
      }

      if (deleteBtn) {
        deleteAdditionalCommission(deleteBtn.dataset.id);
      }
    });

    typeCashOut.addEventListener('change', function () {
      amountInput.value = '';
    });
    typeDeposit.addEventListener('change', function () {
      amountInput.value = '';
    });

    amountInput.addEventListener('input', function () {
      amountInput.value = formatAmountInput(amountInput.value);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      const selectedAgent = agents.find((agent) => String(agent.agent_id) === String(agentSelect.value));
      const selectedType = getSelectedType();
      const parsedAmount = Number(sanitizeAmountInput(amountInput.value)) || 0;
      const editingId = String(recordIdInput.value || '').trim();
      const payload = {
        agentId: agentSelect.value,
        agentName: selectedAgent ? String(selectedAgent.name || '').trim() : '',
        type: selectedType,
        amount: String(parsedAmount),
        remarks: remarksInput.value.trim()
      };

      if (!payload.agentId) {
        if (typeof Swal !== 'undefined') {
          Swal.fire('Validation', 'Please select an account.', 'warning');
        }
        return;
      }

      if (selectedType !== TYPE_DEPOSIT && selectedType !== TYPE_CASHOUT) {
        if (typeof Swal !== 'undefined') {
          Swal.fire('Validation', 'Please select type (Deposit or Cash-out).', 'warning');
        }
        return;
      }

      if (!parsedAmount) {
        if (typeof Swal !== 'undefined') {
          Swal.fire('Validation', 'Please enter amount.', 'warning');
        }
        return;
      }

      const url = editingId ? `/additional_commission/${encodeURIComponent(editingId)}` : '/add_additional_commission';
      const method = editingId ? 'PUT' : 'POST';

      saveButton.disabled = true;
      fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then((response) => {
          if (!response.ok) throw new Error('Failed to save record.');
          return response.json().catch(() => ({}));
        })
        .then((payload) => {
          addModal.hide();
          resetAdditionalCommissionForm();
          loadAdditionalCommissionData();
          if (payload && payload.total != null) {
            updateDashboardAdditionalCommissionTotal(payload.total);
          }
          if (typeof Swal !== 'undefined') {
            Swal.fire('Success', editingId ? 'Record updated successfully.' : 'Record saved successfully.', 'success');
          }
        })
        .catch((error) => {
          console.error(error);
          if (typeof Swal !== 'undefined') {
            Swal.fire('Error', 'Failed to save record.', 'error');
          }
        })
        .finally(() => {
          saveButton.disabled = false;
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdditionalCommission);
  } else {
    initAdditionalCommission();
  }
})();
