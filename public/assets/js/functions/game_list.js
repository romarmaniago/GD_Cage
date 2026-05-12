var account_id;
var record_id;
var game_id;
var _servicesSettled = 0;
// Cache accounts so Select2 doesn't flash "No results found" while AJAX is still loading
var _accountOptionsCache = null;
var _accountOptionsPromise = null;
	
function resetNewGameSubmitButton() {
	var $btn = $('#submit-game-list-btn');
	if (!$btn.length) return;
	var label = $btn.data('label') || 'Save';
	$btn.prop('disabled', false).text(label);
}

function resetNewGameInputs() {
	var form = document.getElementById('add_game_list');
	if (form) form.reset();

	$('#txtNN, #txtCC, #txtRollerNN, #txtRollerCC').val('');
	$('#splitCashNN, #splitCashCC, #splitDepNN, #splitDepCC, #splitCreditNN, #splitCreditCC').val('').removeClass('is-invalid');
	$('#enableSplitNewGame').prop('checked', false);
	$('#split-new-game-row').hide();
	$('#txtNN, #txtCC').closest('.row').show();
	$('#modal-new-game-list input[name="txtTransType"]').prop('disabled', false).prop('checked', false);
	$('#txtGuestId').val('');
	ensureNewGameEncodedDatePicker();
}

/** Flatpickr on New Game modal: default today, editable (maps to game_list.ENCODED_DT date part). */
function ensureNewGameEncodedDatePicker() {
	var el = document.getElementById('txtGameEncodedDate');
	if (!el || typeof flatpickr === 'undefined') return;
	if (el._flatpickr) {
		el._flatpickr.setDate(new Date(), false);
	} else {
		flatpickr(el, {
			dateFormat: 'Y-m-d',
			altInput: true,
			altFormat: 'F j, Y',
			defaultDate: new Date(),
			allowInput: true,
			disableMobile: true,
			onReady: function (_selectedDates, _dateStr, instance) {
				if (instance && instance.calendarContainer) {
					instance.calendarContainer.classList.add('new-game-date-calendar');
				}
			},
			onOpen: function (_selectedDates, _dateStr, instance) {
				if (instance && instance.calendarContainer) {
					instance.calendarContainer.classList.add('new-game-date-calendar');
				}
			}
		});
	}
}

function syncSelectedGuestIdFromAccount() {
	var $select = $('#txtTrans');
	if (!$select.length) return;
	var guestId = $select.find('option:selected').attr('data-guest-id') || '';
	$('#txtGuestId').val(guestId);
}

function syncSelectedGuestIdFromGuestDropdown() {
	var guestId = $('#txtGuestGame').val() || '';
	$('#txtGuestId').val(guestId);
}

function loadGuestsForSelectedAccount() {
	var $accountSelect = $('#txtTrans');
	var $guestSelect = $('#txtGuestGame');
	if (!$accountSelect.length || !$guestSelect.length) return;

	var selectedAccountId = $accountSelect.val();
	var agentId = $accountSelect.find('option:selected').attr('data-agent-id') || '';

	if ($guestSelect.data('select2')) {
		$guestSelect.select2('destroy');
	}

	$guestSelect.empty().append($('<option>', { value: '', text: '--SELECT GUEST--' }));
	$guestSelect.select2({
		placeholder: 'Select guest (optional)',
		dropdownParent: '#modal-new-game-list'
	});
	$guestSelect.val('').trigger('change');
	$guestSelect.prop('disabled', !selectedAccountId);

	if (!selectedAccountId || !agentId) {
		syncSelectedGuestIdFromGuestDropdown();
		return;
	}

	$.ajax({
		url: '/guest_data?agentId=' + encodeURIComponent(agentId),
		method: 'GET',
		success: function (rows) {
			var guests = Array.isArray(rows) ? rows : [];
			guests.forEach(function (guest) {
				$guestSelect.append($('<option>', {
					value: guest.guest_id,
					text: (guest.guest_name || '').toUpperCase()
				}));
			});
			$guestSelect.trigger('change.select2');
			$guestSelect.prop('disabled', false);
		},
		error: function () {
			$guestSelect.prop('disabled', true);
			syncSelectedGuestIdFromGuestDropdown();
		}
	});
}


function addGameList(id) {
	var $select = $('#txtTrans');
	var $guest = $('#txtGuestGame');
	resetNewGameInputs();
	resetNewGameSubmitButton();
	$('#txtTrans').prop('disabled', false);
	$('#txtGuestGame').prop('disabled', true);
	$select.removeAttr('data-readonly');
	$guest.removeAttr('data-readonly');
	$select.removeAttr('data-locked-value');
	$guest.removeAttr('data-locked-value');
	
	// Helper to populate select options and refresh Select2
	function populateOptions() {
		if (!$select.length) return;
		
		// Destroy Select2 first to ensure clean state
		if ($select.data('select2')) {
			$select.select2('destroy');
		}
		
		// Populate options
		$select.empty();
		$select.append($('<option>', { value: '', text: '--SELECT ACCOUNT--' }));
		
		if (Array.isArray(_accountOptionsCache) && _accountOptionsCache.length > 0) {
			_accountOptionsCache.forEach(function (option) {
				var $opt = $('<option>', {
					value: option.account_id,
					text: option.agent_name + ' (' + option.agent_code + ')'
				});
				var guestId = option.guest_id || option.GUESTNo || '';
				$opt.attr('data-guest-id', guestId);
				$opt.attr('data-agent-id', option.agent_id || '');
				$select.append($opt);
			});
		}
		
		// Reinitialize Select2 with fresh options
		$select.select2({
			placeholder: 'Select an option',
			dropdownParent: '#modal-new-game-list',
		});
		syncSelectedGuestIdFromAccount();
		loadGuestsForSelectedAccount();
	}
	
	// Show modal IMMEDIATELY for smooth UX (don't wait for data)
	$('#modal-new-game-list').modal('show');
	$('#txtGuestId').val('');
	$('#enableSplitNewGame').prop('checked', false);
	$('#split-new-game-row').hide();
	$('#splitCashNN, #splitCashCC, #splitDepNN, #splitDepCC, #splitCreditNN, #splitCreditCC').val('').removeClass('is-invalid');
	$('#modal-new-game-list input[name="txtTransType"]').prop('disabled', false).prop('checked', false);
	$('#modal-new-game-list input[name="txtTransType"]').first().closest('.row.mb-2').show();
	$('#txtNN, #txtCC').closest('.row').show();
	
	// Populate dropdown based on data availability
	if (Array.isArray(_accountOptionsCache)) {
		// Data is ready - populate immediately
		populateOptions();
	} else if (_accountOptionsPromise) {
		// Data is loading - populate when ready
		_accountOptionsPromise.then(function() {
			populateOptions();
		}).catch(function() {
			populateOptions(); // Show empty if error
		});
	} else {
		// No data yet - fetch and populate when ready
		preloadAccounts().then(function() {
			populateOptions();
		}).catch(function() {
			populateOptions();
		});
	}
	ensureNewGameEncodedDatePicker();
}

function getQueryParam(param) {
	const urlParams = new URLSearchParams(window.location.search);
	return urlParams.get(param);
}

// Function to translate game source
function translateGameSource(source) {
	const translations = window.gamelistTranslations || {};
	if (!source) return '';
	const sourceUpper = source.toUpperCase();
	if (sourceUpper === 'CASH') return translations.cash || 'CASH';
	if (sourceUpper === 'DEPOSIT') return translations.deposit || 'DEPOSIT';
	if (sourceUpper === 'MARKER') return translations.marker || 'MARKER';
	if (sourceUpper === 'IOU') return translations.credit || 'Credit';
	return source;
}

function buildGameRateCell(row, userPermissions, isSettled) {
	var pct = Number(row.COMMISSION_PERCENTAGE);
	if (isNaN(pct)) pct = 0;
	var isEditableActive = [1, 2, 3].includes(parseInt(row.game_status, 10));
	var canEditType = (userPermissions === 0) && isEditableActive;
	var badgeClass = 'commission-badge-r';
	var badgeTitle = 'Rolling Game';
	var badgeText = 'R';
	if (row.COMMISSION_TYPE == 2) {
		badgeClass = 'commission-badge-s';
		badgeTitle = 'Shared Game';
		badgeText = 'S';
	} else if (row.COMMISSION_TYPE == 3) {
		badgeClass = 'commission-badge-l';
		badgeTitle = 'Loosing Game';
		badgeText = 'L';
	}
	var badgePart;
	if (canEditType) {
		badgePart = '<button type="button" class="btn btn-link p-0" style="line-height:1;" onclick="editGameCommissionType(' + row.game_list_id + ', ' + row.COMMISSION_TYPE + ', ' + pct + ', ' + (isSettled ? 1 : 0) + ')" title="Edit commission type"><span class="badge commission-badge ' + badgeClass + '" title="' + badgeTitle + '">' + badgeText + '</span></button>';
	} else {
		badgePart = '<span class="badge commission-badge ' + badgeClass + '" title="' + badgeTitle + '">' + badgeText + '</span>';
	}
	return pct + '% ' + badgePart;
}

function getCommissionRateRules(typeVal) {
	var t = parseInt(typeVal, 10);
	if (t === 2) return { min: 50, max: 100, step: 0.1 };
	return { min: 0, max: 100, step: 0.05 };
}

function editGameCommissionType(gameId, currentType, currentPct, settledFlag) {
	var userPermissions = parseInt(document.getElementById('user-role')?.getAttribute('data-permissions') || '99', 10);
	var canEdit = (userPermissions === 0);
	if (!canEdit) {
		Swal.fire({ icon: 'warning', title: 'Not allowed', text: 'You cannot edit this commission type.' });
		return;
	}
	var $modal = $('#modal-edit-commission-type');
	var currentTypeNum = parseInt(currentType, 10);
	var targetType = currentTypeNum === 1 ? 2 : 1; // Toggle only: Rolling <-> Shared
	var targetTypeLabel = targetType === 2 ? 'Shared Game' : 'Rolling Game';
	$('#edit-commission-game-id').val(gameId);
	$('#edit-commission-type').val(String(targetType));
	$('#edit-commission-type-display').val(targetTypeLabel);
	var defaultRate = targetType === 1 ? 1.50 : (Number(currentPct) || 0);
	$('#edit-commission-rate').val(defaultRate.toString());
	$('#edit-commission-save-btn').prop('disabled', false).text('Update');
	$('#edit-commission-rate').removeClass('is-invalid');

	var rules = getCommissionRateRules(targetType);
	var $rate = $('#edit-commission-rate');
	$rate.attr('min', String(rules.min));
	$rate.attr('max', String(rules.max));
	$rate.attr('step', String(rules.step));
	var cur = parseFloat($rate.val());
	if (isNaN(cur) || cur < rules.min) $rate.val(String(rules.min));
	if (cur > rules.max) $rate.val(String(rules.max));
	$modal.modal('show');
}
window.editGameCommissionType = editGameCommissionType;

$(document).on('submit', '#form-edit-commission-type', function (e) {
	e.preventDefault();
	var gameId = parseInt($('#edit-commission-game-id').val(), 10);
	var typeVal = parseInt($('#edit-commission-type').val(), 10);
	var rateVal = parseFloat($('#edit-commission-rate').val());
	if (!gameId || ![1, 2].includes(typeVal)) {
		Swal.fire({ icon: 'error', title: 'Error', text: 'Invalid commission data.' });
		return;
	}
	var rules = getCommissionRateRules(typeVal);
	if (isNaN(rateVal) || rateVal < rules.min || rateVal > rules.max) {
		$('#edit-commission-rate').addClass('is-invalid');
		Swal.fire({ icon: 'warning', title: 'Invalid rate', text: 'Rate must be between ' + rules.min + '% and ' + rules.max + '%.' });
		return;
	}
	$('#edit-commission-rate').removeClass('is-invalid');
	var typeLabel = typeVal === 2 ? 'Shared Game' : 'Rolling Game';
	Swal.fire({
		icon: 'question',
		title: 'Confirm update',
		html: '<div class="text-center">' +
			'<div><strong>Type:</strong> ' + typeLabel + '</div>' +
			'<div><strong>Rate:</strong> ' + rateVal + '%</div>' +
			'</div>',
		showCancelButton: true,
		confirmButtonText: 'Yes, update',
		cancelButtonText: 'Cancel'
	}).then(function (result) {
		if (!result.isConfirmed) return;
		var $btn = $('#edit-commission-save-btn');
		$btn.prop('disabled', true).text('Saving...');
		$.ajax({
			url: '/game_list/' + gameId + '/commission_type',
			method: 'PUT',
			contentType: 'application/json',
			data: JSON.stringify({ commission_type: typeVal, commission_percentage: rateVal }),
			success: function () {
				$('#modal-edit-commission-type').modal('hide');
				Swal.fire({ icon: 'success', title: 'Saved', timer: 1200, showConfirmButton: false });
				if (typeof window.reloadData === 'function') window.reloadData();
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) ? xhr.responseJSON.error : 'Failed to save';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			},
			complete: function () {
				$btn.prop('disabled', false).text('Update');
			}
		});
	});
});

