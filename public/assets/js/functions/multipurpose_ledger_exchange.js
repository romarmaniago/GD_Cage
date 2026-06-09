(function () {
	const urlDeposit = '/multipurpose_ledger/exchange/deposit';
	const urlReturn = '/multipurpose_ledger/exchange/return';
	const urlHistDeposit = '/multipurpose_ledger/exchange/deposit_history';

	let depositHistoryRowsCache = [];
	let jflxExchangeAmountManual = false;

	const currencyStrengthRank = {
		USD: 5,
		USDT: 4,
		PHP: 3,
		JPY: 2,
		KRW: 1
	};

	function escapeHtml(s) {
		const d = document.createElement('div');
		d.textContent = s == null ? '' : String(s);
		return d.innerHTML;
	}

	function fmtNum(n) {
		if (n == null || n === '') return '—';
		const x = Number(n);
		if (Number.isNaN(x)) return '—';
		return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	function fmtWhole(n) {
		if (n == null || n === '') return '—';
		const x = Number(n);
		if (Number.isNaN(x)) return '—';
		return x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	}

	function parseFormattedNumber(v) {
		if (v == null) return NaN;
		const cleaned = String(v).replace(/,/g, '').trim();
		if (cleaned === '') return NaN;
		const n = Number(cleaned);
		return Number.isFinite(n) ? n : NaN;
	}

	function formatCommaNumber(v) {
		const n = parseFormattedNumber(v);
		if (!Number.isFinite(n)) return '';
		return Math.round(n).toLocaleString('en-US');
	}

	function formatCommaNumberFixed(v, fractionDigits) {
		const n = parseFormattedNumber(v);
		if (!Number.isFinite(n)) return '';
		const fd = Number.isFinite(Number(fractionDigits)) ? Math.max(0, Number(fractionDigits)) : 2;
		return n.toLocaleString(undefined, { minimumFractionDigits: fd, maximumFractionDigits: fd });
	}

	function selectedCurrencyCode(selector) {
		return String($(selector + ' option:selected').text() || '')
			.trim()
			.toUpperCase();
	}

	function getCurrencyRank(code) {
		const c = String(code || '').toUpperCase();
		if (!c) return 0;
		return Number(currencyStrengthRank[c] || 0);
	}

	function computeExchangeAmountByDirection(amount, rate, inCode, exCode) {
		if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return NaN;
		if (!inCode || !exCode || inCode === exCode) return NaN;
		const inRank = getCurrencyRank(inCode);
		const exRank = getCurrencyRank(exCode);
		if (inRank >= exRank) return amount * rate;
		return amount / rate;
	}

	function formatInputWithCommasLive(inputEl) {
		if (!inputEl) return;
		const raw = String(inputEl.value || '');
		const cleaned = raw.replace(/,/g, '').replace(/[^\d]/g, '');
		if (cleaned === '') {
			inputEl.value = '';
			return;
		}
		const n = Number(cleaned);
		if (!Number.isFinite(n)) return;
		inputEl.value = n.toLocaleString('en-US');
	}

	function formatMoney(n) {
		return (Number(n) || 0).toLocaleString('en-US', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		});
	}

	function renderJflxBalanceList(items) {
		const $el = $('#jflx-modal-balance');
		if (!items || !items.length) {
			$el.html('<span class="jflx-balance-item">—</span>');
			return;
		}
		$el.html(
			items
				.map(function (text) {
					return '<span class="jflx-balance-item">' + escapeHtml(text) + '</span>';
				})
				.join('')
		);
	}

	function collectJflxBalanceItems() {
		const items = [];
		const seen = {};
		$('#jflx-in-currency option').each(function () {
			const id = parseInt($(this).val(), 10);
			if (!id || seen[id]) return;
			seen[id] = true;
			const code = String($(this).text() || '').trim();
			if (!code || /select/i.test(code)) return;
			const bal =
				typeof window.getJflBalanceForCurrency === 'function'
					? window.getJflBalanceForCurrency(id)
					: 0;
			items.push(formatMoney(bal) + ' ' + code);
		});
		return items;
	}

	function refreshJflxBalance() {
		const items = collectJflxBalanceItems();
		if (items.length) {
			renderJflxBalanceList(items);
			return $.Deferred().resolve().promise();
		}
		return $.get('/multipurpose_ledger/balance')
			.then(function (res) {
				const list = (res && res.balances) || [];
				if (!list.length) {
					renderJflxBalanceList([]);
					return;
				}
				const parts = list.map(function (b) {
					return formatMoney(b.balance) + ' ' + (b.currency_code || '');
				});
				renderJflxBalanceList(parts);
			})
			.fail(function () {
				renderJflxBalanceList([]);
			});
	}

	function initJflxAccountSelect2() {
		const $sel = $('#jflx-account');
		if (!$sel.length || typeof $sel.select2 !== 'function') return;
		if ($sel.data('select2')) {
			try {
				$sel.select2('destroy');
			} catch (e) {}
		}
		$sel.select2({
			placeholder: 'No account',
			allowClear: false,
			dropdownParent: $('#modal-jfl-exchange'),
			width: '100%'
		});
	}

	function loadJflxAccounts() {
		return $.getJSON('/account_data')
			.done(function (rows) {
				const $sel = $('#jflx-account');
				const prev = $sel.val();
				if ($sel.data('select2')) {
					try {
						$sel.select2('destroy');
					} catch (e) {}
				}
				$sel.empty().append($('<option/>', { value: '', text: 'No account' }));
				(rows || []).forEach(function (a) {
					const id = a.account_id;
					if (id == null) return;
					const parts = [a.agent_code, a.agent_name].filter(Boolean);
					const label = parts.length ? parts.join(' — ') : 'Account #' + id;
					$sel.append($('<option/>', { value: String(id), text: label }));
				});
				if (prev && $sel.find('option[value="' + prev + '"]').length) {
					$sel.val(prev);
				}
				initJflxAccountSelect2();
			})
			.fail(function () {
				initJflxAccountSelect2();
			});
	}

	function jflxHistoryAccountCell(row) {
		if (row.account_id && (row.agent_code || row.agent_name)) {
			const code = row.agent_code != null ? String(row.agent_code).trim() : '';
			const name = row.agent_name != null ? String(row.agent_name).trim() : '';
			if (code && name) return escapeHtml(code + ' - ' + name);
			if (code) return escapeHtml(code);
			if (name) return escapeHtml(name);
		}
		return '—';
	}

	function jflxHistoryGuestNameCell(row) {
		const g = row.guest_name;
		if (g == null || String(g).trim() === '') return '—';
		return escapeHtml(String(g).trim());
	}

	function setReturnFormEnabled(enabled) {
		const on = !!enabled;
		$('#jflx-return-amount, #jflx-margin-return, #jflx-return-remark, #btn-jflx-save-return').prop(
			'disabled',
			!on
		);
	}

	function getDepositRowById(id) {
		const sid = String(id || '');
		return (depositHistoryRowsCache || []).find(function (r) {
			return String(r.id) === sid;
		});
	}

	function getLinkedDepositRow() {
		const depId = String($('#jflx-source-deposit-id').val() || '').trim();
		if (!depId) return null;
		return getDepositRowById(depId);
	}

	function getReturnBaseAmount(row) {
		if (!row) return NaN;
		const inCode = String(row.in_currency_code || '').toUpperCase();
		const exCode = String(row.exchange_currency_code || '').toUpperCase();
		if (inCode === 'PHP' && exCode !== 'PHP') {
			return Number(row.amount_in);
		}
		return Number(row.exchange_amount);
	}

	function updateReturnMarginAuto() {
		const row = getLinkedDepositRow();
		const raw = String($('#jflx-return-amount').val() || '').trim();
		if (!row || raw === '') {
			$('#jflx-margin-return').val('');
			return;
		}
		const ret = parseFormattedNumber(raw);
		const baseAmount = getReturnBaseAmount(row);
		if (!Number.isFinite(ret) || !Number.isFinite(baseAmount)) {
			$('#jflx-margin-return').val('');
			return;
		}
		$('#jflx-margin-return').val(formatCommaNumber(ret - baseAmount));
	}

	function applyDepositToReturnForm(row) {
		if (!row || !row.id) return;
		const depId = String(row.id);
		const baseAmount = getReturnBaseAmount(row);
		$('#jflx-source-deposit-id').val(depId);
		$('#jflx-source-deposit-note').text(
			'Return deposit #' + depId + '. Min return: ' + fmtWhole(baseAmount) + '.'
		);
		setReturnFormEnabled(true);
		const accountId = row.account_id != null ? String(row.account_id) : '';
		$('#jflx-account').val(accountId).trigger('change');
		if (!accountId) {
			$('#jflx-guest-name').val(row.guest_name != null ? String(row.guest_name) : '');
		}
		$('#jflx-return-amount, #jflx-margin-return, #jflx-return-remark').val('');
		updateReturnMarginAuto();
	}

	function jflxDepositStatusCell(row) {
		const status = row && row.return_status ? String(row.return_status) : 'Pending';
		if (status.toLowerCase() !== 'pending') {
			return (
				'<button type="button" class="jflx-status-returned btn-jflx-view-return" data-id="' +
				escapeHtml(String(row.id)) +
				'">Returned</button>'
			);
		}
		return (
			'<button type="button" class="btn btn-sm btn-outline-primary btn-jflx-link-return py-0 px-2" data-id="' +
			escapeHtml(String(row.id)) +
			'">Return</button>'
		);
	}

	function renderDepositHistory(rows) {
		const $tb = $('#jflx-deposit-history-tbody');
		$tb.empty();
		depositHistoryRowsCache = Array.isArray(rows) ? rows.slice() : [];
		if (!rows || !rows.length) {
			$tb.append(
				'<tr><td colspan="11" class="text-center text-muted py-3">No deposit history yet.</td></tr>'
			);
			return;
		}
		rows.forEach(function (r) {
			$tb.append(
				'<tr>' +
					'<td>' +
					escapeHtml(r.id) +
					'</td>' +
					'<td>' +
					escapeHtml(r.trans_datetime) +
					'</td>' +
					'<td>' +
					jflxHistoryAccountCell(r) +
					'</td>' +
					'<td>' +
					jflxHistoryGuestNameCell(r) +
					'</td>' +
					'<td>' +
					escapeHtml(r.in_currency_code || '') +
					'</td>' +
					'<td>' +
					fmtWhole(r.amount_in) +
					'</td>' +
					'<td>' +
					escapeHtml(r.exchange_currency_code || '') +
					'</td>' +
					'<td>' +
					fmtNum(r.rate_percent) +
					'</td>' +
					'<td>' +
					fmtWhole(r.exchange_amount) +
					'</td>' +
					'<td class="text-center">' +
					jflxDepositStatusCell(r) +
					'</td>' +
					'<td>' +
					escapeHtml(r.remark || '') +
					'</td>' +
					'</tr>'
			);
		});
	}

	function loadDepositHistory() {
		return $.getJSON(urlHistDeposit)
			.done(renderDepositHistory)
			.fail(function (xhr) {
				$('#jflx-deposit-history-tbody').html(
					'<tr><td colspan="11" class="text-center text-danger py-3">' +
						escapeHtml(xhr.responseText || 'Failed to load deposit history.') +
						'</td></tr>'
				);
			});
	}

	function updateJflxExchangeAmount() {
		if (jflxExchangeAmountManual) return;
		const rawA = String($('#jflx-amount-in').val() || '').trim();
		const rawR = String($('#jflx-rate-percent').val() || '').trim();
		const amt = parseFormattedNumber(rawA);
		const rate = rawR === '' ? NaN : Number(rawR);
		const inCode = selectedCurrencyCode('#jflx-in-currency');
		const exCode = selectedCurrencyCode('#jflx-exchange-currency');
		const exchangeAmount = computeExchangeAmountByDirection(amt, rate, inCode, exCode);
		const $ex = $('#jflx-exchange-amount');
		if (Number.isFinite(exchangeAmount)) {
			$ex.val(formatCommaNumberFixed(exchangeAmount, 2));
		} else {
			$ex.val('');
		}
	}

	function resetJflxForm() {
		$('#jflx-account').val('').trigger('change');
		$('#jflx-guest-name, #jflx-incharge, #jflx-remark').val('');
		$('#jflx-amount-in, #jflx-rate-percent, #jflx-exchange-amount').val('');
		jflxExchangeAmountManual = false;
		$('#jflx-return-amount, #jflx-margin-return, #jflx-return-remark').val('');
		$('#jflx-source-deposit-id').val('');
		$('#jflx-source-deposit-note').text('Select a deposit to return.');
		setReturnFormEnabled(false);
		$('#jflx-in-currency, #jflx-exchange-currency').each(function () {
			$(this).prop('selectedIndex', 0);
		});
	}

	function openReturnDetailsModal(depRow) {
		if (!depRow) return;
		$('#jflx-ret-header-meta').text('Deposit #' + (depRow.id != null ? depRow.id : '—'));
		$('#jflx-ret-detail-datetime').text(depRow.return_datetime || '—');
		$('#jflx-ret-detail-amount').text(fmtWhole(depRow.return_amount));
		$('#jflx-ret-detail-margin').text(
			depRow.margin_return == null ? '—' : fmtWhole(depRow.margin_return)
		);
		$('#jflx-ret-detail-remark').text(depRow.return_remark || '—');
		$('#modal-jflx-return-details').modal('show');
	}

	function jflxHasAccountId() {
		const v = $('#jflx-account').val();
		return v != null && String(v).trim() !== '';
	}

	function refreshMainLedger() {
		if (typeof window.fetchJflData === 'function') window.fetchJflData();
		if (typeof window.loadJunketFundsBalance === 'function') window.loadJunketFundsBalance();
	}

	window.openJflExchangeModal = function () {
		resetJflxForm();
		const loadBal =
			typeof window.loadJunketFundsBalance === 'function'
				? window.loadJunketFundsBalance()
				: $.Deferred().resolve();
		$.when(loadBal, loadJflxAccounts(), loadDepositHistory()).always(function () {
			refreshJflxBalance();
			$('#modal-jfl-exchange').modal('show');
		});
	};

	$(document).ready(function () {
		initJflxAccountSelect2();
		setReturnFormEnabled(false);

		$('#modal-jfl-exchange').on('hidden.bs.modal', function () {
			$('input[name="jfl-trans-type"]').prop('checked', false);
			if (typeof window.syncTransferUi === 'function') window.syncTransferUi();
		});

		$(document).on('input change', '#jflx-amount-in, #jflx-rate-percent', function () {
			if (this.id === 'jflx-amount-in') formatInputWithCommasLive(this);
			jflxExchangeAmountManual = false;
			updateJflxExchangeAmount();
		});
		$(document).on('change', '#jflx-in-currency', function () {
			jflxExchangeAmountManual = false;
			updateJflxExchangeAmount();
			refreshJflxBalance();
		});
		$(document).on('change', '#jflx-exchange-currency', function () {
			jflxExchangeAmountManual = false;
			updateJflxExchangeAmount();
		});
		$(document).on('input', '#jflx-exchange-amount', function () {
			jflxExchangeAmountManual = true;
		});
		$(document).on('input change', '#jflx-return-amount', function () {
			formatInputWithCommasLive(this);
			updateReturnMarginAuto();
		});

		$(document).on('click', '#btn-jflx-save-deposit', function () {
			const guestName = String($('#jflx-guest-name').val() || '').trim();
			const inCharge = String($('#jflx-incharge').val() || '').trim();
			if (!inCharge) {
				Swal.fire('Validation', 'Person in charge is required.', 'warning');
				return;
			}
			if (!jflxHasAccountId() && !guestName) {
				Swal.fire(
					'Validation',
					'Enter guest / customer name when no account is selected.',
					'warning'
				);
				return;
			}
			const inCcy = $('#jflx-in-currency').val();
			const exCcy = $('#jflx-exchange-currency').val();
			if (!inCcy || !exCcy) {
				Swal.fire('Validation', 'Select in currency and exchange currency.', 'warning');
				return;
			}
			if (String(inCcy) === String(exCcy)) {
				Swal.fire('Validation', 'In currency and exchange currency must differ.', 'warning');
				return;
			}
			const exAmt = parseFormattedNumber($('#jflx-exchange-amount').val());
			const amountIn = parseFormattedNumber($('#jflx-amount-in').val());
			if (!Number.isFinite(exAmt) || exAmt <= 0 || !Number.isFinite(amountIn) || amountIn <= 0) {
				Swal.fire('Validation', 'Enter a valid amount and exchange amount.', 'warning');
				return;
			}
			const $btn = $(this);
			$btn.prop('disabled', true);
			$.post(urlDeposit, {
				txtAccountId: $('#jflx-account').val() || '',
				txtGuestName: guestName,
				txtInCharge: inCharge,
				txtRemark: String($('#jflx-remark').val() || '').trim(),
				txtInCurrencyId: inCcy,
				txtExchangeCurrencyId: exCcy,
				txtAmountIn: String(amountIn),
				txtRatePercent: $('#jflx-rate-percent').val(),
				txtExchangeAmount: String(exAmt)
			})
				.done(function () {
					Swal.fire('Success', 'Deposit saved.', 'success');
					resetJflxForm();
					refreshJflxBalance();
					loadDepositHistory();
					refreshMainLedger();
				})
				.fail(function (xhr) {
					const msg = xhr.responseText || 'Save failed.';
					if (/insufficient.*balance/i.test(msg)) {
						Swal.fire('Insufficient Balance', msg, 'warning');
						return;
					}
					Swal.fire('Error', msg, 'error');
				})
				.always(function () {
					$btn.prop('disabled', false);
				});
		});

		$(document).on('click', '#btn-jflx-save-return', function () {
			const sourceDepositId = String($('#jflx-source-deposit-id').val() || '').trim();
			if (!sourceDepositId) {
				Swal.fire('Validation', 'Select a pending deposit row first.', 'warning');
				return;
			}
			const dep = getLinkedDepositRow();
			const ret = parseFormattedNumber($('#jflx-return-amount').val());
			const baseAmount = dep ? getReturnBaseAmount(dep) : NaN;
			if (!Number.isFinite(ret) || ret <= 0) {
				Swal.fire('Validation', 'Enter a valid return amount.', 'warning');
				return;
			}
			if (Number.isFinite(baseAmount) && ret < baseAmount) {
				Swal.fire(
					'Validation',
					'Return amount cannot be lower than required base amount (' + fmtWhole(baseAmount) + ').',
					'warning'
				);
				return;
			}
			updateReturnMarginAuto();
			const $btn = $(this);
			$btn.prop('disabled', true);
			const marginVal = String($('#jflx-margin-return').val() || '').trim();
			const payload = {
				txtAccountId: $('#jflx-account').val() || '',
				txtGuestName: String($('#jflx-guest-name').val() || '').trim(),
				txtRemark: String($('#jflx-return-remark').val() || '').trim(),
				txtReturnAmount: String(ret),
				txtSourceDepositId: sourceDepositId
			};
			if (marginVal !== '') payload.txtMarginReturn = String(parseFormattedNumber(marginVal));
			$.post(urlReturn, payload)
				.done(function () {
					Swal.fire('Success', 'Return saved.', 'success');
					resetJflxForm();
					loadDepositHistory();
				})
				.fail(function (xhr) {
					Swal.fire('Error', xhr.responseText || 'Save failed.', 'error');
				})
				.always(function () {
					$btn.prop('disabled', false);
				});
		});

		$(document).on('click', '.btn-jflx-link-return', function () {
			const row = getDepositRowById($(this).data('id'));
			if (!row) return;
			applyDepositToReturnForm(row);
		});

		$(document).on('click', '.btn-jflx-view-return', function () {
			const row = getDepositRowById($(this).data('id'));
			if (!row) return;
			openReturnDetailsModal(row);
		});
	});
})();
