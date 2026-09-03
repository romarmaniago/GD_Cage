$(function () {

		if (window.__editServiceRecordBound) return;
		if (!$('#modal-services-edit-record').length) return;
		window.__editServiceRecordBound = true;

		const $modal = $('#modal-services-edit-record');
		const $accountSelect = $('#edit-services-account');
		const $guestSelect = $('#edit-services-guest');
		const $accountWrapper = $('#edit-services-account-wrapper');
		const $transactionId = $('#edit-services-transaction-id');
		const $amountInput = $('#edit-services-amount');
		const $agentInput = $('#edit-services-agent-id');
		const $saveBtn = $('#edit-services-save');
		const $balanceHint = $('#edit-deposit-balance');
		const $balanceValue = $('#edit-deposit-balance-value');
		const $serviceTypeValue = $('#edit-services-type-value');
		const $serviceTypeList = $('#edit-services-type-list');
		const $programDate = $('#edit-services-program-date');
		let depositBalance = 0;
		let suppressAccountChange = false;
		// Amount of this record when the modal opened — added back when checking the
		// available balance, since the edit flow reverses the old ledger row first.
		let originalChargeAmount = 0;

		const t = window.fnbHotelTranslations || {};

		function formatSignedAmountInput(value) {
			var raw = String(value == null ? '' : value);
			var sign = '';
			if (raw.charAt(0) === '+' || raw.charAt(0) === '-') {
				sign = raw.charAt(0);
				raw = raw.slice(1);
			}
			raw = raw.replace(/[^\d.]/g, '');
			var parts = raw.split('.');
			if (parts.length > 2) {
				raw = parts[0] + '.' + parts.slice(1).join('');
				parts = raw.split('.');
			}
			var intPart = parts[0] || '';
			var decPart = parts[1];
			var formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
			var formatted = decPart !== undefined ? formattedInt + '.' + decPart : formattedInt;
			if (!formatted && !sign) return '';
			return sign + formatted;
		}

		function parseSignedAmount(value) {
			var raw = String(value == null ? '' : value).replace(/,/g, '').trim();
			if (!raw || raw === '+' || raw === '-') return NaN;
			var n = parseFloat(raw);
			return Number.isFinite(n) ? n : NaN;
		}

		function escapeHtml(value) {
			return String(value == null ? '' : value)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

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
			flatpickr(el, {
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

		function normalizeCategoryKey(category) {
			return String(category || '').trim().toLowerCase();
		}

		function setSelectedServiceType(value) {
			const raw = String(value || '').trim();
			$serviceTypeValue.val(raw);
			if (!$serviceTypeList.length) return;
			$serviceTypeList.find('input[type="radio"][name="edit-services-type"]').each(function () {
				const v = String(this.value || '').trim();
				this.checked = !!raw && v.toLowerCase() === raw.toLowerCase();
			});
		}

		async function populateServiceTypeRadios(selectedValue) {
			if (!$serviceTypeList.length) return;
			$serviceTypeList.html('<span class="edit-services-type-placeholder text-muted small">' + escapeHtml(t.select_service || 'Select service') + '</span>');

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
					const id = 'edit-services-type-' + idx;
					const isChecked = selected && key === selected.toLowerCase();
					if (isChecked) hasSelected = true;
					$serviceTypeList.append(
						'<div class="form-check form-check-inline mb-0">' +
						'<input class="form-check-input" style="border-color: #8a92a6 !important;" type="radio" name="edit-services-type" id="' + escapeHtml(id) + '" value="' + escapeHtml(category) + '"' + (isChecked ? ' checked' : '') + '>' +
						'<label class="form-check-label" for="' + escapeHtml(id) + '">' + escapeHtml(category) + '</label>' +
						'</div>'
					);
				});

				if (selected && !hasSelected) {
					const id = 'edit-services-type-legacy';
					$serviceTypeList.append(
						'<div class="form-check form-check-inline mb-0">' +
						'<input class="form-check-input" style="border-color: #8a92a6 !important;" type="radio" name="edit-services-type" id="' + escapeHtml(id) + '" value="' + escapeHtml(selected) + '" checked>' +
						'<label class="form-check-label" for="' + escapeHtml(id) + '">' + escapeHtml(selected) + ' (legacy)</label>' +
						'</div>'
					);
				}

				setSelectedServiceType(selected);
			} catch (err) {
				console.error('populateServiceTypeRadios:', err);
				$serviceTypeList.html('<div class="text-danger small">Unable to load service types.</div>');
				$serviceTypeValue.val('');
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

		function enableAccountFields() {
			$accountWrapper.show();
			$accountSelect.prop('disabled', false);
			$guestSelect.prop('disabled', !$accountSelect.val());
		}

		async function populateAccounts() {
			$accountSelect.prop('disabled', true);
			try {
				const res = await fetch('/fnb-hotel/accounts');
				if (!res.ok) throw new Error('Unable to load accounts.');
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
						.data('balance', acc.balance || 0);
					$accountSelect.append($option);
				});
				initAccountSelect2();
			} catch (err) {
				console.error(err);
				$accountSelect.empty().append('<option value="" disabled>Failed to load accounts</option>');
				initAccountSelect2();
			} finally {
				enableAccountFields();
			}
		}

		function updateBalanceHint() {
			const transaction = String($transactionId.val() || '');
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

		$serviceTypeList.on('change', 'input[type="radio"][name="edit-services-type"]', function () {
			$serviceTypeValue.val(String(this.value || '').trim());
		});

		$accountSelect.on('change', async function () {
			if (suppressAccountChange) return;
			const $selected = $(this).find('option:selected');
			const agentId = $selected.data('agentId') || '';
			$agentInput.val(agentId || '');
			await Promise.all([
				loadDepositBalance($selected.val()),
				populateGuests(agentId)
			]);
			updateBalanceHint();
		});

		$amountInput.on('input', function () {
			$(this).val(formatSignedAmountInput($(this).val()));
		});

		$modal.on('show.bs.modal', function () {
			// Population is handled by window.openEditChargeModal / applyEditChargePayload
		});

		async function applyEditChargePayload(pending) {
			pending = pending || {};
			const programDate = String(pending.programDate || '').trim().slice(0, 10) || todayProgramDateValue();
			const sourceType = String(pending.sourceType || '').trim().toUpperCase();
			const serviceType = String(pending.serviceType || '').trim();
			const agentId = pending.agentId || '';
			const guestId = pending.guestId || '';
			const remarks = pending.remarks != null ? String(pending.remarks) : '';
			const transactionId = pending.transactionId != null ? String(pending.transactionId) : '';
			const amount = pending.amount;

			originalChargeAmount = transactionId === '2'
				? Math.abs(parseFloat(String(amount == null ? '' : amount).replace(/,/g, '')) || 0)
				: 0;

			if (pending.id != null && pending.id !== '') {
				$('#edit-services-id').val(pending.id);
			}
			if (amount != null && amount !== '') {
				let num = parseFloat(String(amount).replace(/,/g, '')) || 0;
				// Sign carries the source: + = GUEST (In), - = JUNKET (Out).
				// Normalize legacy positive-JUNKET rows to a negative amount.
				if (num > 0 && sourceType === 'JUNKET') num = -num;
				$amountInput.val(formatSignedAmountInput(num === 0 ? '' : (num < 0 ? '-' : '') + Math.abs(num).toString()));
			} else {
				$amountInput.val('');
			}
			$('#edit-services-remarks').val(remarks);
			$transactionId.val(transactionId);

			ensureProgramDatePicker(programDate);
			initGuestSelect2();
			enableAccountFields();

			await Promise.all([
				populateAccounts(),
				populateServiceTypeRadios(serviceType)
			]);

			enableAccountFields();

			if (agentId) {
				suppressAccountChange = true;
				let accountFound = false;
				$accountSelect.find('option').each(function () {
					const optionAgentId = $(this).data('agentId');
					if (optionAgentId != null && String(optionAgentId) === String(agentId)) {
						$accountSelect.val(String($(this).val())).trigger('change');
						$agentInput.val(optionAgentId);
						accountFound = true;
						return false;
					}
				});
				suppressAccountChange = false;
				if (accountFound) {
					const accountId = $accountSelect.val();
					await Promise.all([
						loadDepositBalance(accountId),
						populateGuests(agentId, guestId)
					]);
					$accountSelect.prop('disabled', false);
					$guestSelect.prop('disabled', false);
					updateBalanceHint();
				} else {
					resetGuestSelect();
				}
			} else {
				resetGuestSelect();
			}

			updateBalanceHint();
		}

		window.openEditChargeModal = async function (pending) {
			try {
				await applyEditChargePayload(pending || {});
			} catch (err) {
				console.error('openEditChargeModal:', err);
			}
			if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
				const el = $modal[0];
				const instance = bootstrap.Modal.getOrCreateInstance(el);
				instance.show();
			} else {
				$modal.modal('show');
			}
		};

		$saveBtn.on('click', async function () {
			const serviceId = $('#edit-services-id').val();
			const accountId = $accountSelect.val();
			const agentId = $agentInput.val();
			const serviceType = ($serviceTypeValue.val() || '').trim();
			const amount = parseSignedAmount($amountInput.val());
			const remarks = $('#edit-services-remarks').val().trim();
			const transactionId = String($transactionId.val() || '').trim();
			// + amount = addition (GUEST / In), - amount = bawas (JUNKET / Out)
			const sourceType = amount < 0 ? 'JUNKET' : 'GUEST';
			const guestId = ($guestSelect.val() || '').trim();
			const programDate = getProgramDateValue();

			if (!serviceId) {
				Swal.fire({ icon: 'error', title: t.error || 'Error', text: t.service_id_missing || 'Service ID is missing.' });
				return;
			}
			if (!programDate) {
				Swal.fire({ icon: 'warning', title: t.missing_fields || 'Missing fields', text: t.select_program_date || 'Select a program date.' });
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
				Swal.fire({ icon: 'error', title: t.error || 'Error', text: t.service_id_missing || 'Payment method is missing on this record.' });
				return;
			}
			if (!Number.isFinite(amount) || amount === 0) {
				Swal.fire({ icon: 'warning', title: t.invalid_amount || 'Invalid amount', text: t.amount_must_be_greater || 'Enter an amount with + (addition) or - (bawas).' });
				return;
			}

			// Hard check: a GUEST deposit charge must fit the available balance.
			// The record's own old charge is added back — it is reversed on update.
			if (transactionId === '2' && sourceType === 'GUEST') {
				await loadDepositBalance(accountId);
				const available = depositBalance + originalChargeAmount;
				if (Math.abs(amount) > available + 0.009) {
					Swal.fire({
						icon: 'warning',
						title: t.insufficient_balance || 'Insufficient balance',
						text: (t.amount_exceeds_balance || 'Amount exceeds the available balance.') +
							' (' + available.toLocaleString('en-US') + ')'
					});
					return;
				}
			}

			$saveBtn.prop('disabled', true).text(t.updating || 'Updating...');

			try {
				const response = await fetch('/fnb-hotel/service/' + serviceId, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						account_id: accountId,
						agent_id: agentId,
						guest_id: guestId || null,
						service_type: serviceType,
						amount: amount,
						remarks: remarks,
						source_type: sourceType,
						program_date: programDate
					})
				});

				if (!response.ok) {
					const error = await response.json().catch(function () { return {}; });
					throw new Error(error.error || (t.failed_to_update || 'Failed to update service record.'));
				}

				await Swal.fire({
					icon: 'success',
					title: t.service_updated || 'Service updated',
					timer: 1200,
					showConfirmButton: false
				});

				$modal.modal('hide');
				if (window.reloadFnbHotelData) {
					window.reloadFnbHotelData();
				}
			} catch (err) {
				Swal.fire({ icon: 'error', title: t.error || 'Error', text: err.message || (t.failed_to_update || 'Failed to update record.') });
			} finally {
				$saveBtn.prop('disabled', false).text(t.update || 'Update');
			}
		});
	
});
