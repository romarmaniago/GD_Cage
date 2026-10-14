(function () {
  'use strict';

  // SOA (F&B, Hotel) — sheet-style modal (same look as the Excel SOA slip).
  //   SOA label | Amount | Remarks (e.g. "8/27 ~ 8/31")
  // Every row is its own entry with its own label, in sheet order. Nothing is
  // merged by label; the "+" button adds another amount / remarks line under an
  // SOA (a row joined to the one above with no label of its own; the label cell
  // spans its lines).
  // Cells save on leaving the cell (Enter moves down, Esc undoes). The blank row
  // at the bottom adds a new entry.
  // Program Date is the dashboard period (month-end cutoff), shown once at the
  // top; new entries are dated inside it.

  function $(id) {
    return document.getElementById(id);
  }

  const els = {};
  let period = { from: '', to: '' };
  let entries = [];
  let loadSeq = 0;
  let rendering = false;
  // Unsaved line added with "+": { sortKey, amount, remarks }
  let draft = null;

  const HTML2CANVAS_SRC = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  let html2canvasPromise = null;

  function cacheEls() {
    els.modal = $('modal-dash-soa-fnb-hotel');
    els.sheet = $('dash-soa-sheet');
    els.periodLabel = $('dash-soa-period-label');
    els.body = $('dash-soa-history-body');
    els.total = $('dash-soa-history-total');
    els.copyImageBtn = $('btn-dash-soa-copy-image');
    els.copyTextBtn = $('btn-dash-soa-copy-text');

    els.dashDateFrom = $('dash-date-from');
    els.dashDateTo = $('dash-date-to');
    els.dashSoaTotal = $('dash-soa-fnb-hotel-total');
    els.panel = $('dash-anticipated-panel');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toIsoDateOnly(d) {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(d).trim())) return String(d).trim();
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }

  // 2026-09-30 -> 9/30
  function formatMonthDay(iso) {
    const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `${Number(m[1])}/${Number(m[2])}` : '';
  }

  function periodText() {
    return `${formatMonthDay(period.from)} ~ ${formatMonthDay(period.to)}`;
  }

  // New entries are dated today, clamped into the dashboard period.
  function newEntryDate() {
    const today = toIsoDateOnly(new Date());
    if (today < period.from) return period.from;
    if (today > period.to) return period.to;
    return today;
  }

  // Amount cell: negative as a leading "-" or "(…)", digits, commas and one decimal
  // point (max 2 decimals).
  function sanitizeAmountInput(value) {
    const raw = String(value ?? '').trim();
    let text = raw.replace(/[^\d.,]/g, '');
    const dot = text.indexOf('.');
    if (dot !== -1) {
      text = text.slice(0, dot + 1) + text.slice(dot + 1).replace(/[.,]/g, '').slice(0, 2);
    }
    if (raw.startsWith('(')) return '(' + text + (raw.endsWith(')') ? ')' : '');
    if (raw.startsWith('-')) return '-' + text;
    return text;
  }

  // While typing: add thousands commas, keep the sign, a trailing "." and ")".
  function formatAmountLive(clean) {
    const m = String(clean).match(/^([-(]?)([\d,]*)(\.\d*)?(\)?)$/);
    if (!m) return clean;
    const int = m[2].replace(/,/g, '').replace(/^0+(?=\d)/, '');
    return m[1] + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] || '') + m[4];
  }

  // Reformats the amount cell in place, keeping the caret after the same digit.
  function applyLiveAmount(el) {
    const raw = el.value;
    const caret = el.selectionStart == null ? raw.length : el.selectionStart;
    const digitsBefore = raw.slice(0, caret).replace(/[^\d.]/g, '').length;
    const next = formatAmountLive(sanitizeAmountInput(raw));
    if (next !== raw) {
      el.value = next;
      let pos = /^[-(]/.test(next) ? 1 : 0;
      for (let seen = 0; pos < next.length && seen < digitsBefore; pos++) {
        if (/[\d.]/.test(next[pos])) seen++;
      }
      el.setSelectionRange(pos, pos);
    }
    return next;
  }

  function isNegativeText(value) {
    return /^\s*[-(]/.test(String(value ?? ''));
  }

  function parseAmount(raw) {
    const text = String(raw ?? '').trim();
    const digits = text.replace(/[,()\-\s]/g, '');
    if (digits === '' || digits === '.') return 0;
    const n = Number(digits);
    if (!Number.isFinite(n)) return NaN;
    const v = Math.round(n * 100) / 100;
    return isNegativeText(text) ? -v : v;
  }

  // Sheet format: negative (41,440) in red via .is-neg; 0; 1,500.5
  function formatAmount(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100 || 0;
    const abs = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return v < 0 ? `(${abs})` : abs;
  }

  function formatSignedHtml(n) {
    const v = Math.round(Number(n) || 0) || 0;
    return v < 0 ? `<span class="text-dash-neg">(${Math.abs(v).toLocaleString('en-US')})</span>` : v.toLocaleString('en-US');
  }

  function getDashboardPeriod() {
    const from = els.dashDateFrom?.value ? toIsoDateOnly(els.dashDateFrom.value) : '';
    const to = els.dashDateTo?.value ? toIsoDateOnly(els.dashDateTo.value) : '';
    return { from, to };
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed.');
    return data;
  }

  function sendJson(url, method, body) {
    return fetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function showError(message) {
    if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: message });
    else window.alert(message);
  }

  // -------------------------
  // Data helpers
  // -------------------------
  function entryById(id) {
    return entries.find((e) => String(e.id) === String(id)) || null;
  }

  // Rows in sheet order (sort key, then the order added).
  function sortedEntries() {
    return entries.slice().sort((a, b) => (a.sort_key - b.sort_key) || (a.id - b.id));
  }

  // Saved rows plus the unsaved "+" line, in sheet order.
  function displayItems() {
    const items = sortedEntries().map((e) => ({ kind: 'row', entry: e, sortKey: e.sort_key }));
    if (draft) {
      const at = items.findIndex((it) => it.sortKey > draft.sortKey);
      const item = { kind: 'draft', sortKey: draft.sortKey };
      if (at === -1) items.push(item);
      else items.splice(at, 0, item);
    }
    return items;
  }

  function itemLabel(item) {
    return item.kind === 'draft' ? '' : String(item.entry.category || '');
  }

  function itemJoined(item, i) {
    return i > 0 && (item.kind === 'draft' || !!item.entry.join_prev);
  }

  // A joined row with no label is a line of the SOA above: no label cell of its
  // own, the label cell above spans it.
  function isCoveredItem(item, i) {
    return itemJoined(item, i) && !itemLabel(item);
  }

  function totalAmount() {
    return entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }

  function entryPayload(entry, changes) {
    return Object.assign({
      id: entry.id,
      category: entry.category,
      amount: Number(entry.amount) || 0,
      remarks: entry.remarks || '',
      soa_date: entry.soa_date,
      join_prev: entry.join_prev ? 1 : 0,
      sort_key: entry.sort_key
    }, changes || {});
  }

  // -------------------------
  // Rendering
  // -------------------------
  function amountInputHtml(key, value, isNew) {
    const n = Number(value) || 0;
    const shown = isNew ? '' : formatAmount(n);
    return `<input type="text" class="soa-cell soa-amount-input${n < 0 ? ' is-neg' : ''}" data-field="amount" data-key="${key}" value="${escapeHtml(shown)}" inputmode="decimal" autocomplete="off" aria-label="Amount">`;
  }

  function remarksCellHtml(key, value, withActions) {
    return `<input type="text" class="soa-cell" data-field="remarks" data-key="${key}" value="${escapeHtml(value || '')}" maxlength="500" autocomplete="off" aria-label="Remarks">` +
      (withActions
        ? '<span class="soa-row-actions">' +
          '<button type="button" class="soa-add js-soa-add-line" tabindex="-1" title="Add amount / remarks line under this SOA" aria-label="Add line"><i class="fa fa-plus" aria-hidden="true"></i></button>' +
          '<button type="button" class="soa-del js-soa-delete" tabindex="-1" title="Delete row" aria-label="Delete row"><i class="fa fa-trash-alt" aria-hidden="true"></i></button>' +
          '</span>'
        : '');
  }

  // A row joined to the one above has no line between them (soa-group-first /
  // soa-group-last mark where the lines are).
  function itemHtml(item, i, items) {
    const joined = itemJoined(item, i);
    const next = items[i + 1];
    const nextJoined = !!next && itemJoined(next, i + 1);
    const cls = ['soa-row'];
    if (!joined) cls.push('soa-group-first');
    if (!nextJoined) cls.push('soa-group-last');

    let labelCell = '';
    if (!isCoveredItem(item, i)) {
      let span = 1;
      while (items[i + span] && isCoveredItem(items[i + span], i + span)) span++;
      const id = item.kind === 'draft' ? 'draft' : item.entry.id;
      labelCell = `<td class="soa-label"${span > 1 ? ` rowspan="${span}"` : ''}><input type="text" class="soa-cell soa-label-input" data-field="category" data-key="${id}:category" value="${escapeHtml(itemLabel(item))}" maxlength="100" autocomplete="off" aria-label="SOA"></td>`;
    }

    if (item.kind === 'draft') {
      cls.push('soa-draft-row');
      return `
      <tr class="${cls.join(' ')}">
        ${labelCell}
        <td class="soa-amount"><input type="text" class="soa-cell soa-amount-input${isNegativeText(draft.amount) ? ' is-neg' : ''}" data-field="amount" data-key="draft:amount" value="${escapeHtml(draft.amount)}" inputmode="decimal" autocomplete="off" aria-label="Amount"></td>
        <td class="soa-remarks"><input type="text" class="soa-cell" data-field="remarks" data-key="draft:remarks" value="${escapeHtml(draft.remarks)}" maxlength="500" autocomplete="off" aria-label="Remarks"></td>
      </tr>`;
    }

    const row = item.entry;
    return `
      <tr class="${cls.join(' ')}" data-id="${row.id}">
        ${labelCell}
        <td class="soa-amount">${amountInputHtml(`${row.id}:amount`, row.amount, false)}</td>
        <td class="soa-remarks">${remarksCellHtml(`${row.id}:remarks`, row.remarks, true)}</td>
      </tr>`;
  }

  function newRowHtml() {
    return `
      <tr class="soa-row soa-new-row soa-group-first soa-group-last">
        <td class="soa-label"><input type="text" class="soa-cell soa-label-input" data-field="category" data-key="new:category" maxlength="100" autocomplete="off" placeholder="+ New SOA" aria-label="New SOA"></td>
        <td class="soa-amount">${amountInputHtml('new:amount', '', true)}</td>
        <td class="soa-remarks">${remarksCellHtml('new:remarks', '', false)}</td>
      </tr>`;
  }

  function captureFocus() {
    const el = document.activeElement;
    if (!el || !els.body || !els.body.contains(el) || !el.dataset.key) return null;
    return { key: el.dataset.key, value: el.value, start: el.selectionStart, end: el.selectionEnd };
  }

  function restoreFocus(state, overrideKey) {
    const key = overrideKey || state?.key;
    const el = key && els.body ? els.body.querySelector(`[data-key="${key}"]`) : null;
    if (!el) return;
    const sameCell = state && state.key === key;
    if (sameCell) el.value = state.value;
    el.focus();
    if (sameCell && state.start != null) el.setSelectionRange(state.start, state.end);
    else el.select();
  }

  function render(focusKey) {
    if (!els.body) return;
    // With an explicit target (Enter on the new row) the typed values were just
    // saved, so the focus moves without carrying them over.
    const state = focusKey ? null : captureFocus();
    rendering = true;
    try {
      els.body.innerHTML = displayItems().map(itemHtml).join('') + newRowHtml();
      updateTotal();
      if (focusKey || state) restoreFocus(state, focusKey);
    } finally {
      rendering = false;
    }
  }

  function updateTotal() {
    if (!els.total) return;
    const total = totalAmount();
    els.total.textContent = formatAmount(total);
    els.total.classList.toggle('is-neg', total < 0);
  }

  function setInvalid(el, message) {
    if (!el) return;
    el.classList.toggle('is-invalid', !!message);
    if (message) el.title = message;
    else el.removeAttribute('title');
  }

  // -------------------------
  // Saving
  // -------------------------
  let saveChain = Promise.resolve();

  // Saves run one at a time so a re-render never races another save.
  function queueSave(task) {
    const run = saveChain.then(task, task);
    saveChain = run.catch(() => {});
    return run;
  }

  function afterChange() {
    refreshDashboardSoaTotal(period.from, period.to).catch((err) => console.error('refresh soa total:', err));
  }

  // Existing row: label / amount / remarks cell.
  function commitRowCell(input) {
    const tr = input.closest('tr');
    const entry = entryById(tr?.dataset.id);
    if (!entry) return Promise.resolve(true);
    const field = input.dataset.field;

    let changes;
    if (field === 'amount') {
      const amount = parseAmount(input.value);
      if (Number.isNaN(amount)) {
        setInvalid(input, 'Enter a valid amount.');
        return Promise.resolve(false);
      }
      setInvalid(input, '');
      input.value = formatAmount(amount);
      input.classList.toggle('is-neg', amount < 0);
      if (amount === (Number(entry.amount) || 0)) return Promise.resolve(true);
      changes = { amount };
    } else if (field === 'category') {
      const category = String(input.value || '').replace(/\s+/g, ' ').trim();
      if (!category && !entry.join_prev) {
        setInvalid(input, 'SOA is required.');
        return Promise.resolve(false);
      }
      setInvalid(input, '');
      input.value = category;
      if (category === entry.category) return Promise.resolve(true);
      changes = { category };
    } else {
      const remarks = String(input.value || '').trim();
      if (remarks === (entry.remarks || '')) return Promise.resolve(true);
      changes = { remarks };
    }

    return queueSave(async () => {
      try {
        await sendJson('/update_soa_fnb_hotel', 'PUT', entryPayload(entry, changes));
        Object.assign(entry, changes);
        updateTotal();
        flash(input);
        afterChange();
        return true;
      } catch (err) {
        console.error('update soa:', err);
        showError(err.message || 'Unable to update SOA.');
        return false;
      }
    });
  }

  // "+": open a blank line right under the SOA block this row belongs to.
  async function addLineAfter(tr) {
    if (draft && !(await commitDraft(els.body.querySelector('tr.soa-draft-row')))) return;
    const items = displayItems();
    let i = items.findIndex((it) => it.kind === 'row' && String(it.entry.id) === String(tr?.dataset.id));
    if (i === -1) return;
    while (items[i + 1] && itemJoined(items[i + 1], i + 1)) i++;
    const end = items[i];
    const next = items[i + 1];
    // Between the block's last row and the next row; after the last row, plain
    // append (the server then orders it by its new id).
    draft = {
      sortKey: next ? (end.sortKey + next.sortKey) / 2 : end.sortKey + 0.5,
      append: !next,
      amount: '',
      remarks: ''
    };
    render('draft:amount');
  }

  function discardDraft() {
    draft = null;
    render();
  }

  // Saves the "+" line (no label of its own, joined to the SOA above). An empty
  // line is just dropped.
  function commitDraft(tr, focusKeyAfter) {
    if (!draft) return Promise.resolve(true);
    const amountEl = tr && tr.querySelector('[data-field="amount"]');
    const amountRaw = String(draft.amount || '').trim();
    const remarks = String(draft.remarks || '').trim();
    if (!amountRaw && !remarks) {
      discardDraft();
      return Promise.resolve(true);
    }
    const amount = parseAmount(amountRaw);
    if (Number.isNaN(amount)) {
      setInvalid(amountEl, 'Enter a valid amount.');
      return Promise.resolve(false);
    }
    if (draft.saving) return draft.saving;
    const pending = draft;
    if (tr) tr.classList.add('soa-row-saving');
    pending.saving = queueSave(async () => {
      try {
        const soaDate = newEntryDate();
        const sortKey = pending.append ? null : pending.sortKey;
        const data = await sendJson('/add_soa_fnb_hotel', 'POST', {
          category: '', amount, remarks, soa_date: soaDate, join_prev: 1, sort_key: sortKey
        });
        const id = Number(data.id);
        entries.push({
          id, soa_date: soaDate, category: '', amount, remarks, join_prev: true,
          sort_key: sortKey == null ? id : sortKey
        });
        if (draft === pending) draft = null;
        render(focusKeyAfter);
        const added = els.body.querySelector(`tr[data-id="${id}"]`);
        if (added) flash(added);
        afterChange();
        return true;
      } catch (err) {
        console.error('add soa line:', err);
        showError(err.message || 'Unable to save SOA.');
        pending.saving = null;
        if (tr && tr.isConnected) tr.classList.remove('soa-row-saving');
        return false;
      }
    });
    return pending.saving;
  }

  function readNewRow(tr) {
    return {
      label: String(tr.querySelector('[data-field="category"]')?.value || '').replace(/\s+/g, ' ').trim(),
      amountRaw: String(tr.querySelector('[data-field="amount"]')?.value || '').trim(),
      remarks: String(tr.querySelector('[data-field="remarks"]')?.value || '').trim()
    };
  }

  // Blank row at the bottom: adds an entry once it has a label.
  function commitNewRow(tr, focusKeyAfter) {
    if (!tr || !tr.isConnected) return Promise.resolve(true);
    const vals = readNewRow(tr);
    const labelEl = tr.querySelector('[data-field="category"]');
    const amountEl = tr.querySelector('[data-field="amount"]');
    if (!vals.label && !vals.amountRaw && !vals.remarks) {
      setInvalid(labelEl, '');
      setInvalid(amountEl, '');
      return Promise.resolve(true);
    }

    const amount = parseAmount(vals.amountRaw);
    setInvalid(labelEl, vals.label ? '' : 'SOA is required.');
    setInvalid(amountEl, Number.isNaN(amount) ? 'Enter a valid amount.' : '');
    if (!vals.label || Number.isNaN(amount)) return Promise.resolve(false);

    if (tr._saving) return tr._saving;
    tr.classList.add('soa-row-saving');
    tr._saving = queueSave(async () => {
      try {
        const category = vals.label;
        const soaDate = newEntryDate();
        const data = await sendJson('/add_soa_fnb_hotel', 'POST', {
          category, amount, remarks: vals.remarks, soa_date: soaDate
        });
        entries.push({ id: Number(data.id), soa_date: soaDate, category, amount, remarks: vals.remarks, join_prev: false, sort_key: Number(data.id) });
        render(focusKeyAfter);
        const added = els.body.querySelector(`tr[data-id="${data.id}"]`);
        if (added) flash(added);
        afterChange();
        return true;
      } catch (err) {
        console.error('add soa:', err);
        showError(err.message || 'Unable to save SOA.');
        return false;
      } finally {
        if (tr.isConnected) {
          tr.classList.remove('soa-row-saving');
          tr._saving = null;
        }
      }
    });
    return tr._saving;
  }

  function flash(el) {
    el.classList.remove('soa-flash');
    void el.offsetWidth;
    el.classList.add('soa-flash');
    setTimeout(() => el.classList.remove('soa-flash'), 1200);
  }

  // Undo (Esc): put the cell back to its saved value.
  function revertCell(el) {
    const tr = el.closest('tr');
    setInvalid(el, '');
    if (tr.classList.contains('soa-draft-row')) {
      discardDraft();
      return;
    }
    if (tr.classList.contains('soa-new-row')) {
      tr.querySelectorAll('.soa-cell').forEach((c) => {
        c.value = '';
        setInvalid(c, '');
      });
      return;
    }
    const field = el.dataset.field;
    const entry = entryById(tr.dataset.id);
    if (!entry) return;
    if (field === 'category') {
      el.value = entry.category;
    } else if (field === 'amount') {
      el.value = formatAmount(entry.amount);
      el.classList.toggle('is-neg', Number(entry.amount) < 0);
    } else {
      el.value = entry.remarks || '';
    }
    el.select();
  }

  // Same column, one cell up / down.
  function siblingCell(el, step) {
    const cells = Array.from(els.body.querySelectorAll(`.soa-cell[data-field="${el.dataset.field}"]`));
    return cells[cells.indexOf(el) + step] || null;
  }

  function focusCell(el) {
    if (!el) return;
    el.focus();
    el.select();
  }

  function commitCell(el) {
    const tr = el.closest('tr');
    if (!tr || tr.classList.contains('soa-new-row') || tr.classList.contains('soa-draft-row')) return Promise.resolve(true);
    return commitRowCell(el);
  }

  // -------------------------
  // Load / dashboard sync
  // -------------------------
  async function loadHistory() {
    if (!els.body) return;
    const seq = ++loadSeq;
    entries = [];
    draft = null;
    els.body.innerHTML = '<tr class="soa-msg-row"><td colspan="3">Loading...</td></tr>';
    updateTotal();

    try {
      const q = new URLSearchParams({ date_from: period.from, date_to: period.to });
      const data = await fetchJson(`/soa_fnb_hotel_history?${q}`);
      if (seq !== loadSeq) return;
      entries = (Array.isArray(data.entries) ? data.entries : []).map((e) => ({
        id: Number(e.id),
        soa_date: toIsoDateOnly(e.soa_date),
        category: e.category || '',
        amount: Number(e.amount) || 0,
        remarks: e.remarks || '',
        join_prev: Number(e.join_prev) === 1,
        sort_key: Number(e.sort_key) || Number(e.id)
      }));
      render();
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error('loadHistory soa:', err);
      els.body.innerHTML = '<tr class="soa-msg-row"><td colspan="3" class="text-danger">Unable to load SOA</td></tr>';
    }
  }

  async function refreshDashboardSoaTotal(dateFrom, dateTo) {
    if (typeof window.dashboardPeriodReload === 'function') {
      await window.dashboardPeriodReload();
      return;
    }

    const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    const data = await fetchJson(`/soa_fnb_hotel_total?${q}`);
    const total = Number(data.total || 0);

    if (els.dashSoaTotal) {
      els.dashSoaTotal.innerHTML = formatSignedHtml(total);
    }

    if (els.panel) {
      els.panel.dataset.serviceSettle = String(total);
      const rate = Number(els.panel.dataset.wlRate);
      const winLoss = Number(els.panel.dataset.winLoss) || 0;
      const companyExpense = Number(els.panel.dataset.companyExpense) || 0;
      const wlSettlement = Math.round(winLoss * ((Number.isFinite(rate) ? rate : 65) / 100));
      const wlEl = $('dash-wl-settlement');
      const casinoEl = $('dash-casino-total');
      const grandEl = $('dash-grand-total');
      if (wlEl) wlEl.innerHTML = formatSignedHtml(wlSettlement);
      if (casinoEl) casinoEl.innerHTML = formatSignedHtml(wlSettlement + total);
      if (grandEl) grandEl.innerHTML = formatSignedHtml(wlSettlement + total - companyExpense);
    }
  }

  async function deleteRow(tr) {
    const entry = entryById(tr?.dataset.id);
    if (!entry) return;

    if (window.Swal) {
      const result = await Swal.fire({
        title: 'Delete row?',
        text: `${entry.category || 'Line'} — ${formatAmount(entry.amount)}${entry.remarks ? ` (${entry.remarks})` : ''}`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#dc3545',
        focusConfirm: false
      });
      if (!result.isConfirmed) return;
    } else if (!window.confirm('Delete row?')) {
      return;
    }

    // Deleting the labelled row of an SOA: its next line keeps the label.
    const items = displayItems().filter((it) => it.kind === 'row');
    const at = items.findIndex((it) => it.entry === entry);
    const heir = entry.category && items[at + 1] && items[at + 1].entry.join_prev && !items[at + 1].entry.category
      ? items[at + 1].entry
      : null;

    await queueSave(async () => {
      try {
        if (heir) {
          const changes = { category: entry.category, join_prev: entry.join_prev ? 1 : 0 };
          await sendJson('/update_soa_fnb_hotel', 'PUT', entryPayload(heir, changes));
          heir.category = changes.category;
          heir.join_prev = !!changes.join_prev;
        }
        await sendJson('/delete_soa_fnb_hotel', 'DELETE', { id: entry.id });
        entries = entries.filter((e) => e !== entry);
        render();
        afterChange();
      } catch (err) {
        console.error('delete soa:', err);
        showError(err.message || 'Unable to delete SOA.');
      }
    });
  }

  // -------------------------
  // Copy image / Copy text
  // -------------------------
  function loadHtml2Canvas() {
    if (typeof window.html2canvas !== 'undefined') return Promise.resolve();
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HTML2CANVAS_SRC;
      script.onload = () => resolve();
      script.onerror = () => {
        html2canvasPromise = null;
        reject(new Error('Failed to load the image library.'));
      };
      document.head.appendChild(script);
    });
    return html2canvasPromise;
  }

  function copyUi(btn) {
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    return {
      ok(message) {
        if (window.Swal) Swal.fire({ icon: 'success', title: 'Copied!', text: message, timer: 1800, showConfirmButton: false });
      },
      fail(message) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Copy failed', text: message });
        else window.alert(message);
      },
      restore() {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    };
  }

  // In the captured copy: drop the editing bits and turn every cell into plain text.
  function prepareClone(doc) {
    const sheet = doc.getElementById('dash-soa-sheet');
    if (!sheet) return;
    sheet.querySelectorAll('.soa-new-row, .soa-draft-row, .soa-row-actions, .soa-sheet-close').forEach((el) => el.remove());
    sheet.querySelectorAll('.soa-cell').forEach((cellEl) => {
      const span = doc.createElement('span');
      span.className = 'soa-cell-text' + (cellEl.classList.contains('is-neg') ? ' is-neg' : '');
      span.textContent = cellEl.value;
      cellEl.replaceWith(span);
    });
  }

  function renderSheetBlob() {
    return loadHtml2Canvas()
      .then(() => window.html2canvas(els.sheet, {
        backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false, onclone: prepareClone
      }))
      .then((canvas) => new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not build the image.'))), 'image/png');
      }));
  }

  function copyImage() {
    const btn = els.copyImageBtn;
    if (!btn || btn.disabled || !els.sheet) return;
    const ui = copyUi(btn);
    if (navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
      navigator.clipboard.write([new window.ClipboardItem({ 'image/png': renderSheetBlob() })])
        .then(() => ui.ok('SOA image copied. You can paste it anywhere.'))
        .catch((err) => ui.fail((err && err.message) || 'Unable to copy the image.'))
        .finally(() => ui.restore());
      return;
    }
    renderSheetBlob()
      .then((blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'soa-fnb-hotel.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        ui.ok('SOA image downloaded.');
      })
      .catch((err) => ui.fail((err && err.message) || 'Unable to copy the image.'))
      .finally(() => ui.restore());
  }

  function buildSheetText() {
    const lines = ['SOA (F&B, HOTEL)', `Program Date: ${periodText()}`, '', 'SOA (F&B, HOTEL, INCIDENTAL)', ''];
    // One line per row: LABEL amount  remarks ("+" lines repeat their SOA's label),
    // with a blank line between SOAs (rows joined to the one above stay together).
    let label = '';
    sortedEntries().forEach((row, i) => {
      if (i > 0 && !row.join_prev) lines.push('');
      if (row.category || !row.join_prev || i === 0) label = row.category;
      lines.push(`${label.toUpperCase()} ${formatAmount(row.amount)}${row.remarks ? `  ${row.remarks}` : ''}`.trim());
    });
    lines.push('', `TOTAL: ${formatAmount(totalAmount())}`);
    return lines.join('\n');
  }

  function copyText() {
    const btn = els.copyTextBtn;
    if (!btn || btn.disabled) return;
    const ui = copyUi(btn);
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      ui.fail('Clipboard is not supported in this browser.');
      ui.restore();
      return;
    }
    navigator.clipboard.writeText(buildSheetText())
      .then(() => ui.ok('SOA text copied. You can paste it anywhere.'))
      .catch((err) => ui.fail((err && err.message) || 'Unable to copy the text.'))
      .finally(() => ui.restore());
  }

  // -------------------------
  // Open / wiring
  // -------------------------
  function showModal() {
    if (!els.modal || typeof bootstrap === 'undefined') return;
    const instance = bootstrap.Modal.getOrCreateInstance(els.modal, { focus: false });
    if (instance._config) instance._config.focus = false;
    instance.show();
  }

  async function openSoaModal() {
    const p = getDashboardPeriod();
    if (!p.from || !p.to) return;
    period = p;
    if (els.periodLabel) els.periodLabel.textContent = periodText();
    showModal();
    loadHtml2Canvas().catch(() => {});
    await loadHistory();
  }

  function bind() {
    cacheEls();
    if (!els.modal || !els.body) return;

    document.addEventListener('click', (e) => {
      const link = e.target.closest('.js-open-soa-fnb-hotel');
      if (!link) return;
      e.preventDefault();
      openSoaModal();
    });

    els.copyImageBtn?.addEventListener('click', copyImage);
    els.copyTextBtn?.addEventListener('click', copyText);

    els.body.addEventListener('input', (e) => {
      const el = e.target.closest('.soa-cell');
      if (!el) return;
      if (el.dataset.field === 'amount') {
        const clean = applyLiveAmount(el);
        el.classList.toggle('is-neg', isNegativeText(clean));
      }
      if (draft && el.closest('tr.soa-draft-row')) draft[el.dataset.field] = el.value;
      setInvalid(el, '');
    });

    els.body.addEventListener('focusin', (e) => {
      const el = e.target.closest('.soa-cell');
      if (el) el.select();
    });

    els.body.addEventListener('focusout', (e) => {
      if (rendering) return;
      const el = e.target.closest('.soa-cell');
      if (!el) return;
      const tr = el.closest('tr');
      if (tr.classList.contains('soa-draft-row')) {
        if (el.dataset.field === 'amount' && el.value.trim() && !Number.isNaN(parseAmount(el.value))) {
          el.value = formatAmount(parseAmount(el.value));
          draft.amount = el.value;
        }
        setTimeout(() => {
          if (!tr.isConnected || tr.contains(document.activeElement)) return;
          commitDraft(tr);
        }, 0);
        return;
      }
      if (tr.classList.contains('soa-new-row')) {
        if (el.dataset.field === 'amount' && el.value.trim() && !Number.isNaN(parseAmount(el.value))) {
          el.value = formatAmount(parseAmount(el.value));
        }
        // Save the new row once focus has left the whole row.
        setTimeout(() => {
          if (!tr.isConnected || tr.contains(document.activeElement)) return;
          commitNewRow(tr);
        }, 0);
        return;
      }
      commitCell(el);
    });

    els.body.addEventListener('keydown', async (e) => {
      const el = e.target.closest('.soa-cell');
      if (!el) return;
      const tr = el.closest('tr');
      const isNew = tr.classList.contains('soa-new-row');

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        revertCell(el);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (tr.classList.contains('soa-draft-row')) {
          const ok = await commitDraft(tr, 'new:category');
          if (!ok) focusCell(tr.querySelector('.soa-cell.is-invalid'));
          return;
        }
        if (isNew) {
          // Save, then start the next new entry.
          const ok = await commitNewRow(tr, 'new:category');
          if (!ok) focusCell(tr.querySelector('.soa-cell.is-invalid'));
          return;
        }
        const next = siblingCell(el, 1);
        if (next) focusCell(next);
        else el.blur();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const target = siblingCell(el, e.key === 'ArrowDown' ? 1 : -1);
        if (!target) return;
        e.preventDefault();
        focusCell(target);
      }
    });

    els.body.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.js-soa-add-line');
      if (addBtn) {
        e.preventDefault();
        addLineAfter(addBtn.closest('tr'));
        return;
      }
      const delBtn = e.target.closest('.js-soa-delete');
      if (!delBtn) return;
      e.preventDefault();
      deleteRow(delBtn.closest('tr'));
    });

    els.modal.addEventListener('hidden.bs.modal', () => {
      loadSeq++;
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
