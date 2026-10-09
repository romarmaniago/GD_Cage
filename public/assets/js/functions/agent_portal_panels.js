/**
 * Agent Portal — GUESTS and MEMO panels (overlays inside #modal-account-details).
 * GUESTS: the agent's guests (list / search / add / edit / delete) via /guest_data, /add_guest, /guest/:id.
 * MEMO: a sticky note on the agent (agent.MEMO + MEMO_COLOR), autosaved via /account/:id/agent_memo.
 */
(function ($) {
	if (!$ || !document.getElementById('modal-account-details')) return;

	var $portal = $('#modal-account-details');
	var $guestsOverlay = $('#gp-guests-overlay');
	var $memoOverlay = $('#gp-memo-overlay');
	var $memoEditor = $('#gp-memo-editor');
	var $memoStatus = $('#gp-memo-status');

	var guests = [];
	var memoAccountId = null;
	var memoSavedHtml = '';
	var memoSavedColor = 'yellow';
	var memoSaveTimer = null;

	function permissions() {
		return parseInt($('#user-role').data('permissions'), 10);
	}

	function isViewOnly() {
		return permissions() === 2;
	}

	function currentAccountId() {
		return ($('#account_id').val() || $('#account_id_add').val() || '').trim();
	}

	function currentAgentId() {
		return ($('#account_agent_id').val() || '').trim();
	}

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function alertError(title, text) {
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'error', title: title, text: text });
		} else {
			alert(text);
		}
	}

	function notifySuccess(title, text) {
		if (typeof Swal === 'undefined') return;
		Swal.fire({ icon: 'success', title: title, text: text || '', timer: 1600, showConfirmButton: false });
	}

	function errorText(xhr, fallback) {
		var body = xhr && xhr.responseJSON;
		return (body && (body.error || body.message)) || fallback;
	}

	function openOverlay($overlay) {
		$('.guest-portal-overlay').not($overlay).addClass('d-none');
		$overlay.removeClass('d-none');
		$('.guest-portal-panel-btn').removeClass('active');
		$('[data-gp-panel="' + $overlay.attr('id') + '"]').addClass('active');
	}

	function closeOverlay($overlay) {
		if ($overlay.is($memoOverlay)) flushMemoSave();
		$overlay.addClass('d-none');
		$('[data-gp-panel="' + $overlay.attr('id') + '"]').removeClass('active');
	}

	// ── GUESTS ────────────────────────────────────────────────────────────
	// Same table and row actions as the Agency page GUEST card.

	var guestSort = { key: 'guest_name', dir: 'asc' };
	var guestPage = 0;

	// -1 = All
	function guestPageLength() {
		return parseInt($('#gp-guests-length').val(), 10) || 25;
	}

	function renderGuestPager(total, start, shown) {
		var len = guestPageLength();
		var pages = len > 0 ? Math.max(1, Math.ceil(total / len)) : 1;
		$('#gp-guests-info').text(total ? 'Showing ' + (start + 1) + ' to ' + (start + shown) + ' of ' + total + ' entries' : '');
		if (pages <= 1) {
			$('#gp-guests-pages').empty();
			return;
		}
		var item = function (label, page, disabled, active) {
			return '<li class="page-item' + (disabled ? ' disabled' : '') + (active ? ' active' : '') + '">' +
				'<a class="page-link" data-gp-page="' + page + '">' + label + '</a></li>';
		};
		// Window of up to 5 page numbers around the current page.
		var first = Math.max(0, Math.min(guestPage - 2, pages - 5));
		var last = Math.min(pages - 1, first + 4);
		var html = item('Previous', guestPage - 1, guestPage === 0, false);
		for (var p = first; p <= last; p++) html += item(p + 1, p, false, p === guestPage);
		html += item('Next', guestPage + 1, guestPage >= pages - 1, false);
		$('#gp-guests-pages').html(html);
	}

	function findGuest(id) {
		return guests.find(function (g) { return String(g.guest_id) === String(id); });
	}

	function guestSortValue(row, key) {
		return String(row[key] || '').trim().toUpperCase();
	}

	function sortedGuests(rows) {
		var dir = guestSort.dir === 'asc' ? 1 : -1;
		return rows.slice().sort(function (a, b) {
			var av = guestSortValue(a, guestSort.key);
			var bv = guestSortValue(b, guestSort.key);
			if (av < bv) return -dir;
			if (av > bv) return dir;
			return String(a.guest_id || '').localeCompare(String(b.guest_id || ''));
		});
	}

	function syncGuestSortHeaders() {
		$('#gp-guests-overlay th.gp-sortable').each(function () {
			var $th = $(this);
			var active = $th.data('sort-key') === guestSort.key;
			$th.toggleClass('is-sorted', active);
			$th.find('.gp-sort-indicator').text(active ? (guestSort.dir === 'asc' ? '▲' : '▼') : '');
		});
	}

	function guestRowButton(action, icon, title, id) {
		return '<button type="button" class="gp-row-btn" data-gp-action="' + action + '" data-id="' + id + '" title="' + title + '"><i class="fa ' + icon + '"></i></button>';
	}

	function renderGuests() {
		var term = String($('#gp-guests-search').val() || '').trim().toLowerCase();
		var canEdit = !isViewOnly();
		var canDelete = permissions() === 0;
		var rows = guests.filter(function (g) {
			if (!term) return true;
			return [g.guest_name, g.membership_no, g.guest_remarks].some(function (v) {
				return String(v || '').toLowerCase().indexOf(term) !== -1;
			});
		});
		var len = guestPageLength();
		var pages = len > 0 ? Math.max(1, Math.ceil(rows.length / len)) : 1;
		guestPage = Math.min(Math.max(guestPage, 0), pages - 1);
		var start = len > 0 ? guestPage * len : 0;
		var pageRows = sortedGuests(rows).slice(start, len > 0 ? start + len : undefined);
		renderGuestPager(rows.length, start, pageRows.length);
		var html = pageRows.map(function (g) {
			var id = parseInt(g.guest_id, 10) || 0;
			var remarks = String(g.guest_remarks || '').trim();
			var remarksHtml;
			if (canEdit) {
				remarksHtml = '<button type="button" class="gp-remarks-link" data-gp-action="remarks" data-id="' + id + '" title="' + (remarks ? 'View / Edit Remarks' : 'Add Remarks') + '">' +
					(remarks ? escapeHtml(remarks) : '<span class="gp-remarks-empty">+ Add remarks</span>') + '</button>';
			} else {
				remarksHtml = remarks ? escapeHtml(remarks) : '<span class="gp-remarks-empty">-</span>';
			}
			var actions = guestRowButton('new-game', 'fa-plus', 'New Game', id);
			if (canEdit) {
				actions += guestRowButton('edit', 'fa-pen', 'Edit Guest', id);
				actions += guestRowButton('transfer', 'fa-exchange-alt', 'Change LINE', id);
			}
			actions += guestRowButton('history', 'fa-history', 'Game History', id);
			if (canDelete) {
				actions += guestRowButton('delete', 'fa-trash', 'Archive Guest', id);
			}
			return '<tr>' +
				'<td>' + escapeHtml(String(g.guest_name || '-').toUpperCase()) + '</td>' +
				'<td>' + escapeHtml(String(g.membership_no || '').trim() || '-') + '</td>' +
				'<td>' + remarksHtml + '</td>' +
				'<td class="gp-guests-actions-col">' + actions + '</td>' +
				'</tr>';
		}).join('');
		if (!html) {
			html = '<tr><td colspan="4" class="text-center text-muted py-4">' + (guests.length ? 'No guest found matching your search.' : 'No guest found under this agent.') + '</td></tr>';
		}
		$('#gp-guests-body').html(html);
		syncGuestSortHeaders();
	}

	function setGuestsMessage(text, cls) {
		$('#gp-guests-body').html('<tr><td colspan="4" class="text-center py-4 ' + (cls || 'text-muted') + '">' + text + '</td></tr>');
	}

	function loadGuests() {
		var agentId = currentAgentId();
		if (!agentId) {
			guests = [];
			setGuestsMessage('Loading…');
			// The agent id arrives with the portal's account fetch — try again shortly.
			setTimeout(function () {
				if (currentAgentId()) loadGuests();
				else setGuestsMessage('No agent for this account.');
			}, 600);
			return;
		}
		setGuestsMessage('Loading…');
		$.getJSON('/guest_data?agentId=' + encodeURIComponent(agentId))
			.done(function (rows) {
				guests = Array.isArray(rows) ? rows : [];
				renderGuests();
			})
			.fail(function () {
				guests = [];
				setGuestsMessage('Could not load guests.', 'text-danger');
			});
	}

	function hideGuestForms() {
		$('#gp-guest-form').addClass('d-none');
		$('#gp-transfer-dialog').addClass('d-none');
		$('#gp-guest-form, #gp-transfer-form').each(function () { this.reset(); });
		$('#gp-guest-id, #gp-transfer-guest-id').val('');
	}

	function showGuestForm(guest) {
		hideGuestForms();
		$('#gp-guest-id').val(guest ? guest.guest_id : '');
		$('#gp-guest-name').val(guest ? guest.guest_name || '' : '');
		$('#gp-guest-membership').val(guest ? guest.membership_no || '' : '');
		$('#gp-guest-remarks').val(guest ? guest.guest_remarks || '' : '');
		$('#gp-guest-form').removeClass('d-none');
		$('#gp-guest-name').trigger('focus');
	}

	function loadTransferAgents(agencyId, currentAgent) {
		var $agent = $('#gp-transfer-agent');
		if (!agencyId) {
			$agent.html('<option value="">Select Agent</option>').prop('disabled', true);
			return;
		}
		$agent.html('<option value="">Loading…</option>').prop('disabled', true);
		$.getJSON('/account_data?agencyId=' + encodeURIComponent(agencyId))
			.done(function (rows) {
				var seen = {};
				var html = '<option value="">Select Agent</option>';
				(rows || []).forEach(function (row) {
					var id = String(row.agent_id || '');
					if (!id || seen[id] || id === String(currentAgent)) return;
					seen[id] = true;
					var code = String(row.agent_code || '').toUpperCase();
					var name = String(row.agent_name || '').toUpperCase();
					html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(code && name ? code + ' · ' + name : (code || name || 'Agent ' + id)) + '</option>';
				});
				if (Object.keys(seen).length) {
					$agent.html(html).prop('disabled', false);
				} else {
					$agent.html('<option value="">No Agent under this LINE</option>');
				}
			})
			.fail(function () {
				$agent.html('<option value="">Failed to load agent list</option>');
			});
	}

	function showTransferForm(guest) {
		hideGuestForms();
		var membership = String(guest.membership_no || '').trim();
		var name = String(guest.guest_name || '').trim().toUpperCase();
		var agentLabel = [guest.agent_code, guest.agent_name].filter(Boolean).join(' · ');
		$('#gp-transfer-guest-id').val(guest.guest_id);
		$('#gp-transfer-guest').val(membership ? membership + '-' + name : name);
		$('#gp-transfer-current').val([guest.agency_name, agentLabel].filter(Boolean).join(' · '));
		$('#gp-transfer-agent').html('<option value="">Select Agent</option>').prop('disabled', true);
		$('#gp-transfer-dialog').removeClass('d-none');
		var $agency = $('#gp-transfer-agency').html('<option value="">Loading…</option>');
		$.getJSON('/agency_data')
			.done(function (rows) {
				var html = '<option value="">Select LINE</option>';
				(rows || []).forEach(function (row) {
					var label = String(row.AGENCY || '').trim();
					if (!row.IDNo || !label) return;
					html += '<option value="' + escapeHtml(row.IDNo) + '">' + escapeHtml(label.toUpperCase()) + '</option>';
				});
				$agency.html(html);
				if (guest.agency_id) {
					$agency.val(String(guest.agency_id));
					loadTransferAgents(guest.agency_id, guest.agent_id);
				}
			})
			.fail(function () {
				$agency.html('<option value="">Failed to load LINE list</option>');
			});
	}

	// "+" on a row: Game Start for this account with the guest picked in the New Game modal.
	function startGameForGuest(guest) {
		if (typeof window.openGuestPortalGameStart !== 'function') return;
		var guestId = String(guest.guest_id);
		closeOverlay($guestsOverlay);
		window.openGuestPortalGameStart();
		var tries = 0;
		(function pickGuest() {
			var $select = $('#txtGuestGame');
			if ($select.length && $select.find('option[value="' + guestId + '"]').length) {
				$select.val(guestId).trigger('change');
				return;
			}
			if (++tries < 30) setTimeout(pickGuest, 150);
		})();
	}

	function editGuestRemarks(guest) {
		var editor = window.RemarksEditor;
		if (!editor || !editor.canEdit()) {
			showGuestForm(guest);
			return;
		}
		editor.openEditor(String(guest.guest_remarks || '').trim(), function (newVal) {
			editor.patchRemarks('guest', guest.guest_id, newVal, {
				skipToast: true,
				onSuccess: function (res) {
					guest.guest_remarks = res && res.remarks != null ? res.remarks : newVal;
					renderGuests();
					notifySuccess('Remarks updated', String(guest.guest_name || '').toUpperCase());
				},
				onError: function (err) {
					alertError('Error', (err && err.message) || 'Could not update remarks.');
				}
			});
		});
	}

	function deleteGuest(guest) {
		var doDelete = function () {
			$.ajax({ url: '/guest/remove/' + encodeURIComponent(guest.guest_id), method: 'PUT' })
				.done(function () {
					loadGuests();
					notifySuccess('Guest archived', String(guest.guest_name || '').toUpperCase());
				})
				.fail(function (xhr) {
					alertError('Archive guest', errorText(xhr, 'Could not archive the guest.'));
				});
		};
		if (typeof Swal === 'undefined') {
			if (confirm('Archive guest ' + guest.guest_name + '?')) doDelete();
			return;
		}
		Swal.fire({
			icon: 'warning',
			title: 'Archive guest?',
			text: String(guest.guest_name || '').toUpperCase(),
			showCancelButton: true,
			confirmButtonText: 'Archive',
			confirmButtonColor: '#dc3545'
		}).then(function (result) {
			if (result.isConfirmed) doDelete();
		});
	}

	$(document).on('click', '#btn-guest-portal-guests', function () {
		hideGuestForms();
		guestPage = 0;
		$('#gp-guests-length').val('25');
		$('#gp-guests-search').val('');
		$('#gp-guests-add').toggleClass('d-none', isViewOnly());
		openOverlay($guestsOverlay);
		loadGuests();
	});

	$(document).on('input', '#gp-guests-search', function () {
		guestPage = 0;
		renderGuests();
	});

	$(document).on('change', '#gp-guests-length', function () {
		guestPage = 0;
		renderGuests();
	});

	$(document).on('click', '#gp-guests-pages .page-item:not(.disabled):not(.active) .page-link', function () {
		guestPage = parseInt($(this).data('gp-page'), 10) || 0;
		renderGuests();
	});

	$(document).on('click', '#gp-guests-overlay th.gp-sortable', function () {
		var key = $(this).data('sort-key');
		guestSort = { key: key, dir: guestSort.key === key && guestSort.dir === 'asc' ? 'desc' : 'asc' };
		renderGuests();
	});

	$(document).on('click', '#gp-guests-add', function () {
		showGuestForm(null);
	});

	$(document).on('click', '#gp-guests-overlay [data-gp-form-cancel]', hideGuestForms);

	$(document).on('click', '#gp-guests-body [data-gp-action]', function () {
		var guest = findGuest($(this).data('id'));
		if (!guest) return;
		switch ($(this).data('gp-action')) {
			case 'new-game': startGameForGuest(guest); break;
			case 'edit': showGuestForm(guest); break;
			case 'transfer': showTransferForm(guest); break;
			case 'remarks': editGuestRemarks(guest); break;
			case 'delete': deleteGuest(guest); break;
			case 'history':
				if (typeof window.game_history === 'function') {
					closeOverlay($guestsOverlay);
					window.game_history(currentAccountId(), guest.guest_id);
				}
				break;
		}
	});

	$(document).on('change', '#gp-transfer-agency', function () {
		var guest = findGuest($('#gp-transfer-guest-id').val());
		loadTransferAgents($(this).val(), guest ? guest.agent_id : null);
	});

	$(document).on('submit', '#gp-guest-form', function (e) {
		e.preventDefault();
		var guestId = $('#gp-guest-id').val();
		var name = String($('#gp-guest-name').val() || '').trim();
		var membership = String($('#gp-guest-membership').val() || '').trim();
		var remarks = String($('#gp-guest-remarks').val() || '').trim();
		if (!name) {
			alertError('Guest', 'Guest name is required.');
			return;
		}
		if (membership && !/^\d+$/.test(membership)) {
			alertError('Guest', 'Membership No must contain digits only.');
			return;
		}
		var data = { txtGuestName: name, txtMembershipNo: membership, txtRemarks: remarks };
		var request;
		if (guestId) {
			request = $.ajax({ url: '/guest/' + encodeURIComponent(guestId), method: 'PUT', data: data });
		} else {
			data.txtAgentId = currentAgentId();
			request = $.ajax({ url: '/add_guest', method: 'POST', data: data });
		}
		var $save = $('#gp-guest-save').prop('disabled', true);
		request
			.done(function () {
				hideGuestForms();
				loadGuests();
				notifySuccess(guestId ? 'Guest updated' : 'Guest added', name.toUpperCase());
			})
			.fail(function (xhr) {
				alertError('Guest', errorText(xhr, 'Could not save the guest.'));
			})
			.always(function () {
				$save.prop('disabled', false);
			});
	});

	$(document).on('submit', '#gp-transfer-form', function (e) {
		e.preventDefault();
		var guestId = $('#gp-transfer-guest-id').val();
		var targetAgentId = $('#gp-transfer-agent').val();
		if (!guestId || !targetAgentId) {
			alertError('Change LINE', 'Select the LINE and Agent to transfer to.');
			return;
		}
		var $save = $('#gp-transfer-save').prop('disabled', true);
		var guestLabel = $('#gp-transfer-guest').val();
		var agentLabel = $('#gp-transfer-agent option:selected').text();
		$.ajax({ url: '/guest/' + encodeURIComponent(guestId) + '/transfer', method: 'PUT', data: { targetAgentId: targetAgentId } })
			.done(function () {
				hideGuestForms();
				loadGuests();
				notifySuccess('Guest transferred', guestLabel + ' → ' + agentLabel);
			})
			.fail(function (xhr) {
				alertError('Change LINE', errorText(xhr, 'Could not transfer the guest.'));
			})
			.always(function () {
				$save.prop('disabled', false);
			});
	});

	// ── MEMO ──────────────────────────────────────────────────────────────

	// state: 'saving' | 'saved' | 'failed' — picks the badge color.
	function setMemoStatus(text, state) {
		$memoStatus
			.text(text || '')
			.removeClass('is-saving is-saved is-failed')
			.addClass(text && state ? 'is-' + state : '');
	}

	function memoHtml() {
		// An emptied editor leaves a stray <br> / <div> behind.
		return $.trim($memoEditor.text()) === '' ? '' : $memoEditor.html();
	}

	function memoDirty() {
		return memoAccountId != null && memoHtml() !== memoSavedHtml;
	}

	function saveMemo() {
		clearTimeout(memoSaveTimer);
		memoSaveTimer = null;
		if (isViewOnly() || !memoDirty()) return;
		var accountId = memoAccountId;
		var html = memoHtml();
		setMemoStatus('Saving…', 'saving');
		$.ajax({
			url: '/account/' + encodeURIComponent(accountId) + '/agent_memo',
			method: 'PUT',
			contentType: 'application/json',
			// The note color is no longer picked in the UI; send back the stored one unchanged.
			data: JSON.stringify({ memo: html, color: memoSavedColor })
		})
			.done(function () {
				// Compare against what was sent, not the server copy, so typing during the save stays dirty.
				if (accountId === memoAccountId) {
					memoSavedHtml = html;
					if (memoDirty()) setMemoStatus('');
					else setMemoStatus('Saved', 'saved');
				}
			})
			.fail(function (xhr) {
				setMemoStatus('Save failed', 'failed');
				alertError('Memo', errorText(xhr, 'Could not save the memo.'));
			});
	}

	function scheduleMemoSave() {
		if (isViewOnly()) return;
		setMemoStatus('');
		clearTimeout(memoSaveTimer);
		memoSaveTimer = setTimeout(saveMemo, 900);
	}

	function flushMemoSave() {
		if (memoSaveTimer || memoDirty()) saveMemo();
	}

	function loadMemo() {
		var accountId = currentAccountId();
		memoAccountId = null;
		memoSavedHtml = '';
		memoSavedColor = 'yellow';
		$memoEditor.html('');
		setMemoStatus('Loading…', 'saving');
		var viewOnly = isViewOnly();
		$memoEditor.attr('contenteditable', viewOnly ? 'false' : 'true');
		$('#gp-memo-toolbar').toggleClass('d-none', viewOnly);
		if (!accountId) {
			setMemoStatus('');
			return;
		}
		$.getJSON('/account/' + encodeURIComponent(accountId) + '/agent_memo')
			.done(function (res) {
				if (accountId !== currentAccountId()) return;
				$memoEditor.html(res.memo || '');
				memoSavedHtml = memoHtml();
				memoSavedColor = res.color || 'yellow';
				memoAccountId = accountId;
				setMemoStatus('');
				if (!viewOnly) $memoEditor.trigger('focus');
			})
			.fail(function (xhr) {
				setMemoStatus('');
				alertError('Memo', errorText(xhr, 'Could not load the memo.'));
			});
	}

	$(document).on('click', '#btn-guest-portal-memo', function () {
		openOverlay($memoOverlay);
		loadMemo();
	});

	$memoEditor.on('input', scheduleMemoSave);

	// Paste as plain text so outside formatting doesn't come along.
	$memoEditor.on('paste', function (e) {
		var clip = e.originalEvent && e.originalEvent.clipboardData;
		if (!clip) return;
		e.preventDefault();
		document.execCommand('insertText', false, clip.getData('text/plain'));
	});

	// Keep the editor selection when a toolbar button is clicked.
	$(document).on('mousedown', '#gp-memo-toolbar button', function (e) {
		e.preventDefault();
	});

	// ── Text color palette ──

	var memoRange = null;

	// Remember the editor selection: the Custom color input takes focus away from it.
	$(document).on('selectionchange', function () {
		var sel = window.getSelection();
		if (sel && sel.rangeCount && $memoEditor[0].contains(sel.getRangeAt(0).commonAncestorContainer)) {
			memoRange = sel.getRangeAt(0).cloneRange();
		}
	});

	function hslToHex(h, s, l) {
		s /= 100;
		l /= 100;
		var a = s * Math.min(l, 1 - l);
		var f = function (n) {
			var k = (n + h / 30) % 12;
			var c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
			return ('0' + Math.round(c * 255).toString(16)).slice(-2);
		};
		return '#' + f(0) + f(8) + f(4);
	}

	// 10 columns: a gray row (white → black), then each hue from light to dark.
	(function buildPalette() {
		var hues = [0, 25, 45, 60, 120, 165, 190, 215, 260, 300];
		var html = '';
		for (var g = 0; g < 10; g++) {
			var gray = hslToHex(0, 0, Math.round(100 - g * (100 / 9)));
			html += '<button type="button" class="gp-color-swatch" data-text-color="' + gray + '" style="background:' + gray + '" title="' + gray + '"></button>';
		}
		[88, 75, 60, 45, 32, 20].forEach(function (light) {
			hues.forEach(function (hue) {
				var color = hslToHex(hue, 80, light);
				html += '<button type="button" class="gp-color-swatch" data-text-color="' + color + '" style="background:' + color + '" title="' + color + '"></button>';
			});
		});
		$('#gp-color-grid').html(html);
	})();

	function toggleColorPop(open) {
		$('#gp-color-pop').toggleClass('d-none', !open);
		$('#gp-color-btn').attr('aria-expanded', open ? 'true' : 'false');
	}

	function applyTextColor(color) {
		$memoEditor.trigger('focus');
		if (memoRange) {
			var sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(memoRange);
		}
		document.execCommand('styleWithCSS', false, true);
		document.execCommand('foreColor', false, color || '#111111');
		$('#gp-color-bar').css('background', color || '#000');
		scheduleMemoSave();
	}

	$(document).on('click', '#gp-color-btn', function () {
		toggleColorPop($('#gp-color-pop').hasClass('d-none'));
	});

	$(document).on('click', '#gp-color-pop [data-text-color]', function () {
		applyTextColor($(this).data('text-color'));
		toggleColorPop(false);
	});

	$(document).on('change', '#gp-color-custom', function () {
		applyTextColor(this.value);
		toggleColorPop(false);
	});

	$(document).on('mousedown', function (e) {
		if (!$(e.target).closest('.gp-color-picker').length) toggleColorPop(false);
	});

	$(document).on('click', '#gp-memo-toolbar .gp-fmt-btn', function () {
		document.execCommand($(this).data('fmt'), false, null);
		scheduleMemoSave();
	});

	// ── Shared ────────────────────────────────────────────────────────────

	$(document).on('click', '#modal-account-details [data-gp-close]', function () {
		closeOverlay($(this).closest('.guest-portal-overlay'));
	});

	// Click on the dimmed area outside the panel closes it.
	$(document).on('mousedown', '#modal-account-details .guest-portal-overlay', function (e) {
		if (e.target === this) closeOverlay($(this));
	});

	$(document).on('keydown', '#modal-account-details .guest-portal-overlay', function (e) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			// An open Change LINE dialog closes first, then the panel.
			if (!$('#gp-transfer-dialog').hasClass('d-none')) hideGuestForms();
			else closeOverlay($(this));
		}
	});

	$(document).on('mousedown', '#gp-transfer-dialog', function (e) {
		if (e.target === this) hideGuestForms();
	});

	$portal.on('hide.bs.modal', function () {
		flushMemoSave();
		$('.guest-portal-overlay').addClass('d-none');
		$('.guest-portal-panel-btn').removeClass('active');
	});

	window.addEventListener('beforeunload', flushMemoSave);
})(window.jQuery);
