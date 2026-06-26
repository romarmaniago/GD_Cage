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

  function buildRollingHeader(tables) {
    const casino = tables.find((t) => /casino/i.test(t.table_name)) || tables[0];
    const gold = tables.find((t) => /gold\s*dragon/i.test(t.table_name)) || tables[1];
    return { casino, gold, tables };
  }

  function renderRollingTable(payload) {
    const table = document.getElementById('dash-rolling-table');
    const thead = document.getElementById('dash-rolling-thead');
    const tbody = document.getElementById('dash-rolling-tbody');
    const tfoot = document.getElementById('dash-rolling-tfoot');
    if (!table || !thead || !tbody || !tfoot || !payload) return;

    const { casino, gold } = buildRollingHeader(payload.tables || []);
    const casinoName = casino ? casino.table_name : 'Casino';
    const goldName = gold ? gold.table_name : 'Gold Dragon';

    thead.innerHTML = `
      <tr>
        <th rowspan="2" class="date-col">Date</th>
        <th colspan="3">${escapeHtml(casinoName)}</th>
        <th rowspan="2">${escapeHtml(goldName)}<br><small>Beyond Chips</small></th>
        <th rowspan="2">Remarks</th>
      </tr>
      <tr>
        <th>Buy In</th>
        <th>Cash Out</th>
        <th>Rolling</th>
      </tr>`;

    const today = todayIso();
    const rows = payload.rolling_rows || [];
    tbody.innerHTML = rows.map((row) => {
      const cls = row.date === today ? 'is-today' : '';
      return `<tr class="${cls}" data-date="${escapeAttr(row.date)}">
        <td class="date-col">${toDisplayDate(row.date)}</td>
        <td>${formatCell(row.buy_in)}</td>
        <td class="text-dash-neg">${formatCell(-Math.abs(row.cash_out || 0))}</td>
        <td>${formatCell(row.rolling)}</td>
        <td>${formatCell(row.beyond_chips)}</td>
        <td></td>
      </tr>`;
    }).join('');

    const t = payload.totals || {};
    tfoot.innerHTML = `<tr>
      <th class="date-col">Total</th>
      <th>${formatCell(t.buy_in)}</th>
      <th class="text-dash-neg">${formatCell(-Math.abs(t.cash_out || 0))}</th>
      <th>${formatCell(t.rolling)}</th>
      <th>${formatCell(t.beyond_chips)}</th>
      <th></th>
    </tr>`;

    updateActualCheck(payload);
  }

  function renderWlTable(payload) {
    const thead = document.getElementById('dash-wl-thead');
    const tbody = document.getElementById('dash-wl-tbody');
    const tfoot = document.getElementById('dash-wl-tfoot');
    if (!thead || !tbody || !tfoot || !payload) return;

    const { casino, gold } = buildRollingHeader(payload.tables || []);
    const casinoName = casino ? casino.table_name : 'Casino';
    const goldName = gold ? gold.table_name : 'Gold Dragon';

    thead.innerHTML = `
      <tr>
        <th class="date-col">Date</th>
        <th>${escapeHtml(casinoName)}</th>
        <th>${escapeHtml(goldName)}</th>
        <th>The difference</th>
        <th>Remarks</th>
      </tr>`;

    const today = todayIso();
    const rows = payload.wl_rows || [];
    tbody.innerHTML = rows.map((row) => {
      const cls = row.date === today ? 'is-today' : '';
      const diff = (Number(row.casino) || 0) - (Number(row.gold_dragon) || 0);
      return `<tr class="${cls}">
        <td class="date-col">${toDisplayDate(row.date)}</td>
        <td>${formatCell(row.casino)}</td>
        <td>${formatCell(row.gold_dragon)}</td>
        <td>${formatCell(diff)}</td>
        <td></td>
      </tr>`;
    }).join('');

    const t = payload.totals || {};
    const totalDiff = (Number(t.casino_wl) || 0) - (Number(t.gold_dragon_wl) || 0);
    tfoot.innerHTML = `<tr>
      <th class="date-col">Total</th>
      <th>${formatCell(t.casino_wl)}</th>
      <th>${formatCell(t.gold_dragon_wl)}</th>
      <th>${formatCell(totalDiff)}</th>
      <th></th>
    </tr>`;
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
    } catch (err) {
      console.error('dashboard_grid_data:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadGridData();
  });

  window.dashboardGridReload = loadGridData;
})();
