/**
 * Game Information → Analytics → Report
 * One row per account (games in the program-date range summed), plus a REPORT card per account
 * that opens in the Game Book receipt modal (Copy image / Copy text from game_information_receipt.js).
 * EVENT = raffle tickets: 1 per 100,000 rolling, counted per account.
 * Account with tickets → card with the event poster; no tickets → plain card.
 * The poster, RAFFLE text and message are edited on the card itself and saved for every user
 * (gi_report_setting via /game_information_report/settings).
 */
(function () {
	'use strict';

	var ROLLING_PER_TICKET = 100000;
	var POSTER_MAX_SIDE = 900;
	/** Texts that can be edited on the card: one text for every account */
	var EDITABLE_TEXTS = {
		raffle: { defaultText: '장 보관 중' },
		message: { defaultText: '고객 만족을 위해 최선을 다하는 골든 드래곤이 되도록 노력하겠습니다. 감사합니다.' }
	};
	/** Older version kept these in the browser; moved to the server once, then removed */
	var LEGACY_STORAGE_KEYS = { poster: 'giReportEventPoster', raffle: 'giReportRaffle', message: 'giReportMessage' };

	var dataTable = null;
	var reloadGeneration = 0;
	var programFrom = null;
	var programTo = null;
	var quickFilter = 'month';
	var dayFilter = { today: false, yesterday: false };
	var splitDateRange = null;
	var posterDataUrl = null;
	var openAccount = null;

	Object.keys(EDITABLE_TEXTS).forEach(function (field) {
		EDITABLE_TEXTS[field].saved = null;
	});

	function editableText(field) {
		var item = EDITABLE_TEXTS[field];
		return item.saved && item.saved.trim() ? item.saved : item.defaultText;
	}

	function normalizeText(field, text) {
		var value = String(text || '').replace(/\s+/g, ' ').trim();
		return value && value !== EDITABLE_TEXTS[field].defaultText ? value : null;
	}

	/** PUT one card setting; '' / null removes it on the server */
	function putSetting(key, value) {
		return $.ajax({
			url: '/game_information_report/settings/' + encodeURIComponent(key),
			method: 'PUT',
			contentType: 'application/json',
			data: JSON.stringify({ value: value || '' })
		});
	}

	function notifySaveFailed(xhr, fallback) {
		var msg = (xhr && xhr.responseJSON && xhr.responseJSON.error) || fallback;
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: msg });
		else alert(msg);
	}

	function readLegacy(key) {
		try {
			var v = window.localStorage.getItem(LEGACY_STORAGE_KEYS[key]);
			// an older version kept a per-account JSON map under the raffle key
			return v && v.charAt(0) !== '{' ? v : null;
		} catch (e) {
			return null;
		}
	}

	function dropLegacy(key) {
		try {
			window.localStorage.removeItem(LEGACY_STORAGE_KEYS[key]);
		} catch (e) { /* storage blocked */ }
	}

	/** Loads the shared card settings; anything only this browser had is uploaded once */
	function loadSettings() {
		$.getJSON('/game_information_report/settings').done(function (settings) {
			settings = settings || {};
			posterDataUrl = settings.poster || null;
			EDITABLE_TEXTS.raffle.saved = settings.raffle || null;
			EDITABLE_TEXTS.message.saved = settings.message || null;

			Object.keys(LEGACY_STORAGE_KEYS).forEach(function (key) {
				var local = readLegacy(key);
				if (!local) {
					dropLegacy(key);
					return;
				}
				if (settings[key] || !canEdit()) {
					if (settings[key]) dropLegacy(key);
					return;
				}
				putSetting(key, local).done(function () {
					if (key === 'poster') posterDataUrl = local;
					else EDITABLE_TEXTS[key].saved = local;
					dropLegacy(key);
				});
			});
		});
	}

	function editableAttrs(field) {
		return canEdit()
			? ' data-field="' + field + '" contenteditable="true" spellcheck="false" title="Click to edit"'
			: '';
	}

	function esc(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function fmtWhole(value) {
		return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	}

	function fmtAmt(value, mode) {
		if (mode === 'signed' && window.fmtSigned) return window.fmtSigned(value);
		return fmtWhole(value);
	}

	function ymd(d) {
		if (!d) return '';
		if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
		if (typeof moment !== 'undefined') {
			var m = moment.utc(d);
			if (!m.isValid()) m = moment(d);
			if (!m.isValid()) return '';
			return m.utcOffset(8).format('YYYY-MM-DD');
		}
		var dt = d instanceof Date ? d : new Date(d);
		if (isNaN(dt.getTime())) return '';
		var pad = function (n) { return String(n).padStart(2, '0'); };
		return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
	}

	function localYmd(d) {
		return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
	}

	function eventTickets(rolling) {
		var n = Number(rolling) || 0;
		return n > 0 ? Math.floor(n / ROLLING_PER_TICKET) : 0;
	}

	/* ---------- Data ---------- */

	/** Name corrections saved on the Report, by agent id (gi_report_name) */
	var nameOverrides = {};
	/** Rolling corrections for the loaded date range, by agent id (gi_report_rolling) */
	var rollingOverrides = {};

	function canEdit() {
		var p = String($('#user-role').data('permissions'));
		return p !== '2';
	}

	/** Game rows → one entry per account */
	function groupByAccount(rows) {
		var byKey = {};
		var list = [];
		rows.forEach(function (row) {
			var key = row.AGENT_ID != null ? 'a' + row.AGENT_ID : 'c' + String(row.AGENT_CODE || '');
			var acc = byKey[key];
			if (!acc) {
				var override = row.AGENT_ID != null ? nameOverrides[row.AGENT_ID] : null;
				acc = byKey[key] = {
					agent_id: row.AGENT_ID != null ? row.AGENT_ID : null,
					agent_code: row.AGENT_CODE || '—',
					// Account owner's name first; a saved correction replaces it
					owner_name: row.AGENT_NAME || '',
					agent_name: override || row.AGENT_NAME || '',
					name_edited: !!override,
					buy_in: 0,
					cash_out: 0,
					win_loss: 0,
					rolling: 0
				};
				list.push(acc);
			}
			acc.buy_in += parseFloat(row.BUY_IN) || 0;
			acc.cash_out += parseFloat(row.CASH_OUT) || 0;
			acc.win_loss += parseFloat(row.WIN_LOSS) || 0;
			acc.rolling += parseFloat(row.ROLLING) || 0;
		});
		list.forEach(function (acc) {
			// Computed rolling first; a saved correction for this date range replaces it
			acc.original_rolling = acc.rolling;
			var corrected = acc.agent_id != null ? rollingOverrides[acc.agent_id] : undefined;
			acc.rolling_edited = corrected != null && isFinite(corrected);
			if (acc.rolling_edited) acc.rolling = Number(corrected);
			acc.event = eventTickets(acc.rolling);
		});
		return list;
	}

	function buildQuery() {
		if (programFrom && programTo) return { programFrom: programFrom, programTo: programTo };
		return {};
	}

	function reloadData() {
		if (!dataTable) return;
		var gen = ++reloadGeneration;
		dataTable.clear().draw();

		var names = $.getJSON('/game_information_report/names').then(
			function (map) { return map || {}; },
			function () { return $.Deferred().resolve({}).promise(); }
		);
		var rolling = $.getJSON('/game_information_report/rolling', buildQuery()).then(
			function (map) { return map || {}; },
			function () { return $.Deferred().resolve({}).promise(); }
		);
		var games = $.ajax({ url: '/game_information_data', method: 'GET', data: buildQuery() });

		$.when(games, names, rolling)
			.done(function (gamesRes, map, rollingMap) {
				if (gen !== reloadGeneration) return;
				nameOverrides = map || {};
				rollingOverrides = rollingMap || {};
				var rows = gamesRes[0];
				dataTable.rows.add(groupByAccount(Array.isArray(rows) ? rows : [])).draw();
			})
			.fail(function (xhr) {
				console.error('game_information_report data failed', xhr);
			});
	}

	/* ---------- Table ---------- */

	function amountCol(field, mode) {
		return {
			data: field,
			className: 'text-end',
			render: function (value, type) {
				if (type !== 'display') return Number(value) || 0;
				return fmtAmt(value, mode);
			}
		};
	}

	function setGrandTotals(api) {
		var tot = { buy_in: 0, cash_out: 0, win_loss: 0, rolling: 0, event: 0 };
		api.rows({ search: 'applied' }).data().each(function (acc) {
			tot.buy_in += acc.buy_in;
			tot.cash_out += acc.cash_out;
			tot.win_loss += acc.win_loss;
			tot.rolling += acc.rolling;
			tot.event += acc.event;
		});
		$('#GIR_GRAND_BUYIN').html(fmtAmt(tot.buy_in));
		$('#GIR_GRAND_CASHOUT').html(fmtAmt(tot.cash_out));
		$('#GIR_GRAND_WINLOSS').html(fmtAmt(tot.win_loss, 'signed'));
		$('#GIR_GRAND_ROLLING').html(fmtAmt(tot.rolling, 'signed'));
		$('#GIR_GRAND_EVENT').html(fmtWhole(tot.event));
	}

	/** Search box, length menu and the date controls share one white bar above the table */
	function placeControls() {
		var $wrapper = $('#gi-report-tbl_wrapper');
		var $mount = $('#gir-daterange-mount');
		if (!$wrapper.length || !$mount.length || $mount.hasClass('is-placed')) return;
		$wrapper.find('.gir-controls .dataTables_length').after($mount);
		$mount.addClass('is-placed');
	}

	function initDataTable() {
		dataTable = $('#gi-report-tbl').DataTable({
			data: [],
			dom: '<"gir-controls"lf>rt<"d-flex flex-wrap justify-content-between align-items-center mt-2"ip>',
			paging: true,
			pageLength: 25,
			lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
			info: true,
			searching: true,
			ordering: true,
			order: [[5, 'desc']],
			autoWidth: false,
			columns: [
				{ data: null, className: 'text-center', orderable: false, searchable: false, defaultContent: '' },
				{ data: 'agent_code', className: 'text-start' },
				{
					data: 'agent_name',
					className: 'text-start gir-name-cell',
					render: function (v, type, acc) {
						if (type !== 'display') return v;
						var html = '<span class="gir-name-text">' + esc(v || '—') + '</span>';
						if (acc.name_edited) {
							html += ' <i class="fa fa-pen gir-name-edited" title="Corrected — owner name: ' + esc(acc.owner_name || '—') + '" aria-hidden="true"></i>';
						}
						if (canEdit() && acc.agent_id != null) {
							html = '<span class="gir-name-edit" title="Click to correct the name">' + html + '</span>';
						}
						return html;
					}
				},
				amountCol('buy_in'),
				amountCol('cash_out'),
				amountCol('win_loss', 'signed'),
				{
					data: 'rolling',
					className: 'text-end gir-rolling-cell',
					render: function (v, type, acc) {
						if (type !== 'display') return Number(v) || 0;
						var html = fmtAmt(v, 'signed');
						if (acc.rolling_edited) {
							html = '<i class="fa fa-pen gir-name-edited" title="Corrected — computed rolling: ' + esc(fmtWhole(acc.original_rolling)) + '" aria-hidden="true"></i> ' + html;
						}
						if (canEdit() && acc.agent_id != null) {
							html = '<span class="gir-rolling-edit" title="Click to correct the rolling">' + html + '</span>';
						}
						return html;
					}
				},
				{ data: 'event', className: 'text-end', render: function (v, type) { return type === 'display' ? fmtWhole(v) : v; } },
				{
					data: null,
					className: 'text-center',
					orderable: false,
					searchable: false,
					render: function () {
						return '<div class="gir-actions">' +
							'<button type="button" class="btn btn-sm gir-receipt-btn" title="Report"><i class="fa fa-receipt" aria-hidden="true"></i></button>' +
							'</div>';
					}
				}
			],
			language: {
				search: 'Search:',
				lengthMenu: 'Show _MENU_ entries',
				emptyTable: 'No games found'
			},
			drawCallback: function () {
				// # follows the on-screen order
				var api = this.api();
				var start = api.page.info().start;
				api.column(0, { page: 'current' }).nodes().each(function (cell, i) {
					cell.textContent = start + i + 1;
				});
			},
			footerCallback: function () {
				setGrandTotals(this.api());
			},
			initComplete: placeControls
		});
	}

	/* ---------- Date range ---------- */

	function getDefaultCutoffRange() {
		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function') {
			return window.MonthEndCutoffRange.getMonthEndCutoffRange();
		}
		var now = new Date();
		var startAt = new Date(now.getFullYear(), now.getMonth(), 0);
		var endAt = new Date(now.getFullYear(), now.getMonth() + 1, 0);
		endAt.setDate(endAt.getDate() - 1);
		return { startDate: localYmd(startAt), endDate: localYmd(endAt) };
	}

	function syncQuickFilterTabs() {
		$('#gir-quick-filter-wrapper .gi-quick-filter-tab').each(function () {
			var range = $(this).data('range');
			var on = range === 'today' || range === 'yesterday' ? !!dayFilter[range] : range === quickFilter;
			$(this).toggleClass('active', on);
		});
	}

	/** All / Month pick one; Today and Yesterday toggle and can be on together (same as Game Information). */
	function onQuickFilterTab(range) {
		if (range === 'today' || range === 'yesterday') {
			dayFilter[range] = !dayFilter[range];
			applyQuickFilter(dayFilter.today || dayFilter.yesterday ? 'days' : 'month');
			return;
		}
		applyQuickFilter(range);
	}

	function applyQuickFilter(range) {
		var pickerEl = document.getElementById('gir-program-date-range-picker');
		var fp = pickerEl && pickerEl._flatpickr;
		var from = null;
		var to = null;

		if (range === 'days') {
			var today = new Date();
			var yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);
			from = localYmd(dayFilter.yesterday ? yesterday : today);
			to = localYmd(dayFilter.today ? today : yesterday);
		} else {
			dayFilter = { today: false, yesterday: false };
			if (range === 'month') {
				var cutoff = getDefaultCutoffRange();
				from = cutoff.startDate;
				to = cutoff.endDate;
			} else {
				range = 'all';
			}
		}

		quickFilter = range;
		$('#gi-report-start-date, #gi-report-end-date').val('');
		syncQuickFilterTabs();

		if (fp) {
			if (from) fp.setDate([from, to], false);
			else fp.clear(false);
		} else if (pickerEl) {
			pickerEl.value = from ? from + ' to ' + to : '';
		}

		programFrom = from;
		programTo = to;
		reloadData();
	}

	function applyProgramRange(fromDate, toDate) {
		quickFilter = null;
		dayFilter = { today: false, yesterday: false };
		syncQuickFilterTabs();
		programFrom = fromDate <= toDate ? fromDate : toDate;
		programTo = fromDate <= toDate ? toDate : fromDate;
		reloadData();
	}

	function initSplitDateRange() {
		if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') return;
		splitDateRange = window.SplitDateRange.attach({
			rangePickerId: 'gir-program-date-range-picker',
			startId: 'gi-report-start-date',
			endId: 'gi-report-end-date',
			splitWrapperId: 'gi-report-split-daterange-wrapper',
			independent: true,
			invalidDateMessage: 'Invalid date range.',
			onRangeApplied: function (range) {
				if (!range || !range.start || !range.end) return;
				applyProgramRange(range.start, range.end);
			}
		});
	}

	function initProgramDatePicker() {
		var input = document.getElementById('gir-program-date-range-picker');
		if (!input || typeof flatpickr === 'undefined') {
			applyQuickFilter('month');
			return;
		}

		flatpickr(input, {
			mode: 'range',
			skipMonthEndCutoff: true,
			defaultDate: null,
			showMonths: 3,
			allowInput: false,
			onReady: function (_s, _d, instance) {
				if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') window.setupFlatpickrMonthNameRangeSelect(instance);
			},
			onOpen: function (_s, _d, instance) {
				if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') window.setupFlatpickrMonthNameRangeSelect(instance);
			},
			onMonthChange: function (_s, _d, instance) {
				if (typeof window.styleFlatpickrMonthNameClickable === 'function') window.styleFlatpickrMonthNameClickable(instance);
			},
			onChange: function (selectedDates) {
				if (!selectedDates || selectedDates.length !== 2) return;
				applyProgramRange(ymd(selectedDates[0]), ymd(selectedDates[1]));
			}
		});

		applyQuickFilter('month');
	}

	function getDateLabel() {
		if (!programFrom || !programTo) return '';
		var from = programFrom.replace(/-/g, '/');
		var to = programTo.replace(/-/g, '/');
		return from === to ? from : from + ' ~ ' + to;
	}

	/* ---------- REPORT card ---------- */

	/** Negative -> (x) red; positive gets a hidden ")" so digits line up (same as the game receipt) */
	function cardAmount(value) {
		var n = Number(value || 0);
		return n < 0
			? '(' + fmtWhole(Math.abs(n)) + ')'
			: fmtWhole(n) + '<span class="gsr-paren-pad" aria-hidden="true">)</span>';
	}

	function textAmount(value) {
		var n = Number(value || 0);
		return n < 0 ? '(' + fmtWhole(Math.abs(n)) + ')' : fmtWhole(n);
	}

	function cardRows(acc) {
		return [
			{ cls: 'gsr-section-buyin', label: '* BUY IN', value: acc.buy_in },
			{ cls: 'gsr-section-cashout', label: '* CASH OUT', value: -Math.abs(acc.cash_out) },
			{ cls: 'gsr-section-summary', label: '* WIN/LOSS', value: acc.win_loss },
			{ cls: 'gsr-section-summary', label: '* ROLLING', value: acc.rolling }
		];
	}

	function buildCardText(acc, hasEvent) {
		var blocks = [
			['* REPORT *', getDateLabel()],
			[String(acc.agent_code || '').toUpperCase(), String(acc.agent_name || '').toUpperCase()].filter(Boolean),
			cardRows(acc).map(function (r) { return r.label + ' ' + textAmount(r.value); })
		];
		if (hasEvent) blocks.push(['EVENT ' + fmtWhole(acc.event), 'RAFFLE ' + editableText('raffle')]);
		blocks.push([editableText('message')]);
		return blocks.map(function (b) { return b.join('\n'); }).join('\n\n');
	}

	function buildPosterHtml() {
		if (!canEdit()) {
			return '<div class="gir-poster gir-poster--readonly">' +
				(posterDataUrl ? '<img src="' + esc(posterDataUrl) + '" alt="Event poster">' : '') + '</div>';
		}
		var inner = posterDataUrl
			? '<img src="' + esc(posterDataUrl) + '" alt="Event poster">' +
				'<span class="gir-poster-change" data-html2canvas-ignore="true">Change poster</span>'
			: '<span class="gir-poster-empty" data-html2canvas-ignore="true"><i class="fa fa-image" aria-hidden="true"></i>Click to upload event poster</span>';
		return '<label class="gir-poster" title="Upload event poster">' + inner +
			'<input type="file" class="gir-poster-input" accept="image/*" data-html2canvas-ignore="true"></label>';
	}

	function buildCardHtml(acc) {
		var hasEvent = acc.event > 0;
		var tables = cardRows(acc).map(function (r) {
			return '<table class="gsr-table ' + r.cls + '"><tbody><tr class="gsr-total-row">' +
				'<td class="gsr-label">' + esc(r.label) + '</td>' +
				'<td class="gsr-value' + (r.value < 0 ? ' gsr-negative' : '') + '">' + cardAmount(r.value) + '</td>' +
				'</tr></tbody></table>';
		}).join('');

		var main =
			'<div class="gir-main gsr-content">' +
			'<div class="gsr-meta-row"><div class="gsr-meta-tags"></div>' +
			'<div class="gsr-datetime">' + esc(getDateLabel()) + '</div>' +
			'<div class="gsr-meta-spacer"></div></div>' +
			'<p class="gsr-account">' + esc(String(acc.agent_code || '').toUpperCase()) + '</p>' +
			(acc.agent_name ? '<p class="gsr-guest">' + esc(String(acc.agent_name).toUpperCase()) + '</p>' : '') +
			tables +
			'<p class="gir-message gir-editable"' + editableAttrs('message') + '>' + esc(editableText('message')) + '</p>' +
			'</div>';

		var side = hasEvent
			? '<div class="gir-side">' + buildPosterHtml() +
				'<table class="gir-event-tbl"><thead><tr><th>EVENT</th><th>RAFFLE</th></tr></thead>' +
				'<tbody><tr><td>' + fmtWhole(acc.event) + '</td><td class="gir-raffle gir-editable"' + editableAttrs('raffle') + '>' + esc(editableText('raffle')) + '</td></tr></tbody></table>' +
				'</div>'
			: '';

		return (
			'<div class="game-start-receipt-slip game-start-receipt-slip--latest gir-slip' + (hasEvent ? ' gir-slip--event' : '') + '"' +
			' data-receipt-text="' + esc(encodeURIComponent(buildCardText(acc, hasEvent))) + '">' +
			'<div class="game-start-receipt-slip-body">' +
			'<div class="gsr-header gir-header">* REPORT *</div>' +
			'<div class="gir-body">' + main + side + '</div>' +
			'</div>' +
			'<div class="game-start-receipt-slip-actions">' +
			'<button type="button" class="btn btn-sm game-receipt-copy-btn js-gi-receipt-copy-image">Copy image</button>' +
			'<button type="button" class="btn btn-sm game-receipt-copy-btn js-gi-receipt-copy-text">Copy text</button>' +
			'</div>' +
			'</div>'
		);
	}

	function openCard(acc) {
		if (!acc || !window.GameInfoReceipt || typeof window.GameInfoReceipt.openHtml !== 'function') return;
		openAccount = acc;
		window.GameInfoReceipt.openHtml(buildCardHtml(acc));
	}

	/* ---------- Poster upload ---------- */

	/** Scales the picture down before it is saved; resolves to a data URL */
	function readPoster(file) {
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onerror = function () { reject(new Error('Unable to read the image.')); };
			reader.onload = function () {
				var img = new Image();
				img.onerror = function () { reject(new Error('This file is not an image.')); };
				img.onload = function () {
					var scale = Math.min(1, POSTER_MAX_SIDE / Math.max(img.width, img.height));
					var canvas = document.createElement('canvas');
					canvas.width = Math.round(img.width * scale);
					canvas.height = Math.round(img.height * scale);
					canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
					resolve(canvas.toDataURL('image/jpeg', 0.9));
				};
				img.src = reader.result;
			};
			reader.readAsDataURL(file);
		});
	}

	function onPosterChosen(input) {
		var file = input.files && input.files[0];
		if (!file) return;
		readPoster(file)
			.then(function (dataUrl) {
				putSetting('poster', dataUrl)
					.done(function () {
						posterDataUrl = dataUrl;
						dropLegacy('poster');
						if (openAccount) window.GameInfoReceipt.openHtml(buildCardHtml(openAccount));
					})
					.fail(function (xhr) { notifySaveFailed(xhr, 'Failed to save the poster'); });
			})
			.catch(function (err) {
				if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Upload failed', text: err.message });
				else alert(err.message);
			});
	}

	/* ---------- Name / Rolling correction ---------- */

	function parseAmountText(text) {
		var clean = String(text == null ? '' : text).replace(/,/g, '').trim();
		if (/^\(.*\)$/.test(clean)) clean = '-' + clean.slice(1, -1);
		if (clean === '' || isNaN(Number(clean))) return null;
		return Math.round(Number(clean));
	}

	/**
	 * name: owner's name first. rolling: computed rolling first (saved per date range).
	 * An empty value (or the original again) removes the correction.
	 */
	var EDIT_FIELDS = {
		name: {
			inputClass: 'gir-name-input',
			maxlength: 150,
			current: function (acc) { return acc.agent_name; },
			original: function (acc) { return acc.owner_name; },
			isEdited: function (acc) { return acc.name_edited; },
			normalize: function (text) { return String(text || '').replace(/\s+/g, ' ').trim(); },
			url: function (acc) { return '/game_information_report/name/' + encodeURIComponent(acc.agent_id); },
			body: function (value) { return { name: value }; },
			apply: function (acc, value) {
				if (value) nameOverrides[acc.agent_id] = value;
				else delete nameOverrides[acc.agent_id];
				acc.agent_name = value || acc.owner_name;
				acc.name_edited = !!value;
			},
			failMessage: 'Failed to save name'
		},
		rolling: {
			inputClass: 'gir-rolling-input',
			maxlength: 20,
			current: function (acc) { return fmtWhole(acc.rolling); },
			original: function (acc) { return fmtWhole(acc.original_rolling); },
			isEdited: function (acc) { return acc.rolling_edited; },
			// '' = remove the correction, null = not a number
			normalize: function (text) {
				if (!String(text || '').trim()) return '';
				var n = parseAmountText(text);
				return n === null ? null : fmtWhole(n);
			},
			url: function (acc) { return '/game_information_report/rolling/' + encodeURIComponent(acc.agent_id); },
			body: function (value) {
				var q = buildQuery();
				return { programFrom: q.programFrom || '', programTo: q.programTo || '', rolling: value === '' ? null : parseAmountText(value) };
			},
			apply: function (acc, value) {
				var n = value === '' ? null : parseAmountText(value);
				if (n === null) delete rollingOverrides[acc.agent_id];
				else rollingOverrides[acc.agent_id] = n;
				acc.rolling = n === null ? acc.original_rolling : n;
				acc.rolling_edited = n !== null;
				acc.event = eventTickets(acc.rolling);
			},
			failMessage: 'Failed to save rolling'
		}
	};

	/** Click the cell → input; Enter or leaving the field saves, Esc cancels */
	function startCellEdit(cell, field) {
		var cfg = EDIT_FIELDS[field];
		var row = dataTable.row($(cell).closest('tr'));
		var acc = row.data();
		if (!cfg || !acc || acc.agent_id == null || !canEdit() || $(cell).find('input').length) return;

		var $input = $('<input type="text" class="form-control form-control-sm">')
			.addClass(cfg.inputClass)
			.attr('maxlength', cfg.maxlength)
			.val(cfg.current(acc))
			.attr('placeholder', cfg.original(acc) || '');
		$(cell).empty().append($input);
		$input.trigger('focus').trigger('select');

		var done = false;
		function finish(save) {
			if (done) return;
			done = true;
			var value = cfg.normalize($input.val());
			if (save && value === null) {
				row.invalidate().draw(false);
				if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Invalid amount', text: 'Please enter a number.' });
				return;
			}
			// Typing the original again is the same as removing the correction
			if (value === cfg.original(acc)) value = '';
			if (!save || value === (cfg.isEdited(acc) ? cfg.current(acc) : '')) {
				row.invalidate().draw(false);
				return;
			}
			$.ajax({
				url: cfg.url(acc),
				method: 'PUT',
				contentType: 'application/json',
				data: JSON.stringify(cfg.body(value))
			})
				.done(function () {
					cfg.apply(acc, value);
					row.invalidate().draw(false);
				})
				.fail(function (xhr) {
					row.invalidate().draw(false);
					var msg = (xhr.responseJSON && xhr.responseJSON.error) || cfg.failMessage;
					if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: msg });
					else alert(msg);
				});
		}

		$input.on('keydown', function (e) {
			if (e.key === 'Enter') {
				e.preventDefault();
				finish(true);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				finish(false);
			}
		});
		if (field === 'rolling') {
			// Live thousands separators; keeps a leading minus
			$input.on('input', function () {
				var raw = this.value.replace(/[^0-9-]/g, '');
				var neg = raw.charAt(0) === '-';
				var digits = raw.replace(/-/g, '');
				this.value = (neg ? '-' : '') + (digits ? Number(digits).toLocaleString('en-US') : '');
			});
		}
		$input.on('blur', function () { finish(true); });
	}

	/* ---------- Print / Export ---------- */

	function getTablePayload() {
		var headers = [];
		$('#gi-report-tbl thead th').each(function (i, th) {
			if (i < 8) headers.push($(th).text().trim());
		});
		var rows = [];
		var plain = [];
		dataTable.rows({ search: 'applied', order: 'applied' }).data().each(function (acc, i) {
			rows.push([
				String(i + 1),
				acc.agent_code,
				acc.agent_name || '—',
				textAmount(acc.buy_in),
				textAmount(acc.cash_out),
				textAmount(acc.win_loss),
				textAmount(acc.rolling),
				fmtWhole(acc.event)
			]);
			plain.push([i + 1, acc.agent_code, acc.agent_name || '', acc.buy_in, acc.cash_out, acc.win_loss, acc.rolling, acc.event]);
		});
		return { headers: headers, rows: rows, plain: plain };
	}

	function notifyNoData(title) {
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: title, text: 'No data for the current filter.' });
		else alert('No data for the current filter.');
	}

	function printReport() {
		if (!dataTable || !window.gdPrintTable) return;
		var payload = getTablePayload();
		if (!payload.rows.length) {
			notifyNoData('Print');
			return;
		}
		var footer = $('#gi-report-tbl tfoot th').map(function () { return $(this).text().trim(); }).get();
		payload.rows.push([footer[0], '', '', footer[1], footer[2], footer[3], footer[4], footer[5]]);
		window.gdPrintTable({
			title: 'Report',
			subtitle: programFrom && programTo ? programFrom + ' to ' + programTo : '',
			headers: payload.headers,
			rows: payload.rows,
			amountCols: [3, 4, 5, 6, 7],
			leftCols: [1, 2],
			totalRows: 1
		});
	}

	function exportReport() {
		if (!dataTable) return;
		var payload = getTablePayload();
		if (!payload.plain.length) {
			notifyNoData('Export');
			return;
		}
		var filename = programFrom && programTo
			? 'Report_' + programFrom + '_to_' + programTo + '.xlsx'
			: 'Report-export.xlsx';
		var $btn = $('#btn-gir-export').prop('disabled', true);
		fetch('/game_information_report/export_xlsx', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ headers: payload.headers, rows: payload.plain, filename: filename })
		})
			.then(function (res) {
				if (!res.ok) {
					return res.json().catch(function () { return {}; }).then(function (j) {
						throw new Error((j && j.error) || 'Export failed');
					});
				}
				return res.blob();
			})
			.then(function (blob) {
				var link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = filename;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(link.href);
			})
			.catch(function (err) {
				if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Export failed' });
				else alert(err.message || 'Export failed');
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	}

	$(function () {
		if (!document.getElementById('gi-report-tbl')) return;
		initDataTable();
		initSplitDateRange();
		initProgramDatePicker();
		loadSettings();

		$(document).on('click', '#gir-quick-filter-wrapper .gi-quick-filter-tab', function () {
			onQuickFilterTab($(this).data('range'));
		});

		$('#gi-report-tbl tbody').on('click', '.gir-name-edit', function () {
			startCellEdit($(this).closest('td')[0], 'name');
		});
		$('#gi-report-tbl tbody').on('click', '.gir-rolling-edit', function () {
			startCellEdit($(this).closest('td')[0], 'rolling');
		});

		$('#gi-report-tbl tbody').on('click', '.gir-receipt-btn', function (e) {
			e.preventDefault();
			openCard(dataTable.row($(this).closest('tr')).data());
		});

		$(document).on('change', '#modal-game-start-receipt .gir-poster-input', function () {
			onPosterChosen(this);
		});

		// RAFFLE cell and message: typed text is used on every account's card and goes into Copy text too;
		// saved for every user when the field is left
		$(document).on('focus', '#modal-game-start-receipt .gir-editable[data-field]', function () {
			$(this).data('savedValue', EDITABLE_TEXTS[$(this).data('field')].saved);
		});
		$(document).on('input', '#modal-game-start-receipt .gir-editable[data-field]', function () {
			if (!openAccount) return;
			var field = $(this).data('field');
			EDITABLE_TEXTS[field].saved = normalizeText(field, this.textContent);
			$(this).closest('.game-start-receipt-slip')
				.attr('data-receipt-text', encodeURIComponent(buildCardText(openAccount, openAccount.event > 0)));
		});
		$(document).on('keydown', '#modal-game-start-receipt .gir-editable', function (e) {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.blur();
			}
		});
		$(document).on('blur', '#modal-game-start-receipt .gir-editable[data-field]', function () {
			var field = $(this).data('field');
			var before = $(this).data('savedValue') || null;
			var value = normalizeText(field, this.textContent);
			if (!this.textContent.trim()) this.textContent = editableText(field);
			if (value === before) return;
			putSetting(field, value)
				.done(function () { dropLegacy(field); })
				.fail(function (xhr) {
					EDITABLE_TEXTS[field].saved = before;
					notifySaveFailed(xhr, 'Failed to save the text');
				});
		});

		$('#btn-gir-print').on('click', function (e) {
			e.preventDefault();
			printReport();
		});
		$('#btn-gir-export').on('click', function (e) {
			e.preventDefault();
			exportReport();
		});

		if (window.gdAlignParenNumbers) {
			window.gdAlignParenNumbers('.game-information-report-page', ['#gi-report-tbl tbody td.text-end', '#gi-report-tbl tfoot th.text-end']);
		}
	});
})();
