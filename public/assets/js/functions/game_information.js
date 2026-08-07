(function () {
	'use strict';

	var i18n = {};
	try {
		var el = document.getElementById('game-information-i18n');
		if (el && el.textContent) i18n = JSON.parse(el.textContent);
	} catch (e) { /* ignore */ }

	function t(key, fallback) {
		return i18n[key] || fallback || key;
	}

	function fmtAmt(value, mode) {
		if (mode === 'out' && window.fmtOut) return window.fmtOut(value);
		if (mode === 'signed' && window.fmtSigned) return window.fmtSigned(value);
		if (mode === 'in' && window.fmtIn) return window.fmtIn(value);
		var n = parseFloat(value) || 0;
		return n.toLocaleString('en-US');
	}

	function ymd(d) {
		if (!d) return '';
		if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim().slice(0, 10);
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

	function getProgramDateYmd(row) {
		return ymd(row.PROGRAM_DATE);
	}

	function formatGameStart(dt) {
		if (!dt || typeof moment === 'undefined') return '—';
		return moment.utc(dt).utcOffset(8).format('YYYY-MM-DD HH:mm');
	}

	function commissionBadge(row) {
		var type = parseInt(row.COMMISSION_TYPE, 10) || 1;
		var pct = parseFloat(row.COMMISSION_PERCENTAGE) || 0;
		var label = 'R';
		var cls = 'commission-badge-r';
		var title = 'Rolling';
		if (type === 2) {
			label = 'S';
			cls = 'commission-badge-s';
			title = 'Shared';
		} else if (type === 3) {
			label = 'L';
			cls = 'commission-badge-l';
			title = 'Lossing';
		}
		return pct.toFixed(2) + '% <span class="badge commission-badge ' + cls + '" title="' + title + '">' + label + '</span>';
	}

	function isSharedGame(row) {
		return parseInt(row.COMMISSION_TYPE, 10) === 2;
	}

	var GI_DEBUG_SHARED = true;

	function giDebugLog(label, payload) {
		if (!GI_DEBUG_SHARED) return;
		console.log('[GI shared]', label, payload);
	}

	function giSharedSignedCommission(net, winLoss) {
		var n = parseFloat(net) || 0;
		var wl = parseFloat(winLoss) || 0;
		var signed = n;
		if (!n || !wl) {
			giDebugLog('signedCommission (no align)', { net: n, winLoss: wl, signed: n });
			return n;
		}
		if (wl < 0 && n > 0) signed = -n;
		else if (wl > 0 && n < 0) signed = -n;
		giDebugLog('signedCommission', { net: n, winLoss: wl, signed: signed });
		return signed;
	}

	/** Shared games: company view — commission and settle only, as positive amounts. */
	function giSharedPositiveAmount(value, row) {
		if (!isSharedGame(row)) return parseFloat(value) || 0;
		var positive = Math.abs(giSharedSignedCommission(value, row.WIN_LOSS));
		giDebugLog('displayCommission', {
			gameNo: row.GAME_NO,
			rawCommission: parseFloat(value) || 0,
			winLoss: parseFloat(row.WIN_LOSS) || 0,
			displayCommission: positive
		});
		return positive;
	}

	function giSharedSettleAmount(net, addChg, winLoss) {
		var signedNet = giSharedSignedCommission(net, winLoss);
		var displayCommission = Math.abs(signedNet);
		var charge = Math.abs(parseFloat(addChg) || 0);
		var displaySettle = displayCommission - charge;
		giDebugLog('settle', {
			rawCommission: parseFloat(net) || 0,
			winLoss: parseFloat(winLoss) || 0,
			signedCommission: signedNet,
			displayCommission: displayCommission,
			addCharge: parseFloat(addChg) || 0,
			chargeMagnitude: charge,
			formula: displayCommission + ' - ' + charge + ' = ' + displaySettle,
			displaySettle: displaySettle
		});
		return displaySettle;
	}

	var dataTable = null;
	var reloadGeneration = 0;
	var selectedProgramDate = null;
	var programFrom = null;
	var programTo = null;
	var giSplitOverrideRange = null;
	var giSplitDateRange = null;
	var manualGamesById = {};
	var giAccountGuestResetting = false;

	function hasActionColumn() {
		return $('#game_information-tbl thead th').length > 15;
	}

	function emptyActionCell() {
		return hasActionColumn() ? '' : null;
	}

	function formatManualGameEnd(row) {
		return formatGameStart(row.GAME_ENDED);
	}

	function buildManualActionCell(manualId) {
		if (!hasActionColumn()) return '';
		return (
			'<div class="gi-manual-actions">' +
			'<button type="button" class="btn btn-sm btn-alt-primary gi-manual-edit" data-id="' + manualId + '" title="' + t('editGame', 'Edit') + '" data-view-only-disable>' +
			'<i class="fa fa-pencil"></i></button>' +
			'<button type="button" class="btn btn-sm btn-alt-danger gi-manual-delete" data-id="' + manualId + '" title="' + t('deleteGame', 'Delete') + '" data-view-only-disable>' +
			'<i class="fa fa-trash"></i></button>' +
			'</div>'
		);
	}

	function sanitizeAmountInput(value) {
		return String(value || '').replace(/[^\d.-]/g, '');
	}

	function formatAmountInput(value) {
		var cleaned = sanitizeAmountInput(value);
		if (!cleaned || cleaned === '-' || cleaned === '.') return cleaned;
		var negative = cleaned.charAt(0) === '-';
		if (negative) cleaned = cleaned.slice(1);
		var parts = cleaned.split('.');
		var integerPart = parts[0] || '0';
		var decimalPart = parts.length > 1 ? parts[1].slice(0, 2) : '';
		var formattedInteger = Number(integerPart || 0).toLocaleString('en-US');
		var out = decimalPart !== '' ? formattedInteger + '.' + decimalPart : formattedInteger;
		return negative ? '-' + out : out;
	}

	function formatWholeAmountInput(value) {
		var cleaned = sanitizeAmountInput(value);
		if (!cleaned || cleaned === '-') return cleaned;
		var negative = cleaned.charAt(0) === '-';
		if (negative) cleaned = cleaned.slice(1);
		var integerPart = cleaned.split('.')[0] || '0';
		var formattedInteger = Number(integerPart || 0).toLocaleString('en-US');
		return negative ? '-' + formattedInteger : formattedInteger;
	}

	function parseAmountInput(value) {
		var clean = String(value || '').replace(/,/g, '').trim();
		if (clean === '' || Number.isNaN(Number(clean))) return 0;
		return Number(clean);
	}

	function displayAmountInput(value) {
		if (value === null || value === undefined || value === '') return '';
		if (parseAmountInput(value) === 0) return '';
		return formatWholeAmountInput(value);
	}

	function calcManualWinLoss(buyIn, cashOut) {
		return parseAmountInput(buyIn) - parseAmountInput(cashOut);
	}

	function updateManualWinLoss() {
		var winLoss = calcManualWinLoss($('#gi-manual-buy-in').val(), $('#gi-manual-cash-out').val());
		$('#gi-manual-win-loss').val(displayAmountInput(winLoss));
		updateManualCommission();
	}

	function calcManualCommission(commissionType, rolling, winLoss, percentage) {
		var type = parseInt(commissionType, 10) || 1;
		var pct = parseAmountInput(percentage);
		var base = type === 1 ? Math.abs(parseAmountInput(rolling)) : parseAmountInput(winLoss);
		return Math.round((base * pct) / 100);
	}

	function updateManualCommission() {
		var commission = calcManualCommission(
			$('#gi-manual-commission-type').val(),
			$('#gi-manual-rolling').val(),
			$('#gi-manual-win-loss').val(),
			$('#gi-manual-commission-pct').val()
		);
		$('#gi-manual-commission').val(displayAmountInput(commission));
		updateManualSettlement();
	}

	function calcManualSettlement(commission, addCharge, commissionType, winLoss) {
		var net = parseAmountInput(commission);
		var charge = parseAmountInput(addCharge);
		if (parseInt(commissionType, 10) === 2) {
			net = giSharedSignedCommission(net, winLoss);
		}
		return net - charge;
	}

	function updateManualSettlement() {
		var commissionType = $('#gi-manual-commission-type').val();
		var winLoss = calcManualWinLoss($('#gi-manual-buy-in').val(), $('#gi-manual-cash-out').val());
		var settlement;
		if (parseInt(commissionType, 10) === 2) {
			var signedNet = giSharedSignedCommission(parseAmountInput($('#gi-manual-commission').val()), winLoss);
			settlement = Math.abs(signedNet) - Math.abs(parseAmountInput($('#gi-manual-add-charge').val()));
		} else {
			settlement = calcManualSettlement(
				$('#gi-manual-commission').val(),
				$('#gi-manual-add-charge').val(),
				commissionType,
				winLoss
			);
		}
		$('#gi-manual-settlement').val(displayAmountInput(settlement));
	}

	function addRowToTable(row, grand) {
		manualGamesById[row.manual_id] = row;
		var addChg = parseFloat(row.ADD_CHARGE) || 0;
		var net = parseFloat(row.COMMISSION) || 0;
		var settle = parseFloat(row.TOTAL_SETTLEMENT) || 0;
		var rollingNegative = (parseFloat(row.ROLLING) || 0) < 0;
		var sharedGame = isSharedGame(row);
		var displayCommission = sharedGame ? giSharedPositiveAmount(net, row) : net;
		var displaySettle = sharedGame ? giSharedSettleAmount(net, addChg, row.WIN_LOSS) : settle;
		if (sharedGame) {
			giDebugLog('row', {
				gameNo: row.GAME_NO,
				manualId: row.manual_id,
				winLoss: parseFloat(row.WIN_LOSS) || 0,
				rawCommission: net,
				addCharge: addChg,
				storedSettlement: settle,
				displayCommission: displayCommission,
				displaySettle: displaySettle
			});
		}
		var gameType =
			String(row.GAME_TYPE || '').toUpperCase() === 'TELEBET'
				? t('telebet', 'TELEBET')
				: t('live', 'LIVE');

		grand.buyin += parseFloat(row.BUY_IN) || 0;
		grand.cashout += parseFloat(row.CASH_OUT) || 0;
		grand.winloss += parseFloat(row.WIN_LOSS) || 0;
		grand.rolling += parseFloat(row.ROLLING) || 0;
		grand.commission += sharedGame ? displayCommission : net;
		grand.addChg += addChg;
		grand.settle += displaySettle;

		var cells = [
			ymd(row.PROGRAM_DATE) || '—',
			formatGameStart(row.GAME_START),
			gameType,
			row.GAME_NO || '—',
			row.ACCOUNT_TEXT || '—',
			row.GUEST_NAME || '—',
			fmtAmt(row.BUY_IN),
			fmtAmt(row.CASH_OUT, 'out'),
			fmtAmt(row.WIN_LOSS, 'signed'),
			fmtAmt(row.ROLLING, 'signed'),
			commissionBadge(row),
			sharedGame ? fmtAmt(displayCommission) : (rollingNegative ? fmtAmt(Math.abs(net)) : fmtAmt(net, 'out')),
			fmtAmt(addChg, 'out'),
			sharedGame ? fmtAmt(displaySettle) : fmtAmt(settle, 'out'),
			formatManualGameEnd(row)
		];
		var actionCell = buildManualActionCell(row.manual_id);
		if (actionCell !== '') cells.push(actionCell);
		dataTable.row.add(cells);
	}

	function applyGiProgramRange(fromDate, toDate) {
		var from = fromDate;
		var to = toDate;
		if (from > to) {
			var swap = from;
			from = to;
			to = swap;
		}
		programFrom = from;
		programTo = to;
		selectedProgramDate = from;
		reloadData();
	}

	function resetGrandTotals() {
		$('#GI_GRAND_BUYIN, #GI_GRAND_CASHOUT, #GI_GRAND_WINLOSS, #GI_GRAND_ROLLING, #GI_GRAND_COMMISSION, #GI_GRAND_ADD_CHG, #GI_GRAND_SETTLE').text('0.00');
	}

	function setGrandTotals(tots) {
		$('#GI_GRAND_BUYIN').html(fmtAmt(tots.buyin));
		$('#GI_GRAND_CASHOUT').html(fmtAmt(tots.cashout, 'out'));
		$('#GI_GRAND_WINLOSS').html(fmtAmt(tots.winloss, 'signed'));
		$('#GI_GRAND_ROLLING').html(fmtAmt(tots.rolling, 'signed'));
		$('#GI_GRAND_COMMISSION').html(fmtAmt(tots.commission, 'out'));
		$('#GI_GRAND_ADD_CHG').html(fmtAmt(tots.addChg, 'out'));
		$('#GI_GRAND_SETTLE').html(fmtAmt(tots.settle, 'out'));
	}

	function buildQuery() {
		var q = {};
		if (giSplitOverrideRange && giSplitOverrideRange.start && giSplitOverrideRange.end) {
			q.programFrom = giSplitOverrideRange.start;
			q.programTo = giSplitOverrideRange.end;
		} else if (programFrom && programTo) {
			q.programFrom = programFrom;
			q.programTo = programTo;
		} else if (selectedProgramDate) {
			q.date = selectedProgramDate;
		}
		return q;
	}

	function reloadData() {
		if (!dataTable) return;
		var gen = ++reloadGeneration;
		dataTable.clear().draw();
		resetGrandTotals();
		manualGamesById = {};

		var grand = { buyin: 0, cashout: 0, winloss: 0, rolling: 0, commission: 0, addChg: 0, settle: 0 };

		$.ajax({
			url: '/game_information_data',
			method: 'GET',
			data: buildQuery(),
			success: function (rows) {
				if (gen !== reloadGeneration) return;
				rows = Array.isArray(rows) ? rows : [];
				rows.forEach(function (row) {
					addRowToTable(row, grand);
				});
				dataTable.draw();
				setGrandTotals(grand);
			},
			error: function (xhr) {
				console.error('game_information_data failed', xhr);
			}
		});
	}

	function initDataTable() {
		dataTable = $('#game_information-tbl').DataTable({
			paging: true,
			pageLength: 25,
			lengthMenu: [10, 25, 50, 100],
			info: true,
			searching: true,
			ordering: true,
			order: [[3, 'asc']],
			autoWidth: false,
			language: {
				search: 'Search:',
				lengthMenu: 'Show _MENU_',
				emptyTable: t('emptyTable', 'No games found')
			}
		});
	}

	function giApiEndDate(endYmd) {
		if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
		var parts = String(endYmd).slice(0, 10).split('-').map(Number);
		var lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
		if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
			return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
		}
		return endYmd;
	}

	function getDefaultCutoffRange() {
		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function') {
			return window.MonthEndCutoffRange.getMonthEndCutoffRange();
		}
		var now = new Date();
		var startAt = new Date(now.getFullYear(), now.getMonth(), 0);
		var endAt = new Date(now.getFullYear(), now.getMonth() + 1, 0);
		endAt.setDate(endAt.getDate() - 1);
		return {
			defaultDate: [startAt, endAt],
			startDate: ymd(startAt),
			endDate: ymd(endAt),
			endDateApi: ymd(endAt)
		};
	}

	function jumpGiRangeToCurrentThreeMonths(instance) {
		if (!instance) return;
		var now = new Date();
		instance.jumpToDate(new Date(now.getFullYear(), now.getMonth() - 2, 1), false);
	}

	function initGiSplitDateRange() {
		if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
			giSplitDateRange = { syncFromRange: function () {}, fitWidths: function () {}, isSyncing: function () { return false; } };
			return;
		}

		giSplitDateRange = window.SplitDateRange.attach({
			rangePickerId: 'gi-program-date-range-picker',
			startId: 'game-information-start-date',
			endId: 'game-information-end-date',
			splitWrapperId: 'game-information-split-daterange-wrapper',
			independent: true,
			invalidDateMessage: 'Invalid date range.',
			onRangeApplied: function (range) {
				if (!range || !range.start || !range.end) return;
				var fromDate = range.start;
				var toDate = giApiEndDate(range.end);
				giSplitOverrideRange = { start: fromDate, end: toDate };
				applyGiProgramRange(fromDate, toDate);
			}
		});
	}

	window.fitGiSplitDateWidths = function () {
		if (giSplitDateRange && typeof giSplitDateRange.fitWidths === 'function') {
			giSplitDateRange.fitWidths();
		}
	};

	function initProgramDatePicker() {
		var $input = $('#gi-program-date-range-picker');
		var defaultRange = getDefaultCutoffRange();
		programFrom = defaultRange.startDate;
		programTo = giApiEndDate(defaultRange.endDateApi || defaultRange.endDate);
		selectedProgramDate = programFrom;

		if (typeof flatpickr === 'undefined') {
			$input.val((programFrom || '') + ' to ' + (programTo || ''));
			reloadData();
			return;
		}

		flatpickr($input[0], {
			mode: 'range',
			showMonths: 3,
			allowInput: false,
			onReady: function (_selectedDates, _dateStr, instance) {
				jumpGiRangeToCurrentThreeMonths(instance);
				if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
					window.setupFlatpickrMonthNameRangeSelect(instance);
				}
			},
			onOpen: function (_selectedDates, _dateStr, instance) {
				jumpGiRangeToCurrentThreeMonths(instance);
				if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
					window.setupFlatpickrMonthNameRangeSelect(instance);
				}
			},
			onMonthChange: function (_selectedDates, _dateStr, instance) {
				if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
					window.styleFlatpickrMonthNameClickable(instance);
				}
			},
			onChange: function (selectedDates) {
				if (!selectedDates || selectedDates.length !== 2) return;
				giSplitOverrideRange = null;
				var d0 = ymd(selectedDates[0]);
				var d1 = giApiEndDate(ymd(selectedDates[1]));
				applyGiProgramRange(d0, d1);
			}
		});

		reloadData();
	}

	function getManualModalEl() {
		return document.getElementById('modal-gi-manual-game');
	}

	function showManualModal() {
		var el = getManualModalEl();
		if (!el) return;
		if (window.bootstrap && bootstrap.Modal) {
			bootstrap.Modal.getOrCreateInstance(el).show();
			return;
		}
		$('#modal-gi-manual-game').modal('show');
	}

	function hideManualModal() {
		var el = getManualModalEl();
		if (!el) return;
		if (window.bootstrap && bootstrap.Modal) {
			var instance = bootstrap.Modal.getInstance(el);
			if (instance) {
				instance.hide();
				return;
			}
		}
		$('#modal-gi-manual-game').modal('hide');
	}

	function destroyFlatpickr(el) {
		if (el && el._flatpickr) {
			try { el._flatpickr.destroy(); } catch (e) { /* ignore */ }
		}
	}

	function initManualDatePicker(el, options) {
		if (!el) return;
		destroyFlatpickr(el);
		if (typeof flatpickr === 'undefined') return;
		flatpickr(el, options || {});
	}

	function getDefaultGameRatePct(commissionType) {
		var type = parseInt(commissionType, 10);
		if (type === 1) return 1.5;
		if (type === 2 || type === 3) return 50;
		return 1.5;
	}

	function setDefaultGameRatePct() {
		var pct = getDefaultGameRatePct($('#gi-manual-commission-type').val());
		$('#gi-manual-commission-pct').val(formatAmountInput(pct));
		updateManualCommission();
	}

	function initManualDateTimePicker(el, defaultDate) {
		initManualDatePicker(el, {
			enableTime: true,
			dateFormat: 'Y-m-d H:i',
			allowInput: true,
			defaultDate: defaultDate || null
		});
	}

	function initGiAccountSelect() {
		var $sel = $('#gi-manual-account');
		if (!$sel.length || typeof $sel.select2 !== 'function') return;
		if ($sel.data('select2')) {
			try { $sel.select2('destroy'); } catch (e) { /* ignore */ }
		}
		$sel.select2({
			placeholder: $sel.data('placeholder') || 'Choose account',
			allowClear: true,
			dropdownParent: $('#modal-gi-manual-game')
		});
	}

	function initGiGuestSelect() {
		var $sel = $('#gi-manual-guest');
		if (!$sel.length || typeof $sel.select2 !== 'function') return;
		if ($sel.data('select2')) {
			try { $sel.select2('destroy'); } catch (e) { /* ignore */ }
		}
		$sel.select2({
			placeholder: $sel.data('placeholder') || 'Choose guest',
			allowClear: true,
			dropdownParent: $('#modal-gi-manual-game')
		});
	}

	function clearGiGuestOptions() {
		var $sel = $('#gi-manual-guest');
		if (!$sel.length) return;
		var placeholder = $sel.data('placeholder') || 'Choose guest';
		if ($sel.data('select2')) {
			try { $sel.select2('destroy'); } catch (e) { /* ignore */ }
		}
		$sel.empty().append($('<option/>', { value: '', text: placeholder }));
		$sel.val('').prop('disabled', true);
		initGiGuestSelect();
	}

	function loadGiAccounts(selectedId) {
		var $sel = $('#gi-manual-account');
		var placeholder = $sel.data('placeholder') || 'Choose account';
		return $.getJSON('/account_data').then(function (rows) {
			if ($sel.data('select2')) {
				try { $sel.select2('destroy'); } catch (e) { /* ignore */ }
			}
			$sel.empty().append($('<option/>', { value: '', text: placeholder }));
			(rows || []).forEach(function (a) {
				var id = a.account_id;
				if (id == null) return;
				var parts = [a.agent_code, a.agent_name].filter(Boolean);
				var label = parts.length ? parts.join(' - ') : 'Account #' + id;
				$sel.append(
					$('<option/>', {
						value: String(id),
						text: label,
						'data-agent-id': a.agent_id != null ? String(a.agent_id) : ''
					})
				);
			});
			initGiAccountSelect();
			if (selectedId) {
				$sel.val(String(selectedId)).trigger('change.select2');
			}
		});
	}

	function loadGiGuests(agentId, selectedId) {
		var $sel = $('#gi-manual-guest');
		var placeholder = $sel.data('placeholder') || 'Choose guest';

		clearGiGuestOptions();
		if (!agentId) {
			return $.Deferred().resolve().promise();
		}

		return $.getJSON('/guest_data?agentId=' + encodeURIComponent(agentId)).then(function (rows) {
			if ($sel.data('select2')) {
				try { $sel.select2('destroy'); } catch (e) { /* ignore */ }
			}
			$sel.empty().append($('<option/>', { value: '', text: placeholder }));
			(rows || []).forEach(function (g) {
				var id = g.guest_id;
				if (id == null) return;
				var name = (g.guest_name || '').toString().trim() || ('Guest #' + id);
				$sel.append($('<option/>', { value: String(id), text: name }));
			});
			$sel.prop('disabled', false);
			initGiGuestSelect();
			if (selectedId) {
				$sel.val(String(selectedId)).trigger('change.select2');
			}
		});
	}

	function parseGiSelectId(value) {
		var raw = String(value || '').trim();
		if (!raw) return null;
		var n = parseInt(raw, 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	}

	function onGiAccountChange() {
		if (giAccountGuestResetting) return;
		var $accountSel = $('#gi-manual-account');
		var accountId = ($accountSel.val() || '').toString().trim();
		var agentId = accountId
			? ($accountSel.find('option:selected').data('agent-id') || '').toString().trim()
			: '';
		loadGiGuests(agentId || null).fail(function () {
			notifyError('Failed to load guests.');
		});
	}

	function resetGiAccountGuestFields() {
		giAccountGuestResetting = true;
		var $accountSel = $('#gi-manual-account');
		if ($accountSel.data('select2')) {
			$accountSel.val('').trigger('change.select2');
		} else {
			$accountSel.val('');
		}
		clearGiGuestOptions();
		giAccountGuestResetting = false;
	}

	function loadGiAccountGuestFields(row) {
		var accountId = row && row.ACCOUNT_ID ? row.ACCOUNT_ID : null;
		var guestId = row && row.GUEST_ID ? row.GUEST_ID : null;

		giAccountGuestResetting = true;
		clearGiGuestOptions();
		return loadGiAccounts(accountId).then(function () {
			var $accountSel = $('#gi-manual-account');
			var selectedAccountId = ($accountSel.val() || '').toString().trim();
			if (!selectedAccountId) {
				giAccountGuestResetting = false;
				return;
			}
			var agentId = ($accountSel.find('option:selected').data('agent-id') || '').toString().trim();
			return loadGiGuests(agentId || null, guestId);
		}).always(function () {
			giAccountGuestResetting = false;
		});
	}

	function resetManualForm() {
		$('#gi-manual-id').val('');
		$('#modal-gi-manual-game-label').text(t('addGame', 'Add Game'));
		$('#gi-manual-game-no').val('');
		resetGiAccountGuestFields();
		$('#gi-manual-game-type').val('LIVE');
		$('#gi-manual-commission-type').val('1');
		$('.gi-manual-amount').val('');
		setDefaultGameRatePct();
		updateManualWinLoss();

		var today = ymd(new Date());
		var now = new Date();
		initManualDatePicker(document.getElementById('gi-manual-program-date'), {
			enableTime: false,
			dateFormat: 'Y-m-d',
			allowInput: true,
			defaultDate: today
		});
		initManualDateTimePicker(document.getElementById('gi-manual-game-start'), now);
		initManualDateTimePicker(document.getElementById('gi-manual-game-end'), now);
	}

	function fillManualForm(row) {
		$('#gi-manual-id').val(row.manual_id);
		$('#modal-gi-manual-game-label').text(t('editGame', 'Edit Game'));
		$('#gi-manual-game-no').val(row.GAME_NO || '');
		$('#gi-manual-game-type').val(String(row.GAME_TYPE || 'LIVE').toUpperCase() === 'TELEBET' ? 'TELEBET' : 'LIVE');
		$('#gi-manual-commission-type').val(String(row.COMMISSION_TYPE || '1'));
		$('#gi-manual-buy-in').val(displayAmountInput(row.BUY_IN));
		$('#gi-manual-cash-out').val(displayAmountInput(row.CASH_OUT));
		updateManualWinLoss();
		$('#gi-manual-rolling').val(displayAmountInput(row.ROLLING));
		$('#gi-manual-add-charge').val(displayAmountInput(row.ADD_CHARGE));
		$('#gi-manual-commission-pct').val(formatAmountInput(row.COMMISSION_PERCENTAGE));
		updateManualCommission();

		initManualDatePicker(document.getElementById('gi-manual-program-date'), {
			enableTime: false,
			dateFormat: 'Y-m-d',
			allowInput: true,
			defaultDate: ymd(row.PROGRAM_DATE) || ymd(new Date())
		});
		initManualDateTimePicker(document.getElementById('gi-manual-game-start'), row.GAME_START || null);
		initManualDateTimePicker(document.getElementById('gi-manual-game-end'), row.GAME_ENDED || null);
	}

	function openGiManualModal(row) {
		resetManualForm();
		if (row) fillManualForm(row);
		showManualModal();
		if (row) {
			loadGiAccountGuestFields(row).fail(function () {
				notifyError('Failed to load account or guest list.');
			});
			return;
		}
		loadGiAccounts().fail(function () {
			notifyError('Failed to load accounts.');
		});
	}

	function getManualPickerValue(id) {
		var el = document.getElementById(id);
		if (!el) return '';
		if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates[0]) {
			if (id === 'gi-manual-program-date') return ymd(el._flatpickr.selectedDates[0]);
			return el._flatpickr.formatDate(el._flatpickr.selectedDates[0], 'Y-m-d H:i');
		}
		return String(el.value || '').trim();
	}

	function collectManualPayload() {
		var winLoss = calcManualWinLoss($('#gi-manual-buy-in').val(), $('#gi-manual-cash-out').val());
		var commission = calcManualCommission(
			$('#gi-manual-commission-type').val(),
			$('#gi-manual-rolling').val(),
			winLoss,
			$('#gi-manual-commission-pct').val()
		);
		var addCharge = parseAmountInput($('#gi-manual-add-charge').val());
		var signedCommission = parseInt($('#gi-manual-commission-type').val(), 10) === 2
			? giSharedSignedCommission(commission, winLoss)
			: commission;
		return {
			programDate: getManualPickerValue('gi-manual-program-date'),
			gameStart: getManualPickerValue('gi-manual-game-start'),
			gameType: $('#gi-manual-game-type').val(),
			gameNo: $('#gi-manual-game-no').val(),
			accountId: parseGiSelectId($('#gi-manual-account').val()),
			guestId: parseGiSelectId($('#gi-manual-guest').val()),
			buyIn: parseAmountInput($('#gi-manual-buy-in').val()),
			cashOut: parseAmountInput($('#gi-manual-cash-out').val()),
			winLoss: winLoss,
			rolling: parseAmountInput($('#gi-manual-rolling').val()),
			commissionType: $('#gi-manual-commission-type').val(),
			commissionPercentage: parseAmountInput($('#gi-manual-commission-pct').val()),
			commission: signedCommission,
			addCharge: addCharge,
			totalSettlement: signedCommission - addCharge,
			gameEnded: getManualPickerValue('gi-manual-game-end')
		};
	}

	function notifySuccess(message) {
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'success', title: 'Success', text: message, timer: 1400, showConfirmButton: false });
			return;
		}
		alert(message);
	}

	function notifyError(message) {
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'error', title: 'Error', text: message });
			return;
		}
		alert(message);
	}

	function saveManualGame(e) {
		if (e) e.preventDefault();
		if (!parseGiSelectId($('#gi-manual-account').val())) {
			notifyError(t('accountRequired', 'Acct No / Name is required.'));
			var $accountSel = $('#gi-manual-account');
			if ($accountSel.data('select2')) {
				$accountSel.select2('open');
			} else {
				$accountSel.trigger('focus');
			}
			return;
		}
		var manualId = $('#gi-manual-id').val();
		var payload = collectManualPayload();
		var url = manualId ? '/game_information_data/' + manualId : '/game_information_data';
		var method = manualId ? 'PUT' : 'POST';

		$.ajax({
			url: url,
			method: method,
			contentType: 'application/json',
			data: JSON.stringify(payload),
			success: function () {
				hideManualModal();
				notifySuccess(manualId ? t('updated', 'Updated successfully') : t('saved', 'Saved successfully'));
				reloadData();
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) || t('saveFailed', 'Failed to save game');
				notifyError(msg);
			}
		});
	}

	function deleteManualGame(manualId) {
		var runDelete = function () {
			$.ajax({
				url: '/game_information_data/remove/' + manualId,
				method: 'PUT',
				success: function () {
					notifySuccess(t('deleted', 'Deleted successfully'));
					reloadData();
				},
				error: function (xhr) {
					var msg = (xhr.responseJSON && xhr.responseJSON.error) || t('saveFailed', 'Failed to delete game');
					notifyError(msg);
				}
			});
		};

		if (typeof Swal !== 'undefined') {
			Swal.fire({
				icon: 'warning',
				title: t('deleteConfirm', 'Delete this game?'),
				showCancelButton: true,
				confirmButtonText: 'Delete',
				cancelButtonText: t('cancel', 'Cancel')
			}).then(function (result) {
				if (result.isConfirmed) runDelete();
			});
			return;
		}
		if (window.confirm(t('deleteConfirm', 'Delete this game?'))) runDelete();
	}

	function initManualGameHandlers() {
		$(document).on('click', '#btn-add-gi-manual-game', function () {
			openGiManualModal(null);
		});

		$(document).on('click', '.gi-manual-edit', function () {
			var manualId = $(this).data('id');
			var row = manualGamesById[manualId];
			if (!row) return;
			openGiManualModal(row);
		});

		$(document).on('change', '#gi-manual-account', onGiAccountChange);

		$(document).on('click', '.gi-manual-delete', function () {
			var manualId = $(this).data('id');
			if (!manualId) return;
			deleteManualGame(manualId);
		});

		$(document).on('change', '#gi-manual-commission-type', setDefaultGameRatePct);
		$(document).on('input', '.gi-manual-amount, #gi-manual-commission-pct', function () {
			if (this.id === 'gi-manual-win-loss' || this.id === 'gi-manual-settlement' || this.id === 'gi-manual-commission') return;
			var formatted = this.id === 'gi-manual-commission-pct'
				? formatAmountInput($(this).val())
				: formatWholeAmountInput($(this).val());
			$(this).val(formatted);
			if (this.id === 'gi-manual-buy-in' || this.id === 'gi-manual-cash-out') {
				updateManualWinLoss();
			} else if (this.id === 'gi-manual-rolling' || this.id === 'gi-manual-commission-pct') {
				updateManualCommission();
			} else if (this.id === 'gi-manual-add-charge') {
				updateManualSettlement();
			}
		});
		$(document).on('submit', '#gi-manual-game-form', saveManualGame);
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function getGiActionColIndex() {
		if (!hasActionColumn()) return -1;
		return $('#game_information-tbl thead th').length - 1;
	}

	function getGiDateRangeLabel() {
		if (programFrom && programTo) return programFrom + ' to ' + programTo;
		return '';
	}

	function getGiTablePayload(includeFooter) {
		if (!dataTable) return { headers: [], rows: [], dataRowCount: 0 };
		var actionColIndex = getGiActionColIndex();
		var headers = [];
		$('#game_information-tbl thead tr:first th').each(function (i) {
			if (i === actionColIndex) return;
			headers.push($(this).text().trim());
		});

		var rows = [];
		dataTable.rows({ search: 'applied' }).every(function () {
			var cells = [];
			$(this.node()).find('td').each(function (i) {
				if (i === actionColIndex) return;
				cells.push($(this).text().trim());
			});
			if (cells.length) rows.push(cells);
		});

		var dataRowCount = rows.length;
		if (includeFooter && dataRowCount) {
			rows.push([
				'',
				'',
				'',
				'',
				'',
				$('#game_information-tbl tfoot th').eq(0).text().trim(),
				$('#GI_GRAND_BUYIN').text().trim(),
				$('#GI_GRAND_CASHOUT').text().trim(),
				$('#GI_GRAND_WINLOSS').text().trim(),
				$('#GI_GRAND_ROLLING').text().trim(),
				'',
				$('#GI_GRAND_COMMISSION').text().trim(),
				$('#GI_GRAND_ADD_CHG').text().trim(),
				$('#GI_GRAND_SETTLE').text().trim(),
				''
			]);
		}

		return { headers: headers, rows: rows, dataRowCount: dataRowCount };
	}

	function getGiPrintStyles() {
		return [
			'@page{size:landscape;margin:8mm;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'.print-wrap{width:100%;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
			'table{width:100%;border-collapse:collapse;font-size:8px;}',
			'th,td{border:1px solid #777;padding:4px 6px;vertical-align:middle;}',
			'th{background:#d9e1f2;font-weight:700;}',
			'tbody tr:last-child td{font-weight:700;background:#f4f6fa;}'
		].join('');
	}

	function notifyGiNoData(mode) {
		var title = mode === 'print' ? t('print', 'Print') : t('export', 'Export');
		var text = t('noData', 'No data to export for the current filter.');
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'info', title: title, text: text, confirmButtonColor: '#0d6efd' });
		} else {
			alert(text);
		}
	}

	function printGiTable() {
		if (!dataTable) return;
		var payload = getGiTablePayload(true);
		if (!payload.dataRowCount) {
			notifyGiNoData('print');
			return;
		}

		var headerHtml = payload.headers.map(function (h) {
			return '<th>' + escapeHtml(h) + '</th>';
		}).join('');
		var rowsHtml = payload.rows.map(function (row) {
			return '<tr>' + row.map(function (cell) {
				return '<td>' + escapeHtml(cell) + '</td>';
			}).join('') + '</tr>';
		}).join('');

		var iframe = document.createElement('iframe');
		iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
		document.body.appendChild(iframe);

		var frameWindow = iframe.contentWindow;
		var frameDoc = frameWindow.document;
		frameDoc.open();
		frameDoc.write([
			'<!doctype html><html><head><title>Game Information</title><style>',
			getGiPrintStyles(),
			'</style></head><body><div class="print-wrap">',
			'<h2>Game Information</h2>',
			'<div class="subtitle">', escapeHtml(getGiDateRangeLabel()), '</div>',
			'<table><thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody></table>',
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
			frameWindow.focus();
			frameWindow.print();
			cleanup();
		}, 250);
	}

	function getGiExportFilename() {
		if (programFrom && programTo) {
			return 'Game_Information_' + programFrom + '_to_' + programTo + '.xlsx';
		}
		return 'Game_Information-export.xlsx';
	}

	function exportGiTable() {
		if (!dataTable) return;
		var payload = getGiTablePayload(false);
		if (!payload.dataRowCount) {
			notifyGiNoData('export');
			return;
		}

		var outName = getGiExportFilename();
		var $btn = $('#btn-gi-export');
		$btn.prop('disabled', true);
		fetch('/game_information/export_xlsx', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({
				headers: payload.headers,
				rows: payload.rows,
				filename: outName
			})
		})
			.then(function (res) {
				if (!res.ok) {
					return res.json().catch(function () { return {}; }).then(function (j) {
						throw new Error((j && j.error) ? j.error : 'Export failed');
					});
				}
				return res.blob();
			})
			.then(function (blob) {
				var link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = outName;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(link.href);
			})
			.catch(function (err) {
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Export failed', confirmButtonColor: '#0d6efd' });
				} else {
					alert(err.message || 'Export failed');
				}
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	}

	$(function () {
		initDataTable();
		initGiSplitDateRange();
		initProgramDatePicker();
		initManualGameHandlers();

		$('#btn-gi-print').on('click', function (e) {
			e.preventDefault();
			printGiTable();
		});
		$('#btn-gi-export').on('click', function (e) {
			e.preventDefault();
			exportGiTable();
		});
	});
})();
