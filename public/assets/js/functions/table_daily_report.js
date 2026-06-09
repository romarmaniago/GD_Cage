(() => {
  const tbody = document.getElementById('junket-tables-tbody');
  const btnOpenManage = document.getElementById('btn-open-add-junket-table');
  const btnOpenForm = document.getElementById('btn-open-junket-table-form-modal');
  const btnAddDailyReport = document.getElementById('btn-add-daily-report');
  const form = document.getElementById('junket-table-form');
  const fieldId = document.getElementById('junket-table-id');
  const fieldName = document.getElementById('junket-table-name');
  const btnSave = document.getElementById('btn-save-junket-table');
  const formModalTitle = document.getElementById('junket-table-form-modal-title');
  const dailyReportForm = document.getElementById('daily-report-form');
  const dailyReportDate = document.getElementById('daily-report-date');
  const dailyReportEntriesTbody = document.getElementById('daily-report-entries-tbody');
  const btnSaveDailyReport = document.getElementById('btn-save-daily-report');
  const reportMode = (dailyReportForm?.dataset?.reportMode || 'both').toLowerCase();
  const reportColspan = reportMode === 'both' ? 3 : 2;
  const reportListDateRange = document.getElementById('daily-report-list-daterange');
  const reportListThead = document.getElementById('daily-report-list-thead');
  const reportListTbody = document.getElementById('daily-report-list-tbody');
  const reportListTfoot = document.getElementById('daily-report-list-tfoot');
  const reportMatrixTable = document.getElementById('daily-report-view-table');
  const btnExportMatrix = document.getElementById('btn-export-daily-report-matrix');
  const btnPrintMatrix = document.getElementById('btn-print-daily-report-matrix');
  const manageModalEl = document.getElementById('junket-table-modal');
  const formModalEl = document.getElementById('junket-table-form-modal');
  const dailyReportModalEl = document.getElementById('daily-report-modal');
  const manageModal = manageModalEl ? new bootstrap.Modal(manageModalEl) : null;
  const formModal = formModalEl ? new bootstrap.Modal(formModalEl) : null;
  const dailyReportModal = dailyReportModalEl ? new bootstrap.Modal(dailyReportModalEl) : null;
  let dailyReportDatePicker = null;
  let reportListDateRangePicker = null;

  if (!tbody || !btnOpenManage || !btnOpenForm || !btnAddDailyReport || !form || !fieldId || !fieldName || !btnSave || !formModalTitle || !dailyReportForm || !dailyReportDate || !dailyReportEntriesTbody || !btnSaveDailyReport || !manageModal || !formModal || !dailyReportModal) {
    return;
  }

  function getCurrentMonthRange() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const toIso = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    return { from: toIso(first), to: toIso(last) };
  }

  function initDailyReportDatePicker() {
    if (dailyReportDatePicker || typeof flatpickr === 'undefined') return;
    dailyReportDatePicker = flatpickr(dailyReportDate, {
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'm/d/Y',
      allowInput: false,
      onChange: () => {
        loadDailyReportTables();
      }
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatIntegerWithCommas(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return '0';
    return Math.round(numeric).toLocaleString('en-US');
  }

  function formatAmount(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return '0';
    return Math.round(numeric).toLocaleString('en-US');
  }

  function getWinlossAmountClass(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric) || numeric === 0) return '';
    return numeric > 0 ? ' daily-report-winloss-positive' : ' daily-report-winloss-negative';
  }

  function formatMatrixAmountCell(value) {
    const numeric = Number(value);
    if (Number.isNaN(numeric) || numeric === 0) return '';
    if (numeric < 0) return `(${formatAmount(Math.abs(numeric))})`;
    return formatAmount(numeric);
  }

  function parseMatrixAmountInput(raw) {
    let s = String(raw ?? '').replace(/,/g, '').trim();
    if (!s || s === '-') return 0;
    const parenMatch = s.match(/^\((.+)\)$/);
    if (parenMatch) {
      const inner = parenMatch[1].replace(/,/g, '').trim();
      const n = Number(inner);
      return Number.isNaN(n) ? NaN : -Math.abs(Math.round(n));
    }
    const n = Number(s);
    return Number.isNaN(n) ? NaN : Math.round(n);
  }

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;');
  }

  function buildMatrixAmountCell(amount, tableName, junketTableId) {
    const amountClass = `daily-report-amount-col daily-report-editable-cell${getWinlossAmountClass(amount)}`;
    const idAttr = junketTableId ? ` data-junket-table-id="${junketTableId}"` : '';
    return `<td class="${amountClass}" data-table-name="${escapeAttr(tableName)}"${idAttr} data-amount="${amount}">${formatMatrixAmountCell(amount)}</td>`;
  }

  let matrixActiveEditor = null;

  function applyMatrixCellDisplay(cell, amount) {
    if (!cell) return;
    cell.dataset.amount = String(amount);
    cell.className = `daily-report-amount-col daily-report-editable-cell${getWinlossAmountClass(amount)}`;
    cell.textContent = formatMatrixAmountCell(amount);
  }

  function recalculateMatrixRowAndFooter() {
    const { table, tfoot } = getMatrixTableRefs();
    if (!table) return;

    const tableNames = Array.from(table.querySelectorAll('thead th.daily-report-amount-col'))
      .map((th) => th.textContent.trim());
    const columnTotals = {};
    tableNames.forEach((name) => { columnTotals[name] = 0; });
    let grandTotal = 0;

    table.querySelectorAll('tbody tr').forEach((tr) => {
      let rowTotal = 0;
      tr.querySelectorAll('td.daily-report-editable-cell').forEach((cell, idx) => {
        const amt = Number(cell.dataset.amount) || 0;
        rowTotal += amt;
        const name = tableNames[idx];
        if (name) columnTotals[name] += amt;
      });
      grandTotal += rowTotal;

      const totalCell = tr.querySelector('td.daily-report-total-col');
      if (totalCell) {
        totalCell.dataset.amount = String(rowTotal);
        totalCell.className = `daily-report-total-col${getWinlossAmountClass(rowTotal)}`;
        totalCell.textContent = formatMatrixAmountCell(rowTotal);
      }
    });

    const footerRow = tfoot ? tfoot.querySelector('tr') : null;
    if (!footerRow) return;

    footerRow.querySelectorAll('th.daily-report-amount-col').forEach((th, idx) => {
      const name = tableNames[idx];
      const total = name ? columnTotals[name] : 0;
      th.className = `daily-report-amount-col${getWinlossAmountClass(total)}`;
      th.textContent = formatMatrixAmountCell(total) || '0';
    });

    const grandCell = footerRow.querySelector('th.daily-report-total-col');
    if (grandCell) {
      grandCell.className = `daily-report-total-col${getWinlossAmountClass(grandTotal)}`;
      grandCell.textContent = formatMatrixAmountCell(grandTotal) || '0';
    }
  }

  async function saveMatrixCellValue(cell, amount) {
    const tableName = cell.dataset.tableName;
    const junketTableId = parseInt(cell.dataset.junketTableId, 10);
    const row = cell.closest('tr');
    const reportDate = row ? row.dataset.reportDate : '';
    const originalAmount = Number(cell.dataset.amount) || 0;

    if (!reportDate || !junketTableId) {
      applyMatrixCellDisplay(cell, originalAmount);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Unable to identify table for this cell.' });
      return;
    }

    cell.classList.add('is-saving');
    const payload = {
      report_date: reportDate,
      report_mode: reportMode,
      reports: [{
        junket_table_id: junketTableId,
        table_name: tableName,
        rolling: reportMode === 'rolling' ? amount : 0,
        winloss: reportMode === 'winloss' ? amount : 0
      }]
    };

    try {
      const response = await fetch('/add_daily_table_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Unable to save');

      applyMatrixCellDisplay(cell, amount);
      recalculateMatrixRowAndFooter();
    } catch (err) {
      console.error('saveMatrixCellValue:', err);
      applyMatrixCellDisplay(cell, originalAmount);
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to save cell.' });
    } finally {
      cell.classList.remove('is-saving');
    }
  }

  async function finishMatrixCellEdit(editor, cancel) {
    if (!editor || !editor.cell) return;
    const { cell, input, originalAmount } = editor;
    if (!cell.classList.contains('is-editing')) return;

    matrixActiveEditor = null;
    cell.classList.remove('is-editing');

    if (cancel) {
      applyMatrixCellDisplay(cell, originalAmount);
      return;
    }

    const parsed = parseMatrixAmountInput(input.value);
    if (Number.isNaN(parsed)) {
      applyMatrixCellDisplay(cell, originalAmount);
      Swal.fire({ icon: 'warning', title: 'Invalid', text: 'Enter a valid number (e.g. -1000 or (1000)).' });
      return;
    }

    if (parsed === originalAmount) {
      applyMatrixCellDisplay(cell, parsed);
      return;
    }

    await saveMatrixCellValue(cell, parsed);
  }

  async function beginMatrixCellEdit(cell) {
    if (!cell || !cell.classList.contains('daily-report-editable-cell')) return;
    if (cell.classList.contains('is-editing')) return;

    if (matrixActiveEditor && matrixActiveEditor.cell !== cell) {
      await finishMatrixCellEdit(matrixActiveEditor, false);
    }

    const currentAmount = Number(cell.dataset.amount) || 0;
    const rawEdit = currentAmount === 0 ? '' : String(currentAmount);

    cell.classList.add('is-editing');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'daily-report-cell-input form-control form-control-sm';
    input.value = rawEdit;
    input.inputMode = 'decimal';
    cell.textContent = '';
    cell.appendChild(input);
    matrixActiveEditor = { cell, input, originalAmount: currentAmount };
    input.focus();
    input.select();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishMatrixCellEdit(matrixActiveEditor, false);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finishMatrixCellEdit(matrixActiveEditor, true);
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (matrixActiveEditor && matrixActiveEditor.cell === cell) {
          finishMatrixCellEdit(matrixActiveEditor, false);
        }
      }, 120);
    });
  }

  function initMatrixCellEditing() {
    const wrap = document.querySelector('.daily-report-table-wrap');
    if (!wrap || wrap.dataset.matrixEditBound === '1') return;
    wrap.dataset.matrixEditBound = '1';
    wrap.addEventListener('click', (event) => {
      const cell = event.target.closest('td.daily-report-editable-cell');
      if (!cell || event.target.closest('.daily-report-cell-input')) return;
      beginMatrixCellEdit(cell).catch((err) => console.error('beginMatrixCellEdit:', err));
    });
  }

  function formatDateDisplay(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return escapeHtml(raw);
    return `${match[2]}/${match[3]}/${match[1]}`;
  }

  function parseFormattedInteger(value) {
    const clean = String(value ?? '').replace(/,/g, '').trim();
    if (!clean) return NaN;
    const numeric = Number(clean);
    if (Number.isNaN(numeric)) return NaN;
    return Math.round(numeric);
  }

  function renderRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">No tables yet.</td></tr>';
      return;
    }

    const items = rows.map((row) => {
      const actions = `
        <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-junket-table"
          data-id="${row.id}" data-name="${escapeHtml(row.table_name)}" title="Edit" aria-label="Edit table">
          <i class="fa fa-pen"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger btn-remove-junket-table"
          data-id="${row.id}" data-name="${escapeHtml(row.table_name)}" title="Delete" aria-label="Delete table">
          <i class="fa fa-trash"></i>
        </button>
      `;

      return `
        <tr>
          <td>${escapeHtml(row.table_name)}</td>
          <td class="text-center">${actions}</td>
        </tr>
      `;
    });

    tbody.innerHTML = items.join('');
  }

  async function loadTables() {
    tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">Loading tables...</td></tr>';
    try {
      const response = await fetch('/junket_tables_data');
      if (!response.ok) throw new Error('Failed to load tables');
      const data = await response.json();
      renderRows(data);
    } catch (error) {
      console.error('loadTables:', error);
      tbody.innerHTML = '<tr><td colspan="2" class="text-center text-danger py-3">Failed to load data.</td></tr>';
    }
  }

  function renderDailyReportRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      dailyReportEntriesTbody.innerHTML = `<tr><td colspan="${reportColspan}" class="text-center text-muted py-3">All tables are already added for this date.</td></tr>`;
      btnSaveDailyReport.disabled = true;
      return;
    }
    btnSaveDailyReport.disabled = false;

    const items = rows.map((row) => {
      const tableCell = `
        <td>
          ${escapeHtml(row.table_name)}
          <input type="hidden" class="daily-report-table-id" value="${row.id}">
          <input type="hidden" class="daily-report-table-name" value="${escapeHtml(row.table_name)}">
        </td>
      `;

      if (reportMode === 'rolling') {
        return `
          <tr>
            ${tableCell}
            <td>
              <input type="text" class="form-control form-control-sm daily-report-rolling" value="" placeholder="0" inputmode="numeric">
            </td>
          </tr>
        `;
      }

      if (reportMode === 'winloss') {
        return `
          <tr>
            ${tableCell}
            <td>
              <input type="text" class="form-control form-control-sm daily-report-winloss" value="" placeholder="0" inputmode="numeric">
            </td>
          </tr>
        `;
      }

      return `
        <tr>
          ${tableCell}
          <td>
            <input type="text" class="form-control form-control-sm daily-report-rolling" value="" placeholder="0" inputmode="numeric">
          </td>
          <td>
            <input type="text" class="form-control form-control-sm daily-report-winloss" value="" placeholder="0" inputmode="numeric">
          </td>
        </tr>
      `;
    });

    dailyReportEntriesTbody.innerHTML = items.join('');
  }

  async function loadDailyReportTables() {
    try {
      const reportDate = dailyReportDate.value;
      if (!reportDate) {
        dailyReportEntriesTbody.innerHTML = `<tr><td colspan="${reportColspan}" class="text-center text-muted py-3">Select report date first.</td></tr>`;
        btnSaveDailyReport.disabled = true;
        return;
      }

      const response = await fetch(`/daily_report_available_tables?report_date=${encodeURIComponent(reportDate)}&report_mode=${encodeURIComponent(reportMode)}`);
      if (!response.ok) throw new Error('Failed to load tables');
      const rows = await response.json();
      renderDailyReportRows(rows || []);
    } catch (error) {
      console.error('loadDailyReportTables:', error);
      dailyReportEntriesTbody.innerHTML = `<tr><td colspan="${reportColspan}" class="text-center text-danger py-3">Unable to load tables.</td></tr>`;
      btnSaveDailyReport.disabled = true;
    }
  }

  function getSelectedListRange() {
    const fallback = getCurrentMonthRange();
    if (!reportListDateRangePicker || !Array.isArray(reportListDateRangePicker.selectedDates) || reportListDateRangePicker.selectedDates.length === 0) {
      return fallback;
    }

    const selected = reportListDateRangePicker.selectedDates;
    const toIso = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    const from = toIso(selected[0]);
    const to = selected[1] ? toIso(selected[1]) : from;
    return { from, to };
  }

  function resetDailyReportDateFilterMount() {
    const $ = window.jQuery;
    if (!$) return;
    const $mount = $('#daily-report-daterange-mount');
    if (!$mount.length) return;
    const $cardBody = $mount.closest('.card-body');
    $mount.detach().removeClass('is-placed').removeData('placed');
    const $tableWrap = $cardBody.find('.daily-report-table-wrap, .table-responsive').first();
    if ($tableWrap.length) {
      $mount.insertBefore($tableWrap);
    } else if ($cardBody.length) {
      $cardBody.prepend($mount);
    }
  }

  /** DataTables destroy(true) removes the table from the DOM; restore shell if missing. */
  function ensureMatrixTableShell() {
    const wrap = document.querySelector('.daily-report-table-wrap');
    if (!wrap) return;
    if (document.getElementById('daily-report-view-table')) return;
    wrap.innerHTML = [
      '<table id="daily-report-view-table" class="table small-text mb-0" style="width:100%">',
      '<thead id="daily-report-list-thead">',
      '<tr><th class="daily-report-date-col">Date</th><th class="daily-report-total-col">Total</th></tr>',
      '</thead>',
      '<tbody id="daily-report-list-tbody"></tbody>',
      '<tfoot id="daily-report-list-tfoot"></tfoot>',
      '</table>'
    ].join('');
  }

  function getMatrixTableRefs() {
    ensureMatrixTableShell();
    return {
      table: document.getElementById('daily-report-view-table'),
      thead: document.getElementById('daily-report-list-thead'),
      tbody: document.getElementById('daily-report-list-tbody'),
      tfoot: document.getElementById('daily-report-list-tfoot')
    };
  }

  function placeDailyReportDateFilter() {
    const $ = window.jQuery;
    if (!$) return;
    const $mount = $('#daily-report-daterange-mount');
    const $length = $('#daily-report-view-table').closest('.dataTables_wrapper').find('.dataTables_length').first();
    if (!$mount.length || !$length.length || $mount.data('placed')) return;
    $mount.detach().insertAfter($length).addClass('is-placed').data('placed', true);
  }

  function destroyMatrixDataTable() {
    const $ = window.jQuery;
    if (!$ || !$.fn.DataTable) return;
    resetDailyReportDateFilterMount();
    const $table = $('#daily-report-view-table');
    if ($.fn.DataTable.isDataTable('#daily-report-view-table')) {
      $table.DataTable().destroy(false);
    }
  }

  function applyMatrixColumnWidths(columnCount) {
    const matrixTable = getMatrixTableRefs().table;
    if (!matrixTable || columnCount < 2) return;
    matrixTable.querySelectorAll('colgroup').forEach((el) => el.remove());
    const cg = document.createElement('colgroup');
    const datePct = 7.5;
    const totalPct = 7.5;
    const amountCols = columnCount - 2;
    const amountPct = amountCols > 0 ? (100 - datePct - totalPct) / amountCols : 0;
    const addCol = (pct) => {
      const col = document.createElement('col');
      col.style.width = `${pct}%`;
      cg.appendChild(col);
    };
    addCol(datePct);
    for (let i = 0; i < amountCols; i += 1) addCol(amountPct);
    addCol(totalPct);
    const firstSection = matrixTable.querySelector('thead, tbody, tfoot');
    if (firstSection) {
      matrixTable.insertBefore(cg, firstSection);
    } else {
      matrixTable.appendChild(cg);
    }
  }

  function initMatrixDataTable(columnCount) {
    const $ = window.jQuery;
    const matrixTable = getMatrixTableRefs().table;
    if (!$ || !$.fn.DataTable || !matrixTable || columnCount < 2) return;
    if ($.fn.DataTable.isDataTable('#daily-report-view-table')) return;

    applyMatrixColumnWidths(columnCount);

    const amountTargets = [];
    for (let i = 1; i < columnCount - 1; i += 1) {
      amountTargets.push(i);
    }

    $('#daily-report-view-table').DataTable({
      paging: true,
      searching: true,
      ordering: true,
      order: [[0, 'asc']],
      pageLength: -1,
      lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
      autoWidth: false,
      scrollX: false,
      info: true,
      language: {
        search: 'Search:',
        info: 'Showing _START_ to _END_ of _TOTAL_ entries',
        paginate: {
          previous: 'Previous',
          next: 'Next'
        },
        emptyTable: 'No data available in table'
      },
      columnDefs: [
        { targets: 0, className: 'daily-report-date-col' },
        { targets: amountTargets, className: 'daily-report-amount-col', orderable: false },
        { targets: columnCount - 1, className: 'daily-report-total-col' }
      ],
      drawCallback: function () {
        placeDailyReportDateFilter();
      }
    });

    placeDailyReportDateFilter();
  }

  function enumerateDatesIso(from, to) {
    const parse = (s) => {
      const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    };
    let start = parse(from);
    let end = parse(to);
    if (!start || !end) return [];
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }
    const out = [];
    for (let cur = new Date(start.getTime()); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const y = cur.getFullYear();
      const mo = String(cur.getMonth() + 1).padStart(2, '0');
      const day = String(cur.getDate()).padStart(2, '0');
      out.push(`${y}-${mo}-${day}`);
    }
    return out;
  }

  /** Last run of digits in table name (e.g. "VIP 7A SS90705" → 90705); used when junket id unknown. */
  function trailingNumericFromTableName(name) {
    const m = String(name || '').match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  function sortTableNamesByJunketId(names, junketRows, listRows) {
    const idByName = new Map();
    (junketRows || []).forEach((r) => {
      const n = String(r.table_name || '').trim();
      if (n) idByName.set(n, Number(r.id));
    });
    (listRows || []).forEach((r) => {
      const n = String(r.table_name || '').trim();
      if (!n || idByName.has(n)) return;
      const jid = r.junket_table_id != null ? Number(r.junket_table_id) : NaN;
      if (!Number.isNaN(jid)) idByName.set(n, jid);
    });
    return [...names].sort((a, b) => {
      const ida = idByName.get(a);
      const idb = idByName.get(b);
      const hasA = ida != null && !Number.isNaN(ida);
      const hasB = idb != null && !Number.isNaN(idb);
      if (hasA && hasB && ida !== idb) return ida - idb;
      if (hasA && !hasB) return -1;
      if (!hasA && hasB) return 1;
      const na = trailingNumericFromTableName(a);
      const nb = trailingNumericFromTableName(b);
      if (na != null && nb != null && na !== nb) return na - nb;
      if (na != null && nb == null) return -1;
      if (na == null && nb != null) return 1;
      return a.localeCompare(b);
    });
  }

  function initReportListDateRangePicker() {
    if (!reportListDateRange || reportListDateRangePicker || typeof flatpickr === 'undefined') return;
    const monthRange = getCurrentMonthRange();
    const jumpToCurrentThreeMonths = (instance) => {
      if (!instance) return;
      const current = new Date();
      instance.jumpToDate(new Date(current.getFullYear(), current.getMonth() - 2, 1), false);
    };
    reportListDateRangePicker = flatpickr(reportListDateRange, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'M d, Y',
      conjunction: ' to ',
      allowInput: false,
      defaultDate: [monthRange.from, monthRange.to],
      showMonths: 3,
      onReady: (_selectedDates, _dateStr, instance) => {
        jumpToCurrentThreeMonths(instance);
        if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
          window.setupFlatpickrMonthNameRangeSelect(instance);
        }
      },
      onOpen: (_selectedDates, _dateStr, instance) => {
        jumpToCurrentThreeMonths(instance);
        if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
          window.setupFlatpickrMonthNameRangeSelect(instance);
        }
      },
      onMonthChange: (_selectedDates, _dateStr, instance) => {
        if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
          window.styleFlatpickrMonthNameClickable(instance);
        }
      },
      onChange: (selectedDates) => {
        if (selectedDates.length === 2) loadSubmittedReports();
      }
    });
  }

  function clearMatrixFooter() {
    const { tfoot } = getMatrixTableRefs();
    if (tfoot) tfoot.innerHTML = '';
  }

  function renderSubmittedReports(rows, range, junketRows) {
    const { thead, tbody } = getMatrixTableRefs();
    if (!tbody || !thead) return;
    destroyMatrixDataTable();
    clearMatrixFooter();
    const listRows = Array.isArray(rows) ? rows : [];
    const junket = Array.isArray(junketRows) ? junketRows : [];
    const effectiveRange = range && range.from && range.to ? range : getSelectedListRange();

    const namesFromJunket = junket.map((r) => String(r.table_name || '')).filter(Boolean);
    const namesFromRows = listRows.map((row) => String(row.table_name || '')).filter(Boolean);
    const tableNames = sortTableNamesByJunketId(
      [...new Set([...namesFromJunket, ...namesFromRows])],
      junket,
      listRows
    );

    const tableNameToId = {};
    junket.forEach((row) => {
      const name = String(row.table_name || '').trim();
      if (name) tableNameToId[name] = Number(row.id);
    });
    listRows.forEach((row) => {
      const name = String(row.table_name || '').trim();
      if (name && row.junket_table_id) tableNameToId[name] = Number(row.junket_table_id);
    });

    const dateMap = new Map();
    listRows.forEach((row) => {
      const dateKey = String(row.report_date || '');
      const tableName = String(row.table_name || '');
      const value = Number(reportMode === 'rolling' ? row.rolling_amt : row.winloss_amt) || 0;
      if (!dateKey || !tableName) return;

      if (!dateMap.has(dateKey)) dateMap.set(dateKey, {});
      const perDate = dateMap.get(dateKey);
      perDate[tableName] = value;
    });

    let dateKeys = enumerateDatesIso(effectiveRange.from, effectiveRange.to);
    if (dateKeys.length === 0) {
      dateKeys = [...dateMap.keys()].sort((a, b) => a.localeCompare(b));
    }

    if (tableNames.length === 0 && dateKeys.length === 0) {
      destroyMatrixDataTable();
      thead.innerHTML = '<tr><th class="daily-report-date-col">Date</th><th class="daily-report-total-col">Total</th></tr>';
      tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">No added reports for selected date.</td></tr>';
      return;
    }
    const headCols = tableNames.map((name) => `<th class="daily-report-amount-col">${escapeHtml(name)}</th>`).join('');
    thead.innerHTML = `
      <tr>
        <th class="daily-report-date-col">Date</th>
        ${headCols}
        <th class="daily-report-total-col">Total</th>
      </tr>
    `;

    const columnTotals = {};
    tableNames.forEach((name) => { columnTotals[name] = 0; });
    let grandTotal = 0;

    const items = dateKeys.map((dateKey) => {
      const perDate = dateMap.get(dateKey) || {};
      let rowTotal = 0;
      const valueCols = tableNames.map((name) => {
        const amount = Number(perDate[name] || 0);
        columnTotals[name] += amount;
        rowTotal += amount;
        return buildMatrixAmountCell(amount, name, tableNameToId[name]);
      }).join('');

      grandTotal += rowTotal;
      const rowTotalClass = `daily-report-total-col${getWinlossAmountClass(rowTotal)}`;
      return `
        <tr data-report-date="${escapeAttr(dateKey)}">
          <td class="daily-report-date-col">${formatDateDisplay(dateKey)}</td>
          ${valueCols}
          <td class="${rowTotalClass}">${formatMatrixAmountCell(rowTotal)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = items.join('');

    const { tfoot } = getMatrixTableRefs();
    if (tfoot) {
      const totalCols = tableNames.map((name) => {
        const total = columnTotals[name];
        const amountClass = `daily-report-amount-col${getWinlossAmountClass(total)}`;
        return `<th class="${amountClass}">${formatMatrixAmountCell(total) || '0'}</th>`;
      }).join('');
      const grandTotalClass = `daily-report-total-col${getWinlossAmountClass(grandTotal)}`;
      tfoot.innerHTML = `
        <tr>
          <th class="daily-report-date-col">GRAND TOTAL</th>
          ${totalCols}
          <th class="${grandTotalClass}">${formatMatrixAmountCell(grandTotal) || '0'}</th>
        </tr>
      `;
    }

    initMatrixDataTable(tableNames.length + 2);
    initMatrixCellEditing();
  }

  async function exportDailyReportMatrix() {
    const matrixTable = getMatrixTableRefs().table;
    if (!matrixTable) return;
    const theadRow = matrixTable.querySelector('thead tr');
    if (!theadRow) return;
    const headers = Array.from(theadRow.querySelectorAll('th')).map((th) => th.textContent.trim());
    if (headers.length < 2) {
      Swal.fire({ icon: 'info', title: 'Export', text: 'No data to export.' });
      return;
    }
    const rows = [];
    const collectMatrixRows = (selector) => {
      matrixTable.querySelectorAll(selector).forEach((tr) => {
        const cells = tr.querySelectorAll('td, th');
        if (cells.length === 1 && cells[0].hasAttribute('colspan')) return;
        const values = Array.from(cells).map((cell) => cell.textContent.trim());
        if (values.length === headers.length) rows.push(values);
      });
    };
    collectMatrixRows('tbody tr');
    collectMatrixRows('tfoot tr');
    if (rows.length === 0) {
      Swal.fire({ icon: 'info', title: 'Export', text: 'No data to export for the current view.' });
      return;
    }
    const range = getSelectedListRange();
    const modeLabel = reportMode === 'winloss' ? 'Winloss' : 'Rolling';
    const filename = `${modeLabel}_${range.from}_${range.to}.xlsx`;
    const sheetName = reportMode === 'winloss' ? 'Winloss' : 'Rolling';
    const btn = btnExportMatrix;
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/daily_report_matrix/export_xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ headers, rows, filename, sheetName })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Export failed');
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('exportDailyReportMatrix:', err);
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Export failed.' });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function getDailyReportMatrixPayload() {
    const matrixTable = getMatrixTableRefs().table;
    if (!matrixTable) return { headers: [], rows: [] };
    const theadRow = matrixTable.querySelector('thead tr');
    const headers = theadRow ? Array.from(theadRow.querySelectorAll('th')).map((th) => th.textContent.trim()) : [];
    const rows = [];
    const collectMatrixRows = (selector) => {
      matrixTable.querySelectorAll(selector).forEach((tr) => {
        const cells = tr.querySelectorAll('td, th');
        if (cells.length === 1 && cells[0].hasAttribute('colspan')) return;
        const values = Array.from(cells).map((cell) => cell.textContent.trim());
        if (values.length === headers.length) rows.push(values);
      });
    };
    collectMatrixRows('tbody tr');
    collectMatrixRows('tfoot tr');
    return { headers, rows };
  }

  function getDailyReportPrintStyles() {
    return [
      '@page{size:landscape;margin:8mm;}',
      'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
      '.print-wrap{width:100%;}',
      'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
      '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
      'table{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed;}',
      'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;white-space:normal;overflow-wrap:anywhere;}',
      'th{text-align:center;background:var(--bs-primary-bg-subtle,#d9e1f2);color:var(--bs-primary,#0d6efd);font-weight:500;}',
      'td{text-align:right;padding-right:14px;color:#666;}',
      'td:first-child,th:first-child{text-align:left;padding-left:14px;padding-right:7px;color:#333;}',
      'tfoot th{background:#f4f6fa;font-weight:600;border-top:2px solid #dee2e6;}',
      'tbody tr{border-bottom:1px solid #eee;}'
    ].join('');
  }

  function printDailyReportMatrix() {
    const payload = getDailyReportMatrixPayload();
    if (payload.headers.length < 2 || payload.rows.length === 0) {
      Swal.fire({ icon: 'info', title: 'Print', text: 'No data to print for the current view.' });
      return;
    }
    const range = getSelectedListRange();
    const modeLabel = reportMode === 'winloss' ? 'Winloss' : 'Rolling';
    const headerHtml = payload.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const rowsHtml = payload.rows.map((row) => {
      return `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
    }).join('');
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDoc = frameWindow.document;
    frameDoc.open();
    frameDoc.write([
      '<!doctype html><html><head><title>', escapeHtml(modeLabel), '</title><style>',
      getDailyReportPrintStyles(),
      '</style></head><body><div class="print-wrap">',
      '<h2>', escapeHtml(modeLabel), '</h2>',
      '<div class="subtitle">', escapeHtml(`${formatDateDisplay(range.from)} to ${formatDateDisplay(range.to)}`), '</div>',
      '<table><thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody></table>',
      '</div></body></html>'
    ].join(''));
    frameDoc.close();
    const cleanup = () => {
      setTimeout(() => {
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 300);
    };
    frameWindow.onafterprint = cleanup;
    setTimeout(() => {
      frameWindow.focus();
      frameWindow.print();
      cleanup();
    }, 250);
  }

  async function loadSubmittedReports() {
    const { thead, tbody } = getMatrixTableRefs();
    if (!tbody || !thead) return;
    destroyMatrixDataTable();
    clearMatrixFooter();
    tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">Loading reports...</td></tr>';
    try {
      const range = getSelectedListRange();
      const [listRes, junketRes] = await Promise.all([
        fetch(`/daily_report_list?report_mode=${encodeURIComponent(reportMode)}&report_date_from=${encodeURIComponent(range.from)}&report_date_to=${encodeURIComponent(range.to)}`),
        fetch('/junket_tables_data')
      ]);
      if (!listRes.ok) throw new Error('Failed to load reports');
      const data = await listRes.json();
      let junketData = [];
      if (junketRes.ok) {
        junketData = await junketRes.json();
        if (!Array.isArray(junketData)) junketData = [];
      }
      renderSubmittedReports(data || [], range, junketData);
    } catch (error) {
      console.error('loadSubmittedReports:', error);
      clearMatrixFooter();
      const errRefs = getMatrixTableRefs();
      if (errRefs.tbody) {
        errRefs.tbody.innerHTML = '<tr><td colspan="2" class="text-center text-danger py-3">Unable to load reports.</td></tr>';
      }
    }
  }

  function setFormAsAdd() {
    fieldId.value = '';
    formModalTitle.textContent = 'Add Table';
    btnSave.textContent = 'Save';
  }

  function openFormModalForAdd() {
    setFormAsAdd();
    fieldName.value = '';
    formModal.show();
    setTimeout(() => fieldName.focus(), 150);
  }

  function openEditModal(id, name) {
    fieldId.value = String(id);
    fieldName.value = name || '';
    formModalTitle.textContent = 'Edit Table';
    btnSave.textContent = 'Update';
    formModal.show();
    setTimeout(() => fieldName.focus(), 150);
  }

  async function saveTable(event) {
    event.preventDefault();

    const id = fieldId.value.trim();
    const name = fieldName.value.trim();
    if (!name) {
      Swal.fire({ icon: 'warning', title: 'Required', text: 'Table name is required.' });
      return;
    }

    const isEdit = !!id;
    const url = isEdit ? `/junket_table/${id}` : '/add_junket_table';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: name })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Unable to save table');
      }

      formModal.hide();
      setFormAsAdd();
      fieldName.value = '';
      await loadTables();
      Swal.fire({
        icon: 'success',
        title: 'Saved',
        text: payload.message || 'Table saved successfully.',
        timer: 1300,
        showConfirmButton: false
      });
    } catch (error) {
      console.error('saveTable:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Unable to save table.' });
    }
  }

  async function removeTable(id, name) {
    const confirm = await Swal.fire({
      icon: 'warning',
      title: 'Delete table?',
      text: `Remove "${name}" from active list?`,
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#d33'
    });
    if (!confirm.isConfirmed) return;

    try {
      const response = await fetch(`/junket_table/remove/${id}`, { method: 'PUT' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Unable to delete table');
      }

      await loadTables();
      Swal.fire({
        icon: 'success',
        title: 'Deleted',
        text: payload.message || 'Table deleted successfully.',
        timer: 1300,
        showConfirmButton: false
      });
    } catch (error) {
      console.error('removeTable:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Unable to delete table.' });
    }
  }

  function resetDailyReportForm() {
    dailyReportForm.reset();
    if (dailyReportDatePicker) {
      dailyReportDatePicker.clear();
    } else {
      dailyReportDate.value = '';
    }
    dailyReportEntriesTbody.innerHTML = `<tr><td colspan="${reportColspan}" class="text-center text-muted py-3">Loading tables...</td></tr>`;
    btnSaveDailyReport.disabled = true;
  }

  async function openDailyReportModal() {
    initDailyReportDatePicker();
    resetDailyReportForm();
    await loadDailyReportTables();
    dailyReportModal.show();
  }

  async function saveDailyReport(event) {
    event.preventDefault();

    const reportDate = dailyReportDate.value;
    if (!reportDate) {
      Swal.fire({ icon: 'warning', title: 'Required', text: 'Report date is required.' });
      return;
    }

    const rows = Array.from(dailyReportEntriesTbody.querySelectorAll('tr'));
    const reports = [];

    rows.forEach((row) => {
      const tableIdField = row.querySelector('.daily-report-table-id');
      const tableNameField = row.querySelector('.daily-report-table-name');
      const rollingField = row.querySelector('.daily-report-rolling');
      const winlossField = row.querySelector('.daily-report-winloss');
      if (!tableIdField) return;

      const rollingRaw = rollingField ? String(rollingField.value || '').replace(/,/g, '').trim() : '';
      const winlossRaw = winlossField ? String(winlossField.value || '').replace(/,/g, '').trim() : '';

      if (reportMode === 'rolling' && rollingRaw === '') return;
      if (reportMode === 'winloss' && winlossRaw === '') return;
      if (reportMode === 'both' && rollingRaw === '' && winlossRaw === '') return;

      const rollingValue = rollingField ? parseFormattedInteger(rollingField.value) : 0;
      const winlossValue = winlossField ? parseFormattedInteger(winlossField.value) : 0;

      reports.push({
        junket_table_id: parseInt(tableIdField.value, 10),
        table_name: tableNameField ? tableNameField.value : '',
        rolling: rollingValue,
        winloss: winlossValue
      });
    });

    if (reports.length === 0) {
      Swal.fire({ icon: 'warning', title: 'No Entries', text: 'Enter at least one amount before saving.' });
      return;
    }

    const invalid = reports.find((item) => Number.isNaN(item.rolling) || Number.isNaN(item.winloss));
    if (invalid) {
      const invalidText = reportMode === 'rolling'
        ? 'Rolling must be a valid number for all tables.'
        : reportMode === 'winloss'
          ? 'Winloss must be a valid number for all tables.'
          : 'Rolling and Winloss must be valid numbers for all tables.';
      Swal.fire({ icon: 'warning', title: 'Invalid Input', text: invalidText });
      return;
    }

    try {
      const response = await fetch('/add_daily_table_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_date: reportDate,
          report_mode: reportMode,
          reports
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Unable to save report');
      }

      dailyReportModal.hide();
      resetDailyReportForm();
      await loadSubmittedReports();
      Swal.fire({
        icon: 'success',
        title: 'Saved',
        text: payload.message || 'Daily report saved successfully.',
        timer: 1300,
        showConfirmButton: false
      });
    } catch (error) {
      console.error('saveDailyReport:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Unable to save report.' });
    }
  }

  btnOpenManage.addEventListener('click', () => {
    manageModal.show();
  });
  btnOpenForm.addEventListener('click', openFormModalForAdd);
  btnAddDailyReport.addEventListener('click', openDailyReportModal);
  form.addEventListener('submit', saveTable);
  dailyReportForm.addEventListener('submit', saveDailyReport);
  dailyReportDate.addEventListener('change', () => {
    loadDailyReportTables();
  });
  if (reportListDateRange) {
    initReportListDateRangePicker();
    initMatrixCellEditing();
    loadSubmittedReports();
  }
  if (btnExportMatrix) {
    btnExportMatrix.addEventListener('click', () => {
      exportDailyReportMatrix();
    });
  }
  if (btnPrintMatrix) {
    btnPrintMatrix.addEventListener('click', () => {
      printDailyReportMatrix();
    });
  }
  dailyReportEntriesTbody.addEventListener('input', (event) => {
    const input = event.target;
    if (!input.classList.contains('daily-report-rolling') && !input.classList.contains('daily-report-winloss')) {
      return;
    }

    const digitsOnly = String(input.value || '').replace(/[^\d-]/g, '');
    if (digitsOnly === '' || digitsOnly === '-') {
      input.value = '';
      return;
    }

    const numberValue = Number(digitsOnly);
    if (Number.isNaN(numberValue)) {
      input.value = '';
      return;
    }

    input.value = formatIntegerWithCommas(numberValue);
  });
  formModalEl.addEventListener('hidden.bs.modal', () => {
    setFormAsAdd();
    fieldName.value = '';
  });
  dailyReportModalEl.addEventListener('hidden.bs.modal', () => {
    resetDailyReportForm();
  });
  manageModalEl.addEventListener('shown.bs.modal', () => {
    loadTables();
  });

  tbody.addEventListener('click', (event) => {
    const editBtn = event.target.closest('.btn-edit-junket-table');
    if (editBtn) {
      openEditModal(editBtn.dataset.id, editBtn.dataset.name);
      return;
    }

    const removeBtn = event.target.closest('.btn-remove-junket-table');
    if (removeBtn) {
      removeTable(removeBtn.dataset.id, removeBtn.dataset.name);
    }
  });

  setFormAsAdd();
})();
