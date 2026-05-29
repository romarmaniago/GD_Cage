(function () {
	const urlCurrencyData = '/currency_data';
	const urlAddCurrency = '/add_currency';
	const urlCurrency = (id) => '/currency/' + id;
	const urlCurrencyRemove = (id) => '/currency/remove/' + id;
	const urlMxDeposit = '/add_money_exchange_deposit';
	const urlMxReturn = '/add_money_exchange_return';
	const urlMxHistDeposit = '/money_exchange_deposit_history';
	const urlMxHistReturn = '/money_exchange_return_history';
	const urlMxTxn = (id) => '/money_exchange_transaction/' + id;
	const urlMxTxnDelete = (id) => '/money_exchange_transaction/' + id + '/delete';
	let currencyRowsCache = [];
	let depositHistoryRowsCache = [];

	const el = (id) => document.getElementById(id);

	function escapeHtml(s) {
		const d = document.createElement('div');
		d.textContent = s == null ? '' : String(s);
		return d.innerHTML;
	}

	function fmtNum(n) {
		if (n == null || n === '') return '—';
		const x = Number(n);
		if (Number.isNaN(x)) return '—';
		return x.toLocaleString(undefined, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
	}

	/** Whole numbers for amount columns (no trailing .00) */
	function fmtWhole(n) {
		if (n == null || n === '') return '—';
		const x = Number(n);
		if (Number.isNaN(x)) return '—';
		return x.toLocaleString(undefined, {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		});
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
		return Math.round(n).toLocaleString();
	}

	function formatCommaNumberFixed(v, fractionDigits) {
		const n = parseFormattedNumber(v);
		if (!Number.isFinite(n)) return '';
		const fd = Number.isFinite(Number(fractionDigits))
			? Math.max(0, Number(fractionDigits))
			: 2;
		return n.toLocaleString(undefined, {
			minimumFractionDigits: fd,
			maximumFractionDigits: fd,
		});
	}

	function selectedCurrencyCode(selector) {
		const txt = String($(selector + ' option:selected').text() || '').trim();
		return txt.toUpperCase();
	}

	const currencyStrengthRank = {
		USD: 5,
		USDT: 4,
		PHP: 3,
		JPY: 2,
		KRW: 1,
	};

	/** When true, amount/rate/currency changes do not overwrite exchange amount */
	let mxExchangeAmountManual = false;
	let mxEditExchangeAmountManual = false;

	function getCurrencyRank(code) {
		const c = String(code || '').toUpperCase();
		if (!c) return 0;
		return Number(currencyStrengthRank[c] || 0);
	}

	function computeExchangeAmountByDirection(amount, rate, inCode, exCode) {
		if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return NaN;
		if (!inCode || !exCode || inCode === exCode) return NaN;
		// Stronger -> weaker uses multiply. Weaker -> stronger uses divide.
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
		inputEl.value = n.toLocaleString();
	}

	/** Amount inputs: whole numbers only in the field (no trailing .00 from DB) */
	function mxAmountInputStr(v) {
		if (v == null || v === '') return '';
		if (typeof v === 'string' && v.trim() === '') return '';
		const n = Number(v);
		if (!Number.isFinite(n)) return '';
		return String(Math.round(n));
	}

	/** Account column: "CODE - NAME" when linked; em dash if walk-in */
	function mxHistoryAccountCell(row) {
		if (row.account_id && (row.agent_code || row.agent_name)) {
			const code = row.agent_code != null ? String(row.agent_code).trim() : '';
			const name = row.agent_name != null ? String(row.agent_name).trim() : '';
			if (code && name) return escapeHtml(code + ' - ' + name);
			if (code) return escapeHtml(code);
			if (name) return escapeHtml(name);
		}
		return '—';
	}

	/** Name column: typed guest name only, or em dash if empty */
	function mxHistoryGuestNameCell(row) {
		const g = row.guest_name;
		if (g == null || String(g).trim() === '') return '—';
		return escapeHtml(String(g).trim());
	}

	function mxTransSortOrder(r) {
		const v = r.trans_sort;
		if (v == null || v === '') return 0;
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	}

	function destroyMxDepositHistoryDt() {
		const $t = $('#mx-deposit-history-tbl');
		if ($t.length && typeof $.fn.DataTable !== 'undefined' && $.fn.DataTable.isDataTable($t)) {
			$t.DataTable().destroy();
		}
	}

	function destroyMxReturnHistoryDt() {
		const $t = $('#mx-return-history-tbl');
		if ($t.length && typeof $.fn.DataTable !== 'undefined' && $.fn.DataTable.isDataTable($t)) {
			$t.DataTable().destroy();
		}
	}

	function mxHistoryDtOpts(emptyTableMsg, nonSortableColIndex) {
		const opts = {
			order: [[0, 'desc']],
			pageLength: 10,
			lengthMenu: [
				[10, 25, 50, 100, -1],
				[10, 25, 50, 100, 'All'],
			],
			autoWidth: false,
			language: {
				emptyTable: emptyTableMsg,
				zeroRecords: 'No matching records found',
				search: 'Search:',
				lengthMenu: 'Show _MENU_ entries',
				info: 'Showing _START_ to _END_ of _TOTAL_ entries',
				infoEmpty: 'Showing 0 to 0 of 0 entries',
				infoFiltered: '(filtered from _MAX_ total entries)',
				paginate: {
					first: 'First',
					last: 'Last',
					next: 'Next',
					previous: 'Previous',
				},
			},
			dom:
				'<"row g-0 gy-2 mb-2 align-items-center gap-3"<"col-12 col-md-auto"l><"col-12 col-md d-flex justify-content-end align-items-center"f>>rt<"row g-2 mt-2"<"col-12 col-md-6"i><"col-12 col-md-6"p>>',
		};
		if (nonSortableColIndex != null) {
			opts.columnDefs = [{ orderable: false, targets: [nonSortableColIndex] }];
		}
		return opts;
	}

	function initMxDepositHistoryDt() {
		if (typeof $.fn.DataTable === 'undefined') return;
		const $t = $('#mx-deposit-history-tbl');
		if (!$t.length || $t.find('tbody td[colspan]').length) return;
		if ($.fn.DataTable.isDataTable($t)) return;
		$t.DataTable(mxHistoryDtOpts('No deposit history yet.', isMxSuperAdmin() ? 11 : null));
	}

	function initMxReturnHistoryDt() {
		if (typeof $.fn.DataTable === 'undefined') return;
		const $t = $('#mx-return-history-tbl');
		if (!$t.length || $t.find('tbody td[colspan]').length) return;
		if ($.fn.DataTable.isDataTable($t)) return;
		$t.DataTable(mxHistoryDtOpts('No return history yet.', isMxSuperAdmin() ? 4 : null));
	}

	function isReturnHistoryTabVisible() {
		const $p = $('#return-history-pane');
		return $p.length && $p.hasClass('active') && $p.hasClass('show');
	}

	function isMxSuperAdmin() {
		const $el = $('#user-role');
		if (!$el.length) return false;
		const p = parseInt($el.data('permissions'), 10);
		return p === 0;
	}

	function mxHistoryActionsCell(kind, rowId) {
		if (!isMxSuperAdmin()) {
			return '';
		}
		const safeId = escapeHtml(String(rowId));
		const label = kind === 'deposit' ? 'deposit' : 'return';
		return (
			'<td class="text-center text-nowrap mx-history-col-actions">' +
			'<button type="button" class="btn btn-sm btn-outline-primary btn-mx-txn-edit me-1" data-id="' +
			safeId +
			'" data-kind="' +
			label +
			'" title="Edit"><i class="fa fa-pencil" aria-hidden="true"></i></button>' +
			'<button type="button" class="btn btn-sm btn-outline-danger btn-mx-txn-delete" data-id="' +
			safeId +
			'" data-kind="' +
			label +
			'" title="Delete"><i class="fa fa-trash" aria-hidden="true"></i></button>' +
			'</td>'
		);
	}

	function mxDepositStatusBadge(status) {
		const s = String(status || '').toLowerCase();
		if (s === 'returned') {
			return '<span class="mx-status-badge mx-status-returned">Returned</span>';
		}
		return '<span class="badge bg-warning text-dark">Pending</span>';
	}

	function getDepositRowById(id) {
		const sid = String(id || '');
		return (depositHistoryRowsCache || []).find((r) => String(r.id) === sid) || null;
	}

	function setReturnFormEnabled(enabled) {
		const on = !!enabled;
		$('#mx-return-amount, #mx-margin-return, #mx-return-remark, #btn-mx-save-return').prop(
			'disabled',
			!on
		);
	}

	function getLinkedDepositRow() {
		const depId = String($('#mx-source-deposit-id').val() || '').trim();
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
		const raw = String($('#mx-return-amount').val() || '').trim();
		if (!row || raw === '') {
			$('#mx-margin-return').val('');
			return;
		}
		const ret = parseFormattedNumber(raw);
		const baseAmount = getReturnBaseAmount(row);
		if (!Number.isFinite(ret) || !Number.isFinite(baseAmount)) {
			$('#mx-margin-return').val('');
			return;
		}
		$('#mx-margin-return').val(formatCommaNumber(ret - baseAmount));
	}

	function applyDepositToReturnForm(row) {
		if (!row || !row.id) return;
		const depId = String(row.id);
		$('#mx-source-deposit-id').val(depId);
		const baseAmount = getReturnBaseAmount(row);
		$('#mx-source-deposit-note').text('Return deposit #' + depId + '. Min return: ' + fmtWhole(baseAmount) + '.');
		setReturnFormEnabled(true);
		const accountId = row.account_id != null ? String(row.account_id) : '';
		$('#mx-account').val(accountId).trigger('change');
		if (!accountId) {
			$('#mx-guest-name').val(row.guest_name != null ? String(row.guest_name) : '');
		}
		$('#mx-return-amount').val('');
		$('#mx-margin-return').val('');
		$('#mx-return-remark').val('');
		updateReturnMarginAuto();
	}

	function mxDepositStatusCell(row) {
		const status = row && row.return_status ? String(row.return_status) : 'Pending';
		if (status.toLowerCase() !== 'pending') {
			return (
				'<button type="button" class="mx-status-badge mx-status-returned btn-mx-view-return" data-id="' +
				escapeHtml(String(row.id)) +
				'" title="View return details">Returned</button>'
			);
		}
		return (
			'<div class="d-flex flex-column align-items-center">' +
			'<button type="button" class="btn btn-sm btn-outline-primary btn-mx-link-return py-0 px-2" data-id="' +
			escapeHtml(String(row.id)) +
			'">Return</button></div>'
		);
	}

	function initMxAccountSelect2() {
		const $sel = $('#mx-account');
		if (!$sel.length || typeof $sel.select2 !== 'function') return;
		if ($sel.data('select2')) {
			try {
				$sel.select2('destroy');
			} catch (e) {}
		}
		const ph = $sel.data('placeholder') || 'No account';
		$sel.select2({
			placeholder: ph,
			allowClear: false,
			dropdownParent: $('body'),
			width: '100%',
		});
	}

	function loadMxAccounts() {
		$.getJSON('/account_data')
			.done(function (rows) {
				const $sel = $('#mx-account');
				const prev = $sel.val();
				if ($sel.data('select2')) {
					try {
						$sel.select2('destroy');
					} catch (e) {}
				}
				const firstLabel = $sel.data('placeholder') || 'No account';
				$sel.empty().append($('<option/>', { value: '', text: firstLabel }));
				(rows || []).forEach(function (a) {
					const id = a.account_id;
					if (id == null) return;
					const parts = [a.agent_code, a.agent_name].filter(Boolean);
					const label = parts.length ? parts.join(' — ') : 'Account #' + id;
					$sel.append($('<option/>', { value: String(id), text: label }));
				});
				if (prev && $sel.find('option[value="' + prev + '"]').length) {
					$sel.val(prev);
				} else {
					$sel.val('');
				}
				initMxAccountSelect2();
			})
			.fail(function () {
				initMxAccountSelect2();
			});
	}

	function renderDepositHistory(rows) {
		destroyMxDepositHistoryDt();
		const $tb = $('#mx-deposit-history-tbody');
		$tb.empty();
		depositHistoryRowsCache = Array.isArray(rows) ? rows.slice() : [];
		if (!rows || !rows.length) {
			initMxDepositHistoryDt();
			return;
		}
		rows.forEach(function (r) {
			$tb.append(
				`<tr>
					<td>${escapeHtml(r.id)}</td>
					<td data-order="${mxTransSortOrder(r)}">${escapeHtml(r.trans_datetime)}</td>					
					<td>${mxHistoryAccountCell(r)}</td>
					<td>${mxHistoryGuestNameCell(r)}</td>
					<td>${escapeHtml(r.in_currency_code || '')}</td>
					<td>${fmtWhole(r.amount_in)}</td>
					<td>${escapeHtml(r.exchange_currency_code || '')}</td>
					<td>${fmtNum(r.rate_percent)}</td>
					<td>${fmtWhole(r.exchange_amount)}</td>
					<td>${mxDepositStatusCell(r)}</td>
					<td>${escapeHtml(r.remark || '')}</td>
					${mxHistoryActionsCell('deposit', r.id)}
				</tr>`
			);
		});
		initMxDepositHistoryDt();
	}

	function loadDepositHistory() {
		$.getJSON(urlMxHistDeposit)
			.done(renderDepositHistory)
			.fail(function (xhr) {
				destroyMxDepositHistoryDt();
				$('#mx-deposit-history-tbody').html(
					'<tr><td colspan="' +
						(isMxSuperAdmin() ? 12 : 11) +
						'" class="text-center text-danger py-3">' +
						escapeHtml(xhr.responseText || 'Failed to load deposit history.') +
						'</td></tr>'
				);
			});
	}

	function openReturnDetailsModal(depRow) {
		if (!depRow) return;
		const depRef = depRow.id != null ? 'Deposit #' + depRow.id : 'Deposit #—';
		let party = 'Name: —';
		if (depRow.account_id && (depRow.agent_code || depRow.agent_name)) {
			const code = depRow.agent_code ? String(depRow.agent_code).trim() : '';
			const name = depRow.agent_name ? String(depRow.agent_name).trim() : '';
			const accountText = [code, name].filter(Boolean).join(' - ');
			party = 'Account: ' + (accountText || depRow.account_id);
		} else if (depRow.guest_name && String(depRow.guest_name).trim() !== '') {
			party = 'Name: ' + String(depRow.guest_name).trim();
		}
		$('#mx-ret-header-meta').text(depRef + ' | ' + party);
		$('#mx-ret-detail-id').text(depRow.return_txn_id || '—');
		$('#mx-ret-detail-datetime').text(depRow.return_datetime || '—');
		$('#mx-ret-detail-amount').text(fmtWhole(depRow.return_amount));
		$('#mx-ret-detail-margin').text(
			depRow.margin_return == null ? '—' : fmtWhole(depRow.margin_return)
		);
		$('#mx-ret-detail-remark').text(depRow.return_remark || '—');
		showModal('modal-mx-return-details');
	}

	function initMxEditAccountSelect2() {
		const $sel = $('#mx-edit-account');
		if (!$sel.length || typeof $sel.select2 !== 'function') return;
		if ($sel.data('select2')) {
			try {
				$sel.select2('destroy');
			} catch (e) {}
		}
		$sel.select2({
			placeholder: $sel.data('placeholder') || 'No account',
			allowClear: false,
			dropdownParent: $('#modal-mx-edit-txn'),
			width: '100%',
		});
	}

	function updateMxEditExchangeAmount() {
		if (mxEditExchangeAmountManual) return;
		const rawA = String($('#mx-edit-amount-in').val() || '').trim();
		const rawR = String($('#mx-edit-rate-percent').val() || '').trim();
		const amt = parseFormattedNumber(rawA);
		const rate = rawR === '' ? NaN : Number(rawR);
		const inCode = selectedCurrencyCode('#mx-edit-in-currency');
		const exCode = selectedCurrencyCode('#mx-edit-exchange-currency');
		const $ex = $('#mx-edit-exchange-amount');
		const exchangeAmount = computeExchangeAmountByDirection(amt, rate, inCode, exCode);
		if (Number.isFinite(exchangeAmount)) {
			$ex.val(formatCommaNumberFixed(exchangeAmount, 2));
		} else {
			$ex.val('');
		}
	}

	function openMxEditModal(row) {
		if (!row) return;
		$('#mx-edit-txn-id').val(row.id);
		$('#mx-edit-trans-type').val(row.trans_type);
		$('#mx-edit-source-deposit-id').val(
			row.source_deposit_id != null ? String(row.source_deposit_id) : ''
		);
		$('#mx-edit-guest-name').val(
			row.guest_name != null && row.guest_name !== '' ? String(row.guest_name) : ''
		);
		$('#mx-edit-remark').val(row.remark != null ? String(row.remark) : '');

		const $acc = $('#mx-account');
		const $editAcc = $('#mx-edit-account');
		if ($editAcc.data('select2')) {
			try {
				$editAcc.select2('destroy');
			} catch (e) {}
		}
		$editAcc.empty().append($acc.find('option').clone());
		const aid = row.account_id != null ? String(row.account_id) : '';
		if (aid && $editAcc.find('option[value="' + aid + '"]').length) {
			$editAcc.val(aid);
		} else {
			$editAcc.val('');
		}

		$('#mx-edit-in-currency').html($('#in-currency').html());
		$('#mx-edit-exchange-currency').html($('#exchange-currency').html());

		const tt = Number(row.trans_type);
		if (tt === 1) {
			$('#mx-edit-deposit-fields').removeClass('d-none');
			$('#mx-edit-return-fields').addClass('d-none');
			if (row.in_currency_id != null) {
				$('#mx-edit-in-currency').val(String(row.in_currency_id));
			}
			if (row.exchange_currency_id != null) {
				$('#mx-edit-exchange-currency').val(String(row.exchange_currency_id));
			}
			$('#mx-edit-amount-in').val(mxAmountInputStr(row.amount_in));
			$('#mx-edit-rate-percent').val(row.rate_percent != null ? row.rate_percent : '');
			$('#mx-edit-exchange-amount').val(
				row.exchange_amount != null
					? formatCommaNumberFixed(row.exchange_amount, 2)
					: ''
			);
			mxEditExchangeAmountManual = false;
		} else {
			$('#mx-edit-deposit-fields').addClass('d-none');
			$('#mx-edit-return-fields').removeClass('d-none');
			$('#mx-edit-return-amount').val(mxAmountInputStr(row.return_amount));
			$('#mx-edit-margin-return').val(mxAmountInputStr(row.margin_return));
		}

		showModal('modal-mx-edit-txn');
		requestAnimationFrame(function () {
			initMxEditAccountSelect2();
		});
	}

	/** Exchange amount = Amount × Rate (both fields use the raw numbers entered) */
	function updateMxExchangeAmount() {
		if (mxExchangeAmountManual) return;
		const rawA = String($('#mx-amount-in').val() || '').trim();
		const rawR = String($('#mx-rate-percent').val() || '').trim();
		const amt = parseFormattedNumber(rawA);
		const rate = rawR === '' ? NaN : Number(rawR);
		const inCode = selectedCurrencyCode('#in-currency');
		const exCode = selectedCurrencyCode('#exchange-currency');
		const $ex = $('#mx-exchange-amount');
		const exchangeAmount = computeExchangeAmountByDirection(amt, rate, inCode, exCode);
		if (Number.isFinite(exchangeAmount)) {
			$ex.val(formatCommaNumberFixed(exchangeAmount, 2));
		} else {
			$ex.val('');
		}
	}

	/** Clear the whole money-exchange form after a successful save */
	function resetMoneyExchangeForm() {
		const $acc = $('#mx-account');
		$acc.val('').trigger('change');
		$('#mx-guest-name, #mx-remark').val('');
		$('#mx-amount-in, #mx-rate-percent, #mx-exchange-amount').val('');
		mxExchangeAmountManual = false;
		$('#mx-return-amount, #mx-margin-return, #mx-return-remark').val('');
		$('#mx-source-deposit-id').val('');
		$('#mx-source-deposit-note').text('Select a deposit to return.');
		setReturnFormEnabled(false);
		$('#in-currency, #exchange-currency').each(function () {
			$(this).prop('selectedIndex', 0);
		});
	}

	function hideModal(modalId) {
		const node = el(modalId);
		if (!node) return;
		if (window.bootstrap && window.bootstrap.Modal) {
			const inst = bootstrap.Modal.getInstance(node);
			if (inst) inst.hide();
			else bootstrap.Modal.getOrCreateInstance(node).hide();
		} else {
			$(node).modal('hide');
		}
	}

	function showModal(modalId) {
		const node = el(modalId);
		if (!node) return;
		if (window.bootstrap && window.bootstrap.Modal) {
			bootstrap.Modal.getOrCreateInstance(node).show();
		} else {
			$(node).modal('show');
		}
	}

	function refreshPageDropdowns(rows) {
		const active = (rows || []).filter((r) => Number(r.active) === 1);
		const opts =
			'<option value="" selected disabled>Select currency</option>' +
			active
				.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.code)}</option>`)
				.join('');
		$('#in-currency, #exchange-currency').each(function () {
			$(this).html(opts);
		});
	}

	function renderTable(rows) {
		const $tb = $('#currency-master-tbody');
		$tb.empty();
		if (!rows || !rows.length) {
			$tb.append(
				'<tr><td colspan="4" class="text-center text-muted py-3">No currencies yet.</td></tr>'
			);
			return;
		}
		rows.forEach((r) => {
			const active = Number(r.active) === 1;
			const badge = active
				? '<span class="badge bg-success">Active</span>'
				: '<span class="badge bg-secondary">Inactive</span>';
			$tb.append(
				`<tr data-id="${escapeHtml(r.id)}">
					<td class="text-nowrap currency-master-col-code">${escapeHtml(r.code)}</td>
					<td>${escapeHtml(r.name)}</td>
					<td class="text-center">${badge}</td>
					<td class="text-end currency-master-col-actions">
						<button type="button" class="btn btn-sm btn-outline-primary btn-currency-edit me-1" data-id="${escapeHtml(r.id)}" title="Edit"><i class="fa fa-pencil" aria-hidden="true"></i></button>
						${active
							? `<button type="button" class="btn btn-sm btn-outline-danger btn-currency-deactivate" data-id="${escapeHtml(r.id)}" title="Deactivate"><i class="fa fa-ban" aria-hidden="true"></i></button>`
							: `<button type="button" class="btn btn-sm btn-outline-success btn-currency-activate" data-id="${escapeHtml(r.id)}" title="Activate"><i class="fa fa-check" aria-hidden="true"></i></button>`
						}
					</td>
				</tr>`
			);
		});
	}

	function loadCurrencies() {
		return $.ajax({
			url: urlCurrencyData,
			method: 'GET',
			data: { all: 1 },
		})
			.done(function (data) {
				const rows = Array.isArray(data) ? data : [];
				currencyRowsCache = rows;
				renderTable(rows);
				refreshPageDropdowns(rows);
			})
			.fail(function (xhr) {
				const err = xhr.responseText || 'Failed to load currencies.';
				Swal.fire('Error', err, 'error');
			});
	}

	function resetAddForm() {
		$('#form-add-currency')[0].reset();
	}

	function fillEditForm(row) {
		if (!row) return;
		$('#edit-currency-id').val(row.id);
		$('#edit-currency-code').val(row.code || '');
		$('#edit-currency-name').val(row.name || '');
		$('#edit-currency-txt-active').val(Number(row.active) === 1 ? '1' : '0');
	}

	function openListModal() {
		showModal('modal-currency-master');
		loadCurrencies();
	}

	/** Stack child modal above Currency master (parent stays open). */
	function showChildModal(modalId) {
		const node = el(modalId);
		if (!node) return;
		if (window.bootstrap && window.bootstrap.Modal) {
			bootstrap.Modal.getOrCreateInstance(node).show();
		} else {
			$(node).modal('show');
		}
	}

	$(document).on('click', '#btn-currency-master', function () {
		openListModal();
	});

	$(document).on('click', '#btn-open-add-currency', function () {
		resetAddForm();
		showChildModal('modal-add-currency');
	});

	$(document).on('click', '.btn-currency-edit', function () {
		const id = $(this).data('id');
		const row = currencyRowsCache.find((r) => String(r.id) === String(id));
		if (!row) return;
		fillEditForm(row);
		showChildModal('modal-edit-currency');
	});

	/** Bootstrap 5: stack Add/Edit above Currency master (z-index + backdrop) */
	function bumpStackedChildModal(modalId) {
		const node = el(modalId);
		if (!node) return;
		requestAnimationFrame(function () {
			node.style.zIndex = 1060;
			const backs = document.querySelectorAll('.modal-backdrop');
			if (backs.length) {
				backs[backs.length - 1].style.zIndex = 1059;
			}
		});
	}

	$('#modal-add-currency')
		.on('shown.bs.modal', function () {
			bumpStackedChildModal('modal-add-currency');
		})
		.on('hidden.bs.modal', function () {
			loadCurrencies();
		});

	$('#modal-edit-currency')
		.on('shown.bs.modal', function () {
			bumpStackedChildModal('modal-edit-currency');
		})
		.on('hidden.bs.modal', function () {
			loadCurrencies();
		});

	$('#form-add-currency').on('submit', function (e) {
		e.preventDefault();
		const code = String($('#add-currency-code').val() || '')
			.trim()
			.toUpperCase();
		const name = String($('#add-currency-name').val() || '').trim();
		if (!code || code.length > 10) {
			Swal.fire('Validation', 'Enter a valid code (max 10 characters).', 'warning');
			return;
		}
		if (!name) {
			Swal.fire('Validation', 'Enter currency name.', 'warning');
			return;
		}
		const $btn = $('#btn-add-currency-save');
		$btn.prop('disabled', true);
		$.ajax({
			url: urlAddCurrency,
			type: 'POST',
			data: $(this).serialize(),
		})
			.done(function () {
				hideModal('modal-add-currency');
				Swal.fire('Success!', 'Currency added successfully.', 'success');
			})
			.fail(function (xhr) {
				Swal.fire('Error', xhr.responseText || 'Save failed.', 'error');
			})
			.always(function () {
				$btn.prop('disabled', false);
			});
	});

	$('#form-edit-currency').on('submit', function (e) {
		e.preventDefault();
		const id = $('#edit-currency-id').val();
		const code = String($('#edit-currency-code').val() || '')
			.trim()
			.toUpperCase();
		const name = String($('#edit-currency-name').val() || '').trim();
		if (!id) return;
		if (!code || code.length > 10) {
			Swal.fire('Validation', 'Enter a valid code (max 10 characters).', 'warning');
			return;
		}
		if (!name) {
			Swal.fire('Validation', 'Enter currency name.', 'warning');
			return;
		}
		$('#edit-currency-code').val(code);
		const $btn = $('#btn-edit-currency-save');
		$btn.prop('disabled', true);
		$.ajax({
			url: urlCurrency(id),
			type: 'PUT',
			data: $(this).serialize(),
		})
			.done(function () {
				hideModal('modal-edit-currency');
				Swal.fire('Success!', 'Currency updated successfully.', 'success');
			})
			.fail(function (xhr) {
				Swal.fire('Error', xhr.responseText || 'Save failed.', 'error');
			})
			.always(function () {
				$btn.prop('disabled', false);
			});
	});

	$(document).on('click', '.btn-currency-deactivate', function () {
		const id = $(this).data('id');
		Swal.fire({
			title: 'Deactivate?',
			text: 'This currency will be hidden from deposit/return dropdowns.',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Yes',
		}).then((r) => {
			if (!r.isConfirmed) return;
			$.ajax({
				url: urlCurrencyRemove(id),
				type: 'PUT',
			})
				.done(function () {
					loadCurrencies();
					Swal.fire('Success!', 'Currency archived successfully.', 'success');
				})
				.fail(function (xhr) {
					Swal.fire('Error', xhr.responseText || 'Failed to deactivate.', 'error');
				});
		});
	});

	$(document).on('click', '.btn-currency-activate', function () {
		const id = $(this).data('id');
		const row = currencyRowsCache.find((r) => String(r.id) === String(id));
		if (!row) return;
		const formData = $.param({
			txtCode: row.code,
			txtName: row.name,
			txtActive: 1,
		});
		$.ajax({
			url: urlCurrency(id),
			type: 'PUT',
			data: formData,
		})
			.done(function () {
				loadCurrencies();
				Swal.fire('Success!', 'Currency updated successfully.', 'success');
			})
			.fail(function (xhr) {
				Swal.fire('Error', xhr.responseText || 'Failed to activate.', 'error');
			});
	});

	$('#modal-mx-edit-txn').on('hidden.bs.modal', function () {
		const $sel = $('#mx-edit-account');
		if ($sel.data('select2')) {
			try {
				$sel.select2('destroy');
			} catch (e) {}
		}
	});

	$(document).on('input change', '#mx-edit-amount-in, #mx-edit-rate-percent', function () {
		if (this.id === 'mx-edit-amount-in') {
			formatInputWithCommasLive(this);
		}
		mxEditExchangeAmountManual = false;
		updateMxEditExchangeAmount();
	});
	$(document).on('change', '#mx-edit-in-currency, #mx-edit-exchange-currency', function () {
		mxEditExchangeAmountManual = false;
		updateMxEditExchangeAmount();
	});
	$(document).on('input', '#mx-edit-exchange-amount', function () {
		mxEditExchangeAmountManual = true;
	});

	$(document).on('click', '.btn-mx-txn-edit', function () {
		const id = $(this).data('id');
		if (!id) return;
		$.getJSON(urlMxTxn(id))
			.done(openMxEditModal)
			.fail(function (xhr) {
				Swal.fire(
					'Error',
					xhr.responseText || 'Failed to load transaction.',
					'error'
				);
			});
	});

	$(document).on('click', '.btn-mx-txn-delete', function () {
		const id = $(this).data('id');
		const kind = $(this).data('kind');
		if (!id) return;
		Swal.fire({
			title: 'Delete transaction?',
			text: 'This removes the row from history.',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Yes, delete',
		}).then(function (r) {
			if (!r.isConfirmed) return;
			$.ajax({ url: urlMxTxnDelete(id), type: 'PUT' })
				.done(function () {
					Swal.fire('Success', 'Transaction deleted.', 'success');
					if (kind === 'deposit') loadDepositHistory();
					else loadReturnHistory();
				})
				.fail(function (xhr) {
					Swal.fire('Error', xhr.responseText || 'Delete failed.', 'error');
				});
		});
	});

	$('#form-mx-edit-txn').on('submit', function (e) {
		e.preventDefault();
		const id = $('#mx-edit-txn-id').val();
		const type = Number($('#mx-edit-trans-type').val());
		if (!id) return;

		const guestName = String($('#mx-edit-guest-name').val() || '').trim();
		const accVal = String($('#mx-edit-account').val() || '').trim();
		const hasAcc = accVal !== '';

		if (type === 1) {
			if (!hasAcc && !guestName) {
				Swal.fire(
					'Validation',
					'Enter guest / customer name when no account is selected.',
					'warning'
				);
				return;
			}
			const inCcy = $('#mx-edit-in-currency').val();
			const exCcy = $('#mx-edit-exchange-currency').val();
			if (!inCcy || !exCcy) {
				Swal.fire('Validation', 'Select in currency and exchange currency.', 'warning');
				return;
			}
			if (String(inCcy) === String(exCcy)) {
				Swal.fire(
					'Validation',
					'In currency and exchange currency must differ.',
					'warning'
				);
				return;
			}
			const editExAmt = parseFormattedNumber($('#mx-edit-exchange-amount').val());
			if (!Number.isFinite(editExAmt) || editExAmt <= 0) {
				Swal.fire('Validation', 'Enter a valid exchange amount.', 'warning');
				return;
			}
		} else {
			const ra = Number($('#mx-edit-return-amount').val());
			if (Number.isNaN(ra) || ra <= 0) {
				Swal.fire('Validation', 'Enter a valid return amount.', 'warning');
				return;
			}
		}

		const base = {
			txtAccountId: accVal,
			txtGuestName: guestName,
			txtRemark: String($('#mx-edit-remark').val() || '').trim(),
		};
		let data;
		if (type === 1) {
			data = Object.assign({}, base, {
				txtInCurrencyId: $('#mx-edit-in-currency').val(),
				txtExchangeCurrencyId: $('#mx-edit-exchange-currency').val(),
				txtAmountIn: String(parseFormattedNumber($('#mx-edit-amount-in').val())),
				txtRatePercent: $('#mx-edit-rate-percent').val(),
				txtExchangeAmount: String(parseFormattedNumber($('#mx-edit-exchange-amount').val())),
			});
		} else {
			const mv = String($('#mx-edit-margin-return').val() || '').trim();
			data = Object.assign({}, base, {
				txtReturnAmount: $('#mx-edit-return-amount').val(),
				txtSourceDepositId: $('#mx-edit-source-deposit-id').val() || '',
			});
			if (mv !== '') data.txtMarginReturn = mv;
		}

		const $btn = $('#btn-mx-edit-txn-save');
		$btn.prop('disabled', true);
		$.ajax({
			url: urlMxTxn(id),
			type: 'PUT',
			data: data,
		})
			.done(function () {
				hideModal('modal-mx-edit-txn');
				Swal.fire('Success', 'Transaction updated.', 'success');
				loadDepositHistory();
			})
			.fail(function (xhr) {
				Swal.fire('Error', xhr.responseText || 'Save failed.', 'error');
			})
			.always(function () {
				$btn.prop('disabled', false);
			});
	});

	initMxAccountSelect2();
	loadMxAccounts();
	loadDepositHistory();
	setReturnFormEnabled(false);

	$(document).on('input change', '#mx-amount-in, #mx-rate-percent', function () {
		if (this.id === 'mx-amount-in') {
			formatInputWithCommasLive(this);
		}
		mxExchangeAmountManual = false;
		updateMxExchangeAmount();
	});
	$(document).on('change', '#in-currency, #exchange-currency', function () {
		mxExchangeAmountManual = false;
		updateMxExchangeAmount();
	});
	$(document).on('input', '#mx-exchange-amount', function () {
		mxExchangeAmountManual = true;
	});
	$(document).on('input change', '#mx-return-amount', function () {
		formatInputWithCommasLive(this);
		updateReturnMarginAuto();
	});

	$(document).on(
		'blur',
		'#mx-amount-in, #mx-edit-amount-in, #mx-return-amount, #mx-edit-return-amount, #mx-margin-return, #mx-edit-margin-return, #mx-exchange-amount, #mx-edit-exchange-amount',
		function () {
			const raw = String($(this).val() || '').trim();
			if (raw === '') return;
			const n = parseFormattedNumber(raw);
			if (!Number.isFinite(n)) return;
			const id = this.id;
			if (id === 'mx-exchange-amount' || id === 'mx-edit-exchange-amount') {
				$(this).val(formatCommaNumberFixed(n, 2));
			} else {
				$(this).val(formatCommaNumber(n));
			}
			if (id === 'mx-amount-in') {
				mxExchangeAmountManual = false;
				updateMxExchangeAmount();
			}
			if (id === 'mx-edit-amount-in') {
				mxEditExchangeAmountManual = false;
				updateMxEditExchangeAmount();
			}
		}
	);

	function mxHasAccountId() {
		const v = $('#mx-account').val();
		return v != null && String(v).trim() !== '';
	}

	$(document).on('click', '#btn-mx-save-deposit', function () {
		const guestName = String($('#mx-guest-name').val() || '').trim();
		if (!mxHasAccountId() && !guestName) {
			Swal.fire(
				'Validation',
				'Enter guest / customer name when no account is selected.',
				'warning'
			);
			return;
		}
		const inCcy = $('#in-currency').val();
		const exCcy = $('#exchange-currency').val();
		if (!inCcy || !exCcy) {
			Swal.fire('Validation', 'Select in currency and exchange currency.', 'warning');
			return;
		}
		if (String(inCcy) === String(exCcy)) {
			Swal.fire('Validation', 'In currency and exchange currency must differ.', 'warning');
			return;
		}
		const exAmt = parseFormattedNumber($('#mx-exchange-amount').val());
		if (!Number.isFinite(exAmt) || exAmt <= 0) {
			Swal.fire('Validation', 'Enter a valid exchange amount.', 'warning');
			return;
		}
		const $btn = $(this);
		$btn.prop('disabled', true);
		$.post(urlMxDeposit, {
			txtAccountId: $('#mx-account').val() || '',
			txtGuestName: guestName,
			txtRemark: String($('#mx-remark').val() || '').trim(),
			txtInCurrencyId: inCcy,
			txtExchangeCurrencyId: exCcy,
			txtAmountIn: String(parseFormattedNumber($('#mx-amount-in').val())),
			txtRatePercent: $('#mx-rate-percent').val(),
			txtExchangeAmount: String(parseFormattedNumber($('#mx-exchange-amount').val())),
		})
			.done(function () {
				Swal.fire('Success', 'Deposit saved.', 'success');
				resetMoneyExchangeForm();
				loadDepositHistory();
			})
			.fail(function (xhr) {
				Swal.fire('Error', xhr.responseText || 'Save failed.', 'error');
			})
			.always(function () {
				$btn.prop('disabled', false);
			});
	});

	$(document).on('click', '#btn-mx-save-return', function () {
		const $btn = $(this);
		const sourceDepositId = String($('#mx-source-deposit-id').val() || '').trim();
		if (!sourceDepositId) {
			Swal.fire('Validation', 'Select a pending deposit row first.', 'warning');
			return;
		}
		const dep = getLinkedDepositRow();
		const ret = parseFormattedNumber($('#mx-return-amount').val());
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
		$btn.prop('disabled', true);
		const marginVal = String($('#mx-margin-return').val() || '').trim();
		const payload = {
			txtAccountId: $('#mx-account').val() || '',
			txtGuestName: String($('#mx-guest-name').val() || '').trim(),
			txtRemark: String($('#mx-return-remark').val() || '').trim(),
			txtReturnAmount: String(parseFormattedNumber($('#mx-return-amount').val())),
			txtSourceDepositId: sourceDepositId,
		};
		if (marginVal !== '') {
			payload.txtMarginReturn = String(parseFormattedNumber(marginVal));
		}
		$.post(urlMxReturn, payload)
			.done(function () {
				Swal.fire('Success', 'Return saved.', 'success');
				resetMoneyExchangeForm();
				loadDepositHistory();
			})
			.fail(function (xhr) {
				Swal.fire('Error', xhr.responseText || 'Save failed.', 'error');
			})
			.always(function () {
				$btn.prop('disabled', false);
			});
	});

	$(document).on('click', '.btn-mx-link-return', function () {
		const id = $(this).data('id');
		const row = getDepositRowById(id);
		if (!row) return;
		applyDepositToReturnForm(row);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	});

	$(document).on('click', '.btn-mx-view-return', function () {
		const id = $(this).data('id');
		const row = getDepositRowById(id);
		if (!row) return;
		openReturnDetailsModal(row);
	});
})();
