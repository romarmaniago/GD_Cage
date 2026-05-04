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
  const reportMatrixTable = document.getElementById('daily-report-view-table');
  const btnExportMatrix = document.getElementById('btn-export-daily-report-matrix');
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

  /** Every calendar day from `from` to `to` inclusive as `YYYY-MM-DD`, ascending. */
  function replaceMatrixColgroup(colCount) {
    if (!reportMatrixTable || colCount < 1) return;
    reportMatrixTable.querySelectorAll('colgroup').forEach((el) => el.remove());
    const cg = document.createElement('colgroup');
    const pct = `${(100 / colCount).toFixed(6)}%`;
    for (let i = 0; i < colCount; i += 1) {
      const col = document.createElement('col');
      col.style.width = pct;
      cg.appendChild(col);
    }
    const firstSection = reportMatrixTable.querySelector('thead, tbody, tfoot, caption');
    if (firstSection) {
      reportMatrixTable.insertBefore(cg, firstSection);
    } else {
      reportMatrixTable.appendChild(cg);
    }
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
    reportListDateRangePicker = flatpickr(reportListDateRange, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'M j, Y',
      conjunction: ' - ',
      allowInput: false,
      defaultDate: [monthRange.from, monthRange.to],
      onChange: (selectedDates) => {
        if (selectedDates.length === 2) loadSubmittedReports();
      }
    });
  }

  function renderSubmittedReports(rows, range, junketRows) {
    if (!reportListTbody || !reportListThead) return;
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
      replaceMatrixColgroup(2);
      reportListThead.innerHTML = '<tr><th>Date</th><th>Total</th></tr>';
      reportListTbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">No added reports for selected date.</td></tr>';
      return;
    }
    const headCols = tableNames.map((name) => `<th>${escapeHtml(name)}</th>`).join('');
    replaceMatrixColgroup(tableNames.length + 2);
    reportListThead.innerHTML = `
      <tr>
        <th>Date</th>
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
        return `<td>${amount === 0 ? '' : formatAmount(amount)}</td>`;
      }).join('');

      grandTotal += rowTotal;
      return `
        <tr>
          <td>${formatDateDisplay(dateKey)}</td>
          ${valueCols}
          <td class="daily-report-total-col">${formatAmount(rowTotal)}</td>
        </tr>
      `;
    });

    const totalCols = tableNames.map((name) => `<td>${formatAmount(columnTotals[name])}</td>`).join('');
    items.push(`
      <tr class="fw-bold daily-report-total-row">
        <td>Total</td>
        ${totalCols}
        <td class="daily-report-total-col">${formatAmount(grandTotal)}</td>
      </tr>
    `);

    reportListTbody.innerHTML = items.join('');
  }

  async function exportDailyReportMatrix() {
    if (!reportMatrixTable) return;
    const theadRow = reportMatrixTable.querySelector('thead tr');
    if (!theadRow) return;
    const headers = Array.from(theadRow.querySelectorAll('th')).map((th) => th.textContent.trim());
    if (headers.length < 2) {
      Swal.fire({ icon: 'info', title: 'Export', text: 'No data to export.' });
      return;
    }
    const rows = [];
    reportMatrixTable.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length === 1 && tds[0].hasAttribute('colspan')) return;
      const cells = Array.from(tds).map((td) => td.textContent.trim());
      if (cells.length === headers.length) rows.push(cells);
    });
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

  async function loadSubmittedReports() {
    if (!reportListTbody || !reportListThead) return;
    reportListTbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted py-3">Loading reports...</td></tr>';
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
      reportListTbody.innerHTML = '<tr><td colspan="2" class="text-center text-danger py-3">Unable to load reports.</td></tr>';
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
    loadSubmittedReports();
  }
  if (btnExportMatrix) {
    btnExportMatrix.addEventListener('click', () => {
      exportDailyReportMatrix();
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
