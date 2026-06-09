// routes/index.js
module.exports = [
    require('./auth').router,
    require('./statistics'),
    require('./accounts'),
    require('./gamebook'),
    require('./expense'),
    require('./services_category'),
    require('./booking'),
    require('./commission'),
    require('./net_profit'),
    require('./changeGame'),
    require('./dashboard'),
    require('./remarks'),
    require('./activity_log'),
    require('./junket_loss'),
    require('./multipurpose_ledger'),
    require('./tip'),
    require('./money_exchange'),
    require('./table_daily_report'),
    require('./routes.js'), // pageRouter with page routes like /activity_log, /game_list, etc.
    require('./telegramData'),
    require('./fnb_hotel'),
    require('./announcement'), // POST /announcement/create (agents)
    require('./broadcast') // POST /broadcast/guest (chat IDs)
];
  