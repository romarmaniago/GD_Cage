var account_id;
var creditDetailsRequestSeq = 0;
var GUEST_DEFAULT_PROFILE = '/assets/images/guest-default-profile.webp';

function isDefaultGuestPhoto(photo) {
	if (photo == null) return true;
	var name = String(photo).trim();
	if (!name) return true;
	var lower = name.toLowerCase();
	return lower === 'default.jpg'
		|| lower === 'default.png'
		|| lower === 'default.webp'
		|| lower === 'default';
}

function guestProfilePhotoUrl(photo) {
	if (isDefaultGuestPhoto(photo)) return GUEST_DEFAULT_PROFILE;
	return '/PassportUpload/' + encodeURIComponent(String(photo).trim());
}

function setGuestProfilePhoto(imgEl, photo) {
	if (!imgEl) return;
	var url = guestProfilePhotoUrl(photo);
	imgEl.onerror = function () {
		imgEl.onerror = null;
		imgEl.src = GUEST_DEFAULT_PROFILE;
	};
	imgEl.src = url;
}

function ensureModalAppendedToBody($modal) {
	if ($modal && $modal.length && $modal.parent().length && !$modal.parent().is('body')) {
		$modal.appendTo('body');
	}
}

function resetOrphanedModalBackdrops() {
	if (document.querySelectorAll('.modal.show').length) {
		return;
	}
	document.querySelectorAll('.modal-backdrop').forEach(function (el) {
		el.remove();
	});
	document.body.classList.remove('modal-open');
	document.body.style.removeProperty('overflow');
	document.body.style.removeProperty('padding-right');
	$('body').removeClass('guest-portal-child-open');
	$('#modal-account-details').removeClass('guest-portal-parent-hidden');
}

window.resetOrphanedModalBackdrops = resetOrphanedModalBackdrops;

function showAccountDetailsModal() {
	var $accountModal = $('#modal-account-details');
	if (!$accountModal.length || $accountModal.hasClass('show')) {
		return;
	}
	resetOrphanedModalBackdrops();
	ensureModalAppendedToBody($accountModal);
	var modalEl = $accountModal[0];
	if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
		bootstrap.Modal.getOrCreateInstance(modalEl, { focus: false, backdrop: 'static', keyboard: false }).show();
		return;
	}
	$accountModal.modal('show');
}

function isGuestPortalOpen() {
	var $modal = $('#modal-account-details');
	return $modal.length && $modal.hasClass('show');
}

function setGuestPortalChildModalOpen(isOpen) {
	if (isOpen) {
		$('body').addClass('guest-portal-child-open');
		$('#modal-account-details').addClass('guest-portal-parent-hidden');
	} else {
		$('body').removeClass('guest-portal-child-open');
		$('#modal-account-details').removeClass('guest-portal-parent-hidden');
	}
}

function bumpGuestPortalChildModalStack($childModal) {
	var $parentModal = $('#modal-account-details');
	if (!$childModal || !$childModal.length) {
		return;
	}
	requestAnimationFrame(function () {
		$parentModal.css('z-index', 1055);
		$childModal.css('z-index', 1065);
		var backs = document.querySelectorAll('.modal-backdrop');
		if (backs.length > 1) {
			backs[backs.length - 1].remove();
			backs = document.querySelectorAll('.modal-backdrop');
		}
		if (backs.length) {
			backs[0].style.zIndex = 1050;
		}
	});
}

function bumpGuestPortalCreditReturnStack() {
	var $creditModal = $('#modal-credit-details');
	var $returnModal = $('#modal-credit-return');
	if (!$returnModal.length) {
		return;
	}
	requestAnimationFrame(function () {
		$creditModal.css('z-index', 1055);
		$returnModal.css('z-index', 1065);
		var backs = document.querySelectorAll('.modal-backdrop');
		if (backs.length > 1) {
			backs[backs.length - 1].remove();
			backs = document.querySelectorAll('.modal-backdrop');
		}
		if (backs.length) {
			backs[0].style.zIndex = 1050;
		}
	});
}

function resetGuestPortalChildModalStack($childModal) {
	$('#modal-account-details').css('z-index', '');
	if ($childModal && $childModal.length) {
		$childModal.css('z-index', '');
	}
	document.querySelectorAll('.modal-backdrop').forEach(function (el) {
		el.style.zIndex = '';
	});
}

function prepareGuestPortalChildModal($modal) {
	ensureModalAppendedToBody($modal);
	if (isGuestPortalOpen()) {
		setGuestPortalChildModalOpen(true);
	}
}

window.prepareGuestPortalChildModal = prepareGuestPortalChildModal;

// Escape string for safe use inside JavaScript single-quoted string (prevents syntax error when name/remarks have apostrophes, newlines, etc.)
function escapeJsString(str) {
	if (str == null || str === undefined) return '';
	return String(str)
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n');
}

var totalAmount = 0;
var accountDetailsDataTable = null;
var currentAccountDetailsId = null;
var currentAccountBalance = 0;
var lastSavedAgentRemarks = '';
var currentLedgerAgencyId = null;
var selectedTransferAccountIds = {};
var transferAccountsCache = [];

// Cache for Telegram usernames
var telegramUsernameCache = {};

// Function to fetch Telegram username from chat ID
function fetchTelegramUsername(chatId, userType) {
	if (!chatId || chatId === '' || chatId === null) {
		return Promise.resolve(null);
	}

	// Return cached value if available
	if (telegramUsernameCache[chatId]) {
		return Promise.resolve(telegramUsernameCache[chatId]);
	}

	return new Promise(function(resolve) {
		$.ajax({
			url: '/telegramAPI/chat-info/' + (userType || 'GUEST') + '/' + encodeURIComponent(chatId),
			method: 'GET',
			success: function(data) {
				if (data && data.chat && data.chat.username) {
					telegramUsernameCache[chatId] = data.chat.username;
					resolve(data.chat.username);
				} else {
					telegramUsernameCache[chatId] = null;
					resolve(null);
				}
			},
			error: function() {
				telegramUsernameCache[chatId] = null;
				resolve(null);
			}
		});
	});
}

// Function to update Telegram usernames in the table
function updateTelegramUsernames() {
	const table = $('#modal-account-tbl').DataTable();
	if (!table) return;
	
	const rows = table.rows({ page: 'current' }).nodes();
	
	$(rows).each(function() {
		const $row = $(this);
		const $telegramCell = $row.find('td').eq(2); // TELEGRAM CHAT ID is column index 2
		
		if ($telegramCell.length) {
			const $span = $telegramCell.find('span[id^="telegram-modal-"]');
			
			if ($span.length) {
				const cellId = $span.attr('id');
				const chatId = $span.text().trim();
				
				if (chatId && cellId && !$span.data('username-fetched')) {
					$span.data('username-fetched', true);
					
					fetchTelegramUsername(chatId, 'GUEST').then(function(username) {
						if (username) {
							const $targetSpan = $('#' + cellId);
							if ($targetSpan.length) {
								const currentText = $targetSpan.text().trim();
								if (currentText && !currentText.includes('@')) {
									$targetSpan.html(currentText + ' <span class="text-muted">(@' + username + ')</span>');
								}
							}
						}
					});
				}
			}
		}
	});
}

