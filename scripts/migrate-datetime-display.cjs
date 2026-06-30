/**
 * One-time helper: replace legacy moment .format() display strings with YYYY-MM-DD HH:mm.
 * Run: node scripts/migrate-datetime-display.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_PREFIXES = [
	'node_modules/',
	'public/login/vendor/',
	'public/assets/js/plugins/',
	'dashboard/',
	'telegram_announcement/',
	'.git/'
];

const DISPLAY_FORMAT_MAP = {
	'MMMM D, HH:mm': 'YYYY-MM-DD HH:mm',
	'MMMM DD, HH:mm': 'YYYY-MM-DD HH:mm',
	'MMM DD, HH:mm': 'YYYY-MM-DD HH:mm',
	'MMM D, HH:mm': 'YYYY-MM-DD HH:mm',
	'MMMM DD HH:mm': 'YYYY-MM-DD HH:mm',
	'DD MMM, YYYY HH:mm:ss': 'YYYY-MM-DD HH:mm',
	'DD MMM, YYYY HH:mm': 'YYYY-MM-DD HH:mm',
	'DD MMM YYYY HH:mm:ss': 'YYYY-MM-DD HH:mm',
	'DD MMM YYYY HH:mm': 'YYYY-MM-DD HH:mm',
	'DD MMM YYYY, HH:mm:ss': 'YYYY-MM-DD HH:mm',
	'MMMM DD, YYYY HH:mm:ss': 'YYYY-MM-DD HH:mm',
	'MMMM DD, YYYY HH:mm': 'YYYY-MM-DD HH:mm',
	'MMM DD, YYYY HH:mm:ss': 'YYYY-MM-DD HH:mm',
	'M/D/YYYY HH:mm': 'YYYY-MM-DD HH:mm',
	'YYYY-M-D HH:mm': 'YYYY-MM-DD HH:mm',
	'MMMM D, YYYY': 'YYYY-MM-DD',
	'MMMM DD, YYYY': 'YYYY-MM-DD',
	'MMM DD, YYYY': 'YYYY-MM-DD',
	'MMM D, YYYY': 'YYYY-MM-DD',
	'MMM DD, YYYY HH:mm': 'YYYY-MM-DD HH:mm'
};

function shouldProcess(relPath) {
	const norm = relPath.replace(/\\/g, '/');
	if (!/\.(js|ejs)$/.test(norm)) return false;
	return !SKIP_PREFIXES.some((p) => norm.startsWith(p));
}

function walk(dir, files = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const rel = path.relative(ROOT, full);
		if (entry.isDirectory()) {
			if (shouldProcess(rel + '/')) walk(full, files);
			else if (!SKIP_PREFIXES.some((p) => rel.replace(/\\/g, '/').startsWith(p.replace(/\/$/, '')))) {
				walk(full, files);
			}
		} else if (shouldProcess(rel)) {
			files.push(full);
		}
	}
	return files;
}

function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function migrateFile(filePath) {
	let content = fs.readFileSync(filePath, 'utf8');
	let changed = false;

	for (const [oldFmt, newFmt] of Object.entries(DISPLAY_FORMAT_MAP)) {
		for (const quote of ["'", '"']) {
			const pattern = `\\.format\\(${quote}${escapeRegExp(oldFmt)}${quote}\\)`;
			const re = new RegExp(pattern, 'g');
			if (re.test(content)) {
				content = content.replace(re, `.format('${newFmt}')`);
				changed = true;
			}
		}
	}

	// Display-only local format with seconds -> drop seconds
	content = content.replace(
		/\.local\(\)\.format\(['"]YYYY-MM-DD HH:mm:ss['"]\)/g,
		".local().format('YYYY-MM-DD HH:mm')"
	);
	content = content.replace(
		/\.local\(\)\.format\(['"]DD MMM, YYYY HH:mm:ss['"]\)/g,
		".local().format('YYYY-MM-DD HH:mm')"
	);
	content = content.replace(
		/\.local\(\)\.format\(['"]DD MMM, YYYY HH:mm['"]\)/g,
		".local().format('YYYY-MM-DD HH:mm')"
	);

	if (changed || content !== fs.readFileSync(filePath, 'utf8')) {
		fs.writeFileSync(filePath, content);
		return true;
	}
	return false;
}

const targets = [
	path.join(ROOT, 'public', 'assets', 'js', 'functions'),
	path.join(ROOT, 'views'),
	path.join(ROOT, 'routes'),
	path.join(ROOT, 'utils')
];

const files = [];
for (const t of targets) {
	if (fs.existsSync(t)) walk(t, files);
}

let count = 0;
for (const f of files) {
	if (migrateFile(f)) {
		count += 1;
		console.log('updated:', path.relative(ROOT, f));
	}
}
console.log(`Done. ${count} file(s) updated.`);
