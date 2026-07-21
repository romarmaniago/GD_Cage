(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  const els = {};

  function cacheEls() {
    els.modal = $('modal-dash-soa-fnb-hotel');
    els.form = $('dash-soa-fnb-hotel-form');
    els.dateFrom = $('dash-soa-date-from');
    els.dateTo = $('dash-soa-date-to');
    els.category = $('dash-soa-category');
    els.amount = $('dash-soa-amount');
    els.remarks = $('dash-soa-remarks');
    els.programDate = $('dash-soa-program-date');
    els.saveBtn = $('btn-dash-soa-save');
    els.historyBody = $('dash-soa-history-body');
    els.historyTotal = $('dash-soa-history-total');
    els.historyTable = $('dash-soa-history-tbl');

    els.editModal = $('modal-dash-soa-fnb-hotel-edit');
    els.editForm = $('dash-soa-edit-form');
    els.editId = $('dash-soa-edit-id');
    els.editCategory = $('dash-soa-edit-category');
    els.editAmount = $('dash-soa-edit-amount');
    els.editRemarks = $('dash-soa-edit-remarks');
    els.editProgramDate = $('dash-soa-edit-program-date');

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

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function toIsoDateOnly(d) {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(d).trim())) return String(d).trim();
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatYmd(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayProgramDateValue() {
    return formatYmd(new Date());
  }

  function getProgramDateValue(el) {
    if (!el) return '';
    if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates[0]) {
      return formatYmd(el._flatpickr.selectedDates[0]);
    }
    const manual = parseManualDate(el.value);
    if (manual) return manual;
    return String(el.value || '').trim().slice(0, 10);
  }

  function ensureProgramDatePicker(el, defaultDate) {
    if (!el) return;
    const dateVal = defaultDate || getProgramDateValue(el) || todayProgramDateValue();
    if (typeof flatpickr === 'undefined') {
      el.value = dateVal;
      return;
    }
    if (el._flatpickr) {
      try { el._flatpickr.destroy(); } catch (e) { /* ignore */ }
    }
    flatpickr(el, {
      enableTime: false,
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'M j, Y',
      defaultDate: dateVal,
      allowInput: true,
      disableMobile: true,
      closeOnSelect: true
    });
  }

  function focusProgramDateInput(el) {
    if (!el) return;
    const target = el._flatpickr && el._flatpickr.altInput ? el._flatpickr.altInput : el;
    target.focus();
  }

  function parseManualDate(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';

    const match = text.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]);
      const d = Number(match[3]);
      const dt = new Date(y, m - 1, d);
      if (
        Number.isNaN(dt.getTime()) ||
        dt.getFullYear() !== y ||
        dt.getMonth() !== m - 1 ||
        dt.getDate() !== d
      ) {
        return '';
      }
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.toApiDate === 'function') {
      const api = window.MonthEndCutoffRange.toApiDate(text);
      if (api) return String(api).slice(0, 10);
    }

    return '';
  }

  function formatDateDisplay(iso) {
    const match = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return escapeHtml(iso || '—');
    return `${match[1]}/${match[2]}/${match[3]}`;
  }

  function formatDateInput(iso) {
    const match = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    return `${match[1]}/${match[2]}/${match[3]}`;
  }

  function formatAmountInput(value) {
    const cleaned = String(value ?? '').replace(/[^\d]/g, '');
    if (!cleaned) return '';
    return Number(cleaned).toLocaleString('en-US');
  }

  function parseAmount(raw) {
    const cleaned = String(raw ?? '').replace(/,/g, '').trim();
    if (cleaned === '' || cleaned === '-') return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatAmtHtml(n) {
    const v = Math.round(Number(n) || 0);
    const abs = Math.abs(v).toLocaleString('en-US');
    return `<span class="text-dash-neg">(${abs})</span>`;
  }

  function setHistoryTotal(total) {
    if (!els.historyTotal) return;
    els.historyTotal.innerHTML = formatAmtHtml(total);
  }

  function getDashboardPeriod() {
    const from = els.dashDateFrom?.value ? toIsoDateOnly(els.dashDateFrom.value) : '';
    const to = els.dashDateTo?.value ? toIsoDateOnly(els.dashDateTo.value) : '';
    return { from, to };
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed.');
    return data;
  }

  function renderRemarksCell(row) {
    const remarks = row.remarks != null ? String(row.remarks) : '';
    if (window.RemarksEditor) {
      return window.RemarksEditor.renderCell(remarks, {
        source: 'soa_fnb_hotel',
        recordId: row.id
      });
    }
    return remarks
      ? `<span class="text-break">${escapeHtml(remarks)}</span>`
      : '<span class="text-muted">—</span>';
  }

  function clearAddForm() {
    if (els.category) els.category.value = '';
    if (els.amount) els.amount.value = '';
    if (els.remarks) els.remarks.value = '';
    ensureProgramDatePicker(els.programDate, todayProgramDateValue());
  }

  async function loadHistory(dateFrom, dateTo) {
    if (!els.historyBody) return;
    els.historyBody.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-3">Loading...</td></tr>';
    setHistoryTotal(0);

    try {
      const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const data = await fetchJson(`/soa_fnb_hotel_history?${q}`);
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const total = Number(data.total || 0);

      if (!entries.length) {
        els.historyBody.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-3">No entries for this period</td></tr>';
        setHistoryTotal(0);
        return;
      }

      els.historyBody.innerHTML = entries.map((row) => {
        const category = row.category || '—';
        const programDate = formatDateDisplay(row.soa_date || '');
        return `
          <tr>
            <td class="soa-col-program-date">${programDate}</td>
            <td class="soa-col-category">${escapeHtml(category)}</td>
            <td class="soa-col-amount text-end">${formatAmtHtml(row.amount)}</td>
            <td class="soa-col-remarks remarks-editor-td">${renderRemarksCell(row)}</td>
            <td class="soa-col-action text-center">
              <div class="d-inline-flex gap-1">
                <button type="button" class="btn btn-sm btn-outline-primary js-soa-edit"
                  data-id="${escapeAttr(row.id)}"
                  data-category="${escapeAttr(row.category || '')}"
                  data-amount="${escapeAttr(row.amount)}"
                  data-remarks="${escapeAttr(row.remarks || '')}"
                  data-date="${escapeAttr(row.soa_date || '')}"
                  title="Edit" aria-label="Edit">
                  <i class="fa fa-pencil-alt" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger js-soa-delete" data-id="${escapeAttr(row.id)}" title="Delete" aria-label="Delete">
                  <i class="fa fa-trash-alt" aria-hidden="true"></i>
                </button>
              </div>
            </td>
          </tr>`;
      }).join('');
      setHistoryTotal(total);
    } catch (err) {
      console.error('loadHistory soa:', err);
      els.historyBody.innerHTML = '<tr><td colspan="5" class="text-danger text-center py-3">Unable to load history</td></tr>';
      setHistoryTotal(0);
    }
  }

  async function refreshDashboardSoaTotal(dateFrom, dateTo) {
    const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    const data = await fetchJson(`/soa_fnb_hotel_total?${q}`);
    const total = Number(data.total || 0);

    if (els.dashSoaTotal) {
      els.dashSoaTotal.innerHTML = formatAmtHtml(total);
    }

    if (els.panel) {
      els.panel.dataset.serviceSettle = String(total);
      const rate = Number(els.panel.dataset.wlRate);
      const winLoss = Number(els.panel.dataset.winLoss) || 0;
      const companyExpense = Number(els.panel.dataset.companyExpense) || 0;
      const wlSettlement = Math.round(winLoss * ((Number.isFinite(rate) ? rate : 65) / 100));
      const casinoTotal = wlSettlement - total;
      const grandTotal = wlSettlement - total - companyExpense;
      const wlEl = $('dash-wl-settlement');
      const casinoEl = $('dash-casino-total');
      const grandEl = $('dash-grand-total');
      if (wlEl) wlEl.innerHTML = (function () {
        const v = Math.round(wlSettlement);
        return v < 0 ? `<span class="text-dash-neg">(${Math.abs(v).toLocaleString('en-US')})</span>` : v.toLocaleString('en-US');
      })();
      if (casinoEl) casinoEl.innerHTML = (function () {
        const v = Math.round(casinoTotal);
        return v < 0 ? `<span class="text-dash-neg">(${Math.abs(v).toLocaleString('en-US')})</span>` : v.toLocaleString('en-US');
      })();
      if (grandEl) grandEl.innerHTML = (function () {
        const v = Math.round(grandTotal);
        return v < 0 ? `<span class="text-dash-neg">(${Math.abs(v).toLocaleString('en-US')})</span>` : v.toLocaleString('en-US');
      })();
    }
  }

  async function saveSoa(category, amount, remarks, programDate) {
    const res = await fetch('/add_soa_fnb_hotel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ category, amount, remarks, soa_date: programDate })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to save SOA.');
  }

  async function updateSoaEntry(id, category, amount, remarks, programDate) {
    const res = await fetch('/update_soa_fnb_hotel', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id, category, amount, remarks, soa_date: programDate })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to update SOA.');
  }

  async function deleteSoaEntry(id) {
    const res = await fetch('/delete_soa_fnb_hotel', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to delete SOA.');
  }

  function showModal() {
    if (!els.modal || typeof bootstrap === 'undefined') return;
    const instance = bootstrap.Modal.getOrCreateInstance(els.modal, { focus: false });
    if (instance._config) instance._config.focus = false;
    instance.show();
  }

  function showEditModal(row) {
    if (!els.editModal || typeof bootstrap === 'undefined') return;
    els.editId.value = String(row.id || '');
    if (els.editCategory) els.editCategory.value = row.category || '';
    if (els.editAmount) els.editAmount.value = formatAmountInput(Math.round(Number(row.amount) || 0));
    if (els.editRemarks) els.editRemarks.value = row.remarks || '';
    ensureProgramDatePicker(els.editProgramDate, toIsoDateOnly(row.soaDate || '') || todayProgramDateValue());
    const instance = bootstrap.Modal.getOrCreateInstance(els.editModal);
    instance.show();
    els.editModal.addEventListener('shown.bs.modal', () => focusProgramDateInput(els.editProgramDate), { once: true });
  }

  async function openSoaModal() {
    const period = getDashboardPeriod();
    if (!period.from || !period.to) return;

    if (els.dateFrom) els.dateFrom.value = period.from;
    if (els.dateTo) els.dateTo.value = period.to;
    clearAddForm();

    showModal();
    await loadHistory(period.from, period.to);
    els.modal?.addEventListener('shown.bs.modal', () => focusProgramDateInput(els.programDate), { once: true });
  }

  function bind() {
    cacheEls();
    if (!els.form || !els.modal) return;

    [els.remarks, els.editRemarks].forEach((el) => {
      if (!el) return;
      el.removeAttribute('readonly');
      el.removeAttribute('disabled');
      if (el.tagName === 'INPUT') {
        el.type = 'text';
        el.removeAttribute('inputmode');
      }
    });

    els.modal?.addEventListener('show.bs.modal', () => {
      ensureProgramDatePicker(els.programDate, todayProgramDateValue());
    });

    els.editModal?.addEventListener('show.bs.modal', () => {
      if (els.editProgramDate && !els.editId?.value) {
        ensureProgramDatePicker(els.editProgramDate, todayProgramDateValue());
      }
    });

    document.addEventListener('click', (e) => {
      const link = e.target.closest('.js-open-soa-fnb-hotel');
      if (!link) return;
      e.preventDefault();
      openSoaModal();
    });

    els.amount?.addEventListener('input', (e) => {
      e.target.value = formatAmountInput(e.target.value);
    });

    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dateFrom = els.dateFrom?.value || '';
      const dateTo = els.dateTo?.value || '';
      const category = String(els.category?.value || '').trim();
      const amount = parseAmount(els.amount?.value);
      const remarks = String(els.remarks?.value || '').trim();
      const programDate = getProgramDateValue(els.programDate);
      const saveBtn = els.saveBtn || els.form.querySelector('[type="submit"]');

      if (!category) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter SOA.' });
        return;
      }
      if (Number.isNaN(amount) || amount === 0) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount.' });
        return;
      }
      if (!programDate) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please select a valid program date.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        await saveSoa(category, amount, remarks, programDate);
        clearAddForm();
        await Promise.all([
          loadHistory(dateFrom, dateTo),
          refreshDashboardSoaTotal(dateFrom, dateTo)
        ]);
        if (window.Swal) Swal.fire({ icon: 'success', title: 'Saved', timer: 900, showConfirmButton: false });
        focusProgramDateInput(els.programDate);
      } catch (err) {
        console.error('save soa:', err);
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to save SOA.' });
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });

    els.historyTable?.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.js-soa-edit');
      if (editBtn) {
        e.preventDefault();
        showEditModal({
          id: editBtn.dataset.id,
          category: editBtn.dataset.category,
          amount: editBtn.dataset.amount,
          remarks: editBtn.dataset.remarks,
          soaDate: editBtn.dataset.date
        });
        return;
      }

      const delBtn = e.target.closest('.js-soa-delete');
      if (!delBtn) return;
      e.preventDefault();
      const id = delBtn.dataset.id;
      const dateFrom = els.dateFrom?.value || '';
      const dateTo = els.dateTo?.value || '';

      if (window.Swal) {
        const result = await Swal.fire({
          title: 'Delete entry?',
          text: 'This SOA entry will be removed.',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Delete',
          cancelButtonText: 'Cancel',
          confirmButtonColor: '#dc3545',
          focusConfirm: false
        });
        if (!result.isConfirmed) return;
      } else if (!window.confirm('Delete entry?')) {
        return;
      }

      try {
        await deleteSoaEntry(id);
        await Promise.all([
          loadHistory(dateFrom, dateTo),
          refreshDashboardSoaTotal(dateFrom, dateTo)
        ]);
        if (window.Swal) Swal.fire({ icon: 'success', title: 'Deleted', timer: 900, showConfirmButton: false });
      } catch (err) {
        console.error('delete soa:', err);
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to delete SOA.' });
      }
    });

    els.editAmount?.addEventListener('input', (e) => {
      e.target.value = formatAmountInput(e.target.value);
    });

    els.editForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = els.editId?.value || '';
      const category = String(els.editCategory?.value || '').trim();
      const amount = parseAmount(els.editAmount?.value);
      const remarks = String(els.editRemarks?.value || '').trim();
      const programDate = getProgramDateValue(els.editProgramDate);
      const saveBtn = els.editForm.querySelector('[type="submit"]');
      const dateFrom = els.dateFrom?.value || '';
      const dateTo = els.dateTo?.value || '';

      if (!id) return;
      if (!category) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter SOA.' });
        return;
      }
      if (Number.isNaN(amount) || amount === 0) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount.' });
        return;
      }
      if (!programDate) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please select a valid program date.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        await updateSoaEntry(id, category, amount, remarks, programDate);
        if (els.editModal && typeof bootstrap !== 'undefined') {
          bootstrap.Modal.getOrCreateInstance(els.editModal).hide();
        }
        await Promise.all([
          loadHistory(dateFrom, dateTo),
          refreshDashboardSoaTotal(dateFrom, dateTo)
        ]);
        if (window.Swal) Swal.fire({ icon: 'success', title: 'Updated', timer: 900, showConfirmButton: false });
      } catch (err) {
        console.error('update soa:', err);
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Unable to update SOA.' });
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
