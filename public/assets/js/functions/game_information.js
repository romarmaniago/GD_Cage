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
		var raw = row.PROGRAM_DATE;
		if (!raw && row.GAME_DATE_START) raw = row.GAME_DATE_START;
		return ymd(raw);
	}

	function formatGameStart(dt) {
		if (!dt || typeof moment === 'undefined') return '—';
		return moment.utc(dt).utcOffset(8).format('YYYY-MM-DD HH:mm');
	}

	function formatGameEnd(row) {
		var status = parseInt(row.game_status, 10);
		if (status === 2) return t('onGame', 'ON GAME');
		if (status === 3) return 'PENDING';
		if (status === 1 && row.GAME_ENDED) return formatGameStart(row.GAME_ENDED);
		return t('endGame', 'END GAME');
	}

	function commissionBadge(row) {
		var type = parseInt(row.COMMISSION_TYPE, 10);
		var pct = parseFloat(row.COMMISSION_PERCENTAGE) || 0;
		var label = 'R';
		var cls = 'commission-badge-r';
		if (type === 2) { label = 'S'; cls = 'commission-badge-s'; }
		else if (type === 3) { label = 'L'; cls = 'commission-badge-l'; }
		return pct.toFixed(2) + '% <span class="badge commission-badge ' + cls + '">' + label + '</span>';
	}

	function computeTotals(records) {
		var total_buy_in = 0;
		var total_nn_init = 0;
		var total_cc_init = 0;
		var total_nn = 0;
		var total_cc = 0;
		var total_cash_out_nn = 0;
		var total_cash_out_cc = 0;
		var total_rolling = 0;
		var total_rolling_nn = 0;
		var total_rolling_real = 0;
		var total_rolling_nn_real = 0;
		var total_rolling_cc_real = 0;
		var total_roller_return_cc = 0;

		(records || []).forEach(function (res) {
			var cage = parseInt(res.CAGE_TYPE, 10);
			if (cage === 1 && (total_nn_init !== 0 || total_cc_init !== 0)) {
				total_buy_in += parseFloat(res.AMOUNT) || 0;
				total_nn += parseFloat(res.NN_CHIPS) || 0;
				total_cc += parseFloat(res.CC_CHIPS) || 0;
			}
			if (total_nn_init === 0 && total_cc_init === 0 && cage === 1) {
				total_nn_init += parseFloat(res.NN_CHIPS) || 0;
				total_cc_init += parseFloat(res.CC_CHIPS) || 0;
			}
			if (cage === 2) {
				total_cash_out_nn += parseFloat(res.NN_CHIPS) || 0;
				total_cash_out_cc += parseFloat(res.CC_CHIPS) || 0;
			}
			if (cage === 3) {
				total_rolling += parseFloat(res.AMOUNT) || 0;
				total_rolling_nn += parseFloat(res.NN_CHIPS) || 0;
			}
			if (cage === 4) {
				total_rolling_real += parseFloat(res.AMOUNT) || 0;
				total_rolling_nn_real += parseFloat(res.NN_CHIPS) || 0;
				total_rolling_cc_real += parseFloat(res.CC_CHIPS) || 0;
			}
			if (cage === 5) {
				var rollerTxn = parseInt(res.ROLLER_TRANSACTION, 10) || 1;
				if (rollerTxn === 2) {
					total_roller_return_cc += parseFloat(res.ROLLER_CC_CHIPS) || 0;
				}
			}
		});

		var total_initial = total_nn_init + total_cc_init;
		var total_buy_in_chips = total_nn + total_cc;
		var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
		var total_amount = total_buy_in_chips + total_initial;
		var total_rolling_chips =
			total_rolling_nn +
			total_roller_return_cc +
			total_rolling +
			total_rolling_real +
			total_rolling_nn_real +
			total_rolling_cc_real -
			total_cash_out_nn;
		var WinLoss = total_amount - total_cash_out_chips;

		return {
			buyin: total_amount,
			cashout: total_cash_out_chips,
			winloss: WinLoss,
			rolling: total_rolling_chips
		};
	}

	var dataTable = null;
	var reloadGeneration = 0;
	var selectedProgramDate = null;
	var programFrom = null;
	var programTo = null;
	var giSplitOverrideRange = null;
	var giSplitDateRange = null;

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

		$.ajax({
			url: '/game_information_data',
			method: 'GET',
			data: buildQuery(),
			success: function (rows) {
				if (gen !== reloadGeneration) return;
				rows = Array.isArray(rows) ? rows : [];
				if (!rows.length) return;

				var pending = rows.length;
				var grand = { buyin: 0, cashout: 0, winloss: 0, rolling: 0, commission: 0, addChg: 0, settle: 0 };

				rows.forEach(function (row) {
					$.ajax({
						url: '/game_list/' + row.game_list_id + '/record',
						method: 'GET',
						success: function (records) {
							if (gen !== reloadGeneration) return;
							var totals = computeTotals(records);
							var addChg = parseFloat(row.ADD_CHG) || 0;
							var net = 0;
							var pct = parseFloat(row.COMMISSION_PERCENTAGE) || 0;
							var cType = parseInt(row.COMMISSION_TYPE, 10);
							if (cType === 1 || cType === 3) {
								net = Math.round((totals.rolling * pct) / 100);
							} else if (cType === 2) {
								net = Math.round((totals.winloss * pct) / 100);
							}
							var settle = net - addChg;

							grand.buyin += totals.buyin;
							grand.cashout += totals.cashout;
							grand.winloss += totals.winloss;
							grand.rolling += totals.rolling;
							grand.commission += net;
							grand.addChg += addChg;
							grand.settle += settle;

							var acct =
								(row.agent_code || '') +
								(row.agent_name ? ' - ' + row.agent_name : '');
							var programDate = getProgramDateYmd(row) || '—';
							var gameType =
								String(row.GAME_TYPE || '').toUpperCase() === 'TELEBET'
									? t('telebet', 'TELEBET')
									: t('live', 'LIVE');

							dataTable.row.add([
								programDate,
								formatGameStart(row.GAME_DATE_START),
								gameType,
								row.game_list_id,
								acct || '—',
								row.guest_name || '—',
								fmtAmt(totals.buyin),
								fmtAmt(totals.cashout, 'out'),
								fmtAmt(totals.winloss, 'signed'),
								fmtAmt(totals.rolling, 'signed'),
								commissionBadge(row),
								fmtAmt(net, 'out'),
								fmtAmt(addChg, 'out'),
								fmtAmt(settle, 'out'),
								formatGameEnd(row)
							]);

							pending--;
							if (pending === 0) {
								dataTable.draw();
								setGrandTotals(grand);
							}
						},
						error: function () {
							pending--;
							if (pending === 0) {
								dataTable.draw();
								setGrandTotals(grand);
							}
						}
					});
				});
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

	$(function () {
		initDataTable();
		initGiSplitDateRange();
		initProgramDatePicker();
	});
})();
