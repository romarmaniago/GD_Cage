(() => {
  let goldTableId = null;

  const beyondChipsEls = {};

  function cacheBeyondChipsEls() {
    beyondChipsEls.modal = document.getElementById('modal-dash-beyond-chips');
    beyondChipsEls.form = document.getElementById('dash-beyond-chips-form');
    beyondChipsEls.dateLabel = document.getElementById('dash-beyond-chips-date');
    beyondChipsEls.dateIso = document.getElementById('dash-beyond-chips-date-iso');
    beyondChipsEls.amount = document.getElementById('dash-beyond-chips-amount');
  }

  function parseBeyondChipsInput(raw) {
    const cleaned = String(raw ?? '').replace(/,/g, '').trim();
    if (cleaned === '' || cleaned === '-') return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function openBeyondChipsModal(date, amount) {
    const { modal, dateLabel, dateIso, amount: amountInput } = beyondChipsEls;
    if (!modal || !dateLabel || !dateIso || !amountInput || typeof bootstrap === 'undefined') return;

    dateLabel.textContent = toDisplayDate(date);
    dateIso.value = date;
    const n = Number(amount) || 0;
    amountInput.value = n === 0 ? '' : String(Math.round(n));

    bootstrap.Modal.getOrCreateInstance(modal).show();
    modal.addEventListener('shown.bs.modal', () => {
      amountInput.focus();
      amountInput.select();
    }, { once: true });
  }

  async function saveBeyondChips(date, amount) {
    if (!goldTableId) throw new Error('Gold Dragon table not found.');

    const res = await fetch('/add_daily_table_report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        report_date: date,
        report_mode: 'rolling',
        reports: [{ junket_table_id: goldTableId, rolling: amount, winloss: 0 }]
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
      const row = e.target.closest('.dash-rolling-row');
      if (!row || !root.contains(row)) return;
      const date = row.dataset.date;
      if (!date) return;
      openBeyondChipsModal(date, row.dataset.beyondChips || '0');
    });

    beyondChipsEls.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const date = beyondChipsEls.dateIso?.value || '';
      const amount = parseBeyondChipsInput(beyondChipsEls.amount?.value);
      const saveBtn = beyondChipsEls.form.querySelector('[type="submit"]');

      if (!date) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Date is missing.' });
        return;
      }
      if (Number.isNaN(amount)) {
        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount.' });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;
      try {
        await saveBeyondChips(date, amount);
        if (beyondChipsEls.modal && typeof bootstrap !== 'undefined') {
          bootstrap.Modal.getOrCreateInstance(beyondChipsEls.modal).hide();
        }
        if (typeof Swal !== 'undefined') {
          Swal.fire({ icon: 'success', title: 'Saved', text: 'Beyond Chips saved successfully.', timer: 1300, showConfirmButton: false });
        }
        await loadGridData();
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

  function buildRollingRemarks(row) {
    const tags = [];
    if (Number(row.buy_in) > 0) tags.push('BI');
    if (Number(row.cash_out) > 0) tags.push('CO');
    if (Number(row.rolling_cc) > 0) tags.push('R');
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
      return `<div class="${cls}" data-date="${escapeAttr(row.date)}" data-beyond-chips="${escapeAttr(row.beyond_chips ?? 0)}" title="Click to edit Beyond Chips">
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

    preview.innerHTML = renderWlPreviewRows(previewDates);

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

  function renderGuestSummaryStats(stats) {
    const payload = stats || {};
    setGuestSummaryValue('dash-guest-summary-total-guest', payload.total_guest);
    setGuestSummaryValue('dash-guest-summary-total-balance', payload.total_balance);
    setGuestSummaryValue('dash-guest-summary-total-credit', payload.total_credit);
    setGuestSummaryValue('dash-guest-summary-total-winloss', payload.total_winloss);
    setGuestSummaryValue('dash-guest-summary-total-rolling', payload.total_rolling);
    setGuestSummaryValue('dash-guest-summary-total-commission', payload.total_commission);
  }

  async function loadGuestSummaryStats() {
    const status = document.getElementById('dash-guest-summary-status');
    if (status) {
      status.textContent = 'Loading...';
      status.classList.remove('text-danger');
    }

    try {
      const res = await fetch('/agency_line_stats', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load guest summary.');
      renderGuestSummaryStats(data);
      if (status) status.textContent = '';
    } catch (err) {
      console.error('agency_line_stats:', err);
      renderGuestSummaryStats({});
      if (status) {
        status.textContent = 'Failed to load guest summary.';
        status.classList.add('text-danger');
      }
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
      goldTableId = Number(data.gold_table_id) || null;
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
    loadGridData();

    const guestSummaryModal = document.getElementById('modal-guest-summary-quick-view');
    if (guestSummaryModal) {
      guestSummaryModal.addEventListener('show.bs.modal', loadGuestSummaryStats);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadGridData();
    });
  });

  window.dashboardGridReload = loadGridData;
})();
