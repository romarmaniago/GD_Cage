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
    const programDateInput = document.getElementById('additional-commission-program-date');
    const remarksInput = document.getElementById('additional-commission-remarks');
    const saveButton = document.getElementById('additional-commission-save-btn');
    const addModalEl = document.getElementById('modal-additional-commission');
    const dashListModalEl = document.getElementById('modal-dash-additional-commission');
    const dateRangeInput = document.getElementById('additional-commission-daterange');
    const dateRangeMount = document.getElementById('additional-commission-daterange-mount');

    if (!tableBody || !addButton || !form || !recordIdInput || !modalTitle || !agentSelect || !typeCashOut || !typeDeposit || !amountInput || !programDateInput || !remarksInput || !saveButton || !addModalEl) {
      return;
    }

    let agents = [];
    let records = [];
    let dateRangePicker = null;
    const sortState = { sortKey: 'programDate', sortDir: 'desc' };
    const tableHead = document.querySelector('#additional-commission-tbl thead');
    let dataTable = null;
    const addModal = bootstrap.Modal.getOrCreateInstance(addModalEl);

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatYmd(value) {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (num) => String(num).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function todayProgramDateValue() {
      return formatYmd(new Date());
    }

    function getProgramDateValue() {
      if (programDateInput._flatpickr && programDateInput._flatpickr.selectedDates && programDateInput._flatpickr.selectedDates[0]) {
        return formatYmd(programDateInput._flatpickr.selectedDates[0]);
      }
      return String(programDateInput.value || '').trim().slice(0, 10);
    }

    function ensureProgramDatePicker(defaultDate) {
      const dateVal = defaultDate || getProgramDateValue() || todayProgramDateValue();
      if (typeof flatpickr === 'undefined') {
        programDateInput.value = dateVal;
        return;
      }
      if (programDateInput._flatpickr) {
        try {
          programDateInput._flatpickr.destroy();
        } catch (error) {
          console.error(error);
        }
      }
      flatpickr(programDateInput, {
        enableTime: false,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'M j, Y',
        defaultDate: dateVal,
        allowInput: true,
        disableMobile: true,
        closeOnSelect: true,
        appendTo: addModalEl
      });
    }

    function formatDateTime(value) {
      if (!value) return '';

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return escapeHtml(value);

      const pad = (num) => String(num).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatProgramDate(row) {
      const raw = row && (row.PROGRAM_DATE || row.ENCODED_DT);
      if (!raw) return '';
      const ymd = String(raw).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return escapeHtml(ymd);
      return formatDateTime(raw).slice(0, 10);
    }

    function getRowProgramDateValue(row) {
      const raw = row && (row.PROGRAM_DATE || row.ENCODED_DT);
      if (!raw) return 0;
      const ymd = String(raw).slice(0, 10);
      const parsed = new Date(ymd);
      return Number.isNaN(parsed.getTime()) ? new Date(raw).getTime() || 0 : parsed.getTime();
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

    function formatAccountName(row) {
      const account = String(row && row.account != null ? row.account : '').trim();
      const name = String(row && row.name != null ? row.name : '').trim();
      if (account && name) return `${escapeHtml(account)} / ${escapeHtml(name)}`;
      return escapeHtml(account || name);
    }

    function getSortValue(row, key) {
      if (!row) return '';
      if (key === 'programDate') return getRowProgramDateValue(row);
      if (key === 'date') return new Date(row.ENCODED_DT || 0).getTime();
      if (key === 'account') {
        return `${String(row.account || '').toLowerCase()} / ${String(row.name || '').toLowerCase()}`;
      }
      if (key === 'amount') return Number(row.AMOUNT) || 0;
      if (key === 'type') return Number(row.TYPE) || 0;
      if (key === 'remarks') return String(row.REMARKS || '').toLowerCase();
      return '';
    }

    function sortRecords(rows) {
      const list = (rows || []).slice();
      const key = sortState.sortKey || 'programDate';
      const dir = sortState.sortDir === 'asc' ? 'asc' : 'desc';

      list.sort((a, b) => {
        const av = getSortValue(a, key);
        const bv = getSortValue(b, key);
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;

        const dateDiff = getRowProgramDateValue(b) - getRowProgramDateValue(a);
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

    function getActiveDateRange() {
      if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.resolveRangeFromPicker === 'function') {
        return window.MonthEndCutoffRange.resolveRangeFromPicker(
          dateRangeInput ? dateRangeInput.value : '',
          dateRangeInput
        );
      }
      const fallback = window.MonthEndCutoffRange
        ? window.MonthEndCutoffRange.getMonthEndCutoffRange()
        : null;
      return {
        start: fallback ? fallback.startDate : '',
        end: fallback ? fallback.endDateApi || fallback.endDate : ''
      };
    }

    function layoutAdditionalCommissionControls() {
      if (!window.jQuery) return;

      const $table = window.jQuery('#additional-commission-tbl');
      if (!$table.length) return;

      const $wrapper = $table.closest('#additional-commission-tbl_wrapper');
      const $length = $wrapper.find('#additional-commission-tbl_length');
      const $filter = $wrapper.find('#additional-commission-tbl_filter');
      const $filterLabel = $wrapper.find('#additional-commission-tbl_filter label');
      if (!$wrapper.length || !$length.length || !$filter.length) return;

      let $controlsHighlight = $wrapper.find('.additional-commission-controls-highlight');
      if (!$controlsHighlight.length) {
        $controlsHighlight = window.jQuery('<div class="additional-commission-controls-highlight"></div>');
        $wrapper.prepend($controlsHighlight);
      }
      if ($length.length && $length.parent()[0] !== $controlsHighlight[0]) {
        $controlsHighlight.append($length);
      }

      if (dateRangeMount) {
        if (dateRangeMount.parentElement !== $controlsHighlight[0] || $length.next()[0] !== dateRangeMount) {
          if ($length.length) {
            $length.after(dateRangeMount);
          } else {
            $controlsHighlight.prepend(dateRangeMount);
          }
        }
        dateRangeMount.classList.add('is-placed');
      }

      if ($filter.length && $filter.parent()[0] !== $controlsHighlight[0]) {
        $controlsHighlight.append($filter);
      }

      let $filterHighlight = $filter.find('.additional-commission-filter-highlight');
      if (!$filterHighlight.length) {
        $filterHighlight = window.jQuery('<div class="additional-commission-filter-highlight"></div>');
        $filter.append($filterHighlight);
      }

      if (addButton) {
        if (addButton.parentElement !== $filterHighlight[0] || $filterHighlight[0].firstElementChild !== addButton) {
          $filterHighlight.prepend(addButton);
        }
        addButton.classList.remove('d-none');
      }
      if ($filterLabel.length && $filterLabel.parent()[0] !== $filterHighlight[0]) {
        $filterHighlight.append($filterLabel);
      }

      /* Only hide the emptied top controls row — never .dt-row (holds the table) */
      $wrapper.children('.row').each(function () {
        const $row = window.jQuery(this);
        if ($row.hasClass('dt-row') || $row.find('table').length) return;
        if (!$row.find('.dataTables_length, .dataTables_filter, .dataTables_info, .dataTables_paginate').length) {
          $row.addClass('additional-commission-dt-top-row-empty').hide();
        }
      });

      $table.css({ marginTop: 0, marginBottom: 0 }).show();
      $table.closest('.row.dt-row').show().removeClass('additional-commission-dt-top-row-empty');
    }

    function initDateRangePicker() {
      if (!dateRangeInput || typeof flatpickr !== 'function') return;

      const config = {
        mode: 'range',
        showMonths: 2,
        onChange: function (selectedDates) {
          if (selectedDates.length === 2) {
            loadAdditionalCommissionData();
          }
        }
      };

      if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.patchRangePickerConfig === 'function') {
        dateRangePicker = flatpickr(dateRangeInput, window.MonthEndCutoffRange.patchRangePickerConfig(config));
      } else {
        dateRangePicker = flatpickr(dateRangeInput, config);
      }

      if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function' && dateRangePicker) {
        setTimeout(function () {
          window.MonthEndCutoffRange.fitRangePickerInstance(dateRangePicker);
        }, 0);
      }
    }

    function initDataTableOnce() {
      if (!window.jQuery || !window.jQuery.fn || !window.jQuery.fn.DataTable) return null;

      const $table = window.jQuery('#additional-commission-tbl');
      if (!$table.length) return null;

      if (window.jQuery.fn.DataTable.isDataTable($table[0])) {
        dataTable = $table.DataTable();
      } else {
        dataTable = $table.DataTable({
          paging: true,
          pageLength: 10,
          lengthMenu: [[10, 25, 50, -1], [10, 25, 50, 'All']],
          searching: true,
          ordering: false,
          info: true,
          autoWidth: false,
          language: {
            search: '',
            searchPlaceholder: 'Search...',
            infoEmpty: 'Showing 0 to 0 of 0 entries',
            emptyTable: 'No additional commission records found.'
          },
          columns: [
            {
              data: null,
              render: (data, type, row) => {
                const display = formatProgramDate(row);
                if (type === 'filter' || type === 'sort') return getRowProgramDateValue(row);
                return display;
              }
            },
            {
              data: null,
              render: (data, type, row) => {
                const display = formatDateTime(row.ENCODED_DT);
                if (type === 'filter' || type === 'sort') return new Date(row.ENCODED_DT || 0).getTime();
                return display;
              }
            },
            {
              data: null,
              render: (data, type, row) => {
                const display = formatAccountName(row);
                if (type === 'filter' || type === 'sort') {
                  return `${String(row.account || '')} / ${String(row.name || '')}`;
                }
                return display;
              }
            },
            {
              data: null,
              className: 'text-end',
              render: (data, type, row) => {
                const amount = Number(row.AMOUNT) || 0;
                const amountClass = amount ? 'text-danger' : '';
                const display = `<span class="${amountClass}">${formatRowAmount(row)}</span>`;
                if (type === 'filter' || type === 'sort') return String(amount);
                return display;
              }
            },
            {
              data: null,
              render: (data, type, row) => {
                const typeLabel = getTypeLabel(getRowType(row));
                if (type === 'filter' || type === 'sort') return typeLabel;
                return escapeHtml(typeLabel);
              }
            },
            { data: null, className: 'col-remarks', render: (data, type, row) => escapeHtml(row.REMARKS || '') }
            // Action column (temporarily hidden)
            // ,{
            //   data: null,
            //   className: 'text-center text-nowrap',
            //   orderable: false,
            //   render: (data, type, row) => {
            //     if (type !== 'display') return '';
            //     return `
            //       <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-additional-commission" data-id="${escapeHtml(row.IDNo)}" title="Edit">
            //         <i class="fa fa-pencil-alt"></i>
            //       </button>
            //       <button type="button" class="btn btn-sm btn-outline-danger btn-delete-additional-commission" data-id="${escapeHtml(row.IDNo)}" title="Delete">
            //         <i class="fa fa-trash"></i>
            //       </button>
            //     `;
            //   }
            // }
          ],
          data: []
        });

        $table.on('init.dt draw.dt', layoutAdditionalCommissionControls);
      }

      layoutAdditionalCommissionControls();

      return dataTable;
    }

    function renderRows(rows) {
      records = rows || [];
      const sorted = sortRecords(records);

      if (!records.length) {
        if (dataTable) {
          dataTable.clear().draw(false);
        } else {
          tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No additional commission records found.</td></tr>';
        }
        syncSortHeaders();
        return;
      }

      if (dataTable) {
        dataTable.clear();
        dataTable.rows.add(sorted);
        dataTable.draw(false);
      } else {
        tableBody.innerHTML = sorted.map((row) => {
          const type = getRowType(row);
          const typeLabel = getTypeLabel(type);
          const amount = Number(row.AMOUNT) || 0;
          const amountClass = amount ? 'text-danger' : '';

          return `
          <tr>
            <td>${formatProgramDate(row)}</td>
            <td>${formatDateTime(row.ENCODED_DT)}</td>
            <td>${formatAccountName(row)}</td>
            <td class="text-end ${amountClass}">${formatRowAmount(row)}</td>
            <td>${escapeHtml(typeLabel)}</td>
            <td>${escapeHtml(row.REMARKS)}</td>
            <!--
            <td class="text-center text-nowrap">
              <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-additional-commission" data-id="${escapeHtml(row.IDNo)}" title="Edit">
                <i class="fa fa-pencil-alt"></i>
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger btn-delete-additional-commission" data-id="${escapeHtml(row.IDNo)}" title="Delete">
                <i class="fa fa-trash"></i>
              </button>
            </td>
            -->
          </tr>
        `;
        }).join('');
      }

      syncSortHeaders();
    }

    function loadAdditionalCommissionData() {
      const range = getActiveDateRange();
      const params = new URLSearchParams();
      if (range && range.start) params.set('start', range.start);
      if (range && range.end) params.set('end', range.end);
      const query = params.toString();
      const url = query ? `/additional_commission_data?${query}` : '/additional_commission_data';

      return fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error('Failed to load additional commission records.');
          return response.json();
        })
        .then(renderRows)
        .catch((error) => {
          console.error(error);
          tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load records.</td></tr>';
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
      remarksInput.value = '';
      ensureProgramDatePicker(todayProgramDateValue());
      if (window.jQuery) {
        window.jQuery('#additional-commission-agent').val('').trigger('change');
      } else {
        agentSelect.value = '';
      }
    }

    function openAdditionalCommissionModal() {
      resetAdditionalCommissionForm();
      if (dashListModalEl) {
        addModalEl.style.zIndex = '1065';
      }
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
      const programDate = row.PROGRAM_DATE
        ? String(row.PROGRAM_DATE).slice(0, 10)
        : (row.ENCODED_DT ? formatYmd(row.ENCODED_DT) : todayProgramDateValue());
      ensureProgramDatePicker(programDate);

      if (dashListModalEl) {
        addModalEl.style.zIndex = '1065';
      }

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

    // Enable DataTables UI (search + show entries).
    initDataTableOnce();
    initDateRangePicker();

    if (!dashListModalEl) {
      loadAdditionalCommissionData();
    } else {
      window.openDashboardAdditionalCommissionModal = function () {
        bootstrap.Modal.getOrCreateInstance(dashListModalEl).show();
      };

      dashListModalEl.addEventListener('shown.bs.modal', function () {
        layoutAdditionalCommissionControls();
        if (dataTable) {
          try {
            dataTable.columns.adjust().draw(false);
          } catch (error) {
            console.error(error);
          }
        }
        if (dateRangePicker && window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
          window.MonthEndCutoffRange.fitRangePickerInstance(dateRangePicker);
        }
        loadAdditionalCommissionData();
      });
    }

    addButton.addEventListener('click', openAdditionalCommissionModal);

    if (tableHead) {
      tableHead.addEventListener('click', function (event) {
        const th = event.target.closest('th.sortable-col');
        if (!th) return;

        const key = th.dataset.sortKey || 'programDate';
        if (sortState.sortKey === key) {
          sortState.sortDir = sortState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortState.sortKey = key;
          sortState.sortDir = (key === 'programDate' || key === 'date' || key === 'amount') ? 'desc' : 'asc';
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
      const programDate = getProgramDateValue();
      const editingId = String(recordIdInput.value || '').trim();
      const payload = {
        agentId: agentSelect.value,
        agentName: selectedAgent ? String(selectedAgent.name || '').trim() : '',
        type: selectedType,
        amount: String(parsedAmount),
        programDate,
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

      if (!/^\d{4}-\d{2}-\d{2}$/.test(programDate)) {
        if (typeof Swal !== 'undefined') {
          Swal.fire('Validation', 'Please select a program date.', 'warning');
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
