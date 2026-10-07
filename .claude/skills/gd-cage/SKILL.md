---
name: gd-cage
description: >-
  Guides development on CageX (GD_Cage) — a Node/Express junket cage management
  system with EJS views, MySQL, dashboard, gamebook, accounts, and Telegram
  integrations. Use when working in GD_Cage, CageX, cagesystem, junket cage,
  dashboard, gamebook, accounts, net profit, daily reports, or any file in
  this repository.
---

# GD Cage (CageX) — Project Skill

## What this is

**CageX** (`package.json` name: `cagesystem`) is a junket/cage operations web app for Golden Dragon: cash/chip tracking, game records, accounts, commissions, expenses, statistics, daily reports, passport scanning, and Telegram broadcasts.

Stack: **Node.js + Express 4**, **EJS** templates, **MySQL** (`mysql2/promise` pool), **Passport/session** auth, **i18n** (en/ko/ja/zh), **DataTables**, **ExcelJS**, **SweetAlert2**, **Telegram** bot + MTProto scripts.

Default port: `4004` (`process.env.PORT`).

## Repository layout

| Path | Role |
|------|------|
| `app.js` | Express bootstrap, i18n, sessions, static files, route mounting |
| `routes/` | Route modules (one file per domain); registered in `routes/index.js` |
| `routes/routes.js` | Large legacy `pageRouter` — many page routes + inline handlers |
| `routes/auth.js` | Login, logout, user CRUD; exports canonical `checkSession` |
| `routes/api.js` | REST API under `/api` (Flutter mobile app) |
| `routes/scannerApi.js` | Passport scanner + GCP Vertex under `/api/scanner` |
| `config/db.js` | MySQL pool; runs idempotent `ensure*Schema` on startup |
| `utils/` | Shared SQL helpers, Telegram, Excel formatting, schema migrations |
| `views/` | EJS pages, `partials/`, `modals/`, `layouts/` |
| `public/assets/js/functions/` | Page-specific frontend JS (jQuery) |
| `public/assets/js/datatables/` | DataTable init scripts per page |
| `locales/` | i18n JSON (`en`, `ko`, `ja`, `zh`) |
| `scripts/` | Telegram venv setup, session export/logout |

## Running locally

```bash
npm install
npm run dev          # nodemon app
npm run dev:all      # app + telegram announcement worker
npm run dev:telegram # telegram worker only
```

Required env (`.env`, not committed): `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET`, `PORT`. Optional: `SCANNER_API_KEY`, `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_VERTEX_MODEL`, `GOOGLE_APPLICATION_CREDENTIALS`.

## Architecture rules

### Routes

- New domain routes: add file in `routes/`, export `router`, register in `routes/index.js`.
- Prefer importing `checkSession` and `sessions` from `routes/auth.js` (has session-token + single-login enforcement). `routes/routes.js` has a simpler duplicate — do not copy that pattern for new code.
- Super-admin guard pattern (used in `dashboard.js`, `net_profit.js`, etc.):

```javascript
const { checkSession } = require('./auth');
function requireSuperAdmin(req, res, next) {
  const p = req.session.permissions;
  if (p !== 0 && p !== '0') {
    if (req.xhr || String(req.headers.accept || '').includes('application/json')) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    return res.status(403).send('Forbidden');
  }
  next();
}
const superAdminOnly = [checkSession, requireSuperAdmin];
```

- JSON endpoints: check `req.xhr` or `Accept: application/json` for 403 vs redirect.
- API routes live under `/api` and `/api/scanner` — mounted separately in `app.js`.

### Database

- Always use `const pool = require('../config/db')` and `pool.execute()` / `pool.query()`.
- **No separate migrations folder.** Schema changes go in `utils/ensure*Schema.js` files, registered in `config/db.js` startup IIFE. Make them **idempotent** (check `information_schema` before `ALTER`).
- Legacy callback code in `routes/routes.js` uses a `connection` wrapper around the pool — prefer async/await in new code.
- Common columns: `ACTIVE` (soft delete), `RESET` (dashboard reset flag), `EDITED_BY`, `EDITED_DT`.

