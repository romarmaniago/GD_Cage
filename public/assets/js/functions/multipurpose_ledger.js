let jflTable;
let jflFundsBalance = 0;
let jflEditingRow = null;

const JFL_CREDIT_TYPES = new Set([1, 3]);
const JFL_DEBIT_TYPES = new Set([2, 4]);

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
	return checked && checked.value === 'transfer';
}

function syncTransferUi() {
	const show = isTransferModeSelected();
	const $wrap = $('#jfl-account-wrap');
	if (show) {
		$wrap.removeClass('d-none');
		if (!$('#jfl-account option').length) {
			loadJflAccounts();
		}
	} else {
		$wrap.addClass('d-none');
		$('#jfl-account').val('').trigger('change');
	}
}

function clearTransTypeSelection() {
	$('input[name="jfl-trans-type"]').prop('checked', false);
	syncTransferUi();
}

function getSelectedTransType() {
	if (isTransferModeSelected()) {
		return 4;
	}
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
	if (t === 4) {
		$('#jfl-type-transfer').prop('checked', true);
	} else if (t === 2) {
		$('#jfl-type-withdrawal').prop('checked', true);
	} else if (t === 3 || t === 1) {
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
			return 'Transfer In (legacy)';
		case 4:
			return 'Transfer';
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
	return Number(transType) === 4;
}

function jflTypeColorClass(transType) {
	if (isCreditType(transType)) return 'jfl-amount-in';
	if (isTransferTransType(transType)) return 'jfl-amount-transfer';
	return 'jfl-amount-out';
}

function junketDebitAmountForRow(row) {
	if (!row || !isDebitType(row.TRANS_TYPE)) return 0;
	return Number(row.AMOUNT) || 0;
}

function getAvailableJunketBalanceForDebit(editingRow) {
	return jflFundsBalance + junketDebitAmountForRow(editingRow);
}

function showJflValidationSwal(text, title) {
	Swal.fire({
		icon: 'warning',
		title: title || 'Validation',
		text: text,
		confirmButtonText: 'OK'
	});
}

function showJflInsufficientBalanceSwal(available, requested) {
	Swal.fire({
		icon: 'warning',
		title: 'Insufficient Balance',
		html:
			'<p class="mb-2 text-muted">Amount exceeds available junket funds.</p>' +
			'<p class="mb-0">' +
			'<strong>Available:</strong> ' +
			formatMoney(available) +
			'<br><strong>Requested:</strong> ' +
			formatMoney(requested) +
			'</p>',
		confirmButtonText: 'OK'
	});
}

function isInsufficientBalanceMessage(msg) {
	return /insufficient junket funds balance/i.test(String(msg || ''));
}

function checkJflDebitAmount(transType, amountRaw, editingRow) {
	const clean = sanitizeAmountInput(amountRaw);
	if (clean === '' || Number.isNaN(Number(clean))) {
		return { ok: false, message: 'Enter a valid amount greater than zero' };
	}
	const amount = Number(clean);
	if (amount <= 0) {
		return { ok: false, message: 'Enter a valid amount greater than zero' };
	}
	if (!isDebitType(transType)) {
		return { ok: true };
	}
	const available = getAvailableJunketBalanceForDebit(editingRow);
	if (amount > available) {
		return { ok: false, insufficient: true, available, amount };
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
			initJflAccountSelect2();
		})
		.fail(function () {
			initJflAccountSelect2();
		});
}

function refreshModalBalance() {
	$('#jfl-modal-balance').text(formatMoney(jflFundsBalance));
}

function loadJunketFundsBalance() {
	return $.get('/multipurpose_ledger/balance')
		.then(function (res) {
			jflFundsBalance = Number(res && res.balance) || 0;
			$('#jfl-funds-balance').text(formatMoney(jflFundsBalance));
			refreshModalBalance();
		})
		.fail(function () {
			$('#jfl-funds-balance').text('—');
		});
}

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
	Swal.fire({
		title: 'Delete this record?',
		text: 'This cannot be undone.',
		icon: 'warning',
		showCancelButton: true,
		confirmButtonText: 'Yes, delete',
		cancelButtonText: 'Cancel'
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
	const actionColIndex = 7;

	jflTable = $('#jfl-tbl').DataTable({
		pageLength: 25,
		order: [[6, 'desc']],
		columns: [
			{
				data: 'TRANS_TYPE',
				render: function (data, type, row) {
					const label = row.TRANS_TYPE_LABEL || transTypeLabel(data);
					if (type === 'sort') return label;
					const cls = jflTypeColorClass(data);
					return '<span class="' + cls + '">' + label + '</span>';
				}
			},
			{ data: 'ACCOUNT_DISPLAY', defaultContent: '-' },
			{
				data: 'AMOUNT',
				render: function (data, type, row) {
					const n = Number(data) || 0;
					const cls = jflTypeColorClass(row.TRANS_TYPE);
					const prefix = isCreditType(row.TRANS_TYPE) ? '+' : '-';
					if (type === 'sort') return n;
					return '<span class="' + cls + '">' + prefix + formatMoney(n) + '</span>';
				}
			},
			{ data: 'IN_CHARGE', defaultContent: '' },
			{ data: 'REMARKS', defaultContent: '' },
			{ data: 'ENCODED_BY_NAME', defaultContent: '' },
			{
				data: 'ENCODED_DT',
				render: function (data, type) {
					if (!data) return '';
					if (type === 'sort') return data;
					return moment(data).format('DD MMM YYYY HH:mm:ss');
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

	$('input[name="jfl-trans-type"]').on('change', syncTransferUi);

	$('#modal-jfl').on('hidden.bs.modal', function () {
		clearTransTypeSelection();
	});

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
		if (row) openJflModal(row);
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
			txtAccountId: isTransferModeSelected() ? $('#jfl-account').val() : '',
			txtAmount: sanitizeAmountInput($('#jfl-amount').val()),
			txtInCharge: $('#jfl-incharge').val(),
			txtRemarks: $('#jfl-remarks').val()
		};
		if (!String(payload.txtRemarks || '').trim()) {
			showJflValidationSwal('Remarks is required.');
			return;
		}
		if (!String(payload.txtInCharge || '').trim()) {
			showJflValidationSwal('Person in charge is required.');
			return;
		}
		if (isTransferModeSelected() && !payload.txtAccountId) {
			showJflValidationSwal('Select an account for transfer.');
			return;
		}
		const amountCheck = checkJflDebitAmount(
			payload.txtTransType,
			payload.txtAmount,
			jflEditingRow
		);
		if (!amountCheck.ok) {
			if (amountCheck.insufficient) {
				showJflInsufficientBalanceSwal(amountCheck.available, amountCheck.amount);
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
					const available = getAvailableJunketBalanceForDebit(jflEditingRow);
					const requested = Number(payload.txtAmount) || 0;
					showJflInsufficientBalanceSwal(available, requested);
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