$(document).ready(function () {
    if ($.fn.DataTable.isDataTable('#modal-account-tbl')) {
        $('#modal-account-tbl').DataTable().destroy();
    }

	var dataTable = $('#modal-account-tbl').DataTable({
        pageLength: 10, // Default page length
        lengthMenu: [ [10, 25, 50, 100], [10, 25, 50, 100] ], // Page length options
        columnDefs: [{
            createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
                $(cell).addClass('text-center');
            }
        }],
		drawCallback: function () {
			const table = this.api();
			const pageRows = table.rows({ page: 'current' }).data();
			let pageTotal = 0;
		
			pageRows.each(function(row) {
				const balanceText = row[5]; // column index ng TOTAL BALANCE
				const numeric = parseFloat(balanceText.replace(/[₱,]/g, '')) || 0;
				pageTotal += numeric;
			});
		
			if (table.page.info().pages > 1) {
				$('#SUB_TOTAL_SUM_VALUE').closest('tr').show();
				$('#SUB_TOTAL_SUM_VALUE').text('₱' + pageTotal.toLocaleString(undefined, {
					minimumFractionDigits: 0,
					maximumFractionDigits: 0
				}));
			} else {
				$('#SUB_TOTAL_SUM_VALUE').closest('tr').hide();
			}
			
			// Update Telegram usernames after table draw
			updateTelegramUsernames();
		}
    });
	
	
		
	function reloadData(agencyId) {
		console.log("✅ reloadData CALLED with:", agencyId);
	
		if (typeof dataTable === 'undefined') {
			console.error("❌ dataTable is undefined!");
			return;
		}
	
		$.ajax({
			url: '/account_data?agencyId=' + agencyId,
			method: 'GET',
			success: function (data) {
				console.log("Data from /account_data:", data);
				dataTable.clear();
				let grandTotal = 0;
	
				if (!Array.isArray(data) || data.length === 0) {
					dataTable.draw();
					$('#TOTAL_SUM_VALUE').text('₱0.00');
					return;
				}

				const permissions = parseInt($('#user-role').data('permissions'));

				data.forEach(function (row) {
					const totalAmount = Number(row.total_balance ?? row.total_ledger_amount ?? 0);
					grandTotal += totalAmount;

					// Only Super Admin (permissions === 0) can see the delete button
					const isSuperAdmin = permissions === 0;

					let btn = `
						<button type="button" class="btn btn-sm btn-alt-secondary js-bs-tooltip-enabled"
							data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit"
							onclick="edit_agent(${row.agent_id}, '${escapeJsString(row.agent_code)}', '${escapeJsString(row.agent_name)}', '${escapeJsString(row.agent_contact)}', '${escapeJsString(row.agent_telegram)}', '${escapeJsString(row.agent_remarks)}')">
							<i class="fa fa-pencil-alt"></i>
						</button>
					`;

					if (isSuperAdmin) {
						btn += `
							<div class="btn-group">
								<button type="button" onclick="archive_account(${row.agent_id})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
									data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
									<i class="fa fa-trash-alt"></i>
								</button>
							</div>
						`;
					}

					const account_no = permissions !== 2
						? `<a href="#" onclick="account_details(${row.account_id}, '${escapeJsString(row.agent_code)}', '${escapeJsString(row.agent_name)}')">${row.agent_code}</a>`
						: `<span>${row.agent_code}</span>`;

					// Create unique ID for Telegram cell
					const telegramCellId = 'telegram-modal-' + row.agent_id + '-' + row.account_id;
					const telegramDisplay = row.agent_telegram 
						? `<span id="${telegramCellId}">${row.agent_telegram}</span>`
						: '';

					const agentRemarksCell = window.RemarksEditor && row.agent_id
						? window.RemarksEditor.renderCell(row.agent_remarks || '', {
							source: 'agent',
							recordId: row.agent_id
						})
						: (row.agent_remarks || '');

					const rowNode = dataTable.row.add([
						`${row.agent_name}`,
						account_no,
						telegramDisplay,
						`${row.agent_contact}`,
						agentRemarksCell,
						`₱${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
						btn
					]).node();

					// Fetch username immediately for this row
					if (row.agent_telegram) {
						fetchTelegramUsername(row.agent_telegram, 'GUEST').then(function(username) {
							if (username) {
								const $span = $('#' + telegramCellId);
								if ($span.length) {
									const currentText = $span.text().trim();
									if (currentText && !currentText.includes('@')) {
										$span.html(currentText + ' <span class="text-muted">(@' + username + ')</span>');
									}
								}
							}
						});
					}
				});

				dataTable.draw();
				$('#TOTAL_SUM_VALUE').text(`₱${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
				
				// View-only: disable submit/edit/delete in Records modal after table is populated
				if (window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly()) {
					window.PermissionViewOnly.disableModalSubmitAndDelete(null, document.getElementById('modal-account-ledger'));
				}
				
				// Update Telegram usernames after data is loaded (for any rows that weren't updated during add)
				updateTelegramUsernames();
			},
			error: function (xhr, status, error) {
				console.error('Error fetching data:', error);
			}
		});
	}

	function loadTransferAgencyOptions(fromAgencyId) {
		$('#transfer_to_agency_id').html('<option value="">Loading...</option>');
		$('#transfer_account_count').text('0');

		$.ajax({
			url: '/agency_transfer_options?excludeAgencyId=' + encodeURIComponent(fromAgencyId),
			method: 'GET',
			success: function (response) {
				var options = Array.isArray(response && response.agencies) ? response.agencies : [];
				var accountCount = Number(response && response.accountCount ? response.accountCount : 0);
				$('#transfer_account_count').text(accountCount.toLocaleString('en-US'));

				var html = '<option value="">Select target line</option>';
				options.forEach(function (agency) {
					html += '<option value="' + agency.agency_id + '">' + agency.agency_name + '</option>';
				});
				$('#transfer_to_agency_id').html(html);
			},
			error: function () {
				$('#transfer_to_agency_id').html('<option value="">Failed to load agencies</option>');
			}
		});
	}

	function renderTransferAccountList(accounts) {
		var keyword = String($('#transfer_account_search').val() || '').trim();
		function escapeHtml(value) {
			return String(value == null ? '' : value)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}
		function escapeRegExp(text) {
			return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
		function highlightMatch(text) {
			var safeText = escapeHtml(text);
			if (!keyword) return safeText;
			var pattern = new RegExp('(' + escapeRegExp(keyword) + ')', 'ig');
			return safeText.replace(pattern, '<mark class="px-0 bg-warning-subtle">$1</mark>');
		}

		var html = '';
		accounts.forEach(function (account) {
			var accountId = String(account.account_id);
			var checked = !!selectedTransferAccountIds[accountId];
			var accountCode = account.agent_code || '';
			var accountName = account.agent_name || '';
			html += `
				<div class="form-check mb-1 transfer-account-col">
					<input class="form-check-input transfer-account-item" type="checkbox" id="transfer_account_${accountId}" value="${accountId}" ${checked ? 'checked' : ''}>
					<label class="form-check-label" for="transfer_account_${accountId}">
						${highlightMatch(accountCode)} - ${highlightMatch(accountName)}
					</label>
				</div>
			`;
		});
		$('#transfer-account-list').html(html || '<div class="text-muted">No accounts found.</div>');
	}

	function applyTransferAccountSearch() {
		var keyword = String($('#transfer_account_search').val() || '').trim().toLowerCase();
		$('#transfer_account_search_clear').toggleClass('d-none', keyword === '');
		var filtered = transferAccountsCache.filter(function (account) {
			var label = ((account.agent_code || '') + ' ' + (account.agent_name || '')).toLowerCase();
			return label.includes(keyword);
		});
		renderTransferAccountList(filtered);
	}

	function updateTransferSelectedCount() {
		var count = Object.keys(selectedTransferAccountIds).filter(function (id) {
			return !!selectedTransferAccountIds[id];
		}).length;
		$('#transfer_selected_count').text(count.toLocaleString('en-US'));
		return count;
	}

	function loadTransferAccounts(fromAgencyId) {
		$('#transfer-account-list').html('<div class="text-muted">Loading accounts...</div>');
		$('#transfer_select_all_accounts').prop('checked', false);
		$('#transfer_selected_count').text('0');

		$.ajax({
			url: '/account_data?agencyId=' + encodeURIComponent(fromAgencyId),
			method: 'GET',
			success: function (accounts) {
				var list = Array.isArray(accounts) ? accounts : [];
				transferAccountsCache = list;
				applyTransferAccountSearch();
				updateTransferSelectedCount();
			},
			error: function () {
				$('#transfer-account-list').html('<div class="text-danger">Failed to load accounts.</div>');
			}
		});
	}

	$('#transfer_account_search').off('input').on('input', function () {
		applyTransferAccountSearch();
	});

	$('#transfer_account_search_clear').off('click').on('click', function () {
		$('#transfer_account_search').val('').trigger('input').focus();
	});

	$(document).off('change.transferAccountItem', '.transfer-account-item').on('change.transferAccountItem', '.transfer-account-item', function () {
		var accountId = String($(this).val());
		selectedTransferAccountIds[accountId] = $(this).is(':checked');
		updateTransferSelectedCount();
	});

	$('#transfer_select_all_accounts').off('change').on('change', function () {
		var checked = $(this).is(':checked');
		$('.transfer-account-item').each(function () {
			var accountId = String($(this).val());
			$(this).prop('checked', checked);
			selectedTransferAccountIds[accountId] = checked;
		});
		updateTransferSelectedCount();
	});
	

 // Move openAccountLedgerModal inside ready block
 function openAccountLedgerModal(agencyId) {
	console.log("Front-end sees Agency ID:", agencyId);
	currentLedgerAgencyId = agencyId;

	// Set agency name for the modal title
	get_agency_name(agencyId);

	// Store agency ID for hidden input
	$('#txtAgencyLine').val(agencyId);

	// Show the modal first
	$('#modal-account-ledger').modal('show');
	reloadData(agencyId);
	// Remove previous modal shown event to avoid duplicate triggers
	$('#modal-account-ledger').off('shown.bs.modal').on('shown.bs.modal', function () {
		// Show the table only after it's properly initialized
		$('#modal-account-tbl').show();
	});
}
	

    // If you want it callable globally (optional):
    window.openAccountLedgerModal = openAccountLedgerModal;

	$('#btn-open-transfer-agency').off('click').on('click', function () {
		if (!currentLedgerAgencyId) {
			Swal.fire({
				icon: 'warning',
				title: 'No agency selected',
				text: 'Please open an agency first.',
				confirmButtonText: 'OK'
			});
			return;
		}

		$('#transfer_archive_agency_ids_after').val('');
		$('#transfer_from_agency_id').val(currentLedgerAgencyId);
		$('#transfer_from_agency_name').text($('#agency_name_modal').text() || 'Unknown');
		$('#transfer_to_agency_id').val('');
		$('#transfer_account_search').val('');
		$('#transfer_account_search_clear').addClass('d-none');
		selectedTransferAccountIds = {};
		transferAccountsCache = [];

		loadTransferAgencyOptions(currentLedgerAgencyId);
		loadTransferAccounts(currentLedgerAgencyId);
		$('#modal-transfer-agency').modal('show');
	});

	/**
	 * Open Change Agent modal for a given agency (e.g. from Agents page before archive).
	 * @param {string|number} agencyId - Source agent/agency ID
	 * @param {string} agencyDisplayName - Label shown in modal
	 * @param {number[]} [archiveAgencyIdsAfter] - If set, after a successful transfer these agents are archived (PUT /agency/remove) then the page reloads
	 */
	window.openTransferAgencyModalForAgency = function (agencyId, agencyDisplayName, archiveAgencyIdsAfter) {
		var ids = Array.isArray(archiveAgencyIdsAfter)
			? archiveAgencyIdsAfter.map(function (x) { return parseInt(x, 10); }).filter(function (n) { return n > 0; })
			: [];
		$('#transfer_archive_agency_ids_after').val(ids.length ? ids.join(',') : '');
		currentLedgerAgencyId = agencyId;
		$('#transfer_from_agency_id').val(agencyId);
		$('#transfer_from_agency_name').text(agencyDisplayName || 'Unknown');
		$('#transfer_to_agency_id').val('');
		$('#transfer_account_search').val('');
		$('#transfer_account_search_clear').addClass('d-none');
		selectedTransferAccountIds = {};
		transferAccountsCache = [];
		loadTransferAgencyOptions(agencyId);
		loadTransferAccounts(agencyId);
		$('#modal-transfer-agency').modal('show');
	};

	$('#transfer-agency-form').off('submit').on('submit', function (event) {
		event.preventDefault();

		var fromAgencyId = $('#transfer_from_agency_id').val();
		var toAgencyId = $('#transfer_to_agency_id').val();
		var selectedIds = Object.keys(selectedTransferAccountIds).filter(function (id) {
			return !!selectedTransferAccountIds[id];
		});

		if (!toAgencyId) {
			Swal.fire({
				icon: 'warning',
				title: 'Target agency required',
				text: 'Please select the agency to transfer to.',
				confirmButtonText: 'OK'
			});
			return;
		}
		if (selectedIds.length === 0) {
			Swal.fire({
				icon: 'warning',
				title: 'No account selected',
				text: 'Please select account(s) to transfer.',
				confirmButtonText: 'OK'
			});
			return;
		}

		var $submitBtn = $('#btn-submit-transfer-agency');
		$submitBtn.prop('disabled', true).text('Processing...');

		$.ajax({
			url: '/account/transfer-agency',
			type: 'POST',
			data: {
				fromAgencyId: fromAgencyId,
				toAgencyId: toAgencyId,
				accountIds: selectedIds
			},
			success: function (response) {
				var message = (response && response.message) ? response.message : 'Accounts transferred successfully.';
				var rawArchiveIds = String($('#transfer_archive_agency_ids_after').val() || '').trim();
				$('#transfer_archive_agency_ids_after').val('');
				var archiveIds = rawArchiveIds
					? rawArchiveIds.split(',').map(function (x) { return parseInt(x, 10); }).filter(function (n) { return n > 0; })
					: [];

				Swal.fire({
					icon: 'success',
					title: 'Transfer completed',
					text: message,
					confirmButtonText: 'OK'
				}).then(function () {
					$('#modal-transfer-agency').modal('hide');
					if (archiveIds.length > 0) {
						Promise.all(archiveIds.map(function (id) {
							return $.ajax({
								url: '/agency/remove/' + id,
								type: 'PUT'
							});
						})).then(function () {
							window.location.reload();
						}).catch(function (err) {
							console.error('Error archiving after transfer:', err);
							Swal.fire({
								icon: 'warning',
								title: 'Transfer saved',
								text: 'Accounts were moved, but archiving the agent failed. Try archiving again from the Agents page.',
								confirmButtonText: 'OK'
							});
						});
					} else if (currentLedgerAgencyId && $('#modal-account-ledger').hasClass('show')) {
						reloadData(currentLedgerAgencyId);
					}
				});
			},
			error: function (xhr) {
				var message = xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.message)
					? (xhr.responseJSON.error || xhr.responseJSON.message)
					: 'Failed to transfer accounts.';
				Swal.fire({
					icon: 'error',
					title: 'Transfer failed',
					text: message,
					confirmButtonText: 'OK'
				});
			},
			complete: function () {
				$submitBtn.prop('disabled', false).text('Transfer');
			}
		});
	});


});

$(document).ready(function () {
    $('#add_transfer_account').submit(function (event) {
        event.preventDefault();

        var form = $(this);
        var submitButton = form.find('button[type="submit"]');
        
		const rawAmount = String(form.find('input[name="txtAmount"]').val() || '0').split(',').join('');
		const rawFromBalance = String($('#TransferFromBalance').val() || '0').split(',').join('');
		const amountNum = parseFloat(rawAmount);
		const fromBalanceNum = parseFloat(rawFromBalance);

		if (!Number.isFinite(amountNum) || !Number.isFinite(fromBalanceNum)) {
			Swal.fire({
				icon: 'error',
				title: 'Invalid amount',
				text: 'Please enter valid numbers before saving.',
				confirmButtonText: 'OK'
			});
			return;
		}

		if (amountNum > fromBalanceNum) {
			Swal.fire({
				icon: 'error',
				title: 'Insufficient balance',
				text: 'The transfer amount exceeds the available balance.',
				confirmButtonText: 'OK'
			});
			return;
		}

        // Disable submit button to prevent multiple submissions
        submitButton.prop('disabled', true).text('Processing...');

        var formData = form.serialize();

        $.ajax({
            url: '/add_account_details/transfer',
            type: 'POST',
            data: formData,
            success: function (response) {
                const message =
                    (typeof response === 'object' && response.message)
                        ? response.message
                        : 'Transfer was successful.';

                Swal.fire({
                    title: 'Success!',
                    text: message,
                    icon: 'success',
                    confirmButtonText: 'OK'
                }).then(() => {
                    $('#modal-transfer_account').modal('hide');
                    // Refresh guest portal data without full page reload.
                    reloadDataDetails();
                });
            },
            error: function (xhr, status, error) {
                var errorMessage = xhr.responseJSON ? (xhr.responseJSON.error || xhr.responseJSON.message) : 'Something went wrong!';
                Swal.fire({
                    title: 'Error!',
                    text: errorMessage,
                    icon: 'error',
                    confirmButtonText: 'OK'
                });
                console.error('Error processing transfer:', error);
            },
            complete: function () {
                // Re-enable submit button after request completes
                submitButton.prop('disabled', false).text('Save');
            }
        });
    });
});

function getAccountDetailsDt() {
	var $tbl = $('#modal-account-details #accountDetails');
	if (!$tbl.length) return null;
	if (!$.fn.DataTable.isDataTable($tbl[0])) return null;
	return $tbl.DataTable();
}

function applyAccountDetailsTransactionFilter(regex) {
	var table = getAccountDetailsDt();
	if (!table) return;
	table.search('');
	table.columns().search('');
	table.column(1).search(regex, true, false).draw();
}

// Deposit-only filter
$(document).off('click', '#btn-filter-deposit').on('click', '#btn-filter-deposit', function (e) {
	e.preventDefault();
	applyAccountDetailsTransactionFilter('\\bDEPOSIT\\b');
});

// Withdraw-only filter
$(document).off('click', '#btn-filter-withdraw').on('click', '#btn-filter-withdraw', function (e) {
	e.preventDefault();
	applyAccountDetailsTransactionFilter('\\bWITHDRAW\\b');
});

// Transfer-only filter (in/out)
$(document).off('click', '#btn-filter-transfer').on('click', '#btn-filter-transfer', function (e) {
	e.preventDefault();
	applyAccountDetailsTransactionFilter('Received\\s+from|Transferred\\s+to');
});

// Reset filter for the Account Details table
$(document).off('click', '#btn-reset-account-details-filter').on('click', '#btn-reset-account-details-filter', function () {
	var table = getAccountDetailsDt();
	if (!table) return;
	table.search('');
	table.columns().search('');
	table.draw();
});

function loadGameListScriptOnce() {
	return new Promise(function (resolve, reject) {
		if (typeof window.addGameList === 'function') {
			resolve();
			return;
		}

		var src = '/assets/js/functions/game_list.js';
		var existing = document.querySelector('script[src="' + src + '"]');
		var waitForAddGameList = function (attempt) {
			var tryNo = attempt || 0;
			if (typeof window.addGameList === 'function') {
				resolve();
				return;
			}
			if (tryNo >= 100) {
				reject(new Error('addGameList not available'));
				return;
			}
			setTimeout(function () { waitForAddGameList(tryNo + 1); }, 50);
		};

		if (existing) {
			waitForAddGameList(0);
			return;
		}

		var script = document.createElement('script');
		script.src = src;
		script.onload = function () { waitForAddGameList(0); };
		script.onerror = function () { reject(new Error('Failed to load game_list.js')); };
		document.body.appendChild(script);
	});
}

function openGuestPortalGameStart() {
	var accountId = $('#account_id').val() || $('#account_id_add').val() || account_id || '';
	accountId = String(accountId || '').trim();
	if (!accountId) {
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'warning', title: 'No account', text: 'Please open an account first.', confirmButtonText: 'OK' });
		}
		return;
	}

	if (!$('#modal-new-game-list').length) {
		if (typeof Swal !== 'undefined') {
			Swal.fire({
				icon: 'error',
				title: 'Unavailable',
				text: 'New Game modal is not available on this page.',
				confirmButtonText: 'OK'
			});
		}
		return;
	}

	loadGameListScriptOnce().then(function () {
		var openingBalance = parseFloat($('#total_balanceGuest').val()) || 0;
		if (!openingBalance) {
			var balanceText = ($('#modal-account-details .total_balance').first().text() || '').replace(/[^0-9.-]/g, '');
			openingBalance = parseFloat(balanceText) || 0;
		}
		var agentCode = ($('#agent_code').text() || '').trim();
		var agentName = ($('#account_name').text() || '').trim();
		var agentId = ($('#account_agent_id').val() || '').trim();
		$('#modal-account-details').modal('hide');
		window.addGameList(accountId, {
			openingBalance: openingBalance,
			lockAccount: true,
			accountMeta: {
				agentCode: agentCode,
				agentName: agentName,
				agentId: agentId
			}
		});
	}).catch(function () {
		if (typeof Swal !== 'undefined') {
			Swal.fire({
				icon: 'error',
				title: 'Unavailable',
				text: 'Unable to open New Game modal right now.',
				confirmButtonText: 'OK'
			});
		}
	});
}
window.openGuestPortalGameStart = openGuestPortalGameStart;

$(document).off('click', '#btn-guest-portal-game-start').on('click', '#btn-guest-portal-game-start', function () {
	openGuestPortalGameStart();
});

// Open per-account Credit modal and show account-specific credit transactions
$(document).off('click', '#btn-credit').on('click', '#btn-credit', function () {
	var requestSeq = ++creditDetailsRequestSeq;
	var accountId = $('#account_id').val() || $('#account_id_add').val();
	if (!accountId) {
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'No account', text: 'Please open an account first.' });
		return;
	}

	var accountCode = ($('#agent_code').text() || '').trim();
	var accountName = ($('#account_name').text() || '').trim();
	$('#credit-account-title').text([accountCode, accountName].filter(Boolean).join(' - '));

	function resetCreditTableRows() {
		if ($.fn.DataTable.isDataTable('#credit-details-table')) {
			$('#credit-details-table').DataTable().destroy();
		}
		$('#credit-details-body').empty();
	}

	$('#credit-details-loading').removeClass('d-none');
	$('#credit-junket-balance').text('0');
	$('#credit-game-balance').text('0');
	resetCreditTableRows();

	prepareGuestPortalChildModal($('#modal-credit-details'));
	$('#modal-credit-details').modal('show');
	$('#btn-credit-return').data('account-id', accountId);

	function formatMarkerAmount(value) {
		var n = value != null ? Number(value) : 0;
		if (isNaN(n)) return '0';
		var rounded = Math.round(n * 100) / 100;
		if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
			return Math.round(rounded).toLocaleString('en-US');
		}
		return rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
	}

	$.ajax({
		url: '/marker_data_breakdown',
		method: 'GET',
		success: function (rows) {
			if (requestSeq !== creditDetailsRequestSeq) return;
			var list = Array.isArray(rows) ? rows : [];
			var sourceRow = list.filter(function (r) { return String(r.ACCOUNT_ID) === String(accountId); })[0];
			var junketBalance = sourceRow && sourceRow.BALANCE_CREDIT != null ? Number(sourceRow.BALANCE_CREDIT) : 0;
			var gameBalance = sourceRow && sourceRow.BALANCE_BUYIN != null ? Number(sourceRow.BALANCE_BUYIN) : 0;
			$('#credit-junket-balance').text(formatMarkerAmount(junketBalance));
			$('#credit-game-balance').text(formatMarkerAmount(gameBalance));
		}
	});

	$.ajax({
		url: '/marker_history',
		method: 'GET',
		success: function (rows) {
			if (requestSeq !== creditDetailsRequestSeq) return;
			var list = Array.isArray(rows) ? rows : [];
			var creditRows = list.filter(function (row) {
				return String(row.ACCOUNT_ID) === String(accountId);
			});
			creditRows.sort(function (a, b) {
				var aTime = new Date(a.ENCODED_DT || 0).getTime();
				var bTime = new Date(b.ENCODED_DT || 0).getTime();
				if (isNaN(aTime)) aTime = 0;
				if (isNaN(bTime)) bTime = 0;
				if (bTime !== aTime) return bTime - aTime;
				return (parseInt(b.IDNo, 10) || 0) - (parseInt(a.IDNo, 10) || 0);
			});

			$('#credit-details-loading').addClass('d-none');

			if (!creditRows.length) {
				resetCreditTableRows();
				$('#credit-details-body').html('<tr><td colspan="5" class="text-center text-muted py-4">No credit records for this account.</td></tr>');
				return;
			}

			function escapeHtml(s) {
				if (s == null || s === '') return '';
				return String(s)
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;');
			}

			function getReturnSourceLabel(desc) {
				var normalized = String(desc || '').trim().toUpperCase();
				if (normalized === 'RETURN_SOURCE:CREDIT') return 'Junket Credit';
				if (normalized === 'RETURN_SOURCE:BUYIN') return 'Game Credit';
				return '';
			}

			function renderTransactionType(data, row) {
				if (!data) return '';
				var parts = String(data).split('-');
				var transactionId = parseInt(parts[0], 10);
				var transactionType = parseInt(parts[1], 10);
				var sourceLabel = getReturnSourceLabel(row && row.TRANSACTION_DESC);
				switch (transactionId) {
					case 3: return 'Junket Credit';
					case 11: return sourceLabel ? (sourceLabel + ' Returned thru Cash') : 'Credit Returned thru Cash';
					case 12: return sourceLabel ? (sourceLabel + ' Returned thru Deposit') : 'Credit Returned thru Deposit';
					case 10: return 'Buy-in thru Credit';
					default:
						return transactionType === 4 ? 'Chips Return thru Credit' : 'Unknown Transaction';
				}
			}

			function isCreditOutTransaction(row) {
				if (!row || row.TRANSACTION_INFO == null) return false;
				var transactionId = parseInt(String(row.TRANSACTION_INFO).split('-')[0], 10);
				return transactionId === 3 || transactionId === 10;
			}

			function formatCreditAmountCell(amountNum, row) {
				if (isCreditOutTransaction(row)) {
					if (window.fmtOut) return window.fmtOut(amountNum);
					var formatted = window.fmtAmt ? window.fmtAmt(Math.abs(amountNum)) : Math.abs(amountNum).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
					if (formatted === '0') return '0';
					return '<span style="color:#dc3545 !important;">(' + formatted + ')</span>';
				}
				return window.fmtAmt ? window.fmtAmt(amountNum) : amountNum.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
			}

			var html = creditRows.map(function (row) {
				var amountNum = parseFloat(row.AMOUNT) || 0;
				var encoded = row.ENCODED_DT || '';
				var dateDisplay = encoded;
				if (window.moment && encoded) {
					var m = moment(encoded);
					if (m.isValid()) dateDisplay = m.format('YYYY-MM-DD HH:mm');
				}
				var remarks = row.REMARKS || '';
				var remarksCell = window.RemarksEditor && row.IDNo
					? window.RemarksEditor.renderCell(remarks, { source: 'account_ledger', recordId: row.IDNo })
					: escapeHtml(remarks || '—');
				var accountDisplay = (row.AGENT_CODE || '') + ' (' + (row.AGENT_NAME || '') + ')';
				return '' +
					'<tr>' +
						'<td>' + escapeHtml(accountDisplay) + '</td>' +
						'<td class="text-center">' + formatCreditAmountCell(amountNum, row) + '</td>' +
						'<td>' + escapeHtml(renderTransactionType(row.TRANSACTION_INFO, row)) + '</td>' +
						'<td class="text-center">' + escapeHtml(dateDisplay || '') + '</td>' +
						'<td>' + remarksCell + '</td>' +
					'</tr>';
			}).join('');

			$('#credit-details-body').html(html);

			if ($.fn.DataTable.isDataTable('#credit-details-table')) {
				$('#credit-details-table').DataTable().destroy();
			}

			$('#credit-details-table').DataTable({
				order: [],
				autoWidth: false,
				pageLength: 10,
				dom: '<"row g-0 gy-2 mb-2 align-items-center gap-3"<"col-12 col-md-auto"l><"col-12 col-md d-flex justify-content-end align-items-center"f>>rt<"row g-2 mt-2"<"col-12 col-md-6"i><"col-12 col-md-6"p>>'
			});
		},
		error: function () {
			if (requestSeq !== creditDetailsRequestSeq) return;
			$('#credit-details-loading').addClass('d-none');
			resetCreditTableRows();
			$('#credit-details-body').html('<tr><td colspan="5" class="text-center text-muted py-4">No credit records for this account.</td></tr>');
		}
	});
});

