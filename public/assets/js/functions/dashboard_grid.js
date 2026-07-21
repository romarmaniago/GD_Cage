(() => {
  const beyondChipsEls = {};
  let lastGridPayload = null;
  let dashRollingCheckSplitDateRange = null;

  function dashRollingCheckApiEndDate(endYmd) {
    if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
    const parts = String(endYmd).slice(0, 10).split('-').map(Number);
    const lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
    if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
      return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
    }
    return endYmd;
  }

  function applyDashRollingCheckDateRange(from, to) {
    const fromEl = document.getElementById('dash-date-from');
    const toEl = document.getElementById('dash-date-to');
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
    loadGridData();
  }

  function initDashRollingCheckSplitDateRange() {
    if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
      dashRollingCheckSplitDateRange = { fitWidths: function () {} };
      return;
    }

    dashRollingCheckSplitDateRange = window.SplitDateRange.attach({
      startId: 'dash-rolling-check-start-date',
      endId: 'dash-rolling-check-end-date',
      splitWrapperId: 'dash-rolling-check-split-daterange-wrapper',
      independent: true,
      invalidDateMessage: 'Invalid date range.',
      onRangeApplied: function (range) {
        if (!range || !range.start || !range.end) return;
        let from = range.start;
        let to = dashRollingCheckApiEndDate(range.end);
        if (from > to) {
          const swap = from;
          from = to;
          to = swap;
        }
        applyDashRollingCheckDateRange(from, to);
      }
    });
  }

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

    const bodyHtml = rows.map((row) => {
      const cls = row.date === today ? 'dash-rolling-row is-today' : 'dash-rolling-row';
      return `<div class="${cls}" data-date="${escapeAttr(row.date)}">
        <span class="dash-rolling-body-cell is-date">${toDisplayDate(row.date)}</span>
        <span class="dash-rolling-body-cell is-col-casino">${escapeHtml(formatCell(row.buy_in))}</span>
        <span class="dash-rolling-body-cell is-col-casino text-dash-neg">${escapeHtml(formatCashOutCell(row.cash_out))}</span>
        <span class="dash-rolling-body-cell is-col-casino">${escapeHtml(formatCell(row.rolling))}</span>
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

  function formatWlAmountCell(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return { text: '', neg: false };
    return { text: formatAmount(n), neg: n < 0 };
  }

  function renderWlTable(payload) {
    const root = document.getElementById('dash-wl-root');
    const foot = document.getElementById('dash-wl-foot');
    if (!root || !foot || !payload) return;

    const today = todayIso();
    const rows = payload.wl_rows || [];

    const bodyHtml = rows.map((row) => {
      const cls = row.date === today ? 'dash-wl-row is-today' : 'dash-wl-row';
      const diff = (Number(row.casino) || 0) - (Number(row.gold_dragon) || 0);
      const casino = formatWlAmountCell(row.casino);
      const gold = formatWlAmountCell(row.gold_dragon);
      const diffCell = formatWlAmountCell(diff);
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
    set('dash-actual-buyin', t.buy_in);
    set('dash-actual-cashout', -Math.abs(t.cash_out || 0));
    set('dash-actual-wl', t.wl_total);
    set('dash-actual-rolling', t.rolling);
    set('dash-actual-gaming-wl', t.wl_total);
    set('dash-actual-gaming-rolling', t.rolling);
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
      const diff = (Number(row.casino) || 0) - (Number(row.gold_dragon) || 0);
      return [
        toDisplayDate(row.date),
        formatCell(row.casino),
        formatCell(row.gold_dragon),
        formatCell(diff),
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
    const ref = document.getElementById('dash-anticipated-panel');
    const panel = document.getElementById('dash-dual-matrix-panel');
    const cageMainPanel = document.getElementById('dash-cage-main-panel');
    if (!ref) return;

    if (window.innerWidth < 992) {
      if (panel) panel.style.height = '';
      if (cageMainPanel) cageMainPanel.style.height = '';
      syncCageDiffAlignment();
      return;
    }

    const heightPx = `${ref.offsetHeight}px`;
    if (panel) panel.style.height = heightPx;
    if (cageMainPanel) cageMainPanel.style.height = heightPx;
    requestAnimationFrame(syncCageDiffAlignment);
  }

  function initMatrixPanelHeightSync() {
    const ref = document.getElementById('dash-anticipated-panel');
    if (!ref) return;

    syncMatrixPanelHeight();

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => syncMatrixPanelHeight()).observe(ref);
    }

    window.addEventListener('resize', () => {
      syncMatrixPanelHeight();
      syncDualMatrixRowHeights();
    });

    window.setTimeout(syncMatrixPanelHeight, 200);
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
    } catch (err) {
      console.error('dashboard_grid_data:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initMatrixPanelHeightSync();
    bindDualMatrixScrollSync();
    initBeyondChips();
    initRollingRemarks();
    initWlRemarks();
    initDashMatrixPrintExport();
    initDashRollingCheckSplitDateRange();
    loadGridData();

    const guestSummaryModal = document.getElementById('modal-guest-summary-quick-view');
    if (guestSummaryModal) {
      initLineQuickView();
      guestSummaryModal.addEventListener('show.bs.modal', loadGuestSummaryStats);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadGridData();
    });
  });

  window.dashboardGridReload = loadGridData;
})();
