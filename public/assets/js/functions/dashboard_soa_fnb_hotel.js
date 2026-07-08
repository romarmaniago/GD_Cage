(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  const els = {};

  function cacheEls() {
    els.modal = $('modal-dash-soa-fnb-hotel');
    els.form = $('dash-soa-fnb-hotel-form');
    els.periodLabel = $('dash-soa-period-label');
    els.dateFrom = $('dash-soa-date-from');
    els.dateTo = $('dash-soa-date-to');
    els.amount = $('dash-soa-amount');
    els.historyBody = $('dash-soa-history-body');
    els.historyTable = $('dash-soa-history-tbl');

    els.editModal = $('modal-dash-soa-fnb-hotel-edit');
    els.editForm = $('dash-soa-edit-form');
    els.editId = $('dash-soa-edit-id');
    els.editAmount = $('dash-soa-edit-amount');

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
    const parts = String(d).split('-');
    if (parts.length === 3) return d;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
    // SOA is shown as negative on the dashboard card.
    const abs = Math.abs(v).toLocaleString('en-US');
    return `<span class="text-dash-neg">(${abs})</span>`;
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

  async function loadHistory(dateFrom, dateTo) {
    if (!els.historyBody) return;
    els.historyBody.innerHTML = '<tr><td colspan="3" class="text-muted text-center py-3">Loading...</td></tr>';

    try {
      const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const data = await fetchJson(`/soa_fnb_hotel_history?${q}`);
      const entries = Array.isArray(data.entries) ? data.entries : [];

      if (!entries.length) {
        els.historyBody.innerHTML = '<tr><td colspan="3" class="text-muted text-center py-3">No entries for this period</td></tr>';
        return;
      }

      els.historyBody.innerHTML = entries.map((row) => {
        const dateTxt = row.soa_date || (row.encoded_dt || '—');
        return `
          <tr>
            <td>${escapeHtml(dateTxt)}</td>
            <td class="text-end">${escapeHtml(Number(row.amount || 0).toLocaleString('en-US'))}</td>
            <td class="text-center">
              <div class="text-center">
                <button type="button" class="btn btn-sm btn-outline-primary js-soa-edit me-1" data-id="${escapeAttr(row.id)}" data-amount="${escapeAttr(row.amount)}" title="Edit" aria-label="Edit">
                  <i class="fa fa-pencil-alt" aria-hidden="true"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger js-soa-delete" data-id="${escapeAttr(row.id)}" title="Delete" aria-label="Delete">
                  <i class="fa fa-trash-alt" aria-hidden="true"></i>
                </button>
              </div>
            </td>
          </tr>`;
      }).join('');
    } catch (err) {
      console.error('loadHistory soa:', err);
      els.historyBody.innerHTML = '<tr><td colspan="3" class="text-danger text-center py-3">Unable to load history</td></tr>';
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
      // Recompute anticipated totals using current WL rate.
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

  async function saveSoa(soaDate, amount) {
    const res = await fetch('/add_soa_fnb_hotel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ soa_date: soaDate, amount })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to save SOA.');
  }

  async function updateSoaEntry(id, amount) {
    const res = await fetch('/update_soa_fnb_hotel', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id, amount })
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

  function showEditModal(id, amount) {
    if (!els.editModal || typeof bootstrap === 'undefined') return;
    els.editId.value = String(id || '');
    els.editAmount.value = formatAmountInput(Math.round(Number(amount) || 0));
    const instance = bootstrap.Modal.getOrCreateInstance(els.editModal);
    instance.show();
    els.editModal.addEventListener('shown.bs.modal', () => els.editAmount?.focus(), { once: true });
  }

  async function openSoaModal() {
    const period = getDashboardPeriod();
    if (!period.from || !period.to) return;

    if (els.dateFrom) els.dateFrom.value = period.from;
    if (els.dateTo) els.dateTo.value = period.to;
    if (els.periodLabel) {
      els.periodLabel.value = `${period.from} to ${period.to}`;
    }
    if (els.amount) els.amount.value = '';

    showModal();
    await loadHistory(period.from, period.to);
    els.modal?.addEventListener('shown.bs.modal', () => els.amount?.focus(), { once: true });
  }

  function bind() {
    cacheEls();
    if (!els.form || !els.modal) return;

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
      const amount = parseAmount(els.amount?.value);
      const saveBtn = els.form.querySelector('[type="submit"]');

      if (!dateTo) return;
      if (Number.isNaN(amount) || amount === 0) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        // We store the SOA under the period end-date to represent the settlement for this period.
        await saveSoa(dateTo, amount);
        if (els.amount) els.amount.value = '';
        await Promise.all([
          loadHistory(dateFrom, dateTo),
          refreshDashboardSoaTotal(dateFrom, dateTo)
        ]);
        if (window.Swal) Swal.fire({ icon: 'success', title: 'Saved', timer: 900, showConfirmButton: false });
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
        showEditModal(editBtn.dataset.id, editBtn.dataset.amount);
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
      const amount = parseAmount(els.editAmount?.value);
      const saveBtn = els.editForm.querySelector('[type="submit"]');
      const dateFrom = els.dateFrom?.value || '';
      const dateTo = els.dateTo?.value || '';

      if (!id) return;
      if (Number.isNaN(amount) || amount === 0) {
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        await updateSoaEntry(id, amount);
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

