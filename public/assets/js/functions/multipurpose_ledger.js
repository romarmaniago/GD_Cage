let jflTable;
let jflFundsBalances = {};
let jflFundsBalanceCodes = {};
let jflEditingRow = null;

const JFL_CREDIT_TYPES = new Set([1]);
const JFL_DEBIT_TYPES = new Set([2, 3, 4]);

function sanitizeAmountInput(value) {
	return String(value || '').replace(/[^\d.]/g, '');
}

function formatAmountInput(value) {
	const cleaned = sanitizeAmountInput(value);
	if (!cleaned) return '';
	const parts = cleaned.split('.');
	const integerPart = parts[0] || '0';
	const decimalPart = parts.length > 1 ? parts[1].slice(0, 2) : '';
	const formattedInteger = Number(integerPart).toLocaleString('en-US');
	return decimalPart !== '' ? formattedInteger + '.' + decimalPart : formattedInteger;
}

function formatMoney(n) {
	return (Number(n) || 0).toLocaleString('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	});
}

function isTransferModeSelected() {
	const checked = document.querySelector('input[name="jfl-trans-type"]:checked');
	return checked && Number(checked.value) === 3;
}

function isDepositOrWithdrawalSelected() {
	const t = getSelectedTransType();
	return t === 1 || t === 2;
}

function getPhpCurrencyId() {
	if (window.jflPhpCurrencyId != null && window.jflPhpCurrencyId !== '') {
		return Number(window.jflPhpCurrencyId);
	}
	let found = null;
	$('input[name="jfl-currency"]').each(function () {
		if (String($(this).data('code') || '').trim().toUpperCase() === 'PHP') {
			found = parseInt($(this).val(), 10);
			return false;
		}
	});
	return found;
}

function clearCurrencySelection() {
	$('input[name="jfl-currency"]').prop('checked', false);
}

function setCurrencyInForm(currencyId) {
	clearCurrencySelection();
	if (!currencyId) return;
	const $radio = $('#jfl-currency-' + currencyId);
	if ($radio.length) {
		$radio.prop('checked', true);
	}
}

function syncTransferUi() {
	const isTransfer = isTransferModeSelected();
	const showCurrency = isDepositOrWithdrawalSelected();
	const $accountWrap = $('#jfl-account-wrap');
	const $currencyWrap = $('#jfl-currency-wrap');

	if (isTransfer) {
		$accountWrap.removeClass('d-none');
		$currencyWrap.addClass('d-none');
		if (!$('#jfl-account option').length) {
			loadJflAccounts();
		}
	} else if (showCurrency) {
		$accountWrap.addClass('d-none');
		$currencyWrap.removeClass('d-none');
		$('#jfl-account').val('').trigger('change');
	} else {
		$accountWrap.addClass('d-none');
		$currencyWrap.addClass('d-none');
		$('#jfl-account').val('').trigger('change');
	}
	refreshModalBalance();
}

function clearTransTypeSelection() {
	$('input[name="jfl-trans-type"]').prop('checked', false);
	clearCurrencySelection();
	syncTransferUi();
}

function getSelectedTransType() {
	const checked = document.querySelector('input[name="jfl-trans-type"]:checked');
	if (!checked) {
		return null;
	}
	const n = parseInt(checked.value, 10);
	return Number.isNaN(n) ? null : n;
}

function setTransTypeInForm(transType) {
	$('input[name="jfl-trans-type"]').prop('checked', false);
	if (transType === undefined || transType === null || transType === '') {
		syncTransferUi();
		return;
	}
	const t = Number(transType);
	if (t === 3) {
		$('#jfl-type-transfer').prop('checked', true);
	} else if (t === 2) {
		$('#jfl-type-withdrawal').prop('checked', true);
	} else if (t === 1) {
		$('#jfl-type-deposit').prop('checked', true);
	}
	syncTransferUi();
}

function transTypeLabel(transType) {
	switch (Number(transType)) {
		case 1:
			return 'Deposit';
		case 2:
			return 'Withdrawal';
		case 3:
			return 'Transfer';
		case 4:
			return 'Money Exchange';
		default:
			return 'Unknown';
	}
}

function isCreditType(transType) {
	return JFL_CREDIT_TYPES.has(Number(transType));
}

function isDebitType(transType) {
	return JFL_DEBIT_TYPES.has(Number(transType));
}

function isTransferTransType(transType) {
	return Number(transType) === 3;
}

function isMoneyExchangeTransType(transType) {
	return Number(transType) === 4;
}

function jflTypeColorClass(transType) {
	if (isCreditType(transType)) return 'jfl-amount-in';
	return 'jfl-amount-out';
}

function isJflParenthesizedOutType(transType) {
	const t = Number(transType);
	return t === 2 || t === 3;
}

function formatJflOutAmount(amt) {
	return '<span class="jfl-amount-out">(' + formatMoney(amt) + ')</span>';
}

function renderJflCurrencyCell(data, type, row) {
	const outCode = String(data || '').trim();
	if (!isMoneyExchangeTransType(row.TRANS_TYPE)) {
		return outCode || '-';
	}
	const inCode = String(row.EXCHANGE_IN_CURRENCY_CODE || '').trim();
	if (!inCode || !outCode) return outCode || '-';
	return inCode + ' → ' + outCode;
}

function renderJflAmountCell(data, type, row) {
	const outAmt = Number(data) || 0;
	if (!isMoneyExchangeTransType(row.TRANS_TYPE)) {
		if (type !== 'display') return outAmt;
		if (isJflParenthesizedOutType(row.TRANS_TYPE)) {
			return formatJflOutAmount(outAmt);
		}
		return (
			'<span class="' +
			jflTypeColorClass(row.TRANS_TYPE) +
			'">' +
			formatMoney(outAmt) +
			'</span>'
		);
	}

	const inAmt = Number(row.EXCHANGE_AMOUNT_IN);
	const inCode = String(row.EXCHANGE_IN_CURRENCY_CODE || '').trim();
	const outCode = String(row.CURRENCY_CODE || '').trim();
	const hasInLeg = Number.isFinite(inAmt) && inAmt > 0 && inCode;

	if (type === 'sort' || type === 'type') return outAmt;
	if (type === 'filter') {
		if (!hasInLeg) return String(outAmt);
		return inAmt + ' ' + inCode + ' ' + outAmt + ' ' + outCode;
	}
	if (type !== 'display') return outAmt;

	if (!hasInLeg) {
		return formatJflOutAmount(outAmt);
	}

	return (
		'<div class="jfl-exchange-amounts">' +
		'<div><span class="text-muted me-1">In</span>' +
		'<span class="jfl-amount-in">' +
		formatMoney(inAmt) +
		'</span> <span class="text-muted">' +
		inCode +
		'</span></div>' +
		'<div><span class="text-muted me-1">Out</span>' +
		formatJflOutAmount(outAmt) +
		' <span class="text-muted">' +
		outCode +
		'</span></div>' +
		'</div>'
	);
}

function junketDebitAmountForRow(row, currencyId) {
	if (!row || !isDebitType(row.TRANS_TYPE)) return 0;
	if (currencyId && Number(row.CURRENCY_ID) !== Number(currencyId)) return 0;
	return Number(row.AMOUNT) || 0;
}

function getSelectedCurrencyId() {
	if (isTransferModeSelected()) {
		return getPhpCurrencyId();
	}
	const checked = document.querySelector('input[name="jfl-currency"]:checked');
	if (!checked) {
		return null;
	}
	const n = parseInt(checked.value, 10);
	return Number.isNaN(n) ? null : n;
}

function getSelectedCurrencyCode() {
	if (isTransferModeSelected()) {
		return 'PHP';
	}
	const checked = document.querySelector('input[name="jfl-currency"]:checked');
	if (!checked) return '';
	const id = parseInt(checked.value, 10);
	return jflFundsBalanceCodes[id] || String($(checked).data('code') || '').trim();
}

function getBalanceForCurrency(currencyId) {
	if (currencyId == null) return 0;
	return Number(jflFundsBalances[currencyId]) || 0;
}

function getAvailableJunketBalanceForDebit(editingRow, currencyId) {
	const cid = currencyId != null ? currencyId : getSelectedCurrencyId();
	return getBalanceForCurrency(cid) + junketDebitAmountForRow(editingRow, cid);
}

function showJflValidationSwal(text, title) {
	Swal.fire({
		icon: 'warning',
		title: title || 'Validation',
		text: text,
		confirmButtonText: 'OK'
	});
}

function showJflInsufficientBalanceSwal(available, requested, currencyCode) {
	const ccy = currencyCode ? ' ' + currencyCode : '';
	Swal.fire({
		icon: 'warning',
		title: 'Insufficient Balance',
		html:
			'<p class="mb-2 text-muted">Amount exceeds available balance for this currency.</p>' +
			'<p class="mb-0">' +
			'<strong>Available:</strong> ' +
			formatMoney(available) +
			ccy +
			'<br><strong>Requested:</strong> ' +
			formatMoney(requested) +
			ccy +
			'</p>',
		confirmButtonText: 'OK'
	});
}

function isInsufficientBalanceMessage(msg) {
	return /insufficient.*balance/i.test(String(msg || ''));
}

function checkJflDebitAmount(transType, amountRaw, editingRow, currencyId) {
	const clean = sanitizeAmountInput(amountRaw);
	if (clean === '' || Number.isNaN(Number(clean))) {
		return { ok: false, message: 'Enter a valid amount greater than zero' };
	}
	const amount = Number(clean);
	if (amount <= 0) {
		return { ok: false, message: 'Enter a valid amount greater than zero' };
	}
	const cid = currencyId != null ? currencyId : getSelectedCurrencyId();
	if (!cid) {
		return { ok: false, message: 'Select a currency' };
	}
	if (!isDebitType(transType)) {
		return { ok: true };
	}
	const available = getAvailableJunketBalanceForDebit(editingRow, cid);
	if (amount > available) {
		return {
			ok: false,
			insufficient: true,
			available,
			amount,
			currencyCode: getSelectedCurrencyCode()
		};
	}
	return { ok: true };
}

function initJflAccountSelect2() {
	const $sel = $('#jfl-account');
	if (!$sel.length || typeof $sel.select2 !== 'function') return;
	if ($sel.data('select2')) {
		try {
			$sel.select2('destroy');
		} catch (e) {}
	}
	$sel.select2({
		placeholder: 'Select account',
		allowClear: false,
		dropdownParent: $('#modal-jfl'),
		width: '100%'
	});
}

function jflAccountOptionLabel(a) {
	const id = a.account_id;
	const parts = [a.agent_code, a.agent_name].filter(Boolean);
	return parts.length ? parts.join(' — ') : 'Account #' + id;
}

function compareJflAccountsAz(a, b) {
	const nameA = String(a.agent_name || '').trim();
	const nameB = String(b.agent_name || '').trim();
	const byName = nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
	if (byName !== 0) return byName;
	const codeA = String(a.agent_code || '').trim();
	const codeB = String(b.agent_code || '').trim();
	const byCode = codeA.localeCompare(codeB, undefined, { sensitivity: 'base', numeric: true });
	if (byCode !== 0) return byCode;
	return String(a.account_id || '').localeCompare(String(b.account_id || ''), undefined, {
		sensitivity: 'base',
		numeric: true
	});
}

function loadJflAccounts() {
	return $.getJSON('/account_data')
		.done(function (rows) {
			const $sel = $('#jfl-account');
			const prev = $sel.val();
			if ($sel.data('select2')) {
				try {
					$sel.select2('destroy');
				} catch (e) {}
			}
			$sel.empty().append($('<option/>', { value: '', text: 'Select account' }));
			const accounts = (rows || [])
				.filter(function (a) {
					return a.account_id != null;
				})
				.slice()
				.sort(compareJflAccountsAz);
			accounts.forEach(function (a) {
				const id = a.account_id;
				const label = jflAccountOptionLabel(a);
				$sel.append($('<option/>', { value: String(id), text: label }));
			});
			if (prev && $sel.find('option[value="' + prev + '"]').length) {
				$sel.val(prev);
			}
			initJflAccountSelect2();
		})
		.fail(function () {
			initJflAccountSelect2();
		});
}

function renderBalanceCards(balances) {
	const $row = $('#jfl-balance-row');
	$row.empty();
	if (!balances || !balances.length) {
		$row.append('<div class="col-12 text-muted small">No currencies configured.</div>');
		return;
	}
	const items = balances
		.map(function (b) {
			const code = String(b.currency_code || '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
			const bal = formatMoney(b.balance);
			return (
				'<span class="jfl-page-balance-item">' +
				'<span class="jfl-page-balance-code">' +
				code +
				' Balance</span>' +
				'<span class="jfl-page-balance-amt">' +
				bal +
				'</span>' +
				'</span>'
			);
		})
		.join('');
	$row.append(
		'<div class="col-12">' +
			'<div class="jfl-balance-banner jfl-page-balance-strip">' +
			'<div class="jfl-page-balance-list">' +
			items +
			'</div></div></div>'
	);
}

function renderModalBalanceList(items) {
	const $el = $('#jfl-modal-balance');
	if (!$el.length) return;
	if (!items || !items.length) {
		$el.html('<span class="jfl-modal-balance-item">—</span>');
		return;
	}
	$el.html(
		items
			.map(function (text) {
				const safe = String(text || '')
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
				return '<span class="jfl-modal-balance-item">' + safe + '</span>';
			})
			.join('')
	);
}

function collectModalBalanceItems() {
	const items = [];
	$('input[name="jfl-currency"]').each(function () {
		const id = parseInt($(this).val(), 10);
		if (!id) return;
		const code = String($(this).data('code') || jflFundsBalanceCodes[id] || '').trim();
		const bal = formatMoney(getBalanceForCurrency(id));
		items.push(bal + (code ? ' ' + code : ''));
	});
	if (items.length) return items;
	Object.keys(jflFundsBalances || {}).forEach(function (idKey) {
		const id = Number(idKey);
		const code = String(jflFundsBalanceCodes[id] || '').trim();
		const bal = formatMoney(getBalanceForCurrency(id));
		items.push(bal + (code ? ' ' + code : ''));
	});
	return items;
}

function refreshModalBalance() {
	if (isTransferModeSelected()) {
		const cid = getPhpCurrencyId();
		const bal = formatMoney(getBalanceForCurrency(cid));
		renderModalBalanceList(['PHP ' + bal]);
		return;
	}
	renderModalBalanceList(collectModalBalanceItems());
}

function loadJunketFundsBalance() {
	return $.get('/multipurpose_ledger/balance')
		.then(function (res) {
			jflFundsBalances = {};
			jflFundsBalanceCodes = {};
			const list = (res && res.balances) || [];
			list.forEach(function (b) {
				const id = Number(b.currency_id);
				jflFundsBalances[id] = Number(b.balance) || 0;
				jflFundsBalanceCodes[id] = String(b.currency_code || '');
			});
			renderBalanceCards(list);
			refreshModalBalance();
			return list;
		})
		.fail(function () {
			$('#jfl-balance-row').html(
				'<div class="col-12 text-muted small">Failed to load balances.</div>'
			);
		});
}

window.getJflBalanceForCurrency = function (currencyId) {
	return getBalanceForCurrency(currencyId);
};

function openJflModal(data) {
	jflEditingRow = data || null;
	const id = data && data.IDNo ? data.IDNo : '';
	$('#jfl-id').val(id);
	$('#jfl-incharge').val(data ? data.IN_CHARGE || '' : '');
	$('#jfl-remarks').val(data ? data.REMARKS || '' : '');
	$('#jfl-amount').val(data ? formatAmountInput(data.AMOUNT || '') : '');
	if (data && data.TRANS_TYPE) {
		setTransTypeInForm(data.TRANS_TYPE);
	} else {
		clearTransTypeSelection();
	}
	if (data && data.CURRENCY_ID) {
		setCurrencyInForm(data.CURRENCY_ID);
	}
	if (data && data.ACCOUNT_ID) {
		const setAccount = function () {
			$('#jfl-account').val(String(data.ACCOUNT_ID)).trigger('change');
		};
		if ($('#jfl-account option').length > 1) {
			setAccount();
		} else {
			loadJflAccounts().always(setAccount);
		}
	} else {
		$('#jfl-account').val('').trigger('change');
	}
	const t = window.jflTranslations || {};
	$('#jfl-modal-title').text(id ? 'Edit entry' : t.add || 'New Entry');
	loadJunketFundsBalance().always(function () {
		refreshModalBalance();
		$('#modal-jfl').modal('show');
	});
}

function fetchJflData() {
	$.get('/multipurpose_ledger_data')
		.done(function (rows) {
			jflTable.clear().rows.add(rows || []).draw();
		})
		.fail(function () {
			Swal.fire('Error', 'Failed to load junket funds ledger.', 'error');
		});
}

function removeJfl(id) {
	SwalConfirm.fire({
		title: 'Delete this record?',
		message: 'This cannot be undone.',
		confirmButtonText: 'Yes, delete'
	}).then(function (result) {
		if (!result.isConfirmed) return;
		$.ajax({
			url: '/multipurpose_ledger/remove/' + id,
			method: 'PUT',
			success: function () {
				loadJunketFundsBalance().then(fetchJflData);
				Swal.fire('Success', 'Record deleted successfully.', 'success');
			},
			error: function (xhr) {
				const msg =
					(xhr.responseJSON && xhr.responseJSON.message) ||
					'Failed to delete record.';
				Swal.fire('Error', msg, 'error');
			}
		});
	});
}

$(document).ready(function () {
	const t = window.jflTranslations || {};
	const actionColIndex = 8;

	jflTable = $('#jfl-tbl').DataTable({
		pageLength: 25,
		order: [[0, 'desc']],
		columns: [
			{
				data: 'ENCODED_DT',
				render: function (data, type) {
					if (!data) return '';
					if (type === 'sort') return data;
					return moment(data).format('YYYY-MM-DD HH:mm');
				}
			},
			{ data: 'ACCOUNT_DISPLAY', defaultContent: '-' },
			{ data: 'GUEST_DISPLAY', defaultContent: '-' },
			{ data: 'TRANS_TYPE_LABEL', defaultContent: '' },
			{
				data: 'CURRENCY_CODE',
				defaultContent: '-',
				render: renderJflCurrencyCell
			},
			{
				data: 'AMOUNT',
				render: renderJflAmountCell
			},
			{ data: 'APPROVED_BY_DISPLAY', defaultContent: '' },
			{
				data: 'REMARKS',
				defaultContent: '',
				render: function (data, type, row) {
					var raw = data != null ? String(data) : '';
					if (type !== 'display') return raw;
					if (!window.RemarksEditor) return raw;
					return window.RemarksEditor.renderCell(raw, {
						source: 'junket_funds_ledger',
						recordId: row.IDNo
					});
				}
			},
			{
				data: null,
				orderable: false,
				searchable: false,
				render: function (row) {
					return (
						'<button type="button" class="btn btn-sm btn-alt-secondary me-1 btn-jfl-edit" data-id="' +
						row.IDNo +
						'"><i class="fa fa-pencil-alt"></i></button>' +
						'<button type="button" class="btn btn-sm btn-alt-secondary btn-jfl-remove" data-id="' +
						row.IDNo +
						'"><i class="fa fa-trash-alt"></i></button>'
					);
				}
			}
		]
	});

	loadJunketFundsBalance();
	fetchJflData();

	window.fetchJflData = fetchJflData;
	window.loadJunketFundsBalance = loadJunketFundsBalance;
	window.syncTransferUi = syncTransferUi;

	$('input[name="jfl-trans-type"]').on('change', syncTransferUi);

	$('#btn-jfl-money-exchange').on('click', function () {
		if (typeof window.openJflExchangeModal === 'function') {
			window.openJflExchangeModal();
		}
	});

	$('#modal-jfl').on('hidden.bs.modal', function () {
		clearTransTypeSelection();
	});

	$('input[name="jfl-currency"]').on('change', refreshModalBalance);

	$('#jfl-amount').on('input', function () {
		$(this).val(formatAmountInput($(this).val()));
	});

	$('#btn-add-jfl').on('click', function () {
		openJflModal(null);
	});

	$('#jfl-tbl').on('click', '.btn-jfl-edit', function () {
		const id = $(this).data('id');
		const row = jflTable
			.rows()
			.data()
			.toArray()
			.find(function (r) {
				return Number(r.IDNo) === Number(id);
			});
		if (row) {
			if (Number(row.TRANS_TYPE) === 4) {
				if (typeof window.openJflExchangeModal === 'function') {
					window.openJflExchangeModal();
				}
				return;
			}
			openJflModal(row);
		}
	});

	$('#jfl-tbl').on('click', '.btn-jfl-remove', function () {
		removeJfl($(this).data('id'));
	});

	$('#jfl-form').on('submit', function (e) {
		e.preventDefault();
		const id = $('#jfl-id').val();
		const transType = getSelectedTransType();
		if (transType == null) {
			showJflValidationSwal('Select a transaction type.');
			return;
		}
		const payload = {
			txtTransType: transType,
			txtCurrencyId: getSelectedCurrencyId(),
			txtAccountId: isTransferModeSelected() ? $('#jfl-account').val() : '',
			txtAmount: sanitizeAmountInput($('#jfl-amount').val()),
			txtInCharge: $('#jfl-incharge').val(),
			txtRemarks: $('#jfl-remarks').val()
		};
		if (!payload.txtCurrencyId) {
			showJflValidationSwal(
				isTransferModeSelected() ? 'PHP currency is not configured.' : 'Select a currency.'
			);
			return;
		}
		if (!String(payload.txtRemarks || '').trim()) {
			showJflValidationSwal('Remarks is required.');
			return;
		}
		if (!String(payload.txtInCharge || '').trim()) {
			showJflValidationSwal('Approved by is required.');
			return;
		}
		if (isTransferModeSelected() && !payload.txtAccountId) {
			showJflValidationSwal('Select an account for transfer.');
			return;
		}
		const amountCheck = checkJflDebitAmount(
			payload.txtTransType,
			payload.txtAmount,
			jflEditingRow,
			payload.txtCurrencyId
		);
		if (!amountCheck.ok) {
			if (amountCheck.insufficient) {
				showJflInsufficientBalanceSwal(
					amountCheck.available,
					amountCheck.amount,
					amountCheck.currencyCode
				);
			} else {
				showJflValidationSwal(amountCheck.message);
			}
			return;
		}
		const url = id ? '/multipurpose_ledger/' + id : '/add_multipurpose_ledger';
		const method = id ? 'PUT' : 'POST';

		$('#jfl-save-btn').prop('disabled', true);
		$.ajax({
			url: url,
			method: method,
			data: payload,
			success: function () {
				$('#modal-jfl').modal('hide');
				loadJunketFundsBalance().then(fetchJflData);
				Swal.fire('Success', id ? 'Updated successfully.' : 'Saved successfully.', 'success');
			},
			error: function (xhr) {
				const msg =
					(xhr.responseJSON && xhr.responseJSON.message) ||
					'Failed to save entry.';
				if (isInsufficientBalanceMessage(msg)) {
					const available = getAvailableJunketBalanceForDebit(
						jflEditingRow,
						payload.txtCurrencyId
					);
					const requested = Number(payload.txtAmount) || 0;
					showJflInsufficientBalanceSwal(
						available,
						requested,
						getSelectedCurrencyCode()
					);
					return;
				}
				Swal.fire({
					icon: 'error',
					title: 'Error',
					text: msg,
					confirmButtonText: 'OK'
				});
			},
			complete: function () {
				$('#jfl-save-btn').prop('disabled', false);
			}
		});
	});

	function getJflTablePayload() {
		const headers = [];
		$('#jfl-tbl thead tr:first th').each(function (i) {
			if (i === actionColIndex) return;
			headers.push($(this).text().trim());
		});
		const rows = [];
		jflTable.rows({ search: 'applied' }).every(function () {
			const cells = [];
			$(this.node())
				.find('td')
				.each(function (i) {
					if (i === actionColIndex) return;
					cells.push($(this).text().trim());
				});
			if (cells.length) rows.push(cells);
		});
		return { headers: headers, rows: rows };
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	$('#btn-jfl-export').on('click', function (e) {
		e.preventDefault();
		const payload = getJflTablePayload();
		if (payload.rows.length === 0) {
			Swal.fire({
				icon: 'info',
				title: t.export_label || 'Export',
				text: t.no_data || 'No data to export.'
			});
			return;
		}
		const outName = 'MultipurposeLedger.xlsx';
		const $btn = $(this);
		$btn.prop('disabled', true);
		fetch('/multipurpose_ledger/export_xlsx', {
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
					return res
						.json()
						.catch(function () {
							return {};
						})
						.then(function (j) {
							throw new Error((j && j.error) || t.error || 'Export failed');
						});
				}
				return res.blob();
			})
			.then(function (blob) {
				const link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = outName;
				document.body.appendChild(link);
				link.click();
				link.remove();
			})
			.catch(function (err) {
				Swal.fire('Error', err.message || t.error, 'error');
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	});

	$('#btn-jfl-print').on('click', function () {
		const payload = getJflTablePayload();
		if (payload.rows.length === 0) {
			Swal.fire('Print', t.no_data || 'No data to print.', 'info');
			return;
		}
		const headerHtml = payload.headers
			.map(function (h) {
				return '<th>' + escapeHtml(h) + '</th>';
			})
			.join('');
		const rowsHtml = payload.rows
			.map(function (row) {
				return (
					'<tr>' +
					row
						.map(function (cell) {
							return '<td>' + escapeHtml(cell) + '</td>';
						})
						.join('') +
					'</tr>'
				);
			})
			.join('');
		const iframe = document.createElement('iframe');
		iframe.style.cssText = 'position:fixed;width:0;height:0;border:0';
		document.body.appendChild(iframe);
		const w = iframe.contentWindow;
		const doc = w.document;
		doc.open();
		doc.write(
			'<!doctype html><html><head><title>Multipurpose Ledger</title><style>' +
				'@page{size:landscape;margin:10mm;}body{font-family:Arial,sans-serif;font-size:11px;}' +
				'table{width:100%;border-collapse:collapse;}th,td{border:1px solid #777;padding:6px;}' +
				'th{background:#d9e1f2;}</style></head><body>' +
				'<h2 style="text-align:center">Multipurpose Ledger</h2>' +
				'<table><thead><tr>' +
				headerHtml +
				'</tr></thead><tbody>' +
				rowsHtml +
				'</tbody></table></body></html>'
		);
		doc.close();
		setTimeout(function () {
			w.focus();
			w.print();
			setTimeout(function () {
				iframe.remove();
			}, 300);
		}, 250);
	});
});
