$(function () {
	if (window.__newServiceRecordBound) return;
	if (!$('#modal-services-new-record').length) return;
	window.__newServiceRecordBound = true;

	const $modal = $('#modal-services-new-record');
	const $accountSelect = $('#new-services-account');
	const $accountWrapper = $('#new-services-account-wrapper');
	const $transactionType = $('#new-transaction-type');
	const $paymentMethods = $('#new-services-payment-methods');
	const $agentInput = $('#new-services-agent-id');
	const $gameInput = $('#new-services-game-id');
	const $saveBtn = $('#new-services-save');
	const $balanceHint = $('#deposit-balance');
	const $balanceValue = $('#deposit-balance-value');
	let depositBalance = 0;

	const t = window.fnbHotelTranslations || {};

	function resetForm() {
		$transactionType.val('');
		if ($accountSelect.data('select2')) {
			$accountSelect.val('').trigger('change');
		} else {
			$accountSelect.val('');
		}
		$agentInput.val('');
		$gameInput.val('');
		$('#new-services-type').val('');
		$('#new-services-amount').val('');
		$('#new-services-remarks').val('');
		$('input[name="new-services-transaction"]').prop('checked', false);
		$paymentMethods.show();
	}

	function toggleAccountByTransactionType() {
		const type = $transactionType.val();
		const shouldShow = type === 'GUEST' || type === 'JUNKET';
		if (shouldShow) {
			$accountWrapper.show();
			$accountSelect.prop('disabled', false);
			$paymentMethods.show();
		} else {
			$accountWrapper.hide();
			if ($accountSelect.data('select2')) {
				$accountSelect.val('').trigger('change');
			} else {
				$accountSelect.val('');
			}
			$accountSelect.prop('disabled', true);
			$agentInput.val('');
			$gameInput.val('');
			depositBalance = 0;
			updateBalanceHint();
			$paymentMethods.hide();
			$('input[name="new-services-transaction"]').prop('checked', false);
		}
	}

	function initAccountSelect2() {
		if ($accountSelect.data('select2')) {
			$accountSelect.select2('destroy');
		}
		$accountSelect.select2({
			placeholder: $accountSelect.attr('data-placeholder'),
			allowClear: false,
			dropdownParent: $modal
		});
	}

	async function populateAccounts() {
		$accountSelect.prop('disabled', true);
		try {
			const res = await fetch('/fnb-hotel/accounts');
			if (!res.ok) {
				throw new Error('Unable to load accounts.');
			}
			const accounts = await res.json();
			if ($accountSelect.data('select2')) {
				$accountSelect.select2('destroy');
			}
			$accountSelect.empty();
			$accountSelect.append($('<option>').val('').text($accountSelect.attr('data-placeholder')));
			accounts.forEach(function (acc) {
				const label = acc.agent_name
					? acc.agent_name + ' (' + (acc.agent_code || 'No code') + ')'
					: 'Account #' + acc.account_id;
				const $option = $('<option>')
					.val(acc.account_id)
					.text(label)
					.data('agentId', acc.agent_id)
					.data('gameId', acc.current_game_id || '')
					.data('balance', acc.balance || 0);
				$accountSelect.append($option);
			});
			initAccountSelect2();
		} catch (err) {
			console.error(err);
			$accountSelect.empty().append('<option value="" disabled>Failed to load accounts</option>');
			initAccountSelect2();
		} finally {
			$accountSelect.prop('disabled', false);
		}
	}

	async function populateServiceTypes(selectedValue) {
		if (typeof window.populateServiceCategorySelect !== 'function') return;
		await window.populateServiceCategorySelect($('#new-services-type'), selectedValue || '');
	}

	$modal.on('show.bs.modal', async function () {
		resetForm();
		await Promise.all([
			populateAccounts(),
			populateServiceTypes('')
		]);
		toggleAccountByTransactionType();
	});

	function updateBalanceHint() {
		const transaction = $('input[name="new-services-transaction"]:checked').val();
		if (transaction === '2' && depositBalance !== null) {
			$balanceValue.text(depositBalance.toLocaleString('en-US'));
			$balanceHint.show();
		} else {
			$balanceHint.hide();
		}
	}

	async function loadDepositBalance(accountId) {
		depositBalance = 0;
		if (!accountId) return;

		try {
			const response = await fetch('/account_details_data_deposit/' + accountId);
			if (!response.ok) throw new Error('Failed to fetch deposit data');
			const data = await response.json();

			let deposit_amount = 0;
			let withdraw_amount = 0;
			let marker_deposit_amount = 0;
			let marker_return = 0;

			data.forEach(function (row) {
				const amount = parseFloat(row.AMOUNT || 0);
				if (row.TRANSACTION === 'DEPOSIT') {
					deposit_amount += amount;
				} else if (row.TRANSACTION === 'WITHDRAW') {
					withdraw_amount += amount;
				} else if (row.TRANSACTION === 'MARKER REDEEM') {
					marker_deposit_amount += amount;
				} else if (row.TRANSACTION === 'IOU RETURN DEPOSIT' || row.TRANSACTION === 'Credit Returned thru Deposit') {
					marker_return += amount;
				}
			});

			depositBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;
		} catch (err) {
			console.error('Error loading deposit balance', err);
			depositBalance = 0;
		}
	}

	$accountSelect.on('change', async function () {
		const $selected = $(this).find('option:selected');
		$agentInput.val($selected.data('agentId') || '');
		$gameInput.val($selected.data('gameId') || '');
		await loadDepositBalance($selected.val());
		updateBalanceHint();
	});

	$('input[name="new-services-transaction"]').on('change', updateBalanceHint);
	$transactionType.on('change', toggleAccountByTransactionType);

	$('#new-services-amount').on('input', function () {
		const $input = $(this);
		let raw = $input.val() || '';
		raw = raw.replace(/[^\d.]/g, '');
		const parts = raw.split('.');
		if (parts.length > 2) {
			raw = parts[0] + '.' + parts.slice(1).join('');
		}
		const intPart = raw.split('.')[0];
		const decPart = raw.split('.')[1];
		const formattedInt = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		const formatted = decPart !== undefined ? formattedInt + '.' + decPart : formattedInt;
		$input.val(formatted);
	});

	$saveBtn.on('click', async function () {
		const accountId = $accountSelect.val();
		const agentId = $agentInput.val();
		const gameId = $gameInput.val();
		const serviceType = $('#new-services-type').val();
		const amountRaw = $('#new-services-amount').val().replace(/,/g, '').trim();
		const amount = parseFloat(amountRaw) || 0;
		const remarks = $('#new-services-remarks').val().trim();
		const transactionId = $('input[name="new-services-transaction"]:checked').val();
		const sourceType = $transactionType.val();

		if (!sourceType) {
			Swal.fire({ icon: 'warning', title: t.missing_fields || 'Missing fields', text: t.select_who_is_paying || 'Select who is paying.' });
			return;
		}
		if (!serviceType) {
			Swal.fire({ icon: 'warning', title: t.missing_fields || 'Missing fields', text: t.select_service_type || 'Select a service type.' });
			return;
		}
		if (!accountId) {
			Swal.fire({ icon: 'warning', title: t.missing_fields || 'Missing fields', text: t.select_account || 'Select an account.' });
			return;
		}
		if (!transactionId) {
			Swal.fire({ icon: 'warning', title: t.missing_fields || 'Missing fields', text: t.select_transaction_type || 'Select a transaction type.' });
			return;
		}

		$saveBtn.prop('disabled', true).text(t.saving || 'Saving...');

		try {
			const response = await fetch('/fnb-hotel/service', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					account_id: accountId,
					agent_id: agentId,
					game_id: gameId,
					service_type: serviceType,
					amount: amount,
					remarks: remarks,
					transaction_id: transactionId,
					source_type: sourceType
				})
			});

			if (!response.ok) {
				const error = await response.json().catch(function () { return {}; });
				throw new Error(error.error || (t.failed_to_save || 'Failed to create service record.'));
			}

			await Swal.fire({
				icon: 'success',
				title: t.service_recorded || 'Service recorded',
				timer: 1200,
				showConfirmButton: false
			});

			if (window.reloadFnbHotelData) {
				window.reloadFnbHotelData();
			}
			$modal.modal('hide');
		} catch (err) {
			Swal.fire({ icon: 'error', title: t.error || 'Error', text: err.message || (t.failed_to_save || 'Failed to save record.') });
		} finally {
			$saveBtn.prop('disabled', false).text(t.save || 'Save');
		}
	});
});