var guestPortalChildModalSelectors = '#modal-game-history, #modal-credit-details, #modal-passport-details, #modal-change-photo, #modal-edit-account-ledger, #modal-guest-portal-receipt';

$(guestPortalChildModalSelectors).on('shown.bs.modal', function () {
	if ($('body').hasClass('guest-portal-child-open')) {
		bumpGuestPortalChildModalStack($(this));
	}
});

$(guestPortalChildModalSelectors).on('hidden.bs.modal', function () {
	if (isGuestPortalOpen()) {
		setGuestPortalChildModalOpen(false);
		resetGuestPortalChildModalStack($(this));
	}
});

$('#modal-credit-return').on('shown.bs.modal', function () {
	if ($('#modal-credit-details').hasClass('show')) {
		bumpGuestPortalCreditReturnStack();
	}
});

$('#modal-credit-return').on('hidden.bs.modal', function () {
	$('#modal-credit-details').css('z-index', '');
	$('#modal-credit-return').css('z-index', '');
});

$('#modal-account-details').on('hidden.bs.modal', function () {
	setGuestPortalChildModalOpen(false);
	resetGuestPortalChildModalStack($('#modal-game-history'));
	resetGuestPortalChildModalStack($('#modal-credit-details'));
	resetGuestPortalChildModalStack($('#modal-passport-details'));
	resetGuestPortalChildModalStack($('#modal-change-photo'));
	resetGuestPortalChildModalStack($('#modal-edit-account-ledger'));
	resetGuestPortalChildModalStack($('#modal-guest-portal-receipt'));
});

$(document).off('click', '#btn-credit-return').on('click', '#btn-credit-return', function () {
	var accountId = $(this).data('account-id') || $('#account_id').val() || $('#account_id_add').val();
	if (!accountId) {
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'No account', text: 'Please open an account first.' });
		return;
	}
	function parseAmountText(value) {
		return parseFloat(String(value || '0').replace(/,/g, '').trim()) || 0;
	}

	if ($('#modal-credit-return').length) {
		var junketBal = parseAmountText($('#credit-junket-balance').text());
		var gameBal = parseAmountText($('#credit-game-balance').text());
		$('#credit-return-account-id').val(accountId);
		$('#credit-return-junket-balance').val(junketBal);
		$('#credit-return-game-balance').val(gameBal);
		$('#credit-return-junket-balance-display').text(junketBal.toLocaleString('en-US'));
		$('#credit-return-game-balance-display').text(gameBal.toLocaleString('en-US'));
		$('input[name="creditReturnSource"]').prop('checked', false);
		$('input[name="creditReturnTransType"]').prop('checked', false);
		$('#credit-return-amount').val('');
		$('#credit-return-remarks').val('');
		$('#credit-return-balance').val('');
		$('#modal-credit-return').modal('show');
		return;
	}

	if (!$('#modal-new-marker').length) {
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Unavailable', text: 'Return modal is not available on this page.' });
		return;
	}

	$('#modal-credit-details').modal('hide');
	$('#modal-new-marker').modal('show');

	setTimeout(function () {
		var $creditSource = $('#return-source-credit');
		if ($creditSource.length) $creditSource.prop('checked', true).trigger('change');

		var tries = 0;
		var maxTries = 15;
		var timer = setInterval(function () {
			tries += 1;
			var $accountMarker = $('#txtAccountMarker');
			if (!$accountMarker.length) {
				if (tries >= maxTries) clearInterval(timer);
				return;
			}
			var hasOption = $accountMarker.find('option[value="' + accountId + '"]').length > 0;
			if (hasOption) {
				$accountMarker.val(String(accountId)).trigger('change');
				clearInterval(timer);
				return;
			}
			if (tries >= maxTries) clearInterval(timer);
		}, 200);
	}, 250);
});

