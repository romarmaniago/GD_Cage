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
			return (safe ? safe : '') + suffixHtml;
		}

		var enc = encodeURIComponent(raw);
		return (
			'<div class="remarks-editor-cell">' +
			'<span class="remarks-editor-text remarks-editor-clickable cursor-pointer text-break js-edit-remarks-btn"' +
			' role="button" tabindex="0"' +
			' data-remarks-source="' + escapeHtml(source) + '"' +
			' data-record-id="' + escapeHtml(String(recordId)) + '"' +
			' data-remarks="' + enc + '"' +
			' title="Click to edit remarks">' + textHtml + '</span>' +
			'</div>' + suffixHtml
		);
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
		document.querySelectorAll('.swal2-container').forEach(function (el) {
			el.style.zIndex = '1080';
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

	function updateCell($trigger, newText) {
		var $cell = $trigger.closest('.remarks-editor-cell');
		var safe = escapeHtml(newText);
		$cell.find('.remarks-editor-text').html(safe || '<span class="text-muted">—</span>');
		$trigger.attr('data-remarks', encodeURIComponent(newText || ''));
	}

	function openRemarksFromTrigger($trigger) {
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
					if (window.Swal) {
						window.Swal.fire({ icon: 'success', title: 'Saved', text: res.message || 'Remarks updated.', timer: 1500, showConfirmButton: false });
					}
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

	$(document).on('click', '.js-edit-remarks-btn', function (e) {
		e.preventDefault();
		e.stopPropagation();
		openRemarksFromTrigger($(this));
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
		openEditor: openEditor
	};
})(window);