### Views (EJS)

- Pages include `partials/header`, `sidebar`, `topbar`, `footer` directly (not always via `layouts/layout.ejs`).
- Modals live in `views/modals/<domain>/` — reusable across pages.
- Pass `permissions` and `currentPage` to views for sidebar highlighting.
- Expose role to JS: `<div id="user-role" data-permissions="<%= permissions %>"></div>`.
- Translations: `<%= __('key.path') %>` — add keys to all four locale files.
- Amount display in EJS: use `toLocaleString('en-US')`; negatives often wrapped in parentheses via helper like `fmtAmt()` in `dashboard.ejs`.

### Frontend JS

- jQuery + DataTables + Flatpickr + SweetAlert2 (`swal_confirm.js`).
- Page scripts in `public/assets/js/functions/<page>.js`; DataTable configs in `public/assets/js/datatables/`.
- **View-only users** (`permissions === 2`): use `permission-view-only.js` and `data-view-only-disable` on elements. Modals can open; Save/Edit/Delete inside modals are disabled.
- Date ranges: use `window.MonthEndCutoffRange` / `getDateRange()` from `common.js` + `month_end_cutoff_range.js`.
- Amount formatting: `format_amount.js`, `format_datetime.js`.
- **Logic goes in `.js`, not inline in `.ejs`.** New behaviour belongs in the page's file under `public/assets/js/functions/`; the view only gets the `<script src>`. Page CSS is different: many views keep their styles in an inline `<style>` block, so CSS edits stay there.
- **Shared page scripts must no-op where their elements are missing.** `commission.js`, `junket_loss.js` and `house_expense.js` are also loaded by the dashboard through `views/partials/*_dashboard_scripts.ejs`, and `game_list.js` by `agency.ejs` and `telegram.ejs`. Guard on the element or helper before using it.
- **Bump `?v=N` on the `<script src>` when a page script changes**, otherwise browsers keep the cached file. Not every include has a version yet — add one when you touch the script.

### Amount columns (digit alignment)

Negatives display as red `(1,234)`. In a right-aligned column the digits must line up regardless of sign, so the closing `)` hangs to the right of the digit column:

```
 328,000,000
 (54,660,000)
```

- Shared helper: `public/assets/js/functions/num_paren_align.js` → `window.gdAlignParenNumbers(rootSelector, targetSelectors)`. It measures `)` in the cell's font and shifts negative values right by that width (into the cell's right padding), and re-applies whenever the root's content changes (DataTables redraws, re-rendered panels).
- It is loaded on every page by `views/partials/footer.ejs`; call it from the page script behind `if (window.gdAlignParenNumbers)`. (Some views still carry their own older `<script src>` for it — harmless.)
- The column must be right-aligned with some right padding, and body and footer cells need the same right padding or the totals will not line up with the rows.
- Already wired: dashboard (`dashboard_num_align.js`), Game Book, Game Information, Agent Win/Loss, Commission, Commission Analytics, Add Charge (`fnb_hotel.js`), Loss Amount, Junket Expenses, and the account ledger / credit details modals (`account.js`).
- Receipts use a different trick for the same goal: positives get a hidden `)` after them (`gsr-paren-pad` in `game_list.js`, `::after` in `_settlement_slip_styles.ejs`).

### Receipts and Copy image / Copy text

- Game receipts are built server-side in `buildGameReceipts` (`routes/gamebook.js`) and rendered by `game_list.js`; the settlement slip is `views/modals/game_book/settlement.ejs` with shared styles in `_settlement_slip_styles.ejs` (also used by `merge_settlement.ejs`).
- Copy image uses **html2canvas 1.4.1**. It draws `<input>` values differently from plain text, so a value inside an input can sit slightly off in the copied image even when it looks right on screen. `data-html2canvas-ignore` keeps on-screen-only rows out of the image.
- Account Info card (GOLDEN DRAGON details): the Image / Text copy buttons live in `account.js` (`initGdDetailsCopy`).

