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
    let additionalCommissionSplitOverrideRange = null;
    let additionalCommissionSplitDateRange = null;
    const sortState = { sortKey: 'programDate', sortDir: 'desc' };
    const tableHead = document.querySelector('#additional-commission-tbl thead');
    const userPermissions = parseInt(document.getElementById('user-role')?.getAttribute('data-permissions') || '99', 10);
    const canEditAdditionalCommission = userPermissions === 0;
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
      if (type === 'deposit') return 'Transfer';
      if (type === 'cashout') return 'Cash-out';
      return '';
    }

    function buildActionButtons(row) {
      const id = escapeHtml(row.IDNo);
      const editDeleteButtons = canEditAdditionalCommission
        ? `
          <button type="button" class="btn btn-sm btn-alt-primary btn-edit-additional-commission" data-id="${id}" title="Edit"><i class="fa fa-pencil-alt"></i></button>
          <button type="button" class="btn btn-sm btn-alt-danger btn-delete-additional-commission" data-id="${id}" title="Delete"><i class="fa fa-trash-alt"></i></button>`
        : '';
      return `
        <div class="additional-commission-action-btns">
          <button type="button" class="btn btn-sm btn-alt-secondary btn-receipt-additional-commission" data-id="${id}" title="Receipt"><i class="fa fa-receipt"></i></button>${editDeleteButtons}
        </div>
      `;
    }

    function formatRowAmount(row) {
      const amount = Number(row.AMOUNT) || 0;
      if (!amount) return '';
      return formatAmount(amount);
    }

    function updateAdditionalCommissionTableTotal(api) {
      const totalEl = document.getElementById('additional-commission-total-amount');
      if (!totalEl) return;

      let total = 0;
      if (api) {
        api.rows({ search: 'applied' }).every(function () {
          const row = this.data();
          total += Number(row && row.AMOUNT) || 0;
        });
      } else {
        total = (records || []).reduce(function (sum, row) {
          return sum + (Number(row && row.AMOUNT) || 0);
        }, 0);
      }

      if (!total) {
        totalEl.textContent = '0';
        return;
      }
      totalEl.innerHTML = '<span class="text-danger fw-bold">' + formatAmount(total) + '</span>';
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
          indicator.textContent = active ? (sortState.sortDir === 'asc' ? '▲' : '▼') : '';
        }
      });
    }

    function additionalCommissionApiEndDate(endYmd) {
      if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
      const parts = String(endYmd).slice(0, 10).split('-').map(Number);
      const lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
      if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
        return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
      }
      return endYmd;
    }

    function getActiveDateRange() {
      if (additionalCommissionSplitOverrideRange && additionalCommissionSplitOverrideRange.start && additionalCommissionSplitOverrideRange.end) {
        return {
          start: additionalCommissionSplitOverrideRange.start,
          end: additionalCommissionSplitOverrideRange.end
        };
      }
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

      if (dateRangePicker && window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
        window.MonthEndCutoffRange.fitRangePickerInstance(dateRangePicker);
      }
      if (additionalCommissionSplitDateRange && typeof additionalCommissionSplitDateRange.fitWidths === 'function') {
        additionalCommissionSplitDateRange.fitWidths();
      }
    }

    function initAdditionalCommissionSplitDateRange() {
      if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
        additionalCommissionSplitDateRange = { syncFromRange: function () {}, fitWidths: function () {}, isSyncing: function () { return false; } };
        return;
      }

      additionalCommissionSplitDateRange = window.SplitDateRange.attach({
        rangePickerId: 'additional-commission-daterange',
        startId: 'additional-commission-start-date',
        endId: 'additional-commission-end-date',
        splitWrapperId: 'additional-commission-split-daterange-wrapper',
        independent: true,
        invalidDateMessage: 'Invalid date range.',
        onRangeApplied: function (range) {
          if (!range || !range.start || !range.end) return;
          let fromDate = range.start;
          let toDate = additionalCommissionApiEndDate(range.end);
          if (fromDate > toDate) {
            const swap = fromDate;
            fromDate = toDate;
            toDate = swap;
          }
          additionalCommissionSplitOverrideRange = { start: fromDate, end: toDate };
          loadAdditionalCommissionData();
        }
      });
    }

    function initDateRangePicker() {
      if (!dateRangeInput || typeof flatpickr !== 'function') return;

      const config = {
        mode: 'range',
        showMonths: 2,
        onChange: function (selectedDates) {
          if (selectedDates.length === 2) {
            additionalCommissionSplitOverrideRange = null;
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
            { data: null, className: 'col-remarks', render: (data, type, row) => escapeHtml(row.REMARKS || '') },
            {
              data: null,
              className: 'text-center text-nowrap',
              orderable: false,
              render: (data, type, row) => {
                if (type !== 'display') return '';
                return buildActionButtons(row);
              }
            }
          ],
          data: [],
          footerCallback: function () {
            updateAdditionalCommissionTableTotal(this.api());
          }
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
          tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No additional commission records found.</td></tr>';
          updateAdditionalCommissionTableTotal(null);
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
            <td class="text-center text-nowrap">${buildActionButtons(row)}</td>
          </tr>
        `;
        }).join('');
        updateAdditionalCommissionTableTotal(null);
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

    let receiptHtml2CanvasPromise = null;
    function loadReceiptHtml2Canvas() {
      if (typeof html2canvas !== 'undefined') return Promise.resolve();
      if (receiptHtml2CanvasPromise) return receiptHtml2CanvasPromise;
      receiptHtml2CanvasPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = () => resolve();
        script.onerror = () => {
          receiptHtml2CanvasPromise = null;
          reject(new Error('Failed to load image copy library.'));
        };
        document.body.appendChild(script);
      });
      return receiptHtml2CanvasPromise;
    }

    function receiptHasValue(value) {
      if (value == null) return false;
      if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
      const s = String(value).trim();
      return s !== '' && s !== '-' && s !== '—';
    }

    function receiptTextRow(label, value) {
      if (!receiptHasValue(value)) return '';
      return `<tr><td class="acr-label">${escapeHtml(label)}</td><td class="acr-value">${escapeHtml(String(value))}</td></tr>`;
    }

    function receiptAmountRow(label, value) {
      const num = Math.abs(Number(value) || 0);
      const formatted = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      const display = num ? `(${formatted})` : '0';
      return `<tr class="acr-total-row"><td class="acr-label acr-total-label">${escapeHtml(label)}</td><td class="acr-value acr-amount-value">${display}</td></tr>`;
    }

    function buildAdditionalCommissionReceiptHtml(row) {
      const typeLabel = getTypeLabel(getRowType(row));
      const account = String(row && row.account != null ? row.account : '').trim();
      const name = String(row && row.name != null ? row.name : '').trim();
      const amountLabel = (typeLabel || 'Amount').toUpperCase().replace(/-/g, '');
      const rows =
        receiptTextRow('PROGRAM DATE', formatProgramDate(row)) +
        receiptTextRow('ACCOUNT', account) +
        receiptTextRow('NAME', name) +
        receiptAmountRow(amountLabel, row.AMOUNT) +
        receiptTextRow('REMARKS', row.REMARKS);

      return `
        <div class="additional-commission-receipt-slip">
          <div class="additional-commission-receipt-slip-body">
            <p class="acr-brand">GOLDEN DRAGON</p>
            <p class="acr-title">* Additional Settlement *</p>
            <p class="acr-datetime">${escapeHtml(formatDateTime(row.ENCODED_DT))}</p>
            <table class="acr-table"><tbody>${rows}</tbody></table>
          </div>
          <div class="additional-commission-receipt-slip-actions">
            <button type="button" class="btn additional-commission-receipt-copy-btn js-copy-additional-commission-receipt-image">Copy image</button>
            <button type="button" class="btn additional-commission-receipt-copy-btn js-copy-additional-commission-receipt-text">Copy text</button>
          </div>
        </div>
      `;
    }

    function showAdditionalCommissionReceipt(recordId) {
      const row = records.find((item) => String(item.IDNo) === String(recordId));
      if (!row) {
        if (typeof Swal !== 'undefined') Swal.fire('Error', 'Record not found.', 'error');
        return;
      }
      const modalEl = document.getElementById('modal-additional-commission-receipt');
      const container = document.getElementById('additional-commission-receipt-container');
      if (!modalEl || !container) return;
      container.innerHTML = buildAdditionalCommissionReceiptHtml(row);
      if (window.jQuery) window.jQuery(modalEl).appendTo('body');
      if (dashListModalEl) modalEl.style.zIndex = '1065';
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }

    function receiptCopyUi(btn) {
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
      return {
        success(message) {
          if (typeof Swal !== 'undefined') {
            Swal.fire({ icon: 'success', title: 'Copied!', text: message, timer: 1800, showConfirmButton: false });
          }
        },
        error(message) {
          if (typeof Swal !== 'undefined') {
            Swal.fire({ icon: 'error', title: 'Copy failed', text: message });
          }
        },
        restore() {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      };
    }

    function copyAdditionalCommissionReceiptImage(btn) {
      const slip = btn.closest('.additional-commission-receipt-slip');
      const slipBody = slip ? slip.querySelector('.additional-commission-receipt-slip-body') : null;
      if (!slipBody) return;
      const ui = receiptCopyUi(btn);
      const blobPromise = loadReceiptHtml2Canvas()
        .then(() => html2canvas(slipBody, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false }))
        .then((canvas) => new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to create receipt image.'));
          }, 'image/png');
        }));

      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
          .then(() => ui.success('Receipt image copied. You can paste it anywhere.'))
          .catch((err) => ui.error((err && err.message) || 'Unable to copy receipt image.'))
          .finally(() => ui.restore());
      } else {
        blobPromise
          .then((blob) => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'additional-commission-receipt.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            ui.success('Receipt image downloaded.');
          })
          .catch((err) => ui.error((err && err.message) || 'Unable to copy receipt image.'))
          .finally(() => ui.restore());
      }
    }

    function copyAdditionalCommissionReceiptText(btn) {
      const slip = btn.closest('.additional-commission-receipt-slip');
      const slipBody = slip ? slip.querySelector('.additional-commission-receipt-slip-body') : null;
      const text = slipBody && slipBody.innerText ? slipBody.innerText.trim() : '';
      const ui = receiptCopyUi(btn);
      if (!text || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        ui.error('Clipboard is not supported in this browser.');
        ui.restore();
        return;
      }
      navigator.clipboard.writeText(text)
        .then(() => ui.success('Receipt text copied. You can paste it anywhere.'))
        .catch((err) => ui.error((err && err.message) || 'Unable to copy receipt text.'))
        .finally(() => ui.restore());
    }

    const receiptModalEl = document.getElementById('modal-additional-commission-receipt');
    if (receiptModalEl) {
      receiptModalEl.addEventListener('shown.bs.modal', function () {
        document.body.classList.add('additional-commission-receipt-open');
        loadReceiptHtml2Canvas().catch(() => {});
      });
      receiptModalEl.addEventListener('hidden.bs.modal', function () {
        document.body.classList.remove('additional-commission-receipt-open');
      });
    }

    document.addEventListener('click', function (event) {
      const imageBtn = event.target.closest('.js-copy-additional-commission-receipt-image');
      if (imageBtn) {
        copyAdditionalCommissionReceiptImage(imageBtn);
        return;
      }
      const textBtn = event.target.closest('.js-copy-additional-commission-receipt-text');
      if (textBtn) {
        copyAdditionalCommissionReceiptText(textBtn);
      }
    });

    window.loadAdditionalCommissionData = loadAdditionalCommissionData;

    // Enable DataTables UI (search + show entries).
    initDataTableOnce();
    initAdditionalCommissionSplitDateRange();
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
        if (additionalCommissionSplitDateRange && typeof additionalCommissionSplitDateRange.fitWidths === 'function') {
          additionalCommissionSplitDateRange.fitWidths();
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
      const receiptBtn = event.target.closest('.btn-receipt-additional-commission');
      const editBtn = event.target.closest('.btn-edit-additional-commission');
      const deleteBtn = event.target.closest('.btn-delete-additional-commission');

      if (receiptBtn) {
        showAdditionalCommissionReceipt(receiptBtn.dataset.id);
        return;
      }

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
          Swal.fire('Validation', 'Please select type (Transfer or Cash-out).', 'warning');
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