$(document).off('change', 'input[name="creditReturnSource"]').on('change', 'input[name="creditReturnSource"]', function () {
	var source = $('input[name="creditReturnSource"]:checked').val() || 'credit';
	var junketBal = parseFloat($('#credit-return-junket-balance').val()) || 0;
	var gameBal = parseFloat($('#credit-return-game-balance').val()) || 0;
	var selectedBalance = source === 'credit' ? junketBal : gameBal;
	$('#credit-return-balance').val(selectedBalance.toLocaleString('en-US'));
});

$(document).off('click', '#btn-save-credit-return').on('click', '#btn-save-credit-return', function () {
	var accountId = $('#credit-return-account-id').val();
	var source = $('input[name="creditReturnSource"]:checked').val();
	var transType = $('input[name="creditReturnTransType"]:checked').val();
	var amountText = $('#credit-return-amount').val();
	var remarks = $('#credit-return-remarks').val() || '';
	var amount = parseFloat(String(amountText || '0').replace(/,/g, '').trim()) || 0;
	var junketBal = parseFloat($('#credit-return-junket-balance').val()) || 0;
	var gameBal = parseFloat($('#credit-return-game-balance').val()) || 0;
	var maxBySource = 0;

	if (!accountId) {
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Missing account.' });
		return;
	}
	if (!source || !transType) {
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Invalid Input', text: 'Please select return source and transaction.' });
		return;
	}
	maxBySource = source === 'credit' ? junketBal : gameBal;
	if (!amount || amount <= 0) {
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Invalid Amount', text: 'Credit Return must be greater than zero.' });
		return;
	}
	if (amount > maxBySource) {
		var balanceLabel = source === 'credit' ? 'Junket Credit Balance' : 'Game Credit Balance';
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Invalid Amount', text: 'Return amount exceeded the ' + balanceLabel + '.' });
		return;
	}

	var $btn = $('#btn-save-credit-return');
	var originalText = $btn.text();
	$btn.prop('disabled', true).text('Saving...');
	$.ajax({
		url: '/add_marker_settlement',
		method: 'POST',
		data: {
			txtAccountMarker: accountId,
			txtMarkerReturn: amount.toString(),
			optTransType: transType,
			optReturnSource: source,
			AgentBalance: 0,
			remarks: remarks
		},
		success: function (response) {
			if (response && response.success) {
				$(document).trigger('agency:account-transaction-saved', {
					accountId: accountId,
					source: source,
					transactionType: transType,
					context: 'credit-return'
				});
				$('#modal-credit-return').modal('hide');
				if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: 'Marker Return Successfully!' });
				$('#btn-credit').trigger('click');
				if (typeof reloadDataDetails === 'function') {
					reloadDataDetails();
				}
			} else {
				if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: (response && (response.error || response.message)) || 'Error processing your request.' });
			}
		},
		error: function (xhr) {
			var msg = (xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.message)) || 'Error processing your request.';
			if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: msg });
		},
		complete: function () {
			$btn.prop('disabled', false).text(originalText);
		}
	});
});

$(document).off('input', '#credit-return-amount').on('input', '#credit-return-amount', function () {
	var raw = String($(this).val() || '').replace(/,/g, '').replace(/[^\d.]/g, '');
	var parts = raw.split('.');
	if (parts.length > 2) {
		raw = parts[0] + '.' + parts.slice(1).join('');
		parts = raw.split('.');
	}
	var intPart = parts[0] || '';
	var decPart = parts.length > 1 ? parts[1].slice(0, 2) : '';
	var intWithCommas = intPart ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
	$(this).val(decPart ? (intWithCommas + '.' + decPart) : intWithCommas);
});


function archive_account(id) {
    SwalConfirm.fire({
        title: 'Are you sure?',
        message: 'This will delete the account.',
        confirmButtonText: 'Yes, Delete it!'
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: '/agent/remove/' + id,
                type: 'PUT',
                success: function (response) {
                    Swal.fire({
                        title: 'Deleted!',
                        text: 'Account deleted successfully.',
                        icon: 'success',
                        confirmButtonText: 'OK'
                    }).then(() => {
                        window.location.reload(); // or reloadData(); kung naka-DT ka
                    });
                },
                error: function (xhr) {
                    Swal.fire({
                        title: 'Error!',
                        text: 'Something went wrong while archiving.',
                        icon: 'error',
                        confirmButtonText: 'OK'
                    });
                    console.error('❌ Error archiving agent:', xhr.responseText);
                }
            });
        }
    });
}


