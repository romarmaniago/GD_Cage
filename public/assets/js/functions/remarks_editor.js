(function (window) {
	'use strict';

	function getPermissions() {
		var el = document.getElementById('user-role');
		if (!el) return 99;
		return parseInt(el.getAttribute('data-permissions') || el.dataset.permissions || '99', 10);
	}

	function canEdit() {
		return getPermissions() !== 2;
	}

	function escapeHtml(value) {
		return String(value || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function renderCell(text, options) {
		options = options || {};
		var raw = text != null ? String(text) : '';
		var displayText = options.displayText != null ? String(options.displayText) : raw;
		var source = options.source;
		var recordId = options.recordId;
		var suffixHtml = options.suffixHtml || '';
		var editable = options.editable !== false && source && recordId && canEdit();

		var safe = escapeHtml(displayText);
		var textHtml = safe || '<span class="text-muted">—</span>';

		if (!editable) {
			return (safe ? safe : '<span class="text-muted">-</span>') + suffixHtml;
		}

		var enc = encodeURIComponent(raw);
		return (
			'<div class="remarks-editor-cell remarks-editor-clickable js-edit-remarks-btn text-break"' +
			' role="button" tabindex="0"' +
			' data-remarks-source="' + escapeHtml(source) + '"' +
			' data-record-id="' + escapeHtml(String(recordId)) + '"' +
			' data-remarks="' + enc + '"' +
			' title="Click to edit remarks">' +
			'<span class="remarks-editor-text">' + textHtml + '</span>' +
			'</div>' + suffixHtml
		);
	}

	function showSuccessToast() {
		if (!window.Swal) return;
		window.Swal.fire({
			icon: 'success',
			title: 'Saved',
			showConfirmButton: false,
			timer: 1200,
			heightAuto: false,
			didOpen: function () {
				boostSwalZIndex();
			}
		});
	}

	function patchRemarks(source, recordId, remarks, callbacks) {
		callbacks = callbacks || {};
		$.ajax({
			url: '/remarks/' + encodeURIComponent(source) + '/' + encodeURIComponent(recordId),
			method: 'PATCH',
			contentType: 'application/json',
			data: JSON.stringify({ remarks: remarks != null ? String(remarks) : '' }),
			success: function (res) {
				if (res && res.success) {
					if (!callbacks.skipToast) {
						showSuccessToast();
					}
					if (typeof callbacks.onSuccess === 'function') {
						callbacks.onSuccess(res);
					}
				} else if (typeof callbacks.onError === 'function') {
					callbacks.onError(res);
				}
			},
			error: function (xhr) {
				if (typeof callbacks.onError === 'function') {
					var msg = (xhr.responseJSON && xhr.responseJSON.message) || 'Could not update remarks.';
					callbacks.onError({ message: msg });
				}
			}
		});
	}

	function allowSwalFocusInModal(e) {
		if (e.target && e.target.closest && e.target.closest('.swal2-container')) {
			e.stopImmediatePropagation();
		}
	}

	function attachSwalModalFocusFix() {
		window.addEventListener('focusin', allowSwalFocusInModal, true);
	}

	function detachSwalModalFocusFix() {
		window.removeEventListener('focusin', allowSwalFocusInModal, true);
	}

	function boostSwalZIndex() {
		var zIndex = 1080;
		document.querySelectorAll('.modal.show').forEach(function (modal) {
			var z = parseInt(window.getComputedStyle(modal).zIndex, 10);
			if (!isNaN(z) && z + 10 > zIndex) {
				zIndex = z + 10;
			}
		});
		document.querySelectorAll('.swal2-container').forEach(function (el) {
			el.style.zIndex = String(zIndex);
		});
	}

	function openEditor(initialValue, onSave) {
		if (!canEdit()) return;
		if (!window.Swal) {
			var val = window.prompt('Remarks', initialValue || '');
			if (val !== null && typeof onSave === 'function') onSave(val);
			return;
		}

		attachSwalModalFocusFix();
		window.Swal.fire({
			title: 'Edit remarks',
			input: 'textarea',
			inputValue: initialValue || '',
			inputAttributes: { maxlength: '500', rows: '4', 'aria-label': 'Edit remarks' },
			showCancelButton: true,
			confirmButtonText: 'Save',
			focusConfirm: false,
			heightAuto: false,
			preConfirm: function (value) {
				return value != null ? String(value) : '';
			},
			didOpen: function () {
				boostSwalZIndex();
				var inp = window.Swal.getInput();
				if (inp) {
					inp.removeAttribute('readonly');
					inp.removeAttribute('disabled');
					setTimeout(function () {
						inp.focus();
					}, 50);
				}
			},
			willClose: function () {
				detachSwalModalFocusFix();
			}
		}).then(function (result) {
			detachSwalModalFocusFix();
			if (result.isConfirmed && typeof onSave === 'function') {
				onSave(result.value != null ? String(result.value) : '');
			}
		});
	}

	function setTriggerBusy($trigger, busy) {
		$trigger.toggleClass('remarks-editor-busy', !!busy)
			.attr('aria-disabled', busy ? 'true' : null)
			.css('pointer-events', busy ? 'none' : '');
	}

	function resolveRemarksTrigger($el) {
		if (!$el || !$el.length) return $el;
		if ($el.hasClass('remarks-editor-cell')) return $el;
		return $el.closest('.remarks-editor-cell');
	}

	function updateCell($trigger, newText) {
		var $cell = resolveRemarksTrigger($trigger);
		if (!$cell || !$cell.length) return;
		var safe = escapeHtml(newText);
		$cell.find('.remarks-editor-text').html(
			safe || '<span class="text-muted">—</span>'
		);
		$cell.attr('data-remarks', encodeURIComponent(newText || ''));
	}

	function openRemarksFromTrigger($trigger) {
		$trigger = resolveRemarksTrigger($trigger);
		if (!$trigger || !$trigger.length) return;
		if (!canEdit() || $trigger.hasClass('remarks-editor-busy')) return;

		var source = $trigger.data('remarks-source');
		var recordId = $trigger.data('record-id');
		if (!source || !recordId) return;

		var rawRemarks = '';
		try {
			rawRemarks = decodeURIComponent(String($trigger.attr('data-remarks') || ''));
		} catch (err) {
			rawRemarks = '';
		}

		openEditor(rawRemarks, function (newVal) {
			setTriggerBusy($trigger, true);
			patchRemarks(source, recordId, newVal, {
				onSuccess: function (res) {
					setTriggerBusy($trigger, false);
					updateCell($trigger, res.remarks != null ? res.remarks : newVal);
				},
				onError: function (err) {
					setTriggerBusy($trigger, false);
					if (window.Swal) {
						window.Swal.fire({ icon: 'error', title: 'Error', text: (err && err.message) || 'Could not update remarks.' });
					}
				}
			});
		});
	}

	function handleRemarksClick(e) {
		e.preventDefault();
		e.stopPropagation();
		openRemarksFromTrigger($(this));
	}

	$(document).on('click', '.js-edit-remarks-btn', handleRemarksClick);
	$(document).on('click', 'td.remarks-editor-td', function (e) {
		if ($(e.target).closest('.js-edit-remarks-btn').length) return;
		var $btn = $(this).find('.js-edit-remarks-btn').first();
		if ($btn.length) handleRemarksClick.call($btn[0], e);
	});

	$(document).on('keydown', '.js-edit-remarks-btn', function (e) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		e.stopPropagation();
		openRemarksFromTrigger($(this));
	});

	window.RemarksEditor = {
		canEdit: canEdit,
		escapeHtml: escapeHtml,
		renderCell: renderCell,
		patchRemarks: patchRemarks,
		openEditor: openEditor,
		showSuccessToast: showSuccessToast
	};
})(window);
