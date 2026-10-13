/**
 * Shared print sheet for list pages (Commission, Game Information, Tip, Ledger, ...):
 * title + subtitle + bordered table on landscape A4, in the same format as the Game Book print.
 *
 *   window.gdPrintTable({
 *     title, subtitle,
 *     headers: ['Program Date', ...],          // plain text
 *     rows: [['2026-10-09', ...], ...],        // plain text, already in on-screen order
 *     amountCols: [8, 9],     // 0-based: right-aligned, "(x)" in red, digits lined up
 *     leftCols: [3],          // 0-based: left-aligned text (default is centered)
 *     totalRows: 1,           // last N rows are totals (bold, tinted)
 *     shortDateCols: [1],     // "2026-09-30 02:56" -> "09-30 02:56" (the year is in Program Date)
 *     stripMainCols: [2],     // "GD069 Main" -> "GD069" ("Main" is the default group)
 *     wrapCols: [7],          // these cells may wrap onto a second line (long remarks / descriptions)
 *     colWidths: [9, 9, ...], // optional % per column: fixed, balanced widths
 *     rowClasses: ['', 'is-settled', ...] // optional class per row (is-settled = green tint)
 *   });
 *
 * Without colWidths every row stays on one text line (except wrapCols) and the font steps down
 * (not below 8px) until the widest row fits the page.
 */
(function (window) {
	'use strict';

	var MARGIN_MM = 6;
	var BASE_FONT_PX = 10.5;
	var MIN_FONT_PX = 8;

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function has(list, i) {
		return Array.isArray(list) && list.indexOf(i) !== -1;
	}

	function styles(fixed) {
		return [
			'@page{size:landscape;margin:' + MARGIN_MM + 'mm;}',
			// print the header fill, tints and red amounts even with "Background graphics" off
			'*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'.print-wrap{width:100%;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 10px;font-size:12px;color:#444;}',
			'table{width:100%;border-collapse:collapse;font-size:' + (fixed ? 11.5 : BASE_FONT_PX) + 'px;' + (fixed ? 'table-layout:fixed;' : '') + '}',
			'th,td{border:1px solid #777;padding:4px ' + (fixed ? 6 : 3) + 'px;vertical-align:middle;text-align:center;}',
			'th{background:#d9e1f2;font-weight:700;}',
			fixed ? 'thead th{white-space:nowrap;font-size:10.5px;}td{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}td.wrap{white-space:normal;overflow-wrap:anywhere;}' : 'td{white-space:nowrap;}td.wrap{white-space:normal;}',
			'td.left{text-align:left;padding-left:5px;}',
			// amounts: digits line up — a "(x)" hangs its ")" past them, other values carry an invisible ")"
			'.num{text-align:right;padding-right:5px;font-variant-numeric:tabular-nums;white-space:nowrap;}',
			'.neg{color:#dc3545;}',
			'.paren-pad{visibility:hidden;}',
			'tr.is-settled td{background:#e4f3e8;}',
			'tr.total-row td{font-weight:700;background:#f4f6fa;}'
		].join('');
	}

	function amountHtml(text) {
		var t = String(text == null ? '' : text).trim();
		if (!t) return '';
		if (/^\(.*\)$/.test(t)) return '<span class="neg">' + escapeHtml(t) + '</span>';
		return escapeHtml(t) + '<span class="paren-pad">)</span>';
	}

	window.gdPrintTable = function (opts) {
		opts = opts || {};
		var headers = opts.headers || [];
		var rows = opts.rows || [];
		var fixed = Array.isArray(opts.colWidths) && opts.colWidths.length === headers.length;
		var firstTotalRow = rows.length - (opts.totalRows || 0);

		var headerHtml = headers.map(function (h, i) {
			return '<th' + (has(opts.amountCols, i) && !fixed ? ' class="num"' : '') + '>' + escapeHtml(h) + '</th>';
		}).join('');

		var rowsHtml = rows.map(function (row, r) {
			var classes = [];
			if (r >= firstTotalRow) classes.push('total-row');
			if (opts.rowClasses && opts.rowClasses[r]) classes.push(opts.rowClasses[r]);
			return '<tr' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>' + row.map(function (cell, i) {
				if (has(opts.amountCols, i)) return '<td class="num">' + amountHtml(cell) + '</td>';
				var t = String(cell == null ? '' : cell).trim();
				if (has(opts.shortDateCols, i)) t = t.replace(/^\d{4}-(\d{2}-\d{2})\s+(\d{1,2}:\d{2}).*$/, '$1 $2');
				if (has(opts.stripMainCols, i)) t = t.replace(/\s+Main$/i, '');
				var cls = [];
				if (has(opts.leftCols, i)) cls.push('left');
				var wraps = has(opts.wrapCols, i);
				if (wraps) cls.push('wrap');
				// "BOBBY/MINA" may wrap after a "/" instead of mid-name
				var html = wraps ? escapeHtml(t).replace(/\//g, '/<wbr>') : escapeHtml(t);
				return '<td' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + html + '</td>';
			}).join('') + '</tr>';
		}).join('');

		var colgroup = fixed
			? '<colgroup>' + opts.colWidths.map(function (w) { return '<col style="width:' + w + '%">'; }).join('') + '</colgroup>'
			: '';

		// Off-screen, as wide as the printable area of the narrower landscape paper (Letter, 279.4mm —
		// A4 is 297mm) so the fitted table fits whichever paper the printer uses.
		var iframe = document.createElement('iframe');
		iframe.style.position = 'fixed';
		iframe.style.left = '-20000px';
		iframe.style.top = '0';
		iframe.style.width = Math.floor((279.4 - 2 * MARGIN_MM) / 25.4 * 96) + 'px';
		iframe.style.height = '800px';
		iframe.style.border = '0';
		document.body.appendChild(iframe);

		var frameWindow = iframe.contentWindow;
		var frameDoc = frameWindow.document;
		frameDoc.open();
		frameDoc.write([
			'<!doctype html><html><head><title>', escapeHtml(opts.title || ''), '</title><style>',
			styles(fixed),
			'</style></head><body><div class="print-wrap">',
			'<h2>', escapeHtml(opts.title || ''), '</h2>',
			'<div class="subtitle">', escapeHtml(opts.subtitle || ''), '</div>',
			'<table>', colgroup, '<thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody></table>',
			'</div></body></html>'
		].join(''));
		frameDoc.close();

		var cleanup = function () {
			setTimeout(function () {
				if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
			}, 300);
		};
		frameWindow.onafterprint = cleanup;
		setTimeout(function () {
			if (!fixed) {
				// rows don't wrap: step the font down until the widest row fits the page
				var table = frameDoc.querySelector('table');
				var available = frameDoc.body.clientWidth;
				for (var size = BASE_FONT_PX; table && size >= MIN_FONT_PX && table.scrollWidth > available; size -= 0.25) {
					table.style.fontSize = size + 'px';
				}
			}
			frameWindow.focus();
			frameWindow.print();
			cleanup();
		}, 250);
	};
})(window);
