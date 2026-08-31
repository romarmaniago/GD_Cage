(() => {
  const beyondChipsEls = {};
  let lastGridPayload = null;

  function cacheBeyondChipsEls() {
    beyondChipsEls.modal = document.getElementById('modal-dash-beyond-chips');
    beyondChipsEls.form = document.getElementById('dash-beyond-chips-form');
    beyondChipsEls.dateLabel = document.getElementById('dash-beyond-chips-date');
    beyondChipsEls.dateIso = document.getElementById('dash-beyond-chips-date-iso');
    beyondChipsEls.amount = document.getElementById('dash-beyond-chips-amount');
    beyondChipsEls.historyBody = document.getElementById('dash-beyond-chips-history-body');
    beyondChipsEls.historyTable = document.getElementById('dash-beyond-chips-history-tbl');
    beyondChipsEls.editModal = document.getElementById('modal-dash-beyond-chips-edit');
    beyondChipsEls.editForm = document.getElementById('dash-beyond-chips-edit-form');
    beyondChipsEls.editId = document.getElementById('dash-beyond-chips-edit-id');
    beyondChipsEls.editAmount = document.getElementById('dash-beyond-chips-edit-amount');
  }

  function releaseBeyondChipsParentFocusTrap() {
    const instance = getBeyondChipsModalInstance();
    if (instance?._focustrap && typeof instance._focustrap.deactivate === 'function') {
      instance._focustrap.deactivate();
    }
  }

  function openBeyondChipsEditModal(id, amount) {
    const { editModal, editId, editAmount } = beyondChipsEls;
    if (!editModal || !editId || !editAmount || typeof bootstrap === 'undefined') return;

    editId.value = String(id);
    editAmount.value = formatBeyondChipsAmountInput(Math.round(Number(amount) || 0));
    releaseBeyondChipsParentFocusTrap();

    const editInstance = bootstrap.Modal.getOrCreateInstance(editModal);
    editModal.addEventListener('shown.bs.modal', () => {
      editAmount.focus();
    }, { once: true });
    editInstance.show();
  }

  function renderBeyondChipsActionCell(id, amount) {
    return `<div class="dash-beyond-chips-actions text-center">
      <button type="button" class="btn btn-sm btn-outline-primary js-beyond-chips-edit me-1" data-id="${escapeAttr(id)}" data-amount="${escapeAttr(amount)}" title="Edit" aria-label="Edit">
        <i class="fa fa-pencil-alt" aria-hidden="true"></i>
      </button>
      <button type="button" class="btn btn-sm btn-outline-danger js-beyond-chips-delete" data-id="${escapeAttr(id)}" title="Delete" aria-label="Delete">
        <i class="fa fa-trash-alt" aria-hidden="true"></i>
      </button>
    </div>`;
  }

  async function updateBeyondChipsEntry(id, amount) {
    const res = await fetch('/update_beyond_chips', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id, amount })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to update Beyond Chips.');
  }

  async function deleteBeyondChipsEntry(id) {
    const res = await fetch('/delete_beyond_chips', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to delete Beyond Chips.');
  }

  function getBeyondChipsModalInstance() {
    if (!beyondChipsEls.modal || typeof bootstrap === 'undefined') return null;
    const instance = bootstrap.Modal.getOrCreateInstance(beyondChipsEls.modal, { focus: false });
    if (instance._config) instance._config.focus = false;
    return instance;
  }

  async function promptDeleteBeyondChipsEntry(id) {
    if (typeof Swal === 'undefined') return;

    const result = await Swal.fire({
      title: 'Delete entry?',
      text: 'This entry will be removed from Beyond Chips.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#dc3545',
      focusConfirm: false
    });

    if (!result.isConfirmed) return;

    const date = beyondChipsEls.dateIso?.value || '';

    try {
      await deleteBeyondChipsEntry(id);
      await Promise.all([
        loadBeyondChipsHistory(date),
        loadGridData()
      ]);
      Swal.fire({ icon: 'success', title: 'Deleted', text: 'Beyond Chips deleted successfully.', timer: 1300, showConfirmButton: false });
    } catch (err) {
      console.error('promptDeleteBeyondChipsEntry:', err);
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to delete Beyond Chips.' });
    }
  }

  async function refreshBeyondChipsViews(date) {
    await Promise.all([
      loadBeyondChipsHistory(date),
      loadGridData()
    ]);
  }

  function formatBeyondChipsReportDate(iso) {
    if (!iso) return '—';
    const parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatBeyondChipsAmountInput(value) {
    const cleaned = String(value ?? '').replace(/[^\d]/g, '');
    if (!cleaned) return '';
    return Number(cleaned).toLocaleString('en-US');
  }

  function formatBeyondChipsDateTime(value) {
    if (!value) return '—';
    const raw = String(value).trim();
    const d = /^\d{4}-\d{2}-\d{2}/.test(raw)
      ? new Date(raw.replace(' ', 'T'))
      : new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${datePart} ${h}:${min}`;
  }

  function renderBeyondChipsHistory(payload) {
    const { historyBody } = beyondChipsEls;
    if (!historyBody) return;

    const entries = Array.isArray(payload?.entries) ? payload.entries : [];

    if (!entries.length) {
      historyBody.innerHTML = '<tr><td colspan="3" class="text-muted text-center py-3">No entries for this date</td></tr>';
      return;
    }

    historyBody.innerHTML = entries.map((row) => `
      <tr>
        <td>${escapeHtml(formatBeyondChipsDateTime(row.encoded_dt))}</td>
        <td class="text-end">${escapeHtml(formatAmount(row.amount))}</td>
        <td class="text-center js-beyond-chips-actions">${renderBeyondChipsActionCell(row.id, row.amount)}</td>
      </tr>`).join('');
  }

  async function loadBeyondChipsHistory(date) {
    const { historyBody } = beyondChipsEls;
    if (!date || !historyBody) return;

    historyBody.innerHTML = '<tr><td colspan="3" class="text-muted text-center py-3">Loading...</td></tr>';

    try {
      const q = new URLSearchParams({ report_date: date });
      const res = await fetch(`/beyond_chips_history?${q}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Unable to load history.');
      renderBeyondChipsHistory(data);
    } catch (err) {
      console.error('loadBeyondChipsHistory:', err);
      historyBody.innerHTML = '<tr><td colspan="3" class="text-danger text-center py-3">Unable to load history</td></tr>';
    }
  }

  function openBeyondChipsModal(date) {
    const { modal, dateLabel, dateIso, amount: amountInput } = beyondChipsEls;
    if (!modal || !dateLabel || !dateIso || !amountInput || typeof bootstrap === 'undefined') return;

    dateLabel.value = formatBeyondChipsReportDate(date);
    dateIso.value = date;
    amountInput.value = '';

    getBeyondChipsModalInstance()?.show();
    loadBeyondChipsHistory(date);
    modal.addEventListener('shown.bs.modal', () => {
      amountInput.focus();
    }, { once: true });
  }

  function parseBeyondChipsInput(raw) {
    const cleaned = String(raw ?? '').replace(/,/g, '').trim();
    if (cleaned === '' || cleaned === '-') return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  async function saveBeyondChips(date, amount) {
    const res = await fetch('/add_beyond_chips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        report_date: date,
        amount
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to save Beyond Chips.');
  }

  function initBeyondChips() {
    cacheBeyondChipsEls();
    const root = document.getElementById('dash-rolling-root');
    if (!root || !beyondChipsEls.form) return;

    root.addEventListener('click', (e) => {
      const cell = e.target.closest('.js-beyond-chips-cell');
      if (!cell || !root.contains(cell)) return;
      const date = cell.dataset.date;
      if (!date) return;
      e.preventDefault();
      openBeyondChipsModal(date);
    });

    beyondChipsEls.historyTable?.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.js-beyond-chips-edit');
      if (editBtn) {
        e.preventDefault();
        openBeyondChipsEditModal(editBtn.dataset.id, editBtn.dataset.amount);
        return;
      }

      const deleteBtn = e.target.closest('.js-beyond-chips-delete');
      if (deleteBtn) {
        e.preventDefault();
        promptDeleteBeyondChipsEntry(deleteBtn.dataset.id);
      }
    });

    beyondChipsEls.editAmount?.addEventListener('input', (e) => {
      e.target.value = formatBeyondChipsAmountInput(e.target.value);
    });

    beyondChipsEls.editForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = beyondChipsEls.editId?.value || '';
      const amount = parseBeyondChipsInput(beyondChipsEls.editAmount?.value);
      const saveBtn = beyondChipsEls.editForm?.querySelector('[type="submit"]');
      const date = beyondChipsEls.dateIso?.value || '';

      if (!id) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Entry is missing.' });
        return;
      }
      if (Number.isNaN(amount)) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount.' });
        return;
      }
      if (amount === 0) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Amount cannot be zero.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        await updateBeyondChipsEntry(id, amount);
        if (beyondChipsEls.editModal && typeof bootstrap !== 'undefined') {
          bootstrap.Modal.getOrCreateInstance(beyondChipsEls.editModal).hide();
        }
        await refreshBeyondChipsViews(date);
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'success', title: 'Updated', text: 'Beyond Chips updated successfully.', timer: 1300, showConfirmButton: false });
        }
      } catch (err) {
        console.error('beyondChipsEditForm:', err);
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to update Beyond Chips.' });
        }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });

    beyondChipsEls.amount?.addEventListener('input', (e) => {
      e.target.value = formatBeyondChipsAmountInput(e.target.value);
    });

    beyondChipsEls.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = beyondChipsEls.dateIso?.value || '';
      const addAmount = parseBeyondChipsInput(beyondChipsEls.amount?.value);
      const saveBtn = beyondChipsEls.form.querySelector('[type="submit"]');

      if (!date) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Date is missing.' });
        return;
      }
      if (Number.isNaN(addAmount)) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount.' });
        return;
      }
      if (addAmount === 0) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter an amount to add.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        await saveBeyondChips(date, addAmount);
        beyondChipsEls.amount.value = '';
        await refreshBeyondChipsViews(date);
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'success', title: 'Saved', text: 'Beyond Chips saved successfully.', timer: 1300, showConfirmButton: false });
        }
      } catch (err) {
        console.error('saveBeyondChips:', err);
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to save Beyond Chips.' });
        }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  function formatAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '0';
    if (n < 0) return `(${Math.abs(Math.round(n)).toLocaleString('en-US')})`;
    return Math.round(n).toLocaleString('en-US');
  }

  function formatCell(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    return formatAmount(n);
  }

  function formatTotalCell(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '0';
    return formatAmount(n);
  }

  function formatCashOutCell(value) {
    const n = Math.abs(Number(value) || 0);
    if (n === 0) return '';
    return formatAmount(-n);
  }

  function formatCashOutTotal(value) {
    const n = Math.abs(Number(value) || 0);
    if (n === 0) return '0';
    return formatAmount(-n);
  }

  function totalNegClass(value) {
    const n = Number(value);
    return Number.isFinite(n) && n < 0 ? ' text-dash-neg' : '';
  }

  function buildRollingAutoRemarks(row) {
    const tags = [];
    if (Number(row.buy_in) > 0) tags.push('BI');
    if (Number(row.cash_out) > 0) tags.push('CO');
    if (Number(row.rolling_cc) > 0) tags.push('R');
    return tags.join(',');
  }

  function formatRollingRemarksDisplay(row) {
    const auto = buildRollingAutoRemarks(row);
    const saved = String(row.remarks_saved || '').trim();
    if (auto && saved) return `${auto} | ${saved}`;
    if (saved) return saved;
    return auto;
  }

  const rollingRemarksEls = {};

  function cacheRollingRemarksEls() {
    rollingRemarksEls.modal = document.getElementById('modal-dash-rolling-remarks');
    rollingRemarksEls.form = document.getElementById('dash-rolling-remarks-form');
    rollingRemarksEls.dateLabel = document.getElementById('dash-rolling-remarks-date');
    rollingRemarksEls.dateIso = document.getElementById('dash-rolling-remarks-date-iso');
    rollingRemarksEls.autoTags = document.getElementById('dash-rolling-remarks-auto-tags');
    rollingRemarksEls.text = document.getElementById('dash-rolling-remarks-text');
  }

  function openRollingRemarksModal(cell) {
    const { modal, dateLabel, dateIso, autoTags, text } = rollingRemarksEls;
    if (!modal || !dateLabel || !dateIso || !autoTags || !text || typeof bootstrap === 'undefined') return;

    const date = cell.dataset.date || '';
    const saved = cell.dataset.remarksSaved || '';
    const row = {
      buy_in: cell.dataset.buyIn,
      cash_out: cell.dataset.cashOut,
      rolling_cc: cell.dataset.rollingCc
    };

    dateLabel.value = formatBeyondChipsReportDate(date);
    dateIso.value = date;
    autoTags.textContent = buildRollingAutoRemarks(row) || '—';
    text.value = saved;

    bootstrap.Modal.getOrCreateInstance(modal, { focus: true }).show();
    modal.addEventListener('shown.bs.modal', () => {
      text.focus();
    }, { once: true });
  }

  async function saveDashboardCheckRemarks(date, checkType, remarks) {
    const res = await fetch('/save_dashboard_check_remarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ report_date: date, check_type: checkType, remarks })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to save remarks.');
  }

  async function saveRollingRemarks(date, remarks) {
    return saveDashboardCheckRemarks(date, 'rolling', remarks);
  }

  function initRollingRemarks() {
    cacheRollingRemarksEls();
    const root = document.getElementById('dash-rolling-root');
    if (!root || !rollingRemarksEls.form) return;

    root.addEventListener('click', (e) => {
      const cell = e.target.closest('.js-rolling-remarks-cell');
      if (!cell || !root.contains(cell)) return;
      e.preventDefault();
      openRollingRemarksModal(cell);
    });

    rollingRemarksEls.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = rollingRemarksEls.dateIso?.value || '';
      const remarks = rollingRemarksEls.text?.value?.trim() || '';
      const saveBtn = rollingRemarksEls.form.querySelector('[type="submit"]');

      if (!date) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Date is missing.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        await saveRollingRemarks(date, remarks);
        if (rollingRemarksEls.modal && typeof bootstrap !== 'undefined') {
          bootstrap.Modal.getOrCreateInstance(rollingRemarksEls.modal).hide();
        }
        await loadGridData();
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'success', title: 'Saved', text: 'Remarks saved successfully.', timer: 1300, showConfirmButton: false });
        }
      } catch (err) {
        console.error('saveRollingRemarks:', err);
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to save remarks.' });
        }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  function parseRollingManualInput(raw) {
    const cleaned = String(raw ?? '').replace(/,/g, '').trim();
    if (cleaned === '') return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  async function saveRollingManual(date, buyIn, cashOut, rolling) {
    const res = await fetch('/save_dash_rolling_manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ report_date: date, buy_in: buyIn, cash_out: cashOut, rolling })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to save entry.');
  }

  async function saveRollingManualRow(row) {
    const date = row.dataset.date;
    if (!date) return;

    const getVal = (field) => {
      const el = row.querySelector(`.dash-rolling-manual-input[data-field="${field}"]`);
      return parseRollingManualInput(el ? el.value : '');
    };
    const buyIn = getVal('buy_in');
    const cashOut = getVal('cash_out');
    const rolling = getVal('rolling');

    if (Number.isNaN(buyIn) || Number.isNaN(cashOut) || Number.isNaN(rolling)) {
      if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter valid amounts.' });
      return;
    }

    try {
      await saveRollingManual(date, buyIn, cashOut, rolling);
      await loadGridData();
    } catch (err) {
      console.error('saveRollingManual:', err);
      if (typeof Swal !== 'undefined') {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to save entry.' });
      }
    }
  }

  function initDashRollingManualEntry() {
    const root = document.getElementById('dash-rolling-root');
    if (!root) return;

    root.addEventListener('input', (e) => {
      const input = e.target.closest('.dash-rolling-manual-input');
      if (!input) return;
      input.value = formatBeyondChipsAmountInput(input.value);
    });

    // Save once focus leaves the whole row (not on every individual field blur),
    // so tabbing between Buy In / Cash Out / Rolling on the same date doesn't
    // trigger a mid-edit table re-render.
    root.addEventListener('focusout', (e) => {
      const input = e.target.closest('.dash-rolling-manual-input');
      if (!input || !root.contains(input)) return;
      const row = input.closest('.dash-rolling-row');
      if (!row) return;
      const next = e.relatedTarget;
      if (next && row.contains(next)) return;
      saveRollingManualRow(row);
    });

    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('.dash-rolling-manual-input');
      if (!input) return;
      e.preventDefault();
      input.blur();
    });
  }

  const wlRemarksEls = {};

  function cacheWlRemarksEls() {
    wlRemarksEls.modal = document.getElementById('modal-dash-wl-remarks');
    wlRemarksEls.form = document.getElementById('dash-wl-remarks-form');
    wlRemarksEls.dateLabel = document.getElementById('dash-wl-remarks-date');
    wlRemarksEls.dateIso = document.getElementById('dash-wl-remarks-date-iso');
    wlRemarksEls.text = document.getElementById('dash-wl-remarks-text');
  }

  function formatWlRemarksDisplay(row) {
    return String(row.remarks_saved || '').trim();
  }

  function openWlRemarksModal(cell) {
    const { modal, dateLabel, dateIso, text } = wlRemarksEls;
    if (!modal || !dateLabel || !dateIso || !text || typeof bootstrap === 'undefined') return;

    const date = cell.dataset.date || '';

    dateLabel.value = formatBeyondChipsReportDate(date);
    dateIso.value = date;
    text.value = cell.dataset.remarksSaved || '';

    bootstrap.Modal.getOrCreateInstance(modal, { focus: true }).show();
    modal.addEventListener('shown.bs.modal', () => {
      text.focus();
    }, { once: true });
  }

  async function saveWlRemarks(date, remarks) {
    return saveDashboardCheckRemarks(date, 'wl', remarks);
  }

  function initWlRemarks() {
    cacheWlRemarksEls();
    const root = document.getElementById('dash-wl-root');
    if (!root || !wlRemarksEls.form) return;

    root.addEventListener('click', (e) => {
      const cell = e.target.closest('.js-wl-remarks-cell');
      if (!cell || !root.contains(cell)) return;
      e.preventDefault();
      openWlRemarksModal(cell);
    });

    wlRemarksEls.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = wlRemarksEls.dateIso?.value || '';
      const remarks = wlRemarksEls.text?.value?.trim() || '';
      const saveBtn = wlRemarksEls.form.querySelector('[type="submit"]');

      if (!date) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Date is missing.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        await saveWlRemarks(date, remarks);
        if (wlRemarksEls.modal && typeof bootstrap !== 'undefined') {
          bootstrap.Modal.getOrCreateInstance(wlRemarksEls.modal).hide();
        }
        await loadGridData();
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'success', title: 'Saved', text: 'Remarks saved successfully.', timer: 1300, showConfirmButton: false });
        }
      } catch (err) {
        console.error('saveWlRemarks:', err);
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to save remarks.' });
        }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  function toDisplayDate(iso) {
    if (!iso) return '';
    const parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    return `${+parts[1]}/${+parts[2]}`;
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function renderRollingTable(payload) {
    const root = document.getElementById('dash-rolling-root');
    const foot = document.getElementById('dash-rolling-foot');
    if (!root || !foot || !payload) return;

    const today = todayIso();
    const rows = payload.rolling_rows || [];
    const t = payload.totals || {};

    const manualInputValue = (n) => {
      const v = Number(n);
      return !Number.isFinite(v) || v === 0 ? '' : formatBeyondChipsAmountInput(String(Math.round(v)));
    };
    const manualInput = (field, value) => `<input type="text" inputmode="decimal" class="dash-rolling-manual-input" data-field="${field}" value="${escapeAttr(manualInputValue(value))}" placeholder="0">`;

    const bodyHtml = rows.map((row) => {
      const cls = row.date === today ? 'dash-rolling-row is-today' : 'dash-rolling-row';
      const casinoCellClass = row.editable ? ' is-manual-editable' : '';
      const buyInCell = row.editable
        ? manualInput('buy_in', row.buy_in)
        : escapeHtml(formatCell(row.buy_in));
      const cashOutCell = row.editable
        ? manualInput('cash_out', row.cash_out)
        : escapeHtml(formatCashOutCell(row.cash_out));
      const rollingCell = row.editable
        ? manualInput('rolling', row.rolling)
        : escapeHtml(formatCell(row.rolling));
      return `<div class="${cls}" data-date="${escapeAttr(row.date)}">
        <span class="dash-rolling-body-cell is-date">${toDisplayDate(row.date)}</span>
        <span class="dash-rolling-body-cell is-col-casino${casinoCellClass}">${buyInCell}</span>
        <span class="dash-rolling-body-cell is-col-casino text-dash-neg${casinoCellClass}">${cashOutCell}</span>
        <span class="dash-rolling-body-cell is-col-casino${casinoCellClass}">${rollingCell}</span>
        <span class="dash-rolling-body-cell is-col-gold js-beyond-chips-cell" data-date="${escapeAttr(row.date)}" title="Click to add Beyond Chips">${escapeHtml(formatCell(row.beyond_chips))}</span>
        <span class="dash-rolling-body-cell is-col-remarks js-rolling-remarks-cell" data-date="${escapeAttr(row.date)}" data-remarks-saved="${escapeAttr(row.remarks_saved || '')}" data-buy-in="${escapeAttr(row.buy_in ?? 0)}" data-cash-out="${escapeAttr(row.cash_out ?? 0)}" data-rolling-cc="${escapeAttr(row.rolling_cc ?? 0)}" title="Click to edit remarks">${escapeHtml(formatRollingRemarksDisplay(row))}</span>
      </div>`;
    }).join('');

    root.innerHTML = `
      <div class="dash-rolling-head-excel">
        <div class="dash-rolling-head-cell is-date">Date</div>
        <div class="dash-rolling-head-cell is-casino-group">Casino</div>
        <div class="dash-rolling-head-cell is-gold-group">Gold Dragon</div>
        <div class="dash-rolling-head-cell is-remarks">Remarks</div>
        <div class="dash-rolling-head-cell is-buyin">
          <a href="#" class="js-dash-chips-header dash-card-link" data-chips-mode="buyin">Buy In</a>
        </div>
        <div class="dash-rolling-head-cell is-cashout">
          <a href="#" class="js-dash-chips-header dash-card-link" data-chips-mode="cashout">Cash Out</a>
        </div>
        <div class="dash-rolling-head-cell is-rolling">
          <a href="#" class="js-dash-chips-header dash-card-link" data-chips-mode="rolling">Rolling</a>
        </div>
        <div class="dash-rolling-head-cell is-beyond-chips">Beyond Chips</div>
      </div>
      ${bodyHtml}`;

    foot.innerHTML = `
      <div class="dash-rolling-row is-total">
        <span class="dash-rolling-body-cell is-date is-total-label">Total</span>
        <span class="dash-rolling-body-cell is-col-casino is-total-amt${totalNegClass(t.buy_in)}">${escapeHtml(formatTotalCell(t.buy_in))}</span>
        <span class="dash-rolling-body-cell is-col-casino is-total-amt text-dash-neg">${escapeHtml(formatCashOutTotal(t.cash_out))}</span>
        <span class="dash-rolling-body-cell is-col-casino is-total-amt${totalNegClass(t.rolling)}">${escapeHtml(formatTotalCell(t.rolling))}</span>
        <span class="dash-rolling-body-cell is-col-gold is-total-amt${totalNegClass(t.beyond_chips)}">${escapeHtml(formatTotalCell(t.beyond_chips))}</span>
        <span class="dash-rolling-body-cell is-col-remarks is-total-remarks"></span>
      </div>`;

    updateActualCheck(payload);
    bindRollingHeaderClicks(root);
    syncRollingTableLayout();
  }
  function syncDualMatrixRowHeights() {
    const rollingRows = [...document.querySelectorAll('#dash-rolling-root .dash-rolling-row')];
    const wlRows = [...document.querySelectorAll('#dash-wl-root .dash-wl-row')];
    rollingRows.forEach((row) => { row.style.minHeight = ''; });
    wlRows.forEach((row) => { row.style.minHeight = ''; });

    const wlByDate = new Map(wlRows.map((row) => [row.dataset.date, row]));
    rollingRows.forEach((row) => {
      const wlRow = wlByDate.get(row.dataset.date);
      if (!wlRow) return;
      const h = Math.max(row.offsetHeight, wlRow.offsetHeight);
      row.style.minHeight = `${h}px`;
      wlRow.style.minHeight = `${h}px`;
    });

    const rollingHead = document.querySelector('.dash-rolling-head-excel');
    const wlHead = document.querySelector('.dash-wl-head-excel');
    if (rollingHead && wlHead) {
      wlHead.style.minHeight = `${rollingHead.offsetHeight}px`;
    }

    const rollingTotal = document.querySelector('#dash-rolling-foot .dash-rolling-row.is-total');
    const wlTotal = document.querySelector('#dash-wl-foot .dash-wl-row.is-total');
    if (rollingTotal) rollingTotal.style.minHeight = '';
    if (wlTotal) wlTotal.style.minHeight = '';
    if (rollingTotal && wlTotal) {
      const h = Math.max(rollingTotal.offsetHeight, wlTotal.offsetHeight);
      rollingTotal.style.minHeight = `${h}px`;
      wlTotal.style.minHeight = `${h}px`;
    }
  }

  function bindDualMatrixScrollSync() {
    const rollingScroll = document.querySelector('.dash-rolling-scroll');
    const wlScroll = document.querySelector('.dash-wl-scroll');
    if (!rollingScroll || !wlScroll || rollingScroll.dataset.scrollSync === '1') return;
    rollingScroll.dataset.scrollSync = '1';

    let locking = false;
    const syncScroll = (source, target) => {
      if (locking) return;
      locking = true;
      target.scrollTop = source.scrollTop;
      requestAnimationFrame(() => { locking = false; });
    };

    rollingScroll.addEventListener('scroll', () => syncScroll(rollingScroll, wlScroll));
    wlScroll.addEventListener('scroll', () => syncScroll(wlScroll, rollingScroll));
  }

  function syncRollingTableLayout() {
    requestAnimationFrame(() => {
      syncDualMatrixRowHeights();
      requestAnimationFrame(syncDualMatrixRowHeights);
    });
  }

  function bindRollingHeaderClicks(scope) {
    const container = scope || document.getElementById('dash-rolling-root');
    if (!container) return;
    container.querySelectorAll('.js-dash-chips-header[data-chips-mode]').forEach((el) => {
      if (el.dataset.boundChipsHeader === '1') return;
      el.dataset.boundChipsHeader = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const mode = el.dataset.chipsMode;
        if (typeof window.openTotalChipsModal === 'function') {
          window.openTotalChipsModal(mode);
          return;
        }
        const modalEl = document.getElementById('modal-new-total-chips');
        if (modalEl && typeof bootstrap !== 'undefined') {
          bootstrap.Modal.getOrCreateInstance(modalEl).show();
        }
      });
    });
  }

  function wlAmountHasData(value) {
    const n = Number(value);
    return Number.isFinite(n) && n !== 0;
  }

  function formatWlAmountCell(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return { text: '', neg: false };
    return { text: formatAmount(n), neg: n < 0 };
  }

  function formatWlDiffCell(casinoValue, goldValue) {
    const diff = (Number(casinoValue) || 0) - (Number(goldValue) || 0);
    if (diff === 0 && !wlAmountHasData(casinoValue) && !wlAmountHasData(goldValue)) {
      return { text: '', neg: false };
    }
    if (diff === 0) return { text: '0', neg: false };
    return { text: formatAmount(diff), neg: diff < 0 };
  }

  function formatWlDiffExport(casinoValue, goldValue) {
    const diff = (Number(casinoValue) || 0) - (Number(goldValue) || 0);
    if (diff === 0 && !wlAmountHasData(casinoValue) && !wlAmountHasData(goldValue)) return '';
    return formatTotalCell(diff);
  }

  function renderWlTable(payload) {
    const root = document.getElementById('dash-wl-root');
    const foot = document.getElementById('dash-wl-foot');
    if (!root || !foot || !payload) return;

    const today = todayIso();
    const rows = payload.wl_rows || [];

    const bodyHtml = rows.map((row) => {
      const cls = row.date === today ? 'dash-wl-row is-today' : 'dash-wl-row';
      const casino = formatWlAmountCell(row.casino);
      const gold = formatWlAmountCell(row.gold_dragon);
      const diffCell = formatWlDiffCell(row.casino, row.gold_dragon);
      return `<div class="${cls}" data-date="${escapeAttr(row.date)}">
        <span class="dash-wl-body-cell is-date">${toDisplayDate(row.date)}</span>
        <span class="dash-wl-body-cell is-col-casino${casino.neg ? ' text-dash-neg' : ''}">${escapeHtml(casino.text)}</span>
        <span class="dash-wl-body-cell is-col-gold${gold.neg ? ' text-dash-neg' : ''}">${escapeHtml(gold.text)}</span>
        <span class="dash-wl-body-cell is-col-diff${diffCell.neg ? ' text-dash-neg' : ''}">${escapeHtml(diffCell.text)}</span>
        <span class="dash-wl-body-cell is-col-remarks js-wl-remarks-cell" data-date="${escapeAttr(row.date)}" data-remarks-saved="${escapeAttr(row.remarks_saved || '')}" title="Click to edit remarks">${escapeHtml(formatWlRemarksDisplay(row))}</span>
      </div>`;
    }).join('');

    const t = payload.totals || {};
    const totalDiff = (Number(t.casino_wl) || 0) - (Number(t.gold_dragon_wl) || 0);

    root.innerHTML = `
      <div class="dash-wl-head-excel">
        <div class="dash-wl-head-cell is-date">Date</div>
        <div class="dash-wl-head-cell is-casino">
          <a href="#" class="js-dash-wl-casino-header dash-card-link">Casino</a>
        </div>
        <div class="dash-wl-head-cell is-gold">Gold Dragon</div>
        <div class="dash-wl-head-cell is-diff">The difference</div>
        <div class="dash-wl-head-cell is-remarks">Remarks</div>
      </div>
      ${bodyHtml}`;

    foot.innerHTML = `
      <div class="dash-wl-row is-total">
        <span class="dash-wl-body-cell is-date is-total-label">Total</span>
        <span class="dash-wl-body-cell is-col-casino is-total-amt${totalNegClass(t.casino_wl)}">${escapeHtml(formatTotalCell(t.casino_wl))}</span>
        <span class="dash-wl-body-cell is-col-gold is-total-amt${totalNegClass(t.gold_dragon_wl)}">${escapeHtml(formatTotalCell(t.gold_dragon_wl))}</span>
        <span class="dash-wl-body-cell is-col-diff is-total-amt${totalNegClass(totalDiff)}">${escapeHtml(formatTotalCell(totalDiff))}</span>
        <span class="dash-wl-body-cell is-col-remarks is-total-remarks"></span>
      </div>`;

    bindWlHeaderClicks(root);
    syncRollingTableLayout();
  }

  function bindWlHeaderClicks(scope) {
    const container = scope || document.getElementById('dash-wl-root');
    if (!container) return;
    container.querySelectorAll('.js-dash-wl-casino-header').forEach((el) => {
      if (el.dataset.boundWlCasino === '1') return;
      el.dataset.boundWlCasino = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof window.openDashboardWinlossReportModal === 'function') {
          window.openDashboardWinlossReportModal();
          return;
        }
        window.open('/table_daily_report_winloss', '_blank');
      });
    });
  }

  function updateActualCheck(payload) {
    const t = payload.totals || {};
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = formatAmount(val);
    };
    // Auto-computed totals only — manual Main Cage Rolling Check entries (pre-cutoff dates)
    // must not move this reconciliation panel. Buy In/Cash Out/Rolling/W-L fall back to
    // the Gamebook (game_list/game_record) automatically when no manual entry exists for a date.
    set('dash-actual-buyin', t.buy_in_auto);
    set('dash-actual-cashout', -Math.abs(t.cash_out_auto || 0));
    set('dash-actual-beyond-chips', t.beyond_chips);
    set('dash-actual-rolling', t.rolling_auto);
    // Both Win / Lose rows (Cage + Gaming Acc.) mirror the GD Cage (Gold Dragon) column
    // of the W/L Check table for the selected program-date range — NOT the external
    // casino's W/L. Fall back to wl_total only if an older server response omits the field.
    var gamingWl = t.gold_dragon_wl_auto != null ? t.gold_dragon_wl_auto : t.wl_total;
    set('dash-actual-wl', gamingWl);
    set('dash-actual-gaming-wl', gamingWl);
    // Gaming Acc. rolling mirrors the Gamebook's Total Rolling for the selected
    // program-date range — it must not pick up manual Total Chips entries the way
    // Main Cage (rolling_auto) does. Fall back to rolling_auto only if an older
    // server response omits the field.
    set('dash-actual-gaming-rolling', t.rolling_gamebook != null ? t.rolling_gamebook : t.rolling_auto);

    // Actual Rolling = Main Cage (rolling_auto) minus the live NN Chips balance
    // (chips sitting idle, not rolling) minus the live outstanding Roller Chips (RC)
    // balance — isolates the amount actually rolling right now.
    const panel = document.getElementById('dash-anticipated-panel');
    const rcChipsBalance = panel ? Number(panel.dataset.rcChipsBalance) || 0 : 0;
    const nnChipsBalance = panel ? Number(panel.dataset.nnChipsBalance) || 0 : 0;
    set('dash-actual-rolling-amount', (Number(t.rolling_auto) || 0) - nnChipsBalance - rcChipsBalance);
  }

  function updateOnGameSummary(payload) {
    const el = document.getElementById('dash-on-game-summary');
    if (!el || !payload || !payload.on_game) return;
    const og = payload.on_game;
    el.innerHTML = `
      <div class="dash-kv"><span class="dash-kv-label">Total B/I</span><span class="dash-kv-value">${formatAmount(og.buy_in)}</span></div>
      <div class="dash-kv"><span class="dash-kv-label">Total C/O</span><span class="dash-kv-value text-dash-neg">${formatAmount(-Math.abs(og.cash_out || 0))}</span></div>
      <div class="dash-kv"><span class="dash-kv-label">Total Rolling</span><span class="dash-kv-value">${formatAmount(og.rolling)}</span></div>`;
    const gamesEl = document.getElementById('dash-on-game-count');
    if (gamesEl) gamesEl.textContent = `${og.game_count || 0} Games`;
    renderOnGameDetails(og.games || []);
  }

  function setGuestSummaryValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    const n = Number(value) || 0;
    el.textContent = formatAmount(n);
    el.classList.toggle('text-dash-neg', n < 0);
  }

  const lineQvState = {
    selectedAgencyId: null,
    selectedAgentId: null,
    agencyRows: [],
    accountRows: []
  };

  function updateLineQvScopeLabel(isSingleLineScope, lineCount, agentCount) {
    const labelEl = document.getElementById('dash-guest-summary-scope-label');
    const valueEl = document.getElementById('dash-guest-summary-scope-value');
    if (!labelEl || !valueEl) return;

    if (isSingleLineScope) {
      labelEl.textContent = 'Total Agent';
      valueEl.textContent = formatAmount(agentCount);
      return;
    }

    labelEl.textContent = 'Total Line';
    valueEl.textContent = formatAmount(lineCount);
  }

  function renderGuestSummaryStats(stats, isSingleLineScope) {
    const payload = stats || {};
    updateLineQvScopeLabel(
      isSingleLineScope,
      payload.total_line,
      payload.total_agent
    );
    setGuestSummaryValue('dash-guest-summary-total-balance', payload.total_balance);
    setGuestSummaryValue('dash-guest-summary-total-credit', payload.total_credit);
    setGuestSummaryValue('dash-guest-summary-total-winloss', payload.total_winloss);
    setGuestSummaryValue('dash-guest-summary-total-rolling', payload.total_rolling);
    setGuestSummaryValue('dash-guest-summary-total-commission', payload.total_commission);
  }

  function renderLineQvAgentStats(stats, isVisible) {
    const payload = stats || {};
    const lineRow = document.getElementById('dash-line-qv-line-stat-row');
    const agentRow = document.getElementById('dash-line-qv-agent-stat-row');

    setGuestSummaryValue('dash-line-qv-agent-total-guest', payload.total_guest);
    setGuestSummaryValue('dash-line-qv-agent-total-games', payload.total_games);
    setGuestSummaryValue('dash-line-qv-agent-total-balance', payload.total_balance);
    setGuestSummaryValue('dash-line-qv-agent-total-winloss', payload.total_winloss);
    setGuestSummaryValue('dash-line-qv-agent-total-rolling', payload.total_rolling);
    setGuestSummaryValue('dash-line-qv-agent-total-commission', payload.total_commission);

    if (lineRow) lineRow.classList.toggle('d-none', isVisible);
    if (agentRow) agentRow.classList.toggle('d-none', !isVisible);
  }

  function formatLineQvBalance(value) {
    const n = Number(value) || 0;
    return n === 0 ? '—' : formatAmount(n);
  }

  function showLineQvEmpty(panel, message) {
    const emptyEl = document.getElementById(`dash-line-qv-${panel}-empty`);
    const listEl = document.getElementById(`dash-line-qv-${panel}-list`);
    if (emptyEl) {
      emptyEl.textContent = message;
      emptyEl.classList.remove('d-none');
    }
    if (listEl) {
      listEl.classList.add('d-none');
      listEl.innerHTML = '';
    }
  }

  function renderLineQvLines(rows) {
    const listEl = document.getElementById('dash-line-qv-line-list');
    const emptyEl = document.getElementById('dash-line-qv-line-empty');
    if (!listEl || !emptyEl) return;

    const data = Array.isArray(rows) ? rows : [];
    if (!data.length) {
      showLineQvEmpty('line', 'No LINE found.');
      return;
    }

    listEl.innerHTML = data.map((row) => {
      const agencyId = Number(row.IDNo);
      const isActive = lineQvState.selectedAgencyId === agencyId;
      const balance = formatLineQvBalance(row.total_balance);
      return `
        <div class="dash-line-qv-list-item${isActive ? ' is-active' : ''}" data-agency-id="${agencyId}">
          <span class="dash-line-qv-list-name">${escapeHtml(String(row.AGENCY || '').toUpperCase())}</span>
          <span class="dash-line-qv-list-balance">${escapeHtml(balance)}</span>
        </div>`;
    }).join('');

    emptyEl.classList.add('d-none');
    listEl.classList.remove('d-none');
  }

  function renderLineQvAgents(accounts) {
    const listEl = document.getElementById('dash-line-qv-agent-list');
    const emptyEl = document.getElementById('dash-line-qv-agent-empty');
    if (!listEl || !emptyEl) return;

    if (!lineQvState.selectedAgencyId) {
      showLineQvEmpty('agent', 'Select LINE to load agents.');
      return;
    }

    const byAgent = {};
    (accounts || []).forEach((row) => {
      const id = String(row.agent_id || '');
      if (!id) return;
      if (!byAgent[id]) {
        byAgent[id] = {
          agent_id: row.agent_id,
          agent_name: row.agent_name || '',
          agent_code: row.agent_code || '',
          total_balance: Number(row.total_balance || row.total_ledger_amount) || 0
        };
      }
    });

    const agents = Object.values(byAgent).sort((a, b) => {
      const codeA = String(a.agent_code || '').toUpperCase();
      const codeB = String(b.agent_code || '').toUpperCase();
      return codeA.localeCompare(codeB);
    });

    if (!agents.length) {
      showLineQvEmpty('agent', 'No agents under this LINE.');
      return;
    }

    listEl.innerHTML = agents.map((agent) => {
      const agentId = Number(agent.agent_id);
      const isActive = lineQvState.selectedAgentId === agentId;
      const code = String(agent.agent_code || '').toUpperCase();
      const name = String(agent.agent_name || '').toUpperCase();
      const label = code && name
        ? `<span class="dash-line-qv-list-code">${escapeHtml(code)}</span><span class="dash-line-qv-list-sep">·</span><span>${escapeHtml(name)}</span>`
        : escapeHtml(code || name || '—');
      const balance = formatLineQvBalance(agent.total_balance);
      return `
        <div class="dash-line-qv-list-item${isActive ? ' is-active' : ''}" data-agent-id="${agentId}">
          <span class="dash-line-qv-list-name">${label}</span>
          <span class="dash-line-qv-list-balance">${escapeHtml(balance)}</span>
        </div>`;
    }).join('');

    emptyEl.classList.add('d-none');
    listEl.classList.remove('d-none');
  }

  function renderLineQvGuests(guests) {
    const listEl = document.getElementById('dash-line-qv-guest-list');
    const emptyEl = document.getElementById('dash-line-qv-guest-empty');
    if (!listEl || !emptyEl) return;

    if (!lineQvState.selectedAgentId) {
      showLineQvEmpty('guest', 'Select AGENT to load guests.');
      return;
    }

    const rows = Array.isArray(guests) ? guests : [];
    if (!rows.length) {
      showLineQvEmpty('guest', 'No guests under this agent.');
      return;
    }

    const htmlRows = rows.map((row) => {
      const name = String(row.guest_name || row.NAME || '—').toUpperCase();
      const membershipNo = String(row.membership_no || row.MEMBERSHIP_NO || '').trim() || '—';
      return `
        <tr>
          <td class="dash-line-qv-guest-col">${escapeHtml(name)}</td>
          <td class="dash-line-qv-membership-col">${escapeHtml(membershipNo)}</td>
          <td>${escapeHtml(formatAmount(row.total_balance || row.balance || 0))}</td>
          <td>${escapeHtml(formatAmount(row.total_credit || row.credit || 0))}</td>
          <td>${escapeHtml(formatAmount(row.total_winloss || row.winloss || 0))}</td>
          <td>${escapeHtml(formatAmount(row.total_rolling || row.rolling || 0))}</td>
          <td>${escapeHtml(formatAmount(row.total_commission || row.commission || 0))}</td>
        </tr>`;
    }).join('');

    listEl.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm mb-0 dash-line-qv-guest-table">
          <thead>
            <tr>
              <th class="dash-line-qv-guest-col">Guest</th>
              <th class="dash-line-qv-membership-col">Membership No</th>
              <th>Balance</th>
              <th>Credit</th>
              <th>Winloss</th>
              <th>Rolling</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>`;

    emptyEl.classList.add('d-none');
    listEl.classList.remove('d-none');
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function loadLineQvStats(agencyId) {
    const hasAgency = Number.isFinite(Number(agencyId)) && Number(agencyId) > 0;
    const endpoint = hasAgency
      ? `/agency_line_stats?agencyId=${encodeURIComponent(agencyId)}`
      : '/agency_line_stats';
    const stats = await fetchJson(endpoint);
    renderGuestSummaryStats(stats, hasAgency);
    return stats;
  }

  async function loadLineQvAgentStats(agentId) {
    const numericAgentId = Number(agentId);
    if (!Number.isFinite(numericAgentId) || numericAgentId <= 0) {
      renderLineQvAgentStats({}, false);
      return;
    }

    const stats = await fetchJson(`/agency_agent_stats?agentId=${encodeURIComponent(numericAgentId)}`);
    renderLineQvAgentStats(stats, true);
  }

  async function selectLineQvLine(agencyId) {
    lineQvState.selectedAgencyId = Number(agencyId);
    lineQvState.selectedAgentId = null;
    lineQvState.accountRows = [];

    document.querySelectorAll('#dash-line-qv-line-list .dash-line-qv-list-item').forEach((el) => {
      el.classList.toggle('is-active', Number(el.dataset.agencyId) === lineQvState.selectedAgencyId);
    });

    showLineQvEmpty('guest', 'Select AGENT to load guests.');
    renderLineQvAgents([]);

    try {
      const [accounts] = await Promise.all([
        fetchJson(`/account_data?agencyId=${encodeURIComponent(lineQvState.selectedAgencyId)}`),
        loadLineQvStats(lineQvState.selectedAgencyId)
      ]);
      lineQvState.accountRows = Array.isArray(accounts) ? accounts : [];
      renderLineQvAgents(lineQvState.accountRows);
      renderLineQvAgentStats({}, false);
    } catch (err) {
      console.error('line quick view agency:', err);
      showLineQvEmpty('agent', 'Failed to load agents.');
    }
  }

  async function selectLineQvAgent(agentId) {
    lineQvState.selectedAgentId = Number(agentId);

    document.querySelectorAll('#dash-line-qv-agent-list .dash-line-qv-list-item').forEach((el) => {
      el.classList.toggle('is-active', Number(el.dataset.agentId) === lineQvState.selectedAgentId);
    });

    try {
      const [guests] = await Promise.all([
        fetchJson(`/guest_data?agentId=${encodeURIComponent(lineQvState.selectedAgentId)}`),
        loadLineQvAgentStats(lineQvState.selectedAgentId)
      ]);
      renderLineQvGuests(guests);
    } catch (err) {
      console.error('line quick view agent:', err);
      showLineQvEmpty('guest', 'Failed to load guests.');
    }
  }

  function resetLineQuickView() {
    lineQvState.selectedAgencyId = null;
    lineQvState.selectedAgentId = null;
    lineQvState.agencyRows = [];
    lineQvState.accountRows = [];
    renderLineQvAgentStats({}, false);
    showLineQvEmpty('agent', 'Select LINE to load agents.');
    showLineQvEmpty('guest', 'Select AGENT to load guests.');
  }

  async function loadGuestSummaryStats() {
    const status = document.getElementById('dash-guest-summary-status');
    if (status) {
      status.textContent = 'Loading...';
      status.classList.remove('text-danger');
    }

    resetLineQuickView();
    showLineQvEmpty('line', 'Loading...');

    try {
      const [agencyRows, stats] = await Promise.all([
        fetchJson('/agency_data'),
        fetchJson('/agency_line_stats')
      ]);
      lineQvState.agencyRows = Array.isArray(agencyRows) ? agencyRows : [];
      renderGuestSummaryStats(stats, false);
      renderLineQvLines(lineQvState.agencyRows);
      if (status) status.textContent = '';
    } catch (err) {
      console.error('agency_line_stats:', err);
      renderGuestSummaryStats({}, false);
      showLineQvEmpty('line', 'Failed to load LINE list.');
      if (status) {
        status.textContent = 'Failed to load line summary.';
        status.classList.add('text-danger');
      }
    }
  }

  function initLineQuickView() {
    const lineList = document.getElementById('dash-line-qv-line-list');
    const agentList = document.getElementById('dash-line-qv-agent-list');

    if (lineList) {
      lineList.addEventListener('click', (event) => {
        const item = event.target.closest('[data-agency-id]');
        if (!item) return;
        selectLineQvLine(item.dataset.agencyId);
      });
    }

    if (agentList) {
      agentList.addEventListener('click', (event) => {
        const item = event.target.closest('[data-agent-id]');
        if (!item) return;
        selectLineQvAgent(item.dataset.agentId);
      });
    }
  }

  function renderOnGameDetails(games) {
    const body = document.getElementById('dash-on-game-modal-body');
    if (!body) return;

    if (!games.length) {
      body.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No games on game.</td></tr>';
      return;
    }

    body.innerHTML = games.map((game) => {
      const gameType = String(game.game_type || '');
      const gameTypeLabel = gameType === 'LIVE'
        ? (window.onGameListTranslations?.live || 'LIVE')
        : gameType === 'TELEBET'
          ? (window.onGameListTranslations?.telebet || 'TELEBET')
          : gameType;
      const gameTypeClass = gameType === 'LIVE' ? 'text-primary' : gameType === 'TELEBET' ? 'text-danger' : '';
      const account = `${game.agent_code || ''}${game.agent_name ? ` (${game.agent_name})` : ''}`.trim();
      const winLoss = Number(game.win_loss) || 0;

      return `
        <tr>
          <td>${escapeHtml(account || `Account #${game.account_id || ''}`)}</td>
          <td>${escapeHtml(game.guest_name || '-')}</td>
          <td>${escapeHtml(game.game_id)}</td>
          <td><span class="${gameTypeClass}">${escapeHtml(gameTypeLabel || '-')}</span></td>
          <td class="text-end">${escapeHtml(formatAmount(game.buy_in))}</td>
          <td class="text-end text-dash-neg">${escapeHtml(formatAmount(-Math.abs(Number(game.cash_out) || 0)))}</td>
          <td class="text-end${winLoss < 0 ? ' text-dash-neg' : ''}">${escapeHtml(formatAmount(winLoss))}</td>
          <td class="text-end">${escapeHtml(formatAmount(game.rolling))}</td>
          <td class="text-end">${escapeHtml(formatAmount(game.roller_chips))}</td>
        </tr>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function getDashPeriodLabel() {
    const from = document.getElementById('dash-date-from')?.value || '';
    const to = document.getElementById('dash-date-to')?.value || '';
    if (!from || !to) return '';
    return `${toDisplayDate(from)} – ${toDisplayDate(to)}`;
  }

  function buildRollingSheetPayload(payload) {
    const headers = ['Date', 'Buy In', 'Cash Out', 'Rolling', 'Beyond Chips', 'Remarks'];
    const rows = (payload.rolling_rows || []).map((row) => [
      toDisplayDate(row.date),
      formatCell(row.buy_in),
      formatCashOutCell(row.cash_out),
      formatCell(row.rolling),
      formatCell(row.beyond_chips),
      formatRollingRemarksDisplay(row)
    ]);
    const t = payload.totals || {};
    rows.push([
      'Total',
      formatTotalCell(t.buy_in),
      formatCashOutTotal(t.cash_out),
      formatTotalCell(t.rolling),
      formatTotalCell(t.beyond_chips),
      ''
    ]);
    return { headers, rows };
  }

  function buildWlSheetPayload(payload) {
    const headers = ['Date', 'Casino', 'Gold Dragon', 'The difference', 'Remarks'];
    const rows = (payload.wl_rows || []).map((row) => {
      return [
        toDisplayDate(row.date),
        formatCell(row.casino),
        formatCell(row.gold_dragon),
        formatWlDiffExport(row.casino, row.gold_dragon),
        formatWlRemarksDisplay(row)
      ];
    });
    const t = payload.totals || {};
    const totalDiff = (Number(t.casino_wl) || 0) - (Number(t.gold_dragon_wl) || 0);
    rows.push([
      'Total',
      formatTotalCell(t.casino_wl),
      formatTotalCell(t.gold_dragon_wl),
      formatTotalCell(totalDiff),
      ''
    ]);
    return { headers, rows };
  }

  function getRollingPrintColgroup() {
    return '<colgroup><col style="width:9%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:31%"></colgroup>';
  }

  function getWlPrintColgroup() {
    return '<colgroup><col style="width:10%"><col style="width:22%"><col style="width:22%"><col style="width:24%"><col style="width:22%"></colgroup>';
  }

  const DASHBOARD_PRINT_PAGE_HEIGHT_MM = 287;

  function getDashboardMatrixPrintStyles() {
    return [
      '@page{size:A4 portrait;margin:5mm;}',
      'html,body{margin:0;padding:0;width:100%;height:100%;}',
      'body{font-family:Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
      `.print-page{width:100%;height:${DASHBOARD_PRINT_PAGE_HEIGHT_MM}mm;max-height:${DASHBOARD_PRINT_PAGE_HEIGHT_MM}mm;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;}`,
      '.print-meta{flex:0 0 auto;padding:0 2mm;}',
      'h2{text-align:center;margin:0 0 1mm;font-size:15px;line-height:1.2;font-weight:700;}',
      '.subtitle{text-align:center;margin:0 0 2mm;font-size:10px;line-height:1.2;color:#444;}',
      '.print-table{flex:1 1 auto;width:100%;height:100%;border-collapse:collapse;table-layout:fixed;}',
      'th,td{border:1px solid #777;padding:1px 3px;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box;}',
      'th{text-align:center;background:#e8d5a8;font-weight:700;}',
      'td{text-align:right;color:#333;}',
      'td:first-child,th:first-child{text-align:left;}',
      'tbody tr:last-child td{font-weight:700;background:#f4ecd8;}',
      `@media print{.print-page{height:${DASHBOARD_PRINT_PAGE_HEIGHT_MM}mm;page-break-after:avoid;page-break-inside:avoid;}}`
    ].join('');
  }

  function fitDashboardPrintToSinglePage(frameWindow) {
    const doc = frameWindow.document;
    const page = doc.querySelector('.print-page');
    const table = doc.querySelector('.print-table');
    const meta = doc.querySelector('.print-meta');
    if (!page || !table) return;

    const pageHeightPx = page.offsetHeight || 1083;
    const metaHeight = meta ? meta.offsetHeight : 0;
    const thead = table.querySelector('thead');
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    const theadRowCount = thead ? thead.querySelectorAll('tr').length : 1;
    const totalRows = bodyRows.length + theadRowCount;
    if (!totalRows) return;

    const tableHeightPx = Math.max(0, pageHeightPx - metaHeight - 2);
    const rowHeightPx = Math.max(12, Math.floor(tableHeightPx / totalRows));
    const fontSize = Math.min(12, Math.max(8, Math.floor(rowHeightPx * 0.42)));

    if (thead) {
      thead.querySelectorAll('tr').forEach((tr) => {
        tr.style.height = `${rowHeightPx}px`;
      });
    }
    bodyRows.forEach((tr) => {
      tr.style.height = `${rowHeightPx}px`;
    });

    table.style.height = `${rowHeightPx * totalRows}px`;
    doc.querySelectorAll('th, td').forEach((cell) => {
      cell.style.fontSize = `${fontSize}px`;
      cell.style.lineHeight = '1.1';
      cell.style.padding = `1px ${Math.max(4, Math.floor(fontSize * 0.45))}px`;
    });
  }

  function printDashboardMatrix(kind) {
    if (!lastGridPayload) {
      if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: 'Print', text: 'No data to print.' });
      return;
    }
    const isRolling = kind === 'rolling';
    const title = isRolling ? 'Main Cage Rolling Check' : 'W/L Check';
    const sheet = isRolling ? buildRollingSheetPayload(lastGridPayload) : buildWlSheetPayload(lastGridPayload);
    if (!sheet.rows.length) {
      if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: 'Print', text: 'No data to print.' });
      return;
    }
    const headerHtml = sheet.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const colgroupHtml = isRolling ? getRollingPrintColgroup() : getWlPrintColgroup();
    const rowsHtml = sheet.rows.map((row) => {
      return `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
    }).join('');
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    const frameWindow = iframe.contentWindow;
    const frameDoc = frameWindow.document;
    frameDoc.open();
    frameDoc.write([
      '<!doctype html><html><head><title>', escapeHtml(title), '</title><style>',
      getDashboardMatrixPrintStyles(),
      '</style></head><body><div class="print-page">',
      '<div class="print-meta">',
      '<h2>', escapeHtml(title), '</h2>',
      '<div class="subtitle">', escapeHtml(getDashPeriodLabel()), '</div>',
      '</div>',
      '<table class="print-table">', colgroupHtml,
      '<thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody></table>',
      '</div></body></html>'
    ].join(''));
    frameDoc.close();
    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 300);
    };
    frameWindow.onafterprint = cleanup;
    setTimeout(() => {
      fitDashboardPrintToSinglePage(frameWindow);
      requestAnimationFrame(() => {
        fitDashboardPrintToSinglePage(frameWindow);
        frameWindow.focus();
        frameWindow.print();
        cleanup();
      });
    }, 100);
  }

  async function exportDashboardMatrix(kind) {
    if (!lastGridPayload) {
      if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: 'Export', text: 'No data to export.' });
      return;
    }
    const isRolling = kind === 'rolling';
    const rows = isRolling ? (lastGridPayload.rolling_rows || []) : (lastGridPayload.wl_rows || []);
    if (!rows.length) {
      if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: 'Export', text: 'No data to export.' });
      return;
    }
    const prefix = isRolling ? 'MainCageRollingCheck' : 'WLCheck';
    const filename = `${prefix}_${lastGridPayload.date_from}_${lastGridPayload.date_to}.xlsx`;
    const sheetName = isRolling ? 'Rolling Check' : 'WL Check';
    const btn = document.getElementById(isRolling ? 'btn-dash-rolling-export' : 'btn-dash-wl-export');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/dashboard_grid/export_xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          kind: isRolling ? 'rolling' : 'wl',
          date_from: lastGridPayload.date_from,
          date_to: lastGridPayload.date_to,
          rolling_rows: lastGridPayload.rolling_rows,
          wl_rows: lastGridPayload.wl_rows,
          totals: lastGridPayload.totals,
          filename,
          sheetName
        })
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
      console.error('exportDashboardMatrix:', err);
      if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Export failed.' });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function initDashMatrixPrintExport() {
    const rollingPrint = document.getElementById('btn-dash-rolling-print');
    const rollingExport = document.getElementById('btn-dash-rolling-export');
    const wlPrint = document.getElementById('btn-dash-wl-print');
    const wlExport = document.getElementById('btn-dash-wl-export');
    if (rollingPrint) {
      rollingPrint.addEventListener('click', (e) => {
        e.preventDefault();
        printDashboardMatrix('rolling');
      });
    }
    if (rollingExport) {
      rollingExport.addEventListener('click', (e) => {
        e.preventDefault();
        exportDashboardMatrix('rolling');
      });
    }
    if (wlPrint) {
      wlPrint.addEventListener('click', (e) => {
        e.preventDefault();
        printDashboardMatrix('wl');
      });
    }
    if (wlExport) {
      wlExport.addEventListener('click', (e) => {
        e.preventDefault();
        exportDashboardMatrix('wl');
      });
    }
  }

  function setCageBalanceHeight(el, px) {
    const value = px === '' ? '' : `${px}px`;
    el.style.height = value;
    el.style.minHeight = value;
    el.style.maxHeight = value;
  }

  function syncCageDiffAlignment() {
    const cageMainPanel = document.getElementById('dash-cage-main-panel');
    const anticipated = document.getElementById('dash-anticipated-panel');
    if (!cageMainPanel || !anticipated) return;

    const cageBalance = cageMainPanel.querySelector('.card');
    const leftDiff = cageMainPanel.querySelector('.dash-cage-balance-diff');
    const rightDiff = anticipated.querySelectorAll('.dash-cage-balance-diff')[1];
    if (!cageBalance || !leftDiff || !rightDiff) return;

    if (window.innerWidth < 992) {
      setCageBalanceHeight(cageBalance, '');
      return;
    }

    setCageBalanceHeight(cageBalance, '');
    void cageBalance.offsetHeight;

    const stackGap = parseFloat(getComputedStyle(cageMainPanel).rowGap || getComputedStyle(cageMainPanel).gap) || 0;
    const targetHeight = Math.round(
      rightDiff.getBoundingClientRect().top - cageMainPanel.getBoundingClientRect().top - stackGap
    );
    if (targetHeight <= 0) return;

    setCageBalanceHeight(cageBalance, targetHeight);
    void cageBalance.offsetHeight;

    const delta = Math.round(rightDiff.getBoundingClientRect().top - leftDiff.getBoundingClientRect().top);
    if (delta !== 0) {
      setCageBalanceHeight(cageBalance, Math.max(0, targetHeight + delta));
    }
  }

  function syncMatrixPanelHeight() {
    const mainCard = document.querySelector('#dash-cage-main-panel > .card:last-of-type');
    const anticipatedCard = document.querySelector('#dash-anticipated-panel > .card:last-of-type');
    const panel = document.getElementById('dash-dual-matrix-panel');
    const rollingCard = document.querySelector('.dash-dual-matrix-col.is-rolling > .card');
    const wlCard = document.querySelector('.dash-dual-matrix-col.is-wl > .card');

    if (window.innerWidth < 992) {
      if (panel) {
        panel.style.height = '';
        panel.style.minHeight = '';
      }
      [rollingCard, wlCard].forEach((el) => {
        if (el) {
          el.style.height = '';
          el.style.minHeight = '';
        }
      });
      syncCageDiffAlignment();
      return;
    }

    if (!panel || !anticipatedCard) return;

    syncCageDiffAlignment();

    const targetBottom = Math.max(
      mainCard ? mainCard.getBoundingClientRect().bottom : 0,
      anticipatedCard.getBoundingClientRect().bottom
    );
    const panelTop = panel.getBoundingClientRect().top;
    const panelHeight = Math.round(targetBottom - panelTop);

    if (panelHeight > 0) {
      panel.style.height = `${panelHeight}px`;
      panel.style.minHeight = `${panelHeight}px`;
    }

    [rollingCard, wlCard].forEach((card) => {
      if (card) {
        card.style.height = '100%';
        card.style.minHeight = '100%';
      }
    });

    requestAnimationFrame(() => {
      if (window.innerWidth < 992 || !panel || !anticipatedCard) return;
      const settleBottom = Math.max(
        mainCard ? mainCard.getBoundingClientRect().bottom : 0,
        anticipatedCard.getBoundingClientRect().bottom
      );
      const settleTop = panel.getBoundingClientRect().top;
      const settleHeight = Math.round(settleBottom - settleTop);
      if (settleHeight > 0 && Math.abs(settleHeight - panelHeight) > 1) {
        panel.style.height = `${settleHeight}px`;
        panel.style.minHeight = `${settleHeight}px`;
      }
    });
  }

  function initMatrixPanelHeightSync() {
    const ref = document.getElementById('dash-anticipated-panel');
    const mainCard = document.querySelector('#dash-cage-main-panel > .card:last-of-type');
    const anticipatedCard = document.querySelector('#dash-anticipated-panel > .card:last-of-type');
    const panel = document.getElementById('dash-dual-matrix-panel');
    if (!ref) return;

    syncMatrixPanelHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => syncMatrixPanelHeight());
      [ref, mainCard, anticipatedCard, panel].forEach((el) => {
        if (el) ro.observe(el);
      });
    }

    window.addEventListener('resize', () => {
      syncMatrixPanelHeight();
      syncDualMatrixRowHeights();
    });

    window.setTimeout(syncMatrixPanelHeight, 200);
    window.setTimeout(syncMatrixPanelHeight, 600);
  }

  // The dashboard grid ends on the cut-off date (2nd-to-last day of the month) as
  // shown in the label and the date-range picker — no month-end expansion here.
  function dashRollingApiEndDate(endYmd) {
    return String(endYmd || '').trim().slice(0, 10);
  }

  function setDashGridDateRange(fromDate, toDate) {
    let from = String(fromDate || '').trim().slice(0, 10);
    let to = dashRollingApiEndDate(toDate);
    if (from && to && from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    const fromEl = document.getElementById('dash-date-from');
    const toEl = document.getElementById('dash-date-to');
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
    return { from, to };
  }

  function getDashGridDefaultRange() {
    if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function') {
      return window.MonthEndCutoffRange.getMonthEndCutoffRange();
    }
    const from = document.getElementById('dash-date-from')?.value || '';
    const to = document.getElementById('dash-date-to')?.value || '';
    return { start: from, end: to, startDate: from, endDate: to, endDateApi: to, startAt: null, endAt: null };
  }

  function applyDashDefaultDateRange() {
    const defaults = getDashGridDefaultRange();
    const from = defaults.startDate || document.getElementById('dash-date-from')?.value || '';
    const to = defaults.endDate || document.getElementById('dash-date-to')?.value || '';
    return setDashGridDateRange(from, to);
  }

  function formatDashAmtHtml(n, forceNeg) {
    const v = Math.round(Number(n) || 0);
    if (forceNeg) {
      if (!v) return '0';
      return `<span class="text-dash-neg">(${Math.abs(v).toLocaleString('en-US')})</span>`;
    }
    if (v < 0) {
      return `<span class="text-dash-neg">(${Math.abs(v).toLocaleString('en-US')})</span>`;
    }
    return v.toLocaleString('en-US');
  }

  function setHtmlById(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function formatPeriodLabel(fromYmd, toYmd) {
    const fmt = (ymd) => {
      const s = String(ymd || '').trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
      if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.formatDisplayDate === 'function') {
        const parts = s.split('-').map(Number);
        return window.MonthEndCutoffRange.formatDisplayDate(new Date(parts[0], parts[1] - 1, parts[2]));
      }
      const parts = s.split('-').map(Number);
      return `${parts[1]}/${parts[2]}`;
    };
    const a = fmt(fromYmd);
    const b = fmt(toYmd);
    if (!a || !b) return '';
    if (window.MonthEndCutoffRange) return `${a} to ${b}`;
    return `${a} – ${b}`;
  }

  function formatPeriodMetaShort(fromYmd, toYmd) {
    const short = (ymd) => {
      const s = String(ymd || '').trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
      const parts = s.split('-').map(Number);
      return `${parts[1]}/${parts[2]}`;
    };
    const a = short(fromYmd);
    const b = short(toYmd);
    if (!a || !b) return '';
    return `${a} – ${b}`;
  }

  function escapeDashHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPeriodServiceCategoryRows(containerId, categories, useJunketOut) {
    const root = document.getElementById(containerId);
    if (!root || !Array.isArray(categories)) return;
    root.innerHTML = categories.map((cat) => {
      const key = escapeDashHtml(cat.key || '');
      const label = escapeDashHtml(cat.label || cat.key || '');
      const modalId = escapeDashHtml(cat.modalId || 'modal-dash-service-category');
      const amount = useJunketOut ? (Number(cat.junketOut) || 0) : (Number(cat.balance) || 0);
      return `<div class="dash-kv dash-service-category-row" data-category="${key}">
        <span class="dash-kv-label"><a href="#" class="js-open-dash-service-category" data-category="${key}" data-label="${label}" data-modal-id="${modalId}">${label}</a></span>
        <span class="dash-kv-value dash-service-balance" data-category="${key}">${formatDashAmtHtml(amount)}</span>
      </div>`;
    }).join('');
  }

  function applyDashboardPeriodSummary(summary) {
    if (!summary) return;

    const winLoss = Math.round(Number(summary.win_loss) || 0);
    const expense = Math.round(Number(summary.expense) || 0);
    const junketLoss = Math.round(Number(summary.junket_loss) || 0);
    const soa = Math.round(Number(summary.soa) || 0);
    const additional = Math.round(Number(summary.additional_commission) || 0);
    const commission = Math.round(Number(summary.commission_settlement) || 0);
    const companyExpenseBase = Math.round(Number(summary.company_expense_base) || 0);
    const companyExpenseTotal = Math.round(Number(summary.company_expense_total) || 0);
    const categories = Array.isArray(summary.service_categories) ? summary.service_categories : [];

    const panel = document.getElementById('dash-anticipated-panel');
    const rate = Number(panel && panel.dataset.wlRate);
    const wlRate = Number.isFinite(rate) ? rate : 65;
    const wlSettlement = Math.round(winLoss * (wlRate / 100));
    const casinoTotal = wlSettlement - soa;
    const grandTotal = casinoTotal - companyExpenseTotal;

    if (panel) {
      panel.dataset.winLoss = String(winLoss);
      panel.dataset.serviceSettle = String(soa);
      panel.dataset.companyExpense = String(companyExpenseTotal);
      panel.dataset.companyExpenseBase = String(companyExpenseBase);
      panel.dataset.additionalCommission = String(additional);
    }

    setHtmlById('winloss', formatDashAmtHtml(winLoss));
    setHtmlById('dash-wl-settlement', formatDashAmtHtml(wlSettlement));
    setHtmlById('dash-soa-fnb-hotel-total', formatDashAmtHtml(soa, true));
    setHtmlById('dash-casino-total', formatDashAmtHtml(casinoTotal));
    setHtmlById('dash-expenses-total', formatDashAmtHtml(expense, true));
    setHtmlById('dash-expenses-total-anticipated', formatDashAmtHtml(expense, true));
    setHtmlById('dash-junket-loss-total', formatDashAmtHtml(junketLoss, true));
    setHtmlById('dash-junket-loss-total-anticipated', formatDashAmtHtml(junketLoss, true));
    setHtmlById('dash-commission-settlement-total', formatDashAmtHtml(commission, true));
    setHtmlById('dash-commission-settlement-anticipated', formatDashAmtHtml(commission, true));
    setHtmlById('dash-additional-commission-total', formatDashAmtHtml(additional, true));
    setHtmlById('dash-additional-commission-anticipated', formatDashAmtHtml(additional, true));
    setHtmlById('dash-company-expense-total', formatDashAmtHtml(companyExpenseTotal, true));
    setHtmlById('dash-grand-total', formatDashAmtHtml(grandTotal));

    // Main panel period amounts.
    // NOTE: the "Cage Balance" card (USD/GCASH/PHP/NN/CC/RC/Balance Total/The
    // difference) is deliberately NOT updated here — it must show the cumulative
    // actual cage balance, independent of the selected reporting period. Those
    // cells are refreshed by loadHouseBalances() / applyHouseBalances() instead.
    const cage = summary.cage || {};
    setHtmlById('dash-company-balance-total', formatDashAmtHtml(summary.company_capital_balance));
    setHtmlById('dash-main-available-amount', formatDashAmtHtml(summary.main_available_amount));
    setHtmlById('dash-utang-total', formatDashAmtHtml(cage.credit, true));
    setHtmlById('dash-tip-balance-value', formatDashAmtHtml(cage.tip_balance));
    setHtmlById('dash-guest-line-total', formatDashAmtHtml(cage.guest_balance));
    // dash-actual-rolling-amount ("Actual Rolling") is owned by updateActualCheck()
    // (Main Cage minus live RC) — do not also set it here, the two fetches run
    // concurrently and would otherwise race for the same element.

    // Main + Anticipated Add Charge: period signed balances
    renderPeriodServiceCategoryRows('dash-service-category-rows-main', categories, false);
    renderPeriodServiceCategoryRows('dash-service-category-rows-anticipated', categories, false);

    const periodLabel = document.getElementById('dash-period-label');
    if (periodLabel) {
      let labelFrom = summary.date_from;
      let labelTo = summary.date_to;
      const rangeInput = document.getElementById('dash-rolling-daterange');
      const fp = rangeInput && rangeInput._flatpickr;
      if (fp && fp.selectedDates && fp.selectedDates.length === 2) {
        const pad = (n) => String(n).padStart(2, '0');
        const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        labelFrom = ymd(fp.selectedDates[0]);
        labelTo = ymd(fp.selectedDates[1]);
      }
      periodLabel.textContent = formatPeriodMetaShort(labelFrom, labelTo)
        || formatPeriodLabel(labelFrom, labelTo);
    }
  }

  async function loadPeriodSummary() {
    const from = document.getElementById('dash-date-from')?.value || '';
    const to = document.getElementById('dash-date-to')?.value || '';
    if (!from || !to) return;
    const q = new URLSearchParams({ date_from: from, date_to: to });
    try {
      const res = await fetch(`/dashboard_period_summary?${q}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load period summary');
      applyDashboardPeriodSummary(data);
      syncMatrixPanelHeight();
    } catch (err) {
      console.error('dashboard_period_summary:', err);
    }
  }

  // The "Cage Balance" card shows the cumulative actual cage balance and must not
  // follow the dashboard period/month filter. It is fed by /dashboard_house_balances
  // (no date range) rather than by applyDashboardPeriodSummary().
  function applyHouseBalances(b) {
    if (!b || b.message) return;
    const usd = Math.round(Number(b.usd) || 0);
    const gcash = Math.round(Number(b.gcash) || 0);
    const php = Math.round(Number(b.php_cash != null ? b.php_cash : b.cashBalance) || 0);
    const nn = Math.round(Number(b.nn_chips != null ? b.nn_chips : b.nnChipsBalance) || 0);
    const cc = Math.round(Number(b.cc_chips != null ? b.cc_chips : b.ccChipsBalance) || 0);
    const rc = Math.round(Number(b.rc_chips) || 0);
    const totalChips = Math.round(Number(b.total_chips != null ? b.total_chips : nn + cc) || 0);
    const house = Math.round(Number(b.house_balance != null ? b.house_balance : b.houseBalance) || 0);

    setHtmlById('dash-cage-usd-total', formatDashAmtHtml(usd));
    setHtmlById('dash-cage-gcash-total', formatDashAmtHtml(gcash));
    setHtmlById('dash-cage-php-total', formatDashAmtHtml(php));
    setHtmlById('dash-cage-nn-total', formatDashAmtHtml(nn));
    setHtmlById('dash-cage-cc-total', formatDashAmtHtml(cc));
    setHtmlById('dash-cage-rc-total', formatDashAmtHtml(rc));
    // Balance Total includes RC (outstanding roller chips): PHP + NN + CC + RC.
    const balanceTotalWithRc = house + rc;
    setHtmlById('dash-cage-balance-total', formatDashAmtHtml(balanceTotalWithRc));
    setHtmlById('dash-cage-balance-diff-value', formatDashAmtHtml(Math.round(Number(b.cage_balance_diff) || 0)));
    // "Chips" (Current Time W/L) and "NN Chips" (Current Time Rolling) both include
    // the outstanding Roller Chips (RC) so the on-screen math reconciles:
    //   Buy In - Chips(incl RC)      ≈ Cage W/L
    //   Main Cage - NN Chips(incl RC) = Actual Rolling
    setHtmlById('dash-actual-chips', formatDashAmtHtml(totalChips + rc));
    setHtmlById('dash-actual-nn-chips', formatDashAmtHtml(nn + rc));

    const cashPanel = document.getElementById('dash-cage-cash-panel');
    if (cashPanel) {
      // chips + house datasets include RC so recalcDiff() (USD/GCASH modal) keeps
      // "The difference" at 0 against the RC-inclusive Balance Total.
      cashPanel.dataset.phpBalance = String(php);
      cashPanel.dataset.chipsBalance = String(totalChips + rc);
      cashPanel.dataset.houseBalance = String(balanceTotalWithRc);
    }
  }

  async function loadHouseBalances() {
    try {
      const res = await fetch('/dashboard_house_balances', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load house balances');
      applyHouseBalances(data);
    } catch (err) {
      console.error('dashboard_house_balances:', err);
    }
  }

  function reloadDashboardByDateRange() {
    // loadHouseBalances() is period-independent but refreshed on the same triggers
    // so the Cage Balance card stays current after transactions / tab refocus.
    return Promise.all([loadGridData(), loadPeriodSummary(), loadHouseBalances()]);
  }

  const DASH_ROLLING_MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function initDashRollingMonthFilter() {
    const select = document.getElementById('dash-rolling-month-filter');
    if (!select) return;

    const today = new Date();
    // On the last day of a month the cut-off range rolls over into the next
    // month (see getMonthEndCutoffRange), so anchor the picker on that next
    // month to keep the Month label consistent with the shown date range.
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const isLastDayOfMonth = today.getDate() === lastDayOfMonth;
    const anchor = new Date(today.getFullYear(), today.getMonth() + (isLastDayOfMonth ? 1 : 0), 1);
    const currentValue = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;

    const options = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${DASH_ROLLING_MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      options.push(`<option value="${value}">${label}</option>`);
    }
    select.innerHTML = options.join('');
    select.value = currentValue;

    select.addEventListener('change', function () {
      const parts = select.value.split('-').map(Number);
      if (parts.length !== 2 || !parts[0] || !parts[1]) return;
      const refDate = new Date(parts[0], parts[1] - 1, 15);

      const range = window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function'
        ? window.MonthEndCutoffRange.getMonthEndCutoffRange(refDate)
        : null;

      const startDate = range ? range.startDate : `${parts[0]}-${String(parts[1]).padStart(2, '0')}-01`;
      const endDate = range ? range.endDate : dashRollingApiEndDate(startDate);
      setDashGridDateRange(startDate, endDate);

      const rangeInput = document.getElementById('dash-rolling-daterange');
      const fp = rangeInput && rangeInput._flatpickr;
      if (fp && range && range.startAt && range.endAt) {
        fp.setDate([range.startAt, range.endAt], false);
        if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
          setTimeout(function () {
            window.MonthEndCutoffRange.fitRangePickerInstance(fp);
          }, 0);
        }
      }

      reloadDashboardByDateRange();
    });
  }

  function initDashRollingDateRange() {
    const rangeInput = document.getElementById('dash-rolling-daterange');
    if (!rangeInput || typeof flatpickr !== 'function') return;

    const defaults = getDashGridDefaultRange();
    let dateRangePicker = null;

    const config = {
      mode: 'range',
      showMonths: 3,
      onChange: function (selectedDates) {
        if (selectedDates.length !== 2) return;
        const start = selectedDates[0];
        const end = selectedDates[1];
        const pad = (n) => String(n).padStart(2, '0');
        const from = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
        const to = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
        setDashGridDateRange(from, to);
        reloadDashboardByDateRange();
      }
    };

    if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.patchRangePickerConfig === 'function') {
      dateRangePicker = flatpickr(rangeInput, window.MonthEndCutoffRange.patchRangePickerConfig(config));
    } else {
      if (defaults.startAt && defaults.endAt) {
        config.defaultDate = [defaults.startAt, defaults.endAt];
      } else if (Array.isArray(defaults.defaultDate)) {
        config.defaultDate = defaults.defaultDate;
      }
      dateRangePicker = flatpickr(rangeInput, config);
    }

    if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function' && dateRangePicker) {
      setTimeout(function () {
        window.MonthEndCutoffRange.fitRangePickerInstance(dateRangePicker);
      }, 0);
    }
  }

  async function loadGridData() {
    const from = document.getElementById('dash-date-from')?.value || '';
    const to = document.getElementById('dash-date-to')?.value || '';
    const q = new URLSearchParams({ date_from: from, date_to: to });
    try {
      const res = await fetch(`/dashboard_grid_data?${q}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load grid data');
      lastGridPayload = data;
      renderRollingTable(data);
      renderWlTable(data);
      updateOnGameSummary(data);
      syncMatrixPanelHeight();
      syncDualMatrixRowHeights();
      requestAnimationFrame(() => {
        syncMatrixPanelHeight();
        syncDualMatrixRowHeights();
      });
    } catch (err) {
      console.error('dashboard_grid_data:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initMatrixPanelHeightSync();
    bindDualMatrixScrollSync();
    initBeyondChips();
    initRollingRemarks();
    initDashRollingManualEntry();
    initWlRemarks();
    initDashMatrixPrintExport();
    applyDashDefaultDateRange();
    initDashRollingDateRange();
    initDashRollingMonthFilter();
    reloadDashboardByDateRange();

    const guestSummaryModal = document.getElementById('modal-guest-summary-quick-view');
    if (guestSummaryModal) {
      initLineQuickView();
      guestSummaryModal.addEventListener('show.bs.modal', loadGuestSummaryStats);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reloadDashboardByDateRange();
    });
  });

  window.dashboardGridReload = loadGridData;
  window.dashboardPeriodReload = loadPeriodSummary;
  window.dashboardHouseBalanceReload = loadHouseBalances;
  window.dashboardReloadByDateRange = reloadDashboardByDateRange;
})();