## Permissions model

Stored in `user_info.PERMISSIONS`, copied to `req.session.permissions` on login.

| Value | Meaning |
|-------|---------|
| `0` | Super Admin — full access, settings menu, net profit, money exchange, multi-login allowed for admin check uses `1` |
| `1` | Admin — multi-login allowed (session token mismatch ignored) |
| `2` | View only — read-only UI via `PermissionViewOnly` |
| `11` | Manager — password gate via `/verify-password` for elevated actions |

Check permissions in route handlers **and** EJS (`sidebar.ejs`, page conditionals). Frontend checks `#user-role` data attribute.

Role names live in the `user_role` table (`user_role.IDNo = user_info.PERMISSIONS`); `1` is labelled Administrator there.

### Game Book: changing a game's status

Clicking the Game End / ON GAME cell opens the change-status modal. The rule is applied in `game_list.js` when the row is rendered:

| Role | On game / pending, not settled | On game / pending, settled | Finished, not settled | Finished and settled |
|------|------|------|------|------|
| `0` Super Admin | Yes | Yes | Yes | No — "Game Settled" notice |
| `11` Manager | Yes | Yes | Yes | No — "Game Settled" notice |
| `1` Administrator | Yes | No — "Game Settled" notice | Yes | No — "Game Settled" notice |
| others | No — "Access Denied" | No | No — "Access Denied" | No |

A finished and settled game is locked for everyone. This is enforced **in the browser only**: `PUT /game_list/change_status/:id` in `routes/gamebook.js` does not check the role or the settled flag.

## Domain vocabulary

Understanding these terms prevents bad SQL/UI changes:

| Term | Meaning |
|------|---------|
| **NN chips** | Non-negotiable chips (`NN_CHIPS`) |
| **CC chips** | Cash chips (`CC_CHIPS`) |
| **CAGE_TYPE** | Transaction type on `game_record`: 1=buy-in, 2=cash-out, 3=rolling, 4=real rolling, 5=roller |
| **ROLLER_TRANSACTION** | 1=roller out, 2=roller return |
| **Junket** | House/operator side (vs guest/player) |
| **Game list / gamebook** | Active games and per-game records |
| **Win/loss, rolling** | Core dashboard metrics; complex SQL in `dashboard.js` + `utils/dashboardQueries.js` |
| **House expense** | Operational expenses; categories in `expense_category` with `PARENT_ID` |
| **Marker** | Credit/marker transactions on accounts |
| **Settlement** | End-of-game settlement flow in gamebook |
| **Daily report** | Table-level junket daily reports (`table_daily_report.js`) |
| **Cutoff period** | Month-end settlement range, e.g. Sep 30 – Oct 30 (`getMonthEndCutoffRange()` in `month_end_cutoff_range.js`); the default date range on most lists |
| **Net profit** | Super-admin financial reporting (`net_profit.js`) |

Rolling formula (used in `api.js` and game list):  
`total_rolling_nn + total_roller_return_cc + total_rolling_amount + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn`

## Key route modules

| File | Domain |
|------|--------|
| `dashboard.js` | Main dashboard, cash in/out, chips, WL share, exports |
| `gamebook.js` | Game list, records, buy-in/cash-out/rolling, settlement |
| `accounts.js` | Agents, guests, agencies, ledgers, passport upload |
| `expense.js` | House expenses |
| `commission.js` | Commission tracking |
| `net_profit.js` | Net profit (super admin) |
| `table_daily_report.js` | Daily table reports + XLSX export |
| `booking.js`, `fnb_hotel.js`, `tip.js` | Concierge services |
| `multipurpose_ledger.js`, `money_exchange.js` | Ledgers and FX |
| `statistics.js` | Game/live/telebet/agent/guest stats |
| `announcement.js`, `broadcast.js` | Telegram messaging |
| `activity_log.js` | Audit log |

