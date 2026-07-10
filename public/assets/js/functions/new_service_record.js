$(function () {
	if (window.__newServiceRecordBound) return;
	if (!$('#modal-services-new-record').length) return;
	window.__newServiceRecordBound = true;

	const $modal = $('#modal-services-new-record');
	const $accountSelect = $('#new-services-account');
	const $guestSelect = $('#new-services-guest');
	const $accountWrapper = $('#new-services-account-wrapper');
	const $transactionType = $('#new-transaction-type');
	const $paymentMethods = $('#new-services-payment-methods');
	const $agentInput = $('#new-services-agent-id');
	const $gameInput = $('#new-services-game-id');
	const $saveBtn = $('#new-services-save');
	const $balanceHint = $('#deposit-balance');
	const $balanceValue = $('#deposit-balance-value');
	const $serviceTypeValue = $('#new-services-type-value');
	const $serviceTypeList = $('#new-services-type-list');
	const $programDate = $('#new-services-program-date');
	let depositBalance = 0;
	let programDatePicker = null;

	const t = window.fnbHotelTranslations || {};

	function formatYmd(date) {
		const d = date instanceof Date ? date : new Date(date);
		if (Number.isNaN(d.getTime())) return '';
		const pad = (n) => String(n).padStart(2, '0');
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	}

	function todayProgramDateValue() {
		return formatYmd(new Date());
	}

	function getProgramDateValue() {
		const el = $programDate[0];
		if (!el) return '';
		if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates[0]) {
			return formatYmd(el._flatpickr.selectedDates[0]);
		}
		return String(el.value || '').trim().slice(0, 10);
	}

	function ensureProgramDatePicker(defaultDate) {
		const el = $programDate[0];
		if (!el) return;
		const dateVal = defaultDate || getProgramDateValue() || todayProgramDateValue();
		if (typeof flatpickr === 'undefined') {
			el.value = dateVal;
			return;
		}
		if (el._flatpickr) {
			try { el._flatpickr.destroy(); } catch (e) {}
		}
		programDatePicker = flatpickr(el, {
			enableTime: false,
			dateFormat: 'Y-m-d',
			altInput: true,
			altFormat: 'M j, Y',
			defaultDate: dateVal,
			allowInput: true,
			disableMobile: true,
			closeOnSelect: true
		});
	}

	function resetForm() {
		$transactionType.val('');
		if ($accountSelect.data('select2')) {
			$accountSelect.val('').trigger('change');
		} else {
			$accountSelect.val('');
		}
		resetGuestSelect();
		$agentInput.val('');
		$gameInput.val('');
		$serviceTypeValue.val('');
		$serviceTypeList.html('<span class="new-services-type-placeholder text-muted small">' + escapeHtml(t.select_service || 'Select service') + '</span>');
		$('#new-services-amount').val('');
		$('#new-services-remarks').val('');
		$('input[name="new-services-transaction"]').prop('checked', false);
		$paymentMethods.show();
		ensureProgramDatePicker(todayProgramDateValue());
	}

	function toggleAccountByTransactionType() {
		const type = $transactionType.val();
		const isActive = type === 'GUEST' || type === 'JUNKET';

		$accountWrapper.show();
		if (isActive) {
			$accountSelect.prop('disabled', false);
			$guestSelect.prop('disabled', !$accountSelect.val());
			$paymentMethods.show();
		} else {
			if ($accountSelect.data('select2')) {
				$accountSelect.val('').trigger('change');
			} else {
				$accountSelect.val('');
			}
			resetGuestSelect();
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
			allowClear: true,
			dropdownParent: $modal,
			width: '100%'
		});
	}

	function initGuestSelect2() {
		if ($guestSelect.data('select2')) {
			$guestSelect.select2('destroy');
		}
		$guestSelect.select2({
			placeholder: $guestSelect.attr('data-placeholder'),
			allowClear: true,
			dropdownParent: $modal,
			width: '100%'
		});
	}

	function resetGuestSelect() {
		if ($guestSelect.data('select2')) {
			$guestSelect.select2('destroy');
		}
		$guestSelect.empty().append(
			$('<option>').val('').text($guestSelect.attr('data-placeholder') || (t.select_guest_optional || 'Select Guest (Optional)'))
		);
		initGuestSelect2();
		$guestSelect.val('').trigger('change');
		$guestSelect.prop('disabled', true);
	}

	async function populateGuests(agentId, preselectGuestId) {
		resetGuestSelect();
		const parsedAgentId = parseInt(agentId, 10);
		if (!parsedAgentId) return;

		try {
			const res = await fetch('/guest_data?agentId=' + encodeURIComponent(parsedAgentId));
			if (!res.ok) throw new Error('Unable to load guests.');
			const guests = await res.json();

			if ($guestSelect.data('select2')) {
				$guestSelect.select2('destroy');
			}
			$guestSelect.empty().append(
				$('<option>').val('').text($guestSelect.attr('data-placeholder') || (t.select_guest_optional || 'Select Guest (Optional)'))
			);
			(guests || []).forEach(function (guest) {
				const guestId = guest.guest_id;
				if (guestId == null) return;
				const guestName = String(guest.guest_name || '').trim() || ('Guest #' + guestId);
				$guestSelect.append($('<option>').val(String(guestId)).text(guestName));
			});
			initGuestSelect2();

			const preselect = String(preselectGuestId || '').trim();
			if (preselect && $guestSelect.find('option[value="' + preselect + '"]').length) {
				$guestSelect.val(preselect).trigger('change');
			} else {
				$guestSelect.val('').trigger('change');
			}
			$guestSelect.prop('disabled', false);
		} catch (err) {
			console.error(err);
			resetGuestSelect();
		}
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
			toggleAccountByTransactionType();
		}
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function normalizeCategoryKey(category) {
		return String(category || '').trim().toLowerCase();
	}

	function setSelectedServiceType(value) {
		const raw = String(value || '').trim();
		$serviceTypeValue.val(raw);
		if (!$serviceTypeList.length) return;
		$serviceTypeList.find('input[type="radio"][name="new-services-type"]').each(function () {
			const v = String(this.value || '').trim();
			this.checked = !!raw && v.toLowerCase() === raw.toLowerCase();
		});
	}

	async function populateServiceTypeCheckboxes(selectedValue) {
		if (!$serviceTypeList.length) return;
		$serviceTypeList.html('<span class="new-services-type-placeholder text-muted small">' + escapeHtml(t.select_service || 'Select service') + '</span>');

		try {
			const res = await fetch('/services_category_data');
			if (!res.ok) throw new Error('Failed to load service categories');
			const rows = await res.json();

			const selected = String(selectedValue || '').trim();
			let hasSelected = false;
			$serviceTypeList.empty();
			(rows || []).forEach(function (row, idx) {
				const category = String(row.CATEGORY || '').trim();
				if (!category) return;
				const key = normalizeCategoryKey(category);
				const id = 'new-services-type-' + idx;
				const isChecked = selected && key === selected.toLowerCase();
				if (isChecked) hasSelected = true;
				const html =
					'<div class="form-check form-check-inline mb-0">' +
					'<input class="form-check-input" style="border-color: #8a92a6 !important;" type="radio" name="new-services-type" id="' + escapeHtml(id) + '" value="' + escapeHtml(category) + '"' + (isChecked ? ' checked' : '') + '>' +
					'<label class="form-check-label" for="' + escapeHtml(id) + '">' + escapeHtml(category) + '</label>' +
					'</div>';
				$serviceTypeList.append(html);
			});

			if (selected && !hasSelected) {
				const id = 'new-services-type-legacy';
				$serviceTypeList.append(
					'<div class="form-check form-check-inline mb-0">' +
					'<input class="form-check-input" style="border-color: #8a92a6 !important;" type="radio" name="new-services-type" id="' + escapeHtml(id) + '" value="' + escapeHtml(selected) + '" checked>' +
					'<label class="form-check-label" for="' + escapeHtml(id) + '">' + escapeHtml(selected) + ' (legacy)</label>' +
					'</div>'
				);
			}

			setSelectedServiceType(selected);
		} catch (err) {
			console.error('populateServiceTypeCheckboxes:', err);
			$serviceTypeList.html('<div class="text-danger small">Unable to load service types.</div>');
			$serviceTypeValue.val('');
		}
	}

	// Expose for other scripts (services_category, dashboard preset buttons)
	window.populateNewServiceTypeCheckboxes = function (selectedValue) {
		return populateServiceTypeCheckboxes(selectedValue || '');
	};
	window.setNewServiceTypeValue = function (value) {
		setSelectedServiceType(value || '');
	};

	$modal.on('show.bs.modal', async function () {
		resetForm();
		ensureProgramDatePicker(todayProgramDateValue());
		initGuestSelect2();
		toggleAccountByTransactionType();
		// apply dashboard preset (if any)
		const preset = window.__dashServicePresetType || '';
		window.__dashServicePresetType = null;
		await Promise.all([
			populateAccounts(),
			populateServiceTypeCheckboxes(preset)
		]);
		toggleAccountByTransactionType();
	});

	$serviceTypeList.on('change', 'input[type="radio"][name="new-services-type"]', function () {
		$serviceTypeValue.val(String(this.value || '').trim());
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
		const agentId = $selected.data('agentId') || '';
		$agentInput.val(agentId || '');
		$gameInput.val($selected.data('gameId') || '');
		await Promise.all([
			loadDepositBalance($selected.val()),
			populateGuests(agentId)
		]);
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
		const serviceType = ($serviceTypeValue.val() || '').trim();
		const amountRaw = $('#new-services-amount').val().replace(/,/g, '').trim();
		const amount = parseFloat(amountRaw) || 0;
		const remarks = $('#new-services-remarks').val().trim();
		const transactionId = $('input[name="new-services-transaction"]:checked').val();
		const sourceType = $transactionType.val();
		const guestId = ($guestSelect.val() || '').trim();
		const programDate = getProgramDateValue();

		if (!programDate) {
			Swal.fire({ icon: 'warning', title: t.missing_fields || 'Missing fields', text: t.select_program_date || 'Select a program date.' });
			return;
		}
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
					guest_id: guestId || null,
					service_type: serviceType,
					amount: amount,
					remarks: remarks,
					transaction_id: transactionId,
					source_type: sourceType,
					program_date: programDate
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