$(document).ready(function () {

	window.isMergeSettleMode = false;
	window.isDailySettleSelectionMode = false;
	window.isOpenPoolSelectionMode = false;
	window.dailySettleTargetDate = null;
	window.dailySettleArmedDate = null;
	window.selectedSettlementSubView = 'open';
	window.draftDatesForMonth = [];

	function getClientTodayYmd() {
		var now = new Date();
		return (
			now.getFullYear() +
			'-' +
			String(now.getMonth() + 1).padStart(2, '0') +
			'-' +
			String(now.getDate()).padStart(2, '0')
		);
	}
	function hasSettlementForDate(dateStr) {
		var dates = window.settledDatesForMonth || [];
		return !!dateStr && dates.indexOf(dateStr) !== -1;
	}
	function isCurrentDate(dateStr) {
		return !!dateStr && dateStr === getClientTodayYmd();
	}

	function buildMergeSettleCheckbox(gameListId, accountId) {
		return '<label class="merge-settle-checkbox-wrap" title="Select game ' + gameListId + '"><input type="checkbox" class="merge-settle-checkbox" value="' + gameListId + '" data-account-id="' + (accountId || '') + '" /></label>';
	}
	function buildDailySettleCheckbox(gameListId) {
		return '<label class="daily-settle-checkbox-wrap" title="Select game ' + gameListId + '"><input type="checkbox" class="daily-settle-checkbox" value="' + gameListId + '" /></label>';
	}
	function buildOpenPoolCheckbox(gameListId) {
		return '<label class="open-pool-checkbox-wrap" title="Select game ' + gameListId + '"><input type="checkbox" class="open-pool-checkbox" value="' + gameListId + '" /></label>';
	}
	function buildGameStartCell(gameStartText, gameListId, accountId, showMergeCheckbox, showDailySettleCheckbox, showOpenPoolCheckbox) {
		var mergeCheckboxHtml = showMergeCheckbox ? buildMergeSettleCheckbox(gameListId, accountId) : '';
		var dailySettleCheckboxHtml = showDailySettleCheckbox ? buildDailySettleCheckbox(gameListId) : '';
		var openPoolCheckboxHtml = showOpenPoolCheckbox ? buildOpenPoolCheckbox(gameListId) : '';
		return '<div class="d-inline-flex align-items-center gap-1">' + mergeCheckboxHtml + dailySettleCheckboxHtml + openPoolCheckboxHtml + '<span>' + gameStartText + '</span></div>';
	}

	function syncGameListSelectAllCheckboxState() {
		var $master = $('#game-list-select-all');
		if (!$master.length) return;
		var $cbs = $();
		if ($('body').hasClass('open-pool-select-mode')) {
			$cbs = $('#game_list-tbl tbody .open-pool-checkbox');
		} else if ($('body').hasClass('daily-settle-select-mode')) {
			$cbs = $('#game_list-tbl tbody .daily-settle-checkbox');
		} else if ($('body').hasClass('merge-settle-mode')) {
			$cbs = $('#game_list-tbl tbody .merge-settle-checkbox');
		}
		if (!$cbs.length) {
			$master.prop('checked', false).prop('indeterminate', false);
			return;
		}
		var n = $cbs.length;
		var c = $cbs.filter(':checked').length;
		$master.prop('checked', c === n && n > 0);
		$master.prop('indeterminate', c > 0 && c < n);
	}

	function updateMergeSettleButtonState() {
		var $btn = $('#btn-merge-settle-game-list');
		if (!$btn.length) return;
		if (window.isMergeSettleMode) {
			$btn.removeClass('btn-primary').addClass('btn-warning merge-settle-active');
			$('body').addClass('merge-settle-mode');
		} else {
			$btn.removeClass('btn-warning merge-settle-active').addClass('btn-primary');
			$('body').removeClass('merge-settle-mode');
			$('.merge-settle-checkbox').prop('checked', false);
		}
		syncGameListSelectAllCheckboxState();
	}

	function setOpenPoolSelectionMode(enabled) {
		window.isOpenPoolSelectionMode = !!enabled;
		var $a = $('#btn-breadcrumb-open-pool');
		if (window.isOpenPoolSelectionMode) {
			if (window.isDailySettleSelectionMode) setDailySettleSelectionMode(false);
			if (window.isMergeSettleMode) {
				window.isMergeSettleMode = false;
				updateMergeSettleButtonState();
			}
			$('body').addClass('open-pool-select-mode');
			if ($a.length) $a.addClass('breadcrumb-crumb-armed');
		} else {
			$('body').removeClass('open-pool-select-mode');
			if ($a.length) $a.removeClass('breadcrumb-crumb-armed');
			$('.open-pool-checkbox').prop('checked', false);
			var $masterOpen = $('#game-list-select-all');
			if ($masterOpen.length) $masterOpen.prop('checked', false).prop('indeterminate', false);
		}
		syncGameListSelectAllCheckboxState();
	}

	function setDailySettleSelectionMode(enabled) {
		if (enabled && window.isOpenPoolSelectionMode) setOpenPoolSelectionMode(false);
		window.isDailySettleSelectionMode = !!enabled;
		var $settleCrumb = $('#btn-daily-settle');
		if (window.isDailySettleSelectionMode) {
			$('body').addClass('daily-settle-select-mode');
			if ($settleCrumb.length) $settleCrumb.addClass('breadcrumb-crumb-armed');
		} else {
			$('body').removeClass('daily-settle-select-mode');
			if ($settleCrumb.length) $settleCrumb.removeClass('breadcrumb-crumb-armed');
			$('.daily-settle-checkbox').prop('checked', false);
			window.dailySettleArmedDate = null;
			var $master = $('#game-list-select-all');
			if ($master.length) $master.prop('checked', false).prop('indeterminate', false);
		}
	}

	function getSelectedMergeSettleIds() {
		var ids = [];
		$('.merge-settle-checkbox:checked').each(function () {
			var v = parseInt($(this).val(), 10);
			if (!isNaN(v)) ids.push(v);
		});
		return ids;
	}

	function getSelectedMergeAccountIds() {
		var accountIds = [];
		$('.merge-settle-checkbox:checked').each(function () {
			var raw = $(this).data('account-id');
			var id = parseInt(raw, 10);
			if (!isNaN(id) && accountIds.indexOf(id) === -1) accountIds.push(id);
		});
		return accountIds;
	}

	function parseMergeNumeric(text) {
		var cleaned = String(text || '')
			.replace(/<[^>]*>/g, '')
			.replace(/,/g, '')
			.replace(/[^\d.\-]/g, '')
			.trim();
		if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
		var n = parseFloat(cleaned);
		return isNaN(n) ? 0 : n;
	}

	function formatMergeNumeric(value) {
		return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	}

	function toTitleCase(text) {
		return String(text || '')
			.toLowerCase()
			.replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
	}

	function fetchMergeServicesTotal(selectedIds) {
		if (!Array.isArray(selectedIds) || selectedIds.length === 0) return Promise.resolve(0);
		var requests = selectedIds.map(function (gameId) {
			return $.ajax({
				url: '/game_services/' + gameId,
				method: 'GET'
			}).then(function (rows) {
				if (!Array.isArray(rows)) return 0;
				return rows.reduce(function (sum, item) {
					var amt = parseFloat(item.AMOUNT || item.amount || 0);
					return sum + (isNaN(amt) ? 0 : amt);
				}, 0);
			}).catch(function () {
				return 0;
			});
		});
		return Promise.all(requests).then(function (totals) {
			return totals.reduce(function (sum, n) { return sum + (parseFloat(n) || 0); }, 0);
		});
	}

	function openMergeSettlementModal(selectedIds) {
		var $modal = $('#modal-merge-settlement');
		if (!$modal.length) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'error', title: 'Modal not found', text: 'Merge settlement modal is not loaded.' });
			}
			return;
		}

		var now = moment();
		var selectedAccountDisplays = [];
		var totalBuyIn = 0;
		var totalChipsReturn = 0;
		var totalRolling = 0;
		var totalSettlement = 0;
		var totalWinLoss = 0;
		var selectedRates = [];
		$('.merge-settle-checkbox:checked').each(function () {
			var $row = $(this).closest('tr');
			var accText = $.trim($row.find('td').eq(3).text());
			var normalizedAccText = accText.replace(/\s+/g, ' ').trim();
			var parsed = normalizedAccText.match(/^(.+?)\s*\((.+)\)$/);
			if (parsed) {
				var codePart = $.trim(parsed[1]);
				var namePart = toTitleCase($.trim(parsed[2]));
				normalizedAccText = codePart + ' - ' + namePart;
			}
			if (normalizedAccText && selectedAccountDisplays.indexOf(normalizedAccText) === -1) {
				selectedAccountDisplays.push(normalizedAccText);
			}

			totalBuyIn += parseMergeNumeric($row.find('td').eq(5).text());
			totalChipsReturn += parseMergeNumeric($row.find('td').eq(6).text());
			totalRolling += parseMergeNumeric($row.find('td').eq(9).text());
			totalSettlement += parseMergeNumeric($row.find('td').eq(13).text());
			totalWinLoss += parseMergeNumeric($row.find('td').eq(7).text());

			var rateText = $.trim($row.find('td').eq(10).text())
				.replace(/\bR\b/g, '')
				.replace(/%/g, '')
				.replace(/\s+/g, ' ')
				.trim();
			if (rateText && selectedRates.indexOf(rateText) === -1) {
				selectedRates.push(rateText);
			}
		});

		var nameText = '-';
		if (selectedAccountDisplays.length === 1) nameText = selectedAccountDisplays[0];
		else if (selectedAccountDisplays.length > 1) nameText = selectedAccountDisplays.join(', ');
		var gameNumberText = selectedIds.join(', ');
		var rateTextValue = selectedRates.length === 1 ? selectedRates[0] : (selectedRates.length > 1 ? 'Mixed' : '0');
		fetchMergeServicesTotal(selectedIds).then(function (servicesTotal) {
			var serviceAmount = servicesTotal;
			var paymentAmount = totalSettlement - serviceAmount;

			$modal.find('#mergeGameIds').val(selectedIds.join(','));
			$modal.find('#accNoMerge').text(nameText);
			$modal.find('#gameNoMerge').text(gameNumberText);
			$modal.find('#dateMerge').text(now.format('MMMM DD, YYYY'));
			$modal.find('#timeMerge').text(now.format('HH:mm'));

			$modal.find('#buyInMerge').val(formatMergeNumeric(totalBuyIn));
			$modal.find('#chipsReturnMerge').val(formatMergeNumeric(totalChipsReturn));
			$modal.find('#winLossMerge').val(formatMergeNumeric(totalWinLoss));
			$modal.find('#rollingMerge').val(formatMergeNumeric(totalRolling));
			$modal.find('#rollingRateMerge').val(rateTextValue);
			$modal.find('#rollingSettlementMerge').val(formatMergeNumeric(totalSettlement));
			$modal.find('#fbMerge').val(formatMergeNumeric(serviceAmount));
			$modal.find('#paymentMerge').val(formatMergeNumeric(paymentAmount));

			$modal.modal('show');
		});
	}

	$(document).on('click', '#btn-merge-settle-game-list', function (e) {
		e.preventDefault();
		var selectedIds = getSelectedMergeSettleIds();
		if (window.isMergeSettleMode && selectedIds.length > 0) {
			openMergeSettlementModal(selectedIds);
			return;
		}
		window.isMergeSettleMode = !window.isMergeSettleMode;
		if (window.isMergeSettleMode && window.isDailySettleSelectionMode) setDailySettleSelectionMode(false);
		if (window.isMergeSettleMode && window.isOpenPoolSelectionMode) setOpenPoolSelectionMode(false);
		updateMergeSettleButtonState();
	});

	$(document).on('change', '#game-list-select-all', function () {
		var checked = $(this).prop('checked');
		if ($('body').hasClass('open-pool-select-mode')) {
			$('#game_list-tbl tbody .open-pool-checkbox').prop('checked', checked);
		} else if ($('body').hasClass('daily-settle-select-mode')) {
			$('#game_list-tbl tbody .daily-settle-checkbox').prop('checked', checked);
		} else if ($('body').hasClass('merge-settle-mode')) {
			$('#game_list-tbl tbody .merge-settle-checkbox').prop('checked', checked);
		}
		syncGameListSelectAllCheckboxState();
	});

	$(document).on(
		'change',
		'#game_list-tbl tbody .open-pool-checkbox, #game_list-tbl tbody .daily-settle-checkbox, #game_list-tbl tbody .merge-settle-checkbox',
		function () {
			syncGameListSelectAllCheckboxState();
		}
	);

	$(document).on('click', '#send-merge-settlement-telegram-btn', function (e) {
		e.preventDefault();
		var selectedIds = getSelectedMergeSettleIds();
		var accountIds = getSelectedMergeAccountIds();
		if (selectedIds.length === 0 || accountIds.length === 0) {
			Swal.fire({ icon: 'warning', title: 'No selected games', text: 'Please select settled games first.' });
			return;
		}

		var $modal = $('#modal-merge-settlement');
		var payload = {
			account_ids: accountIds,
			account_display: ($modal.find('#accNoMerge').text() || '').trim(),
			game_numbers: ($modal.find('#gameNoMerge').text() || '').trim(),
			date: ($modal.find('#dateMerge').text() || '').trim(),
			time: ($modal.find('#timeMerge').text() || '').trim(),
			buy_in: ($modal.find('#buyInMerge').val() || '').trim(),
			chips_return: ($modal.find('#chipsReturnMerge').val() || '').trim(),
			win_loss: ($modal.find('#winLossMerge').val() || '').trim(),
			rolling: ($modal.find('#rollingMerge').val() || '').trim(),
			rate: ($modal.find('#rollingRateMerge').val() || '').trim(),
			settlement: ($modal.find('#rollingSettlementMerge').val() || '').trim(),
			services: ($modal.find('#fbMerge').val() || '').trim(),
			payment: ($modal.find('#paymentMerge').val() || '').trim()
		};

		var $btn = $('#send-merge-settlement-telegram-btn');
		$btn.prop('disabled', true).text('Sending...');
		$.ajax({
			url: '/merge_settlement_telegram',
			method: 'POST',
			data: payload,
			success: function (response) {
				Swal.fire({
					icon: 'success',
					title: 'Telegram sent',
					text: response && response.message ? response.message : 'Sent successfully.'
				});
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) ? xhr.responseJSON.error : 'Failed to send telegram.';
				Swal.fire({ icon: 'error', title: 'Send failed', text: msg });
			},
			complete: function () {
				$btn.prop('disabled', false).text('Sent Telegram');
			}
		});
	});

	// Custom sort for GAME # column: works for both game view (INF500) and account view ("2 games")
	$.fn.dataTable.ext.type.order['game-list-col2-pre'] = function (d) {
		if (!d) return 0;
		var text = (typeof d === 'string' ? d : String(d)).replace(/<[^>]*>/g, '');
		var m = text.match(/(\d+)/);
		return m ? parseInt(m[1], 10) : 0;
	};

	const highlightId = getQueryParam('id');

    if ($.fn.DataTable.isDataTable('#game_list-tbl')) {
        $('#game_list-tbl').DataTable().destroy();
    }

	var dataTable = $('#game_list-tbl').DataTable({
		responsive: false,
		paging: true,
		lengthChange: true,
		searching: true,
		ordering: true,
		info: true,
		autoWidth: false,
		order: [[2, 'desc']],  // GAME # column: latest game ID first
		// Default and minimum page length set to 100 (no 10/25/etc. options)
		pageLength: 100,
		lengthMenu: [
			[100, 50, 25, 10, -1],
			[100, 50, 25, 10, 'All']
		],
	
		columnDefs: [
			{ targets: 2, type: 'game-list-col2', className: 'text-center' },       // GAME # / game count: custom numeric sort
			{ targets: 5, className: 'text-center col-buyin' },          // BUY-IN (Blue)
			{ targets: 9, className: 'text-center col-total-rolling' }, // TOTAL ROLLING (Green)
			{ targets: 7, className: 'text-center col-winloss' },       // WIN/LOSS (Orange) after CASH-OUT
			{ targets: 10, className: 'text-center col-game-rate' },
			{ targets: 11, className: 'text-center col-commission' },
			{ targets: '_all', className: 'text-center' }               // center all columns
		],
		

		
	
		language: {
			search: (window.gamelistTranslations?.search || "Search:"),
			info: (window.gamelistTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
			paginate: {
				previous: (window.gamelistTranslations?.previous || "Previous"),
				next: (window.gamelistTranslations?.next || "Next")
			}
		},
	
		createdRow: function (row, data, index) {
			// 🔴 Color red if WIN/LOSS is negative
			if (parseInt(data[7].split(',').join('')) < 0) {
				$('td:eq(7)', row).css({
					'background-color': '#fff',
					'color': 'red'
				});
			}

			// ✅ HIGHLIGHTING logic
			// Step 1: Remove HTML from Game # column to extract pure ID
			const gameListIdText = $('<div>').html(data[2]).text(); // assuming column 2 is GAME #
			const gameListId = parseInt(gameListIdText);

			// Step 2: Compare with highlightId from URL
			const isHighlighted = highlightId && gameListId === parseInt(highlightId);

			if (isHighlighted) {
				console.log("✅ Highlighting row:", gameListId);
				$(row).addClass('highlight-row');
			}
		},

		initComplete: function () {
			var filterDiv = $('#game_list-tbl').closest('.dataTables_wrapper').find('.dataTables_filter');
			if (filterDiv.length) {
				var accountSearchHtml = '<label class="me-3 mb-0 d-inline-flex align-items-center gap-2">' +
					'<span>Account Search:</span>' +
					'<input type="text" id="input-account-search" class="form-control form-control-sm" placeholder="e.g. xxx or xxx-xxx" />' +
					'</label>';
				filterDiv.prepend(accountSearchHtml);
			}
			function stopSortBubble(e) {
				e.stopPropagation();
			}
			$('#game-list-select-all, .game-list-select-all-slot')
				.off('click.dtSelectAllSort mousedown.dtSelectAllSort pointerdown.dtSelectAllSort')
				.on('click.dtSelectAllSort mousedown.dtSelectAllSort pointerdown.dtSelectAllSort', stopSortBubble);
		},

		drawCallback: function () {
			var hasAccountSearch = ($('#input-account-search').val() || '').trim().length > 0;
			$('#game_list-tbl').toggleClass('account-search-only', !!hasAccountSearch);
			syncGameListSelectAllCheckboxState();
		}
	});

	function getGameListExportFilename() {
		var mode = $('input[name="filter-mode"]:checked').val() || 'settlement';
		if (mode === 'settlement') {
			var d = (window.selectedSettlementDate || ($('#settlement-date-picker').val() || '').trim() || 'export');
			return 'Gamebook-' + d + '.xlsx';
		}
		var dr = document.getElementById('daterange-picker');
		if (dr && dr._flatpickr && dr._flatpickr.selectedDates && dr._flatpickr.selectedDates.length === 2) {
			var pad = function (n) { return String(n).padStart(2, '0'); };
			var fmt = function (dt) {
				return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
			};
			return 'Gamebook_' + fmt(dr._flatpickr.selectedDates[0]) + '_to_' + fmt(dr._flatpickr.selectedDates[1]) + '.xlsx';
		}
		return 'Gamebook-export.xlsx';
	}

	function escapeGameListPrintHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function getGameListTablePayload(includeFooter) {
		if (!$.fn.DataTable.isDataTable('#game_list-tbl')) {
			return { headers: [], rows: [], dataRowCount: 0 };
		}
		var dt = $('#game_list-tbl').DataTable();
		var headers = [];
		// Omit last two columns: ROLLER CHIPS, ACTION
		$('#game_list-tbl thead tr:first th').slice(0, -2).each(function () {
			headers.push($(this).text().trim());
		});
		var rows = [];
		dt.rows({ search: 'applied', order: 'applied' }).every(function () {
			var cells = [];
			$(this.node()).find('td').slice(0, -2).each(function () {
				cells.push($(this).text().trim());
			});
			if (cells.length) rows.push(cells);
		});
		var dataRowCount = rows.length;
		if (includeFooter && dataRowCount > 0) {
			rows.push([
				$('#game_list-tbl tfoot th:first').text().trim(),
				'',
				'',
				'',
				'',
				$('#GRAND_TOTAL_AMOUNT').text().trim(),
				$('#GRAND_CHIPS_RETURN').text().trim(),
				$('#GRAND_WIN_LOSS').text().trim(),
				$('#GRAND_REAL_ROLLING').text().trim(),
				$('#GRAND_TOTAL_ROLLING').text().trim(),
				'',
				$('#GRAND_COMMISSION').text().trim(),
				$('#GRAND_ADD_CHG').text().trim(),
				$('#GRAND_TOTAL_SETTLE').text().trim(),
				''
			]);
		}
		return { headers: headers, rows: rows, dataRowCount: dataRowCount };
	}

	function getGameListPrintStyles() {
		return [
			'@page{size:landscape;margin:6mm;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'.print-wrap{width:100%;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 10px;font-size:12px;color:#444;}',
			'table{width:100%;border-collapse:collapse;font-size:8px;}',
			'th,td{border:1px solid #777;padding:4px 5px;vertical-align:middle;text-align:center;}',
			'th{background:#d9e1f2;font-weight:700;}',
			'th:nth-child(2),th:nth-child(4),th:nth-child(5),td:nth-child(2),td:nth-child(4),td:nth-child(5){text-align:left;padding-left:10px;}',
			'th:nth-child(6),th:nth-child(7),th:nth-child(8),th:nth-child(9),th:nth-child(10),th:nth-child(11),th:nth-child(12),th:nth-child(13),th:nth-child(14),td:nth-child(6),td:nth-child(7),td:nth-child(8),td:nth-child(9),td:nth-child(10),td:nth-child(11),td:nth-child(12),td:nth-child(13),td:nth-child(14){text-align:right;padding-right:10px;}',
			'tbody tr:last-child td{font-weight:700;background:#f4f6fa;}'
		].join('');
	}

	function printGameListTable() {
		var payload = getGameListTablePayload(true);
		if (payload.dataRowCount === 0) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'info', title: 'Print', text: 'No rows to print for the current filter.', confirmButtonColor: '#0d6efd' });
			} else {
				alert('No rows to print.');
			}
			return;
		}
		var mode = $('input[name="filter-mode"]:checked').val() || 'settlement';
		var subtitle = mode === 'settlement'
			? ($('#settlement-date-picker').val() || window.selectedSettlementDate || '')
			: ($('#daterange-picker').val() || '');
		var headerHtml = payload.headers.map(function (h) {
			return '<th>' + escapeGameListPrintHtml(h) + '</th>';
		}).join('');
		var rowsHtml = payload.rows.map(function (row) {
			return '<tr>' + row.map(function (cell) {
				return '<td>' + escapeGameListPrintHtml(cell) + '</td>';
			}).join('') + '</tr>';
		}).join('');
		var iframe = document.createElement('iframe');
		iframe.style.position = 'fixed';
		iframe.style.right = '0';
		iframe.style.bottom = '0';
		iframe.style.width = '0';
		iframe.style.height = '0';
		iframe.style.border = '0';
		document.body.appendChild(iframe);
		var frameWindow = iframe.contentWindow;
		var frameDoc = frameWindow.document;
		frameDoc.open();
		frameDoc.write([
			'<!doctype html><html><head><title>Game Book</title><style>',
			getGameListPrintStyles(),
			'</style></head><body><div class="print-wrap">',
			'<h2>Game Book</h2>',
			'<div class="subtitle">', escapeGameListPrintHtml(subtitle), '</div>',
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

	$('#btn-game-list-print').on('click', function (e) {
		e.preventDefault();
		printGameListTable();
	});

	$('#btn-game-list-export').on('click', function (e) {
		e.preventDefault();
		if (!$.fn.DataTable.isDataTable('#game_list-tbl')) return;
		var payload = getGameListTablePayload(false);
		var headers = payload.headers;
		var rows = payload.rows;
		if (rows.length === 0) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'info', title: 'Export', text: 'No rows to export for the current filter.', confirmButtonColor: '#0d6efd' });
			} else {
				alert('No rows to export.');
			}
			return;
		}
		var outName = getGameListExportFilename();
		var $btn = $(this);
		$btn.prop('disabled', true);
		fetch('/game_list/export_xlsx', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ headers: headers, rows: rows, filename: outName })
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
					Swal.fire({ icon: 'error', title: 'Export', text: err.message || 'Export failed', confirmButtonColor: '#0d6efd' });
				} else {
					alert(err.message || 'Export failed');
				}
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	});

	// Account Search - when has value show one row per account with totals; when cleared reload game list
	$(document).on('keyup input', '#input-account-search', function () {
		var val = ($('#input-account-search').val() || '').trim();
		if (!$.fn.DataTable.isDataTable('#game_list-tbl')) return;
		if (val.length === 0) {
			reloadData();
			return;
		}
		// Switch to account summary view using cached totals
		window.showAccountSummaryView && window.showAccountSummaryView();
	});

	// Show table as one row per account with totals (used when Account Search has value)
	window.showAccountSummaryView = function () {
		var accountSearchVal = ($('#input-account-search').val() || '').trim();
		if (!accountSearchVal) return;
		var parts = accountSearchVal.split(/[\s\-–—]+/).map(function (p) { return p.trim(); }).filter(Boolean);
		var minNum = parts.length ? parseInt(parts[0], 10) : null;
		var maxNum = parts.length > 1 ? parseInt(parts[1], 10) : minNum;
		if (minNum == null || isNaN(minNum)) minNum = -Infinity;
		if (maxNum == null || isNaN(maxNum)) maxNum = minNum;
		if (minNum > maxNum) { var t = minNum; minNum = maxNum; maxNum = t; }
		var accountTotals = window._gameListAccountTotals || {};
		var dt = $('#game_list-tbl').DataTable();
		dt.clear();
		var grandAmount = 0, grandChipsReturn = 0, grandRealRolling = 0, grandRolling = 0, grandRollerChips = 0, grandCommission = 0, grandAddChg = 0, grandTotalSettle = 0, grandWinLoss = 0;
		Object.keys(accountTotals).forEach(function (accountId) {
			var acc = accountTotals[accountId];
			var acctStr = (acc.agent_code || '').toString();
			var match = acctStr.match(/\d+/);
			var acctNum = match ? parseInt(match[0], 10) : null;
			if (acctNum === null || acctNum < minNum || acctNum > maxNum) return;
			var acct_no_link = '<a href="#" onclick="account_details(' + acc.accountId + ', \'' + (acc.agent_code || '').replace(/'/g, "\\'") + '\', \'' + (acc.agent_name || '').replace(/'/g, "\\'") + '\')">' + (acc.agent_code || '') + ' (' + (acc.agent_name || '') + ')</a>';
			var gamesLabel = (acc.gameCount || 0) + ' game' + ((acc.gameCount || 0) !== 1 ? 's' : '');
			
			dt.row.add([
				'-',
				'-',
				gamesLabel,
				acct_no_link,
				'-',
				parseFloat(acc.total_amount || 0).toLocaleString(),
				parseFloat(acc.total_cash_out || 0).toLocaleString(),
				parseFloat(acc.total_winloss || 0).toLocaleString(),
				parseFloat(acc.total_rolling_real || 0).toLocaleString(),
				parseFloat(acc.total_rolling || 0).toLocaleString(),
				'-',
				parseFloat(acc.total_commission || 0).toLocaleString(),
				parseFloat(acc.total_add_chg || 0).toLocaleString(),
				parseFloat(acc.total_settle || 0).toLocaleString(),
				'-',
				parseFloat(acc.total_roller_chips || 0).toLocaleString(),
				'-'
			]);
			grandAmount += parseFloat(acc.total_amount || 0);
			grandChipsReturn += parseFloat(acc.total_cash_out || 0);
			grandRealRolling += parseFloat(acc.total_rolling_real || 0);
			grandRolling += parseFloat(acc.total_rolling || 0);
			grandRollerChips += parseFloat(acc.total_roller_chips || 0);
			grandCommission += parseFloat(acc.total_commission || 0);
			grandAddChg += parseFloat(acc.total_add_chg || 0);
			grandTotalSettle += parseFloat(acc.total_settle || 0);
			grandWinLoss += parseFloat(acc.total_winloss || 0);
		});
		dt.order([[3, 'asc']]); // Account view: sort by ACCT No (column 3)
		dt.draw();
		$('#game_list-tbl tfoot #GRAND_TOTAL_AMOUNT').text(grandAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		$('#game_list-tbl tfoot #GRAND_CHIPS_RETURN').text(grandChipsReturn.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		$('#game_list-tbl tfoot #GRAND_REAL_ROLLING').text(grandRealRolling.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		$('#game_list-tbl tfoot #GRAND_TOTAL_ROLLING').text(grandRolling.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		$('#game_list-tbl tfoot #GRAND_ROLLER_CHIPS').text(grandRollerChips.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		$('#game_list-tbl tfoot #GRAND_COMMISSION').text(grandCommission.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		$('#game_list-tbl tfoot #GRAND_ADD_CHG').text(grandAddChg.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		$('#game_list-tbl tfoot #GRAND_TOTAL_SETTLE').text(grandTotalSettle.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
		$('#game_list-tbl tfoot #GRAND_WIN_LOSS').text(grandWinLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
	};

    function clearGameListDisplay() {
        dataTable.clear();
        dataTable.draw();
        $('#game_list-tbl tfoot #GRAND_TOTAL_AMOUNT, #GRAND_CHIPS_RETURN, #GRAND_TOTAL_ROLLING, #GRAND_ROLLER_CHIPS, #GRAND_REAL_ROLLING, #GRAND_COMMISSION, #GRAND_ADD_CHG, #GRAND_TOTAL_SETTLE, #GRAND_WIN_LOSS').text('0.00');
    }

    function reloadData() {
        // Skip game-list table refresh logic when this script is reused on other pages (e.g. Agency).
        if (!$('#game_list-tbl').length) {
            return;
        }
		// Build params; if highlightId exists, pass it to bypass date filtering on backend
		const params = {};
		if (highlightId) {
			params.id = highlightId;
		} else {
			// Check filter mode: settlement or date range
			var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
			
			if (filterMode === 'settlement') {
				// Settlement date mode
				var date =
					window.selectedSettlementDate ||
					$('#settlement-date-wrapper .input-group').attr('data-initial-settlement-date') ||
					$('#settlement-date-wrapper .input-group').attr('data-today') ||
					getClientTodayYmd();
				if (!date) {
					alert('Please select a day.');
					return;
				}
				params.date = date;
				params.settlement_view = window.selectedSettlementSubView || 'open';
			} else {
				// Date range mode
				var dateRangePicker = document.getElementById('daterange-picker');
				var fromDate = null;
				var toDate = null;
				
				if (dateRangePicker && dateRangePicker._flatpickr) {
					var selectedDates = dateRangePicker._flatpickr.selectedDates;
					if (selectedDates && selectedDates.length === 2) {
						var pad = function(n) { return String(n).padStart(2, '0'); };
						fromDate = selectedDates[0].getFullYear() + '-' + pad(selectedDates[0].getMonth() + 1) + '-' + pad(selectedDates[0].getDate());
						toDate = selectedDates[1].getFullYear() + '-' + pad(selectedDates[1].getMonth() + 1) + '-' + pad(selectedDates[1].getDate());
					}
				}
				
				if (!fromDate || !toDate) {
                    clearGameListDisplay();
					return;
				}
				
				params.fromDate = fromDate;
				params.toDate = toDate;
			}
		}
        $.ajax({
            url: '/game_list_data', // Endpoint to fetch data
            method: 'GET',
            data: params,
            success: function (data) {
                window.lastSettlementRows = Array.isArray(data) ? data : [];
                dataTable.clear();

				  // ✅ Show only the highlighted record if an ID is specified
				  if (highlightId) {
					data = data.filter(row => row.game_list_id === parseInt(highlightId));
				}

                if (!data || data.length === 0) {
                    window.lastSettlementRows = [];
                    dataTable.draw();
                    $('#game_list-tbl tfoot #GRAND_TOTAL_AMOUNT, #GRAND_CHIPS_RETURN, #GRAND_TOTAL_ROLLING, #GRAND_ROLLER_CHIPS, #GRAND_REAL_ROLLING, #GRAND_COMMISSION, #GRAND_ADD_CHG, #GRAND_TOTAL_SETTLE, #GRAND_WIN_LOSS').text('0.00');
                    if (params.date && typeof window.updateSettleButtonState === 'function') window.updateSettleButtonState(0);
                    return;
                }
                // Only update settle button state if in settlement mode
                var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
                if (filterMode === 'settlement' && params.date && typeof window.updateSettleButtonState === 'function') {
                    window.updateSettleButtonState(data.length);
                }

                // Assume you have the user's permissions stored in a variable `userPermissions`
                var userPermissions = parseInt(document.getElementById('user-role').getAttribute('data-permissions'));

                // Account Search mode: show one row per account with totals instead of each game
                var accountSearchVal = ($('#input-account-search').val() || '').trim();
                var hasAccountSearch = accountSearchVal.length > 0;
                window._gameListAccountTotals = {}; // reset each load so we have fresh totals for current dataset
                // When in account mode we don't add game rows; we add account rows when all record APIs are done
                var pendingAccountMode = hasAccountSearch ? data.length : 0;
                if (!hasAccountSearch) dataTable.order([[2, 'desc']]); // Game view: sort by GAME # (column 2)

                function addAccountRows() {
                    var parts = accountSearchVal.split(/[\s\-–—]+/).map(function (p) { return p.trim(); }).filter(Boolean);
                    var minNum = parts.length ? parseInt(parts[0], 10) : null;
                    var maxNum = parts.length > 1 ? parseInt(parts[1], 10) : minNum;
                    if (minNum == null || isNaN(minNum)) minNum = -Infinity;
                    if (maxNum == null || isNaN(maxNum)) maxNum = minNum;
                    if (minNum > maxNum) { var t = minNum; minNum = maxNum; maxNum = t; }
                    var accountTotals = window._gameListAccountTotals || {};
                    var grandAmount = 0, grandChipsReturn = 0, grandRealRolling = 0, grandRolling = 0, grandRollerChips = 0, grandCommission = 0, grandAddChg = 0, grandTotalSettle = 0, grandWinLoss = 0;
                    Object.keys(accountTotals).forEach(function (accountId) {
                        var acc = accountTotals[accountId];
                        var acctStr = (acc.agent_code || '').toString();
                        var match = acctStr.match(/\d+/);
                        var acctNum = match ? parseInt(match[0], 10) : null;
                        if (acctNum === null || acctNum < minNum || acctNum > maxNum) return;
						var acct_no_link = '<a href="#" onclick="account_details(' + acc.accountId + ', \'' + (acc.agent_code || '').replace(/'/g, "\\'") + '\', \'' + (acc.agent_name || '').replace(/'/g, "\\'") + '\')">' + (acc.agent_code || '') + ' (' + (acc.agent_name || '') + ')</a>';
						var gamesLabel = (acc.gameCount || 0) + ' game' + ((acc.gameCount || 0) !== 1 ? 's' : '');
						dataTable.row.add([
							'-',
							'-',
							gamesLabel,
                            acct_no_link,
							'-',
                            parseFloat(acc.total_amount || 0).toLocaleString(),
                            parseFloat(acc.total_cash_out || 0).toLocaleString(),
                            parseFloat(acc.total_winloss || 0).toLocaleString(),
                            parseFloat(acc.total_rolling_real || 0).toLocaleString(),
                            parseFloat(acc.total_rolling || 0).toLocaleString(),
                            '-',
                            parseFloat(acc.total_commission || 0).toLocaleString(),
                            parseFloat(acc.total_add_chg || 0).toLocaleString(),
                            parseFloat(acc.total_settle || 0).toLocaleString(),
                            '-',
                            parseFloat(acc.total_roller_chips || 0).toLocaleString(),
                            '-'
                        ]);
                        grandAmount += parseFloat(acc.total_amount || 0);
                        grandChipsReturn += parseFloat(acc.total_cash_out || 0);
                        grandRealRolling += parseFloat(acc.total_rolling_real || 0);
                        grandRolling += parseFloat(acc.total_rolling || 0);
                        grandRollerChips += parseFloat(acc.total_roller_chips || 0);
                        grandCommission += parseFloat(acc.total_commission || 0);
                        grandAddChg += parseFloat(acc.total_add_chg || 0);
                        grandTotalSettle += parseFloat(acc.total_settle || 0);
                        grandWinLoss += parseFloat(acc.total_winloss || 0);
                    });
                    dataTable.order([[3, 'asc']]); // Account view: sort by ACCT No (column 3)
                    dataTable.draw();
                    $('#game_list-tbl tfoot #GRAND_TOTAL_AMOUNT').text(grandAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                    $('#game_list-tbl tfoot #GRAND_CHIPS_RETURN').text(grandChipsReturn.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                    $('#game_list-tbl tfoot #GRAND_REAL_ROLLING').text(grandRealRolling.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                    $('#game_list-tbl tfoot #GRAND_TOTAL_ROLLING').text(grandRolling.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                    $('#game_list-tbl tfoot #GRAND_ROLLER_CHIPS').text(grandRollerChips.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                    $('#game_list-tbl tfoot #GRAND_COMMISSION').text(grandCommission.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                    $('#game_list-tbl tfoot #GRAND_ADD_CHG').text(grandAddChg.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                    $('#game_list-tbl tfoot #GRAND_TOTAL_SETTLE').text(grandTotalSettle.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                    $('#game_list-tbl tfoot #GRAND_WIN_LOSS').text(grandWinLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
                }

                // Initialize totals
                let totalInitialBuyIn = 0;
                let totalAdditionalBuyIn = 0;
                let totalAmount = 0;
                let totalRolling = 0;
                let totalChipsReturn = 0;
                let totalWinLoss = 0;
                let totalRollerChips = 0;
                let totalRealRolling = 0;
                let totalCommission = 0;

                data.forEach(function (row) {

// 					let isHighlighted = highlightId && parseInt(highlightId) === row.game_list_id;
// let rowClass = isHighlighted ? 'highlight-row' : '';

                    var isSettlementModeUi = ($('input[name="filter-mode"]:checked').val() || 'settlement') === 'settlement';
                    var wrapperTodayEl = document.querySelector('#settlement-date-wrapper .input-group');
                    var dataTodayYmd =
                        (wrapperTodayEl && wrapperTodayEl.getAttribute('data-today')) ||
                        (function () {
                            var n = new Date();
                            return (
                                n.getFullYear() +
                                '-' +
                                String(n.getMonth() + 1).padStart(2, '0') +
                                '-' +
                                String(n.getDate()).padStart(2, '0')
                            );
                        })();
                    var selectedYmd = String(window.selectedSettlementDate || '').slice(0, 10);
                    var isTodaySettledView =
                        /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd) && selectedYmd === String(dataTodayYmd).slice(0, 10);
                    var canOpenPoolSelect =
                        isSettlementModeUi &&
                        window.selectedSettlementSubView === 'settled' &&
                        isTodaySettledView &&
                        window.isOpenPoolSelectionMode;

                    var btn = `<div class="btn-group">
                        <button type="button" onclick="viewRecord(${row.game_list_id})" class="btn btn-sm btn-info-subtle action-btn-square js-bs-tooltip-enabled"
                        data-bs-toggle="tooltip" aria-label="Details" data-bs-original-title="Details">
                        <i class="fa fa-file-alt"></i>
                        </button>
                        <button type="button" onclick="changeStatus(${row.game_list_id})" class="btn btn-sm btn-alt-warning action-btn-square js-bs-tooltip-enabled"
                        data-bs-toggle="tooltip" aria-label="Details" data-bs-original-title="Status">
                        <i class="fa fa-exchange-alt"></i>
                        </button>
                        <button type="button" onclick="archive_game_list(${row.game_list_id})" class="btn btn-sm btn-danger-subtle action-btn-square js-bs-tooltip-enabled"
                        data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
                        <i class="fa fa-trash-alt"></i>
                        </button>
                    </div>`;

                    var btn_his = `<div class="btn-group" role="group">
                        <button type="button" onclick="showHistory(${row.game_list_id})" class="btn btn-sm btn-info-subtle action-btn-square js-bs-tooltip-enabled"
                            data-bs-toggle="tooltip" aria-label="History" data-bs-original-title="History" title="History"
                            style="font-size:8px !important; margin-right: 5px;">
                            <i class="fa fa-history"></i>
                        </button>
                    </div>`;
                    var btn_services = `<div class="btn-group" role="group">
                        <button type="button" onclick="openServices(${row.game_list_id}, '${encodeURIComponent(row.agent_name || '')}', ${row.game_status}, ${row.SETTLED || 0}, ${row.AGENT_ID || 0})" class="btn btn-sm btn-primary-subtle action-btn-square js-bs-tooltip-enabled"
                            data-bs-toggle="tooltip" aria-label="Services" data-bs-original-title="Services" title="Services"
                            style="font-size:8px !important; margin-right: 5px;">
                            <i class="fa fa-concierge-bell"></i>
                        </button>
                    </div>`;

                    var ref = '';
                    var acct_code = '';

                    if (row.GUESTNo) {
                        ref = `${row.CODE}-${row.AGENT_CODE}-${row.GUESTNo}-${row.GAME_NO}`;
                        acct_code = `${row.CODE}-${row.AGENT_CODE}-${row.GUESTNo}`;
                    } else {
                        ref = `${row.CODE}-${row.AGENT_CODE}-${row.GAME_NO}`;
                        acct_code = `${row.CODE}-${row.AGENT_CODE}`;
                    }

                    var dateFormat = moment(row.GAME_DATE).format('MMMM DD, YYYY');

                    $.ajax({
                        url: '/game_list/' + row.game_list_id + '/record',
                        method: 'GET',
                        success: function (response) {
                            var total_buy_in = 0;
                            var total_cash_out = 0;
                            var total_rolling = 0;
                            var initial_buy_in = 0;

                            var total_nn_init = 0;
                            var total_cc_init = 0;
                            var total_nn = 0;
                            var total_cc = 0;
                            var total_cash_out_nn = 0;
                            var total_cash_out_cc = 0;
                            var total_rolling_nn = 0;
                            var total_rolling_cc = 0;

					var total_rolling_real = 0;
					var total_rolling_nn_real = 0;
					var total_rolling_cc_real = 0;
					var total_roller_nn = 0;
					var total_roller_cc = 0;
					var total_roller_return_cc = 0;
                            var total_roller_return_cc = 0;
                            var isMarkerGameRow = false;

                            response.forEach(function (res) {
                                if (res.CAGE_TYPE == 1 && parseInt(res.TRANSACTION, 10) === 3) {
                                    isMarkerGameRow = true;
                                }
                                if (res.CAGE_TYPE == 1 && (total_nn_init != 0 || total_cc_init != 0)) {
                                    total_buy_in = total_buy_in + res.AMOUNT;
                                    total_nn = total_nn + res.NN_CHIPS;
                                    total_cc = total_cc + res.CC_CHIPS;
                                }

                                if ((total_nn_init == 0 && total_cc_init == 0) && res.CAGE_TYPE == 1) {
                                    initial_buy_in = res.AMOUNT;
                                    total_nn_init = total_nn_init + res.NN_CHIPS;
                                    total_cc_init = total_cc_init + res.CC_CHIPS;
                                }

                                if (res.CAGE_TYPE == 2) {
                                    total_cash_out = total_cash_out + res.AMOUNT;
                                    total_cash_out_nn = total_cash_out_nn + res.NN_CHIPS;
                                    total_cash_out_cc = total_cash_out_cc + res.CC_CHIPS;
                                }

                                if (res.CAGE_TYPE == 3) {
                                    total_rolling = total_rolling + res.AMOUNT;
                                    total_rolling_nn = total_rolling_nn + res.NN_CHIPS;
                                    total_rolling_cc = total_rolling_cc + res.CC_CHIPS;
                                }

                                if (res.CAGE_TYPE == 4) {
                                    total_rolling_real = total_rolling_real + res.AMOUNT;
                                    total_rolling_nn_real = total_rolling_nn_real + res.NN_CHIPS;
                                    total_rolling_cc_real = total_rolling_cc_real + res.CC_CHIPS;
                                }
                                
                                if (res.CAGE_TYPE == 5) {
                                    // ROLLER CHIPS - tracked separately (do NOT affect total rolling)
                                    // Use ROLLER_NN_CHIPS and ROLLER_CC_CHIPS columns
                                    // ROLLER_TRANSACTION: 1 = ADD (add), 2 = RETURN (subtract)
                                    var rollerTransaction = res.ROLLER_TRANSACTION || 1; // Default to ADD if null
                                    if (rollerTransaction == 1) {
                                        total_roller_nn = total_roller_nn + (res.ROLLER_NN_CHIPS || 0);
                                        total_roller_cc = total_roller_cc + (res.ROLLER_CC_CHIPS || 0);
                                    } else if (rollerTransaction == 2) {
                                        total_roller_nn = total_roller_nn - (res.ROLLER_NN_CHIPS || 0);
                                        total_roller_cc = total_roller_cc - (res.ROLLER_CC_CHIPS || 0);
                                        total_roller_return_cc += (res.ROLLER_CC_CHIPS || 0);
                                    }
                                }
                            });

							var buyinBtnStyle = 'font-size:11px;text-decoration: underline;' + (isMarkerGameRow ? 'color:#dc3545 !important;' : '');
							var formatBuyinPlain = function (amt) {
								var s = parseFloat(amt).toLocaleString();
								return isMarkerGameRow ? '<span style="color:#dc3545;font-size:11px;">' + s + '</span>' : s;
							};
	
							var total_initial = total_nn_init + total_cc_init;
							var total_buy_in_chips = total_nn + total_cc;
							var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
							
                            // TOTAL ROLLING: exclude roller chip movements (ADD/RETURN)
                            // CASHOUT NN subtracts from rolling (player cashes out NN chips, removed from play)
                            // CC chips don't affect rolling (CC chips are winnings from dealer, not played chips)
                            // Note: CC chips from CAGE_TYPE == 3 (TOTAL ROLLING) should NOT be included
                            // Note: Buy-in amounts are NOT included here - they are separate from rolling transactions
							var totalRollingCCWithReturns = total_roller_return_cc;  // Only include roller return CC, exclude CC from CAGE_TYPE == 3
                            var total_rolling_chips = total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;
	
							var total_rolling_real_chips = total_rolling_real + total_rolling_nn_real + total_rolling_cc_real + total_roller_return_cc;
							var total_roller_chips = total_roller_nn + total_roller_cc;
	
							var gross = total_buy_in - total_cash_out;
	
							var total_amount = total_buy_in_chips + total_initial;
	
					
	
							var winloss = parseFloat(total_amount - total_cash_out_chips).toLocaleString();
							
							var WinLoss = total_amount - total_cash_out_chips;
							
							
							 // Calculate net and format as an integer (multiply first, then divide to avoid float precision e.g. 4317000*1.50% -> 62597 not 62596)
							 var net = 0;
							 if (row.COMMISSION_TYPE == 1 || row.COMMISSION_TYPE == 3) {
								 // If COMMISSION_TYPE is 1 or 3, compute net using total rolling chips
								 net = Math.round((total_rolling_chips * row.COMMISSION_PERCENTAGE) / 100);
							 } else if (row.COMMISSION_TYPE == 2) {
								 // If COMMISSION_TYPE is 2, compute net using winloss
								 net = Math.round((WinLoss * row.COMMISSION_PERCENTAGE) / 100);
							 }
							var addChgValue = parseFloat(row.ADD_CHG || row.add_chg || 0);
							var totalSettleValue = net - addChgValue;
	
							// Add to grand totals
							totalInitialBuyIn += total_initial;
							totalAdditionalBuyIn += total_buy_in_chips;
							totalAmount += total_amount;
							totalRolling += total_rolling_chips;
							totalChipsReturn += total_cash_out_chips;
							totalWinLoss += parseFloat(winloss.replace(/,/g, ''));
							totalRollerChips += total_roller_chips;

							// Account summary: accumulate per-account totals (used when Account Search is active)
							var aid = row.ACCOUNT_ID;
							if (!window._gameListAccountTotals[aid]) window._gameListAccountTotals[aid] = { accountId: aid, agent_code: row.agent_code, agent_name: row.agent_name, gameCount: 0, gameIds: [], total_amount: 0, total_cash_out: 0, total_rolling_real: 0, total_rolling: 0, total_roller_chips: 0, total_commission: 0, total_winloss: 0, total_add_chg: 0, total_settle: 0 };
							var at = window._gameListAccountTotals[aid];
							var isDupAccount = (at.gameIds || []).indexOf(row.game_list_id) !== -1;
							if (isDupAccount && hasAccountSearch) { pendingAccountMode--; if (pendingAccountMode === 0) addAccountRows(); return; }
							if (!isDupAccount) {
								at.gameCount++;
								at.gameIds = at.gameIds || [];
								at.gameIds.push(row.game_list_id);
								at.total_amount += total_amount;
							at.total_cash_out += total_cash_out_chips;
							at.total_rolling_real += total_rolling_real_chips;
							at.total_rolling += total_rolling_chips;
							at.total_roller_chips += total_roller_chips;
							at.total_commission += net;
							at.total_winloss += WinLoss;
							at.total_add_chg += addChgValue;
							at.total_settle += totalSettleValue;
							}
							if (hasAccountSearch) { pendingAccountMode--; if (pendingAccountMode === 0) addAccountRows(); return; }

							var btn_settle = '';
							var status = '';
							var isSettled = row.SETTLED === 1;
							var settledTooltip = window.gamelistTranslations?.settled || 'Game already settled';
							var statusDateClass = 'status-date-link text-decoration-none';
	
							var buyin_td = '';
							var rolling_td = '';
							var cashout_td = '';
							var roller_chips_td = '';
	
							if (row.game_status == 2) {
								const onGameText = window.gamelistTranslations?.on_game || "ON GAME";
								if (userPermissions === 11 || userPermissions === 1 || userPermissions === 0) { // If manager or Super admin
									if (isSettled && userPermissions !== 0) { // Super admin (0) can edit even when settled
										status = `<button type="button" class="btn btn-sm btn-primary-subtle js-bs-tooltip-enabled"
											data-bs-toggle="tooltip" aria-label="Status" data-bs-original-title="${settledTooltip}"
											style="font-size:10px !important;" onclick="showSettledAlert(); return false;">${onGameText}</button>`;
									} else {
										status = `<button type="button" onclick="changeStatus(${row.game_list_id}, ${net}, ${row.ACCOUNT_ID } , ${total_amount} , ${total_cash_out_chips} , ${total_rolling_chips} , ${WinLoss})" class="btn btn-sm btn-primary-subtle js-bs-tooltip-enabled"
											data-bs-toggle="tooltip" aria-label="Details" data-bs-original-title="Status"  style="font-size:8px !important;">${onGameText}</button>`;
									}
								} else {
									if (isSettled) {
										status = `<button type="button" class="btn btn-sm btn-primary-subtle btn-on-game"
											style="font-size:10px !important;"
											data-bs-toggle="tooltip" aria-label="Status" data-bs-original-title="${settledTooltip}"
											onclick="showSettledAlert(); return false;">${onGameText}</button>`;
									} else {
										// Show SweetAlert for cashier or other users
										status = `<button type="button" 
													class="btn btn-sm btn-primary-subtle btn-on-game" 
											style="font-size:8px !important;"
													onclick="showSweetAlert()">
												${onGameText}
											</button>`;
									}
								}

								buyin_td = '<button class="btn btn-link" style="' + buyinBtnStyle + '" onclick="addBuyin(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ')">' + parseFloat(total_amount).toLocaleString() + '</button>';
								rolling_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addRolling(' + row.game_list_id + ')">' + parseFloat(total_rolling_real_chips).toLocaleString() + '</button>';
								cashout_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addCashout(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ', ' + total_rolling_chips + ')">' + parseFloat(total_cash_out_chips).toLocaleString() + '</button>';
								roller_chips_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addRollerChips(' + row.game_list_id + ')">' + parseFloat(total_roller_chips).toLocaleString() + '</button>';
								
									// Format net value as an integer
									var formattedNet = net.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
								var game_start = moment.utc(row.GAME_DATE_START).utcOffset(8).format('MMMM DD, HH:mm');
								var gameStartCellOg = buildGameStartCell(
									game_start,
									row.game_list_id,
									row.ACCOUNT_ID,
									row.SETTLED === 1,
									false,
									canOpenPoolSelect
								);
								
								// const highlightId = getQueryParam('highlight_id');
								// const gameListIdText = $('<div>').html(row.game_list_id).text();
								// const isHighlighted = highlightId && parseInt(highlightId) === parseInt(gameListIdText);
								// const rowClass = isHighlighted ? 'highlight-row' : '';
								// let gameIdDisplay = row.game_list_id;

								// if (rowClass !== '') {
								// 	gameIdDisplay = `⭐ ${row.game_list_id}`;
								// }

                                var actionButtons = btn_services;
                                if (userPermissions === 11 || userPermissions === 1 || userPermissions === 0) {
                                    actionButtons += btn_his;
                                }
                                actionButtons += btn_settle;
                                if (userPermissions === 0) {
                                    actionButtons += `<div class="btn-group" role="group"><button type="button" onclick="delete_game_list(${row.game_list_id})" class="btn btn-sm btn-warning-subtle action-btn-square js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Delete" data-bs-original-title="Delete Game"><i class="fa fa-trash-alt"></i></button></div>`;
                                }

                                var acct_no_link = `<a href="#" onclick="account_details(${row.ACCOUNT_ID}, '${row.agent_code}', '${row.agent_name}')">${row.agent_code} (${row.agent_name})</a>`;
								var guestDisplay = row.GUEST_ID ? (row.guest_name || '-') : '-';
                                let rowNode = dataTable.row.add([
                                    gameStartCellOg,
                                    `${row.GAME_TYPE}`,
                                    `${row.game_list_id}`,
                                    acct_no_link,
									guestDisplay,
                                    buyin_td,
                                    cashout_td,
                                    winloss,
                                    rolling_td,
                                    parseFloat(total_rolling_chips).toLocaleString(),
                                    buildGameRateCell(row, userPermissions, isSettled),
                                    formattedNet,
                                    addChgValue.toLocaleString(),
                                    totalSettleValue.toLocaleString(),
                                    status,
                                    roller_chips_td,
                                    actionButtons
                                ]).draw().node();
                                if (row.DAILY_SETTLEMENT != 2) {
                                    $(rowNode).find('td').eq(2).addClass('unsettled-game-cell');
                                }
								
								
								

								// if (rowClass !== '') {
								// 	console.log('✅ Highlighting row:', gameListIdText);
								// 	$(rowNode).addClass(rowClass);

								// 	setTimeout(() => {
								// 		$('html, body').animate({
								// 			scrollTop: $(rowNode).offset().top - 100
								// 		}, 600);
								// 	}, 300);
								// }


								
							} else if (row.game_status == 3) {
								// Account summary accumulation (same as ON GAME branch)
								var aid3 = row.ACCOUNT_ID;
								if (!window._gameListAccountTotals[aid3]) window._gameListAccountTotals[aid3] = { accountId: aid3, agent_code: row.agent_code, agent_name: row.agent_name, gameCount: 0, gameIds: [], total_amount: 0, total_cash_out: 0, total_rolling_real: 0, total_rolling: 0, total_roller_chips: 0, total_commission: 0, total_winloss: 0, total_add_chg: 0, total_settle: 0 };
								var at3 = window._gameListAccountTotals[aid3];
								var isDup3 = (at3.gameIds || []).indexOf(row.game_list_id) !== -1;
								if (isDup3 && hasAccountSearch) { pendingAccountMode--; if (pendingAccountMode === 0) addAccountRows(); return; }
								if (!isDup3) {
									at3.gameCount++;
									at3.gameIds = at3.gameIds || [];
									at3.gameIds.push(row.game_list_id);
									at3.total_amount += total_amount;
									at3.total_cash_out += total_cash_out_chips;
									at3.total_rolling_real += total_rolling_real_chips;
									at3.total_rolling += total_rolling_chips;
									at3.total_roller_chips += total_roller_chips;
									at3.total_commission += net;
									at3.total_winloss += WinLoss;
									at3.total_add_chg += addChgValue;
									at3.total_settle += totalSettleValue;
								}
								if (hasAccountSearch) { pendingAccountMode--; if (pendingAccountMode === 0) addAccountRows(); return; }
								// PENDING STATUS (discrepancy in roller chips return)
								const pendingText = "PENDING";
								if (userPermissions === 11 || userPermissions === 1 || userPermissions === 0) { // If manager or Super admin
									// PENDING STATUS EDITABLE - pass current status (3) so modal auto-selects END GAME
									if (isSettled && userPermissions !== 0) { // Super admin (0) can edit even when settled
										status = `<button type="button" class="btn btn-sm btn-warning-subtle js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Pending Review" data-bs-original-title="${settledTooltip}" style="font-size:10px !important;" onclick="showSettledAlert(); return false;">${pendingText}</button>`;
									} else {
										status = `<button type="button" onclick="changeStatus(${row.game_list_id}, ${net}, ${row.ACCOUNT_ID }, ${total_amount}, ${total_cash_out_chips}, ${total_rolling_chips}, ${WinLoss}, 3)" class="btn btn-sm btn-warning-subtle js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Pending Review" data-bs-original-title="Pending Review" style="font-size:10px !important;">${pendingText}</button>`;
									}
								} else {
									// PENDING STATUS NOT EDITABLE
									status = `<button type="button" class="btn btn-sm btn-warning-subtle" style="font-size:10px !important;" onclick="showEndGameAlert()">${pendingText}</button>`;
								}
								
								// No add when settled (all users). When not settled, Super admin can add
								if (isSettled) {
									buyin_td = formatBuyinPlain(total_amount);
									rolling_td = parseFloat(total_rolling_real_chips).toLocaleString();
									cashout_td = '<span style="font-size:11px;text-decoration: none;">' + parseFloat(total_cash_out_chips).toLocaleString() + '</span>';
									roller_chips_td = parseFloat(total_roller_chips).toLocaleString();
								} else if (userPermissions === 0) {
									buyin_td = '<button class="btn btn-link" style="' + buyinBtnStyle + '" onclick="addBuyin(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ')">' + parseFloat(total_amount).toLocaleString() + '</button>';
									rolling_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addRolling(' + row.game_list_id + ')">' + parseFloat(total_rolling_real_chips).toLocaleString() + '</button>';
									cashout_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addCashout(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ', ' + total_rolling_chips + ')">' + parseFloat(total_cash_out_chips).toLocaleString() + '</button>';
									roller_chips_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addRollerChips(' + row.game_list_id + ', true)">' + parseFloat(total_roller_chips).toLocaleString() + '</button>';
								} else {
									buyin_td = formatBuyinPlain(total_amount);
									rolling_td = parseFloat(total_rolling_real_chips).toLocaleString();
									cashout_td = '<span style="font-size:11px;text-decoration: none;">' + parseFloat(total_cash_out_chips).toLocaleString() + '</span>';
									roller_chips_td = parseFloat(total_roller_chips).toLocaleString();
								}
								// Use the same action buttons as END GAME to avoid duplicates (History + Settlement icons)
								var settleLabel = row.SETTLED === 1 ? 'Settled' : 'Settlement';
								var settleClass = row.SETTLED === 1 ? 'btn-success-subtle' : 'btn-danger-subtle';
								var settleTitle = settleLabel;
								var btn_settle = `<div class="btn-group" role="group">
								<button type="button" onclick="showHistory(${row.game_list_id})" class="btn btn-sm btn-info-subtle action-btn-square js-bs-tooltip-enabled"
										data-bs-toggle="tooltip" aria-label="History" data-bs-original-title="History" title="History"
										style="font-size:8px !important; margin-right: 5px;">
										<i class="fa fa-history"></i>
								</button>
								<button type="button" onclick="settlement_history(${row.game_list_id}, ${row.ACCOUNT_ID })" class="btn btn-sm ${settleClass} action-btn-square js-bs-tooltip-enabled"
										data-bs-toggle="tooltip" aria-label="${settleTitle}" data-bs-original-title="${settleTitle}" title="${settleTitle}"
										style="font-size:10px !important;">
										 <i class="fa fa-clipboard-check"></i>
								</button>
						   </div>`;
								
								// Format net value as an integer
								var formattedNet = net.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
								var game_start = moment.utc(row.GAME_DATE_START).utcOffset(8).format('MMMM DD, HH:mm');
								var isSettlementMode = ($('input[name="filter-mode"]:checked').val() || 'settlement') === 'settlement';
								var canDailySettle = isSettlementMode && window.isDailySettleSelectionMode;
								var gameStartCell = buildGameStartCell(
									game_start,
									row.game_list_id,
									row.ACCOUNT_ID,
									row.SETTLED === 1,
									canDailySettle,
									canOpenPoolSelect
								);
								
								var actionButtons = btn_services + btn_settle;
								if (userPermissions === 0) {
									actionButtons += `<div class="btn-group" role="group"><button type="button" onclick="delete_game_list(${row.game_list_id})" class="btn btn-sm btn-warning-subtle action-btn-square js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Delete" data-bs-original-title="Delete Game"><i class="fa fa-trash-alt"></i></button></div>`;
								}
								var acct_no_link = `<a href="#" onclick="account_details(${row.ACCOUNT_ID}, '${row.agent_code}', '${row.agent_name}')">${row.agent_code} (${row.agent_name})</a>`;
								var guestDisplay = row.GUEST_ID ? (row.guest_name || '-') : '-';

								let rowNode = dataTable.row.add([
									gameStartCell,
									`${row.GAME_TYPE}`,
									`${row.game_list_id}`,
									acct_no_link,
									guestDisplay,
									buyin_td,
									cashout_td,
									winloss,
									rolling_td,
									parseFloat(total_rolling_chips).toLocaleString(),
									buildGameRateCell(row, userPermissions, isSettled),
									formattedNet,
									addChgValue.toLocaleString(),
									totalSettleValue.toLocaleString(),
									status,
									roller_chips_td,
									actionButtons
								]).draw().node();
                                if (row.DAILY_SETTLEMENT != 2) {
                                    $(rowNode).find('td').eq(2).addClass('unsettled-game-cell');
                                }
								
								
								
							} else {
								// Account summary accumulation (END GAME branch)
								var aid1 = row.ACCOUNT_ID;
								if (!window._gameListAccountTotals[aid1]) window._gameListAccountTotals[aid1] = { accountId: aid1, agent_code: row.agent_code, agent_name: row.agent_name, gameCount: 0, gameIds: [], total_amount: 0, total_cash_out: 0, total_rolling_real: 0, total_rolling: 0, total_roller_chips: 0, total_commission: 0, total_winloss: 0, total_add_chg: 0, total_settle: 0 };
								var at1 = window._gameListAccountTotals[aid1];
								var isDup1 = (at1.gameIds || []).indexOf(row.game_list_id) !== -1;
								if (isDup1 && hasAccountSearch) { pendingAccountMode--; if (pendingAccountMode === 0) addAccountRows(); return; }
								if (!isDup1) {
									at1.gameCount++;
									at1.gameIds = at1.gameIds || [];
									at1.gameIds.push(row.game_list_id);
									at1.total_amount += total_amount;
									at1.total_cash_out += total_cash_out_chips;
									at1.total_rolling_real += total_rolling_real_chips;
									at1.total_rolling += total_rolling_chips;
									at1.total_roller_chips += total_roller_chips;
									at1.total_commission += net;
									at1.total_winloss += WinLoss;
									at1.total_add_chg += addChgValue;
									at1.total_settle += totalSettleValue;
								}
								if (hasAccountSearch) { pendingAccountMode--; if (pendingAccountMode === 0) addAccountRows(); return; }
								// END GAME STATUS (status = 1)
								if (userPermissions === 11 || userPermissions === 1 || userPermissions === 0) { // If manager or Super admin
									// END GAME STATUS EDITABLE(ON GAME & END GAME)
									if (isSettled && userPermissions !== 0) { // Super admin (0) can edit even when settled
										status = `<a href="#" class="${statusDateClass}" style="font-size:10px !important;" aria-label="Status" data-bs-toggle="tooltip" data-bs-original-title="${settledTooltip}" onclick="showSettledAlert(); return false;">${moment(row.GAME_ENDED).format('MMMM DD, HH:mm')}</a>`;
									} else {
										status = `<a href="#" class="${statusDateClass}" style="font-size:10px !important;" onclick="changeStatus(${row.game_list_id}, ${net}, ${row.ACCOUNT_ID }, ${total_amount}, ${total_cash_out_chips}, ${total_rolling_chips}, ${WinLoss})">${moment(row.GAME_ENDED).format('MMMM DD, HH:mm')}</a>`;
									}

								} else {
									
								// //END GAME STATUS NOT EDITABLE
								status = `<a href="#" onclick="showEndGameAlert()">${moment(row.GAME_ENDED).format('MMMM DD, HH:mm')}</a>`;

									
								}
	
								// No add when settled (all users). When not settled, Super admin can add Buy-in, Cash-out, Rolling
								if (isSettled) {
									buyin_td = formatBuyinPlain(total_amount);
									rolling_td = parseFloat(total_rolling_real_chips).toLocaleString();
									cashout_td = '<span style="font-size:11px;text-decoration: none;">' + parseFloat(total_cash_out_chips).toLocaleString() + '</span>';
									roller_chips_td = parseFloat(total_roller_chips).toLocaleString();
								} else if (userPermissions === 0) {
									buyin_td = '<button class="btn btn-link" style="' + buyinBtnStyle + '" onclick="addBuyin(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ')">' + parseFloat(total_amount).toLocaleString() + '</button>';
									rolling_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addRolling(' + row.game_list_id + ')">' + parseFloat(total_rolling_real_chips).toLocaleString() + '</button>';
									cashout_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addCashout(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ', ' + total_rolling_chips + ')">' + parseFloat(total_cash_out_chips).toLocaleString() + '</button>';
									roller_chips_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addRollerChips(' + row.game_list_id + ', true)">' + parseFloat(total_roller_chips).toLocaleString() + '</button>';
								} else {
									buyin_td = formatBuyinPlain(total_amount);
									rolling_td = parseFloat(total_rolling_real_chips).toLocaleString();
									cashout_td = '<span style="font-size:11px;text-decoration: none;">' + parseFloat(total_cash_out_chips).toLocaleString() + '</span>';
									roller_chips_td = parseFloat(total_roller_chips).toLocaleString();
								}
	
								var settleLabel = row.SETTLED === 1 ? 'Settled' : 'Settlement';
								var settleClass = row.SETTLED === 1 ? 'btn-success-subtle' : 'btn-danger-subtle';
								var settleTitle = settleLabel;
								var btn_settle = `<div class="btn-group" role="group">
								<button type="button" onclick="showHistory(${row.game_list_id})" class="btn btn-sm btn-info-subtle action-btn-square js-bs-tooltip-enabled"
										data-bs-toggle="tooltip" aria-label="History" data-bs-original-title="History" title="History"
										style="font-size:8px !important; margin-right: 5px;">
										<i class="fa fa-history"></i>
								</button>
								<button type="button" onclick="settlement_history(${row.game_list_id}, ${row.ACCOUNT_ID })" class="btn btn-sm ${settleClass} action-btn-square js-bs-tooltip-enabled"
										data-bs-toggle="tooltip" aria-label="${settleTitle}" data-bs-original-title="${settleTitle}" title="${settleTitle}"
										style="font-size:10px !important;">
										 <i class="fa fa-clipboard-check"></i>
								</button>
						   </div>`;
						   // Format net value as an integer
						   var formattedNet = net.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
						   
						   var game_start = moment.utc(row.GAME_DATE_START).utcOffset(8).format('MMMM DD, HH:mm');
						   var isSettlementModeEnd = ($('input[name="filter-mode"]:checked').val() || 'settlement') === 'settlement';
						   var canDailySettleEnd = isSettlementModeEnd && window.isDailySettleSelectionMode;
						   var gameStartCellEnd = buildGameStartCell(
							   game_start,
							   row.game_list_id,
							   row.ACCOUNT_ID,
							   row.SETTLED === 1,
							   canDailySettleEnd,
							   canOpenPoolSelect
						   );
						   var actionButtons = btn_services + btn_settle;
						   if (userPermissions === 0) {
							   actionButtons += `<div class="btn-group" role="group"><button type="button" onclick="delete_game_list(${row.game_list_id})" class="btn btn-sm btn-warning-subtle action-btn-square js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Delete" data-bs-original-title="Delete Game"><i class="fa fa-trash-alt"></i></button></div>`;
						   }
						   var acct_no_link = `<a href="#" onclick="account_details(${row.ACCOUNT_ID}, '${row.agent_code}', '${row.agent_name}')">${row.agent_code} (${row.agent_name})</a>`;
						   var guestDisplay = row.GUEST_ID ? (row.guest_name || '-') : '-';
						   let rowNode = dataTable.row.add([gameStartCellEnd,`${row.GAME_TYPE}`, `${row.game_list_id}`, acct_no_link, guestDisplay, buyin_td, cashout_td, winloss, rolling_td, parseFloat(total_rolling_chips).toLocaleString(), buildGameRateCell(row, userPermissions, isSettled), formattedNet, addChgValue.toLocaleString(), totalSettleValue.toLocaleString(), status, roller_chips_td, actionButtons]).draw().node();
                           if (row.DAILY_SETTLEMENT != 2) {
                               $(rowNode).find('td').eq(2).addClass('unsettled-game-cell');
                           }
						   
						   
							}
	
						},
						error: function (xhr, status, error) {
                            console.error('Error fetching options:', error);
                        }
                    });
                });
            },
            error: function (xhr, status, error) {
                console.error('Error fetching data:', error);
            }
        });
    }

    // Expose reloadData to window so it can be called from date range picker
    window.reloadData = reloadData;
    window.reloadGameListBySettlementDate = function () { reloadData(); };

    var settledDatesRaw = $('#settlement-date-wrapper .input-group').attr('data-settled-dates');
    try {
        window.settledDatesForMonth = settledDatesRaw ? JSON.parse(settledDatesRaw) : [];
    } catch (e) {
        window.settledDatesForMonth = [];
    }
    window.draftDatesForMonth = [];
    var settleBtnLabel = (window.gamelistTranslations && window.gamelistTranslations.settle) || 'Settle';
    window.updateSettleButtonState = function (recordCount) {
        var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
        var $btn = $('#btn-daily-settle');

        if (filterMode !== 'settlement') {
            $btn.addClass('disabled').removeClass('breadcrumb-settled breadcrumb-crumb-armed').css('pointer-events', 'none').css('opacity', '0.5');
            return;
        }

        var date = window.selectedSettlementDate;
        if (!date) {
            $btn.addClass('disabled').removeClass('breadcrumb-settled breadcrumb-crumb-armed').text(settleBtnLabel).css('pointer-events', 'none').css('opacity', '0.5');
            return;
        }

        $btn.removeClass('disabled breadcrumb-settled').text(settleBtnLabel).css('pointer-events', 'auto').css('opacity', '1');
    };

    // Previous/Next Date Navigation Functions
    function getEarliestSettlementDate() {
        // Allow navigation back to January 1 of previous year
        // (no longer restricted by settledDatesForMonth which only contains current month's settled dates)
        var now = new Date();
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var earliestAllowed = new Date(now.getFullYear() - 1, 0, 1);
        return earliestAllowed.getFullYear() + '-' + pad(earliestAllowed.getMonth() + 1) + '-' + pad(earliestAllowed.getDate());
    }
    
    function getPreviousDate(currentDate) {
        if (!currentDate) return null;
        
        var current = new Date(currentDate + 'T12:00:00');
        var previous = new Date(current);
        previous.setDate(previous.getDate() - 1);
        
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var previousDateStr = previous.getFullYear() + '-' + pad(previous.getMonth() + 1) + '-' + pad(previous.getDate());
        
        // Get the earliest settlement date (when settlements started)
        var earliestSettlementDate = getEarliestSettlementDate();
        
        // Don't go before the earliest settlement date
        if (previousDateStr < earliestSettlementDate) {
            return null;
        }
        
        return previousDateStr;
    }
    
    function getNextDate(currentDate) {
        if (!currentDate) return null;
        
        var current = new Date(currentDate + 'T12:00:00');
        var next = new Date(current);
        next.setDate(next.getDate() + 1);
        
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var nextDateStr = next.getFullYear() + '-' + pad(next.getMonth() + 1) + '-' + pad(next.getDate());
        
        var wrapper = document.querySelector('#settlement-date-wrapper .input-group');
        var maxAllowedStr = wrapper && wrapper.getAttribute('data-max-settlement-date');
        if (maxAllowedStr && String(maxAllowedStr).trim() !== '' && nextDateStr > maxAllowedStr) {
            return null;
        }
        
        return nextDateStr;
    }

    function getDefaultSettlementSubView(targetDate) {
        if (isCurrentDate(targetDate)) return 'open';
        return hasSettlementForDate(targetDate) ? 'settled' : 'open';
    }
    
    // Expose updateNavigationButtons globally so it can be called from flatpickr onChange
    window.updateNavigationButtons = function() {
        var currentDate =
            window.selectedSettlementDate ||
            $('#settlement-date-wrapper .input-group').attr('data-initial-settlement-date') ||
            $('#settlement-date-wrapper .input-group').attr('data-today');
        var previousDate = getPreviousDate(currentDate);
        var nextDate = getNextDate(currentDate);
        
        // Update previous button state
        if (previousDate) {
            $('#btn-settlement-prev').prop('disabled', false);
        } else {
            $('#btn-settlement-prev').prop('disabled', true);
        }
        
        // Update next button state
        if (nextDate) {
            $('#btn-settlement-next').prop('disabled', false);
        } else {
            $('#btn-settlement-next').prop('disabled', true);
        }
    };
    
    window.updateOpenPoolBreadcrumbVisibility = function () {
        var $open = $('#btn-breadcrumb-open-pool');
        if (!$open.length) return;
        var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
        var visible = false;
        if (filterMode === 'settlement') {
            var wrapperTodayEl = document.querySelector('#settlement-date-wrapper .input-group');
            var dataTodayYmd =
                (wrapperTodayEl && wrapperTodayEl.getAttribute('data-today')) ||
                getClientTodayYmd();
            var selectedYmd = String(window.selectedSettlementDate || '').slice(0, 10);
            visible =
                /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd) &&
                selectedYmd === String(dataTodayYmd).slice(0, 10) &&
                window.selectedSettlementSubView === 'settled';
        }
        if (visible) {
            $open.removeClass('d-none');
        } else {
            if (window.isOpenPoolSelectionMode) {
                setOpenPoolSelectionMode(false);
                if (typeof window.reloadGameListBySettlementDate === 'function') {
                    window.reloadGameListBySettlementDate();
                }
            }
            $open.addClass('d-none');
        }
    };

    window.updateSettlementSubviewIndicator = function() {
        var $indicator = $('#settlement-subview-indicator');
        var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
        if (filterMode !== 'settlement') {
            if ($indicator.length) {
                $indicator.text('').removeClass('is-open is-settled').hide();
            }
            if (typeof window.updateOpenPoolBreadcrumbVisibility === 'function') {
                window.updateOpenPoolBreadcrumbVisibility();
            }
            return;
        }
        if (!$indicator.length) {
            if (typeof window.updateOpenPoolBreadcrumbVisibility === 'function') {
                window.updateOpenPoolBreadcrumbVisibility();
            }
            return;
        }
        $indicator.show();
        if (window.selectedSettlementSubView === 'settled') {
            $indicator.text('Settled').removeClass('is-open').addClass('is-settled');
        } else {
            $indicator.text('Open').removeClass('is-settled').addClass('is-open');
        }
        if (typeof window.updateOpenPoolBreadcrumbVisibility === 'function') {
            window.updateOpenPoolBreadcrumbVisibility();
        }
    };

    function navigateToDate(targetDate, preferredSubView) {
        if (!targetDate) return;
        setDailySettleSelectionMode(false);
        setOpenPoolSelectionMode(false);
        
        window.selectedSettlementDate = targetDate;
        if (preferredSubView === 'settled' || preferredSubView === 'open') {
            window.selectedSettlementSubView = preferredSubView;
        } else {
            window.selectedSettlementSubView = getDefaultSettlementSubView(targetDate);
        }
        
        var pickerEl = document.getElementById('settlement-date-picker');
        if (pickerEl && pickerEl._flatpickr) {
            pickerEl._flatpickr.setDate(targetDate, false);
        }
        
        updateNavigationButtons();
        if (typeof window.updateSettlementSubviewIndicator === 'function') {
            window.updateSettlementSubviewIndicator();
        }
        
        if (typeof window.updateSettleButtonState === 'function') {
            window.updateSettleButtonState();
        }
        
        if (typeof window.reloadGameListBySettlementDate === 'function') {
            window.reloadGameListBySettlementDate();
        }
    }
    window.navigateToDate = navigateToDate;
    
    // Previous button click handler
    $('#btn-settlement-prev').on('click', function() {
        var currentDate =
            window.selectedSettlementDate ||
            $('#settlement-date-wrapper .input-group').attr('data-initial-settlement-date') ||
            $('#settlement-date-wrapper .input-group').attr('data-today');
        if (isCurrentDate(currentDate) && hasSettlementForDate(currentDate) && window.selectedSettlementSubView !== 'settled') {
            navigateToDate(currentDate, 'settled');
            return;
        }
        var previousDate = getPreviousDate(currentDate);
        
        if (previousDate) {
            navigateToDate(previousDate, getDefaultSettlementSubView(previousDate));
        } else {
            var earliestDate = getEarliestSettlementDate();
            var formattedEarliest = earliestDate ? new Date(earliestDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'earliest settlement date';
            Swal.fire({
                icon: 'info',
                title: 'No Previous Date',
                text: 'You are already at the earliest settlement date (' + formattedEarliest + ').',
                confirmButtonText: 'OK',
                timer: 2000,
                showConfirmButton: false
            });
        }
    });
    
    // Next button click handler
    $('#btn-settlement-next').on('click', function() {
        var currentDate =
            window.selectedSettlementDate ||
            $('#settlement-date-wrapper .input-group').attr('data-initial-settlement-date') ||
            $('#settlement-date-wrapper .input-group').attr('data-today');
        if (isCurrentDate(currentDate) && hasSettlementForDate(currentDate) && window.selectedSettlementSubView === 'settled') {
            navigateToDate(currentDate, 'open');
            return;
        }
        var nextDate = getNextDate(currentDate);
        
        if (nextDate) {
            if (isCurrentDate(nextDate) && hasSettlementForDate(nextDate)) {
                navigateToDate(nextDate, 'settled');
            } else {
                navigateToDate(nextDate, getDefaultSettlementSubView(nextDate));
            }
        } else {
            Swal.fire({
                icon: 'info',
                title: 'No Next Date',
                text: 'You are already at the latest available date.',
                confirmButtonText: 'OK',
                timer: 2000,
                showConfirmButton: false
            });
        }
    });

    // Filter mode toggle handler
    $('input[name="filter-mode"]').on('change', function() {
        var mode = $(this).val();
        if (mode === 'settlement') {
            $('#settlement-date-wrapper').show();
            $('#daterange-wrapper').hide();
            if (typeof window.updateSettlementSubviewIndicator === 'function') window.updateSettlementSubviewIndicator();
            if (typeof window.reloadData === 'function') {
                window.reloadData();
            }
        } else {
            $('#settlement-date-wrapper').hide();
            $('#daterange-wrapper').show();
            setOpenPoolSelectionMode(false);
            if (typeof window.updateSettlementSubviewIndicator === 'function') window.updateSettlementSubviewIndicator();
            if (dateRangePicker && typeof dateRangePicker.clear === 'function') {
                dateRangePicker.clear();
            }
            clearGameListDisplay();
        }
    });
    
    // Initialize settlement date picker (single date mode)
    var settlementDatePicker = null;
    var settlementPickerElInit = document.getElementById('settlement-date-picker');
    if (settlementPickerElInit) {
        if (settlementPickerElInit._flatpickr) {
            settlementPickerElInit._flatpickr.destroy();
        }
        var now = new Date();
        var pad = function(n) { return String(n).padStart(2, '0'); };
        
        var wrapper = document.querySelector('#settlement-date-wrapper .input-group');
        var maxSettlementDate = null;
        if (wrapper) {
            maxSettlementDate = wrapper.getAttribute('data-max-settlement-date');
            var settledDatesRaw2 = wrapper.getAttribute('data-settled-dates');
            try {
                var parsedDates2 = settledDatesRaw2 ? JSON.parse(settledDatesRaw2) : [];
                if (!window.settledDatesForMonth || window.settledDatesForMonth.length === 0) {
                    window.settledDatesForMonth = parsedDates2;
                }
            } catch (e) {
                console.error('[Settlement Date Picker - Initialization] Error parsing settled dates:', e);
            }
        }
        
        var todayStr = getClientTodayYmd();
        var todayFromDom = wrapper && wrapper.getAttribute('data-today');
        var initialFromDom = wrapper && wrapper.getAttribute('data-initial-settlement-date');
        var initialDate = todayStr || initialFromDom || todayFromDom;
        
        window.selectedSettlementDate = initialDate;
        
        var fpMainOpts = {
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'F j, Y',
            defaultDate: initialDate,
            onChange: function(selectedDates, dateStr, instance) {
                if (selectedDates && selectedDates.length > 0) {
                    setDailySettleSelectionMode(false);
                    setOpenPoolSelectionMode(false);
                    window.selectedSettlementDate = dateStr;
                    window.selectedSettlementSubView = getDefaultSettlementSubView(dateStr);
                    
                    if (typeof window.updateNavigationButtons === 'function') {
                        window.updateNavigationButtons();
                    }
                    
                    if (typeof window.updateSettleButtonState === 'function') {
                        window.updateSettleButtonState();
                    }
                    if (typeof window.updateSettlementSubviewIndicator === 'function') {
                        window.updateSettlementSubviewIndicator();
                    }
                    
                    if (typeof window.reloadGameListBySettlementDate === 'function') {
                        window.reloadGameListBySettlementDate();
                    }
                }
            },
            onDayCreate: function (dayElem) {
                if (!dayElem || !dayElem.dateObj) return;
                var d = dayElem.dateObj;
                var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                var settledDates = window.settledDatesForMonth || [];
                if (dStr && settledDates.indexOf(dStr) !== -1) {
                    dayElem.classList.add('settled-day');
                }
            }
        };
        if (maxSettlementDate && String(maxSettlementDate).trim() !== '') {
            fpMainOpts.maxDate = maxSettlementDate;
        }
        settlementDatePicker = flatpickr("#settlement-date-picker", fpMainOpts);
    }

    // Initialize date range picker (single input with range mode)
    var dateRangePicker = null;
    if (document.getElementById('daterange-picker')) {
        var now = new Date();
        var pad = function(n) { return String(n).padStart(2, '0'); };
        
        // Get default settlement date (next settlement date) from wrapper
        var wrapper = document.querySelector('#settlement-date-wrapper .input-group');
        var defaultSettlementDate = null;
        if (wrapper) {
            defaultSettlementDate = wrapper.getAttribute('data-default-settlement-date');
            var settledDatesRaw = wrapper.getAttribute('data-settled-dates');
            try {
                var parsedDates = settledDatesRaw ? JSON.parse(settledDatesRaw) : [];
                // Make sure window.settledDatesForMonth is set if not already set
                if (!window.settledDatesForMonth || window.settledDatesForMonth.length === 0) {
                    window.settledDatesForMonth = parsedDates;
                }
            } catch (e) {
                console.error('[Date Range Picker - Initialization] Error parsing settled dates:', e);
            }
        }
        
        // Default date range: All settlements for the current month.
        // If walang settlement this month, fallback to previous behavior.
        var settledDates = window.settledDatesForMonth || [];
        var defaultFromDate;
        var defaultToDate;
        
        if (settledDates.length > 0) {
            var currentYear = now.getFullYear();
            var currentMonth = now.getMonth() + 1; // 1-12
            
            // Filter settled dates to current month/year
            var settledDatesThisMonth = settledDates.filter(function (d) {
                if (typeof d !== 'string' || d.length < 7) return false;
                var parts = d.split('-');
                if (parts.length < 2) return false;
                var y = parseInt(parts[0], 10);
                var m = parseInt(parts[1], 10);
                if (isNaN(y) || isNaN(m)) return false;
                return y === currentYear && m === currentMonth;
            });
            
            var datesToUse = settledDatesThisMonth.length > 0 ? settledDatesThisMonth : settledDates;
            var sortedDates = datesToUse.slice().sort();
            
            // From Date: First settlement date in the chosen set
            defaultFromDate = sortedDates[0];
            
            // To Date: Next settlement date (defaultSettlementDate) if available,
            // otherwise next day after last settlement in the chosen set.
            var lastSettlementDate = sortedDates[sortedDates.length - 1];
            var lastDate = new Date(lastSettlementDate + 'T12:00:00');
            var nextDayAfterLast = new Date(lastDate);
            nextDayAfterLast.setDate(nextDayAfterLast.getDate() + 1);
            var nextDayAfterLastStr = nextDayAfterLast.getFullYear() + '-' + pad(nextDayAfterLast.getMonth() + 1) + '-' + pad(nextDayAfterLast.getDate());
            
            defaultToDate = defaultSettlementDate || nextDayAfterLastStr;
        } else {
            // Fallback: First of current month to today (or default settlement date)
            var firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            defaultFromDate = firstOfMonth.getFullYear() + '-' + pad(firstOfMonth.getMonth() + 1) + '-' + pad(firstOfMonth.getDate());
            var todayStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
            defaultToDate = defaultSettlementDate || todayStr;
        }

        var dateRangeElInit = document.getElementById('daterange-picker');
        if (dateRangeElInit && dateRangeElInit._flatpickr) {
            dateRangeElInit._flatpickr.destroy();
        }

        var dateRangeVisibleStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);

        dateRangePicker = flatpickr("#daterange-picker", {
            mode: 'range',
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'M d, Y',
            showMonths: 3,
            defaultMonth: dateRangeVisibleStart,
            defaultDate: [],
            onReady: function (selectedDates, dateStr, instance) {
                var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
                if (filterMode === 'daterange' && selectedDates && selectedDates.length === 2 && typeof window.reloadData === 'function') {
                    setTimeout(function() {
                        window.reloadData();
                    }, 200);
                }
            },
            onOpen: function (selectedDates, dateStr, instance) {
                var anchor = new Date();
                instance.jumpToDate(new Date(anchor.getFullYear(), anchor.getMonth() - 2, 1), false);
            },
            onChange: function(selectedDates, dateStr, instance) {
                if (selectedDates && selectedDates.length === 2 && typeof window.reloadData === 'function') {
                    window.reloadData();
                }
            }
        });
    }

    var didRestoreDailySettleSession = false;
    try {
        var restoredDailySettleView = window.sessionStorage ? window.sessionStorage.getItem('dailySettleViewState') : null;
        if (restoredDailySettleView) {
            var parsedDailySettleView = JSON.parse(restoredDailySettleView);
            if (parsedDailySettleView && /^\d{4}-\d{2}-\d{2}$/.test(String(parsedDailySettleView.date || ''))) {
                window.selectedSettlementDate = parsedDailySettleView.date;
                window.selectedSettlementSubView = parsedDailySettleView.subView === 'open' ? 'open' : 'settled';
                didRestoreDailySettleSession = true;
                var restoredPickerEl = document.getElementById('settlement-date-picker');
                if (restoredPickerEl && restoredPickerEl._flatpickr) {
                    restoredPickerEl._flatpickr.setDate(parsedDailySettleView.date, false);
                }
            }
            window.sessionStorage.removeItem('dailySettleViewState');
        }
    } catch (e) {}
    if (!didRestoreDailySettleSession) {
        window.selectedSettlementDate = getClientTodayYmd();
    }
    if (!didRestoreDailySettleSession && typeof getDefaultSettlementSubView === 'function' && window.selectedSettlementDate) {
        window.selectedSettlementSubView = getDefaultSettlementSubView(window.selectedSettlementDate);
    }

    reloadData();
    if (typeof window.updateSettleButtonState === 'function') window.updateSettleButtonState();
    if (typeof window.updateNavigationButtons === 'function') window.updateNavigationButtons();
    if (typeof window.updateSettlementSubviewIndicator === 'function') window.updateSettlementSubviewIndicator();

    function getSelectedGamesForDailySettle() {
        var ids = [];
        $('.daily-settle-checkbox:checked').each(function () {
            var v = parseInt($(this).val(), 10);
            if (!isNaN(v) && ids.indexOf(v) === -1) ids.push(v);
        });
        return ids;
    }

    function runSettlementTransferRequest(payload, selectedGameIds, $btn) {
        $.ajax({
            url: '/game_list/daily_settlement/transfer',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            success: function (res) {
                var d = (res && res.settlement_date) || payload.settlement_date || '';
                var formatted = d
                    ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric'
                      })
                    : d;
                var successText =
                    (res.game_count || selectedGameIds.length) +
                    ' game(s) assigned to settlement date ' +
                    formatted +
                    '.';
                Swal.fire({
                    title: 'Done',
                    text: successText,
                    icon: 'success',
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#0d6efd'
                }).then(function () {
                    try {
                        var targetDate = (res && res.settlement_date) || payload.settlement_date || '';
                        if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate).slice(0, 10)) && window.sessionStorage) {
                            window.sessionStorage.setItem(
                                'dailySettleViewState',
                                JSON.stringify({ date: String(targetDate).slice(0, 10), subView: 'settled' })
                            );
                        }
                    } catch (e) {}
                    window.location.reload();
                });
            },
            error: function (xhr) {
                var err = (xhr.responseJSON && xhr.responseJSON.error) || 'Transfer failed';
                console.error('[Settlement transfer] error:', err, xhr);
                Swal.fire({
                    title: 'Error',
                    text: err,
                    icon: 'error',
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#0d6efd'
                });
            },
            complete: function () {
                $btn.prop('disabled', false);
                if (typeof window.updateSettleButtonState === 'function') window.updateSettleButtonState();
            }
        });
    }

    $('#btn-daily-settle').on('click', function () {
        if ($(this).prop('disabled')) return;
        var fallbackDate = window.selectedSettlementDate || new Date().toISOString().slice(0, 10);
        var settlementDate = window.dailySettleTargetDate || fallbackDate;
        var formattedDate = settlementDate
            ? new Date(settlementDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : settlementDate;
        var selectedGameIds = getSelectedGamesForDailySettle();
        var $btn = $(this);
        var baseMessage = 'Assign ' + selectedGameIds.length + ' selected game(s) to ' + formattedDate + '?';

        if (!window.isDailySettleSelectionMode) {
            var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
            if (filterMode !== 'settlement') {
                Swal.fire({
                    title: 'Settlement Date mode required',
                    text: 'Switch to Settlement Date mode first.',
                    icon: 'warning',
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#0d6efd'
                });
                return;
            }
            if (Array.isArray(window.lastSettlementRows)) {
                var eligibleRows = window.lastSettlementRows.filter(function (row) {
                    var active = parseInt(row.ACTIVE, 10);
                    return active === 1 || active === 2 || active === 3;
                });
                if (eligibleRows.length === 0) {
                    Swal.fire({
                        title: 'No games',
                        text: 'No active games in the current list to assign.',
                        icon: 'info',
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#0d6efd'
                    });
                    return;
                }
            }
            if (window.isMergeSettleMode) {
                window.isMergeSettleMode = false;
                updateMergeSettleButtonState();
            }
            setDailySettleSelectionMode(true);
            if (typeof window.reloadGameListBySettlementDate === 'function') {
                window.reloadGameListBySettlementDate();
            }
            setTimeout(function () {
                var hasCheckboxes = $('.daily-settle-checkbox').length > 0;
                if (!hasCheckboxes && window.isDailySettleSelectionMode) {
                    setDailySettleSelectionMode(false);
                    Swal.fire({
                        title: 'No End Games',
                        text: 'No end games to settle yet. Games still ON GAME cannot be daily settled.',
                        icon: 'info',
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#0d6efd'
                    });
                }
            }, 350);
            return;
        }

        if (selectedGameIds.length === 0) {
            setDailySettleSelectionMode(false);
            if (typeof window.reloadGameListBySettlementDate === 'function') {
                window.reloadGameListBySettlementDate();
            }
            return;
        }

        var swalWrapper = document.querySelector('#settlement-date-wrapper .input-group');
        var todayStr = (swalWrapper && swalWrapper.getAttribute('data-today')) || new Date().toISOString().slice(0, 10);
        var nowForMin = new Date();
        var minDateObj = new Date(nowForMin.getFullYear() - 1, 0, 1);
        var minAllowedDate =
            minDateObj.getFullYear() +
            '-' +
            String(minDateObj.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(minDateObj.getDate()).padStart(2, '0');
        var initialDate = window.dailySettleTargetDate || fallbackDate || todayStr;
        window._swalSettlementTransferFp = null;

        Swal.fire({
            title: 'Assign settlement date',
            html:
                '<div class="text-start">' +
                '<div class="d-flex align-items-center gap-2">' +
                '<label for="swal-settlement-date" class="form-label mb-0" style="white-space: nowrap;">Date:</label>' +
                '<input id="swal-settlement-date" class="form-control text-center" readonly />' +
                '</div>' +
                '</div>',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Continue',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#0d6efd',
            cancelButtonColor: '#6c757d',
            didOpen: function () {
                var inputEl = document.getElementById('swal-settlement-date');
                if (!inputEl) return;
                if (window.flatpickr) {
                    window._swalSettlementTransferFp = flatpickr(inputEl, {
                        dateFormat: 'Y-m-d',
                        altInput: true,
                        altFormat: 'F d, Y',
                        defaultDate: initialDate,
                        minDate: minAllowedDate,
                        allowInput: false
                    });
                }
            },
            preConfirm: function () {
                var fp = window._swalSettlementTransferFp;
                var chosenDate = '';
                if (fp && fp.selectedDates && fp.selectedDates[0]) {
                    var d = fp.selectedDates[0];
                    chosenDate =
                        d.getFullYear() +
                        '-' +
                        String(d.getMonth() + 1).padStart(2, '0') +
                        '-' +
                        String(d.getDate()).padStart(2, '0');
                }
                if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenDate)) {
                    Swal.showValidationMessage('Please select a valid settlement date.');
                    return false;
                }
                return { settlement_date: chosenDate };
            }
        }).then(function (dateResult) {
            if (!dateResult.isConfirmed) return;
            var choice = dateResult.value;
            if (!choice || typeof choice !== 'object') return;

            settlementDate = choice.settlement_date;
            formattedDate = settlementDate
                ? new Date(settlementDate + 'T12:00:00').toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                  })
                : settlementDate;
            baseMessage = 'Assign ' + selectedGameIds.length + ' game(s) to settlement date ' + formattedDate + '?';

            Swal.fire({
                title: 'Confirm',
                text: baseMessage,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#0d6efd',
                cancelButtonColor: '#6c757d'
            }).then(function (confirmResult) {
                if (!confirmResult.isConfirmed) return;
                $btn.prop('disabled', true);
                var payload = { game_ids: selectedGameIds };
                payload.settlement_date = choice.settlement_date;
                runSettlementTransferRequest(payload, selectedGameIds, $btn);
            });
        });
    });

    $('#btn-breadcrumb-open-pool').on('click', function (e) {
        e.preventDefault();
        var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
        if (filterMode !== 'settlement') {
            Swal.fire({
                title: 'Settlement Date mode required',
                text: 'Switch to Settlement Date mode first.',
                icon: 'warning',
                confirmButtonText: 'OK',
                confirmButtonColor: '#0d6efd'
            });
            return;
        }
        var wrapperTodayEl = document.querySelector('#settlement-date-wrapper .input-group');
        var dataTodayYmd =
            (wrapperTodayEl && wrapperTodayEl.getAttribute('data-today')) ||
            getClientTodayYmd();
        var selectedYmd = String(window.selectedSettlementDate || '').slice(0, 10);
        var isTodaySettledView =
            /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd) &&
            selectedYmd === String(dataTodayYmd).slice(0, 10) &&
            window.selectedSettlementSubView === 'settled';

        if (!isTodaySettledView) {
            Swal.fire({
                title: 'Today settled only',
                html: 'Set the picker to <strong>today</strong>, open the <strong>Settled</strong> list, then click <strong>OPEN</strong>.',
                icon: 'info',
                confirmButtonText: 'OK',
                confirmButtonColor: '#0d6efd'
            });
            return;
        }

        if (!window.isOpenPoolSelectionMode) {
            setOpenPoolSelectionMode(true);
            if (typeof window.reloadGameListBySettlementDate === 'function') {
                window.reloadGameListBySettlementDate();
            }
            setTimeout(function () {
                var hasCb = $('.open-pool-checkbox').length > 0;
                if (!hasCb && window.isOpenPoolSelectionMode) {
                    setOpenPoolSelectionMode(false);
                    Swal.fire({
                        title: 'No games',
                        text: "No rows in today's settled list.",
                        icon: 'info',
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#0d6efd'
                    });
                    if (typeof window.reloadGameListBySettlementDate === 'function') {
                        window.reloadGameListBySettlementDate();
                    }
                }
            }, 400);
            return;
        }

        var selectedIds = [];
        $('.open-pool-checkbox:checked').each(function () {
            var v = parseInt($(this).val(), 10);
            if (!isNaN(v) && selectedIds.indexOf(v) === -1) {
                selectedIds.push(v);
            }
        });

        if (selectedIds.length === 0) {
            setOpenPoolSelectionMode(false);
            if (typeof window.reloadGameListBySettlementDate === 'function') {
                window.reloadGameListBySettlementDate();
            }
            return;
        }

        Swal.fire({
            title: 'Return to open pool?',
            text:
                'Move ' +
                selectedIds.length +
                ' game(s) to Open?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#0d6efd',
            cancelButtonColor: '#6c757d'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            var $lnk = $('#btn-breadcrumb-open-pool');
            $lnk.css('pointer-events', 'none').css('opacity', '0.65');
            $.ajax({
                url: '/game_list/daily_settlement/release',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ game_ids: selectedIds }),
                success: function (res) {
                    var n = (res && res.game_count) || selectedIds.length;
                    Swal.fire({
                        title: 'Done',
                        text: n + ' game(s) returned to the open pool.',
                        icon: 'success',
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#0d6efd'
                    }).then(function () {
                        try {
                            var wrapperEl = document.querySelector('#settlement-date-wrapper .input-group');
                            var dateStr = String(
                                window.selectedSettlementDate ||
                                    (wrapperEl && wrapperEl.getAttribute('data-today')) ||
                                    ''
                            ).slice(0, 10);
                            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && window.sessionStorage) {
                                window.sessionStorage.setItem(
                                    'dailySettleViewState',
                                    JSON.stringify({ date: dateStr, subView: 'open' })
                                );
                            }
                        } catch (e) {}
                        window.location.reload();
                    });
                },
                error: function (xhr) {
                    var err = (xhr.responseJSON && xhr.responseJSON.error) || 'Request failed';
                    Swal.fire({ title: 'Error', text: err, icon: 'error', confirmButtonColor: '#0d6efd' });
                },
                complete: function () {
                    $lnk.css('pointer-events', '').css('opacity', '');
                }
            });
        });
    });

// Function to format numbers with commas
function formatNumberWithCommas(number) {
	return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
$('#add_game_list').submit(function (event) {
    event.preventDefault(); // Prevent the default form submission

    var $btn = $('#submit-game-list-btn'); // Reference to the submit button
    var gameDateEl = document.getElementById('txtGameEncodedDate');
    var gameDateVal = ($('#txtGameEncodedDate').val() || '').trim();
    if (gameDateVal && !/^\d{4}-\d{2}-\d{2}$/.test(gameDateVal)) {
        Swal.fire({
            title: 'Invalid date',
            text: 'Please use YYYY-MM-DD or choose from the calendar.',
            icon: 'error',
            confirmButtonText: 'OK'
        });
        return;
    }
    if (!gameDateVal) {
        var today = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        gameDateVal = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
        $('#txtGameEncodedDate').val(gameDateVal);
        if (gameDateEl && gameDateEl._flatpickr) {
            gameDateEl._flatpickr.setDate(gameDateVal, false);
        }
    }
    $btn.prop('disabled', true).html(`
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
        Loading...
    `); // Disable button immediately

    // Retrieve values and trim them
    var nnChips = $('#txtNN').val().trim();
    var ccChips = $('#txtCC').val().trim();
    var transType = $('input[name="txtTransType"]:checked').val(); // Get the selected transaction type
    var commissionTypeSelected = $('#commissionType').val() !== ''; // Check if commission type is selected
    var txtNNamount = parseFloat(nnChips.replace(/,/g, '')) || 0; // Convert NN Chips to number
    var txtCCamount = parseFloat(ccChips.replace(/,/g, '')) || 0; // Convert CC Chips to number
    var totalBalanceGuest1 = $('#total_balanceGuest1').val().replace(/,/g, '').trim();
    var splitEnabled = $('#enableSplitNewGame').is(':checked');

    if (splitEnabled) {
        var parseSplitNum = function (selector) {
            var v = ($(selector).val() || '').toString().replace(/,/g, '').trim();
            return v === '' ? 0 : parseFloat(v);
        };

        var splitCashNN = parseSplitNum('#splitCashNN');
        var splitCashCC = parseSplitNum('#splitCashCC');
        var splitDepNN = parseSplitNum('#splitDepNN');
        var splitDepCC = parseSplitNum('#splitDepCC');
        var splitCreditNN = parseSplitNum('#splitCreditNN');
        var splitCreditCC = parseSplitNum('#splitCreditCC');

        var splitValues = [splitCashNN, splitCashCC, splitDepNN, splitDepCC, splitCreditNN, splitCreditCC];
        var splitSelectors = ['#splitCashNN', '#splitCashCC', '#splitDepNN', '#splitDepCC', '#splitCreditNN', '#splitCreditCC'];
        splitSelectors.forEach(function (sel) { $(sel).removeClass('is-invalid'); });

        if (splitValues.some(function (n) { return !Number.isFinite(n) || n < 0; })) {
            Swal.fire({ title: 'Invalid Input', text: 'Please enter valid split amounts.', icon: 'error', confirmButtonText: 'OK' });
            $btn.prop('disabled', false).text('Submit');
            return;
        }
        if ((splitCashNN > 0 && splitCashNN % 1000 !== 0) || (splitDepNN > 0 && splitDepNN % 1000 !== 0) || (splitCreditNN > 0 && splitCreditNN % 1000 !== 0)) {
            if (splitCashNN > 0 && splitCashNN % 1000 !== 0) $('#splitCashNN').addClass('is-invalid');
            if (splitDepNN > 0 && splitDepNN % 1000 !== 0) $('#splitDepNN').addClass('is-invalid');
            if (splitCreditNN > 0 && splitCreditNN % 1000 !== 0) $('#splitCreditNN').addClass('is-invalid');
            Swal.fire({ title: 'Invalid NN Chips amount', text: 'NN split amounts must be in thousands (e.g. 1,000 / 2,000 / 3,000).', icon: 'error', confirmButtonText: 'OK' });
            $btn.prop('disabled', false).text('Submit');
            return;
        }

        var cashLegTotal = splitCashNN + splitCashCC;
        var depLegTotal = splitDepNN + splitDepCC;
        var creditLegTotal = splitCreditNN + splitCreditCC;
        var splitTotal = cashLegTotal + depLegTotal + creditLegTotal;

        if (splitTotal <= 0) {
            Swal.fire({ title: 'Warning', text: 'Please enter at least one split amount.', icon: 'warning', confirmButtonText: 'OK' });
            $btn.prop('disabled', false).text('Submit');
            return;
        }
        if (depLegTotal > (parseFloat(totalBalanceGuest1) || 0)) {
            Swal.fire({
                title: 'Insufficient Balance',
                text: 'Deposit split exceeds available total balance of ₱' + formatNumberWithCommas(totalBalanceGuest1),
                icon: 'error',
                confirmButtonText: 'OK'
            });
            $btn.prop('disabled', false).text('Submit');
            return;
        }
        if (!commissionTypeSelected) {
            Swal.fire({ title: 'Warning', text: 'Please select a Commission Type.', icon: 'warning', confirmButtonText: 'OK' });
            $btn.prop('disabled', false).text('Submit');
            return;
        }

        var gameType = $('input[name="txtGameType"]:checked').val() || '';
        var accountCode = $('#txtTrans').val() || '';
        var accountText = $('#txtTrans option:selected').text() || accountCode;
        var guestIdSelected = $('#txtGuestGame').val() || '';
        var guestText = $('#txtGuestGame option:selected').text() || '';
        var rollerNN = $('#txtRollerNN').val().trim();
        var rollerCC = $('#txtRollerCC').val().trim();
        var rollerNNAmount = parseFloat(rollerNN.replace(/,/g, '')) || 0;
        var rollerCCAmount = parseFloat(rollerCC.replace(/,/g, '')) || 0;
        var commissionTypeText = $('#commissionType option:selected').text() || '';
        var commissionRate = $('#commissionRate').val() || '0';

        var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;white-space:nowrap;';
        var valueStyle = 'padding:4px 0 4px 0;text-align:left;';
        var buildRow = function (label, value) {
            return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
        };
        var rows = '';
        rows += buildRow('Game date:', gameDateVal || '-');
        rows += buildRow('Game Type:', gameType || '-');
        rows += buildRow('Account:', accountText || '-');
        if (guestIdSelected) {
            rows += buildRow('Guest:', guestText || '-');
        }
        if (splitCashNN > 0) rows += buildRow('Cash (NN):', splitCashNN.toLocaleString());
        if (splitCashCC > 0) rows += buildRow('Cash (CC):', splitCashCC.toLocaleString());
        if (splitDepNN > 0) rows += buildRow('Deposit (NN):', splitDepNN.toLocaleString());
        if (splitDepCC > 0) rows += buildRow('Deposit (CC):', splitDepCC.toLocaleString());
        if (splitCreditNN > 0) rows += buildRow('Credit (NN):', splitCreditNN.toLocaleString());
        if (splitCreditCC > 0) rows += buildRow('Credit (CC):', splitCreditCC.toLocaleString());
        rows += buildRow('Total Amount:', splitTotal.toLocaleString());
        rows += buildRow('Commission Type:', commissionTypeText || '-');
        if (parseFloat(commissionRate) > 0) rows += buildRow('Commission Rate:', `${commissionRate}%`);

        var splitConfirmation = `
            <div style="max-width:420px;margin:0 auto;text-align:center;">
                <table style="margin:0 auto;border-collapse:collapse;min-width:260px;">
                    ${rows}
                </table>
            </div>
        `;

        Swal.fire({
            icon: 'question',
            title: 'Confirm New Game',
            html: splitConfirmation + '<div style="margin-top:12px;">Are you sure you want to proceed?</div>',
            showCancelButton: true,
            confirmButtonText: 'Yes, Confirm',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            allowOutsideClick: false,
            allowEscapeKey: false,
            width: '500px'
        }).then(function (result) {
            if (!result.isConfirmed) {
                $btn.prop('disabled', false).text('Submit');
                return;
            }

            var payload = {
                txtAccountCode: $('#txtTrans').val(),
                txtGuestId: $('#txtGuestId').val(),
                txtGameType: $('input[name="txtGameType"]:checked').val(),
                txtRollerNN: $('#txtRollerNN').val(),
                txtRollerCC: $('#txtRollerCC').val(),
                txtCommisionType: $('#commissionType').val(),
                txtCommisionRate: $('#commissionRate').val(),
                totalBalanceGuest1: $('#total_balanceGuest1').val(),
                txtGameEncodedDate: gameDateVal,
                split_cash_nn: splitCashNN,
                split_cash_cc: splitCashCC,
                split_dep_nn: splitDepNN,
                split_dep_cc: splitDepCC,
                split_credit_nn: splitCreditNN,
                split_credit_cc: splitCreditCC
            };

            $.ajax({
                url: '/add_game_list_split',
                type: 'POST',
                data: payload,
                success: function () {
                    Swal.fire({
                        icon: 'success',
                        title: 'Success!',
                        text: 'New game successfully added.',
                        confirmButtonText: 'OK',
                        allowOutsideClick: false,
                        allowEscapeKey: false
                    }).then(function (swalResult) {
                        if (swalResult.isConfirmed) {
                            $('#modal-new-game-list').modal('hide');
                            if (window.location.pathname === '/agency') {
                                $(document).trigger('agency:new-game-saved');
                            } else {
                                reloadData();
                                window.location.reload();
                            }
                        }
                    });
                },
                error: function (xhr) {
                    var errorMessage = xhr.responseJSON?.error || "An error occurred.";
                    Swal.fire({ icon: 'error', title: 'Error', text: errorMessage, confirmButtonText: 'OK' });
                    $btn.prop('disabled', false).text('Submit');
                }
            });
        });
        return;
    }

    // Enforce NN Chips as positive thousands (1,000 / 2,000 / 3,000 ...) when provided
    var nnDigits = nnChips.replace(/,/g, '');
    var nnTrimmed = nnDigits.trim();
    if (nnTrimmed !== '' && (txtNNamount <= 0 || txtNNamount % 1000 !== 0)) {
        Swal.fire({
            title: 'Invalid NN Chips amount',
            text: 'NN Chips amount must be in thousands (e.g. 1,000 / 2,000 / 3,000).',
            icon: 'error',
            confirmButtonText: 'OK'
        });

        $btn.prop('disabled', false).text('Submit'); // Re-enable button
        return;
    }

    // Check if the required fields are filled
    if ((nnChips === '' && ccChips === '') || !transType || !commissionTypeSelected) {
        // Build the warning message based on what's missing
        let message = 'Please fill in the required fields: ';
        if (nnChips === '' && ccChips === '') {
            message += 'NN Chips or CC Chips, ';
        }
        if (!transType) {
            message += 'Transaction Type, ';
        }
        if (!commissionTypeSelected) {
            message += 'Commission Type.';
        }

        // Show SweetAlert for missing fields
        Swal.fire({
            title: 'Warning',
            text: message.slice(0, -2) + '!', // Remove the last comma and space
            icon: 'warning',
            confirmButtonText: 'OK'
        });

        $btn.prop('disabled', false).text('Submit'); // Re-enable button
    } else if (transType == 2 && (txtNNamount + txtCCamount) > totalBalanceGuest1) {
        // If Transaction Type is 2, check if the sum of NN and CC exceeds the total balance
        Swal.fire({
            title: 'Insufficient Balance',
            text: 'The amount exceeds the available total balance of ₱' + formatNumberWithCommas(totalBalanceGuest1),
            icon: 'error',
            confirmButtonText: 'OK'
        });

        $btn.prop('disabled', false).text('Submit'); // Re-enable button
    } else {
        // All validations passed, show confirmation dialog
        var gameType = $('input[name="txtGameType"]:checked').val() || '';
        var accountCode = $('#txtTrans').val() || '';
        var accountText = $('#txtTrans option:selected').text() || accountCode;
        var rollerNN = $('#txtRollerNN').val().trim();
        var rollerCC = $('#txtRollerCC').val().trim();
        var rollerNNAmount = parseFloat(rollerNN.replace(/,/g, '')) || 0;
        var rollerCCAmount = parseFloat(rollerCC.replace(/,/g, '')) || 0;
        var commissionType = $('#commissionType').val() || '';
        var commissionTypeText = $('#commissionType option:selected').text() || '';
        var commissionRate = $('#commissionRate').val() || '0';

        // Enforce Roller NN Chips as positive thousands when provided
        var rollerNNDigits = rollerNN.replace(/,/g, '');
        var rollerNNTrimmed = rollerNNDigits.trim();
        if (rollerNNTrimmed !== '' && (rollerNNAmount <= 0 || rollerNNAmount % 1000 !== 0)) {
            Swal.fire({
                title: 'Invalid Roller NN Chips amount',
                text: 'Roller NN Chips amount must be in thousands (e.g. 1,000 / 2,000 / 3,000).',
                icon: 'error',
                confirmButtonText: 'OK'
            });

            $btn.prop('disabled', false).text('Submit'); // Re-enable button
            return;
        }

        var transTypeText = '';
        if (transType == '1') transTypeText = 'Cash';
        else if (transType == '2') transTypeText = 'Deposit';
        else if (transType == '3') transTypeText = 'Credit';

        var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;white-space:nowrap;';
        var valueStyle = 'padding:4px 0 4px 0;text-align:left;';
        var buildRow = function (label, value) {
            return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
        };

        var confirmationRows = '';
        confirmationRows += buildRow('Game date:', gameDateVal || '-');
        confirmationRows += buildRow('Game Type:', gameType || '-');
        confirmationRows += buildRow('Account:', accountText || '-');
        var guestIdSelected = $('#txtGuestGame').val() || '';
        var guestText = $('#txtGuestGame option:selected').text() || '';
        if (guestIdSelected) {
            confirmationRows += buildRow('Guest:', guestText || '-');
        }

        if (txtNNamount > 0) {
            confirmationRows += buildRow('NN Chips:', parseFloat(txtNNamount).toLocaleString());
        }
        if (txtCCamount > 0) {
            confirmationRows += buildRow('CC Chips:', parseFloat(txtCCamount).toLocaleString());
        }
        if (txtNNamount > 0 || txtCCamount > 0) {
            confirmationRows += buildRow('Total Amount:', parseFloat(txtNNamount + txtCCamount).toLocaleString());
        }

        confirmationRows += buildRow('Payment Type:', transTypeText || '-');

        if (rollerNNAmount > 0 || rollerCCAmount > 0) {
            var rollerParts = [];
            if (rollerNNAmount > 0) rollerParts.push(`NN: ${parseFloat(rollerNNAmount).toLocaleString()}`);
            if (rollerCCAmount > 0) rollerParts.push(`CC: ${parseFloat(rollerCCAmount).toLocaleString()}`);
            confirmationRows += buildRow('Roller Chips:', rollerParts.join('<br>'));
        }

        confirmationRows += buildRow('Commission Type:', commissionTypeText || '-');
        if (commissionRate > 0) {
            confirmationRows += buildRow('Commission Rate:', `${commissionRate}%`);
        }

        var confirmationMessage = `
            <div style="max-width:420px;margin:0 auto;text-align:center;">
                <table style="margin:0 auto;border-collapse:collapse;min-width:260px;">
                    ${confirmationRows}
                </table>
            </div>
        `;

        var $form = $(this); // Store form reference

        Swal.fire({
            icon: 'question',
            title: 'Confirm New Game',
            html: confirmationMessage + '<div style="margin-top:12px;">Are you sure you want to proceed?</div>',
            showCancelButton: true,
            confirmButtonText: 'Yes, Confirm',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            allowOutsideClick: false,
            allowEscapeKey: false,
            width: '500px'
        }).then((result) => {
            if (result.isConfirmed) {
                // User confirmed, proceed with transaction
                $btn.prop('disabled', true).html(`
                    <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    Loading...
                `);

                var formData = $form.serialize();

                $.ajax({
                    url: '/add_game_list',
                    type: 'POST',
                    data: formData,
                    success: function (response) {
                        // Show success message
                        Swal.fire({
                            icon: 'success',
                            title: 'Success!',
                            text: 'New game successfully added.',
                            confirmButtonText: 'OK',
                            allowOutsideClick: false,
                            allowEscapeKey: false
                        }).then((result) => {
                            if (result.isConfirmed) {
                                $('#modal-new-game-list').modal('hide'); // Close modal
                                if (window.location.pathname === '/agency') {
                                    $(document).trigger('agency:new-game-saved');
                                } else {
                                    reloadData(); // Reload data after confirmation
                                    window.location.reload(); // Refresh page
                                }
                            }
                        });
                    },
                    error: function (xhr, status, error) {
                        var errorMessage = xhr.responseJSON?.error || xhr.responseText || "An error occurred.";
                        console.error('Error adding game list:', errorMessage);

                        // Show error message
                        Swal.fire({
                            icon: 'error',
                            title: 'Error',
                            text: errorMessage,
                            confirmButtonText: 'OK'
                        });

                        $btn.prop('disabled', false).text('Submit'); // Re-enable button after error
                    }
                });
            } else {
                // User cancelled, re-enable button
                $btn.prop('disabled', false).text('Submit');
            }
        });
    }
});

	
$('#add_buyin').submit(function (event) {
	event.preventDefault(); // Prevent the default form submission

	const $btn = $('#submit-buyin-btn'); // Reference to the submit button
	$btn.prop('disabled', true).html(`
		<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
		Loading...
	`);

	const nnChips = $('.txtNN').val().trim();
	const ccChips = $('.txtCC').val().trim();
	const transType = $('input[name="txtTransType"]:checked').val(); // Get selected type
	const transTypeSelected = !!transType;

	const totalBalanceGuest2 = $('#total_balanceGuest2').val().replace(/,/g, '').trim();
	const splitEnabled = $('#enableSplitBuyin').is(':checked');

	if (splitEnabled) {
		const parseSplitNum = function (selector) {
			const v = ($(selector).val() || '').toString().replace(/,/g, '').trim();
			return v === '' ? 0 : parseFloat(v);
		};
		const cashNN = parseSplitNum('#splitBuyinCashNN');
		const cashCC = parseSplitNum('#splitBuyinCashCC');
		const depNN = parseSplitNum('#splitBuyinDepNN');
		const depCC = parseSplitNum('#splitBuyinDepCC');
		const creditNN = parseSplitNum('#splitBuyinCreditNN');
		const creditCC = parseSplitNum('#splitBuyinCreditCC');
		const splitValues = [cashNN, cashCC, depNN, depCC, creditNN, creditCC];
		['#splitBuyinCashNN', '#splitBuyinCashCC', '#splitBuyinDepNN', '#splitBuyinDepCC', '#splitBuyinCreditNN', '#splitBuyinCreditCC']
			.forEach(function (s) { $(s).removeClass('is-invalid'); });

		if (splitValues.some(function (n) { return !Number.isFinite(n) || n < 0; })) {
			Swal.fire({ title: 'Invalid Input', text: 'Please enter valid split amounts.', icon: 'error', confirmButtonText: 'OK' });
			$btn.prop('disabled', false).text('Submit');
			return;
		}
		if ((cashNN > 0 && cashNN % 1000 !== 0) || (depNN > 0 && depNN % 1000 !== 0) || (creditNN > 0 && creditNN % 1000 !== 0)) {
			if (cashNN > 0 && cashNN % 1000 !== 0) $('#splitBuyinCashNN').addClass('is-invalid');
			if (depNN > 0 && depNN % 1000 !== 0) $('#splitBuyinDepNN').addClass('is-invalid');
			if (creditNN > 0 && creditNN % 1000 !== 0) $('#splitBuyinCreditNN').addClass('is-invalid');
			Swal.fire({ title: 'Invalid NN Chips amount', text: 'NN split amounts must be in thousands (e.g. 1,000 / 2,000 / 3,000).', icon: 'error', confirmButtonText: 'OK' });
			$btn.prop('disabled', false).text('Submit');
			return;
		}

		const cashTotal = cashNN + cashCC;
		const depTotal = depNN + depCC;
		const creditTotal = creditNN + creditCC;
		const splitTotal = cashTotal + depTotal + creditTotal;
		if (splitTotal <= 0) {
			Swal.fire({ title: 'Warning', text: 'Please enter at least one split amount.', icon: 'warning', confirmButtonText: 'OK' });
			$btn.prop('disabled', false).text('Submit');
			return;
		}
		if (depTotal > (parseFloat(totalBalanceGuest2) || 0)) {
			Swal.fire({
				title: 'Insufficient Balance',
				text: 'Deposit split exceeds available total balance of ₱' + formatNumberWithCommas(totalBalanceGuest2),
				icon: 'error',
				confirmButtonText: 'OK'
			});
			$btn.prop('disabled', false).text('Submit');
			return;
		}

		var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;white-space:nowrap;';
		var valueStyle = 'padding:4px 0 4px 0;text-align:left;';
		var buildRow = function (label, value) {
			return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
		};
		var rows = '';
		if (cashNN > 0) rows += buildRow('Cash (NN):', cashNN.toLocaleString());
		if (cashCC > 0) rows += buildRow('Cash (CC):', cashCC.toLocaleString());
		if (depNN > 0) rows += buildRow('Deposit (NN):', depNN.toLocaleString());
		if (depCC > 0) rows += buildRow('Deposit (CC):', depCC.toLocaleString());
		if (creditNN > 0) rows += buildRow('Credit (NN):', creditNN.toLocaleString());
		if (creditCC > 0) rows += buildRow('Credit (CC):', creditCC.toLocaleString());
		rows += buildRow('Total Amount:', splitTotal.toLocaleString());

		Swal.fire({
			icon: 'question',
			title: 'Confirm Transaction',
			html: `<div style="max-width:420px;margin:0 auto;text-align:left;"><div style="font-weight:600;margin-bottom:8px;text-align:center;">Confirm Buy In Transaction:</div><table style="margin:0 auto;border-collapse:collapse;min-width:260px;">${rows}</table></div><div style="margin-top:12px;">Are you sure you want to proceed?</div>`,
			showCancelButton: true,
			confirmButtonText: 'Yes, Confirm',
			cancelButtonText: 'Cancel',
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			allowOutsideClick: false,
			allowEscapeKey: false
		}).then(function (result) {
			if (!result.isConfirmed) {
				$btn.prop('disabled', false).text('Submit');
				return;
			}
			$.ajax({
				url: '/game_list/add/buyin_split',
				type: 'POST',
				data: {
					game_id: $('#modal-add-buyin .game_list_id').val(),
					txtAccountCode: $('#modal-add-buyin .txtAccountCode').val(),
					totalBalanceGuest2: $('#total_balanceGuest2').val(),
					txtTotalAmountBuyin: $('#total_amount_addbuyin').val(),
					split_cash_nn: cashNN,
					split_cash_cc: cashCC,
					split_dep_nn: depNN,
					split_dep_cc: depCC,
					split_credit_nn: creditNN,
					split_credit_cc: creditCC
				},
				success: function () {
					Swal.fire({ icon: 'success', title: 'Success!', text: 'Additional Buy-in successfully added.', confirmButtonText: 'OK' }).then(() => {
						reloadData();
						$('#modal-add-buyin').modal('hide');
						$('#add_buyin')[0].reset();
						$btn.prop('disabled', false).text('Submit');
					});
				},
				error: function (xhr) {
					const errorMessage = xhr.responseJSON?.error || 'An error occurred.';
					Swal.fire({ icon: 'error', title: 'Error', text: errorMessage, confirmButtonText: 'OK' });
					$btn.prop('disabled', false).text('Submit');
				}
			});
		});
		return;
	}
	
	const txtNNamount = parseFloat(nnChips.replace(/,/g, '')) || 0;
	const txtCCamount = parseFloat(ccChips.replace(/,/g, '')) || 0;
	const totalEnteredAmount = txtNNamount + txtCCamount;

	// Enforce NN Chips as positive thousands (1,000 / 2,000 / 3,000 ...) when provided
	const $nnInput = $('.txtNN');
	$nnInput.removeClass('is-invalid'); // reset state on each submit
	const nnDigits = nnChips.replace(/,/g, '');
	const nnTrimmed = nnDigits.trim();
	if (nnTrimmed !== '' && (txtNNamount <= 0 || txtNNamount % 1000 !== 0)) {
		$nnInput.addClass('is-invalid');
		Swal.fire({
			title: 'Invalid NN Chips amount',
			text: 'NN Chips amount must be in thousands (e.g. 1,000 / 2,000 / 3,000).',
			icon: 'error',
			confirmButtonText: 'OK'
		});

		$btn.prop('disabled', false).text('Submit'); // Re-enable button
		return;
	}

	// Validation
	if (!nnChips && !ccChips && !transTypeSelected) {
		Swal.fire({
			title: 'Warning',
			text: 'Please fill in at least one field: NN Chips or CC Chips, and select a Transaction Type!',
			icon: 'warning',
			confirmButtonText: 'OK'
		});
	} else if (!nnChips && !ccChips) {
		Swal.fire({
			title: 'Warning',
			text: 'Please fill in at least one field: NN Chips or CC Chips!',
			icon: 'warning',
			confirmButtonText: 'OK'
		});
	} else if (!transTypeSelected) {
		Swal.fire({
			title: 'Warning',
			text: 'Please select a Transaction Type!',
			icon: 'warning',
			confirmButtonText: 'OK'
		});
	} else if (transType == '2' && totalEnteredAmount > totalBalanceGuest2) { // Deposit type
		Swal.fire({
			title: 'Insufficient Balance',
			text: 'The amount exceeds the available total balance of ₱' + formatNumberWithCommas(totalBalanceGuest2),
			icon: 'error',
			confirmButtonText: 'OK'
		});
	} else {
		// All validations passed, show confirmation dialog
		var transTypeText = '';
		if (transType == '1') transTypeText = 'Cash';
		else if (transType == '2') transTypeText = 'Deposit';
		else if (transType == '3') transTypeText = 'Credit';

		var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;white-space:nowrap;';
		var valueStyle = 'padding:4px 0 4px 0;text-align:left;';
		var buildRow = function (label, value) {
			return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
		};

		var confirmationRows = '';
		confirmationRows += buildRow('Payment Type:', transTypeText || '-');
		if (txtNNamount > 0) {
			confirmationRows += buildRow('NN Chips:', parseFloat(txtNNamount).toLocaleString());
		}
		if (txtCCamount > 0) {
			confirmationRows += buildRow('CC Chips:', parseFloat(txtCCamount).toLocaleString());
		}
		if (totalEnteredAmount > 0) {
			confirmationRows += buildRow('Total Amount:', parseFloat(totalEnteredAmount).toLocaleString());
		}

		var confirmationMessage = `
			<div style="max-width:420px;margin:0 auto;text-align:left;">
				<div style="font-weight:600;margin-bottom:8px;text-align:center;">Confirm Buy In Transaction:</div>
				<table style="margin:0 auto;border-collapse:collapse;min-width:260px;">
					${confirmationRows}
				</table>
			</div>
		`;
		
		var $form = $(this); // Store form reference
		
		Swal.fire({
			icon: 'question',
			title: 'Confirm Transaction',
			html: confirmationMessage + '<div style="margin-top:12px;">Are you sure you want to proceed?</div>',
			showCancelButton: true,
			confirmButtonText: 'Yes, Confirm',
			cancelButtonText: 'Cancel',
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			allowOutsideClick: false,
			allowEscapeKey: false
		}).then((result) => {
			if (result.isConfirmed) {
				// User confirmed, proceed with transaction
				$btn.prop('disabled', true).html(`
					<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
					Loading...
				`);
				
				const formData = $form.serialize();

				$.ajax({
					url: '/game_list/add/buyin',
					type: 'POST',
					data: formData,
					success: function (response) {
						Swal.fire({
							icon: 'success',
							title: 'Success!',
							text: 'Additional Buy-in successfully added.',
							confirmButtonText: 'OK',
							allowOutsideClick: false,
							allowEscapeKey: false
						}).then(() => {
							reloadData();
							$('#modal-add-buyin').modal('hide');
							$('#add_buyin')[0].reset();
							$btn.prop('disabled', false).text('Submit');
						});
					},
					error: function (xhr) {
						const errorMessage = xhr.responseJSON?.error || 'An error occurred.';
						console.error('Error adding buy-in transaction:', errorMessage);
						Swal.fire({
							icon: 'error',
							title: 'Error',
							text: errorMessage,
							confirmButtonText: 'OK'
						});
						$btn.prop('disabled', false).text('Submit');
					}
				});
			} else {
				// User cancelled, re-enable button
				$btn.prop('disabled', false).text('Submit');
			}
		});
	}

	// Re-enable button if we exited early
	if (!$btn.is(':disabled')) $btn.text('Save');
});


	$('#add_cashout').submit(function (event) {
		event.preventDefault();
	
		// 🔥 ADD: Reference to Save button
		var $btn = $('#submit-cashout-btn');
		$btn.prop('disabled', true).html(`
			<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
			Loading...
		`);

		var splitEnabled = $('#enableSplitCashout').is(':checked');
		if (splitEnabled) {
			var txtTotalRollingSplit = parseFloat($('#TotalRollingCashout').val()) || 0;
			var $nnCashInput = $('#nnCashAmount');
			var $nnDepInput = $('#nnDepositAmount');
			var $ccCashInput = $('#ccCashAmount');
			var $ccDepInput = $('#ccDepositAmount');
			$nnCashInput.removeClass('is-invalid');
			$nnDepInput.removeClass('is-invalid');
			$ccCashInput.removeClass('is-invalid');
			$ccDepInput.removeClass('is-invalid');
			var parseSplitNum = function ($el) {
				var v = ($el.val() || '').toString().replace(/,/g, '').trim();
				return v === '' ? 0 : parseFloat(v);
			};
			var nnCash = parseSplitNum($nnCashInput);
			var nnDep = parseSplitNum($nnDepInput);
			var ccCash = parseSplitNum($ccCashInput);
			var ccDep = parseSplitNum($ccDepInput);

			if (!Number.isFinite(nnCash) || !Number.isFinite(nnDep) || !Number.isFinite(ccCash) || !Number.isFinite(ccDep)) {
				Swal.fire({ icon: 'error', title: 'Invalid Input', text: 'Please enter valid numbers for all split fields.' });
				$btn.prop('disabled', false).html('Save');
				return;
			}
			if (nnCash < 0 || nnDep < 0 || ccCash < 0 || ccDep < 0) {
				Swal.fire({ icon: 'error', title: 'Invalid Input', text: 'Amounts cannot be negative.' });
				$btn.prop('disabled', false).html('Save');
				return;
			}

			var totalNN = nnCash + nnDep;
			var totalCC = ccCash + ccDep;
			var totalChips = totalNN + totalCC;
			if (totalChips <= 0) {
				Swal.fire({ icon: 'warning', title: 'Invalid Input', text: 'Enter at least one Cash or Deposit amount for NN or CC chips.' });
				$btn.prop('disabled', false).html('Save');
				return;
			}

			var checkNnThousands = function (label, n, $input) {
				if (n > 0 && (n % 1000 !== 0)) {
					if ($input && $input.length) {
						$input.addClass('is-invalid');
					}
					Swal.fire({
						icon: 'error',
						title: 'Invalid NN Chips amount',
						text: label + ' must be in thousands (e.g. 1,000 / 2,000).'
					});
					return false;
				}
				return true;
			};
			if (!checkNnThousands('NN Cash', nnCash, $nnCashInput) || !checkNnThousands('NN Deposit', nnDep, $nnDepInput)) {
				$btn.prop('disabled', false).html('Save');
				return;
			}

			if (totalNN > txtTotalRollingSplit) {
				Swal.fire({
					icon: 'warning',
					title: 'Invalid Input',
					text: 'Total NN (Cash + Deposit) cannot exceed Total Rolling: ' + formatNumberWithCommas(txtTotalRollingSplit)
				});
				$btn.prop('disabled', false).html('Save');
				return;
			}

			var cashLeg = nnCash + ccCash;
			var depLeg = nnDep + ccDep;
			if (cashLeg <= 0 || depLeg <= 0) {
				Swal.fire({
					icon: 'warning',
					title: 'Split requires both',
					text: 'Enter amounts for both Cash and Deposit.'
				});
				$btn.prop('disabled', false).html('Save');
				return;
			}

			var tableCell = 'padding:4px 8px;';
			var legTitleCell = tableCell + 'font-weight:600;text-align:center;vertical-align:middle;white-space:nowrap;';
			var rowLabelCell = tableCell + 'font-weight:600;white-space:nowrap;';
			var rowValueCell = tableCell + 'text-align:right;white-space:nowrap;';
			var totalTitleCell = tableCell + 'font-weight:700;text-align:center;vertical-align:middle;white-space:nowrap;';
			var totalMidCell = tableCell;
			var totalValueCell = tableCell + 'font-weight:700;text-align:right;white-space:nowrap;';

			var buildLegRows = function (legName, nnValue, ccValue) {
				var parts = [];
				if (nnValue > 0) parts.push({ label: 'NN', value: nnValue });
				if (ccValue > 0) parts.push({ label: 'CC', value: ccValue });
				if (parts.length === 0) return '';

				if (parts.length === 1) {
					return '<tr>' +
						'<td style="' + legTitleCell + '">' + legName + '</td>' +
						'<td style="' + rowLabelCell + '">' + parts[0].label + ':<\/td>' +
						'<td style="' + rowValueCell + '">' + parts[0].value.toLocaleString() + '<\/td>' +
						'<\/tr>';
				}

				var rows = '<tr>' +
					'<td rowspan="' + parts.length + '" style="' + legTitleCell + '">' + legName + '<\/td>' +
					'<td style="' + rowLabelCell + '">' + parts[0].label + ':<\/td>' +
					'<td style="' + rowValueCell + '">' + parts[0].value.toLocaleString() + '<\/td>' +
					'<\/tr>';

				for (var i = 1; i < parts.length; i++) {
					rows += '<tr>' +
						'<td style="' + rowLabelCell + '">' + parts[i].label + ':<\/td>' +
						'<td style="' + rowValueCell + '">' + parts[i].value.toLocaleString() + '<\/td>' +
						'<\/tr>';
				}

				return rows;
			};

			var splitRows = '';
			splitRows += buildLegRows('Cash', nnCash, ccCash);
			splitRows += buildLegRows('Deposit', nnDep, ccDep);
			splitRows += '<tr>' +
				'<td style="' + totalTitleCell + '">Total:<\/td>' +
				'<td style="' + totalMidCell + '"><\/td>' +
				'<td style="' + totalValueCell + '">' + totalChips.toLocaleString() + '<\/td>' +
				'<\/tr>';

			var splitConfirmHtml =
				'<div style="max-width:420px;margin:0 auto;text-align:left;">' +
				'<div style="font-weight:600;margin-bottom:8px;text-align:center;">Confirm cash-out transaction:</div>' +
				'<table style="margin:0 auto;border-collapse:collapse;min-width:300px;">' + splitRows + '</table></div>';

			var $formSplit = $(this);
			var commonPayload = {
				game_id: $formSplit.find('.game_list_id').val(),
				txtAccountCode: $formSplit.find('.txtAccountCode').val(),
				txttotal_balance_cashout: $('#total_balance_cashout').val(),
				txtMarkerChipsReturn: $('#MarkerChipsReturn').val(),
				txtTotalRolling: $('#TotalRollingCashout').val()
			};

			Swal.fire({
				icon: 'question',
				title: 'Confirm Transaction',
				html: splitConfirmHtml + '<div style="margin-top:12px;">Are you sure you want to proceed?</div>',
				showCancelButton: true,
				confirmButtonText: 'Yes, Confirm',
				cancelButtonText: 'Cancel',
				confirmButtonColor: '#3085d6',
				cancelButtonColor: '#d33',
				allowOutsideClick: false,
				allowEscapeKey: false
			}).then(function (result) {
				if (!result.isConfirmed) {
					$btn.prop('disabled', false).html('Save');
					return;
				}
				$btn.prop('disabled', true).html(
					'<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Loading...'
				);

				var fmt = function (n) {
					return n === 0 ? '' : String(Math.round(n));
				};

				var splitPayload = $.extend({}, commonPayload, {
					split_cash_nn: fmt(nnCash),
					split_cash_cc: fmt(ccCash),
					split_dep_nn: fmt(nnDep),
					split_dep_cc: fmt(ccDep)
				});

				$.ajax({
					url: '/game_list/add/cashout_split',
					type: 'POST',
					data: splitPayload,
					success: function () {
						Swal.fire({
							icon: 'success',
							title: 'Success!',
							text: 'Cash-out completed.'
						}).then(function () {
							reloadData();
							$('#modal-add-cashout').modal('hide');
							$btn.prop('disabled', false).html('Save');
						});
					},
					error: function (xhr) {
						var errorMessage =
							xhr.responseJSON && xhr.responseJSON.error
								? xhr.responseJSON.error
								: xhr.responseText || 'Something went wrong. Please try again.';
						Swal.fire({ icon: 'error', title: 'Error!', text: errorMessage });
						$btn.prop('disabled', false).html('Save');
					}
				});
			});
			return;
		}
	
		// Get the values of txtNN and txtTotalRolling
		var txtTotalRolling = parseFloat($('#TotalRollingCashout').val()); 
		var txtNN = parseFloat(($('#txtNNCashout').val() || '0').replace(/,/g, '')); 
		var txtCC = parseFloat(($('#txtCCCashout').val() || '0').replace(/,/g, '')); 
		var markerChipsReturn = parseFloat(($('#MarkerChipsReturn').val() || '0').replace(/,/g, '')); 
		var txtTransType = $('input[name="txtTransType"]:checked').val(); 

		// Thousands-only validation for NN Cashout (positive multiples of 1,000)
		var nnRaw = ($('#txtNNCashout').val() || '').toString().replace(/,/g, '');
		var nnTrimmed = nnRaw.trim();
		var $nnInput = $('#txtNNCashout');
		$nnInput.removeClass('is-invalid');
		if (nnTrimmed !== '' && (txtNN <= 0 || txtNN % 1000 !== 0)) {
			$nnInput.addClass('is-invalid');
			Swal.fire({
				icon: 'error',
				title: 'Invalid NN Chips amount',
				text: 'NN Chips amount must be in thousands (e.g. 1,000 / 2,000 / 3,000).'
			});
			$btn.prop('disabled', false).html('Save');
			return;
		}
	
		if (txtNN > txtTotalRolling) {
			Swal.fire({
				icon: 'warning',
				title: 'Invalid Input',
				text: 'NN Chips returned cannot exceed Total Rolling: '+ formatNumberWithCommas(txtTotalRolling),
			});
			$btn.prop('disabled', false).html('Save'); // 🔥 RESET BUTTON
			return;
		}
	
		if (txtTransType == 4) {
			if (txtCC > markerChipsReturn || txtNN > markerChipsReturn) {
				Swal.fire({
					icon: 'warning',
					title: 'Invalid Input',
					text: 'Credit Return cannot exceed Credit Balance: ' + formatNumberWithCommas(markerChipsReturn),
				});
				$btn.prop('disabled', false).html('Save'); // 🔥 RESET BUTTON
				return;
			}
	
			var totalChips = txtCC + txtNN;
			if (totalChips > markerChipsReturn) {
				Swal.fire({
					icon: 'warning',
					title: 'Invalid Input',
					text: 'Marker Chips Return cannot exceed Marker Balance: ' + formatNumberWithCommas(markerChipsReturn),
				});
				$btn.prop('disabled', false).html('Save'); // 🔥 RESET BUTTON
				return;
			}
		}
	
		// All validations passed, show confirmation dialog
		var transTypeText = '';
		if (txtTransType == '1') transTypeText = 'Cash';
		else if (txtTransType == '2') transTypeText = 'Deposit';
		else if (txtTransType == '3') transTypeText = 'Credit';
		else if (txtTransType == '4') transTypeText = 'Marker';

		var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;white-space:nowrap;';
		var valueStyle = 'padding:4px 0 4px 0;text-align:left;';
		var buildRow = function (label, value) {
			return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
		};

		var confirmationRows = '';
		confirmationRows += buildRow('Payment Type:', transTypeText || '-');
		if (txtNN > 0) {
			confirmationRows += buildRow('NN Chips:', parseFloat(txtNN).toLocaleString());
		}
		if (txtCC > 0) {
			confirmationRows += buildRow('CC Chips:', parseFloat(txtCC).toLocaleString());
		}
		if ((txtNN + txtCC) > 0) {
			confirmationRows += buildRow('Total Amount:', parseFloat(txtNN + txtCC).toLocaleString());
		}

		var confirmationMessage = `
			<div style="max-width:420px;margin:0 auto;text-align:left;">
				<div style="font-weight:600;margin-bottom:8px;text-align:center;">Confirm Cash-out Transaction:</div>
				<table style="margin:0 auto;border-collapse:collapse;min-width:260px;">
					${confirmationRows}
				</table>
			</div>
		`;
		
		var $form = $(this); // Store form reference
		
		Swal.fire({
			icon: 'question',
			title: 'Confirm Transaction',
			html: confirmationMessage + '<div style="margin-top:12px;">Are you sure you want to proceed?</div>',
			showCancelButton: true,
			confirmButtonText: 'Yes, Confirm',
			cancelButtonText: 'Cancel',
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			allowOutsideClick: false,
			allowEscapeKey: false
		}).then((result) => {
			if (result.isConfirmed) {
				// User confirmed, proceed with transaction
				$btn.prop('disabled', true).html(`
					<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
					Loading...
				`);
				
				var formData = $form.serialize();
		
				$.ajax({
					url: '/game_list/add/cashout',
					type: 'POST',
					data: formData,
					success: function (response) {
						Swal.fire({
							icon: 'success',
							title: 'Success!',
							text: 'Cash-out completed!'
						}).then(() => {
							reloadData();
							$('#modal-add-cashout').modal('hide');
							$btn.prop('disabled', false).html('Save'); // 🔥 RESET BUTTON
						});
					},
					error: function (xhr, status, error) {
						var errorMessage = xhr.responseJSON?.error || 'Something went wrong. Please try again.';
						Swal.fire({
							icon: 'error',
							title: 'Error!',
							text: errorMessage
						});
						$btn.prop('disabled', false).html('Save'); // 🔥 RESET BUTTON
					}
				});
			} else {
				// User cancelled, re-enable button
				$btn.prop('disabled', false).html('Save');
			}
		});
	});
	

	$('#add_rolling').submit(function (event) {
		event.preventDefault();
	
		var $btn = $('#submit-rolling-btn'); // Reference to the submit button
		
		// Determine if we're adding or updating a record
		var rollingAction = $('.rolling_action').val() || 'add';
		var rollingRecordId = $('.rolling_record_id').val();
		var isUpdate = rollingAction === 'update' && rollingRecordId;
		var requestUrl = isUpdate ? `/game_list/rolling/${rollingRecordId}/update` : '/game_list/add/rolling';
		var buttonLabel = isUpdate ? 'Update' : 'Save';

		// Get form values for confirmation
		var ccChips = $('#modal-add-rolling input[name="txtCC"]').val().trim().replace(/,/g, '') || $('#modal-add-rolling .txtCC').val().trim().replace(/,/g, '') || '';
		var ccAmount = parseFloat(ccChips) || 0;
		
		// Validation: Check if CC Chips is provided
		if (!ccChips || ccAmount <= 0) {
			Swal.fire({
				icon: 'warning',
				title: 'Warning',
				text: 'Please enter CC Chips!',
				confirmButtonText: 'OK',
				allowOutsideClick: false,
				allowEscapeKey: false
			}).then(() => {
				$('#modal-add-rolling').modal('show');
			});
			$btn.prop('disabled', false).text('Save');
			return;
		}
		
		// Build confirmation message
		var confirmationMessage = `Confirm Rolling Transaction:<br><br>`;
		confirmationMessage += `<strong>CC Chips:</strong> ${parseFloat(ccAmount).toLocaleString()}<br>`;
		
		var $form = $(this); // Store form reference
		
		Swal.fire({
			icon: 'question',
			title: isUpdate ? 'Confirm Update' : 'Confirm Transaction',
			html: confirmationMessage + '<br>Are you sure you want to proceed?',
			showCancelButton: true,
			confirmButtonText: 'Yes, Confirm',
			cancelButtonText: 'Cancel',
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			allowOutsideClick: false,
			allowEscapeKey: false
		}).then((result) => {
			if (result.isConfirmed) {
				// User confirmed, proceed with transaction
				$btn.prop('disabled', true).html(`
					<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
					Loading...
				`);
		  
				var formData = $form.serialize();

				$.ajax({
					url: requestUrl,
					type: 'POST',
					data: formData,
					success: function (response) {
						// Show success message
						var successTitle = isUpdate ? 'Updated!' : 'Success!';
						var successText = isUpdate ? 'Rolling entry successfully updated.' : 'Rolling transaction successfully added.';

						Swal.fire({
							icon: 'success',
							title: successTitle,
							text: successText,
							confirmButtonText: 'OK',
							allowOutsideClick: false,
							allowEscapeKey: false
						}).then((result) => {
							if (result.isConfirmed) {
								reloadData(); // Reload data after confirmation
								$('#modal-add-rolling').modal('hide'); // Close modal
								var currentGameId = $('.game_list_id').val();
								$('#add_rolling')[0].reset(); // Reset form
								$('.game_list_id').val(currentGameId);
								setRollingMode('add'); // Back to default
								$btn.prop('disabled', false).text('Save'); // Re-enable button with default label
							}
						});
					},
					error: function (xhr, status, error) {
						var errorMessage = xhr.responseJSON?.error || "An error occurred while processing.";
						console.error('Error adding rolling transaction:', errorMessage);
						
						// Show error message
						Swal.fire({
							icon: 'error',
							title: 'Error',
							text: errorMessage,
							confirmButtonText: 'OK'
						});
			
						$btn.prop('disabled', false).text(buttonLabel); // Re-enable button after error
					}
				});
			} else {
				// User cancelled, re-enable button
				$btn.prop('disabled', false).text(buttonLabel);
			}
		});
	});

	$('#add_roller_chips').submit(function (event) {
		event.preventDefault();
	
		var $btn = $('#submit-roller-chips-btn'); // Reference to the submit button
		$btn.prop('disabled', true).html(`
			<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
			Loading...
		  `);
		  
		var nnChips = $('#modal-add-roller-chips .txtRollerNN').val().trim().replace(/,/g, '');
		var ccChips = $('#modal-add-roller-chips .txtRollerCC').val().trim().replace(/,/g, '');
		var transType = $('#modal-add-roller-chips input[name="txtTransType"]:checked').val();
		
		// Parse input values
		var nnAmount = parseFloat(nnChips) || 0;
		var ccAmount = parseFloat(ccChips) || 0;
		
		// Thousands-only validation for NN for both ADD and RETURN.
		var $nnInput = $('#modal-add-roller-chips .txtRollerNN');
		$nnInput.removeClass('is-invalid');
		if (nnChips !== '' && (nnAmount <= 0 || nnAmount % 1000 !== 0)) {
			$nnInput.addClass('is-invalid');
			Swal.fire({
				icon: 'error',
				title: 'Invalid NN Chips amount',
				text: 'NN Chips must be in thousands (e.g. 1,000 / 2,000 / 3,000).'
			});
			$btn.prop('disabled', false).text('Save');
			return;
		}

		// Validation
		if (!nnChips && !ccChips) {
			Swal.fire({
				icon: 'warning',
				title: 'Warning',
				text: 'Please enter at least one value: NN Chips or CC Chips!',
				confirmButtonText: 'OK',
				allowOutsideClick: false,
				allowEscapeKey: false
			}).then(() => {
				// Keep modal open after validation error
				$('#modal-add-roller-chips').modal('show');
			});
			$btn.prop('disabled', false).text('Save');
			return;
		}
		
		if (!transType) {
			Swal.fire({
				icon: 'warning',
				title: 'Warning',
				text: 'Please select a Transaction Type (ADD or RETURN)!',
				confirmButtonText: 'OK',
				allowOutsideClick: false,
				allowEscapeKey: false
			}).then(() => {
				// Keep modal open after validation error
				$('#modal-add-roller-chips').modal('show');
			});
			$btn.prop('disabled', false).text('Save');
			return;
		}
		
		// Validation for RETURN: ensure return does not exceed remaining required amount
		if (transType == 2) { // RETURN
			var totalAddNN = parseFloat($('#modal-add-roller-chips').data('totalAddNN')) || 0;
			var totalAddCC = parseFloat($('#modal-add-roller-chips').data('totalAddCC')) || 0;
			var totalReturnNN = parseFloat($('#modal-add-roller-chips').data('totalReturnNN')) || 0;
			var totalReturnCC = parseFloat($('#modal-add-roller-chips').data('totalReturnCC')) || 0;
			var totalAddAll = totalAddNN + totalAddCC;
			var totalReturnAll = nnAmount + ccAmount;
			var requiredReturnTotal = Math.max(0, totalAddAll - (totalReturnNN + totalReturnCC));

			if (totalReturnAll > requiredReturnTotal) {
				var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;';
				var valueStyle = 'padding:4px 0 4px 0;text-align:left;font-weight:400;';
				var buildValidationRow = function (label, value) {
					return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
				};

				var validationRows = '';
				var totalAddValue = `NN: ${parseFloat(totalAddNN).toLocaleString()}<br>CC: ${parseFloat(totalAddCC).toLocaleString()}`;
				var totalReturnValue = `NN: ${parseFloat(totalReturnNN).toLocaleString()}<br>CC: ${parseFloat(totalReturnCC).toLocaleString()}`;
				validationRows += buildValidationRow('Total ADD:', totalAddValue);
				validationRows += buildValidationRow('Total RETURN:', totalReturnValue);
				validationRows += buildValidationRow('<span style="color:red;">Total Required RETURN (NN+CC):</span>', `<span style="color:red;font-weight:bold;">${parseFloat(requiredReturnTotal).toLocaleString()}</span>`);

				var validationMessage = `
					<div style="max-width:420px;margin:0 auto;text-align:left;">
						<table style="margin:0 auto;border-collapse:collapse;min-width:260px;">
							${validationRows}
						</table>
						<div style="margin-top:12px;font-weight:600;text-align:center;">
							Total RETURN (${parseFloat(totalReturnAll).toLocaleString()}) cannot exceed required return total (${parseFloat(requiredReturnTotal).toLocaleString()})!
						</div>
					</div>
				`;

				Swal.fire({
					icon: 'error',
					title: 'Validation Error',
					html: validationMessage,
					confirmButtonText: 'OK',
					allowOutsideClick: false,
					allowEscapeKey: false
				}).then(() => $('#modal-add-roller-chips').modal('show'));

				$btn.prop('disabled', false).text('Save');
				return;
			}
		}
	
		// Show confirmation dialog before proceeding
		var transTypeText = (transType == 1) ? 'ADD' : 'RETURN';

		var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;white-space:nowrap;';
		var valueStyle = 'padding:4px 0 4px 0;text-align:left;';
		var buildRow = function (label, value) {
			return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
		};

		var confirmationRows = '';
		confirmationRows += buildRow('Transaction Type:', transTypeText || '-');
		if (nnAmount > 0) {
			confirmationRows += buildRow('NN Chips:', parseFloat(nnAmount).toLocaleString());
		}
		if (ccAmount > 0) {
			confirmationRows += buildRow('CC Chips:', parseFloat(ccAmount).toLocaleString());
		}

		var confirmationMessage = `
			<div style="max-width:420px;margin:0 auto;text-align:left;">
				<div style="font-weight:600;margin-bottom:8px;text-align:center;">Confirm Roller Chips Transaction:</div>
				<table style="margin:0 auto;border-collapse:collapse;min-width:260px;">
					${confirmationRows}
				</table>
			</div>
		`;
		
		var $form = $(this); // Store form reference
		
		Swal.fire({
			icon: 'question',
			title: 'Confirm Transaction',
			html: confirmationMessage + '<div style="margin-top:12px;">Are you sure you want to proceed?</div>',
			showCancelButton: true,
			confirmButtonText: 'Yes, Confirm',
			cancelButtonText: 'Cancel',
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			allowOutsideClick: false,
			allowEscapeKey: false
		}).then((result) => {
			if (result.isConfirmed) {
				// User confirmed, proceed with transaction
				$btn.prop('disabled', true).html(`
					<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
					Loading...
				`);
				
				var formData = $form.serialize();
				
				$.ajax({
					url: '/game_list/add/roller_chips',
					type: 'POST',
					data: formData,
					success: function (response) {
						// Show success message
						Swal.fire({
							icon: 'success',
							title: 'Success!',
							text: 'Roller chips transaction successfully added.',
							confirmButtonText: 'OK',
							allowOutsideClick: false,
							allowEscapeKey: false
						}).then((result) => {
							if (result.isConfirmed) {
								reloadData(); // Reload data after confirmation
								$('#modal-add-roller-chips').modal('hide'); // Close modal
								$('#add_roller_chips')[0].reset(); // Reset form
								$('#modal-add-roller-chips input[name="txtTransType"]').prop('checked', false); // Clear radio selection
								$btn.prop('disabled', false).text('Save'); // Re-enable button
							}
						});
					},
					error: function (xhr, status, error) {
						var errorMessage = xhr.responseJSON?.error || "An error occurred while processing.";
						console.error('Error adding roller chips transaction:', errorMessage);
						
						// Show error message
						Swal.fire({
							icon: 'error',
							title: 'Error',
							text: errorMessage,
							confirmButtonText: 'OK'
						});
			
						$btn.prop('disabled', false).text('Save'); // Re-enable button after error
					}
				});
			} else {
				// User cancelled, re-enable button
				$btn.prop('disabled', false).text('Save');
			}
		});
	});


// 	$('#edit_status').submit(function (event) {
// 		event.preventDefault();

// 		var formData = $(this).serialize();
// 		$.ajax({
// 			url: '/game_list/change_status/' + game_id,
// 			type: 'PUT',
// 			data: formData,
// 			success: function (response) {
// 				reloadData();
// 				$('#modal-change_status').modal('hide');
// 				window.location.reload();
// 			},
// 			error: function (error) {
// 				console.error('Error updating agent:', error);
// 			}
// 		});
// 	});
// 	// }

$('#edit_status').submit(function (event) {
	event.preventDefault();

	var $form = $(this); // Store form reference early so it's accessible throughout
	var $btn = $('#submit-status-btn'); // ✅ reference to button
	$btn.prop('disabled', true).html(`
		<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
		Loading...
	`);

	// Get the value of the status select
	var status = $('#status').val();

	// Validate that the user has selected either "ON GAME" or "END GAME"
	if (status === null) {
		Swal.fire({
			icon: 'error',
			title: 'Choose Game Status',
			text: '',
			confirmButtonText: 'OK'
		}).then((result) => {
			if (result.isConfirmed) {
				$('#modal-change_status').modal('show');
			}
		});

		$btn.prop('disabled', false).html('Save');
		return;
	}

	// Prevent settlement issues when awaiting END GAME
	if (status == '1') {
		const $modal = $('#modal-change_status');
		const servicesValueRaw = $modal.data('servicesValue');
		const settlementValueRaw = $modal.data('settlementValue');

		if (servicesValueRaw === null) {
			Swal.fire({
				icon: 'info',
				title: 'Please wait',
				text: 'Service totals are still loading. Please try again in a moment.',
				confirmButtonText: 'OK',
				allowOutsideClick: false,
				allowEscapeKey: false
			});
			$btn.prop('disabled', false).html('Save');
			return;
		}

		const servicesValue = parseFloat(servicesValueRaw) || 0;
		const settlementValue = parseFloat(settlementValueRaw) || 0;

		if (servicesValue > settlementValue) {
			if ($btn.data('skipServiceCheck')) {
				$btn.removeData('skipServiceCheck');
			} else {
				Swal.fire({
					icon: 'warning',
					title: 'Service Exceeds Settlement',
					text: 'Service has exceeded the settlement amount.',
					confirmButtonText: 'Ok',
					confirmButtonColor: '#3085d6',
					allowOutsideClick: false,
					allowEscapeKey: false
				}).then((result) => {
					if (result.isConfirmed) {
						// Re-trigger Save: skip only service-vs-settlement check; roller chips validation (below) still runs before any save
						$btn.data('skipServiceCheck', true);
						$btn.click();
					}
					$btn.prop('disabled', false).html('Save');
				});
				return;
			}
		}
	}

	// Validation for roller chips return when END GAME (still runs after "Proceed anyway" on service-exceeds)
	if (status == '1') { // END GAME
		var requiredReturnNN = parseFloat($('#modal-change_status').data('requiredReturnNN')) || 0;
		var requiredReturnCC = parseFloat($('#modal-change_status').data('requiredReturnCC')) || 0;
		var requiredReturnTotal = parseFloat($('#modal-change_status').data('requiredReturnTotal')) || 0;
		
		// Skip all validation if required return total is 0 or less
		if (requiredReturnTotal <= 0) {
			// Clear input fields if no return is required
			$('#txtReturnRollerNN').val('');
			$('#txtReturnRollerCC').val('');
		}
		
		// Only validate if there is a required return total
		if (requiredReturnTotal > 0) {
			var returnNN = $('#txtReturnRollerNN').val().trim().replace(/,/g, '');
			var returnCC = $('#txtReturnRollerCC').val().trim().replace(/,/g, '');
			
			var returnNNAmount = parseFloat(returnNN) || 0;
			var returnCCAmount = parseFloat(returnCC) || 0;
			var returnTotal = returnNNAmount + returnCCAmount;

			// Thousands-only validation for Return NN (NN Chips)
			var $returnNNInput = $('#txtReturnRollerNN');
			$returnNNInput.removeClass('is-invalid');
			if (returnNN !== '' && (returnNNAmount <= 0 || returnNNAmount % 1000 !== 0)) {
				$returnNNInput.addClass('is-invalid');
				Swal.fire({
					icon: 'error',
					title: 'Invalid NN Chips amount',
					text: 'Return NN Chips must be in thousands (e.g. 1,000 / 2,000 / 3,000).'
				});
				$btn.prop('disabled', false).html('Save');
				return;
			}
			
			// Validate combined total matches required (NN/CC mix allowed)
			var totalsMatch = true;
			var errorMessages = [];
			
			if (requiredReturnTotal > 0 && parseFloat(returnTotal) !== parseFloat(requiredReturnTotal)) {
				totalsMatch = false;
				errorMessages.push(`Total Required (NN+CC): <strong>${parseFloat(requiredReturnTotal).toLocaleString()}</strong>, Current Total: <strong>${parseFloat(returnTotal).toLocaleString()}</strong>`);
			}
			
			// Guard against negative input values
			if (returnNNAmount < 0 || returnCCAmount < 0) {
				totalsMatch = false;
				errorMessages.push('Return amounts cannot be negative.');
			}

			// If amounts don't match, show error with "Proceed Anyway" option
			if (!totalsMatch) {
				var errorHtml = '<strong>Invalid Roller Chips Return!</strong><br><br>';
				errorHtml += errorMessages.join('<br>');
				errorHtml += '<br><br><small class="text-muted">You can return any mix of NN/CC as long as the combined total matches the required amount. This will be marked as PENDING for review.</small>';
				
				Swal.fire({
					icon: 'error',
					title: 'Amount Mismatch',
					html: errorHtml,
					showCancelButton: true,
					confirmButtonText: 'Proceed Anyway',
					cancelButtonText: 'Cancel',
					confirmButtonColor: '#ff9800',
					cancelButtonColor: '#d33',
					allowOutsideClick: false,
					allowEscapeKey: false
				}).then((result) => {
					if (result.isConfirmed) {
						// User chose to proceed anyway - submit with status = 3 (PENDING)
						$btn.prop('disabled', true).html(`
							<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
							Loading...
						`);
						
						// Serialize form data first
						var formData = $form.serialize();
						
						// Manually add status = 3 (PENDING) since it's not in the select options
						// Parse the serialized string and add/update txtStatus parameter
						var params = new URLSearchParams(formData);
						params.set('txtStatus', '3');
						formData = params.toString();
						
						// Submit the form via AJAX with status = 3
						$.ajax({
							url: '/game_list/change_status/' + game_id,
							type: 'PUT',
							data: formData,
							success: function (response) {
								Swal.fire({
									icon: 'warning',
									title: 'Status set to PENDING!',
									html: 'Game has been marked as PENDING due to amount mismatch.<br>Please review and resolve the discrepancy.',
									showConfirmButton: false,
									timer: 2000
								});

								reloadData();
								$('#modal-change_status').modal('hide');
							},
							error: function (error) {
								Swal.fire({
									icon: 'error',
									title: 'Error!',
									text: 'Failed to update status. Please try again.',
								});
								console.error('Error updating status:', error);
							},
							complete: function () {
								$btn.prop('disabled', false).html('Save');
								// Reset status back to original for UI
								$('#status').val('1');
							}
						});
					} else {
						// User cancelled - show modal again
						$('#modal-change_status').modal('show');
						$btn.prop('disabled', false).html('Save');
					}
				});
				return;
			}
		}
	}

	// All validations passed, show confirmation dialog
	var statusText = (status == '1') ? 'END GAME' : (status == '2') ? 'ON GAME' : (status == '3') ? 'PENDING' : status;

	var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;white-space:nowrap;';
	var valueStyle = 'padding:4px 0 4px 0;text-align:left;';
	var buildRow = function (label, value) {
		return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
	};

	var confirmationRows = '';
	confirmationRows += buildRow('New Status:', statusText);

	// Add roller chips return info if END GAME and has required returns
	if (status == '1') {
		var requiredReturnNN = parseFloat($('#modal-change_status').data('requiredReturnNN')) || 0;
		var requiredReturnCC = parseFloat($('#modal-change_status').data('requiredReturnCC')) || 0;
		var requiredReturnTotal = parseFloat($('#modal-change_status').data('requiredReturnTotal')) || 0;

		// Only show roller chips return info if required return total is greater than 0
		if (requiredReturnTotal > 0) {
			var returnNN = $('#txtReturnRollerNN').val().trim().replace(/,/g, '');
			var returnCC = $('#txtReturnRollerCC').val().trim().replace(/,/g, '');
			var returnNNAmount = parseFloat(returnNN) || 0;
			var returnCCAmount = parseFloat(returnCC) || 0;

			var rollerText = '';
			if (returnNNAmount > 0) {
				rollerText += `NN Chips: ${parseFloat(returnNNAmount).toLocaleString()}`;
			}
			if (returnCCAmount > 0) {
				if (rollerText) rollerText += '<br>';
				rollerText += `CC Chips: ${parseFloat(returnCCAmount).toLocaleString()}`;
			}

			if (rollerText) {
				confirmationRows += buildRow('Roller Chips Return:', rollerText);
			}
		}
	}

	var confirmationMessage = `
		<div style="max-width:420px;margin:0 auto;text-align:left;">
			
			<table style="margin:0 auto;border-collapse:collapse;min-width:260px;">
				${confirmationRows}
			</table>
		</div>
	`;
	
	Swal.fire({
		icon: 'question',
		title: 'Confirm Status Change',
		html: confirmationMessage + '<div style="margin-top:12px;">Are you sure you want to proceed?</div>',
		showCancelButton: true,
		confirmButtonText: 'Yes, Confirm',
		cancelButtonText: 'Cancel',
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		allowOutsideClick: false,
		allowEscapeKey: false,
		width: '500px'
	}).then((result) => {
		if (result.isConfirmed) {
			// User confirmed, proceed with transaction
			$btn.prop('disabled', true).html(`
				<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
				Loading...
			`);
			
			// Serialize form data
			var formData = $form.serialize();

			// Submit the form via AJAX
			$.ajax({
				url: '/game_list/change_status/' + game_id,
				type: 'PUT',
				data: formData,
				success: function (response) {
					Swal.fire({
						icon: 'success',
						title: 'Status updated successfully!',
						showConfirmButton: false,
						timer: 1500
					});

					reloadData();
					$('#modal-change_status').modal('hide');
				},
				error: function (error) {
					Swal.fire({
						icon: 'error',
						title: 'Error!',
						text: 'Failed to update status. Please try again.',
					});
					console.error('Error updating status:', error);
				},
				complete: function () {
					$btn.prop('disabled', false).html('Save');
				}
			});
		} else {
			// User cancelled, re-enable button
			$btn.prop('disabled', false).html('Save');
		}
	});
});

});

function addBuyin(id, account) {
	$('#modal-add-buyin').modal('show');

	$('.txtAmount').val('');
	$('.txtNN').val('');
	$('.txtCC').val('');
	$('#modal-add-buyin input[name="txtTransType"]').prop('checked', false).prop('disabled', false);
	$('#enableSplitBuyin').prop('checked', false);
	$('#split-buyin-row').hide();
	$('#buyin-nncc-row').show();
	$('#buyin-trans-type-row').show();
	$('#splitBuyinCashNN, #splitBuyinCashCC, #splitBuyinDepNN, #splitBuyinDepCC, #splitBuyinCreditNN, #splitBuyinCreditCC').val('').removeClass('is-invalid');

	$('.game_list_id').val(id);
	$('.txtAccountCode').val(account);
	

	 // Fetch account details to calculate balance
	 $.ajax({
		url: '/account_details_data_deposit/' + account,
		method: 'GET',
		success: function (data) {
			let deposit_amount = 0;
			let withdraw_amount = 0;
			let marker_return = 0;
			let marker_deposit_amount = 0;
	
			data.forEach(function (row) {
				const amount = parseFloat(row.AMOUNT) || 0;
	
				if (row.TRANSACTION === 'DEPOSIT') {
                    deposit_amount += amount;
                } else if (row.TRANSACTION === 'WITHDRAW') {
                    withdraw_amount += amount;
                } else if (row.TRANSACTION === 'IOU RETURN DEPOSIT') {
                    marker_return += amount;
                } else if (row.TRANSACTION === 'MARKER REDEEM') {
					marker_deposit_amount += amount;
				}
			});
	
			const totalBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;
	
			// Set raw numeric value safely
			$('#total_balanceGuest2').val(totalBalance);
			$('#total_balanceGuest2GameList').val(totalBalance.toLocaleString());
		},
		error: function (xhr, status, error) {
			console.error('Error fetching account details:', error);
		}
	});
	
	


	// Initialize totals
		let totalInitialBuyIn = 0;
		let totalAdditionalBuyIn = 0;
		let totalAmount = 0;

	$.ajax({
		url: '/game_list/' + id + '/record',
		method: 'GET',
		success: function (response) {
			var total_buy_in = 0;
			var total_cash_out = 0;
			var total_rolling = 0;
			var initial_buy_in = 0;

			var total_nn_init = 0;
			var total_cc_init = 0;
			var total_nn = 0;
			var total_cc = 0;
			var total_cash_out_nn = 0;
			var total_cash_out_cc = 0;
			var total_rolling_nn = 0;
			var total_rolling_cc = 0;

			var total_rolling_real = 0;
			var total_rolling_nn_real = 0;
			var total_rolling_cc_real = 0;
			var total_roller_nn = 0;
			var total_roller_cc = 0;

			response.forEach(function (res) {
				if (res.CAGE_TYPE == 1 && (total_nn_init != 0 || total_cc_init != 0)) {
					total_buy_in = total_buy_in + res.AMOUNT;
					total_nn = total_nn + res.NN_CHIPS;
					total_cc = total_cc + res.CC_CHIPS;
				}

				if ((total_nn_init == 0 && total_cc_init == 0) && res.CAGE_TYPE == 1) {
					initial_buy_in = res.AMOUNT;
					total_nn_init = total_nn_init + res.NN_CHIPS;
					total_cc_init = total_cc_init + res.CC_CHIPS;
				}

				if (res.CAGE_TYPE == 2) {
					total_cash_out = total_cash_out + res.AMOUNT;
					total_cash_out_nn = total_cash_out_nn + res.NN_CHIPS;
					total_cash_out_cc = total_cash_out_cc + res.CC_CHIPS;
				}

				if (res.CAGE_TYPE == 3) {
					total_rolling = total_rolling + res.AMOUNT;
					total_rolling_nn = total_rolling_nn + res.NN_CHIPS;
					total_rolling_cc = total_rolling_cc + res.CC_CHIPS;
				}

				if (res.CAGE_TYPE == 4) {
					total_rolling_real = total_rolling_real + res.AMOUNT;
					total_rolling_nn_real = total_rolling_nn_real + res.NN_CHIPS;
					total_rolling_cc_real = total_rolling_cc_real + res.CC_CHIPS;
				}
			});

			var total_initial = total_nn_init + total_cc_init;
			var total_buy_in_chips = total_nn + total_cc;

			var total_amount = total_buy_in_chips + total_initial;

			// Add to grand totals
			totalInitialBuyIn += total_initial;
			totalAdditionalBuyIn += total_buy_in_chips;
			totalAmount += total_amount;

			$('#total_amount_addbuyin').val(totalAmount); // Display formatted balance
			
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

function setRollingMode(mode, recordId) {
	var normalizedMode = mode === 'update' && recordId ? 'update' : 'add';

	$('.rolling_action').val(normalizedMode);
	$('.rolling_record_id').val(normalizedMode === 'update' ? recordId : '');
	$('#submit-rolling-btn').text(normalizedMode === 'update' ? 'Update' : 'Save');
}

function prepareRollingModal(gameId) {
	var form = document.getElementById('add_rolling');
	if (form) {
		form.reset();
	}

	$('.txtCC').val('');
	setRollingMode('add');

	$('.game_list_id').val(gameId || '');
}

function addRolling(id) {
	prepareRollingModal(id);
	$('#modal-add-rolling').modal('show');
}

$(document).on('click', '#load-last-rolling-btn', function () {
	var gameId = $('.game_list_id').val();
	if (!gameId) {
		Swal.fire({
			icon: 'warning',
			title: 'No Game Selected',
			text: 'Please open the rolling modal from a game row first.',
			confirmButtonText: 'OK'
		});
		return;
	}

	var $button = $(this);
	var originalText = $button.text();
	$button.prop('disabled', true).text('Loading...');

	$.ajax({
		url: `/game_list/${gameId}/rolling/last`,
		method: 'GET',
		dataType: 'json',
		success: function (response) {
			var record = response?.data;
			if (!record) {
				Swal.fire({
					icon: 'info',
					title: 'No Rolling History',
					text: 'There is no previous rolling entry for this game yet.',
					confirmButtonText: 'OK'
				});
				return;
			}

			var ccValue = parseFloat(record.CC_CHIPS) || 0;
			$('.txtCC').val(ccValue ? ccValue.toLocaleString() : '');
			setRollingMode('update', record.IDNo);
		},
		error: function (xhr) {
			var err = xhr.responseJSON?.error || 'Unable to load the last rolling entry.';
			Swal.fire({
				icon: 'error',
				title: 'Error',
				text: err,
				confirmButtonText: 'OK'
			});
		},
		complete: function () {
			$button.prop('disabled', false).text(originalText);
		}
	});
});

$('#modal-add-rolling').on('hidden.bs.modal', function () {
	var form = document.getElementById('add_rolling');
	if (form) {
		form.reset();
	}
	setRollingMode('add');
	$('#submit-rolling-btn').prop('disabled', false).text('Save');
});

function addRollerChips(id, returnOnly) {
	$('#modal-add-roller-chips').modal('show');

	$('#modal-add-roller-chips .txtRollerNN').val('');
	$('#modal-add-roller-chips .txtRollerCC').val('');
	$('#modal-add-roller-chips input[name="txtTransType"]').prop('checked', false); // No default selection

	// If RETURN only mode (END GAME but not settled), disable ADD option and auto-select RETURN
	if (returnOnly) {
		$('#rollerAdd').prop('disabled', true).closest('.form-check').css('opacity', '0.5');
		$('#rollerReturn').prop('checked', true);
	} else {
		// Enable ADD option for ON GAME status
		$('#rollerAdd').prop('disabled', false).closest('.form-check').css('opacity', '1');
	}

	$('#modal-add-roller-chips .game_list_id').val(id);
	
	// Fetch game records to calculate totals for display/validation
	$.ajax({
		url: '/game_list/' + id + '/record',
		method: 'GET',
		success: function (response) {
			var totalAddNN = 0;
			var totalAddCC = 0;
			var totalReturnNN = 0;
			var totalReturnCC = 0;
			var totalRollingNN = 0;
			var totalRollingCC = 0;
			var totalRollingRealNN = 0;
			var totalRollingRealCC = 0;
			var totalRolling = 0;
			var totalRollingReal = 0;
			var totalCashOutNN = 0;
			
			response.forEach(function (row) {
				if (row.CAGE_TYPE == 5) { // ROLLER CHIPS
					if (row.ROLLER_TRANSACTION == 1) { // ADD
						totalAddNN += (row.ROLLER_NN_CHIPS || 0);
						totalAddCC += (row.ROLLER_CC_CHIPS || 0);
					} else if (row.ROLLER_TRANSACTION == 2) { // RETURN
						totalReturnNN += (row.ROLLER_NN_CHIPS || 0);
						totalReturnCC += (row.ROLLER_CC_CHIPS || 0);
					}
				}
				
				if (row.CAGE_TYPE == 3) { // TOTAL ROLLING
					totalRolling += (row.AMOUNT || 0);
					totalRollingNN += (row.NN_CHIPS || 0);
					totalRollingCC += (row.CC_CHIPS || 0);
				}
				
				if (row.CAGE_TYPE == 4) { // REAL ROLLING
					totalRollingReal += (row.AMOUNT || 0);
					totalRollingRealNN += (row.NN_CHIPS || 0);
					totalRollingRealCC += (row.CC_CHIPS || 0);
				}
				
				if (row.CAGE_TYPE == 2) { // CASH OUT
					totalCashOutNN += (row.NN_CHIPS || 0);
				}
			});
			
			// Calculate total rolling chips (same logic as main calculation)
			var totalRollingChips = totalRollingNN + totalRollingCC + totalRolling + totalRollingReal + totalRollingRealNN + totalRollingRealCC - totalCashOutNN;
			
			// Calculate net roller chips (ADD - RETURN) for NN
			var netAddNN = totalAddNN - totalReturnNN;
			
			// Calculate suggested RETURN (Total ADD - Rolling that affects rolling)
			// Note: Only NN chips affect rolling, so we calculate based on NN
			var suggestedReturnNN = Math.max(0, netAddNN - (totalRollingChips > 0 ? (totalRollingChips - (totalRollingNN + totalRollingCC + totalRolling + totalRollingReal + totalRollingRealNN + totalRollingRealCC - totalCashOutNN)) : 0));
			
			var totalAddAll = totalAddNN + totalAddCC;
			// Display totals in modal (for information)
			$('#roller-chips-total-add-nn').text(parseFloat(totalAddNN).toLocaleString());
			$('#roller-chips-total-add-cc').text(parseFloat(totalAddCC).toLocaleString());
			$('#roller-chips-total-return-nn').text(parseFloat(totalReturnNN).toLocaleString());
			$('#roller-chips-total-return-cc').text(parseFloat(totalReturnCC).toLocaleString());
			var totalReturnAll = totalReturnNN + totalReturnCC;
			var requiredReturnNN = totalAddNN - totalReturnNN;
			var requiredReturnCC = totalAddCC - totalReturnCC;
			var requiredReturnTotal = requiredReturnNN + requiredReturnCC;
			$('#roller-chips-required-return-total').text(parseFloat(requiredReturnTotal).toLocaleString());
			
			// Store values for validation
			$('#modal-add-roller-chips').data('totalAddNN', totalAddNN);
			$('#modal-add-roller-chips').data('totalAddCC', totalAddCC);
			$('#modal-add-roller-chips').data('totalReturnNN', totalReturnNN);
			$('#modal-add-roller-chips').data('totalReturnCC', totalReturnCC);
			$('#modal-add-roller-chips').data('netAddNN', netAddNN);
		},
		error: function (xhr, status, error) {
			console.error('Error fetching game records:', error);
		}
	});
}

// Reset ADD option when modal closes
$('#modal-add-roller-chips').on('hidden.bs.modal', function () {
	$('#rollerAdd').prop('disabled', false).closest('.form-check').css('opacity', '1');
	$('#rollerReturn').prop('checked', false);
});

function addCashout(id, account, total_rolling_chips) {

	$('.txtAmount').val('');
	$('.txtNN').val('');
	$('.txtCC').val('');

	$('.form-check-input').prop('checked', false);

	// Reset split UI state every time modal opens
	var splitToggle   = document.getElementById('enableSplitCashout');
	var splitRow      = document.getElementById('split-cashout-row');
	var transTypeRow  = document.getElementById('trans-type-row');
	var nnCcRow       = document.getElementById('nn-cc-row');

	if (splitToggle) {
		splitToggle.checked = false;
	}
	if (splitRow) {
		splitRow.style.display = 'none';
	}
	if (transTypeRow) {
		transTypeRow.style.display = '';
	}
	if (nnCcRow) {
		nnCcRow.style.display = '';
	}

	$('#nnCashAmount, #nnDepositAmount, #ccCashAmount, #ccDepositAmount').val('');

	$('.game_list_id').val(id);
	$('.txtAccountCode').val(account);
	$('#TotalRollingCashout').val(total_rolling_chips);

	function wireCashoutMarkerWarnings(isMarkerGame) {
		var $cashoutModal = $('#modal-add-cashout');

		var askMarkerCashoutWarning = function () {
			if (!isMarkerGame) return Promise.resolve(true);
			return Swal.fire({
				icon: 'warning',
				title: 'Warning',
				text: 'This is a marker game. Have you confirmed the Cash Out?',
				confirmButtonText: 'Yes',
				cancelButtonText: 'No',
				showCancelButton: true,
				allowOutsideClick: false,
				allowEscapeKey: true
			}).then(function (result) {
				return !!result.isConfirmed;
			});
		};

		var $cashoutTransTypes = $cashoutModal.find('input[name="txtTransType"]');
		var previousTransType = ($cashoutTransTypes.filter(':checked').val() || '').toString();
		var suppressTransTypeWarning = false;
		$cashoutTransTypes
			.off('change.marker-warning')
			.on('change.marker-warning', function () {
				if (suppressTransTypeWarning) return;
				var selectedType = ($(this).val() || '').toString();
				if (selectedType !== '1' && selectedType !== '2') {
					previousTransType = selectedType;
					return;
				}
				askMarkerCashoutWarning().then(function (confirmed) {
					if (confirmed) {
						previousTransType = selectedType;
						return;
					}
					suppressTransTypeWarning = true;
					$cashoutTransTypes.prop('checked', false);
					if (previousTransType) {
						$cashoutModal.find('input[name="txtTransType"][value="' + previousTransType + '"]').prop('checked', true);
					}
					suppressTransTypeWarning = false;
				});
			});

		var $splitToggle = $cashoutModal.find('#enableSplitCashout');
		var syncSplitUiState = function (isOn) {
			var splitRowEl = document.getElementById('split-cashout-row');
			var transTypeRowEl = document.getElementById('trans-type-row');
			var nnCcRowEl = document.getElementById('nn-cc-row');
			if (splitRowEl) splitRowEl.style.display = isOn ? '' : 'none';
			if (transTypeRowEl) transTypeRowEl.style.display = isOn ? 'none' : '';
			if (nnCcRowEl) nnCcRowEl.style.display = isOn ? 'none' : '';
		};
		var suppressSplitWarning = false;
		$splitToggle
			.off('change.marker-warning')
			.on('change.marker-warning', function () {
				if (suppressSplitWarning || !isMarkerGame) return;
				var $this = $(this);
				if (!$this.is(':checked')) return;

				suppressSplitWarning = true;
				$this.prop('checked', false).trigger('change');
				syncSplitUiState(false);
				suppressSplitWarning = false;

				askMarkerCashoutWarning().then(function (confirmed) {
					if (!confirmed) {
						syncSplitUiState(false);
						return;
					}
					suppressSplitWarning = true;
					$this.prop('checked', true).trigger('change');
					syncSplitUiState(true);
					suppressSplitWarning = false;
				});
			});
	}

	$.ajax({
		url: '/game_list/' + id + '/record',
		method: 'GET',
		success: function (response) {
			if (parseInt($('.game_list_id').val(), 10) !== parseInt(id, 10)) return;
			var isMarkerGame = false;
			(response || []).forEach(function (res) {
				if (res.CAGE_TYPE == 1 && parseInt(res.TRANSACTION, 10) === 3) {
					isMarkerGame = true;
				}
			});
			wireCashoutMarkerWarnings(isMarkerGame);
			$('#modal-add-cashout').modal('show');
		},
		error: function () {
			if (parseInt($('.game_list_id').val(), 10) !== parseInt(id, 10)) return;
			wireCashoutMarkerWarnings(false);
			$('#modal-add-cashout').modal('show');
		}
	});

	$.ajax({
		url: '/account_details_data_deposit/' + account,
		method: 'GET',
		success: function (data) {
			let deposit_amount = 0;
			let withdraw_amount = 0;
			let marker_return = 0;
			let marker_deposit_amount = 0;
	
			data.forEach(function (row) {
				const amount = parseFloat(row.AMOUNT) || 0;
	
				if (row.TRANSACTION === 'DEPOSIT') {
                    deposit_amount += amount;
                } else if (row.TRANSACTION === 'WITHDRAW') {
                    withdraw_amount += amount;
                } else if (row.TRANSACTION === 'IOU RETURN DEPOSIT') {
                    marker_return += amount;
                } else if (row.TRANSACTION === 'MARKER REDEEM') {
					marker_deposit_amount += amount;
				}
			});
	
			const totalBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;

	
			// ✅ Set it safely
			$('#total_balance_cashout').val(!isNaN(totalBalance) ? totalBalance : 0);
		},
		error: function (xhr, status, error) {
			console.error('Error fetching account details:', error);
		}
	});
	
    
    $.ajax({
		url: '/marker_data_cashout/' + account,
		method: 'GET',
		success: function(data) {
			var amount = 0; // Initialize amount to 0
			if (data.length > 0) {
				data.forEach(function(row) {
					amount = row.TOTAL_AMOUNT;
				});
			}
			$('#MarkerChipsReturn').val(amount); // Update value outside the loop
		},
		error: function(err) {
			console.error('Error fetching marker data:', err);
		}
	});

}



function showHistory(record_id) {
	$('#modal-show-history').modal('show');

	

	if ($.fn.DataTable.isDataTable('#game_record-tbl')) {
		$('#game_record-tbl').DataTable().destroy();
	}

	// Custom sort to keep TOTAL row at top
	$.fn.dataTable.ext.order['total-first'] = function(settings, col) {
		return this.api().column(col, {order:'index'}).nodes().map(function(td, i) {
			var text = $(td).text().trim();
			// If it's TOTAL, return empty string (sorts first), otherwise return the text
			return text === 'TOTAL' ? '' : text;
		});
	};

	var dataTable = $('#game_record-tbl').DataTable({
		lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
		order: [[0, 'asc']], // Sort by first column ascending
		columnDefs: [
			{
				type: 'total-first',
				targets: 0, // Apply custom sort to first column
				createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
					$(cell).addClass('text-center');
				}
			},
			{
				createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
					$(cell).addClass('text-center');
				}
			}
		]
	});

// 	function reloadDataRecord() {
// 		$.ajax({
// 			url: '/game_record_data/' + record_id, // Endpoint to fetch data
// 			method: 'GET',
// 			success: function (data) {
// 				dataTable.clear();
// 				data.forEach(function (row) {

//                         //DEFAULT
// // 					var btn = `<div class="btn-group">
// // 			<button type="button" onclick="checkPermissionToDeleteHistory(${row.game_record_id})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
// // 			data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
// // 			<i class="fa fa-trash-alt"></i>
// // 			</button>
// // 		</div>`;
		
		
//                         	var btn;
//             		if (row.game_status == 1) {
//             			// Game has ended, disable the button
//             			btn = `<div class="btn-group">
//             				<button type="button" class="btn btn-sm btn-alt-danger" disabled aria-label="Game Ended">
//             					<i class="fa fa-trash-alt"></i>
//             				</button>
//             			</div>`;
//             		} else {
//             			// Game is ongoing, show the button
//             			btn = `<div class="btn-group">
//             				<button type="button" onclick="archive_game_record(${row.game_record_id})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
//             					data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
//             					<i class="fa fa-trash-alt"></i>
//             				</button>
//             			</div>`;
//             		}


// 					var trading = moment(row.record_date).format('MMMM DD, YYYY HH:mm:ss');
// 					// var record_date = moment(row.RECORD_DATE).format('MMMM DD, YYYY');

// 					var buy_in = 0;
// 					var cash_out = 0;
// 					var rolling = 0;
// 					var real_rolling = 0;

// 					if (row.CAGE_TYPE == 1) {
// 						buy_in = row.CC_CHIPS + row.NN_CHIPS;
// 					}

// 					if (row.CAGE_TYPE == 2) {
// 						cash_out = row.CC_CHIPS + row.NN_CHIPS;
// 					}

// 					if (row.CAGE_TYPE == 3) {
// 						rolling = row.AMOUNT + row.CC_CHIPS + row.NN_CHIPS;
// 					}

// 					if (row.CAGE_TYPE == 4) {
// 						real_rolling = row.AMOUNT + row.CC_CHIPS + row.NN_CHIPS;
// 					}

// 					dataTable.row.add([trading, buy_in.toLocaleString(), cash_out.toLocaleString(), real_rolling.toLocaleString(), rolling.toLocaleString(), row.NN_CHIPS.toLocaleString(), row.CC_CHIPS.toLocaleString(), btn]).draw();
// 				});
// 			},
// 			error: function (xhr, status, error) {
// 				console.error('Error fetching data:', error);
// 			}
// 		});
// 	}
function reloadDataRecord() {
    $.ajax({
        url: '/game_record_data/' + record_id, // Endpoint to fetch data
        method: 'GET',
        success: function (data) {
            // Set game number and agent name in modal header
            if (data.length > 0) {
                if (data[0].game_list_id) {
                    $('#game_number').text(data[0].game_list_id);
                }
                if (data[0].agent_name) {
                    $('#agent_name').text(data[0].agent_name);
                }
            }
            
            // Calculate totals using the SAME formula as game list (line 304)
            let total_nn_init = 0;
            let total_cc_init = 0;
            let total_nn = 0;
            let total_cc = 0;
            let total_cash_out_nn = 0;
            let total_cash_out_cc = 0;
            let total_rolling_nn = 0;
            let total_rolling_cc = 0;
            let total_rolling = 0;
            let total_rolling_real = 0;
            let total_rolling_nn_real = 0;
            let total_rolling_cc_real = 0;
            let total_roller_return_cc = 0;
            let initialBuyinTimestamp = null;

            // For split new game, multiple CAGE_TYPE=1 rows can be created at the same timestamp.
            // Treat the earliest buy-in timestamp as "initial buy-in", not "additional buy-in".
            data.forEach(function (row) {
                if (row.CAGE_TYPE == 1) {
                    const ts = new Date(row.record_date).getTime();
                    if (Number.isFinite(ts) && (initialBuyinTimestamp === null || ts < initialBuyinTimestamp)) {
                        initialBuyinTimestamp = ts;
                    }
                }
            });

            const mergedData = {};

            // Pagsamahin ang data
            const userPermissions = parseInt(document.getElementById('user-role')?.getAttribute('data-permissions') || '99', 10);
            data.forEach(function (row) {
                const dateKey = moment(row.record_date).format('MMM DD, YYYY HH:mm:ss');
                // Keep split entries visible as separate rows:
                // - Cash-out split: key by game_record row
                // - Buy-in split: key by transaction type (1 cash / 2 deposit / 3 credit) so each leg gets its own row
                // For CAGE_TYPE 3 (paired total rolling), use same split key as CAGE_TYPE 1 so they stay in the same row.
                const transKey = parseInt(row.TRANSACTION, 10) || 0;
                let mergeKey = dateKey;
                if (row.CAGE_TYPE == 2) {
                    mergeKey = dateKey + '|co|' + row.game_record_id;
                } else if (row.CAGE_TYPE == 1 || row.CAGE_TYPE == 3) {
                    mergeKey = dateKey + '|bi|' + transKey;
                }

                if (!mergedData[mergeKey]) {
                    mergedData[mergeKey] = {
                        buy_in: 0,
                        buy_in_nn: 0,  // Track NN chips separately for buy-in
                        additional_buyin: 0,
                        additional_buyin_nn: 0,  // Record NN chips separately for additional buy-in
                        cash_out: 0,
                        cash_out_nn: 0,
                        cash_out_type: 1, // 1=Cash, 2=Deposit, 3=Marker (set on cash out)
                        real_rolling: 0,
                        total_rolling: 0,
                        total_rolling_for_calc: 0,  // CAGE_TYPE 3: AMOUNT + NN only (no CC)
                        real_rolling_for_calc: 0,  // CAGE_TYPE 4: AMOUNT + NN + CC
                        roller_return_cc: 0,  // Roller return CC for this row
                        nn: 0,
                        cc: 0,
                        roller_nn: 0,
                        roller_cc: 0,
                        remarks: row.REMARKS || '',
                        action: row.game_record_id,
                        timestamp: new Date(row.record_date).getTime(),
                        sortId: row.game_record_id || 0,
                        displayDate: dateKey,
                        is_marker: (row.TRANSACTION == 3),  // 3 = Marker
                        is_deposit: (row.TRANSACTION == 2),  // 2 = Deposit
                        buy_in_type: 1,    // 1=Cash, 2=Deposit, 3=Marker (set on first buy-in)
                        additional_buyin_type: 1,
                        // Track edit/delete IDs per record type (for New Game + roller chips, we need both)
                        editBuyinId: null,
                        editCashoutId: null,
                        editRollingId: null,
                        editRollerId: null,
                        deletePrimaryId: null,
                        game_status: row.game_status
                    };
                } else {
                    mergedData[mergeKey].is_marker = mergedData[mergeKey].is_marker || (row.TRANSACTION == 3);
                    mergedData[mergeKey].is_deposit = mergedData[mergeKey].is_deposit || (row.TRANSACTION == 2);
                }

                // Track edit IDs per CAGE_TYPE (Super Admin only) - single edit opens combined modal (buy-in + roller)
                if (userPermissions === 0) {
                    if (row.CAGE_TYPE == 1) mergedData[mergeKey].editBuyinId = row.game_record_id;
                    if (row.CAGE_TYPE == 2) mergedData[mergeKey].editCashoutId = row.game_record_id;
                    if (row.CAGE_TYPE == 3 && !mergedData[mergeKey].editBuyinId) mergedData[mergeKey].editRollingId = row.game_record_id; // Skip if paired with buy-in
                    if (row.CAGE_TYPE == 4) mergedData[mergeKey].editRollingId = row.game_record_id;
                    if (row.CAGE_TYPE == 5) mergedData[mergeKey].editRollerId = row.game_record_id;
                }
                // Delete: use CAGE_TYPE 1 id when available (deletes whole buy-in + roller chips), else first record
                if (row.CAGE_TYPE == 1) {
                    mergedData[mergeKey].deletePrimaryId = row.game_record_id;
                } else if (!mergedData[mergeKey].deletePrimaryId) {
                    mergedData[mergeKey].deletePrimaryId = row.game_record_id;
                }

                // Process the row based on CAGE_TYPE - same logic as game list
                if (row.CAGE_TYPE == 1) { // BUY IN
                    const buyInAmount = (row.CC_CHIPS || 0) + (row.NN_CHIPS || 0);
                    var trans = parseInt(row.TRANSACTION, 10) || 1;
                    const rowTs = new Date(row.record_date).getTime();
                    const isInitialBuyinRow = initialBuyinTimestamp !== null && rowTs === initialBuyinTimestamp;
                    if (!isInitialBuyinRow) {
                        // This is an additional buy-in
                        mergedData[mergeKey].additional_buyin += buyInAmount;
                        mergedData[mergeKey].additional_buyin_nn += (row.NN_CHIPS || 0);  // Track NN separately
                        mergedData[mergeKey].additional_buyin_type = trans;
                        total_nn += (row.NN_CHIPS || 0);
                        total_cc += (row.CC_CHIPS || 0);
                    } else {
                        // This is the initial buy-in
                        mergedData[mergeKey].buy_in += buyInAmount;
                        mergedData[mergeKey].buy_in_nn += (row.NN_CHIPS || 0);  // Track NN separately
                        mergedData[mergeKey].buy_in_type = trans;
                        total_nn_init += (row.NN_CHIPS || 0);
                        total_cc_init += (row.CC_CHIPS || 0);
                    }
                }
                if (row.CAGE_TYPE == 2) { // CASH OUT
                    const cashOutAmount = (row.CC_CHIPS || 0) + (row.NN_CHIPS || 0);
                    mergedData[mergeKey].cash_out += cashOutAmount;
                    mergedData[mergeKey].cash_out_nn += (row.NN_CHIPS || 0);
                    total_cash_out_nn += (row.NN_CHIPS || 0);
                    total_cash_out_cc += (row.CC_CHIPS || 0);
                    // Track NN and CC chips for CASH OUT transactions
                    mergedData[mergeKey].nn += (row.NN_CHIPS || 0);
                    mergedData[mergeKey].cc += (row.CC_CHIPS || 0);
                    // Track transaction type for CASH OUT (1=Cash, 2=Deposit, 3=Marker)
                    var cashTrans = parseInt(row.TRANSACTION, 10) || 1;
                    mergedData[mergeKey].cash_out_type = cashTrans;
                }
                if (row.CAGE_TYPE == 3) { // TOTAL ROLLING
                    const rollingAmount = (row.AMOUNT || 0) + (row.NN_CHIPS || 0) + (row.CC_CHIPS || 0);
                    mergedData[mergeKey].total_rolling += rollingAmount;
                    // For calculation: AMOUNT + NN only (exclude CC chips)
                    mergedData[mergeKey].total_rolling_for_calc += (row.AMOUNT || 0) + (row.NN_CHIPS || 0);
                    total_rolling += (row.AMOUNT || 0);
                    total_rolling_nn += (row.NN_CHIPS || 0);
                    total_rolling_cc += (row.CC_CHIPS || 0);
                    // Track NN and CC chips for TOTAL ROLLING transactions only
                    mergedData[mergeKey].nn += (row.NN_CHIPS || 0);
                    mergedData[mergeKey].cc += (row.CC_CHIPS || 0);
                }
                if (row.CAGE_TYPE == 4) { // REAL ROLLING
                    const realRollingAmount = (row.AMOUNT || 0) + (row.NN_CHIPS || 0) + (row.CC_CHIPS || 0);
                    mergedData[mergeKey].real_rolling += realRollingAmount;
                    // For calculation: AMOUNT + NN + CC (all included)
                    mergedData[mergeKey].real_rolling_for_calc += (row.AMOUNT || 0) + (row.NN_CHIPS || 0) + (row.CC_CHIPS || 0);
                    total_rolling_real += (row.AMOUNT || 0);
                    total_rolling_nn_real += (row.NN_CHIPS || 0);
                    total_rolling_cc_real += (row.CC_CHIPS || 0);
                    // Track NN and CC chips for REAL ROLLING transactions only
                    mergedData[mergeKey].nn += (row.NN_CHIPS || 0);
                    mergedData[mergeKey].cc += (row.CC_CHIPS || 0);
                }
                if (row.CAGE_TYPE == 5) { // ROLLER CHIPS
                    // ROLLER CHIPS - tracked separately for display purposes
                    // Use ROLLER_NN_CHIPS and ROLLER_CC_CHIPS columns
                    // ROLLER_TRANSACTION: 1 = ADD (add), 2 = RETURN (subtract)
                    if (!mergedData[mergeKey].roller_nn) mergedData[mergeKey].roller_nn = 0;
                    if (!mergedData[mergeKey].roller_cc) mergedData[mergeKey].roller_cc = 0;
                    var rollerTransaction = row.ROLLER_TRANSACTION || 1; // Default to ADD if null
                    if (rollerTransaction == 1) {
                        // ADD - add the values
                        mergedData[mergeKey].roller_nn += (row.ROLLER_NN_CHIPS || 0);
                        mergedData[mergeKey].roller_cc += (row.ROLLER_CC_CHIPS || 0);
                    } else if (rollerTransaction == 2) {
                        // RETURN - subtract the values
                        mergedData[mergeKey].roller_nn -= (row.ROLLER_NN_CHIPS || 0);
                        mergedData[mergeKey].roller_cc -= (row.ROLLER_CC_CHIPS || 0);
                        mergedData[mergeKey].roller_return_cc += (row.ROLLER_CC_CHIPS || 0);  // Track roller return CC for this row
                        total_roller_return_cc += (row.ROLLER_CC_CHIPS || 0);  // Track roller return CC for total rolling
                    }
                }
            });

            // I-clear ang DataTable
            dataTable.clear();

            // Calculate totals from merged data for display
            let totalBuyIn = 0;
            let totalAdditionalBuyIn = 0;
            let totalCashOut = 0;
            let totalRealRolling = 0;
            let totalRolling = 0;
            let totalNN = 0;
            let totalCC = 0;
            let totalRollerNN = 0;
            let totalRollerCC = 0;

            const sortedDates = Object.keys(mergedData).sort(function (a, b) {
                const ta = mergedData[a].timestamp || 0;
                const tb = mergedData[b].timestamp || 0;
                if (ta !== tb) return ta - tb;
                return (mergedData[a].sortId || 0) - (mergedData[b].sortId || 0);
            });

            for (const date of sortedDates) {
                const rowData = mergedData[date];
                totalBuyIn += rowData.buy_in;
                totalAdditionalBuyIn += rowData.additional_buyin;
                totalCashOut += rowData.cash_out;
                totalRealRolling += rowData.real_rolling;
                totalNN += rowData.nn;
                totalCC += rowData.cc;
                totalRollerNN += (rowData.roller_nn || 0);
                totalRollerCC += (rowData.roller_cc || 0);
            }
            
            // Calculate total roller chips
            let totalRollerChips = totalRollerNN + totalRollerCC;
            
            // Compute running total rolling: Follow same logic as game_list_data (reloadData function)
            // Formula: total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn
            // Note: Buy-in amounts are NOT included here - they are separate from rolling transactions
            // Note: CC chips from CAGE_TYPE == 3 (TOTAL ROLLING) should NOT be included
            // Note: CC chips from CAGE_TYPE == 4 (REAL ROLLING) SHOULD be included
            var totalRollingCCWithReturns = total_roller_return_cc;  // Only include roller return CC, exclude CC from CAGE_TYPE == 3
            var total_rolling_chips_calc = total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;
            
            // Compute running total rolling for display (per row):
            // Follow same logic as game_list_data: CAGE_TYPE 3 (AMOUNT + NN, no CC) + CAGE_TYPE 4 (AMOUNT + NN + CC) + roller return CC - cash out NN
            let runningTotalRolling = 0;
            for (const date of sortedDates) {
                const rowData = mergedData[date];
                const cashOutNN = rowData.cash_out_nn || 0;
                // Calculate rolling for this row following game_list_data logic
                const rowRolling = (rowData.total_rolling_for_calc || 0) + (rowData.real_rolling_for_calc || 0) + (rowData.roller_return_cc || 0) - cashOutNN;
                runningTotalRolling += rowRolling;
                rowData.total_rolling_actual = runningTotalRolling;
            }
            totalRolling = total_rolling_chips_calc;  // Use the calculated total (matches game_list_data formula)

            // Prepare all rows data
            const allRows = [];
            
            // Add total row first
            allRows.push([
                '<strong>TOTAL</strong>',
                '<strong>' + totalBuyIn.toLocaleString() + '</strong>',
                '<strong>' + totalAdditionalBuyIn.toLocaleString() + '</strong>',
                '<strong>' + totalCashOut.toLocaleString() + '</strong>',
                '<strong>' + totalRealRolling.toLocaleString() + '</strong>',
                '<strong>' + totalRolling.toLocaleString() + '</strong>',
                // '<strong>' + totalNN.toLocaleString() + '</strong>',
                // '<strong>' + totalCC.toLocaleString() + '</strong>',
				'',
				'',
                '<strong>' + totalRollerChips.toLocaleString() + '</strong>',
                ''  // Empty for action column
            ]);

            // Add individual records (color buy-in / additional_buyin / cash_out only when value > 0 and deposit/marker/credit)
            function formatBuyinCell(val, transType) {
                var num = parseFloat(val) || 0;
                var str = num.toLocaleString();
                if (num === 0) return str;
                if (transType === 2) return '<span class="rolling-cell rolling-cell-deposit">' + str + '</span>';
                if (transType === 3) return '<span class="rolling-cell rolling-cell-marker">' + str + '</span>';
                // For cash-out via credit (TRANSACTION = 4), also use blue marker style
                if (transType === 4) return '<span class="rolling-cell rolling-cell-marker">' + str + '</span>';
                return str;
            }
            function buildActionButtons(rowData) {
                const gameEnded = rowData.game_status == 1 && userPermissions !== 0;
                const deleteId = rowData.deletePrimaryId;
                if (gameEnded) {
                    return `<div class="btn-group">
                        <button type="button" class="btn btn-sm btn-danger-subtle" disabled aria-label="Game Ended">
                            <i class="fa fa-trash-alt"></i>
                        </button>
                    </div>`;
                }
                const editIds = [];
                if (rowData.editBuyinId) editIds.push('buyin:' + rowData.editBuyinId);
                if (rowData.editCashoutId) editIds.push('cashout:' + rowData.editCashoutId);
                if (rowData.editRollingId) editIds.push('rolling:' + rowData.editRollingId);
                if (rowData.editRollerId) editIds.push('roller:' + rowData.editRollerId);
                const editIdsStr = editIds.join(',');
                const editBtn = (userPermissions === 0 && editIdsStr)
                    ? `<button type="button" onclick="edit_game_record_row(this)" class="btn btn-sm btn-primary-subtle" data-edit-ids="${editIdsStr}" data-bs-toggle="tooltip" aria-label="Edit" title="Edit"><i class="fa fa-edit"></i></button>`
                    : '';
                const deleteBtn = deleteId ? `<button type="button" onclick="archive_game_record(${deleteId})" class="btn btn-sm btn-danger-subtle" data-bs-toggle="tooltip" aria-label="Archive" title="Archive"><i class="fa fa-trash-alt"></i></button>` : '';
                return `<div class="btn-group">${editBtn}${deleteBtn}</div>`;
            }
            for (const date of sortedDates) {
                const rowData = mergedData[date];
                const rollerChips = (rowData.roller_nn || 0) + (rowData.roller_cc || 0);
                var buyInType = parseInt(rowData.buy_in_type, 10) || 1;
                var addBuyinType = parseInt(rowData.additional_buyin_type, 10) || 1;
                var cashOutType = parseInt(rowData.cash_out_type, 10) || 1;
                allRows.push([
                    rowData.displayDate || date,
                    formatBuyinCell(rowData.buy_in, buyInType),
                    formatBuyinCell(rowData.additional_buyin, addBuyinType),
                    formatBuyinCell(rowData.cash_out, cashOutType),
                    rowData.real_rolling.toLocaleString(),
                    (rowData.total_rolling_actual || 0).toLocaleString(),
                    rowData.nn.toLocaleString(),
                    rowData.cc.toLocaleString(),
                    rollerChips.toLocaleString(),
                    buildActionButtons(rowData)
                ]);
            }

            // Add all rows at once to maintain order
            dataTable.rows.add(allRows).draw();
        },
        error: function (xhr, status, error) {
            console.error('Error fetching data:', error);
        }
    });
}

	reloadDataRecord()
}

function checkPermissionToDeleteHistory(id) {
    // Check if the user has the necessary permission before proceeding
    $.ajax({
        url: '/check-permission',
        type: 'POST',
        success: function (response) {
            if (response.permissions === 11) {
                // Proceed with deletion if permission is valid
                archive_game_record(id);
            } else {
                // Show an error SweetAlert if permission is not sufficient
                Swal.fire({
                    title: 'Access Denied',
                    text: 'Not allowed to delete this data.',
                    icon: 'error',
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#6f9c40'
                });
            }
        },
        error: function () {
            Swal.fire({
                title: 'Error',
                text: 'Unable to check permissions at this time.',
                icon: 'error',
                confirmButtonText: 'OK',
                confirmButtonColor: '#6f9c40'
            });
        }
    });
}

	function showEndGameAlert() {
		Swal.fire({
			title: 'Access Denied',
			text: 'You do not have permission to change the game status.',
			icon: 'warning',
			confirmButtonText: 'OK',
			confirmButtonColor: '#6f9c40'
		});
	}

	// SweetAlert function
	function showSweetAlert() {
		Swal.fire({
			title: 'Access Denied',
			text: 'You do not have permission to change the game status.',
			icon: 'warning',
			confirmButtonText: 'OK',
			confirmButtonColor: '#6f9c40'
		});
	}

	function showSettledAlert() {
		Swal.fire({
			title: 'Game Settled',
			text: 'Cannot change status because this game is already settled.',
			icon: 'error',
			confirmButtonText: 'OK',
			confirmButtonColor: '#6f9c40'
		});
	}


function changeStatus(id, net, account, total_amount, total_cash_out_chips, total_rolling_chips, WinLoss, currentStatus) {
	$('#modal-change_status').modal('show');

	// Store settlement preview data for validation
	const $changeStatusModal = $('#modal-change_status');
	$changeStatusModal.data('settlementValue', net);
	$changeStatusModal.data('servicesValue', null); // reset while loading
	loadServiceTotalForStatusModal(id);

	$('.txtGameId').val(id);
	$('.txtAccountCode').val(account);
	$('.txtCapital').val(total_amount);
	$('.txtFinalChips').val(total_cash_out_chips);
	$('.txtTotalRolling').val(total_rolling_chips);
	$('.txtWinloss').val(WinLoss);

	// Reset roller chips return fields and hide section immediately
	$('.txtReturnRollerNN').val('');
	$('.txtReturnRollerCC').val('');
	$('#roller-chips-return-section').hide();

	game_id = id;
	
	// If current status is PENDING (3), auto-select END GAME (1)
	if (currentStatus == 3) {
		$('#status').val('1'); // Select END GAME
	} else {
		// Reset status select to placeholder for other statuses
		$('#status option:first').prop('selected', true);
		$('#status').trigger('change');
	}
	
	// Fetch game records to calculate required roller chips return
	$.ajax({
		url: '/game_list/' + id + '/record',
		method: 'GET',
		success: function (response) {
			var totalAddNN = 0;
			var totalAddCC = 0;
			var totalReturnNN = 0;
			var totalReturnCC = 0;
			
			response.forEach(function (row) {
				if (row.CAGE_TYPE == 5) { // ROLLER CHIPS
					if (row.ROLLER_TRANSACTION == 1) { // ADD
						totalAddNN += (row.ROLLER_NN_CHIPS || 0);
						totalAddCC += (row.ROLLER_CC_CHIPS || 0);
					} else if (row.ROLLER_TRANSACTION == 2) { // RETURN
						totalReturnNN += (row.ROLLER_NN_CHIPS || 0);
						totalReturnCC += (row.ROLLER_CC_CHIPS || 0);
					}
				}
			});
			
			// Calculate required return amounts
			var requiredReturnNN = totalAddNN - totalReturnNN;
			var requiredReturnCC = totalAddCC - totalReturnCC;
			var requiredReturnTotal = Math.max(0, requiredReturnNN + requiredReturnCC);
			
			// Store values for validation
			$('#modal-change_status').data('requiredReturnNN', requiredReturnNN);
			$('#modal-change_status').data('requiredReturnCC', requiredReturnCC);
			$('#modal-change_status').data('requiredReturnTotal', requiredReturnTotal);
			$('#modal-change_status').data('totalAddNN', totalAddNN);
			$('#modal-change_status').data('totalAddCC', totalAddCC);
			$('#modal-change_status').data('totalReturnNN', totalReturnNN);
			$('#modal-change_status').data('totalReturnCC', totalReturnCC);
			
			// Display totals in modal
			$('#required-return-total-add-nn').text(parseFloat(totalAddNN).toLocaleString());
			$('#required-return-total-add-cc').text(parseFloat(totalAddCC).toLocaleString());
			$('#required-return-total-return-nn').text(parseFloat(totalReturnNN).toLocaleString());
			$('#required-return-total-return-cc').text(parseFloat(totalReturnCC).toLocaleString());
			$('#required-return-total').text(parseFloat(requiredReturnTotal).toLocaleString());
			$('#required-total-display').text(parseFloat(requiredReturnTotal).toLocaleString());
			
			// Show/hide roller chips return section based on whether there are required returns
			// Always remove previous event handlers first
			$('#status').off('change.rollerchips');
			
			// Create a unified event handler that checks requiredReturnTotal before showing
			$('#status').on('change.rollerchips', function() {
				var currentRequiredTotal = parseFloat($('#modal-change_status').data('requiredReturnTotal')) || 0;
				if ($(this).val() == '1' && currentRequiredTotal > 0) { // END GAME and has required return
					$('#roller-chips-return-section').show();
				} else {
					// Clear input fields when changing to ON GAME or other status, or if no required return
					$('#txtReturnRollerNN').val('');
					$('#txtReturnRollerCC').val('');
					$('#roller-chips-return-section').hide();
				}
			});
			
			// Show section only if requiredReturnTotal > 0
			if (requiredReturnTotal > 0) {
				// If current status is PENDING (3) or status is already END GAME (1), show the section
				if (currentStatus == 3 || $('#status').val() == '1') {
					$('#roller-chips-return-section').show();
				}
			} else {
				// No required return - clear fields and hide section (always hide if 0)
				$('#txtReturnRollerNN').val('');
				$('#txtReturnRollerCC').val('');
				$('#roller-chips-return-section').hide();
			}
		},
		error: function (xhr, status, error) {
			console.error('Error fetching game records:', error);
		}
	});
}

function loadServiceTotalForStatusModal(gameId) {
	const $modal = $('#modal-change_status');
	if (!$modal.length) return;

	$modal.data('servicesValue', null);
	$.ajax({
		url: `/game_services/${gameId}`,
		method: 'GET',
		success: function (list) {
			const totalServices = Array.isArray(list)
				? list.reduce((sum, item) => {
					const transactionId = parseInt(item.TRANSACTION_ID || item.transaction_id || 0, 10);
					if (transactionId !== 3) {
						return sum;
					}
					const amt = parseFloat(item.AMOUNT || item.amount || 0);
					return sum + (isNaN(amt) ? 0 : amt);
				}, 0)
				: 0;

			$modal.data('servicesValue', totalServices);
		},
		error: function () {
			$modal.data('servicesValue', 0);
		}
	});
}

function openServices(id, guestName, gameStatus, settled, agentId) {
	// Track settled state
	_servicesSettled = parseInt(settled || 0, 10);

	// Show Services modal and populate selected game id and guest name
	const decodedGuest = decodeURIComponent(guestName || '');
	$('#modal-services').modal('show');
	const title = decodedGuest ? `Services - Game ${id} | ${decodedGuest}` : `Services - Game ${id}`;
	$('#modal-services-label').text(title);
	const $gameInput = $('#services-game-id-input');
	if ($gameInput.length) $gameInput.val(id);
	const $guestInput = $('#services-guest-name-input');
	if ($guestInput.length) $guestInput.val(decodedGuest || '');
	const $agentInput = $('#services-agent-id-input');
	if ($agentInput.length) $agentInput.val(agentId != null ? agentId : '');

	// Hide save form only when already settled (Super admin can edit even when settled)
	const userPermissions = parseInt(document.getElementById('user-role')?.getAttribute('data-permissions') || '99', 10);
	const showActions = parseInt(settled || 0, 10) !== 1 || userPermissions === 0;
	$('#services-save-btn').toggle(showActions);
	$('#services-add-wrap').toggle(showActions);

	// Load existing services
	loadServicesList(id);

	// Clear inputs
	$('#services-type').val('');
	$('#services-amount').val('');
	$('#services-remarks').val('');
	$('input[name="services-transaction"]').prop('checked', false);
	$('input[name="services-transaction"][value="3"]').prop('checked', true);
}

function loadServicesList(gameId) {
	$.ajax({
		url: `/game_services/${gameId}`,
		method: 'GET',
		success: function (list) {
			renderServicesList(list || []);
		},
		error: function () {
			renderServicesList([]);
		}
	});
}

function formatServiceTransactionLabel(id) {
	const labels = {
		1: 'Cash',
		2: 'Deposit',
		3: 'Settle'
	};
	return labels[id] || '';
}

function renderServicesList(list) {
	const $tbody = $('#services-list-body');
	const $table = $('#services-list-tbl');
	const $total = $('#services-total');
	if (!$tbody.length) return;

	const data = Array.isArray(list) ? list : [];
	const userPermissions = parseInt(document.getElementById('user-role')?.getAttribute('data-permissions') || '99', 10);
	const isSettled = parseInt(_servicesSettled || 0, 10) === 1 && userPermissions !== 0; // Super admin can edit even when settled

	if ($.fn.DataTable.isDataTable($table)) {
		$table.DataTable().clear().destroy();
	}

	if (data.length === 0) {
		if ($total.length) $total.text('0');
		// Let DataTables render its own empty-table row to avoid column-count warnings
		$tbody.empty();
		$table.DataTable({
			paging: false,
			lengthChange: false,
			searching: false,
			ordering: false,
			info: false,
			autoWidth: false,
			language: { emptyTable: 'No services availed.' }
		});
		return;
	}

	const rows = data.map(item => {
		const id = item.IDNo || item.id || '';
		const service = item.SERVICE_TYPE || item.service_type || '';
		const amount = item.AMOUNT || item.amount || 0;
		const remarks = item.REMARKS || item.remarks || '';
		const processed = item.PROCESSED_BY || item.processed_by || item.ENCODED_BY || '';
		const dtRaw = item.DATE || item.ENCODED_DT || item.encoded_dt || item.date || '';
		const formattedDt = dtRaw ? moment(dtRaw).format('MMM DD, HH:mm') : '';
		const transactionId = parseInt(item.TRANSACTION_ID || item.transaction_id || 1, 10);
		const transactionLabel = formatServiceTransactionLabel(transactionId);
		return `<tr>
			<td>${service}</td>
			<td class="text-end">${parseFloat(amount).toLocaleString()}</td>
			<td>${remarks || ''}</td>
			<td>${transactionLabel || '-'}</td>
			<td>${processed || ''}</td>
			<td>${formattedDt}</td>
			<td class="text-center">
				<button type="button"
					class="btn btn-sm btn-info-subtle action-btn-square me-1 service-edit-btn"
					title="Edit"
					${isSettled ? 'disabled aria-disabled="true"' : ''}
					data-id="${id}"
					data-service="${service}"
					data-amount="${amount}"
					data-remarks="${encodeURIComponent(remarks || '')}"
					data-transaction="${transactionId}">
					<i class="fa fa-edit"></i>
				</button>
				<button type="button"
					class="btn btn-sm btn-danger-subtle action-btn-square service-delete-btn"
					title="Delete"
					${isSettled ? 'disabled aria-disabled="true"' : ''}
					data-id="${id}">
					<i class="fa fa-trash-alt"></i>
				</button>
			</td>
		</tr>`;
	});

	// Total amount of all services
	const totalAmt = data.reduce((sum, item) => {
		const amt = parseFloat(item.AMOUNT || item.amount || 0);
		return sum + (isNaN(amt) ? 0 : amt);
	}, 0);
	if ($total.length) $total.text(totalAmt.toLocaleString());

	$tbody.html(rows.join(''));
	$table.DataTable({
		paging: true,
		pageLength: 5,
		lengthChange: false,
		searching: false,
		ordering: false,
		info: true,
		autoWidth: false
	});

	// View-only: disable delete/edit in Services modal after list is rendered (buttons are dynamic)
	if (window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly()) {
		var modalEl = document.getElementById('modal-services');
		if (modalEl) window.PermissionViewOnly.disableModalSubmitAndDelete(null, modalEl);
	}
}

// Save service
$(document).on('click', '#services-save-btn', function (e) {
	e.preventDefault();
	const gameId = $('#services-game-id-input').val();
	const type = $('#services-type').val();
	const amountRaw = $('#services-amount').val().replace(/,/g, '').trim();
	const amount = parseFloat(amountRaw) || 0;
	const remarks = $('#services-remarks').val().trim();
	const editId = $('#services-edit-id-input').val();
	const transactionId = $('input[name="services-transaction"]:checked').val();

	if (!gameId || !type) {
		Swal.fire({ icon: 'warning', title: 'Missing fields', text: 'Select service type and enter amount.' });
		return;
	}
	if (!transactionId) {
		Swal.fire({ icon: 'warning', title: 'Missing fields', text: 'Select a transaction type.' });
		return;
	}

	const $btn = $('#services-save-btn');
	const isEdit = !!editId;
	let agentId = parseInt($('#services-agent-id-input').val(), 10);
	if (Number.isNaN(agentId)) {
		agentId = null;
	}
	
	// Build confirmation message
	var confirmationMessage = `Confirm ${isEdit ? 'Update' : 'Add'} Service:<br><br>`;
	confirmationMessage += `<strong>Service Type:</strong> ${type.toUpperCase()}<br>`;
	confirmationMessage += `<strong>Amount:</strong> ${parseFloat(amount).toLocaleString()}<br>`;
	confirmationMessage += `<strong>Transaction:</strong> ${formatServiceTransactionLabel(parseInt(transactionId, 10))}<br>`;
	if (remarks) {
		confirmationMessage += `<strong>Remarks:</strong> ${remarks}<br>`;
	}
	
	Swal.fire({
		icon: 'question',
		title: `Confirm ${isEdit ? 'Update' : 'Add'} Service`,
		html: confirmationMessage + '<br>Are you sure you want to proceed?',
		showCancelButton: true,
		confirmButtonText: 'Yes, Confirm',
		cancelButtonText: 'Cancel',
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		allowOutsideClick: false,
		allowEscapeKey: false
	}).then((result) => {
		if (result.isConfirmed) {
			// User confirmed, proceed with transaction
			$btn.prop('disabled', true).text('Saving...');

			const url = isEdit ? `/game_services/${editId}` : '/add_game_services';
			const method = isEdit ? 'PUT' : 'POST';

			$.ajax({
				url,
				method,
				data: { game_id: gameId, service_type: type, amount, remarks, transaction_id: transactionId, agent_id: agentId },
				success: function (list) {
					// Show success message
					Swal.fire({
						icon: 'success',
						title: 'Success!',
						text: `Service ${isEdit ? 'updated' : 'added'} successfully.`,
						confirmButtonText: 'OK',
						allowOutsideClick: false,
						allowEscapeKey: false
					}).then(() => {
						renderServicesList(list || []);
						if (typeof window.reloadData === 'function') {
							window.reloadData();
						}
						$('#services-amount').val('');
						$('#services-remarks').val('');
						$('#services-type').val('');
						$('#services-edit-id-input').val('');
						$('#services-save-btn').text('Save');
					});
				},
				error: function (xhr) {
					const msg = xhr.responseJSON?.error || 'Failed to save service.';
					Swal.fire({ icon: 'error', title: 'Error', text: msg });
				},
				complete: function () {
					$btn.prop('disabled', false).text('Save');
				}
			});
		} else {
			// User cancelled, button stays enabled
			$btn.prop('disabled', false).text('Save');
		}
	});
});

// Edit button handler (delegated)
$(document).on('click', '.service-edit-btn', function () {
	const $btn = $(this);
	if ($btn.prop('disabled')) return;
	const id = $btn.data('id');
	const service = $btn.data('service');
	const amount = $btn.data('amount');
	const remarks = decodeURIComponent($btn.attr('data-remarks') || '');
	const transaction = $btn.data('transaction');
	editService(id, service, amount, remarks, transaction);
});

// Delete button handler (delegated)
$(document).on('click', '.service-delete-btn', function () {
	const $btn = $(this);
	if ($btn.prop('disabled')) return;
	const id = $btn.data('id');
	deleteService(id);
});

// Save edit service
$(document).on('click', '#services-edit-save-btn', function (e) {
	e.preventDefault();
	const serviceId = $('#services-edit-id').val();
	const gameId = $('#services-game-id-input').val();
	const type = $('#services-edit-type').val();
	const amountRaw = $('#services-edit-amount').val().replace(/,/g, '').trim();
	const amount = parseFloat(amountRaw) || 0;
	const remarks = $('#services-edit-remarks').val().trim();
	const transactionId = $('input[name="services-edit-transaction"]:checked').val();

	if (!serviceId || !gameId || !type) {
		Swal.fire({ icon: 'warning', title: 'Missing fields', text: 'Select service type and enter amount.' });
		return;
	}
	if (!transactionId) {
		Swal.fire({ icon: 'warning', title: 'Missing fields', text: 'Select a transaction type.' });
		return;
	}

	const $btn = $('#services-edit-save-btn');
	
	// Build confirmation message
	var confirmationMessage = `Confirm Update Service:<br><br>`;
	confirmationMessage += `<strong>Service Type:</strong> ${type.toUpperCase()}<br>`;
	confirmationMessage += `<strong>Amount:</strong> ${parseFloat(amount).toLocaleString()}<br>`;
	confirmationMessage += `<strong>Transaction:</strong> ${formatServiceTransactionLabel(parseInt(transactionId, 10))}<br>`;
	if (remarks) {
		confirmationMessage += `<strong>Remarks:</strong> ${remarks}<br>`;
	}
	
	Swal.fire({
		icon: 'question',
		title: 'Confirm Update Service',
		html: confirmationMessage + '<br>Are you sure you want to proceed?',
		showCancelButton: true,
		confirmButtonText: 'Yes, Confirm',
		cancelButtonText: 'Cancel',
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		allowOutsideClick: false,
		allowEscapeKey: false
	}).then((result) => {
		if (result.isConfirmed) {
			// User confirmed, proceed with transaction
			$btn.prop('disabled', true).text('Saving...');

			$.ajax({
				url: `/game_services/${serviceId}`,
				method: 'PUT',
				data: { game_id: gameId, service_type: type, amount, remarks, transaction_id: transactionId },
				success: function (list) {
					// Show success message
					Swal.fire({
						icon: 'success',
						title: 'Success!',
						text: 'Service updated successfully.',
						confirmButtonText: 'OK',
						allowOutsideClick: false,
						allowEscapeKey: false
					}).then(() => {
						renderServicesList(list || []);
						if (typeof window.reloadData === 'function') {
							window.reloadData();
						}
						$('#modal-services-edit').modal('hide');
						$('#services-edit-id').val('');
						$('#services-edit-type').val('');
						$('#services-edit-amount').val('');
						$('#services-edit-remarks').val('');
					});
				},
				error: function (xhr) {
					const msg = xhr.responseJSON?.error || 'Failed to save service.';
					Swal.fire({ icon: 'error', title: 'Error', text: msg });
				},
				complete: function () {
					$btn.prop('disabled', false).text('Save');
				}
			});
		} else {
			// User cancelled, button stays enabled
			$btn.prop('disabled', false).text('Save');
		}
	});
});

// Preload account data silently in the background (no DOM manipulation)
function preloadAccounts() {
	// If already cached or loading, skip
	if (Array.isArray(_accountOptionsCache) || _accountOptionsPromise) {
		return _accountOptionsPromise || Promise.resolve(_accountOptionsCache);
	}

	// Fetch data silently without touching DOM
	_accountOptionsPromise = new Promise(function (resolve, reject) {
		$.ajax({
			url: '/account_data',
			method: 'GET',
			success: function (response) {
				_accountOptionsCache = Array.isArray(response) ? response : [];
				resolve(_accountOptionsCache);
			},
			error: function (xhr, status, error) {
				console.error('Error fetching account options:', error);
				_accountOptionsCache = [];
				reject(error);
			},
			complete: function () {
				_accountOptionsPromise = null;
			}
		});
	});

	return _accountOptionsPromise;
}

function get_account() {
	var $select = $('#txtTrans');
	if (!$select.length) return; // Select doesn't exist yet

	// Helper to populate select from cached data
	function populateSelect(options) {
		// Destroy Select2 first
		if ($select.data('select2')) {
			$select.select2('destroy');
		}
		
		$select.empty();
		$select.append($('<option>', { value: '', text: '--SELECT ACCOUNT--' }));

		if (Array.isArray(options) && options.length > 0) {
			options.forEach(function (option) {
				var $opt = $('<option>', {
					value: option.account_id,
					text: option.agent_name + ' (' + option.agent_code + ')'
				});
				var guestId = option.guest_id || option.GUESTNo || '';
				$opt.attr('data-guest-id', guestId);
				$opt.attr('data-agent-id', option.agent_id || '');
				$select.append($opt);
			});
		}

		// Reinitialize Select2 with fresh options
		$select.select2({
			placeholder: 'Select an option',
			dropdownParent: '#modal-new-game-list',
		});
		syncSelectedGuestIdFromAccount();
		loadGuestsForSelectedAccount();
	}

	// If data is already cached, populate immediately (no delay, no disabled state)
	if (Array.isArray(_accountOptionsCache)) {
		populateSelect(_accountOptionsCache);
		return;
	}

	// If still loading, wait for it and populate when ready
	if (_accountOptionsPromise) {
		_accountOptionsPromise.then(function(options) {
			populateSelect(options);
		}).catch(function() {
			populateSelect([]);
		});
		return;
	}

	// Shouldn't happen if preload works, but fallback just in case
	preloadAccounts().then(populateSelect).catch(function() {
		populateSelect([]);
	});
}

// Preload accounts IMMEDIATELY - start fetching as soon as script loads (before DOM ready)
// This ensures data is ready when user clicks "New Game"
preloadAccounts();

// Also ensure it's ready when DOM is ready
$(document).ready(function () {
	// If not already cached, start preload
	if (!Array.isArray(_accountOptionsCache) && !_accountOptionsPromise) {
		preloadAccounts();
	}

	$('#txtTrans').on('change', function () {
		if ($(this).attr('data-readonly') === '1') {
			var lockedAccount = $(this).attr('data-locked-value');
			if (lockedAccount) {
				$(this).val(lockedAccount).trigger('change.select2');
			}
			return;
		}
		syncSelectedGuestIdFromAccount();
		loadGuestsForSelectedAccount();
	});

	$('#txtGuestGame').on('change', function () {
		if ($(this).attr('data-readonly') === '1') {
			var lockedGuest = $(this).attr('data-locked-value');
			if (lockedGuest) {
				$(this).val(lockedGuest).trigger('change.select2');
				$('#txtGuestId').val(lockedGuest);
			}
			return;
		}
		syncSelectedGuestIdFromGuestDropdown();
	});

	$('#txtTrans, #txtGuestGame').on('select2:opening', function (e) {
		if ($(this).attr('data-readonly') === '1') {
			e.preventDefault();
		}
	});

	$('#modal-new-game-list').on('hidden.bs.modal', function () {
		resetNewGameInputs();
		resetNewGameSubmitButton();
		$('#txtTrans').prop('disabled', false).removeAttr('data-readonly data-locked-value');
		$('#txtGuestGame').prop('disabled', true).removeAttr('data-readonly data-locked-value');
	});
});



function archive_game_list(id) {
	Swal.fire({
		title: 'Are you sure you want to delete this?',
		icon: 'warning',
		showCancelButton: true,
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		confirmButtonText: 'Yes'
	}).then((result) => {
		if (result.isConfirmed) {
			$.ajax({
				url: '/game_list/remove/' + id,
				type: 'PUT',
				success: function (response) {
					window.location.reload();
				},
				error: function (error) {
					console.error('Error deleting game list:', error);
				}
			});
		}
	})
}

// Delete game (Super Admin only) - soft delete game_list, game_record, account_ledger; excludes game_services & daily_settlement_games
function delete_game_list(id) {
	Swal.fire({
		title: 'Delete Game?',
		html: 'This will delete the<strong> Game</strong>  and related records.',
		icon: 'warning',
		showCancelButton: true,
		confirmButtonColor: '#d33',
		cancelButtonColor: '#6c757d',
		confirmButtonText: 'Yes, Delete'
	}).then((result) => {
		if (result.isConfirmed) {
			$.ajax({
				url: '/game_list/delete/' + id,
				type: 'DELETE',
				success: function (response) {
					Swal.fire({
						icon: 'success',
						title: 'Deleted',
						text: response.message || 'Game deleted successfully.'
					}).then(() => window.location.reload());
				},
				error: function (xhr) {
					const msg = xhr.responseJSON?.error || 'Failed to delete game.';
					Swal.fire({
						icon: 'error',
						title: 'Error',
						text: msg
					});
				}
			});
		}
	});
}

function archive_game_record(id) {
	Swal.fire({
		title: 'Are you sure you want to delete this?',
		icon: 'warning',
		showCancelButton: true,
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		confirmButtonText: 'Yes'
	}).then((result) => {
		if (result.isConfirmed) {
			$.ajax({
				url: '/game_record/remove/' + id,
				type: 'PUT',
				success: function (response) {
					window.location.reload();
				},
				error: function (error) {
					console.error('Error deleting game list:', error);
				}
			});
		}
	})
}

function edit_game_record_row(btnEl) {
	const editIdsStr = btnEl.getAttribute('data-edit-ids') || '';
	if (!editIdsStr) return;
	const parts = editIdsStr.split(',');
	const editIds = {};
	parts.forEach(function (p) {
		const m = p.match(/^(\w+):(\d+)$/);
		if (m) editIds[m[1]] = parseInt(m[2], 10);
	});
	const ids = Object.values(editIds);
	if (ids.length === 0) return;

	$('#edit-form-buyin').hide();
	$('#edit-form-cashout').hide();
	$('#edit-form-rolling').hide();
	$('#edit-form-roller').hide();

	const results = [];
	let completed = 0;
	let hasError = false;
	ids.forEach(function (id, idx) {
		$.getJSON('/game_record/single/' + id)
			.done(function (rec) {
				results[idx] = rec;
			})
			.fail(function (xhr) {
				hasError = true;
				const msg = xhr.responseJSON?.error || 'Failed to load record.';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			})
			.always(function () {
				completed++;
				if (completed === ids.length && !hasError) {
					results.forEach(function (rec) {
						if (!rec || (rec.CAGE_TYPE === undefined && rec.cage_type === undefined)) return;
						const cageType = parseInt(rec.CAGE_TYPE || rec.cage_type, 10);
						function fmtNum(n) { var x = parseFloat(n) || 0; return isNaN(x) ? '0' : x.toLocaleString(); }
						if (cageType === 1) {
							$('#edit-buyin-nn').val(fmtNum(rec.NN_CHIPS || rec.nn_chips));
							$('#edit-buyin-cc').val(fmtNum(rec.CC_CHIPS || rec.cc_chips));
							$('#edit-form-buyin').show();
						} else if (cageType === 2) {
							$('#edit-cashout-nn').val(fmtNum(rec.NN_CHIPS || rec.nn_chips));
							$('#edit-cashout-cc').val(fmtNum(rec.CC_CHIPS || rec.cc_chips));
							$('#edit-form-cashout').show();
						} else if (cageType === 3 || cageType === 4) {
							$('#edit-rolling-cc').val(fmtNum(rec.CC_CHIPS || rec.cc_chips));
							$('#edit-form-rolling').show();
						} else if (cageType === 5) {
							$('#edit-roller-nn').val(fmtNum(rec.ROLLER_NN_CHIPS || rec.roller_nn_chips));
							$('#edit-roller-cc').val(fmtNum(rec.ROLLER_CC_CHIPS || rec.roller_cc_chips));
							$('#edit-form-roller').show();
						}
					});
					$('#modal-edit-game-record').data('editIds', editIds);
					$('#modal-edit-game-record').modal('show');
				}
			});
	});
}

function parseEditNum(val) { return parseFloat(String(val || '').replace(/,/g, '')) || 0; }

$(document).on('click', '#btn-save-edit-record', function () {
	const editIds = $('#modal-edit-game-record').data('editIds') || {};
	const updates = [];

	if (editIds.buyin && $('#edit-form-buyin').is(':visible')) {
		updates.push({ id: editIds.buyin, payload: { nn_chips: parseEditNum($('#edit-buyin-nn').val()), cc_chips: parseEditNum($('#edit-buyin-cc').val()) } });
	}
	if (editIds.cashout && $('#edit-form-cashout').is(':visible')) {
		updates.push({ id: editIds.cashout, payload: { nn_chips: parseEditNum($('#edit-cashout-nn').val()), cc_chips: parseEditNum($('#edit-cashout-cc').val()) } });
	}
	if (editIds.rolling && $('#edit-form-rolling').is(':visible')) {
		updates.push({ id: editIds.rolling, payload: { cc_chips: parseEditNum($('#edit-rolling-cc').val()) } });
	}
	if (editIds.roller && $('#edit-form-roller').is(':visible')) {
		updates.push({
			id: editIds.roller,
			payload: {
				roller_nn_chips: parseEditNum($('#edit-roller-nn').val()),
				roller_cc_chips: parseEditNum($('#edit-roller-cc').val())
			}
		});
	}

	if (updates.length === 0) {
		$('#modal-edit-game-record').modal('hide');
		return;
	}

	const putPromises = updates.map(function (u) {
		return $.ajax({
			url: '/game_record/edit/' + u.id,
			type: 'PUT',
			contentType: 'application/json',
			data: JSON.stringify(u.payload)
		});
	});
	$.when.apply($, putPromises).done(function () {
		$('#modal-edit-game-record').modal('hide');
		if (typeof reloadDataRecord === 'function') {
			reloadDataRecord();
		} else {
			window.location.reload();
		}
		Swal.fire({ icon: 'success', title: 'Saved', text: 'Game record updated successfully.', timer: 1500, showConfirmButton: false });
	}).fail(function (xhr) {
		const msg = xhr.responseJSON?.error || 'Failed to update record.';
		Swal.fire({ icon: 'error', title: 'Error', text: msg });
	});
});

function viewRecord(id) {
	record_id = id;
	window.location.href = '/game_record/' + id;
}

$(document).ready(function () {
	$("input[data-type='number']").on('input', function (event) {
		// skip formatting for arrow keys
		if (event.which >= 37 && event.which <= 40) {
			event.preventDefault();
			return;
		}
		const $this = $(this);
		let raw = $this.val() || '';

		// allow digits and a single decimal point; strip letters/symbols
		raw = raw.replace(/[^\d.]/g, '');
		const parts = raw.split('.');
		if (parts.length > 2) {
			raw = parts[0] + '.' + parts.slice(1).join('');
		}

		const [intPart, decPart] = raw.split('.');
		const formattedInt = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		const formatted = decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt;
		$this.val(formatted);
	});
})

function editService(id, service, amount, remarks, transaction) {
	const safeAmount = parseFloat(amount || 0);
	$('#services-edit-id').val(id || '');
	$('#services-edit-type').val(service || '');
	$('#services-edit-amount').val(isNaN(safeAmount) ? '' : safeAmount.toLocaleString());
	$('#services-edit-remarks').val(remarks || '');
	$('input[name="services-edit-transaction"]').prop('checked', false);
	const txnValue = parseInt(transaction, 10);
	if ([1, 2, 3].includes(txnValue)) {
		$(`input[name="services-edit-transaction"][value="${txnValue}"]`).prop('checked', true);
	}

	$('#modal-services-edit').modal('show');
}

function deleteService(id) {
	const gameId = $('#services-game-id-input').val();
	if (!id || !gameId) return;
	Swal.fire({
		title: 'Delete this service?',
		icon: 'warning',
		showCancelButton: true,
		confirmButtonText: 'Yes, delete',
		cancelButtonText: 'Cancel'
	}).then((result) => {
		if (!result.isConfirmed) return;

		$.ajax({
			url: `/game_services/${id}`,
			method: 'DELETE',
			data: { game_id: gameId },
			success: function (list) {
				renderServicesList(list || []);
				if (typeof window.reloadData === 'function') {
					window.reloadData();
				}
				$('#services-edit-id-input').val('');
				$('#services-save-btn').text('Save');
				$('#services-type').val('');
				$('#services-amount').val('');
				$('#services-remarks').val('');
				Swal.fire({
					icon: 'success',
					title: 'Service deleted',
					timer: 1200,
					showConfirmButton: false
				});
			},
			error: function (xhr) {
				const msg = xhr.responseJSON?.error || 'Failed to delete service.';
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		});
	});
}

function onlyNumberKey(evt) {

	let ASCIICode = (evt.which) ? evt.which : evt.keyCode
	if (ASCIICode > 31 && (ASCIICode < 48 || ASCIICode > 57))
		return false;
	return true;
}



//ON GAME LIST
$(document).ready(function () {
	if ($.fn.DataTable.isDataTable('#on-game-list-tbl')) {
		$('#on-game-list-tbl').DataTable().destroy();
	}

	var dataTable = $('#on-game-list-tbl').DataTable({
		columnDefs: [{
			createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
				$(cell).addClass('text-center');
			}
		}],
		createdRow: function (row, data, index) {

			if (parseInt(data[10].split(',').join('')) < 0) {
				$('td:eq(10)', row).css({
					'background-color': '#fff',
					'color': 'red'
				});
			}
		},
	});

	function reloadData_on_game() {

		$.ajax({
			url: '/on_game_list_data', // Endpoint to fetch data
			method: 'GET',
			success: function (data) {
				dataTable.clear();

				data.forEach(function (row) {

					var btn = `<div class="btn-group">
						<button type="button" onclick="viewRecord(${row.game_list_id})" class="btn btn-sm btn-alt-info action-btn-square js-bs-tooltip-enabled"
						data-bs-toggle="tooltip" aria-label="Details" data-bs-original-title="Details">
						<i class="fa fa-file-alt"></i>
						</button>
						<button type="button" onclick="changeStatus(${row.game_list_id})" class="btn btn-sm btn-alt-warning action-btn-square js-bs-tooltip-enabled"
						data-bs-toggle="tooltip" aria-label="Details" data-bs-original-title="Status">
						<i class="fa fa-exchange-alt"></i>
						</button>
						<button type="button" onclick="archive_game_list(${row.game_list_id})" class="btn btn-sm btn-danger-subtle action-btn-square js-bs-tooltip-enabled"
						data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
						<i class="fa fa-trash-alt"></i>
						</button>
					</div>`;

                    var btn_his = `<div class="btn-group" role="group">
                    <button type="button" onclick="showHistory(${row.game_list_id})" class="btn btn-sm btn-info-subtle action-btn-square js-bs-tooltip-enabled"
                            data-bs-toggle="tooltip" aria-label="History" data-bs-original-title="History" title="History"
                            style="font-size:8px !important; margin-right: 5px;">
                            <i class="fa fa-history"></i>
                    </button>
               </div>`;
                    var btn_services = `<div class="btn-group" role="group">
                        <button type="button" onclick="openServices(${row.game_list_id}, '${encodeURIComponent(row.agent_name || '')}', ${row.game_status}, ${row.SETTLED || 0}, ${row.AGENT_ID || 0})" class="btn btn-sm btn-primary-subtle action-btn-square js-bs-tooltip-enabled"
                            data-bs-toggle="tooltip" aria-label="Services" data-bs-original-title="Services" title="Services"
                            style="font-size:8px !important; margin-right: 5px;">
                            <i class="fa fa-concierge-bell"></i>
                        </button>
                    </div>`;


						

					var ref = '';
					var acct_code = '';

					if (row.GUESTNo) {
						ref = `${row.CODE}-${row.AGENT_CODE}-${row.GUESTNo}-${row.GAME_NO}`;
						acct_code = `${row.CODE}-${row.AGENT_CODE}-${row.GUESTNo}`;
					} else {
						ref = `${row.CODE}-${row.AGENT_CODE}-${row.GAME_NO}`;
						acct_code = `${row.CODE}-${row.AGENT_CODE}`;
					}

					var dateFormat = moment(row.GAME_DATE).format('MMMM DD, YYYY');

					$.ajax({
						url: '/game_list/' + row.game_list_id + '/record',
						method: 'GET',
						success: function (response) {
							var total_buy_in = 0;
							var total_cash_out = 0;
							var total_rolling = 0;
							var initial_buy_in = 0;

							var total_nn_init = 0;
							var total_cc_init = 0;
							var total_nn = 0;
							var total_cc = 0;
							var total_cash_out_nn = 0;
							var total_cash_out_cc = 0;
							var total_rolling_nn = 0;
							var total_rolling_cc = 0;

							var total_rolling_real = 0;
							var total_rolling_nn_real = 0;
							var total_rolling_cc_real = 0;
							var total_roller_nn = 0;
							var total_roller_cc = 0;
							var total_roller_return_cc = 0;
							var isMarkerGameRowStats = false;

							response.forEach(function (res) {
								if (res.CAGE_TYPE == 1 && parseInt(res.TRANSACTION, 10) === 3) {
									isMarkerGameRowStats = true;
								}

								if (res.CAGE_TYPE == 1 && (total_nn_init != 0 || total_cc_init != 0)) {
									total_buy_in = total_buy_in + res.AMOUNT;
									total_nn = total_nn + res.NN_CHIPS;
									total_cc = total_cc + res.CC_CHIPS;
								}

								if ((total_nn_init == 0 && total_cc_init == 0) && res.CAGE_TYPE == 1) {
									initial_buy_in = res.AMOUNT;
									total_nn_init = total_nn_init + res.NN_CHIPS;
									total_cc_init = total_cc_init + res.CC_CHIPS;
								}

								if (res.CAGE_TYPE == 2) {
									total_cash_out = total_cash_out + res.AMOUNT;
									total_cash_out_nn = total_cash_out_nn + res.NN_CHIPS;
									total_cash_out_cc = total_cash_out_cc + res.CC_CHIPS;
								}

								if (res.CAGE_TYPE == 3) {
									total_rolling = total_rolling + res.AMOUNT;
									total_rolling_nn = total_rolling_nn + res.NN_CHIPS;
									total_rolling_cc = total_rolling_cc + res.CC_CHIPS;
								}

				if (res.CAGE_TYPE == 4) {
					total_rolling_real = total_rolling_real + res.AMOUNT;
					total_rolling_nn_real = total_rolling_nn_real + res.NN_CHIPS;
					total_rolling_cc_real = total_rolling_cc_real + res.CC_CHIPS;
				}
				
								if (res.CAGE_TYPE == 5) {
					// ROLLER CHIPS - tracked separately (do NOT affect total rolling)
					// Use ROLLER_NN_CHIPS and ROLLER_CC_CHIPS columns
					// ROLLER_TRANSACTION: 1 = ADD (add), 2 = RETURN (subtract)
					var rollerTransaction = res.ROLLER_TRANSACTION || 1; // Default to ADD if null
					if (rollerTransaction == 1) {
						total_roller_nn = total_roller_nn + (res.ROLLER_NN_CHIPS || 0);
						total_roller_cc = total_roller_cc + (res.ROLLER_CC_CHIPS || 0);
					} else if (rollerTransaction == 2) {
						total_roller_nn = total_roller_nn - (res.ROLLER_NN_CHIPS || 0);
						total_roller_cc = total_roller_cc - (res.ROLLER_CC_CHIPS || 0);
						total_roller_return_cc += (res.ROLLER_CC_CHIPS || 0);
					}
				}

			});

							var buyinBtnStyleStats = 'font-size:11px;text-decoration: underline;' + (isMarkerGameRowStats ? 'color:#dc3545 !important;' : '');
							var formatBuyinPlainStats = function (amt) {
								var s = parseFloat(amt).toLocaleString();
								return isMarkerGameRowStats ? '<span style="color:#dc3545;font-size:11px;">' + s + '</span>' : s;
							};

							var total_initial = total_nn_init + total_cc_init;
							var total_buy_in_chips = total_nn + total_cc;
							var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
							// TOTAL ROLLING: exclude roller chip movements (ADD/RETURN)
							// CASHOUT NN subtracts from rolling (player cashes out NN chips, removed from play)
							// CC chips don't affect rolling (CC chips are winnings from dealer, not played chips)
							// Note: CC chips from CAGE_TYPE == 3 (TOTAL ROLLING) should NOT be included
							// Buy-in amounts (NN only) should be included in total rolling
							var totalRollingCCWithReturns = total_roller_return_cc;  // Only include roller return CC, exclude CC from CAGE_TYPE == 3
							var buy_in_nn_total = total_nn_init + total_nn;  // NN chips from initial buy-in + additional buy-in
							var total_rolling_chips = buy_in_nn_total + total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;

							var total_rolling_real_chips = total_rolling_real + total_rolling_nn_real + total_rolling_cc_real + total_roller_return_cc;
							var total_roller_chips = total_roller_nn + total_roller_cc;

							var gross = total_buy_in - total_cash_out;

							var total_amount = total_buy_in_chips + total_initial;

							var net = (total_rolling_chips * (row.COMMISSION_PERCENTAGE / 100)).toLocaleString();

							var winloss = parseFloat(total_amount - total_cash_out_chips).toLocaleString();
							
								var WinLoss = total_amount - total_cash_out_chips;
								
								


							var btn_settle = '';
							var status = '';

							var buyin_td = '';
							var rolling_td = '';
							var cashout_td = '';
							if (row.game_status == 2) {
								const onGameText = window.gamelistTranslations?.on_game || "ON GAME";
								status = `<button type="button" onclick="changeStatus(${row.game_list_id}, ${net}, ${row.ACCOUNT_ID } , ${total_amount} , ${total_cash_out_chips} , ${total_rolling_chips} , ${WinLoss})" class="btn btn-sm btn-info-subtle js-bs-tooltip-enabled"
									data-bs-toggle="tooltip" aria-label="Details" data-bs-original-title="Status"  style="font-size:10px !important;">${onGameText}</button>`;

								buyin_td = '<button class="btn btn-link" style="' + buyinBtnStyleStats + '" onclick="addBuyin(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ')">' + parseFloat(total_amount).toLocaleString() + '</button>';
								rolling_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addRolling(' + row.game_list_id + ')">' + parseFloat(total_rolling_real_chips).toLocaleString() + '</button>';
								cashout_td = '<button class="btn btn-link" style="font-size:11px;text-decoration: underline;" onclick="addCashout(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ', ' + total_rolling_chips + ')">' + parseFloat(total_cash_out_chips).toLocaleString() + '</button>';
                                var actionButtons = btn_services + btn_his;
                                var acct_no_link = `<a href="#" onclick="account_details(${row.ACCOUNT_ID}, '${row.agent_code}', '${row.agent_name}')">${row.agent_code} (${row.agent_name})</a>`;
                                dataTable.row.add([`GAME-${row.game_list_id}`, acct_no_link, buyin_td, cashout_td, rolling_td, parseFloat(total_rolling_chips).toLocaleString(), `${row.COMMISSION_PERCENTAGE}%`, net, winloss, status, actionButtons]).draw();
							} else if (row.game_status == 3) {
								// PENDING STATUS (discrepancy in roller chips return)
								const pendingText = "PENDING";
								status = `<button type="button" onclick="changeStatus(${row.game_list_id}, ${net}, ${row.ACCOUNT_ID }, ${total_amount}, ${total_cash_out_chips}, ${total_rolling_chips}, ${WinLoss}, 3)" class="btn btn-sm btn-warning-subtle js-bs-tooltip-enabled" data-bs-toggle="tooltip" aria-label="Pending Review" data-bs-original-title="Pending Review" style="font-size:10px !important;">${pendingText}</button>`;
								
								buyin_td = formatBuyinPlainStats(total_amount);
								rolling_td = parseFloat(total_rolling_real_chips).toLocaleString();
								cashout_td = parseFloat(total_cash_out_chips).toLocaleString();
                                var actionButtons = btn_services + btn_his;
                                var acct_no_link = `<a href="#" onclick="account_details(${row.ACCOUNT_ID}, '${row.agent_code}', '${row.agent_name}')">${row.agent_code} (${row.agent_name})</a>`;
                                dataTable.row.add([`GAME-${row.game_list_id}`, acct_no_link, buyin_td, cashout_td, rolling_td, parseFloat(total_rolling_chips).toLocaleString(), `${row.COMMISSION_PERCENTAGE}%`, net, winloss, status, actionButtons]).draw();
							} else {
								
								//END GAME STATUS EDITABLE(ON GAME & END GAME)
								//status = `<a href="#" onclick="changeStatus(${row.game_list_id}, ${net}, ${row.ACCOUNT_ID })">${moment(row.GAME_ENDED).format('MMMM DD, YYYY HH:mm:ss')}</a>`;

								//END GAME STATUS NOT EDITABLE
								status = `<a href="#" value="changeStatus(${row.game_list_id}, ${net}, ${row.ACCOUNT_ID })">${moment(row.GAME_ENDED).format('MMMM DD, YYYY HH:mm:ss')}</a>`;

								buyin_td = formatBuyinPlainStats(total_amount);
								rolling_td = parseFloat(total_rolling_real_chips).toLocaleString();
								cashout_td = '<span style="font-size:11px;text-decoration: none;" >' + parseFloat(total_cash_out_chips).toLocaleString() + '</span>';
								
								var settleLabel = row.SETTLED === 1 ? 'Settled' : 'Settlement';
								var settleClass = row.SETTLED === 1 ? 'btn-success-subtle' : 'btn-danger-subtle';
								var settleTitle = settleLabel;
								var btn_settle = `<div class="btn-group" role="group">
								<button type="button" onclick="showHistory(${row.game_list_id})" class="btn btn-sm btn-info-subtle action-btn-square js-bs-tooltip-enabled"
										data-bs-toggle="tooltip" aria-label="History" data-bs-original-title="History" title="History"
										style="font-size:8px !important; margin-right: 5px;">
										<i class="fa fa-history"></i>
								</button>
								<button type="button" onclick="settlement_history(${row.game_list_id}, ${row.ACCOUNT_ID })" class="btn btn-sm ${settleClass} action-btn-square js-bs-tooltip-enabled"
										data-bs-toggle="tooltip" aria-label="${settleTitle}" data-bs-original-title="${settleTitle}" title="${settleTitle}"
										style="font-size:10px !important;">
										<i class="fa fa-clipboard-check"></i>
								</button>
						   </div>`;
						   var actionButtons = btn_services + btn_settle;
						   var acct_no_link = `<a href="#" onclick="account_details(${row.ACCOUNT_ID}, '${row.agent_code}', '${row.agent_name}')">${row.agent_code} (${row.agent_name})</a>`;
						   dataTable.row.add([`GAME-${row.game_list_id}`, acct_no_link, buyin_td, cashout_td, rolling_td, parseFloat(total_rolling_chips).toLocaleString(), `${row.COMMISSION_PERCENTAGE}%`, net, winloss, status, actionButtons]).draw();

							}

							// dataTable.row.add([`${row.GAME_NO}`, `${row.game_list_id} (${row.agent_name})`, parseFloat(total_buy_in).toLocaleString(), parseFloat(total_cash_out).toLocaleString(), parseFloat(total_rolling).toLocaleString(), parseFloat(gross).toLocaleString(), parseFloat(net).toLocaleString(), status, btn]).draw();
							
						},
						error: function (xhr, status, error) {
							console.error('Error fetching options:', error);
						}
					});

				});
			},
			error: function (xhr, status, error) {
				console.error('Error fetching data:', error);
			}
		});
	}

	function computation(id) {
		$.ajax({
			url: '/game_list/' + id + '/record',
			method: 'GET',
			success: function (response) {
				var arr = [];

				arr.push(response);
				return arr;
			},
			error: function (xhr, status, error) {
				console.error('Error fetching options:', error);
			}
		});
	}

	reloadData_on_game();

// $('#add_buyin').submit(function (event) {
// 		event.preventDefault();

// 		var formData = $(this).serialize();

// 		$.ajax({
// 			url: '/game_list/add/buyin',
// 			type: 'POST',
// 			data: formData,
// 			// processData: false, 
// 			// contentType: false,
// 			success: function (response) {
// 				reloadData_on_game();
// 				$('#modal-add-buyin').modal('hide');
// 			},
// 			error: function (xhr, status, error) {
// 				var errorMessage = xhr.responseJSON.error;
// 				// if(errorMessage == 'password') {
// 				//   Swal.fire({
// 				//     icon: "error",
// 				//     title: "Oops...",
// 				//     text: "Password not match!",
// 				//   });
// 				// } else {
// 				console.error('Error updating user role:', error);
// 				// }
// 			}
// 		});
// 	});

// 	$('#add_cashout').submit(function (event) {
// 		event.preventDefault();

// 		var formData = $(this).serialize();

// 		$.ajax({
// 			url: '/game_list/add/cashout',
// 			type: 'POST',
// 			data: formData,
// 			// processData: false, 
// 			// contentType: false,
// 			success: function (response) {
// 				reloadData_on_game();
// 				$('#modal-add-cashout').modal('hide');
// 			},
// 			error: function (xhr, status, error) {
// 				var errorMessage = xhr.responseJSON.error;
// 				// if(errorMessage == 'password') {
// 				//   Swal.fire({
// 				//     icon: "error",
// 				//     title: "Oops...",
// 				//     text: "Password not match!",
// 				//   });
// 				// } else {
// 				console.error('Error updating user role:', error);
// 				// }
// 			}
// 		});
// 	});

// 	$('#add_rolling').submit(function (event) {
// 		event.preventDefault();

// 		var formData = $(this).serialize();

// 		$.ajax({
// 			url: '/game_list/add/rolling',
// 			type: 'POST',
// 			data: formData,
// 			// processData: false, 
// 			// contentType: false,
// 			success: function (response) {
// 				reloadData_on_game();
// 				$('#modal-add-rolling').modal('hide');
// 			},
// 			error: function (xhr, status, error) {
// 				var errorMessage = xhr.responseJSON.error;
// 				// if(errorMessage == 'password') {
// 				//   Swal.fire({
// 				//     icon: "error",
// 				//     title: "Oops...",
// 				//     text: "Password not match!",
// 				//   });
// 				// } else {
// 				console.error('Error updating user role:', error);
// 				// }
// 			}
// 		});
// 	});


	// $('#edit_status').submit(function (event) {
	// 	event.preventDefault();

	// 	var formData = $(this).serialize();
	// 	$.ajax({
	// 		url: '/game_list/change_status/' + game_id,
	// 		type: 'PUT',
	// 		data: formData,
	// 		success: function (response) {
	// 			reloadData_on_game();
	// 			$('#modal-change_status').modal('hide');
	// 			window.location.reload();
	// 		},
	// 		error: function (error) {
	// 			console.error('Error updating agent:', error);
	// 		}
	// 	});
	// });
	

});



function settlement_history(record_id, acc_id) {
    var $settlementModal = $('#modal-settlement');
    $settlementModal.data('is-settled', 0);
    $settlementModal.data('fake-settle-active', 0);
    $settlementModal.find('#settlement-telegram-opts').hide();
    $settlementModal.modal('show');
    // Reset Deposit / Cash Out row; reloadDataRecord hides it when game is already settled
    $settlementModal.find('.deposit-cashout-row').show();

    // Destroy existing DataTable if it exists
    if ($.fn.DataTable.isDataTable('#game_record-tbl')) {
        $('#game_record-tbl').DataTable().destroy();
    }

    // Initialize DataTable
    var dataTable = $('#game_record-tbl').DataTable({
        columnDefs: [{
            createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
                $(cell).addClass('text-center');
            }
        }]
    });

    // Initialize flag for settlement processing
    var isSettled = false;
    var currentCommissionType = null; // 1=Rolling, 2=Shared, 3=Loosing - used for validation

    // Fetch services totals and populate F&B / Hotel breakdown
    function loadServicesTotal() {
        $.ajax({
            url: `/game_services/${record_id}`,
            method: 'GET',
            success: function (list) {
                let fnbTotal = 0;
                let hotelTotal = 0;

                if (Array.isArray(list)) {
                    list.forEach((item) => {
                        const transactionId = parseInt(item.TRANSACTION_ID || item.transaction_id, 10);
                        if (transactionId !== 3) {
                            return;
                        }

                        const serviceType = String(item.SERVICE_TYPE || item.service_type || '').toLowerCase().trim();
                        const amt = parseFloat(item.AMOUNT || item.amount || 0);
                        const safeAmount = isNaN(amt) ? 0 : amt;

                        if (serviceType === 'hotel') {
                            hotelTotal += safeAmount;
                            return;
                        }

                        if (serviceType === 'fnb' || serviceType === 'delivery') {
                            fnbTotal += safeAmount;
                        }
                    });
                }

                const combinedServices = fnbTotal + hotelTotal;
                $('#fbDisplay').val(fnbTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
                $('#hotelDisplay').val(hotelTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
                $('#fb').val(combinedServices.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
                $('#fb').trigger('input');
            },
            error: function () {
                // fallback to 0
                $('#fbDisplay').val('0');
                $('#hotelDisplay').val('0');
                $('#fb').val('0');
                $('#fb').trigger('input');
            }
        });
    }

    // Function to fetch game record data and populate the modal
    function reloadDataRecord() {
        $.ajax({
            url: '/game_record_data/' + record_id, // Endpoint to fetch data
            method: 'GET',
            success: function (data) {
                dataTable.clear(); // Clear existing table rows

                var total_buy_in = 0;
				var total_cash_out = 0;
				var total_rolling = 0;
				var initial_buy_in = 0;

				var total_nn_init = 0;
				var total_cc_init = 0;
				var total_nn = 0;
				var total_cc = 0;
				var total_cash_out_nn = 0;
				var total_cash_out_cc = 0;
				var total_rolling_nn = 0;
				var total_rolling_cc = 0;

				var total_rolling_real = 0;
				var total_rolling_nn_real = 0;
				var total_rolling_cc_real = 0;
				var total_roller_nn = 0;
				var total_roller_cc = 0;
				var total_roller_return_cc = 0;

                let RollingRate = data[0].COMMISSION_PERCENTAGE;
                 let CommissionType = data[0].COMMISSION_TYPE;
                 currentCommissionType = CommissionType; // Store for submit validation

                // Populate data if available
                if (data.length > 0) {
                    
                     // Generate current date and time from the first item
					   let currentDateTime = moment(data[0].GAME_ENDED); // Changed item to data[0]
					   let currentDate = currentDateTime.format('YYYY-MM-DD');
					   let currentTime = currentDateTime.format('HH:mm:ss');
	   
					   // Populate the current date and time
					   $('#date').text(currentDate);
					   $('#time').text(currentTime);
                    
                    
                    let accNo = (data[0].agent_code || '') + ' - ' + (data[0].agent_name || '');
                    let gameNo = data[0].GAME_ID;
                    let account_id = data[0].ACCOUNT_ID;

                    // Populate the modal with data
                    $('#accNo').text(accNo || 'N/A');
                    $('#gameNo').text(gameNo || 'N/A');
                    $('input[name="game_id_settle"]').val(gameNo);
                    $('input[name="txtAccountIDSettle"]').val(account_id);

                    // Check if settled and disable button if necessary.
                    // Use numeric coercion to handle both 1 and "1" from API.
                    var settledFlag = Number(data[0].SETTLED) === 1;
                    $settlementModal.data('is-settled', settledFlag ? 1 : 0);
                    var fakeSettleFlag = Number(data[0].FAKE_SETTLE) === 1;
                    $settlementModal.data('fake-settle-active', fakeSettleFlag ? 1 : 0);
                    $settlementModal.find('#settleSendAgent, #settleSendCage').prop('checked', false);

                    if (settledFlag) {
                        $settlementModal.find('#submit-settlement-btn').prop('disabled', true).hide();
                        $settlementModal.find('#settledImage-modal').show(); // Ensure the settled image is shown
                        isSettled = true; // Set the flag to true
                        $settlementModal.find('.deposit-cashout-row').hide();
                        $settlementModal.find('#settlement-telegram-opts').hide();
                        $settlementModal.find('input[name="txtTransType"]').prop('checked', false);
                    } else {
                        $settlementModal.find('#submit-settlement-btn').prop('disabled', false).show();
                        $settlementModal.find('#settledImage-modal').hide(); // Hide the settled image if not settled
                        isSettled = false; // Set the flag to false
                        $settlementModal.find('.deposit-cashout-row').show();
                        $settlementModal.find('#settlement-telegram-opts').toggle(fakeSettleFlag);
                    }

                    // Debug: Check FNB value
                    console.log('Setting FNB value:', data[0].FNB);

                    // Populate FNB value
                    // $('#fb').val(data[0].FNB || 0); // Ensure FNB value is set correctly
                    let fbValue = data[0].FNB || 0;
                    let fallbackTotal = parseFloat(fbValue) || 0;
					$('#fbDisplay').val(fallbackTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
                    $('#hotelDisplay').val('0');
                    $('#fb').val(fallbackTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
                }

              
                data.forEach(function (row) {

					if (row.CAGE_TYPE == 1 && (total_nn_init != 0 || total_cc_init != 0)) {
						total_buy_in = total_buy_in + row.AMOUNT;
						total_nn = total_nn + row.NN_CHIPS;
						total_cc = total_cc + row.CC_CHIPS;
					}

					if ((total_nn_init == 0 && total_cc_init == 0) && row.CAGE_TYPE == 1) {
						initial_buy_in = row.AMOUNT;
						total_nn_init = total_nn_init + row.NN_CHIPS;
						total_cc_init = total_cc_init + row.CC_CHIPS;
					}

					if (row.CAGE_TYPE == 2) {
						total_cash_out = total_cash_out + row.AMOUNT;
						total_cash_out_nn = total_cash_out_nn + row.NN_CHIPS;
						total_cash_out_cc = total_cash_out_cc + row.CC_CHIPS;
					}

					if (row.CAGE_TYPE == 3) {
						total_rolling = total_rolling + row.AMOUNT;
						total_rolling_nn = total_rolling_nn + row.NN_CHIPS;
						total_rolling_cc = total_rolling_cc + row.CC_CHIPS;
					}

					if (row.CAGE_TYPE == 4) {
						total_rolling_real = total_rolling_real + row.AMOUNT;
						total_rolling_nn_real = total_rolling_nn_real + row.NN_CHIPS;
						total_rolling_cc_real = total_rolling_cc_real + row.CC_CHIPS;
					}
					
					if (row.CAGE_TYPE == 5) {
						// ROLLER CHIPS - tracked separately (do NOT affect total rolling)
						// ROLLER_TRANSACTION: 1 = ADD (add), 2 = RETURN (subtract)
						var rollerTransaction = row.ROLLER_TRANSACTION || 1;
						if (rollerTransaction == 1) {
							total_roller_nn = total_roller_nn + (row.ROLLER_NN_CHIPS || 0);
							total_roller_cc = total_roller_cc + (row.ROLLER_CC_CHIPS || 0);
						} else if (rollerTransaction == 2) {
							total_roller_nn = total_roller_nn - (row.ROLLER_NN_CHIPS || 0);
							total_roller_cc = total_roller_cc - (row.ROLLER_CC_CHIPS || 0);
							total_roller_return_cc += (row.ROLLER_CC_CHIPS || 0);
						}
					}

				});

				buyin_td = parseFloat(total_buy_in_chips).toLocaleString();
							rolling_td = parseFloat(total_rolling_real_chips).toLocaleString();
							var total_initial = total_nn_init + total_cc_init;
							var total_buy_in_chips = total_nn + total_cc;
							var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
							// TOTAL ROLLING: Follow same logic as backend add_settlement route
							// Formula: total_rolling_nn + totalRollingCCWithReturns + total_rolling_amount + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn
							// Note: CC chips from CAGE_TYPE == 3 (TOTAL ROLLING) should NOT be included
							// Note: CC chips from CAGE_TYPE == 4 (REAL ROLLING) SHOULD be included
							// Note: Buy-in amounts are NOT included here - they are separate from rolling transactions
							var totalRollingCCWithReturns = total_roller_return_cc;  // Only include roller return CC, exclude CC from CAGE_TYPE == 3
							var total_rolling_chips = total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;
					
							var total_rolling_real_chips = total_rolling_real + total_rolling_nn_real + total_rolling_cc_real + total_roller_return_cc;
					
							var gross = total_buy_in - total_cash_out;
					
							var total_amount = total_buy_in_chips + total_initial;
					
							var cashout_td = total_cash_out_chips;
					
							//var net = (total_rolling_chips * (RollingRate / 100)).toLocaleString();
					
							var winloss = parseFloat(total_amount - total_cash_out_chips) * -1;
							
							var WinLoss = total_amount - total_cash_out_chips;
							
							// var net;
							
							// 	if (CommissionType == 1 || CommissionType == 3) {
							// 		// Kung ang COMMISSION_TYPE ay 1, ang net ay computed gamit ang total rolling chips
							// 		net = (total_rolling_chips * (RollingRate / 100)).toLocaleString();
							// 	} else if (CommissionType == 2) {
							// 		// Kung ang COMMISSION_TYPE ay 2, ang net ay computed gamit ang winloss
							// 		net = (WinLoss * (RollingRate / 100)).toLocaleString();
							// 	}
							
							var net = 0;
                            
							if (CommissionType == 1 || CommissionType == 3) {
								// Kung ang COMMISSION_TYPE ay 1, ang net ay computed gamit ang total rolling chips
								net = Math.round((total_rolling_chips * RollingRate) / 100);
							} else if (CommissionType == 2) {
								// Kung ang COMMISSION_TYPE ay 2, ang net ay computed gamit ang winloss
								net = Math.round((WinLoss * RollingRate) / 100);
							}
							
							// Format net value as an integer
							var formattedNet = net.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

                // Populate calculated fields
                $('#buyIn').val(total_amount.toLocaleString());
                $('#chipsReturn').val(cashout_td.toLocaleString());
                $('#winLoss').val(winloss.toLocaleString());
                $('#rolling').val(total_rolling_chips.toLocaleString());
                $('#rollingRate').val(RollingRate);
                $('#rollingSettlement').val(formattedNet);

                // Set initial payment value
                updatePayment(); // Update payment based on initial data
                // $('#fb').val(data[0].FNB || 0); // Ensure FNB value is set correctly

                // Update payment when services total changes
                $('#fb').on('input', function () {
                    updatePayment();
                });

                // Update payment when rollingRate changes
                $('#rollingRate').on('input', function () {
                    updateRollingSettlement();
                    updatePayment();
                });

                function updatePayment() {
                    let fb = parseFloat($('#fb').val().replace(/,/g, '')) || 0;
                    let net = parseFloat($('#rollingSettlement').val().replace(/,/g, '')) || 0;
                    let payment = net - fb;
                    $('#payment').val(payment.toLocaleString());
                }

                function updateRollingSettlement() {
                    let updatedRollingRate = parseFloat(String($('#rollingRate').val() || '').replace(/,/g, '')) || 0;
                    let currentRolling = parseFloat(String($('#rolling').val() || '').replace(/,/g, '')) || 0;
                    let updatedRollingSettlement = Math.round((currentRolling * updatedRollingRate) / 100);
                    $('#rollingSettlement').val(updatedRollingSettlement.toLocaleString('en-US', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0
                    }));
                }

                // After handlers are ready, load services total into FB
                loadServicesTotal();
            },
            error: function (xhr, status, error) {
                console.error('Error fetching data:', error);
            }
        });
         // Fetch account details to calculate balance
		 $.ajax({
			url: '/account_details_data_deposit/' + acc_id, // Use the account parameter
			method: 'GET',
			success: function (data) {
				var deposit_amount = 0;
				var withdraw_amount = 0;
				var marker_return = 0;
				var marker_deposit_amount = 0;
	
				data.forEach(function (row) {
					const amount = parseFloat(row.AMOUNT) || 0;
		
					if (row.TRANSACTION === 'DEPOSIT') {
						deposit_amount += amount;
					} else if (row.TRANSACTION === 'WITHDRAW') {
						withdraw_amount += amount;
					} else if (row.TRANSACTION === 'IOU RETURN DEPOSIT') {
						marker_return += amount;
					} else if (row.TRANSACTION === 'MARKER REDEEM') {
						marker_deposit_amount += amount;
					}
				});
	
				 const totalBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;


				 // Set total balance value
				 $('#SettlementBalance').val(!isNaN(totalBalance) ? totalBalance : 0); // Safely set the value or default to 0 if invalid
			 },
			error: function (xhr, status, error) {
				console.error('Error fetching account details:', error);
			}
		})
    }

    // Handle form submission for settlement
    console.log('Initial isSettled:', isSettled);

    $('#submit-settlement-btn').off('click').on('click', function (e) {
        e.preventDefault(); // Prevent any default behavior
        var $settlementModal = $(this).closest('#modal-settlement');

        console.log('Button clicked. isSettled:', isSettled);
        if (isSettled) {
            console.log('Settlement already processed. Exiting.');
            return; // Exit if already settled
        }

        // Get form values for confirmation
        var buyIn = $('#buyIn').val().replace(/,/g, '') || '0';
        var chipsReturn = $('#chipsReturn').val().replace(/,/g, '') || '0';
        var winLoss = $('#winLoss').val().replace(/,/g, '') || '0';
        var rolling = $('#rolling').val().replace(/,/g, '') || '0';
        var rollingRate = $('#rollingRate').val() || '0';
        var rollingSettlement = $('#rollingSettlement').val().replace(/,/g, '') || '0';
        var services = $('#fb').val().replace(/,/g, '') || '0';
        var fnbDisplay = $('#fbDisplay').val().replace(/,/g, '') || '0';
        var hotelDisplay = $('#hotelDisplay').val().replace(/,/g, '') || '0';
        var payment = $('#payment').val().replace(/,/g, '') || '0';
        var transType = $settlementModal.find('input[name="txtTransType"]:checked').val();
        if (!transType || (transType !== '1' && transType !== '5')) {
            Swal.fire({
                icon: 'warning',
                title: 'Required',
                text: 'Please select Deposit or Cash Out before confirming settlement.',
                confirmButtonText: 'OK',
                allowOutsideClick: false,
                allowEscapeKey: false,
                customClass: {
                    confirmButton: 'custom-ok-btn'
                }
            });
            return;
        }
        var transTypeText = '';
        if (transType == '1') transTypeText = 'Deposit';
        else if (transType == '5') transTypeText = 'Cash Out';
        var servicesValue = parseFloat(services) || 0;
        var settlementValue = parseFloat(rollingSettlement) || 0;

        // Shared Game (COMMISSION_TYPE 2): commission based on WIN/LOSS - can be negative, always allow.
        // Rolling/Loosing (1, 3): block only when services exceed settlement.
        if (currentCommissionType != 2 && servicesValue > settlementValue) {
            Swal.fire({
                icon: 'error',
                title: 'Invalid!',
                text: 'Services cannot exceed the computed settlement/commission amount.',
                confirmButtonText: 'OK',
                allowOutsideClick: false,
                allowEscapeKey: false,
                customClass: {
                    confirmButton: 'custom-ok-btn'
                }
            });
            return;
        }
        
        // Build confirmation table-style message
        var labelStyle = 'padding:4px 20px 4px 0;font-weight:600;text-align:left;white-space:nowrap;';
        var valueStyle = 'padding:4px 0 4px 0;text-align:left;';
        var buildRow = function (label, value) {
            return `<tr><td style="${labelStyle}">${label}</td><td style="${valueStyle}">${value}</td></tr>`;
        };

        var confirmationRows = '';
        confirmationRows += buildRow('Buy-In:', parseFloat(buyIn).toLocaleString());
        confirmationRows += buildRow('Chips Return:', parseFloat(chipsReturn).toLocaleString());
        confirmationRows += buildRow('Win/Loss:', parseFloat(winLoss).toLocaleString());
        confirmationRows += buildRow('Rolling:', parseFloat(rolling).toLocaleString());
        confirmationRows += buildRow('Rate:', `${parseFloat(rollingRate).toFixed(2)}%`);
        confirmationRows += buildRow('Settlement:', parseFloat(rollingSettlement).toLocaleString());
        if (parseFloat(fnbDisplay) > 0) {
            confirmationRows += buildRow('F&B:', parseFloat(fnbDisplay).toLocaleString());
        }
        if (parseFloat(hotelDisplay) > 0) {
            confirmationRows += buildRow('Hotel:', parseFloat(hotelDisplay).toLocaleString());
        }
        confirmationRows += buildRow('Payment:', parseFloat(payment).toLocaleString());
        if (transTypeText) {
            confirmationRows += buildRow('Transaction Type:', transTypeText);
        }

        var confirmationMessage = `
            <div style="max-width:420px;margin:0 auto;text-align:center;">
                <div style="font-weight:600;margin-bottom:8px;">Confirm Settlement:</div>
                <table style="margin:0 auto;border-collapse:collapse;min-width:260px;">
                    ${confirmationRows}
                </table>
            </div>
        `;
        
        var $btn = $('#submit-settlement-btn');
        var defaultSettleLabel = 'Settle';
        
        Swal.fire({
            icon: 'question',
            title: 'Confirm Settlement',
            html: confirmationMessage + '<br>Are you sure you want to proceed?',
            showCancelButton: true,
            confirmButtonText: 'Yes, Confirm',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            allowOutsideClick: false,
            allowEscapeKey: false,
            width: '500px'
        }).then((result) => {
            if (result.isConfirmed) {
                // User confirmed, proceed with transaction
                $btn.prop('disabled', true).html(`
                    <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    Loading...
                `);
                
                var formData = $settlementModal.find('#add_settlement').serialize(); // Serialize form data

                $.ajax({
                    type: 'POST',
                    url: '/add_settlement',
                    data: formData,
                    success: function (response) {
                        Swal.fire({
                            icon: 'success',
                            title: 'The settlement has been successfully settled.',
                            text: '',
                            confirmButtonText: 'OK',
                            allowOutsideClick: false,
                            allowEscapeKey: false,
                            customClass: {
                                confirmButton: 'custom-ok-btn'
                            }
                        }).then((result) => {
                            if (result.isConfirmed) {
                                // Set the flag to true
                                isSettled = true;
                                console.log('Settlement processed. Setting isSettled to true.');
                                // Disable and hide the 'Save' button
                                $('#submit-settlement-btn').prop('disabled', true).hide();
                                // Hide modal only after SweetAlert confirmation
                                $('#modal-settlement').modal('hide');
                                window.location.reload();
                                // Reset the form
                                $('#add_settlement')[0].reset();
                                // Show the settled image
                                $('#settledImage-modal').show();
                            }
                        });
                    },
                    error: function (xhr, status, error) {
                        // Display SweetAlert error message
                        Swal.fire({
                            icon: 'error',
                            title: 'Error',
                            text: 'There was an error saving the settlement.',
                            confirmButtonText: 'OK',
                            allowOutsideClick: false,
                            allowEscapeKey: false,
                            customClass: {
                                confirmButton: 'custom-ok-btn'
                            }
                        });
                        $btn.prop('disabled', false).text(defaultSettleLabel); // Re-enable button and reset text
                    },
                    complete: function () {
                        // Only reset if not already disabled (in case of success)
                        if (!$btn.is(':disabled')) {
                            $btn.prop('disabled', false).text(defaultSettleLabel); // Re-enable button and reset text
                        }
                    }
                });
            } else {
                // User cancelled, re-enable button
                $btn.prop('disabled', false).text(defaultSettleLabel);
            }
        });
    });

    reloadDataRecord(); // Call data loading function
}

// Trigger when account is selected from dropdown
$('#txtTrans').on('change', function () {
    var account_id = $(this).val();  // Get the selected account ID

    if (account_id) {
        // Make an AJAX call to fetch account details
        $.ajax({
            url: '/account_details_data_deposit/' + account_id,  // Pass the selected account ID
            method: 'GET',
            success: function (data) {
                var deposit_amount = 0;
                var withdraw_amount = 0;
                var marker_deposit_amount = 0;
                var marker_return = 0;

				   data.forEach(function (row) {
					const amount = parseFloat(row.AMOUNT) || 0;
		
					if (row.TRANSACTION === 'DEPOSIT') {
                        deposit_amount += amount;
                    } else if (row.TRANSACTION === 'WITHDRAW') {
                        withdraw_amount += amount;
                    } else if (row.TRANSACTION === 'MARKER REDEEM') {
                        marker_deposit_amount += amount;
                    } else if (row.TRANSACTION === 'IOU RETURN DEPOSIT') {
                        marker_return += amount;
               		}
				});
		
				const totalBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;
		
					// Set raw numeric value safely
					$('#total_balanceGuest1').val(totalBalance);
					$('#total_balanceGuestGameList').val(totalBalance.toLocaleString());
            },
            error: function (xhr, status, error) {
                console.error('Error fetching account details:', error);
            }
        });
    }
});


