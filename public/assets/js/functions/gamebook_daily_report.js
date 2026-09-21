(() => {
  const modalEl = document.getElementById('modal-dash-gamebook-report');
  const triggerBtn = document.getElementById('btn-dash-daily-report');
  const monthFilterSelect = document.getElementById('gamebook-daily-report-month-filter');
  const tbody = document.getElementById('gamebook-daily-report-tbody');
  const tfoot = document.getElementById('gamebook-daily-report-tfoot');
  const btnPrint = document.getElementById('btn-print-gamebook-daily-report');
  const btnExport = document.getElementById('btn-export-gamebook-daily-report');
  const sideDateInput = document.getElementById('gamebook-daily-report-side-date');
  const btnCopySide = document.getElementById('btn-copy-gamebook-daily-report-side');

  if (!modalEl || !tbody || !tfoot) return;

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  let currentRange = null;
  let currentRows = [];
  let monthFilterInitialized = false;
  let currentSideDate = null;
  let sideDatePickerInitialized = false;
  let sideRequestGeneration = 0;

  // flatpickr's popup is appended to document.body (to escape this card's own
  // overflow:hidden, used for its rounded corners) — that puts it outside the
  // modal's DOM subtree, so Bootstrap's focus trap yanks focus back into the
  // modal on every click inside it before the day-cell click can register.
  // Deactivating the trap and letting focus land in `.flatpickr-calendar`
  // through unopposed is the same fix used for the Change Status cutoff date
  // picker in game_list.js.
  function allowSideDateCalendarFocus(e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('.flatpickr-calendar')) {
      e.stopImmediatePropagation();
    }
  }

  function releaseSideDateFocusTrap() {
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
    const instance = bootstrap.Modal.getInstance(modalEl) ||
      bootstrap.Modal.getOrCreateInstance(modalEl, { focus: false });
    if (instance) {
      if (instance._config) instance._config.focus = false;
      if (instance._focustrap && typeof instance._focustrap.deactivate === 'function') {
        instance._focustrap.deactivate();
      }
    }
    window.removeEventListener('focusin', allowSideDateCalendarFocus, true);
    window.addEventListener('focusin', allowSideDateCalendarFocus, true);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Month-end cut-off period (start = last day of previous month, end = 2nd-to-last
  // day of the picked month) — same convention as the dashboard's own Rolling Check
  // month filter, via the shared window.MonthEndCutoffRange helper.
  function cutoffMonthRange(year, monthIndex) {
    const refDate = new Date(year, monthIndex, 15);
    if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function') {
      const range = window.MonthEndCutoffRange.getMonthEndCutoffRange(refDate);
      return { from: range.startDate, to: range.endDate };
    }
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return { from: `${year}-${pad2(monthIndex + 1)}-01`, to: `${year}-${pad2(monthIndex + 1)}-${pad2(lastDay)}` };
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function fmtMd(ymd) {
    const parts = String(ymd || '').split('-');
    if (parts.length !== 3) return ymd;
    return `${Number(parts[1])}/${Number(parts[2])}`;
  }

  function fmtNum(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString('en-US');
  }

  function fmtAmountCell(n) {
    const v = Math.round(Number(n) || 0);
    if (v === 0) return '0';
    if (v < 0) return `<span class="gdr-negative">(${Math.abs(v).toLocaleString('en-US')})</span>`;
    return v.toLocaleString('en-US');
  }

  function fmtCashOutCell(n) {
    const v = Math.round(Number(n) || 0);
    if (v === 0) return '0';
    return `<span class="gdr-negative">(${Math.abs(v).toLocaleString('en-US')})</span>`;
  }

  function defaultRange() {
    const from = (triggerBtn && triggerBtn.dataset.reportFrom) || '';
    const to = (triggerBtn && triggerBtn.dataset.reportTo) || '';
    if (from && to) return { from, to };
    const now = new Date();
    const first = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
    return { from: first, to: todayIso() };
  }

  function renderRows(rows, totals) {
    currentRows = Array.isArray(rows) ? rows : [];
    const today = todayIso();

    if (!currentRows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No data for this range.</td></tr>';
      tfoot.innerHTML = '';
      return;
    }

    tbody.innerHTML = currentRows.map((r) => {
      const isToday = r.program_date === today;
      return `<tr class="${isToday ? 'gdr-today' : ''}" data-date="${r.program_date}">
        <td class="gdr-date-col">${fmtMd(r.program_date)}</td>
        <td class="gdr-num-col">${fmtNum(r.game_count)}</td>
        <td class="gdr-amount-col">${fmtNum(r.buy_in)}</td>
        <td class="gdr-amount-col">${fmtCashOutCell(r.cash_out)}</td>
        <td class="gdr-amount-col">${fmtAmountCell(r.win_loss)}</td>
        <td class="gdr-amount-col">${fmtNum(r.rolling)}</td>
      </tr>`;
    }).join('');

    const t = totals || { game_count: 0, buy_in: 0, cash_out: 0, win_loss: 0, rolling: 0 };
    tfoot.innerHTML = `<tr>
      <th class="gdr-date-col">TOTAL</th>
      <th class="gdr-num-col">${fmtNum(t.game_count)}</th>
      <th class="gdr-amount-col">${fmtNum(t.buy_in)}</th>
      <th class="gdr-amount-col">${fmtCashOutCell(t.cash_out)}</th>
      <th class="gdr-amount-col">${fmtAmountCell(t.win_loss)}</th>
      <th class="gdr-amount-col">${fmtNum(t.rolling)}</th>
    </tr>`;
  }

  async function loadReport(from, to) {
    currentRange = { from, to };
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading...</td></tr>';
    tfoot.innerHTML = '';
    try {
      const res = await fetch(`/gamebook_daily_report_data?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        credentials: 'same-origin'
      });
      if (!res.ok) throw new Error('Failed to load report');
      const data = await res.json();
      renderRows(data.rows || [], data.totals || null);
    } catch (err) {
      console.error('gamebook_daily_report loadReport:', err);
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Unable to load report.</td></tr>';
    }
  }

  function initMonthFilter() {
    if (!monthFilterSelect || monthFilterInitialized) return;
    monthFilterInitialized = true;

    const range = defaultRange();
    const anchor = new Date(`${range.to}T00:00:00`);
    const currentValue = `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}`;

    const options = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      options.push(`<option value="${value}">${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}</option>`);
    }
    monthFilterSelect.innerHTML = options.join('');
    if (options.some((o) => o.indexOf(`value="${currentValue}"`) !== -1)) {
      monthFilterSelect.value = currentValue;
    }

    monthFilterSelect.addEventListener('change', () => {
      const parts = monthFilterSelect.value.split('-').map(Number);
      if (parts.length !== 2 || !parts[0] || !parts[1]) return;
      const monthRange = cutoffMonthRange(parts[0], parts[1] - 1);
      loadReport(monthRange.from, monthRange.to);
    });
  }

  // Summary side card — amount only turns red (with parentheses) when negative
  // (W/L, Rolling, Settlement rows). Reuses the dashboard's own .text-dash-neg class
  // (public/assets/css/dashboard_grid.css) so negatives match "Current Time W/L".
  function fmtSideAmt(n) {
    const v = Math.round(Number(n) || 0);
    if (v < 0) return `<span class="text-dash-neg">(${Math.abs(v).toLocaleString('en-US')})</span>`;
    return v.toLocaleString('en-US');
  }

  // Always shown red (with parentheses) when non-zero — Expenses, matching the
  // dashboard's own fmtNeg() convention (views/dashboard.ejs) for the same figure.
  function fmtSideNeg(n) {
    const v = Math.round(Number(n) || 0);
    if (!v) return '0';
    return `<span class="text-dash-neg">(${Math.abs(v).toLocaleString('en-US')})</span>`;
  }

  function setSideCell(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function renderSideSummary(summary) {
    const today = (summary && summary.today) || {};
    const total = (summary && summary.total) || {};
    setSideCell('gdrs-wl-today', fmtSideAmt(today.win_loss));
    setSideCell('gdrs-wl-total', fmtSideAmt(total.win_loss));
    setSideCell('gdrs-rolling-today', fmtSideAmt(today.rolling));
    setSideCell('gdrs-rolling-total', fmtSideAmt(total.rolling));
    setSideCell('gdrs-expenses-today', fmtSideNeg(today.expenses));
    setSideCell('gdrs-expenses-total', fmtSideNeg(total.expenses));
    setSideCell('gdrs-commission-today', fmtSideNeg(today.settlement_commission));
    setSideCell('gdrs-commission-total', fmtSideNeg(total.settlement_commission));
    setSideCell('gdrs-additional-today', fmtSideNeg(today.settlement_additional));
    setSideCell('gdrs-additional-total', fmtSideNeg(total.settlement_additional));
  }

  function loadSideSummary(dateStr) {
    if (!sideDateInput) return;
    currentSideDate = dateStr;
    const gen = ++sideRequestGeneration;
    fetch(`/gamebook_daily_report_side_data?date=${encodeURIComponent(dateStr)}`, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load side report');
        return res.json();
      })
      .then((data) => {
        if (gen !== sideRequestGeneration) return;
        renderSideSummary(data);
      })
      .catch((err) => {
        console.error('gamebook_daily_report_side loadSideSummary:', err);
      });
  }

  function initSideDatePicker() {
    if (!sideDateInput || sideDatePickerInitialized) return;
    sideDatePickerInitialized = true;
    // Actual today — NOT defaultRange().to (that's the dashboard's cutoff-period end
    // date, e.g. 9/29, used to seed the table's month filter; the side card's "Today"
    // column means the real current date).
    const initialYmd = currentSideDate || todayIso();
    sideDateInput.value = initialYmd;

    if (typeof flatpickr === 'undefined') {
      sideDateInput.addEventListener('change', () => {
        const ymd = sideDateInput.value;
        if (!isValidSideDate(ymd)) return;
        loadSideSummary(ymd);
      });
      return;
    }

    // altInputClass reuses the .gdrs-date-input styling (centering/font/color) on the
    // visible text field flatpickr swaps in, while sideDateInput itself stays hidden
    // and keeps holding the plain Y-m-d value everything else in this file reads.
    flatpickr(sideDateInput, {
      dateFormat: 'Y-m-d',
      altInput: true,
      altInputClass: 'gdrs-date-input',
      altFormat: 'm/d/Y',
      allowInput: false,
      disableMobile: true,
      closeOnSelect: true,
      defaultDate: initialYmd,
      appendTo: document.body,
      onOpen: releaseSideDateFocusTrap,
      onChange: (_selectedDates, dateStr) => {
        if (!isValidSideDate(dateStr)) return;
        loadSideSummary(dateStr);
      }
    });
  }

  function isValidSideDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  modalEl.addEventListener('show.bs.modal', () => {
    initMonthFilter();
    const range = currentRange || defaultRange();
    loadReport(range.from, range.to);

    initSideDatePicker();
    loadSideSummary(currentSideDate || todayIso());
  });

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getExportPayload() {
    const headers = ['Date', 'Number Of Games', 'Buy In', 'Cash Out', 'Win / Lose', 'Rolling'];
    const rows = currentRows.map((r) => [
      fmtMd(r.program_date),
      fmtNum(r.game_count),
      fmtNum(r.buy_in),
      fmtNum(r.cash_out),
      fmtNum(r.win_loss),
      fmtNum(r.rolling)
    ]);
    return { headers, rows };
  }

  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      if (!currentRows.length) {
        if (window.Swal) Swal.fire({ icon: 'info', title: 'Export', text: 'No data to export for the current view.' });
        return;
      }
      const { headers, rows } = getExportPayload();
      const range = currentRange || defaultRange();
      const filename = `DailyReport_${range.from}_${range.to}.xlsx`;
      btnExport.disabled = true;
      try {
        const res = await fetch('/daily_report_matrix/export_xlsx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ headers, rows, filename, sheetName: 'Daily Report' })
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
        console.error('gamebook_daily_report export:', err);
        if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Export failed.' });
      } finally {
        btnExport.disabled = false;
      }
    });
  }

  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      if (!currentRows.length) {
        if (window.Swal) Swal.fire({ icon: 'info', title: 'Print', text: 'No data to print for the current view.' });
        return;
      }
      const { headers, rows } = getExportPayload();
      const range = currentRange || defaultRange();
      const headerHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
      const rowsHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
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
        '<!doctype html><html><head><title>Daily Report</title><style>',
        '@page{size:portrait;margin:8mm;}',
        'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
        '.print-wrap{width:100%;}',
        'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
        '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
        'table{width:100%;border-collapse:collapse;font-size:11px;}',
        'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;}',
        'th{text-align:center;background:#d9b96a;color:#3a2e12;font-weight:700;}',
        'td{text-align:right;color:#444;}',
        'td:first-child,th:first-child{text-align:left;}',
        '</style></head><body><div class="print-wrap">',
        '<h2>Daily Report</h2>',
        `<div class="subtitle">${escapeHtml(fmtMd(range.from))} to ${escapeHtml(fmtMd(range.to))}</div>`,
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
    });
  }

  // Side card "Copy" — render it to a PNG and copy to clipboard, same technique as
  // the dashboard's own copy-image buttons (public/assets/js/functions/dashboard_copy_image.js).
  const HTML2CANVAS_SRC = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  let html2canvasPromise = null;

  function loadHtml2Canvas() {
    if (typeof html2canvas !== 'undefined') return Promise.resolve();
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

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not build the image.'));
      }, 'image/png');
    });
  }

  function renderSideCardBlob() {
    const card = document.querySelector('.gamebook-daily-report-side-card');
    if (!card) return Promise.reject(new Error('Daily Report card not found.'));
    return loadHtml2Canvas()
      .then(() => html2canvas(card, {
        backgroundColor: '#fff',
        scale: 2,
        useCORS: true,
        logging: false,
        onclone: (doc) => {
          const footer = doc.querySelector('.gdrs-footer');
          if (footer) footer.style.display = 'none';
        }
      }))
      .then(canvasToBlob);
  }

  if (btnCopySide) {
    btnCopySide.addEventListener('click', () => {
      if (btnCopySide.disabled) return;
      const originalHtml = btnCopySide.innerHTML;
      btnCopySide.disabled = true;
      btnCopySide.innerHTML = '<i class="fa fa-spinner fa-spin" aria-hidden="true"></i><span>Copying...</span>';
      const restore = () => { btnCopySide.disabled = false; btnCopySide.innerHTML = originalHtml; };
      const notifyOk = (text) => { if (window.Swal) Swal.fire({ icon: 'success', title: 'Copied', text, timer: 1800, showConfirmButton: false }); };
      const notifyErr = (text) => { if (window.Swal) Swal.fire({ icon: 'error', title: 'Copy failed', text }); else window.alert(text); };

      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': renderSideCardBlob() })])
          .then(() => notifyOk('Daily Report image copied. Paste it anywhere.'))
          .catch((err) => notifyErr((err && err.message) || 'Unable to copy the image.'))
          .finally(restore);
      } else {
        renderSideCardBlob()
          .then((blob) => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'daily-report-summary.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            notifyOk('Image downloaded.');
          })
          .catch((err) => notifyErr((err && err.message) || 'Unable to copy the image.'))
          .finally(restore);
      }
    });
  }
})();
