(() => {
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

  function buildRollingRemarks(row) {
    const tags = [];
    if (Number(row.buy_in) > 0) tags.push('BI');
    if (Number(row.cash_out) > 0) tags.push('CO');
    if (Number(row.rolling) > 0) tags.push('R');
    return tags.join(',');
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

  function isoDateLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function buildNextMonthPreviewDates(dateToStr, count = 5) {
    const parts = String(dateToStr || '').split('-');
    if (parts.length !== 3) return [];
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return [];
    const start = new Date(y, m, 1);
    const dates = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(isoDateLocal(d));
    }
    return dates;
  }

  function renderRollingPreviewRows(dates) {
    return dates.map((date) => `
      <div class="dash-rolling-row is-preview" data-date="${escapeAttr(date)}">
        <span class="dash-rolling-body-cell is-date">${toDisplayDate(date)}</span>
        <span class="dash-rolling-body-cell is-col-casino"></span>
        <span class="dash-rolling-body-cell is-col-casino"></span>
        <span class="dash-rolling-body-cell is-col-casino"></span>
        <span class="dash-rolling-body-cell is-col-gold"></span>
        <span class="dash-rolling-body-cell is-col-remarks"></span>
      </div>`).join('');
  }

  function renderWlPreviewRows(dates) {
    return dates.map((date) => `
      <div class="dash-wl-row is-preview" data-date="${escapeAttr(date)}">
        <span class="dash-wl-body-cell is-date">${toDisplayDate(date)}</span>
        <span class="dash-wl-body-cell is-col-casino"></span>
        <span class="dash-wl-body-cell is-col-gold"></span>
        <span class="dash-wl-body-cell is-col-diff"></span>
        <span class="dash-wl-body-cell is-col-remarks"></span>
      </div>`).join('');
  }

  function renderRollingTable(payload) {
    const root = document.getElementById('dash-rolling-root');
    const foot = document.getElementById('dash-rolling-foot');
    const preview = document.getElementById('dash-rolling-preview');
    if (!root || !foot || !preview || !payload) return;

    const today = todayIso();
    const rows = payload.rolling_rows || [];
    const t = payload.totals || {};
    const previewDates = buildNextMonthPreviewDates(payload.date_to);

    const bodyHtml = rows.map((row) => {
      const cls = row.date === today ? 'dash-rolling-row is-today' : 'dash-rolling-row';
      return `<div class="${cls}" data-date="${escapeAttr(row.date)}">
        <span class="dash-rolling-body-cell is-date">${toDisplayDate(row.date)}</span>
        <span class="dash-rolling-body-cell is-col-casino">${escapeHtml(formatCell(row.buy_in))}</span>
        <span class="dash-rolling-body-cell is-col-casino text-dash-neg">${escapeHtml(formatCashOutCell(row.cash_out))}</span>
        <span class="dash-rolling-body-cell is-col-casino">${escapeHtml(formatCell(row.rolling))}</span>
        <span class="dash-rolling-body-cell is-col-gold">${escapeHtml(formatCell(row.beyond_chips))}</span>
        <span class="dash-rolling-body-cell is-col-remarks">${escapeHtml(buildRollingRemarks(row))}</span>
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

    preview.innerHTML = renderRollingPreviewRows(previewDates);

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

    const rollingPreviewRows = [...document.querySelectorAll('#dash-rolling-preview .dash-rolling-row.is-preview')];
    const wlPreviewRows = [...document.querySelectorAll('#dash-wl-preview .dash-wl-row.is-preview')];
    rollingPreviewRows.forEach((row) => { row.style.minHeight = ''; });
    wlPreviewRows.forEach((row) => { row.style.minHeight = ''; });
    const wlPreviewByDate = new Map(wlPreviewRows.map((row) => [row.dataset.date, row]));
    rollingPreviewRows.forEach((row) => {
      const wlRow = wlPreviewByDate.get(row.dataset.date);
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
    const preview = document.getElementById('dash-wl-preview');
    if (!root || !foot || !preview || !payload) return;

    const today = todayIso();
    const rows = payload.wl_rows || [];
    const previewDates = buildNextMonthPreviewDates(payload.date_to);

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
        <span class="dash-wl-body-cell is-col-remarks"></span>
      </div>`;
    }).join('');

    const t = payload.totals || {};
    const totalDiff = (Number(t.casino_wl) || 0) - (Number(t.gold_dragon_wl) || 0);

    root.innerHTML = `
      <div class="dash-wl-head-excel">
        <div class="dash-wl-head-cell is-date">Date</div>
        <div class="dash-wl-head-cell is-casino">Casino</div>
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

    preview.innerHTML = renderWlPreviewRows(previewDates);

    syncRollingTableLayout();
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

  function syncMatrixPanelHeight() {
    const ref = document.getElementById('dash-anticipated-panel');
    const panel = document.getElementById('dash-dual-matrix-panel');
    if (!ref || !panel) return;

    if (window.innerWidth < 1200) {
      panel.style.height = '';
      return;
    }

    panel.style.height = `${ref.offsetHeight}px`;
  }

  function initMatrixPanelHeightSync() {
    const ref = document.getElementById('dash-anticipated-panel');
    if (!ref) return;

    syncMatrixPanelHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => syncMatrixPanelHeight());
      ro.observe(ref);
    }

    window.addEventListener('resize', () => {
      syncMatrixPanelHeight();
      syncDualMatrixRowHeights();
    });
  }

  async function loadGridData() {
    const from = document.getElementById('dash-date-from')?.value || '';
    const to = document.getElementById('dash-date-to')?.value || '';
    const q = new URLSearchParams({ date_from: from, date_to: to });
    try {
      const res = await fetch(`/dashboard_grid_data?${q}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load grid data');
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
    loadGridData();
  });

  window.dashboardGridReload = loadGridData;
})();