function get_agent() {
	$.ajax({
		url: '/agent_data',
		method: 'GET',
		success: function (response) {
			var selectOptions = $('#agent_id');
			selectOptions.empty();
			selectOptions.append($('<option>', {
				value: '',
				text: '--SELECT AGENT--'
			}));
			response.forEach(function (option) {
				selectOptions.append($('<option>', {
					value: option.agent_id,
					text: option.agency_code + '-' + option.agent_code
				}));
			});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

function edit_get_agent(id) {
	$.ajax({
		url: '/agent_data',
		method: 'GET',
		success: function (response) {
			var selectOptions = $('.agent_id');
			selectOptions.empty();
			selectOptions.append($('<option>', {
				selected: false,
				value: '',
				text: '--SELECT AGENT--'
			}));
			response.forEach(function (option) {
				var selected = false;
				if (option.agent_id == id) {
					selected = true;
				}
				selectOptions.append($('<option>', {
					selected: selected,
					value: option.agent_id,
					text: option.agency_code + '-' + option.agent_code
				}));
			});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

$('#agent_id').on('change', function () {
	var agent = $(this).val().split();

	get_agent_name(agent[0]);
});

$('.agent_id').on('change', function () {
	var agent = $(this).val();

	edit_get_agent_name(agent);
})


function get_agency_name(id) {
	$.ajax({
		url: '/agency_data/' + id,
		method: 'GET',
		success: function (response) {
			if (response.length > 0) {
				const agencyName = response[0].agency_name;
				$('#agency_name_modal').text(agencyName);
			} else {
				$('#agency_name_modal').text('Unknown');
			}
		},
		error: function (xhr, status, error) {
			console.error('Error fetching agency:', error);
			$('#agency_name_modal').text('Unknown');
		}
	});
}


function get_agent_name(id) {
	$.ajax({
		url: '/agent_data/' + id,
		method: 'GET',
		success: function (response) {
			$('#agent_name').val(response[0].agent_name);
			$('#agency_name').val(response[0].agency);

			
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

function edit_get_agent_name(id) {
	$.ajax({
		url: '/agent_data/' + id,
		method: 'GET',
		success: function (response) {
			$('#edit_agent_name').val(response[0].agent_name);
			$('#edit_agency_name').val(response[0].agency);
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

function account_details(account_id_data, agent_code, account_name) {
    
    
    fetch(`/account_passportphoto_data/${account_id_data}`)
    .then(response => {
        // console.log(`Response for account ID ${account_id_data}:`, response);
        return response.json();
    })
    .then(data => {
        // console.log(`Fetched account data:`, JSON.stringify(data, null, 2));  // Log the entire data
        if (data.length > 0) {
            const account = data[0];
            // console.log(`Fetched account details:`, account);
            
            // Check if agent_code is present
            const agentCode = account.agent_code || 'N/A';  // Default to 'N/A' if agent_code is not present
            document.getElementById('agent_code').textContent = agentCode;
            var agentIdEl = document.getElementById('account_agent_id');
            if (agentIdEl) agentIdEl.value = account.AGENT_ID || '';
            // console.log(`Agent Code: ${agentCode}`);  // Log the agent code
            
            document.getElementById('account_name').textContent = account.account_name || 'N/A';
         //   document.getElementById('account_id').value = account.ACCOUNT_ID || '';

            const remarksEl = document.getElementById('agent_remarks_notice');
            if (remarksEl) {
                const ar = account.agent_remarks != null ? String(account.agent_remarks).trim() : '';
                remarksEl.value = ar;
                lastSavedAgentRemarks = ar;
            }

            // Check for passport photo (fallback to default webp if missing/corrupt)
            setGuestProfilePhoto(document.getElementById('account_photo'), account.PASSPORTPHOTO);
        } else {
            console.log('No data found for this account');
            const remarksElEmpty = document.getElementById('agent_remarks_notice');
            if (remarksElEmpty) {
                remarksElEmpty.value = '';
                lastSavedAgentRemarks = '';
            }
        }
    })
    .catch(error => {
        console.error('Error fetching account details:', error);
        const remarksElErr = document.getElementById('agent_remarks_notice');
        if (remarksElErr) {
            remarksElErr.value = '';
            lastSavedAgentRemarks = '';
        }
	});


	showAccountDetailsModal();
    
    $('#agent_code').text(agent_code);
	$('#account_name').text(account_name);
	$('#account_id').val(account_id_data);
	$('#agent_remarks_notice').val('');
	lastSavedAgentRemarks = '';

	$('.txtAmount').val('');
	$('.remarks').val('');
	$('input[name="txtTrans"]').prop('checked', false);
	
	$('#account_id_add').val(account_id_data);
	$('#account_agent_id').val('');

	account_id = account_id_data;

	try {
		accountDetailsDataTable = getOrInitAccountDetailsDataTable();
		accountDetailsDataTable.search('');
		accountDetailsDataTable.columns().search('');
		currentAccountDetailsId = account_id_data;
		reloadDataDetails();
	} catch (err) {
		console.error('Error initializing account details table:', err);
	}
}
window.account_details = account_details;

function isJunketFundsTransferDesc(transactionDesc) {
	const normalized = String(transactionDesc || '').trim().toUpperCase();
	return normalized === 'JUNKET FUNDS' || normalized === 'Transffered from Junket Funds';
}

function isPlainGuestPortalLedgerDesc(transactionDesc) {
	return String(transactionDesc || '').trim().toUpperCase() === 'SERVICES';
}

function isGuestPortalCreditCashEntry(transaction, transactionDesc) {
	const trans = String(transaction || '').trim().toUpperCase();
	const desc = String(transactionDesc || '').trim().toUpperCase();
	return desc === 'ACCOUNT DETAILS' && (trans === 'CREDIT CASH' || trans === 'IOU CASH' || trans === 'CREDIT');
}

function isJunketCreditReturnEntry(transaction, transactionDesc) {
	const trans = String(transaction || '').trim();
	const desc = String(transactionDesc || '').trim();
	return trans === 'IOU RETURN DEPOSIT' && desc === 'RETURN_SOURCE:CREDIT';
}

function formatAccountLedgerTransactionCell(transaction, transactionDesc) {
	const trans = String(transaction || '').trim();
	const desc = String(transactionDesc || '').trim();

	if (isJunketFundsTransferDesc(desc)) {
		return 'Transffered from Junket Funds';
	}
	if (isJunketCreditReturnEntry(trans, desc)) {
		return 'JUNKET CREDIT RETURN THRU DEPOSIT';
	}
	if (trans === 'IOU RETURN DEPOSIT' && desc === 'RETURN_SOURCE:BUYIN') {
		return 'GAME CREDIT RETURN THRU DEPOSIT';
	}
	if (isPlainGuestPortalLedgerDesc(desc)) {
		return `${trans} - ${desc}`;
	}
	return desc ? `${trans} - <strong>${desc}</strong>` : trans;
}

	function formatAccountLedgerAmount(amount, transaction, transactionDesc) {
		const n = parseFloat(String(amount).replace(/,/g, '')) || 0;
		if (isGuestPortalCreditCashEntry(transaction, transactionDesc)) {
			if (window.AmountFormat) {
				return window.AmountFormat.formatAmountNegativeHtml(n);
			}
			const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 0 });
			return `<span class="text-danger">(${formatted})</span>`;
		}
		const isOut = !isPlainGuestPortalLedgerDesc(transactionDesc)
			&& !isJunketCreditReturnEntry(transaction, transactionDesc)
			&& (transaction === 'WITHDRAW' || transaction === 'MARKER REDEEM' || transaction === 'IOU RETURN DEPOSIT');
		if (window.AmountFormat) {
			if (isOut) return window.AmountFormat.formatAmountNegativeHtml(n);
			return window.AmountFormat.formatCommas(n);
		}
		return n.toLocaleString('en-US', { minimumFractionDigits: 0 });
	}

function accountLedgerRowId(row) {
	return row.account_details_id || row.IDNo || '';
}

function isAccountDetailsSuperAdmin() {
	var perms = parseInt($('#user-role').data('permissions'), 10);
	return perms === 0;
}

function accountDetailsHiddenIdColIndex() {
	return 6;
}

function isGuestPortalLedgerEditable(row) {
	if (!row) return false;
	var hasGameId = row.GAME_ID != null && String(row.GAME_ID).trim() !== '';
	if (hasGameId) return false;

	var desc = String(row.TRANSACTION_DESC || '').trim().toUpperCase();
	var isTransfer = parseInt(row.TRANSFER, 10) === 1;
	var transId = parseInt(row.TRANSACTION_ID, 10);
	var transType = parseInt(row.TRANSACTION_TYPE, 10);
	var isManualTransfer = isTransfer && transType === 2 && (transId === 1 || transId === 2) && !desc;
	var isManualCash = !isTransfer && transType === 2 && (transId === 1 || transId === 2) && desc === 'ACCOUNT DETAILS';
	var isManualCredit = !isTransfer && transType === 3 && transId === 3 && desc === 'ACCOUNT DETAILS';
	var isJunketCreditReturn = !isTransfer && transType === 3 && (transId === 11 || transId === 12) && desc === 'RETURN_SOURCE:CREDIT';
	return isManualTransfer || isManualCash || isManualCredit || isJunketCreditReturn;
}

function renderAccountLedgerActionCell(ledgerId, rawAmount, remarks, editable) {
	if (!ledgerId) return '';
	var amountStr = String(rawAmount != null ? rawAmount : '').replace(/,/g, '');
	var remarksAttr = escapeHtmlAttr(String(remarks != null ? remarks : ''));
	var html =
		'<div class="account-ledger-action-wrap">' +
		'<span class="account-ledger-action-receipt-slot">' +
		'<button type="button" class="btn btn-link text-secondary p-0 border-0 shadow-none btn-ledger-receipt js-bs-tooltip-enabled" ' +
		'data-id="' + ledgerId + '" data-bs-toggle="tooltip" title="Receipt" aria-label="Receipt">' +
		'<i class="fa fa-receipt"></i></button>' +
		'</span>';
	if (editable && isAccountDetailsSuperAdmin()) {
		html +=
			'<span class="account-ledger-action-edit-slot">' +
			'<button type="button" class="btn btn-link text-primary p-0 border-0 shadow-none btn-ledger-edit js-bs-tooltip-enabled" ' +
			'data-id="' + ledgerId + '" data-amount="' + escapeHtmlAttr(amountStr) + '" data-remarks="' + remarksAttr + '" ' +
			'data-bs-toggle="tooltip" title="Edit" aria-label="Edit"><i class="fa fa-pencil-alt"></i></button>' +
			'</span>' +
			'<span class="account-ledger-action-delete-slot">' +
			'<button type="button" class="btn btn-link text-danger p-0 border-0 shadow-none btn-ledger-delete js-bs-tooltip-enabled" ' +
			'data-id="' + ledgerId + '" data-bs-toggle="tooltip" title="Delete" aria-label="Delete"><i class="fa fa-trash-alt"></i></button>' +
			'</span>';
	}
	html += '</div>';
	return html;
}

function escapeHtmlAttr(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function formatAccountLedgerBalanceAfter(balance) {
	const n = parseFloat(balance) || 0;
	if (window.AmountFormat) {
		return window.AmountFormat.formatCommas(n);
	}
	return n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

function ledgerCashBalanceDelta(row) {
	const rawAmt = row.amount != null ? row.amount : row.AMOUNT;
	const amount = parseFloat(String(rawAmt == null ? 0 : rawAmt).replace(/,/g, '')) || 0;
	const trans = String(row.TRANSACTION || '').trim();
	if (trans === 'DEPOSIT') return amount;
	if (trans === 'WITHDRAW') return -amount;
	if (trans === 'MARKER REDEEM') return amount;
	if (trans === 'IOU RETURN DEPOSIT') return -amount;
	return 0;
}

/** Running cash balance after each ledger row (same formula as TOTAL BALANCE). */
function computeGuestPortalBalanceAfterMap(rows) {
	const chronological = (rows || []).slice().sort(function (a, b) {
		const idA = parseInt(a.account_details_id || a.IDNo, 10) || 0;
		const idB = parseInt(b.account_details_id || b.IDNo, 10) || 0;
		return idA - idB;
	});
	let running = 0;
	const map = {};
	chronological.forEach(function (row) {
		running += ledgerCashBalanceDelta(row);
		map[String(accountLedgerRowId(row))] = running;
	});
	return map;
}

function buildAccountDetailsLedgerRow(encodedDate, transactionCell, amountCell, balanceAfterCell, remarks, sourceRow) {
	var ledgerId = accountLedgerRowId(sourceRow);
	var row = [encodedDate, transactionCell, amountCell, balanceAfterCell, remarks || ''];
	row.push(
		renderAccountLedgerActionCell(
			ledgerId,
			sourceRow.AMOUNT,
			remarks,
			isGuestPortalLedgerEditable(sourceRow)
		)
	);
	row.push(ledgerId);
	return row;
}

function accountDetailsDateRender(data, type) {
	if (window.DateTimeFormat && typeof window.DateTimeFormat.dataTableDateTimeRender === 'function') {
		return window.DateTimeFormat.dataTableDateTimeRender(data, type, { utcOffset: 8 });
	}
	if (type === 'sort' || type === 'type') {
		var sortM = moment.utc(data);
		if (!sortM.isValid()) sortM = moment(data);
		return sortM.isValid() ? sortM.valueOf() : 0;
	}
	var m = moment.utc(data);
	if (!m.isValid()) {
		m = moment(data, ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', 'MMMM DD, YYYY HH:mm:ss', moment.ISO_8601], true);
	}
	if (!m.isValid()) m = moment(data);
	return m.isValid() ? m.utcOffset(8).format('YYYY-MM-DD HH:mm') : 'Invalid Date';
}

function getOrInitAccountDetailsAltDataTable() {
	var $tbl = $('#accountDetailsAlt');
	if ($.fn.DataTable.isDataTable($tbl[0])) {
		return $tbl.DataTable();
	}
	return $tbl.DataTable({
		order: [[0, 'desc']],
		columnDefs: [{
			targets: 0,
			render: accountDetailsDateRender,
			createdCell: function (c) { $(c).addClass('text-center'); }
		}].concat(accountDetailsRemarksColumnDefs({ remarksColIndex: 3, includeHiddenId: false }))
	});
}

function placeGuestPortalPrintExportButtons() {
	var $filter = $('#modal-account-details #accountDetails_wrapper .dataTables_filter');
	var $btns = $('#guest-portal-print-export');
	if (!$filter.length || !$btns.length) return;
	$btns.removeClass('d-none');
	if (!$filter.find('#guest-portal-print-export').length) {
		$filter.prepend($btns);
	}
}

function getOrInitAccountDetailsDataTable() {
	var $tbl = $('#modal-account-details #accountDetails');
	var expectedCols = $tbl.find('thead th').length;
	if ($.fn.DataTable.isDataTable($tbl[0])) {
		var existing = $tbl.DataTable();
		if (existing.columns().count() === expectedCols) {
			placeGuestPortalPrintExportButtons();
			return existing;
		}
		existing.destroy();
		$tbl.find('tbody').empty();
	}
	return $tbl.DataTable({
		order: [[0, 'desc']],
		columnDefs: [
			{
				targets: 0,
				render: accountDetailsDateRender,
				createdCell: function (cell) {
					$(cell).addClass('text-center');
				}
			}
		].concat(accountDetailsActionColumnDefs()).concat(accountDetailsRemarksColumnDefs()),
		initComplete: function () {
			placeGuestPortalPrintExportButtons();
		}
	});
}

function accountDetailsActionColumnDefs() {
	return [{
		targets: 5,
		orderable: false,
		searchable: false,
		className: 'text-center account-ledger-actions-col',
		width: '110px'
	}];
}

function accountDetailsRemarksColumnDefs(opts) {
		opts = opts || {};
		var remarksIdx = opts.remarksColIndex != null ? opts.remarksColIndex : 4;
		var includeHiddenId = opts.includeHiddenId !== false;
		var defs = [
			{
				targets: remarksIdx,
				render: function (data, type, row) {
					var raw = data != null ? String(data) : '';
					if (type !== 'display') return raw;
					var ledgerId = row[accountDetailsHiddenIdColIndex()];
					if (window.RemarksEditor && ledgerId) {
						return window.RemarksEditor.renderCell(raw, {
							source: 'account_ledger',
							recordId: ledgerId
						});
					}
					if (!raw) return '<span class="text-muted">-</span>';
					return raw;
				},
				createdCell: function (cell, cellData, rowData) {
					var ledgerId = rowData && rowData[accountDetailsHiddenIdColIndex()];
					var $cell = $(cell);
					$cell.addClass('remarks-editor-td text-start');
					if (ledgerId && window.RemarksEditor && window.RemarksEditor.canEdit()) {
						$cell.addClass('cursor-pointer');
					}
				}
			}
		];
		if (includeHiddenId) {
			defs.push({
				targets: accountDetailsHiddenIdColIndex(),
				visible: false,
				searchable: false,
				orderable: false,
				className: 'account-ledger-id-col'
			});
		}
		return defs;
	}

	function reloadDataDetails() {
	if (!accountDetailsDataTable || !currentAccountDetailsId) return;

	const accountId = currentAccountDetailsId;

	$.ajax({
		url: '/account_details_data_deposit/' + accountId,
		method: 'GET',
		success: function (data) {
			accountDetailsDataTable.clear();

			let deposit_amount = 0;
			let withdraw_amount = 0;
			let marker_deposit_amount = 0;
			let marker_return_deposit = 0;

			let rowsToAdd = [];
			const balanceAfterMap = computeGuestPortalBalanceAfterMap(data);

			const requests = data.map(row => {
				return new Promise((resolve) => {
					const amount = parseFloat(String(row.AMOUNT).replace(/,/g, '')) || 0;

					if (row.TRANSACTION === 'DEPOSIT') deposit_amount += amount;
					if (row.TRANSACTION === 'WITHDRAW') withdraw_amount += amount;
					if (row.TRANSACTION === 'MARKER REDEEM') marker_deposit_amount += amount;
					if (row.TRANSACTION === 'IOU RETURN DEPOSIT') marker_return_deposit += amount;

					const transactionDesc = row.TRANSACTION_DESC || '';
					const encodedDate = row.encoded_date || row.ENCODED_DT || '';
					const balanceAfterCell = formatAccountLedgerBalanceAfter(
						balanceAfterMap[String(accountLedgerRowId(row))]
					);

					if (row.TRANSFER === 1) {
						$.ajax({
							url: '/get-transfer-agent-name',
							type: 'GET',
							data: { transferAgentId: row.TRANSFER_AGENT },
							success: function (response) {
								const transferAgentName = response.transfer_agent_name?.trim() || 'Unknown';
								const agentCode = response.agent_code?.trim() || 'N/A';
								const trans = row.TRANSACTION === 'DEPOSIT'
									? `DEPOSIT ( <strong>Received from ${agentCode} - ${transferAgentName} </strong> )`
									: `WITHDRAW ( <strong>Transferred to ${agentCode} - ${transferAgentName} </strong> )`;

								rowsToAdd.push(buildAccountDetailsLedgerRow(
									encodedDate,
									`${trans} - <strong>${transactionDesc}</strong>`,
									formatAccountLedgerAmount(amount, row.TRANSACTION, transactionDesc),
									balanceAfterCell,
									row.REMARKS || '',
									row
								));
								resolve();
							},
							error: function () {
								const trans = row.TRANSACTION === 'DEPOSIT'
									? `DEPOSIT ( <strong>Received from Error fetching name</strong> )`
									: `WITHDRAW ( <strong>Transferred to Error fetching name</strong> )`;

								rowsToAdd.push(buildAccountDetailsLedgerRow(
									encodedDate,
									`${trans} - <strong>${transactionDesc}</strong>`,
									formatAccountLedgerAmount(amount, row.TRANSACTION, transactionDesc),
									balanceAfterCell,
									row.REMARKS || '',
									row
								));
								resolve();
							}
						});
					} else {
						const transactionCell = formatAccountLedgerTransactionCell(row.TRANSACTION, transactionDesc);

						rowsToAdd.push(buildAccountDetailsLedgerRow(
							encodedDate,
							transactionCell,
							formatAccountLedgerAmount(amount, row.TRANSACTION, transactionDesc),
							balanceAfterCell,
							row.REMARKS || '',
							row
						));
						resolve();
					}
				});
			});

			Promise.all(requests).then(() => {
				accountDetailsDataTable.rows.add(rowsToAdd).draw();

				// Total balance excludes Credit/IOU
				const totalAmount = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return_deposit;

				$('.total_deposit').text(`₱${deposit_amount.toLocaleString('en-US', { minimumFractionDigits: 0 })}`);
				$('.total_withdraw').html(window.AmountFormat
					? '₱' + window.AmountFormat.formatAmountNegativeHtml(withdraw_amount)
					: `₱${withdraw_amount.toLocaleString('en-US', { minimumFractionDigits: 0 })}`);
				$('.total_balance').text(`₱${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 0 })}`);
				$('#total_balanceGuest').val(totalAmount);
				currentAccountBalance = totalAmount;
			});

			// CREDIT/IOU from backend formula: TRANSACTION_ID (3,10) - (11,12,1), TRANSACTION_TYPE (3,4)
			$.get('/account_credit_balance/' + accountId)
				.done(function (res) {
					const creditAmount = parseFloat(res.credit_balance) || 0;
					if (creditAmount > 0) {
						$('#credit-iou-card').removeClass('d-none');
						$('.credit_balance').text(`₱${creditAmount.toLocaleString('en-US', { minimumFractionDigits: 0 })}`);
					} else {
						$('#credit-iou-card').addClass('d-none');
						$('.credit_balance').text('');
					}
				})
				.fail(function () {
					$('#credit-iou-card').addClass('d-none');
					$('.credit_balance').text('');
				});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching data:', error);
		}
	});
}
window.reloadDataDetails = reloadDataDetails;

// ─────────────────────────────────────────────────────────────────────────────
// account_details_v2: tawagin mula sa Activity Logs
// ─────────────────────────────────────────────────────────────────────────────
async function account_details_v2(ledgerId, guestName, acctName) {
	console.log("Loading v2 for ledger", ledgerId);
  
	// 0) Kunin ang ACCOUNT_ID mula sa ledger
	let accountId;
	try {
	  const resp = await fetch(`/ledger/${ledgerId}`);
	  const json = await resp.json();
	  accountId = json.account_id;
	} catch (err) {
	  return console.error("Cannot resolve accountId:", err);
	}
  
	// 1) Fetch account info (photo, code, name)
	try {
	  const r = await fetch(`/account_passportphoto_data/${accountId}`);
	  const [acct] = await r.json();
	  if (acct) {
		document.getElementById('agent_code_alt').textContent   = acct.agent_code   || 'N/A';
		document.getElementById('account_name_alt').textContent = acct.account_name || 'N/A';
		setGuestProfilePhoto(document.getElementById('account_photo_alt'), acct.PASSPORTPHOTO);
	  }
	} catch (err) {
	  console.error("Error fetching passport/photo:", err);
	}
  
	// 2) Reset form fields
	$('#account_id_alt').val(accountId);
	$('#account_id_add_alt').val(accountId);
	$('.txtAmount_alt').val('');
	$('.remarks_alt').val('');
	$('input[name="txtTrans"]').prop('checked', false);
  
	// 3) (Re)initialize DataTable
	const dt = getOrInitAccountDetailsAltDataTable();
	dt.search('');
	dt.columns().search('');
  
	// 4) Load buong ledger rows at inline‑highlight
	function reloadV2(){
	  $.ajax({
		url: `/account_details_data/${accountId}`,
		method: 'GET',
		success(rows) {
		  console.log("Received v2 rows:", rows);
		  dt.clear();
  
		  rows.forEach(r=>{
			const amt = parseFloat(r.AMOUNT)||0;
			const rowApi = dt.row.add([
			  r.encoded_date || r.ENCODED_DT || '',
			  formatAccountLedgerTransactionCell(r.TRANSACTION, r.TRANSACTION_DESC),
			  `₱${amt.toLocaleString('en-US')}`,
			  r.REMARKS || '',
			  accountLedgerRowId(r)
			]).draw(false);
  
			const node = rowApi.node();
			// inline highlight light‑blue
			if (r.account_details_id == ledgerId) {
			  $(node).css('background-color', '#cce5ff');
			  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		  });
		},
		error(xhr,s,e){ console.error("Error loading v2 data:", s, e); }
	  });
	}
  
	// 5) Show modal & load
	$('#modal-account-details-alt').modal('show');
	reloadV2();
  
	// Auto‑refresh page kapag sinara ang modal
	$('#modal-account-details-alt')
	  .off('hidden.bs.modal')
	  .on('hidden.bs.modal', () => window.location.reload());
  }
  window.account_details_v2 = account_details_v2;
  
	
function bindAccountDetailsForm({ formSelector, amountSelector, remarksSelector, totalBalanceSelector, modalSelector }) {
	$(formSelector).submit(function (event) {
		event.preventDefault();

		const $form = $(this);
		const submitButton = $form.find('button[type="submit"]');
		if (submitButton.prop('disabled')) return;

		const originalHtml = submitButton.data('original-html') || submitButton.html();
		submitButton.data('original-html', originalHtml);
		submitButton.prop('disabled', true).html(`
			<span class="spinner-border spinner-border-sm me-1 text-white" role="status" aria-hidden="true"></span>
			<span class="text-white">Loading...</span>
		`);

		const restoreButton = () => submitButton.prop('disabled', false).html(originalHtml);

		const selectedTrans = $form.find('input[name="txtTrans"]:checked').val();
		const amountField = $form.find(amountSelector);
		const enteredAmountValue = amountField.val() ? amountField.val().replace(/,/g, '') : '0';
		const enteredAmount = parseFloat(enteredAmountValue) || 0;

		let totalBalanceValue = '0';
		const totalBalanceElement = $(totalBalanceSelector);
		if (totalBalanceElement.length) {
			totalBalanceValue = totalBalanceElement.val() || '0';
		}
		let totalBalanceGuest = parseFloat(String(totalBalanceValue).replace(/,/g, '').trim()) || 0;

		const modalElement = $(modalSelector);
		if (!totalBalanceGuest && modalElement.length) {
			const displayText = (modalElement.find('.total_balance').first().text() || '').replace(/[^0-9.-]/g, '');
			totalBalanceGuest = parseFloat(displayText) || 0;
		}
		if (!totalBalanceGuest) {
			const fallbackVal = ($('#total_balanceGuest').val() || '0').replace(/,/g, '');
			totalBalanceGuest = parseFloat(fallbackVal) || 0;
		}

		const availableBalance = (typeof currentAccountBalance === 'number' && currentAccountBalance > 0)
			? currentAccountBalance
			: totalBalanceGuest;

		const formatNumberWithCommas = number => number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

		if (!selectedTrans) {
			Swal.fire({
				icon: 'error',
				title: 'Transaction Type Required',
				text: 'Please select a transaction type (Deposit or Withdraw).',
				confirmButtonText: 'OK'
			});
			restoreButton();
			return;
		}

		if (selectedTrans === '2' && enteredAmount > availableBalance) {
			Swal.fire({
				icon: 'error',
				title: 'Insufficient Balance',
				text: 'The amount exceeds the available total balance of ₱' + formatNumberWithCommas(availableBalance),
				confirmButtonText: 'OK'
			});
			restoreButton();
			return;
		}

		const formData = $form.serialize();

		$.ajax({
			url: '/add_account_details',
			type: 'POST',
			data: formData,
			success: function (response) {
				$(document).trigger('agency:account-transaction-saved', {
					accountId: $form.find('input[name="txtAccountId"]').val() || null,
					transactionType: selectedTrans
				});
				// Check if response is JSON (with Telegram error) or plain text (success)
				if (typeof response === 'object' && response.success && response.error) {
					// Transaction saved but Telegram failed
					Swal.fire({
						title: 'Transaction Saved!',
						html: '<strong>' + response.message + '</strong><br><br>' + response.error,
						icon: 'warning',
						confirmButtonText: 'OK',
						confirmButtonColor: '#3085d6'
					}).then(() => {
						reloadDataDetails();
						if (modalElement.length) {
							modalElement.modal('show');
						}

						$form.find(amountSelector).val('');
						$form.find(remarksSelector).val('');
						$form.find('input[name="txtTrans"]').prop('checked', false);

						if (modalElement.length) {
							modalElement.off('hidden.bs.modal').on('hidden.bs.modal', function () {
								window.location.reload();
							});
						}
					});
				} else {
					// Success without errors
					Swal.fire({
						title: 'Success!!!',
						icon: 'success',
						confirmButtonText: 'OK'
					}).then(() => {
						reloadDataDetails();
						if (modalElement.length) {
							modalElement.modal('show');
						}

						$form.find(amountSelector).val('');
						$form.find(remarksSelector).val('');
						$form.find('input[name="txtTrans"]').prop('checked', false);

						if (modalElement.length) {
							modalElement.off('hidden.bs.modal').on('hidden.bs.modal', function () {
								window.location.reload();
							});
						}
					});
				}
			},
			error: function (xhr, status, error) {
				var errorMessage = xhr.responseJSON?.error || xhr.responseJSON?.message || 'An error occurred.';
				console.error('Error updating user role:', errorMessage);
				Swal.fire({
					icon: 'error',
					title: 'Error',
					text: errorMessage,
					confirmButtonText: 'OK'
				});
			},
			complete: restoreButton
		});
	});
}

bindAccountDetailsForm({
	formSelector: '#add_new_account_details',
	amountSelector: '.txtAmount',
	remarksSelector: '.remarks',
	totalBalanceSelector: '#total_balanceGuest',
	modalSelector: '#modal-add-account-details'
});

bindAccountDetailsForm({
	formSelector: '#modal-account-details #add_new_account_details_alt',
	amountSelector: '.txtAmount_alt',
	remarksSelector: '.remarks_alt',
	totalBalanceSelector: '#total_balanceGuest',
	modalSelector: '#modal-account-details'
});

bindAccountDetailsForm({
	formSelector: '#modal-account-details-alt #add_new_account_details_alt',
	amountSelector: '.txtAmount_alt',
	remarksSelector: '.remarks_alt',
	totalBalanceSelector: '#total_balanceGuest_alt',
	modalSelector: '#modal-account-details-alt'
});


function add_account_details() {
	$('#modal-account-details').modal('hide');
	$('#modal-add-account-details').modal('show');
	$('.txtAmount').val('');

}


function transfer_account() {
	$('#modal-account-details').modal('hide');
	$('#modal-transfer_account').modal('show');
	$('.txtAmount').val('');
	$('#transfer_trans').prop('checked', true);

	// Set modal title to current account name if available
	const accountName = $('#account_name').text();
	if (accountName) {
		$('#account_name_transfer').text(accountName);
	}

	var account_id_val = $('#account_id').val();
	account_id = account_id_val;
	$('#account_id_add_trans').val(account_id_val);
	

	get_transfer_accounts();

	 // Fetch account details to calculate balance
	 $.ajax({
        url: '/account_details_data_deposit/' + account_id, // Use the account parameter
        method: 'GET',
        success: function (data) {
            var deposit_amount = 0;
            var withdraw_amount = 0;
            var marker_return = 0;
            var marker_deposit_amount = 0;

            data.forEach(function (row) {
				const amount = parseFloat(row.AMOUNT);
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

            // Total balance excludes Credit/IOU
            var totalBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;
            $('#TransferFromBalance').val(totalBalance); // Display formatted balance
            
            // Optionally, display the account name if you have it in the data
            if (data.length > 0) {
                $('#account_name_transfer').text(data[0].NAME); // Assuming NAME is in the first row
            }
        },
        error: function (xhr, status, error) {
            console.error('Error fetching account details:', error);
        }
    });
}

// Return to Guest Portal after closing Transfer modal
$('#modal-transfer_account').off('hidden.bs.modal.returnAccountDetails').on('hidden.bs.modal.returnAccountDetails', function () {
	$('#modal-account-details').modal('show');
	$('#transfer_trans').prop('checked', false);
});

function export_data() {
	var account_id_val = $('#account_id').val();
	window.location.href = '/export?id=' + account_id_val;
}

function stripGuestPortalCell(value) {
	if (value == null) return '';
	var raw = String(value);
	if (raw.indexOf('<') === -1) return raw.trim();
	var tmp = document.createElement('div');
	tmp.innerHTML = raw;
	return (tmp.textContent || tmp.innerText || raw).trim();
}

function escapeGuestPortalPrintHtml(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function getGuestPortalTablePayload() {
	var $tbl = $('#modal-account-details #accountDetails');
	if (!$.fn.DataTable.isDataTable($tbl[0])) {
		return { headers: [], rows: [] };
	}
	var table = $tbl.DataTable();
	var exportColCount = 5; // DATE, TRANSACTION, AMOUNT, BALANCE AFTER, REMARKS
	var headers = [];
	$tbl.find('thead th').each(function (index) {
		if (index >= exportColCount) return;
		headers.push($(this).text().trim());
	});
	var rows = [];
	table.rows({ search: 'applied' }).every(function (rowIdx) {
		var row = [];
		for (var i = 0; i < exportColCount; i++) {
			row.push(stripGuestPortalCell(table.cell(rowIdx, i).render('display')));
		}
		rows.push(row);
	});
	return { headers: headers, rows: rows };
}

function getGuestPortalExportFilename() {
	var name = ($('#modal-account-details #account_name').text() || '').trim();
	var code = ($('#modal-account-details #agent_code').text() || '').trim();
	var safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
	var safeCode = code.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
	var label = [safeCode, safeName].filter(Boolean).join('-') || 'export';
	return label.slice(0, 80) + '.xlsx';
}

function getGuestPortalPrintStyles() {
	return [
		'@page{size:landscape;margin:8mm;}',
		'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
		'.print-wrap{width:100%;}',
		'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
		'.subtitle{text-align:center;margin:0 0 10px;font-size:12px;color:#444;}',
		'table{width:100%;border-collapse:collapse;font-size:10px;}',
		'th,td{border:1px solid #777;padding:5px 6px;vertical-align:middle;text-align:center;}',
		'th{background:#d9e1f2;font-weight:700;}',
		'td:nth-child(2),td:nth-child(5){text-align:left;}',
		'td:nth-child(3),td:nth-child(4){text-align:right;}'
	].join('');
}

function printGuestPortalTable() {
	var payload = getGuestPortalTablePayload();
	if (!payload.rows.length) {
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'info', title: 'Print', text: 'No rows to print for the current filter.', confirmButtonColor: '#0d6efd' });
		} else {
			alert('No rows to print.');
		}
		return;
	}
	var name = ($('#modal-account-details #account_name').text() || '').trim();
	var code = ($('#modal-account-details #agent_code').text() || '').trim();
	var subtitle = [name, code].filter(Boolean).join(' — ');
	var headerHtml = payload.headers.map(function (h) {
		return '<th>' + escapeGuestPortalPrintHtml(h) + '</th>';
	}).join('');
	var rowsHtml = payload.rows.map(function (row) {
		return '<tr>' + row.map(function (cell) {
			return '<td>' + escapeGuestPortalPrintHtml(cell) + '</td>';
		}).join('') + '</tr>';
	}).join('');
	var iframe = document.createElement('iframe');
	iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
	document.body.appendChild(iframe);
	var frameWindow = iframe.contentWindow;
	if (!frameWindow) {
		iframe.remove();
		return;
	}
	var frameDoc = frameWindow.document;
	frameDoc.open();
	frameDoc.write([
		'<!doctype html><html><head><title>Guest Portal</title><style>',
		getGuestPortalPrintStyles(),
		'</style></head><body><div class="print-wrap">',
		subtitle ? ('<div class="subtitle">' + escapeGuestPortalPrintHtml(subtitle) + '</div>') : '',
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

function exportGuestPortalTable() {
	var payload = getGuestPortalTablePayload();
	if (!payload.rows.length) {
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'info', title: 'Export', text: 'No rows to export for the current filter.', confirmButtonColor: '#0d6efd' });
		} else {
			alert('No rows to export.');
		}
		return;
	}
	var outName = getGuestPortalExportFilename();
	var $btn = $('#btn-guest-portal-export');
	$btn.prop('disabled', true);
	fetch('/game_list/export_xlsx', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({
			headers: payload.headers,
			rows: payload.rows,
			filename: outName,
			profileKey: 'guestPortal'
		})
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
}

$(document).off('click', '#btn-guest-portal-print').on('click', '#btn-guest-portal-print', function (e) {
	e.preventDefault();
	printGuestPortalTable();
});

$(document).off('click', '#btn-guest-portal-export').on('click', '#btn-guest-portal-export', function (e) {
	e.preventDefault();
	exportGuestPortalTable();
});


function transaction_type() {
	$.ajax({
		url: '/transaction_type_data',
		method: 'GET',
		success: function (response) {
			var selectOptions = $('#txtTrans');
			selectOptions.empty();
			selectOptions.append($('<option>', {
				value: ''
			}));
			response.forEach(function (option) {
				selectOptions.append($('<option>', {
					value: option.IDNo,
					text: option.TRANSACTION
				}));
			});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

function transaction_type() {
	$.ajax({
		url: '/transaction_type_data',
		method: 'GET',
		success: function (response) {
			var selectOptions = $('#txtTrans');
			selectOptions.empty();
			selectOptions.append($('<option>', {
				value: '',
				text: '--SELECT TRANSACTION TYPE--'
			}));
			response.forEach(function (option) {
				selectOptions.append($('<option>', {
					value: option.IDNo,
					text: option.TRANSACTION
				}));
			});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

function get_transfer_accounts() {
	$.ajax({
		url: '/account_data',
		method: 'GET',
		success: function (response) {
			var selectOptions = $('#txtAccount');
			selectOptions.empty();
			selectOptions.append($('<option>', {
				value: ''
			}));
			response.forEach(function (option) {
				// Huwag isama sa listahan ang kasalukuyang account na magta-transfer
				if (account_id && String(option.account_id) === String(account_id)) {
					return;
				}

				selectOptions.append($('<option>', {
					value: option.account_id,
					text: option.agent_name + ' (' + option.agent_code + ')'
				}));
			});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});

	$('#txtAccount').select2({
		placeholder: 'Select an option',
		dropdownParent: '#modal-transfer_account'
	});
}


function archive_account_details(id) {
	if (!isAccountDetailsSuperAdmin()) return;
	SwalConfirm.fire({
		title: 'Are you sure you want to delete this?',
		confirmButtonText: 'Yes'
	}).then((result) => {
		if (result.isConfirmed) {
			$.ajax({
				url: '/account_details/remove/' + id,
				type: 'PUT',
				success: function () {
					if (typeof reloadDataDetails === 'function') {
						reloadDataDetails();
					}
					if (window.Swal) {
						Swal.fire({
							icon: 'success',
							title: 'Deleted',
							showConfirmButton: false,
							timer: 1200,
							heightAuto: false
						});
					}
				},
				error: function (xhr) {
					var msg = (xhr.responseJSON && xhr.responseJSON.message) || 'Error deleting transaction.';
					if (window.Swal) {
						Swal.fire({ icon: 'error', title: 'Error', text: msg });
					}
					console.error('Error deleting account ledger:', xhr);
				}
			});
		}
	});
}

function closeEditAccountLedgerModal() {
	var $editModal = $('#modal-edit-account-ledger');
	if (!$editModal.length) return;

	function cleanupGuestPortalChildState() {
		if (!isGuestPortalOpen()) return;
		setGuestPortalChildModalOpen(false);
		resetGuestPortalChildModalStack($editModal);
	}

	$editModal.one('hidden.bs.modal', cleanupGuestPortalChildState);

	if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
		var inst = bootstrap.Modal.getInstance($editModal[0]);
		if (inst) {
			inst.hide();
			return;
		}
	}
	$editModal.modal('hide');
}

function openEditAccountLedgerModal($btn) {
	if (!isAccountDetailsSuperAdmin()) return;
	var ledgerId = $btn.data('id');
	var amount = String($btn.data('amount') || '').replace(/,/g, '');
	var remarks = String($btn.data('remarks') || '');
	var transactionLabel = $btn.closest('tr').find('td').eq(1).text().trim();

	$('#edit-ledger-id').val(ledgerId);
	$('#edit-ledger-transaction').val(transactionLabel);
	$('#edit-ledger-amount').val(amount ? Number(amount).toLocaleString('en-US') : '');
	$('#edit-ledger-remarks').val(remarks);

	var $modal = $('#modal-edit-account-ledger');
	if (typeof window.prepareGuestPortalChildModal === 'function') {
		window.prepareGuestPortalChildModal($modal);
	}
	if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
		bootstrap.Modal.getOrCreateInstance($modal[0], { backdrop: 'static', keyboard: false }).show();
	} else {
		$modal.modal('show');
	}
}

$(document).off('click', '#accountDetails .btn-ledger-delete').on('click', '#accountDetails .btn-ledger-delete', function (e) {
	e.preventDefault();
	e.stopPropagation();
	var ledgerId = $(this).data('id');
	if (ledgerId) archive_account_details(ledgerId);
});

$(document).off('click', '#accountDetails .btn-ledger-edit').on('click', '#accountDetails .btn-ledger-edit', function (e) {
	e.preventDefault();
	e.stopPropagation();
	openEditAccountLedgerModal($(this));
});

function guestPortalReceiptHtmlEscape(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function formatGuestPortalReceiptAmount(value) {
	var n = Math.abs(Number(value) || 0);
	return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatGuestPortalReceiptDate(encodedDt) {
	if (!encodedDt) return '';
	if (window.moment) {
		var m = moment.utc(encodedDt).utcOffset(8);
		if (m.isValid()) return m.format('M/D/YYYY');
	}
	var d = new Date(encodedDt);
	if (!isNaN(d.getTime())) {
		return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
	}
	return String(encodedDt);
}

function formatGuestPortalReceiptDateTime(encodedDt) {
	if (!encodedDt) return '';
	if (window.moment) {
		var m = moment.utc(encodedDt).utcOffset(8);
		if (m.isValid()) return m.format('YYYY-MM-DD HH:mm');
	}
	return String(encodedDt);
}

function buildGuestPortalReceiptSlipHtml(data) {
	data = data || {};
	var trans = String(data.transaction || '').trim().toUpperCase();
	var amount = Math.abs(Number(data.amount) || 0);
	var isDeposit = trans === 'DEPOSIT' || trans === 'MARKER REDEEM';
	var isWithdraw = trans === 'WITHDRAW' || trans === 'IOU RETURN DEPOSIT';
	var depositAmt = isDeposit ? amount : 0;
	var withdrawAmt = isWithdraw ? amount : 0;
	var remarks = data.remarks != null ? String(data.remarks).trim() : '';

	var detailRows =
		'<tr><td class="gpr-label">Date :</td><td class="gpr-value">' +
		guestPortalReceiptHtmlEscape(formatGuestPortalReceiptDate(data.encoded_dt)) + '</td></tr>' +
		'<tr><td class="gpr-label">Account :</td><td class="gpr-value gpr-value-wrap">' +
		guestPortalReceiptHtmlEscape(data.account_code || '') + '</td></tr>' +
		'<tr><td class="gpr-label">Name :</td><td class="gpr-value gpr-value-wrap">' +
		guestPortalReceiptHtmlEscape(data.account_name || '') + '</td></tr>' +
		'<tr><td class="gpr-label">Deposit :</td><td class="gpr-value">' +
		formatGuestPortalReceiptAmount(depositAmt) + '</td></tr>' +
		'<tr><td class="gpr-label">Withdrawal :</td><td class="gpr-value' + (withdrawAmt ? ' gpr-amount-out' : '') + '">' +
		(withdrawAmt ? '(' + formatGuestPortalReceiptAmount(withdrawAmt) + ')' : '0') + '</td></tr>' +
		'<tr><td class="gpr-label">Balance :</td><td class="gpr-value">' +
		formatGuestPortalReceiptAmount(data.balance_after) + '</td></tr>' +
		'<tr><td class="gpr-label">Remarks :</td><td class="gpr-value gpr-value-wrap">' +
		guestPortalReceiptHtmlEscape(remarks) + '</td></tr>';

	return (
		'<div class="guest-portal-receipt-slip">' +
		'<div class="guest-portal-receipt-slip-body">' +
		'<p class="gpr-brand">GOLDEN DRAGON</p>' +
		'<p class="gpr-title">' + guestPortalReceiptHtmlEscape(data.title || '* Transaction *') + '</p>' +
		'<p class="gpr-datetime">' + guestPortalReceiptHtmlEscape(formatGuestPortalReceiptDateTime(data.encoded_dt)) + '</p>' +
		'<table class="gpr-table"><tbody>' + detailRows + '</tbody></table>' +
		'</div>' +
		'<div class="guest-portal-receipt-slip-actions">' +
		'<button type="button" class="btn guest-portal-receipt-copy-btn js-copy-guest-portal-receipt-image">Copy image</button>' +
		'<button type="button" class="btn guest-portal-receipt-copy-btn js-copy-guest-portal-receipt-text">Copy text</button>' +
		'</div>' +
		'</div>'
	);
}

function populateGuestPortalReceipt(data) {
	var $container = $('#guest-portal-receipt-container');
	if (!$container.length) return;
	$container.html(buildGuestPortalReceiptSlipHtml(data));
}

function showGuestPortalReceiptModal() {
	var $modal = $('#modal-guest-portal-receipt');
	if (!$modal.length) return;
	if (typeof window.prepareGuestPortalChildModal === 'function') {
		window.prepareGuestPortalChildModal($modal);
	} else {
		$modal.appendTo('body');
		if (typeof setGuestPortalChildModalOpen === 'function') setGuestPortalChildModalOpen(true);
	}
	var modalEl = $modal[0];
	if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
		bootstrap.Modal.getOrCreateInstance(modalEl).show();
	} else if ($modal.modal) {
		$modal.modal('show');
	}
}

function showGuestPortalLedgerReceipt(ledgerId) {
	if (!ledgerId) return;
	$.ajax({
		url: '/account_ledger/' + ledgerId + '/receipt',
		method: 'GET',
		success: function (data) {
			populateGuestPortalReceipt(data);
			showGuestPortalReceiptModal();
		},
		error: function (xhr) {
			var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Unable to load receipt.';
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'error', title: 'Receipt', text: msg, confirmButtonColor: '#0d6efd' });
			} else {
				alert(msg);
			}
		}
	});
}
window.showGuestPortalLedgerReceipt = showGuestPortalLedgerReceipt;

var guestPortalReceiptHtml2CanvasPromise = null;
function loadGuestPortalReceiptHtml2Canvas() {
	if (typeof html2canvas !== 'undefined') return Promise.resolve();
	if (guestPortalReceiptHtml2CanvasPromise) return guestPortalReceiptHtml2CanvasPromise;
	guestPortalReceiptHtml2CanvasPromise = new Promise(function (resolve, reject) {
		var script = document.createElement('script');
		script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
		script.onload = function () { resolve(); };
		script.onerror = function () {
			guestPortalReceiptHtml2CanvasPromise = null;
			reject(new Error('Failed to load image copy library.'));
		};
		document.body.appendChild(script);
	});
	return guestPortalReceiptHtml2CanvasPromise;
}

function copyGuestPortalReceiptSlipImage(slipBodyEl, $btn) {
	if (!slipBodyEl) return;
	var original = $btn.html();
	$btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status"></span>');
	loadGuestPortalReceiptHtml2Canvas()
		.then(function () {
			return html2canvas(slipBodyEl, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
		})
		.then(function (canvas) {
			return new Promise(function (resolve, reject) {
				canvas.toBlob(function (blob) {
					if (!blob) reject(new Error('Failed to create receipt image.'));
					else resolve(blob);
				}, 'image/png');
			});
		})
		.then(function (blob) {
			if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
				throw new Error('Clipboard image copy is not supported.');
			}
			return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		})
		.then(function () {
			$btn.html('Copied');
		})
		.catch(function (err) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'error', title: 'Copy image', text: err.message || 'Copy failed', confirmButtonColor: '#0d6efd' });
			} else {
				alert(err.message || 'Copy failed');
			}
		})
		.finally(function () {
			setTimeout(function () {
				$btn.prop('disabled', false).html(original);
			}, 900);
		});
}

function copyGuestPortalReceiptSlipText(slipBodyEl, $btn) {
	var text = slipBodyEl && slipBodyEl.innerText ? slipBodyEl.innerText.trim() : '';
	var original = $btn.html();
	if (!text) return;
	$btn.prop('disabled', true);
	var done = function () {
		$btn.html('Copied');
		setTimeout(function () {
			$btn.prop('disabled', false).html(original);
		}, 900);
	};
	var fail = function (err) {
		$btn.prop('disabled', false).html(original);
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'error', title: 'Copy text', text: (err && err.message) || 'Copy failed', confirmButtonColor: '#0d6efd' });
		} else {
			alert((err && err.message) || 'Copy failed');
		}
	};
	if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
		fail(new Error('Clipboard is not supported.'));
		return;
	}
	navigator.clipboard.writeText(text).then(done).catch(fail);
}

$(document).off('click', '#accountDetails .btn-ledger-receipt').on('click', '#accountDetails .btn-ledger-receipt', function (e) {
	e.preventDefault();
	e.stopPropagation();
	var ledgerId = $(this).data('id');
	if (ledgerId) showGuestPortalLedgerReceipt(ledgerId);
});

$(document).off('click', '.js-copy-guest-portal-receipt-image').on('click', '.js-copy-guest-portal-receipt-image', function (e) {
	e.preventDefault();
	var $btn = $(this);
	var slipBody = $btn.closest('.guest-portal-receipt-slip').find('.guest-portal-receipt-slip-body')[0];
	copyGuestPortalReceiptSlipImage(slipBody, $btn);
});

$(document).off('click', '.js-copy-guest-portal-receipt-text').on('click', '.js-copy-guest-portal-receipt-text', function (e) {
	e.preventDefault();
	var $btn = $(this);
	var slipBody = $btn.closest('.guest-portal-receipt-slip').find('.guest-portal-receipt-slip-body')[0];
	copyGuestPortalReceiptSlipText(slipBody, $btn);
});

$(document).off('click', '#btn-save-edit-ledger').on('click', '#btn-save-edit-ledger', function () {
	if (!isAccountDetailsSuperAdmin()) return;
	var ledgerId = $('#edit-ledger-id').val();
	var amount = String($('#edit-ledger-amount').val() || '').replace(/,/g, '');
	var remarks = String($('#edit-ledger-remarks').val() || '').trim();

	if (!ledgerId || !amount || parseFloat(amount) <= 0) {
		if (window.Swal) {
			Swal.fire({ icon: 'warning', title: 'Invalid amount', text: 'Please enter a valid amount.' });
		}
		return;
	}

	var $btn = $(this).prop('disabled', true);
	$.ajax({
		url: '/account_details/edit/' + ledgerId,
		type: 'PUT',
		contentType: 'application/json',
		data: JSON.stringify({ amount: amount, remarks: remarks }),
		success: function () {
			closeEditAccountLedgerModal();
			if (typeof reloadDataDetails === 'function') reloadDataDetails();
			if (window.Swal) {
				Swal.fire({
					icon: 'success',
					title: 'Saved',
					showConfirmButton: false,
					timer: 1200,
					heightAuto: false
				});
			}
		},
		error: function (xhr) {
			var msg = (xhr.responseJSON && xhr.responseJSON.message) || 'Error updating transaction.';
			if (window.Swal) {
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		},
		complete: function () {
			$btn.prop('disabled', false);
		}
	});
});

window.archive_account_details = archive_account_details;


$(document).ready(function(){
	$("input[data-type='number']").keyup(function(event){
		// skip for arrow keys
		if(event.which >= 37 && event.which <= 40){
			event.preventDefault();
		}
		var $this = $(this);
		var num = $this.val().replace(/,/gi, "");
		var num2 = num.split(/(?=(?:\d{3})+$)/).join(",");
		$this.val(num2);
	});
})

function onlyNumberKey(evt) {
 
	let ASCIICode = (evt.which) ? evt.which : evt.keyCode
	if (ASCIICode > 31 && (ASCIICode < 48 || ASCIICode > 57))
		return false;
	return true;
}

// Trigger when account is selected from dropdown
$('#txtAccount').on('change', function () {
    var account_id = $(this).val();  // Get the selected account ID

    if (account_id) {
        // Make an AJAX call to fetch account details
        $.ajax({
            url: '/account_details_data_deposit/' + account_id,  // Pass the selected account ID
            method: 'GET',
            success: function (data) {
                // Initialize amounts
                var deposit_amount = 0;
                var withdraw_amount = 0;
                var marker_deposit_amount = 0;
                var marker_return = 0;

                // Iterate through data and calculate totals
                data.forEach(function (row) {
					const amount = parseFloat(row.AMOUNT);
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

                // Total balance excludes Credit/IOU
                var totalBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;
                $('#TransferToBalance').val(totalBalance);
            },
            error: function (xhr, status, error) {
                console.error('Error fetching account details:', error);
            }
        });
    }
});

$(document).on('keydown', '#agent_remarks_notice', function (e) {
	if (e.key !== 'Enter') return;
	e.preventDefault();
	const $inp = $(this);
	const accountId = $('#account_id').val() || $('#account_id_add').val();
	if (!accountId) return;
	const val = ($inp.val() || '').trim();
	if (val === lastSavedAgentRemarks) return;
	$.ajax({
		url: '/account/' + accountId + '/agent_remarks',
		method: 'PUT',
		contentType: 'application/json',
		data: JSON.stringify({ remarks: val }),
		success: function () {
			lastSavedAgentRemarks = val;
			$inp.blur();
			if (typeof Swal !== 'undefined') {
				Swal.fire({
					icon: 'success',
					title: 'Saved',
					text: 'Agent remarks updated.',
					timer: 2000,
					showConfirmButton: false,
					didClose: function () {
						const el = document.getElementById('agent_remarks_notice');
						if (el) el.blur();
					}
				});
			}
		},
		error: function (xhr) {
			$inp.val(lastSavedAgentRemarks);
			const msg = xhr.responseJSON && xhr.responseJSON.error ? xhr.responseJSON.error : 'Could not save remarks.';
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'error', title: 'Save failed', text: msg, timer: 2800, showConfirmButton: true });
			} else {
				alert(msg);
			}
		}
	});
});

document.addEventListener('DOMContentLoaded', function () {
	const balanceBtn = document.getElementById('balanceCheckBtn');

	function getGuestPortalDisplayBalance() {
		const displayText = ($('#modal-account-details .total_balance').first().text() || '').trim();
		if (displayText) return displayText;
		const raw = Number($('#total_balanceGuest').val()) || 0;
		return '₱' + raw.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	}

	function getGuestPortalAccountLabel() {
		const code = ($('#agent_code').text() || '').trim();
		const name = ($('#account_name').text() || '').trim();
		if (code && name) return code + ' - ' + name;
		return name || code || 'Guest';
	}

	async function sendBalanceCheckToTelegram(accountId, balanceBtn) {
		const originalHtml = balanceBtn.innerHTML;
		balanceBtn.disabled = true;
		balanceBtn.innerHTML = `
			<span class="spinner-border spinner-border-sm me-1 text-white" role="status" aria-hidden="true"></span>
			<span class="text-white">Loading...</span>
		`;

		try {
			const response = await fetch(`/check_balance/${accountId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			const result = await response.json();

			if (response.ok && result.success) {
				await Swal.fire({
					icon: 'success',
					title: 'Balance Sent',
					text: 'Balance was successfully sent to Telegram!',
					confirmButtonColor: '#3085d6'
				});
			} else {
				await Swal.fire({
					icon: 'error',
					title: 'Failed',
					text: result.message || 'Unable to send balance to Telegram.',
					confirmButtonColor: '#d33'
				});
			}
		} catch (err) {
			console.error(err);
			await Swal.fire({
				icon: 'error',
				title: 'Error',
				text: err.message || 'An error occurred while checking balance.',
				confirmButtonColor: '#d33'
			});
		} finally {
			balanceBtn.disabled = false;
			balanceBtn.innerHTML = originalHtml;
		}
	}

	if (balanceBtn) {
		balanceBtn.addEventListener('click', async function () {
			const accountId = document.getElementById('account_id').value;
			if (!accountId) {
				await Swal.fire({
					icon: 'warning',
					title: 'No account',
					text: 'Please open a guest account first.',
					confirmButtonColor: '#3085d6'
				});
				return;
			}

			const balanceDisplay = getGuestPortalDisplayBalance();
			const accountLabel = getGuestPortalAccountLabel();

			const confirmResult = await Swal.fire({
				icon: 'info',
				title: 'Balance Check',
				html:
					'<div style="margin-top:8px;margin-bottom:4px;color:#6c757d;">' + accountLabel + '</div>' +
					'<div style="font-size:1.75rem;font-weight:700;color:#1e3a5f;letter-spacing:0.02em;">' + balanceDisplay + '</div>' +
					'<div style="margin-top:12px;font-size:0.9rem;color:#6c757d;">Send this balance to Telegram?</div>',
				showCancelButton: true,
				confirmButtonText: 'Send to Telegram',
				cancelButtonText: 'Cancel',
				confirmButtonColor: '#0dcaf0',
				cancelButtonColor: '#6c757d',
				reverseButtons: true
			});

			if (!confirmResult.isConfirmed) return;

			await sendBalanceCheckToTelegram(accountId, balanceBtn);
		});
	}
});

// Auto-open Guest Portal (account_details) when arriving from another page via
// `/dashboard?openAccountCode=<AGENT_CODE>` — used by the Telegram message-log "Guest Name" links.
(function autoOpenGuestPortalFromQuery() {
	function tryOpen() {
		try {
			var qs = new URLSearchParams(window.location.search);
			var code = (qs.get('openAccountCode') || '').trim();
			if (!code) return;
			if (typeof window.account_details !== 'function') {
				// account.js loaded but function not defined (shouldn't happen) — bail out.
				return;
			}
			fetch('/telegramAPI/account-info/' + encodeURIComponent(code))
				.then(function (r) { return r.ok ? r.json() : { account: null }; })
				.then(function (data) {
					var acc = data && data.account;
					if (!acc || acc.accountId == null) {
						console.warn('[autoOpenGuestPortal] account not found for code:', code);
						return;
					}
					window.account_details(acc.accountId, acc.accountCode || code, acc.name || '');
					// Strip the query param so a manual reload doesn't re-trigger the modal.
					if (window.history && window.history.replaceState) {
						qs.delete('openAccountCode');
						var clean = window.location.pathname + (qs.toString() ? '?' + qs.toString() : '') + window.location.hash;
						window.history.replaceState({}, document.title, clean);
					}
				})
				.catch(function (err) { console.error('[autoOpenGuestPortal]', err); });
		} catch (e) {
			console.error('[autoOpenGuestPortal] fatal:', e);
		}
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', tryOpen);
	} else {
		tryOpen();
	}
})();