## Common change workflows

### Add a new page

1. Route in appropriate `routes/*.js` with `checkSession`.
2. EJS in `views/<domain>/`.
3. JS in `public/assets/js/functions/` + optional datatable script.
4. Sidebar link in `views/partials/sidebar.ejs` with `currentPage` match.
5. i18n keys in `locales/*.json`.
6. Permission checks (route + view + view-only handling).

### Add a DB column/table

1. Create `utils/ensure<Feature>Schema.js` (idempotent).
2. Register in `config/db.js` startup block.
3. Use column in routes; do not hand-run SQL on production.

### Add API endpoint for mobile

1. Add to `routes/api.js` under `/api`.
2. Match existing response shapes and rolling/balance formulas from `utils/dashboardQueries.js`.
3. Document any new env vars.

### Game Book list filters

The Game Book loads a program-date range (default: the whole cutoff period) and narrows it in the browser with DataTables `ext.search` filters in `game_list.js`:

- **Status tabs** (All / On Game / Finished / Settled / Unsettled) — `window.gameListStatusFilter`.
- **Yesterday / Today tabs** — `window.gameListDayFilter`. Each toggles on/off and they combine; Today is on by default; both off shows everything loaded. Picking dates in the calendar or with the arrows turns both off. A deep link (`?date=`, `?id=`, `?unreturned_roller=`) starts with Today off so the target row is not hidden.
- The footer **Grand Total is computed from all loaded rows**, not from the rows left after these filters.

### Deploying

Production runs under PM2 as `GDCAGE` (`ecosystem.config.js`). After `git pull`:

- Changes under `routes/`, `utils/`, `app.js`, `config/` or `locales/` need `pm2 restart GDCAGE` — the old code stays in memory until then. A page that shows new frontend behaviour but old data shapes usually means the restart was skipped.
- Changes under `public/` only need a browser hard refresh (and a `?v=` bump).

### Excel export

Use **ExcelJS** + `utils/excelAmountFormat.js` (`applyCommaThousandsToNumericCells`). Follow patterns in `net_profit.js` or `table_daily_report.js`.

### Telegram

- Bot helpers: `utils/telegram.js`, `utils/telegramSendLog.js`, `utils/telegramChatIds.js`.
- MTProto broadcast scripts: `scripts/run-telegram-announcement.cjs`, venv via `npm run dev:telegram:install`.

## UI / branding

Golden Dragon theme: dark sidebar (`gd-sidebar`), gold accents (`#c8a24c`). Custom CSS in `public/assets/css/` (e.g. `dashboard_grid.css`, `commission.css`). Do not replace vendor assets under `public/assets/js/plugins/`.

## Code style for this repo

- Match surrounding file style (mostly CommonJS `require`, async route handlers).
- Minimize scope — this codebase has large route files; add focused helpers in `utils/` instead of inflating `routes/routes.js` further.
- Reuse existing SQL fragments from `utils/` (e.g. `saveCashoutTips.js` SQL constants, `houseExpenseQueries.js`).
- Soft-delete with `ACTIVE = 0`, not hard `DELETE`, unless existing code in that module already hard-deletes.
- Passwords: **argon2** for new hashes; legacy MD5+salt still supported in `auth.js`.

## Do not

- Commit `.env` or credentials JSON.
- Edit minified vendor files in `public/assets/js/plugins/`.
- Add a new `checkSession` copy — import from `routes/auth.js`.
- Break view-only mode (permission 2) by adding buttons without `data-view-only-disable` or modal disable logic.
- Change rolling/winloss SQL without cross-checking `dashboard.js`, `gamebook.js`, and `routes/api.js` formulas.
- Put new JavaScript logic in an inline `<script>` inside an `.ejs` view — add it to the page's `.js` file.
- Centre an amount column that can hold negatives; right-align it and use `gdAlignParenNumbers`.

## Additional reference

For a module-to-file map and env var list, see [reference.md](reference.md).
