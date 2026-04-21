require('dotenv').config();
const express = require('express');
const path = require('path');
const routes = require('./routes');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const db = require('./config/db');
const flash = require('connect-flash');
const i18n = require('i18n');


const { startTelegramBot } = require('./utils/telegram');
startTelegramBot(); // run once when server starts

const compression = require('compression');
const app = express();
app.use(
  compression({
    // Brotli disabled - commented out due to browser errors
    // filter: (req, res) => {
    //   if (req.headers['accept-encoding']?.includes('br')) {
    //     res.setHeader('Content-Encoding', 'br');
    //     return true;
    //   }
    //   return compression.filter(req, res);
    // },
    // brotli: { enabled: true, zlib: {} }, // Brotli settings
  })
);

// i18n configuration
i18n.configure({
  locales: ['en', 'ko', 'ja', 'zh'], // Supported languages including Chinese
  directory: path.join(__dirname, 'locales'), // Directory where translation files are stored
  defaultLocale: 'en', // Default language
  cookie: 'lang', // Store language preference in a cookie
  queryParameter: 'lang', // Allow the language to be passed in the query string
  autoReload: true, // Automatically reload translation files when changed
  syncFiles: true, // Sync translation files with the current configuration
  objectNotation: true // Use object notation to access translations
});

// Middleware setup
app.use(cookieParser());
app.use(i18n.init);

// Middleware to set the language for each request
app.use((req, res, next) => {
  const lang = req.cookies.lang || 'en'; // Default to English if no language cookie is set
  i18n.setLocale(req, lang); // Set the language for the current request
  res.locals.currentLang = lang; // Make the current language available in the view templates
  next();
});

// CORS: allow local origins, Capacitor, PWA, server public IP (passport-scanner), and 10.x internal
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allow = origin && /^(https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|45\.32\.119\.62)(:\d+)?|capacitor:\/\/localhost|ionic:\/\/localhost)$/.test(origin)
    ? origin
    : null;
  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', allow);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Body parser — large limit for passport base64 JSON on /api/scanner/*
app.use(express.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// Passport scanner face-api models (served for web + mobile clients)
app.use('/models', express.static(path.join(__dirname, 'passport-scanner-dist/models')));

// MySQL Session Store configuration
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  createDatabaseTable: true, // Automatically create sessions table if it doesn't exist
  expiration: 86400000, // 24 hours in milliseconds (matches cookie maxAge)
  clearExpired: true, // Automatically clear expired sessions
  checkExpirationInterval: 900000, // Check for expired sessions every 15 minutes
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
});

const ensureSessionExpirationIndex = async () => {
  const tableName = sessionStore.options.schema.tableName;
  const expiresColumn = sessionStore.options.schema.columnNames.expires;
  const expiresIndex = `idx_${tableName}_${expiresColumn}`;
  const sql = `ALTER TABLE \`${tableName}\` ADD INDEX \`${expiresIndex}\` (\`${expiresColumn}\`)`;

  try {
    await db.query(sql);
    console.log(`✅ Session expiration index (${expiresIndex}) ensured on ${tableName}`);
  } catch (error) {
    if (error && ['ER_DUP_KEYNAME', 'ER_DUP_NAME', 'ER_DUP_INDEX'].includes(error.code)) {
      return;
    }
    console.error('❌ Failed to ensure session expiration index', error);
  }
};

sessionStore.onReady().then(async () => {
  await ensureSessionExpirationIndex();
  console.log('✅ MySQL Session Store connected successfully!');
}).catch((error) => {
  console.error('❌ MySQL Session Store connection error:', error);
});

app.use(session({
  name: 'connect.sid', // Standard session cookie name (compatible with most apps)
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiration on activity
  cookie: {
    secure: false, // Set to true if using HTTPS in production
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    sameSite: 'lax' // CSRF protection
  }
}));
app.use(flash());
app.use((req, res, next) => {
  res.locals.messages = req.flash();
  next();
});


app.use(passport.initialize());
app.use(passport.session());

// Set the view engine and routes
app.set('port', process.env.PORT || 4004);
app.set('views', path.join(__dirname, 'views'));
app.set("view engine", "ejs");

// Serve static files (images, CSS, JS, etc.)
app.use('/login/images/flags', express.static(path.join(__dirname, 'public/login/images/flags')));

// Language switch route
app.get('/change-lang', (req, res) => {
  const lang = req.query.lang;
  if (['en', 'ko', 'ja', 'zh'].includes(lang)) {
    res.cookie('lang', lang); // Set the selected language in the cookie
    i18n.setLocale(req, lang); // Apply language immediately after cookie update
  }
  res.redirect('back'); // Redirect back to the previous page
});

routes.forEach(router => app.use('/', router));
// API for external apps (e.g. Flutter cageApp) — base path /api
app.use('/api', require('./routes/api'));
app.use('/api/scanner', require('./routes/scannerApi'));
// Static file serving (for PassportUpload folder)
app.use('/PassportUpload', express.static(path.join(__dirname, 'PassportUpload')));
// Static file serving (for ReceiptUpload folder)
app.use('/ReceiptUpload', express.static(path.join(__dirname, 'ReceiptUpload')));

// Start the server
app.listen(app.get('port'), function () {
  console.log('Server started on port ' + app.get('port'));
});
// Idagdag ito sa app.js ng CageX (bago ang routes)
app.use('/scanner', express.static(path.join(__dirname, 'passport-scanner')));