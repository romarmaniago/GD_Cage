/* global flatpickr, moment, bootstrap, Swal */
$(document).ready(function () {
	if (!$('#commission-settlement-tbl').length) {
		return;
	}

	var t = window.commissionSettlementTranslations || {};

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function parseNumCell(value, options) {
		options = options || {};
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value : 0;
		}
		var raw = String(value == null ? '' : value);
		if (raw.indexOf('<') !== -1) {
			var tmp = document.createElement('div');
			tmp.innerHTML = raw;
			raw = (tmp.textContent || tmp.innerText || raw).trim();
		} else {
			raw = raw.trim();
		}
		var isParenNegative = /^\(\s*[\d,.]+\s*\)$/.test(raw);
		var cleaned = raw.replace(/,/g, '').replace(/[()]/g, '').replace(/[^\d.-]/g, '').trim();
		if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
		var n = parseFloat(cleaned);
		if (!isFinite(n)) return 0;
		n = Math.abs(n);
		if (options.signed) {
			if (isParenNegative || /^-/.test(raw)) return -n;
			return n;
		}
		return n;
	}

	function formatAmount(num) {
		return Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	}

	function fmtSigned(value) {
		if (window.fmtSigned) return window.fmtSigned(value);
		var n = Number(value) || 0;
		return formatAmount(n);
	}

	function getShareRollingPct(commissionType, commissionPercentage) {
		var rate = parseNumCell(commissionPercentage);
		var type = parseInt(commissionType, 10);
		var shareDecimal = rate / 100;
		if (type === 2) return { sharePct: shareDecimal, rollingPct: 0 };
		if (type === 1 || type === 3) return { sharePct: 0, rollingPct: 1 };
		return { sharePct: 0, rollingPct: 0 };
	}

	function formatPctDisplay(decimal) {
		if (!decimal) return '0%';
		var pct = Math.round(decimal * 10000) / 100;
		return parseFloat(pct.toFixed(2)) + '%';
	}

	function getRollingRateDecimal() {
		var raw = String($('#commission-settlement-rolling-rate').val() || '1.5').replace(/%/g, '').trim();
		var n = parseFloat(raw);
		if (!isFinite(n) || n < 0) return 0.015;
		return n / 100;
	}

	function computeSettlementAmounts(winLoss, rolling, sharePct, rollingPct) {
		var rate = getRollingRateDecimal();
		var sharePart = Math.round(-winLoss * sharePct);
		var rollingPart = Math.round(-rolling * rollingPct * rate);
		var settlement = sharePart + rollingPart;
		var actualSettlement = Math.round(-rolling * rate);
		return { settlement: settlement, actualSettlement: actualSettlement };
	}

	function categorizeGameServices(services) {
		var fnb = 0;
		var hotel = 0;
		var incidental = 0;
		(services || []).forEach(function (item) {
			var amt = (parseFloat(item.AMOUNT) || 0) + (parseFloat(item.DELIVERY_FEE) || 0);
			var svc = String(item.SERVICE_TYPE || '').toLowerCase().trim();
			if (svc === 'hotel') hotel += amt;
			else if (svc === 'fnb' || svc === 'f & b') fnb += amt;
			else incidental += amt;
		});
		return {
			fnb: Math.round(fnb),
			hotel: Math.round(hotel),
			incidental: Math.round(incidental)
		};
	}

	function parseCommissionDisplayDate(value) {
		var raw = String(value == null ? '' : value).trim();
		if (!raw || raw === '-') return null;
		var formats = [
			'YYYY-MM-DD HH:mm',
			'DD MMM, YYYY HH:mm:ss',
			'MMMM DD, YYYY HH:mm:ss',
			'MMMM DD, YYYY',
			'MMM DD, YYYY',
			moment.ISO_8601
		];
		var m = moment.utc(raw, formats, true);
		if (m.isValid()) return m;
		m = moment(raw, formats, true);
		return m.isValid() ? m : null;
	}

	function formatCommissionProgramDate(row) {
		var raw = row.PROGRAM_DATE || row.GAME_DATE_START;
		if (!raw) return '-';
		return moment.utc(raw).utcOffset(8).format('YYYY-MM-DD');
	}

	function formatCommissionGameStart(row) {
		if (!row.GAME_DATE_START) return '-';
		var m = moment.utc(row.GAME_DATE_START);
		if (!m.isValid()) return '-';
		return m.utcOffset(8).format('YYYY-MM-DD HH:mm');
	}

	function formatCommissionGameEnd(row) {
		if (!row.GAME_ENDED) return '-';
		var m = moment.utc(row.GAME_ENDED);
		if (!m.isValid()) return '-';
		return m.utcOffset(8).format('YYYY-MM-DD HH:mm');
	}

	function getCurrentDisplayDateTime() {
		return moment().utcOffset(8).format('M/D/YYYY H:mm');
	}

	function formatCommissionGameType(row) {
		var gt = String(row.GAME_TYPE || 'LIVE').toUpperCase();
		var cls = gt === 'TELEBET' ? 'css-red' : 'css-blue';
		var label = gt === 'TELEBET' ? 'TELEBET' : 'LIVE';
		return '<span class="' + cls + '">' + escapeHtml(label) + '</span>';
	}

	function applyWinLossColor($el, value) {
		if (!$el || !$el.length) return;
		var n = typeof value === 'number' ? value : parseNumCell(value, { signed: true });
		$el.removeClass('commission-winloss-positive commission-winloss-negative');
		if (n > 0) $el.addClass('commission-winloss-positive');
		else if (n < 0) $el.addClass('commission-winloss-negative');
	}

	function formatWinLossHtml(value) {
		var n = parseNumCell(value, { signed: true });
		var text = n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
		var cls = n > 0 ? 'commission-winloss-positive' : (n < 0 ? 'commission-winloss-negative' : '');
		return '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
	}

	function computeRollingFromRecords(response) {
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

		response.forEach(function (res) {
			if (res.CAGE_TYPE == 1 && (total_nn_init != 0 || total_cc_init != 0)) {
				total_nn += parseFloat(res.NN_CHIPS) || 0;
				total_cc += parseFloat(res.CC_CHIPS) || 0;
			}
			if ((total_nn_init == 0 && total_cc_init == 0) && res.CAGE_TYPE == 1) {
				total_nn_init += parseFloat(res.NN_CHIPS) || 0;
				total_cc_init += parseFloat(res.CC_CHIPS) || 0;
			}
			if (res.CAGE_TYPE == 2) {
				total_cash_out_nn += parseFloat(res.NN_CHIPS) || 0;
				total_cash_out_cc += parseFloat(res.CC_CHIPS) || 0;
			}
			if (res.CAGE_TYPE == 3) {
				total_rolling += parseFloat(res.AMOUNT) || 0;
				total_rolling_nn += parseFloat(res.NN_CHIPS) || 0;
			}
			if (res.CAGE_TYPE == 4) {
				total_rolling_real += parseFloat(res.AMOUNT) || 0;
				total_rolling_nn_real += parseFloat(res.NN_CHIPS) || 0;
				total_rolling_cc_real += parseFloat(res.CC_CHIPS) || 0;
			}
			if (res.CAGE_TYPE == 5) {
				var rollerTransaction = parseInt(res.ROLLER_TRANSACTION, 10) || 1;
				if (rollerTransaction === 2) {
					total_roller_return_cc += parseFloat(res.ROLLER_CC_CHIPS) || 0;
				}
			}
		});

		var total_initial = total_nn_init + total_cc_init;
		var total_buy_in_chips = total_nn + total_cc;
		var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
		var totalRollingCCWithReturns = total_roller_return_cc;
		var total_rolling_chips = total_rolling_nn + totalRollingCCWithReturns + total_rolling +
			total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;
		var buyInAmount = total_buy_in_chips + total_initial;
		var cashOutAmount = total_cash_out_chips;
		var winLoss = Math.round(buyInAmount - cashOutAmount);

		return {
			buyInAmount: Math.round(buyInAmount),
			cashOutAmount: Math.round(cashOutAmount),
			winLoss: winLoss,
			totalRolling: Math.round(total_rolling_chips)
		};
	}

	var dataTable;

	function getSettlementDataTable() {
		if (!$.fn.DataTable.isDataTable('#commission-settlement-tbl')) return null;
		return dataTable || $('#commission-settlement-tbl').DataTable();
	}
	var settlementRows = [];

	function getSelectedAgentId() {
		return String($('#cs-agent-filter').val() || '');
	}

	function getFilteredGameRows() {
		var agentId = getSelectedAgentId();
		if (!agentId) return settlementRows.slice();
		return settlementRows.filter(function (row) {
			return String(row.agentId) === agentId;
		});
	}

	function emptyAgg() {
		return {
			buyIn: 0, cashOut: 0, winLoss: 0, rolling: 0,
			settlement: 0, fnb: 0, hotel: 0, incidental: 0, actualSettlement: 0,
			sharePct: 0, gameType: '-', account: '-', agentName: '-', guest: '-', guestNames: [],
			gameCount: 0
		};
	}

	function aggregateByAgent(rows) {
		var map = {};
		rows.forEach(function (row) {
			var key = String(row.agentId || row.account || '');
			if (!map[key]) {
				map[key] = {
					agentId: row.agentId,
					agentCode: row.account,
					agentName: row.agentName || '-',
					gameCount: 0,
					buyIn: 0, cashOut: 0, winLoss: 0, rolling: 0,
					settlement: 0, fnb: 0, hotel: 0, incidental: 0, actualSettlement: 0
				};
			}
			var agg = map[key];
			agg.gameCount += 1;
			agg.buyIn += row.buyIn || 0;
			agg.cashOut += row.cashOut || 0;
			agg.winLoss += row.winLoss || 0;
			agg.rolling += row.rolling || 0;
			agg.settlement += row.settlement || 0;
			agg.fnb += row.fnb || 0;
			agg.hotel += row.hotel || 0;
			agg.incidental += row.incidental || 0;
			agg.actualSettlement += row.actualSettlement || 0;
		});
		return Object.keys(map).map(function (key) { return map[key]; });
	}

	function aggregateSettlementRows(rows) {
		var agg = emptyAgg();
		rows.forEach(function (row) {
			agg.buyIn += row.buyIn || 0;
			agg.cashOut += row.cashOut || 0;
			agg.winLoss += row.winLoss || 0;
			agg.rolling += row.rolling || 0;
			agg.settlement += row.settlement || 0;
			agg.fnb += row.fnb || 0;
			agg.hotel += row.hotel || 0;
			agg.incidental += row.incidental || 0;
			agg.actualSettlement += row.actualSettlement || 0;
			if (row.sharePct > agg.sharePct) agg.sharePct = row.sharePct;
			if (row.gameType && row.gameType !== '-') agg.gameType = row.gameType;
			if (row.account && row.account !== '-') agg.account = row.account;
			if (row.agentName && row.agentName !== '-') agg.agentName = row.agentName;
			if (row.guest && row.guest !== '-' && agg.guestNames.indexOf(row.guest) === -1) {
				agg.guestNames.push(row.guest);
			}
		});
		agg.guest = agg.guestNames.length === 1
			? agg.guestNames[0]
			: (agg.guestNames.length > 1 ? agg.guestNames.join(', ') : '-');
		return agg;
	}

	function getFilteredSettlementRows() {
		return getFilteredGameRows();
	}

	function refreshMainTable() {
		var table = getSettlementDataTable();
		if (!table) return;
		var agents = aggregateByAgent(getFilteredGameRows());
		table.clear();
		agents.sort(function (a, b) {
			return String(a.agentCode).localeCompare(String(b.agentCode));
		});
		agents.forEach(function (a) {
			table.row.add([
				a.agentCode || '-',
				a.agentName || '-',
				a.gameCount,
				formatAmount(a.buyIn),
				formatAmount(a.cashOut),
				formatWinLossHtml(a.winLoss),
				formatAmount(a.rolling),
				formatAmount(a.settlement),
				formatAmount(a.fnb),
				formatAmount(a.hotel),
				formatAmount(a.incidental),
				formatAmount(a.actualSettlement)
			]);
		});
		table.draw(false);
	}

	function setTextAmount(selector, value, signed) {
		var $el = $(selector);
		if (!$el.length) return;
		if (signed) {
			$el.html(fmtSigned(value));
			applyWinLossColor($el, value);
		} else {
			$el.text(formatAmount(value));
		}
	}

	function updateWorkspacePanels() {
		var rows = getFilteredSettlementRows();
		var agg = aggregateSettlementRows(rows);
		var rateDec = getRollingRateDecimal();
		var ratePct = (rateDec * 100).toFixed(2) + '%';
		var guestRolling = parseNumCell($('#cs-guest-rolling').val());
		if (guestRolling < 0) guestRolling = 0;
		if (guestRolling > agg.rolling) guestRolling = agg.rolling;
		var agentRolling = agg.rolling - guestRolling;
		var guestComm = Math.round(-guestRolling * rateDec);
		var agentComm = Math.round(-agentRolling * rateDec);
		var actSettlement = Math.round(-agg.rolling * rateDec);
		var netTotal = agg.settlement - agg.fnb - agg.hotel - agg.incidental;
		var guestSettlementShare = agg.settlement - actSettlement;
		var guestNet = actSettlement - agg.fnb - agg.hotel - agg.incidental;
		var agentNet = guestSettlementShare;
		var displayDateTime = getCurrentDisplayDateTime();

		$('#cs-fg-account').text(agg.account || '-');
		$('#cs-fg-name').text(agg.agentName || agg.guest || '-');
		$('#cs-fg-game-type').text(agg.gameType || '-');
		$('#cs-fg-datetime').text(displayDateTime);
		setTextAmount('#cs-fg-buyin', agg.buyIn);
		setTextAmount('#cs-fg-cashout', agg.cashOut);
		setTextAmount('#cs-fg-winloss', agg.winLoss, true);
		setTextAmount('#cs-fg-rolling', agg.rolling);
		setTextAmount('#cs-fg-settlement', agg.settlement);
		setTextAmount('#cs-fg-fnb', agg.fnb);
		setTextAmount('#cs-fg-hotel', agg.hotel);
		setTextAmount('#cs-fg-incidental', agg.incidental);
		setTextAmount('#cs-fg-total', netTotal);

		$('#cs-dr-account').text(agg.account || '-');
		$('#cs-dr-name').text(agg.agentName || agg.guest || '-');
		$('#cs-dr-rolling-rate').text(ratePct);
		$('#cs-dr-guest-rate').text(ratePct);
		$('#cs-dr-agent-rate').text(ratePct);
		setTextAmount('#cs-dr-agent-rolling', agentRolling);
		setTextAmount('#cs-dr-guest-comm', guestComm, true);
		setTextAmount('#cs-dr-agent-comm', agentComm, true);
		setTextAmount('#cs-dr-winloss', agg.winLoss, true);
		setTextAmount('#cs-dr-settlement', agg.settlement, true);
		setTextAmount('#cs-dr-fnb', agg.fnb);
		setTextAmount('#cs-dr-hotel', agg.hotel);
		setTextAmount('#cs-dr-incidental', agg.incidental);
		$('#cs-dr-guest-name').text(agg.guest || '-');
		$('#cs-dr-agent-name').text(agg.agentName || '-');
		setTextAmount('#cs-dr-guest-allocation', guestRolling);
		setTextAmount('#cs-dr-agent-allocation', agentRolling);
		$('#cs-dr-guest-block-rate').text(ratePct);
		setTextAmount('#cs-dr-guest-net', guestNet, true);
		$('#cs-dr-agent-block-rate').text('0.00%');
		$('#cs-dr-agent-rate-second').text(ratePct);
		setTextAmount('#cs-dr-agent-net', agentNet, true);
		setTextAmount('#cs-dr-agent-second-commission', 0);
		setTextAmount('#cs-dr-net-total', netTotal, true);
		setTextAmount('#cs-dr-total-rolling', agg.rolling);
		setTextAmount('#cs-dr-act-settlement', actSettlement, true);

		var guestRollingPct = agg.rolling ? (guestRolling / agg.rolling) * 100 : 0;
		var agentRollingPct = agg.rolling ? (agentRolling / agg.rolling) * 100 : 0;
		setTextAmount('#cs-pc-total', agg.rolling);
		setTextAmount('#cs-pc-guest', guestRolling);
		setTextAmount('#cs-pc-agent', agentRolling);
		$('#cs-pc-guest-pct').text(guestRollingPct.toFixed(0) + '%');
		$('#cs-pc-agent-pct').text(agentRollingPct.toFixed(0) + '%');

		function setDivisionCard(division, party, values) {
			var id = '#cs-' + division + '-' + party + '-';
			$(id + 'datetime').text(displayDateTime);
			$(id + 'account').text(agg.account || '-');
			$(id + 'name').text(party === 'guest' ? (agg.guest || '-') : (agg.agentName || '-'));
			$(id + 'type').text(agg.gameType || '-');
			setTextAmount(id + 'buyin', agg.buyIn);
			setTextAmount(id + 'cashout', agg.cashOut);
			setTextAmount(id + 'winloss', agg.winLoss, true);
			setTextAmount(id + 'rolling', values.rolling);
			setTextAmount(id + 'settlement', values.settlement, true);
			setTextAmount(id + 'fnb', values.fnb);
			setTextAmount(id + 'hotel', values.hotel);
			setTextAmount(id + 'incidental', values.incidental);
			setTextAmount(id + 'total', values.total, true);
		}

		// Division A: the guest's manually allocated rolling settlement;
		// the agent receives the balance of the overall settlement.
		setDivisionCard('a', 'guest', {
			rolling: guestRolling,
			settlement: guestComm,
			fnb: 0,
			hotel: 0,
			incidental: 0,
			total: guestComm
		});
		setDivisionCard('a', 'agent', {
			rolling: agentRolling,
			settlement: agg.settlement - guestComm,
			fnb: agg.fnb,
			hotel: agg.hotel,
			incidental: agg.incidental,
			total: agg.settlement - guestComm - agg.fnb - agg.hotel - agg.incidental
		});

		// Division B: the guest receives the actual rolling settlement;
		// the agent receives the remaining settlement balance.
		setDivisionCard('b', 'guest', {
			rolling: guestRolling,
			settlement: actSettlement,
			fnb: agg.fnb,
			hotel: agg.hotel,
			incidental: agg.incidental,
			total: guestNet
		});
		setDivisionCard('b', 'agent', {
			rolling: agentRolling,
			settlement: guestSettlementShare,
			fnb: 0,
			hotel: 0,
			incidental: 0,
			total: agentNet
		});
	}

	function renderDetailTable() {
		var rows = getFilteredGameRows().slice().sort(function (a, b) {
			return String(a.gameNo).localeCompare(String(b.gameNo));
		});
		var html = '';
		var totals = emptyAgg();

		rows.forEach(function (row) {
			totals.buyIn += row.buyIn || 0;
			totals.cashOut += row.cashOut || 0;
			totals.winLoss += row.winLoss || 0;
			totals.rolling += row.rolling || 0;
			totals.settlement += row.settlement || 0;
			totals.fnb += row.fnb || 0;
			totals.hotel += row.hotel || 0;
			totals.incidental += row.incidental || 0;
			totals.actualSettlement += row.actualSettlement || 0;
			html += '<tr>' +
				'<td>' + escapeHtml(row.gameNo) + '</td>' +
				'<td>' + escapeHtml(row.guest) + '</td>' +
				'<td>' + escapeHtml(row.programDate || '-') + '</td>' +
				'<td class="text-end">' + formatAmount(row.buyIn) + '</td>' +
				'<td class="text-end">' + formatAmount(row.cashOut) + '</td>' +
				'<td class="text-end">' + formatWinLossHtml(row.winLoss) + '</td>' +
				'<td class="text-end">' + formatAmount(row.rolling) + '</td>' +
				'<td class="text-end">' + formatAmount(row.settlement) + '</td>' +
				'<td class="text-end">' + formatAmount(row.fnb) + '</td>' +
				'<td class="text-end">' + formatAmount(row.hotel) + '</td>' +
				'<td class="text-end">' + formatAmount(row.incidental) + '</td>' +
				'<td class="text-end">' + formatAmount(row.actualSettlement) + '</td>' +
				'</tr>';
		});

		$('#commission-settlement-detail-body').html(html);
		setTextAmount('#cs-detail-buyin', totals.buyIn);
		setTextAmount('#cs-detail-cashout', totals.cashOut);
		setTextAmount('#cs-detail-winloss', totals.winLoss, true);
		setTextAmount('#cs-detail-rolling', totals.rolling);
		setTextAmount('#cs-detail-settlement', totals.settlement);
		setTextAmount('#cs-detail-fnb', totals.fnb);
		setTextAmount('#cs-detail-hotel', totals.hotel);
		setTextAmount('#cs-detail-incidental', totals.incidental);
		setTextAmount('#cs-detail-act', totals.actualSettlement);
	}

	function initAgentFilterSelect2() {
		var $sel = $('#cs-agent-filter');
		if (!$sel.length || typeof $sel.select2 !== 'function') return;
		if ($sel.data('select2')) {
			try { $sel.select2('destroy'); } catch (e) { /* ignore */ }
		}
		$sel.select2({
			placeholder: $sel.data('placeholder') || t.all_agents || 'All Agents',
			allowClear: true,
			width: '300px'
		});
	}

	function loadAgents() {
		return $.getJSON('/agent_winloss_report/agents').done(function (agents) {
			var $sel = $('#cs-agent-filter');
			if (!$sel.length) return;
			var current = $sel.val();
			if ($sel.data('select2')) {
				try { $sel.select2('destroy'); } catch (e) { /* ignore */ }
			}
			$sel.empty().append($('<option>', { value: '', text: '' }));
			(agents || []).forEach(function (agent) {
				var label = [agent.agent_code, agent.agent_name].filter(Boolean).join(' - ');
				$sel.append($('<option>', {
					value: String(agent.agent_id),
					text: label || ('Agent #' + agent.agent_id)
				}));
			});
			if (current) $sel.val(current);
			initAgentFilterSelect2();
		});
	}

	function afterSettlementDataLoaded() {
		refreshMainTable();
		var hasAgent = !!getSelectedAgentId();
		var hasData = settlementRows.length > 0;
		if (hasData && hasAgent) {
			$('#commission-settlement-workspace').removeClass('d-none');
			$('#commission-settlement-detail-wrap').removeClass('d-none');
		} else {
			$('#commission-settlement-workspace').addClass('d-none');
			$('#commission-settlement-detail-wrap').addClass('d-none');
		}
		updateWorkspacePanels();
		renderDetailTable();
	}

	function updateSummaryTotals(totals) {
		$('#CS_GRAND_BUYIN').text(formatAmount(totals.buyIn));
		$('#CS_GRAND_CASHOUT').text(formatAmount(totals.cashOut));
		var $wl = $('#CS_GRAND_WINLOSS');
		$wl.html(fmtSigned(totals.winLoss));
		applyWinLossColor($wl, totals.winLoss);
		$('#CS_GRAND_ROLLING').text(formatAmount(totals.rolling));
		$('#CS_GRAND_SETTLEMENT').text(formatAmount(totals.settlement));
		$('#CS_GRAND_FNB').text(formatAmount(totals.fnb));
		$('#CS_GRAND_HOTEL').text(formatAmount(totals.hotel));
		$('#CS_GRAND_INCIDENTAL').text(formatAmount(totals.incidental));
		$('#CS_GRAND_ACT_SETTLEMENT').text(formatAmount(totals.actualSettlement));
	}

	function calculateTotalsFromTable() {
		var table = getSettlementDataTable();
		if (!table) return;
		var totals = {
			buyIn: 0, cashOut: 0, winLoss: 0, rolling: 0,
			settlement: 0, fnb: 0, hotel: 0, incidental: 0, actualSettlement: 0
		};
		table.rows({ search: 'applied' }).every(function () {
			var data = this.data();
			if (!data) return;
			totals.buyIn += parseNumCell(data[3]);
			totals.cashOut += parseNumCell(data[4]);
			totals.winLoss += parseNumCell(data[5], { signed: true });
			totals.rolling += parseNumCell(data[6]);
			totals.settlement += parseNumCell(data[7]);
			totals.fnb += parseNumCell(data[8]);
			totals.hotel += parseNumCell(data[9]);
			totals.incidental += parseNumCell(data[10]);
			totals.actualSettlement += parseNumCell(data[11], { signed: true });
		});
		updateSummaryTotals(totals);
	}

	function layoutControls() {
		var $wrapper = $('#commission-settlement-tbl_wrapper');
		var $length = $('#commission-settlement-tbl_length');
		var $filter = $('#commission-settlement-tbl_filter');
		var $table = $('#commission-settlement-tbl');
		if (!$wrapper.length || !$length.length || !$filter.length || !$table.length) return;

		var $shell = $wrapper.children('.commission-panel-shell');
		if (!$shell.length) {
			$shell = $('<div class="commission-panel-shell"></div>');
			$wrapper.prepend($shell);
		}
		var $controls = $shell.children('.commission-controls-highlight');
		if (!$controls.length) {
			$controls = $wrapper.children('.commission-controls-highlight');
			if (!$controls.length) {
				$controls = $('<div class="commission-controls-highlight"></div>');
			}
			$shell.prepend($controls);
		}
		if ($table.parent()[0] !== $shell[0]) {
			$shell.append($table);
		}
		if ($length.parent()[0] !== $controls[0]) {
			$controls.append($length);
		}
		if ($filter.parent()[0] !== $controls[0]) {
			$controls.append($filter);
		}

		var $mount = $('#commission-settlement-daterange-mount');
		if ($mount.length && $controls.length) {
			if ($mount.parent()[0] !== $controls[0] || $mount.prev()[0] !== $length[0]) {
				$mount.detach().insertAfter($length).addClass('is-placed').data('placed', true);
			} else {
				$mount.addClass('is-placed').data('placed', true);
			}
			if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
				var el = getDateInput();
				if (el && el._flatpickr) {
					window.MonthEndCutoffRange.fitRangePickerInstance(el._flatpickr);
				}
			}
		}

		var $rateMount = $('#commission-settlement-rate-mount');
		if ($rateMount.length && $controls.length) {
			var $after = $mount.length && $mount.hasClass('is-placed') ? $mount : $length;
			if ($rateMount.parent()[0] !== $controls[0] || $rateMount.prev()[0] !== $after[0]) {
				$rateMount.detach().insertAfter($after).addClass('is-placed').data('placed', true);
			} else {
				$rateMount.addClass('is-placed').data('placed', true);
			}
		}

		var $filterHighlight = $filter.children('.commission-filter-highlight');
		if (!$filterHighlight.length) {
			$filterHighlight = $('<div class="commission-filter-highlight"></div>');
			$filter.append($filterHighlight);
		}
		var $filterLabel = $filter.children('label');
		if (!$filterLabel.length) {
			$filterLabel = $filterHighlight.children('label');
		}
		if ($filterLabel.length && $filterLabel.parent()[0] !== $filterHighlight[0]) {
			$filterHighlight.append($filterLabel);
		}
		var $searchInput = $filterLabel.find('input');
		if ($searchInput.length) {
			$searchInput.attr('placeholder', t.searchPlaceholder || 'Search...');
			$filterLabel.contents().filter(function () { return this.nodeType === 3; }).remove();
		}

		$wrapper.children('.row').each(function () {
			var $row = $(this);
			if ($row.hasClass('dt-row') || $row.find('table').length) return;
			if (!$row.find('.dataTables_length, .dataTables_filter, .dataTables_info, .dataTables_paginate').length) {
				$row.addClass('commission-dt-top-row-empty').hide().css({
					margin: 0,
					padding: 0,
					height: 0,
					overflow: 'hidden'
				});
			}
		});

		$table.css({ marginTop: 0, marginBottom: 0, width: '100%', maxWidth: '100%' }).show();
		$wrapper.children('.row.dt-row').each(function () {
			var $row = $(this);
			if (!$row.find('table').length) {
				$row.hide();
			}
		});
	}

	function syncMonthInputFromPicker() {
		var el = getDateInput();
		if (!el || !el._flatpickr || !el._flatpickr.selectedDates || el._flatpickr.selectedDates.length < 2) return;
		var endDate = el._flatpickr.selectedDates[1];
		var pad = function (n) { return String(n).padStart(2, '0'); };
		$('#commission-settlement-month').val(endDate.getFullYear() + '-' + pad(endDate.getMonth() + 1));
	}

	function applyMonthSelection(ym) {
		if (!ym || !flatpickrInstance || !window.MonthEndCutoffRange) return;
		var parts = String(ym).split('-');
		var y = parseInt(parts[0], 10);
		var m = parseInt(parts[1], 10) - 1;
		if (!y || m < 0) return;
		var range = window.MonthEndCutoffRange.getMonthEndCutoffRange(new Date(y, m, 15));
		if (range && range.defaultDate) {
			commissionSplitOverrideRange = null;
			flatpickrInstance.setDate(range.defaultDate, false);
			syncMonthInputFromPicker();
			reloadData();
		}
	}

	function getDateInput() {
		return document.getElementById('commission-settlement-daterange');
	}

	function commissionApiEndDate(endYmd) {
		if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
		var parts = String(endYmd).slice(0, 10).split('-').map(Number);
		var lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
		if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
			return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
		}
		return endYmd;
	}

	function getDateRangeValue() {
		var el = getDateInput();
		if (el && el._flatpickr) {
			var fp = el._flatpickr;
			if (fp.altInput && fp.altInput.value) return fp.altInput.value.trim();
			if (fp.selectedDates && fp.selectedDates.length === 2) {
				if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.formatDisplayDate === 'function') {
					return window.MonthEndCutoffRange.formatDisplayDate(fp.selectedDates[0]) + ' to ' +
						window.MonthEndCutoffRange.formatDisplayDate(fp.selectedDates[1]);
				}
				return moment(fp.selectedDates[0]).format('YYYY-MM-DD') + ' to ' +
					moment(fp.selectedDates[1]).format('YYYY-MM-DD');
			}
			return (fp.input.value || '').trim();
		}
		return ($('#commission-settlement-daterange').val() || '').trim();
	}

	var commissionSplitOverrideRange = null;
	if (window.SplitDateRange) {
		SplitDateRange.attach({
			rangePickerId: 'commission-settlement-daterange',
			startId: 'commission-settlement-start-date',
			endId: 'commission-settlement-end-date',
			splitWrapperId: 'commission-settlement-split-daterange-wrapper',
			independent: true,
			invalidDateMessage: t.invalid_date || 'Invalid date range.',
			onRangeApplied: function (range) {
				if (!range || !range.start || !range.end) return;
				commissionSplitOverrideRange = { start: range.start, end: commissionApiEndDate(range.end) };
				reloadData();
			},
			onRangeCleared: function () {
				if (!commissionSplitOverrideRange) return;
				commissionSplitOverrideRange = null;
				reloadData();
			}
		});
	}

	var dateInput = getDateInput();
	var flatpickrInstance = dateInput ? flatpickr(dateInput, {
		mode: 'range',
		showMonths: 3,
		onReady: function (selectedDates, dateStr, instance) {
			var current = new Date();
			instance.jumpToDate(new Date(current.getFullYear(), current.getMonth() - 2, 1), false);
			if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
				window.setupFlatpickrMonthNameRangeSelect(instance);
			}
		},
		onChange: function (selectedDates) {
			if (selectedDates.length === 2) {
				commissionSplitOverrideRange = null;
				syncMonthInputFromPicker();
				reloadData();
			}
		}
	}) : null;

	if ($.fn.DataTable.isDataTable('#commission-settlement-tbl')) {
		$('#commission-settlement-tbl').DataTable().destroy();
	}

	dataTable = $('#commission-settlement-tbl').DataTable({
		scrollX: false,
		autoWidth: false,
		order: [[0, 'asc']],
		columnDefs: [
			{
				targets: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
				searchable: false
			},
			{
				targets: 5,
				render: function (data, type) {
					if (type === 'sort' || type === 'type') return parseNumCell(data, { signed: true });
					return data;
				}
			}
		],
		createdRow: function (row, data) {
			applyWinLossColor($('td:eq(5)', row), data[5]);
		},
		drawCallback: function () {
			layoutControls();
			calculateTotalsFromTable();
			var dt = getSettlementDataTable();
			if (dt) {
				dt.columns.adjust();
			}
		},
		language: {
			search: '',
			searchPlaceholder: 'Search...',
			info: t.showing_entries || 'Showing _START_ to _END_ of _TOTAL_ entries',
			paginate: {
				previous: t.previous || 'Previous',
				next: t.next || 'Next'
			},
			emptyTable: t.no_data_found || 'No data available in table'
		}
	});

	layoutControls();

	function reloadData() {
		var start;
		var end;
		if (commissionSplitOverrideRange && commissionSplitOverrideRange.start && commissionSplitOverrideRange.end) {
			start = commissionSplitOverrideRange.start;
			end = commissionSplitOverrideRange.end;
		} else {
			var dateRange = getDateRangeValue();
			if (!dateRange) {
				alert(t.please_select_date_range || 'Please select a date range.');
				return;
			}
			if (dateRange.includes(' to ')) {
				if (window.MonthEndCutoffRange) {
					var apiRange = window.MonthEndCutoffRange.parseRangeToApiDates(dateRange);
					start = apiRange.start;
					end = apiRange.end;
				} else {
					var parts = dateRange.split(' to ');
					start = parts[0];
					end = parts[1];
				}
			} else {
				start = window.MonthEndCutoffRange ? window.MonthEndCutoffRange.toApiDate(dateRange) : dateRange;
				end = start;
			}
		}
		end = commissionApiEndDate(end);
		if (!start || !end) {
			alert('Invalid date range.');
			return;
		}

		$.ajax({
			url: '/commission_data',
			method: 'GET',
			data: { start: start, end: end },
			success: function (data) {
				settlementRows = [];
				var ajaxCalls = [];

				data.forEach(function (row) {
					if (row.SETTLED !== 1) return;
					ajaxCalls.push(
						$.when(
							$.ajax({ url: '/game_list/' + row.game_list_id + '/record', method: 'GET' }),
							$.ajax({ url: '/game_services/' + row.game_list_id, method: 'GET' })
						).done(function (recordRes, servicesRes) {
							var response = recordRes[0];
							var services = servicesRes[0];
							if (!Array.isArray(response)) return;

							var metrics = computeRollingFromRecords(response);
							var pct = getShareRollingPct(row.COMMISSION_TYPE, row.COMMISSION_PERCENTAGE);
							var amounts = computeSettlementAmounts(
								metrics.winLoss,
								metrics.totalRolling,
								pct.sharePct,
								pct.rollingPct
							);
							var svc = categorizeGameServices(Array.isArray(services) ? services : []);
							var accountCode = row.agent_code || '';
							var guestName = row.guest_name || '-';
							var gameType = String(row.GAME_TYPE || 'LIVE').toUpperCase();

							settlementRows.push({
								agentId: row.agent_id,
								agentName: row.agent_name || '',
								account: accountCode,
								guest: guestName,
								membershipNo: row.membership_no || '',
								gameType: gameType,
								gameNo: row.game_list_id,
								programDate: formatCommissionProgramDate(row),
								gameEnded: row.GAME_ENDED || null,
								gameStart: row.GAME_DATE_START || null,
								buyIn: metrics.buyInAmount,
								cashOut: metrics.cashOutAmount,
								winLoss: metrics.winLoss,
								rolling: metrics.totalRolling,
								sharePct: pct.sharePct,
								rollingPct: pct.rollingPct,
								settlement: amounts.settlement,
								fnb: svc.fnb,
								hotel: svc.hotel,
								incidental: svc.incidental,
								actualSettlement: amounts.actualSettlement
							});
						})
					);
				});

				$.when.apply($, ajaxCalls).done(function () {
					afterSettlementDataLoaded();
				});
			},
			error: function (xhr, status, error) {
				console.error('Error fetching settlement data:', error);
			}
		});
	}

	function applyDefaultDateRange() {
		if (!flatpickrInstance) return;
		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function') {
			var range = window.MonthEndCutoffRange.getMonthEndCutoffRange();
			if (range && range.defaultDate && range.defaultDate.length === 2) {
				flatpickrInstance.setDate(range.defaultDate, false);
				syncMonthInputFromPicker();
				return;
			}
		}
		var now = new Date();
		flatpickrInstance.setDate([
			new Date(now.getFullYear(), now.getMonth(), 1),
			new Date(now.getFullYear(), now.getMonth() + 1, 0)
		], false);
		syncMonthInputFromPicker();
	}

	$('#commission-settlement-rolling-rate').on('change blur', function () {
		reloadData();
	});

	$('#cs-agent-filter').on('change', function () {
		afterSettlementDataLoaded();
	});

	$('#commission-settlement-month').on('change', function () {
		applyMonthSelection($(this).val());
	});

	$('#cs-guest-rolling').on('change blur', function () {
		updateWorkspacePanels();
	});

	loadAgents().always(function () {
		applyDefaultDateRange();
		reloadData();
	});

	function getTablePayload(includeFooter) {
		var table = getSettlementDataTable();
		if (!table) return { headers: [], rows: [], dataRowCount: 0 };
		var headers = [];
		$('#commission-settlement-tbl thead tr:first th').each(function () {
			headers.push($(this).text().trim());
		});
		var rows = [];
		table.rows({ search: 'applied' }).every(function () {
			var cells = [];
			$(this.node()).find('td').each(function () {
				cells.push($(this).text().trim());
			});
			if (cells.length) rows.push(cells);
		});
		if (includeFooter && rows.length) {
			rows.push([
				'', '', t.grand_total || 'GRAND TOTAL',
				$('#CS_GRAND_BUYIN').text().trim(),
				$('#CS_GRAND_CASHOUT').text().trim(),
				$('#CS_GRAND_WINLOSS').text().trim(),
				$('#CS_GRAND_ROLLING').text().trim(),
				$('#CS_GRAND_SETTLEMENT').text().trim(),
				$('#CS_GRAND_FNB').text().trim(),
				$('#CS_GRAND_HOTEL').text().trim(),
				$('#CS_GRAND_INCIDENTAL').text().trim(),
				$('#CS_GRAND_ACT_SETTLEMENT').text().trim()
			]);
		}
		return { headers: headers, rows: rows, dataRowCount: rows.length };
	}

	$('#btn-commission-settlement-export').on('click', function (e) {
		e.preventDefault();
		var payload = getTablePayload(false);
		if (!payload.dataRowCount) {
			alert(t.no_data_found || 'No rows to export.');
			return;
		}
		var outName = 'Commission_Settlement-export.xlsx';
		var $btn = $(this);
		$btn.prop('disabled', true);
		fetch('/commission/export_xlsx', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ headers: payload.headers, rows: payload.rows, filename: outName })
		})
			.then(function (res) {
				if (!res.ok) throw new Error('Export failed');
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
				alert(err.message || 'Export failed');
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	});

	$('#btn-commission-settlement-print').on('click', function (e) {
		e.preventDefault();
		var payload = getTablePayload(true);
		if (!payload.dataRowCount) {
			alert(t.no_data_found || 'No rows to print.');
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
		iframe.style.cssText = 'position:fixed;width:0;height:0;border:0';
		document.body.appendChild(iframe);
		var w = iframe.contentWindow;
		w.document.open();
		w.document.write('<!doctype html><html><head><title>Commission Settlement</title><style>@page{size:landscape;margin:8mm}body{font-family:Arial;font-size:9px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:4px}</style></head><body><h2>Commission Settlement</h2><table><thead><tr>' + headerHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></body></html>');
		w.document.close();
		setTimeout(function () {
			w.focus();
			w.print();
			document.body.removeChild(iframe);
		}, 250);
	});
});
