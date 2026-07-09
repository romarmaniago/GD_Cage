# GD Cage — Reference

## Environment variables

| Variable | Used for |
|----------|----------|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection + session store |
| `SESSION_SECRET` | Express session signing |
| `PORT` | HTTP port (default 4004) |
| `SCANNER_API_KEY` | `/api/scanner` and passport upload auth |
| `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_VERTEX_MODEL` | Vertex AI passport OCR |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP service account JSON path |

## Schema bootstrap utilities (`config/db.js`)

| File | Purpose |
|------|---------|
| `ensureExpenseCategorySchema.js` | `PARENT_ID` on expense categories, Car sub-seeds |
| `ensureHouseExpenseApprovalSchema.js` | House expense approval workflow |
| `ensureHouseExpenseVehicleSchema.js` | Vehicle expense fields |
| `ensureTipSchema.js` | Tip tables/columns |
| `ensureGameServicesDeliveryFeeSchema.js` | Delivery fee on game services |
| `ensureGameServicesServiceTypeSchema.js` | Service type column |
| `ensureServicesCategorySchema.js` | Services category table |
| `ensureGuestMembershipSchema.js` | Guest membership |
| `ensureGameListProgramDateSchema.js` | Program date on game list |
| `ensureNetProfitShareProgramDateSchema.js` | Net profit share program date |
| `ensureDashboardWlShareSchema.js` | Dashboard WL share percentage |
| `ensureAdditionalCommissionSchema.js` | Additional commission |
| `ensureBeyondChipsSchema.js` | Beyond chips tracking |
| `ensureDashboardCheckRemarksSchema.js` | Dashboard check remarks |
| `ensureGameDailySettlementCleanup.js` | Drops deprecated settlement schema |

## Shared utils (frequently reused)

| File | Purpose |
|------|---------|
| `dashboardQueries.js` | Cash balance, dashboard SQL helpers |
| `dashboardWlShare.js` | WL share % load/save |
| `dashboardServiceBalance.js` | F&B/hotel/delivery service balances |
| `saveCashoutTips.js` | SQL filters excluding dealer/roller tips |
| `houseExpenseQueries.js` | Junket expense totals |
| `markerReturnAllocation.js` | Marker return allocation logic |
| `markerDataBreakdown.js` | Marker breakdown SQL |
| `excelAmountFormat.js` | Excel numeric formatting |
| `formatDateTime.js` | Server-side datetime display |
| `monthEndCutoffRange.js` | Month-end date range (server) |
| `remarksUpdate.js` | Remarks field updates |

## Views structure

```
views/
├── partials/          # header, sidebar, topbar, footer, shared scripts
├── modals/            # All modals by domain (accounts, dashboard, game_book, …)
├── layouts/           # layout.ejs (optional wrapper)
├── dashboard*.ejs     # Dashboard variants (dashboard.ejs = current)
├── gamebook/          # Game list, records
├── accounts/          # Agency, ledger
├── junket/            # Capital, booking, house expense, net profit, …
├── statistics/        # Stats pages
├── daily_reports/     # Rolling, winloss reports
├── denomination/      # Cash chips, NN chips
├── tip/               # Tip management
├── money_exchange/    # FX board
├── telegram/          # Telegram admin UI
├── user_accounts/     # Users and roles
└── errors/            # 404, 500
```

## HTTP mount points (`app.js`)

| Path | Handler |
|------|---------|
| `/` | All routers from `routes/index.js` |
| `/api` | `routes/api.js` |
| `/api/scanner` | `routes/scannerApi.js` |
| `/PassportUpload` | Static passport images |
| `/ReceiptUpload` | Static receipt images |
| `/scanner` | Passport scanner static app |
| `/models` | face-api models for scanner |
| `/change-lang` | i18n cookie switch |

## i18n

Locales: `en` (default), `ko`, `ja`, `zh`. Cookie: `lang`. Query param: `?lang=ko`. Add new keys to **all four** JSON files in `locales/`.

## External integrations

- **Flutter app** — consumes `/api` endpoints
- **Passport scanner** — web UI at `/scanner`, API at `/api/scanner`
- **Telegram** — `node-telegram-bot-api` in-process; MTProto scripts in `scripts/` for broadcasts
- **Capacitor/mobile** — CORS allows `capacitor://localhost`, internal IPs

## npm scripts

| Script | Command |
|--------|---------|
| `start` | `node app` |
| `dev` | `nodemon app` |
| `dev:telegram` | Telegram announcement worker |
| `dev:telegram:install` | Python venv for MTProto |
| `dev:all` | App + telegram concurrently |
| `broadcast:export-session` | Export Telegram session |
| `broadcast:logout` | Logout Telegram session |
